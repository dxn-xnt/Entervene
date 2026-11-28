"""Opt-in end-to-end video uploads on a disposable local PostgreSQL database."""

from datetime import date, datetime, timezone
from decimal import Decimal
from concurrent.futures import ThreadPoolExecutor
import io
import os
from pathlib import Path
import subprocess
import sys
import uuid

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Classworks import router as classworks_router
from app.api.v1.routes.Submissions import router as submissions_router
from app.core import FileUpload
from app.core.Config import settings
from app.core.RequestLimits import RequestLimitsMiddleware
from app.core.Security import create_token
from datetime import timedelta
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkAttachment import ClassworkAttachment
from app.models.classwork.RemediationReadingPrerequisite import RemediationReadingPrerequisite
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionReadingReview import InterventionReadingReview
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.SubmissionAttachment import SubmissionAttachment
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.classwork import ClassworkResponseService
from app.services.classwork.ClassworkService import remove_classwork_attachment
from app.services.submission.SubmissionService import (
    remove_submission_attachment,
    unsubmit_student_work,
)


BACKEND_DIR = Path(__file__).resolve().parents[1]
PREVIOUS_REVISION = "20261122_client_grading_templates"
VIDEO_HEADER = b"\x00\x00\x00\x18ftypmp42"
EXPECTED_CHECK_FRAGMENT = "104857600"


def _sparse_file(path: Path, size: int, header: bytes = VIDEO_HEADER) -> Path:
    with path.open("wb") as target:
        target.write(header[:size])
        if size > len(header):
            target.seek(size - 1)
            target.write(b"\0")
    return path


def _run_alembic(database_url: str, *arguments: str, check: bool = True):
    environment = dict(os.environ)
    environment["DATABASE_URL"] = database_url
    return subprocess.run(
        [sys.executable, "-m", "alembic", *arguments],
        cwd=BACKEND_DIR,
        env=environment,
        check=check,
        capture_output=True,
        text=True,
    )


def _constraint_definitions(engine) -> dict[tuple[str, str], str]:
    with engine.connect() as connection:
        rows = connection.execute(text("""
            SELECT conrelid::regclass::text AS table_name,
                   conname,
                   pg_get_constraintdef(oid, true) AS definition
            FROM pg_constraint
            WHERE conrelid IN ('classwork_attachment'::regclass, 'submission_attachment'::regclass)
              AND contype = 'c'
            ORDER BY 1, 2
        """)).mappings()
        return {(row["table_name"], row["conname"]): row["definition"] for row in rows}


def _seed(session: Session):
    year = AcademicYear(
        year_label="2030-2031",
        start_date=date(2030, 6, 1),
        end_date=date(2031, 3, 31),
        is_active=True,
    )
    level = AcademicLevel(level_name="Grade 7 Video", grade_level=7)
    template = GradingTemplate(
        template_name="Video Test Core",
        passing_threshold=85,
        status="active",
    )
    template.components = [
        GradingTemplateComponent(component_name="Written Work", weight=20, display_order=1),
        GradingTemplateComponent(component_name="Performance Tasks", weight=50, display_order=2),
        GradingTemplateComponent(component_name="Exams", weight=30, display_order=3),
    ]
    session.add_all([year, level, template])
    session.flush()
    period = AcademicPeriod(
        period_name="Q1 Video",
        period_type="QUARTER",
        period_sequence=1,
        total_periods_in_year=4,
        start_date=date(2030, 6, 1),
        end_date=date(2030, 8, 31),
        academic_year_id=year.academic_year_id,
        is_active=True,
    )
    subject = Subject(
        subject_name="Video Integration Science",
        subject_codename="VIDSCI7",
        academic_level_id=level.academic_level_id,
        grading_template_id=template.grading_template_id,
    )
    owner_account = UserAccount(
        user_id=uuid.uuid4(), email="video-owner@example.test", password_hash="hash"
    )
    student_account = UserAccount(
        user_id=uuid.uuid4(), email="video-student@example.test", password_hash="hash"
    )
    retry_account = UserAccount(
        user_id=uuid.uuid4(), email="video-retry@example.test", password_hash="hash"
    )
    session.add_all([period, subject, owner_account, student_account, retry_account])
    session.flush()
    owner = AcademicStaff(
        staff_id="T-VIDEO", first_name="Video", last_name="Teacher", user_id=owner_account.user_id
    )
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="300000000001",
        first_name="Video",
        last_name="Student",
        academic_level_id=level.academic_level_id,
        user_id=student_account.user_id,
    )
    retry_student = Student(
        student_id=uuid.uuid4(),
        student_lrn="300000000002",
        first_name="Retry",
        last_name="Student",
        academic_level_id=level.academic_level_id,
        user_id=retry_account.user_id,
    )
    section = Class(
        section_name="Video PostgreSQL",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
        period_template_group="JHS_45MIN",
    )
    session.add_all([owner, student, retry_student, section])
    session.flush()
    session.add_all([
        StudentClass(
            student_id=student.student_id,
            class_id=section.class_id,
            academic_year_id=year.academic_year_id,
            enrollment_status="enrolled",
        ),
        StudentClass(
            student_id=retry_student.student_id,
            class_id=section.class_id,
            academic_year_id=year.academic_year_id,
            enrollment_status="enrolled",
        ),
        SubjectLoad(
            staff_id=owner.staff_id,
            subject_id=subject.subject_id,
            class_id=section.class_id,
            academic_period_id=period.academic_period_id,
            status="active",
        ),
    ])
    classwork = Classwork(
        title="Published video work",
        classwork_type="ASSIGNMENT",
        total_points=100,
        subject_id=subject.subject_id,
        created_by_staff_id=owner.staff_id,
        is_published=True,
    )
    session.add(classwork)
    session.flush()
    assignment = ClassworkAssignment(
        classwork_id=classwork.classwork_id,
        class_id=section.class_id,
        academic_period_id=period.academic_period_id,
        assigned_by_staff_id=owner.staff_id,
        is_published=True,
    )
    session.add(assignment)
    session.commit()
    return {
        "owner_account": owner_account,
        "student_account": student_account,
        "retry_account": retry_account,
        "owner": owner,
        "student": student,
        "retry_student": retry_student,
        "section": section,
        "subject": subject,
        "period": period,
        "classwork": classwork,
        "assignment": assignment,
    }


@pytest.mark.skipif(
    os.getenv("RUN_POSTGRES_VIDEO_UPLOAD_TEST") != "1",
    reason="Set RUN_POSTGRES_VIDEO_UPLOAD_TEST=1 for disposable PostgreSQL video verification.",
)
def test_video_uploads_persist_on_fully_migrated_postgres(tmp_path, monkeypatch):
    source = make_url(settings.database_url)
    if source.get_backend_name() != "postgresql" or source.host not in {"localhost", "127.0.0.1"}:
        pytest.skip("A local PostgreSQL source connection is required.")

    database_name = "entervene_video_upload_test_" + uuid.uuid4().hex
    admin = create_engine(source.set(database="postgres"), isolation_level="AUTOCOMMIT")
    target = None
    session = None
    created = False
    try:
        with admin.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{database_name}"'))
            created = True
        target_url = source.set(database=database_name)
        rendered_target_url = target_url.render_as_string(hide_password=False)
        target = create_engine(target_url, pool_pre_ping=True)
        assert inspect(target).get_table_names() == []

        _run_alembic(rendered_target_url, "upgrade", "head")
        upgraded_checks = _constraint_definitions(target)
        assert EXPECTED_CHECK_FRAGMENT in upgraded_checks[("classwork_attachment", "classwork_attachment_size_check")]
        assert EXPECTED_CHECK_FRAGMENT in upgraded_checks[("submission_attachment", "submission_attachment_size_check")]

        _run_alembic(rendered_target_url, "downgrade", PREVIOUS_REVISION)
        legacy_checks = _constraint_definitions(target)
        assert "4194304" in legacy_checks[("classwork_attachment", "classwork_attachment_size_check")]
        assert "4194304" in legacy_checks[("submission_attachment", "submission_attachment_size_check")]
        _run_alembic(rendered_target_url, "upgrade", "head")

        session = Session(target)
        seeded = _seed(session)
        seeded_classwork_id = seeded["classwork"].classwork_id
        seeded_assignment_id = seeded["assignment"].classwork_assignment_id
        seeded_retry_student_id = seeded["retry_student"].student_id
        identity = {"sub": seeded["owner_account"].user_id, "role": "teacher"}
        app = FastAPI()
        app.add_middleware(RequestLimitsMiddleware)
        app.include_router(classworks_router, prefix="/api/v1/classwork-assignments")
        app.include_router(submissions_router, prefix="/api/v1/submissions")
        def request_session():
            request_db = Session(target)
            try:
                yield request_db
            finally:
                request_db.close()

        app.dependency_overrides[get_db] = request_session
        app.dependency_overrides[get_current_user] = lambda: identity
        upload_root = tmp_path / "uploads"
        monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", upload_root)
        monkeypatch.setattr(ClassworkResponseService, "BASE_DIR", tmp_path)
        monkeypatch.setattr(ClassworkResponseService, "UPLOADS_DIR", upload_root)

        small_mp4 = _sparse_file(tmp_path / "created.mp4", 1024)
        create_data = {
            "title": "Created with video",
            "classwork_type": "ASSIGNMENT",
            "subject_id": str(seeded["subject"].subject_id),
            "class_ids": f"[{seeded['section'].class_id}]",
            "academic_period_id": str(seeded["period"].academic_period_id),
            "is_published": "true",
        }
        with TestClient(app, raise_server_exceptions=False) as client, small_mp4.open("rb") as source_file:
            created_response = client.post(
                "/api/v1/classwork-assignments/with-assignments",
                data=create_data,
                files={"files": (small_mp4.name, source_file, "video/mp4")},
            )
            assert created_response.status_code == 200, created_response.text

            failing_size_video = _sparse_file(tmp_path / "browser-size.mp4", 52_161_176)
            with failing_size_video.open("rb") as upload:
                response = client.post(
                    f"/api/v1/classwork-assignments/classwork/{seeded['classwork'].classwork_id}/attachments",
                    files={"file": (failing_size_video.name, upload, "video/mp4")},
                )
            assert response.status_code == 200, response.text
            browser_attachment_id = response.json()["classwork_attachment_id"]

            exact_video = _sparse_file(tmp_path / "exact.mp4", FileUpload.VIDEO_UPLOAD_LIMIT)
            with exact_video.open("rb") as upload:
                response = client.post(
                    f"/api/v1/classwork-assignments/classwork/{seeded['classwork'].classwork_id}/attachments",
                    files={"file": (exact_video.name, upload, "video/mp4")},
                )
            assert response.status_code == 200, response.text

            webm = _sparse_file(tmp_path / "supported.webm", 1024, b"\x1a\x45\xdf\xa3webm")
            mov = _sparse_file(tmp_path / "supported.mov", 1024, b"\x00\x00\x00\x18ftypqt  ")
            for path, mime in ((webm, "video/webm"), (mov, "video/quicktime")):
                with path.open("rb") as upload:
                    accepted = client.post(
                        f"/api/v1/classwork-assignments/classwork/{seeded['classwork'].classwork_id}/attachments",
                        files={"file": (path.name, upload, mime)},
                    )
                assert accepted.status_code == 200, accepted.text
                assert accepted.json()["file_type"] == mime

            oversized_video = _sparse_file(
                tmp_path / "over.mp4", FileUpload.VIDEO_UPLOAD_LIMIT + 1
            )
            created_classwork_id = created_response.json()["classwork_id"]
            with oversized_video.open("rb") as upload:
                rejected = client.post(
                    f"/api/v1/classwork-assignments/classwork/{created_classwork_id}/attachments",
                    files={"file": (oversized_video.name, upload, "video/mp4")},
                )
            assert rejected.status_code == 400
            assert rejected.json()["detail"] == FileUpload.VIDEO_SIZE_ERROR

            oversized_document = _sparse_file(
                tmp_path / "over.pdf", FileUpload.DOCUMENT_FILE_SIZE_LIMIT + 1, b"%PDF-1.7\n"
            )
            with oversized_document.open("rb") as upload:
                rejected = client.post(
                    f"/api/v1/classwork-assignments/classwork/{created_classwork_id}/attachments",
                    files={"file": (oversized_document.name, upload, "application/pdf")},
                )
            assert rejected.status_code == 400
            assert rejected.json()["detail"] == FileUpload.DOCUMENT_SIZE_ERROR

            identity.update(sub=seeded["student_account"].user_id, role="student")
            student_video = _sparse_file(tmp_path / "student-exact.mp4", FileUpload.VIDEO_UPLOAD_LIMIT)
            with student_video.open("rb") as upload:
                submitted = client.post(
                    f"/api/v1/submissions/assignment/{seeded['assignment'].classwork_assignment_id}/submit",
                    files={"files": (student_video.name, upload, "video/mp4")},
                )
            assert submitted.status_code == 200, submitted.text

            identity.update(sub=seeded["retry_account"].user_id, role="student")

            def concurrent_first_submission():
                return client.post(
                    f"/api/v1/submissions/assignment/{seeded_assignment_id}/submit",
                    files={"files": ("retry.mp4", io.BytesIO(VIDEO_HEADER + b" retry"), "video/mp4")},
                )

            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(concurrent_first_submission) for _ in range(2)]
                concurrent_results = [future.result(timeout=30) for future in futures]
            assert [result.status_code for result in concurrent_results] == [200, 200]
            retry_submission_ids = {result.json()["submission_id"] for result in concurrent_results}
            assert len(retry_submission_ids) == 1
            session.expire_all()
            retry_rows = session.query(StudentSubmission).filter_by(
                classwork_assignment_id=seeded_assignment_id,
                student_id=seeded_retry_student_id,
            ).all()
            assert len(retry_rows) == 1
            assert len(retry_rows[0].attachments) == 1

            # Concurrent DIFFERENT first submissions (same filename/size, different bytes) on a fresh assignment:
            # Must create exactly 1 StudentSubmission row and preserve BOTH distinct files (neither silently discarded).
            diff_classwork = Classwork(
                title="Concurrent distinct submissions",
                classwork_type="ASSIGNMENT",
                total_points=100,
                subject_id=seeded["subject"].subject_id,
                created_by_staff_id=seeded["owner"].staff_id,
                is_published=True,
            )
            session.add(diff_classwork)
            session.flush()
            diff_assignment = ClassworkAssignment(
                classwork_id=diff_classwork.classwork_id,
                class_id=seeded["section"].class_id,
                academic_period_id=seeded["period"].academic_period_id,
                assigned_by_staff_id=seeded["owner"].staff_id,
                is_published=True,
            )
            session.add(diff_assignment)
            session.commit()
            diff_assignment_id = diff_assignment.classwork_assignment_id

            def concurrent_distinct_first_submission(marker: bytes):
                return client.post(
                    f"/api/v1/submissions/assignment/{diff_assignment_id}/submit",
                    files={"files": ("same.pdf", io.BytesIO(b"%PDF-1.7 " + marker), "application/pdf")},
                )

            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(concurrent_distinct_first_submission, m) for m in (b"AAAA", b"BBBB")]
                distinct_results = [future.result(timeout=30) for future in futures]
            assert [result.status_code for result in distinct_results] == [200, 200]
            assert len({result.json()["submission_id"] for result in distinct_results}) == 1
            session.expire_all()
            distinct_rows = session.query(StudentSubmission).filter_by(
                classwork_assignment_id=diff_assignment_id,
                student_id=seeded_retry_student_id,
            ).all()
            assert len(distinct_rows) == 1
            assert len(distinct_rows[0].attachments) == 2

            # Concurrent student 10-file attachment quota boundary on diff_assignment (currently 2 files; seed 7 more -> 9):
            distinct_submission_id = distinct_rows[0].submission_id
            for index in range(7):
                session.add(SubmissionAttachment(
                    submission_id=distinct_submission_id,
                    file_name=f"student-count-existing-{index}.pdf",
                    file_path=str(upload_root / "submissions" / f"student-count-existing-{index}.pdf"),
                    file_type="application/pdf",
                    file_size=10,
                ))
            session.commit()

            def concurrent_student_count_upload(index: int):
                return client.post(
                    f"/api/v1/submissions/assignment/{diff_assignment_id}/submit",
                    files={"files": (f"student-count-{index}.pdf", io.BytesIO(f"%PDF-1.7 {index}".encode()), "application/pdf")},
                )

            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(concurrent_student_count_upload, i) for i in range(2)]
                student_count_results = [future.result(timeout=30) for future in futures]
            assert sorted(result.status_code for result in student_count_results) == [200, 400]
            assert any(
                result.status_code == 400
                and result.json()["detail"] == FileUpload.ATTACHMENT_COUNT_ERROR
                for result in student_count_results
            )
            session.expire_all()
            assert session.query(SubmissionAttachment).filter_by(
                submission_id=distinct_submission_id
            ).count() == FileUpload.MAX_ATTACHMENT_COUNT

            # Concurrent student 200 MiB aggregate boundary on a fresh assignment:
            student_agg_cw = Classwork(
                title="Student aggregate quota",
                classwork_type="ASSIGNMENT",
                total_points=100,
                subject_id=seeded["subject"].subject_id,
                created_by_staff_id=seeded["owner"].staff_id,
                is_published=True,
            )
            session.add(student_agg_cw)
            session.flush()
            student_agg_assignment = ClassworkAssignment(
                classwork_id=student_agg_cw.classwork_id,
                class_id=seeded["section"].class_id,
                academic_period_id=seeded["period"].academic_period_id,
                assigned_by_staff_id=seeded["owner"].staff_id,
                is_published=True,
            )
            session.add(student_agg_assignment)
            session.flush()
            student_agg_sub = StudentSubmission(
                student_id=seeded_retry_student_id,
                classwork_assignment_id=student_agg_assignment.classwork_assignment_id,
                status="pending",
                attempt_count=0,
            )
            session.add(student_agg_sub)
            session.flush()
            for index in range(2):
                session.add(SubmissionAttachment(
                    submission_id=student_agg_sub.submission_id,
                    file_name=f"student-agg-existing-{index}.mp4",
                    file_path=str(upload_root / "submissions" / f"student-agg-existing-{index}.mp4"),
                    file_type="video/mp4",
                    file_size=95 * 1024 * 1024,
                ))
            session.commit()
            student_agg_assignment_id = student_agg_assignment.classwork_assignment_id
            student_agg_sub_id = student_agg_sub.submission_id

            def concurrent_student_agg_upload(index: int):
                return client.post(
                    f"/api/v1/submissions/assignment/{student_agg_assignment_id}/submit",
                    files={"files": (
                        f"student-agg-{index}.pdf",
                        io.BytesIO(b"%PDF-1.7\n" + bytes([65 + index]) * (6 * 1024 * 1024 - 9)),
                        "application/pdf",
                    )},
                )

            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(concurrent_student_agg_upload, i) for i in range(2)]
                student_agg_results = [future.result(timeout=30) for future in futures]
            assert sorted(result.status_code for result in student_agg_results) == [200, 400]
            assert any(
                result.status_code == 400
                and result.json()["detail"] == FileUpload.ATTACHMENT_AGGREGATE_SIZE_ERROR
                for result in student_agg_results
            )
            session.expire_all()
            student_agg_total = sum(
                row.file_size
                for row in session.query(SubmissionAttachment).filter_by(
                    submission_id=student_agg_sub_id
                ).all()
            )
            assert student_agg_total == 196 * 1024 * 1024

            # Student DB delete failure preserves physical file + post-commit cleanup failure raises 500:
            retry_att = session.query(SubmissionAttachment).filter_by(
                submission_id=retry_rows[0].submission_id
            ).one()
            retry_att_id = retry_att.submission_attachment_id
            retry_att_path = Path(retry_att.file_path)
            assert retry_att_path.is_file()
            unsubmit_resp = client.post(f"/api/v1/submissions/assignment/{seeded_assignment_id}/unsubmit")
            assert unsubmit_resp.status_code == 200, unsubmit_resp.text
            session.rollback()
            with target.begin() as connection:
                connection.execute(text("""
                    CREATE OR REPLACE FUNCTION phase2_reject_sub_attachment_delete()
                    RETURNS trigger LANGUAGE plpgsql AS $$
                    BEGIN
                        RAISE EXCEPTION 'forced phase2 submission delete failure';
                    END;
                    $$
                """))
                connection.execute(text(f"""
                    CREATE TRIGGER phase2_reject_sub_attachment_delete_trigger
                    BEFORE DELETE ON submission_attachment
                    FOR EACH ROW WHEN (OLD.submission_attachment_id = {retry_att_id})
                    EXECUTE FUNCTION phase2_reject_sub_attachment_delete()
                """))
            failed_sub_delete = client.delete(
                f"/api/v1/submissions/assignment/{seeded_assignment_id}/attachments/{retry_att_id}"
            )
            assert failed_sub_delete.status_code == 500
            session.expire_all()
            assert session.get(SubmissionAttachment, retry_att_id) is not None
            assert retry_att_path.is_file()
            session.rollback()
            with target.begin() as connection:
                connection.execute(text(
                    "DROP TRIGGER phase2_reject_sub_attachment_delete_trigger ON submission_attachment"
                ))
                connection.execute(text("DROP FUNCTION phase2_reject_sub_attachment_delete()"))

            # Student post-commit physical cleanup failure logs and raises 500 after DB delete commits:
            with pytest.raises(HTTPException) as sub_cleanup_failure:
                remove_submission_attachment(
                    seeded_assignment_id,
                    retry_att_id,
                    session.get(Student, seeded_retry_student_id),
                    session,
                    delete_file_func=lambda _: False,
                )
            assert sub_cleanup_failure.value.status_code == 500
            assert sub_cleanup_failure.value.detail.endswith("stored-file cleanup failed.")
            assert session.get(SubmissionAttachment, retry_att_id) is None
            retry_att_path.unlink(missing_ok=True)

            # Preservation of remediation attempt history: graded attempt 1 stays intact when attempt 2 is submitted:
            model_ver = AIModelVersion(
                model_name="phase2_remediation_test_model",
                model_type="REGRESSOR",
                model_purpose=ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value,
                algorithm="RandomForestRegressor",
                lifecycle_status="DEVELOPMENT",
                is_active=False,
            )
            session.add(model_ver)
            session.flush()
            prediction = DevelopmentCurrentTermPrediction(
                student_id=seeded_retry_student_id,
                class_id=seeded["section"].class_id,
                subject_id=seeded["subject"].subject_id,
                source_period_id=seeded["period"].academic_period_id,
                target_period_id=seeded["period"].academic_period_id,
                model_version_id=model_ver.model_version_id,
                revision=1,
                predicted_period_grade=Decimal("68.00"),
                intervention_level="HIGH_RISK",
                intervention_basis="BELOW_PASSING",
                evidence_snapshot={},
            )
            session.add(prediction)
            session.flush()
            intervention = Intervention(
                student_id=seeded_retry_student_id,
                class_id=seeded["section"].class_id,
                subject_id=seeded["subject"].subject_id,
                academic_period_id=seeded["period"].academic_period_id,
                source_prediction_id=prediction.prediction_id,
                status="ACTIVE",
                diagnosis_snapshot={},
                activated_at=datetime.now(timezone.utc),
                activated_by_staff_id=seeded["owner"].staff_id,
            )
            session.add(intervention)
            session.flush()
            reading_cw = Classwork(
                title="Remediation prerequisite reading",
                classwork_type="READING",
                total_points=None,
                is_graded=False,
                subject_id=seeded["subject"].subject_id,
                created_by_staff_id=seeded["owner"].staff_id,
                is_published=True,
            )
            session.add(reading_cw)
            session.flush()
            reading_assignment = ClassworkAssignment(
                classwork_id=reading_cw.classwork_id,
                class_id=seeded["section"].class_id,
                academic_period_id=seeded["period"].academic_period_id,
                assigned_by_staff_id=seeded["owner"].staff_id,
                is_published=True,
                recipient_student_id=seeded_retry_student_id,
                source_intervention_id=intervention.intervention_id,
                remediation_request_id=uuid.uuid4(),
            )
            session.add(reading_assignment)
            session.flush()
            remediation_cw = Classwork(
                title="Remediation attempt history",
                classwork_type="ASSIGNMENT",
                total_points=100,
                subject_id=seeded["subject"].subject_id,
                created_by_staff_id=seeded["owner"].staff_id,
                is_published=True,
            )
            session.add(remediation_cw)
            session.flush()
            remediation_assignment = ClassworkAssignment(
                classwork_id=remediation_cw.classwork_id,
                class_id=seeded["section"].class_id,
                academic_period_id=seeded["period"].academic_period_id,
                assigned_by_staff_id=seeded["owner"].staff_id,
                is_published=True,
                recipient_student_id=seeded_retry_student_id,
                source_intervention_id=intervention.intervention_id,
                remediation_request_id=uuid.uuid4(),
                max_attempts=3,
            )
            session.add(remediation_assignment)
            session.flush()
            session.add(RemediationReadingPrerequisite(
                remediation_assignment_id=remediation_assignment.classwork_assignment_id,
                reading_classwork_id=reading_cw.classwork_id,
                reading_assignment_id=reading_assignment.classwork_assignment_id,
                display_order=1,
            ))
            session.add(InterventionReadingReview(
                intervention_id=intervention.intervention_id,
                reading_assignment_id=reading_assignment.classwork_assignment_id,
                student_id=seeded_retry_student_id,
                review_cycle=1,
                acknowledged_at=datetime.now(timezone.utc),
            ))
            session.add(StudentSubmission(
                student_id=seeded_retry_student_id,
                classwork_assignment_id=reading_assignment.classwork_assignment_id,
                status="submitted",
                submitted_at=datetime.now(timezone.utc),
                attempt_count=1,
            ))
            attempt1_path = upload_root / "submissions" / "remediation-attempt-1.pdf"
            attempt1_path.parent.mkdir(parents=True, exist_ok=True)
            attempt1_path.write_bytes(b"%PDF-1.7 attempt1")
            attempt1 = StudentSubmission(
                student_id=seeded_retry_student_id,
                classwork_assignment_id=remediation_assignment.classwork_assignment_id,
                status="graded",
                grade=50,
                attempt_count=1,
            )
            session.add(attempt1)
            session.flush()
            session.add(SubmissionAttachment(
                submission_id=attempt1.submission_id,
                file_name="attempt1.pdf",
                file_path=str(attempt1_path),
                file_type="application/pdf",
                file_size=17,
            ))
            session.commit()
            remediation_assignment_id = remediation_assignment.classwork_assignment_id
            attempt1_id = attempt1.submission_id

            attempt2_resp = client.post(
                f"/api/v1/submissions/assignment/{remediation_assignment_id}/submit",
                files={"files": ("attempt2.pdf", io.BytesIO(b"%PDF-1.7 attempt2"), "application/pdf")},
            )
            assert attempt2_resp.status_code == 200, attempt2_resp.text
            assert attempt2_resp.json()["submission_id"] != attempt1_id
            assert attempt2_resp.json()["attempt_count"] == 2
            session.expire_all()
            remediation_rows = session.query(StudentSubmission).filter_by(
                classwork_assignment_id=remediation_assignment_id,
                student_id=seeded_retry_student_id,
            ).order_by(StudentSubmission.attempt_count.asc()).all()
            assert [row.attempt_count for row in remediation_rows] == [1, 2]
            assert remediation_rows[0].status == "graded"
            assert attempt1_path.is_file()

            identity.update(sub=seeded["owner_account"].user_id, role="teacher")
            for index in range(5):
                session.add(ClassworkAttachment(
                    classwork_id=seeded_classwork_id,
                    file_name=f"count-existing-{index}.pdf",
                    file_path=f"uploads/classworks/count-existing-{index}.pdf",
                    file_type="application/pdf",
                    file_size=1,
                ))
            session.commit()

            def concurrent_count_upload(index):
                return client.post(
                    f"/api/v1/classwork-assignments/classwork/{seeded_classwork_id}/attachments",
                    files={"file": (f"count-{index}.pdf", io.BytesIO(b"%PDF-1.7 count"), "application/pdf")},
                )

            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(concurrent_count_upload, i) for i in range(2)]
                count_results = [future.result(timeout=30) for future in futures]
            assert sorted(result.status_code for result in count_results) == [200, 400]
            assert any(
                result.status_code == 400
                and result.json()["detail"] == FileUpload.ATTACHMENT_COUNT_ERROR
                for result in count_results
            )
            session.expire_all()
            assert session.query(ClassworkAttachment).filter_by(
                classwork_id=seeded_classwork_id
            ).count() == FileUpload.MAX_ATTACHMENT_COUNT

            aggregate_classwork = Classwork(
                title="Concurrent aggregate quota",
                classwork_type="ASSIGNMENT",
                total_points=100,
                subject_id=seeded["subject"].subject_id,
                created_by_staff_id=seeded["owner"].staff_id,
                is_published=False,
            )
            session.add(aggregate_classwork)
            session.flush()
            for index in range(2):
                session.add(ClassworkAttachment(
                    classwork_id=aggregate_classwork.classwork_id,
                    file_name=f"aggregate-existing-{index}.mp4",
                    file_path=f"uploads/classworks/aggregate-existing-{index}.mp4",
                    file_type="video/mp4",
                    file_size=95 * 1024 * 1024,
                ))
            session.commit()
            aggregate_classwork_id = aggregate_classwork.classwork_id

            def concurrent_aggregate_upload(index):
                return client.post(
                    f"/api/v1/classwork-assignments/classwork/{aggregate_classwork_id}/attachments",
                    files={"file": (
                        f"aggregate-{index}.pdf",
                        io.BytesIO(b"%PDF-1.7\n" + b"x" * (6 * 1024 * 1024 - 9)),
                        "application/pdf",
                    )},
                )

            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(concurrent_aggregate_upload, i) for i in range(2)]
                aggregate_results = [future.result(timeout=30) for future in futures]
            assert sorted(result.status_code for result in aggregate_results) == [200, 400]
            assert any(
                result.status_code == 400
                and result.json()["detail"] == FileUpload.ATTACHMENT_AGGREGATE_SIZE_ERROR
                for result in aggregate_results
            )
            session.expire_all()
            aggregate_total = sum(
                row.file_size
                for row in session.query(ClassworkAttachment).filter_by(
                    classwork_id=aggregate_classwork_id
                ).all()
            )
            assert aggregate_total == 196 * 1024 * 1024

            identity.update(sub=seeded["owner_account"].user_id, role="teacher")
            token = create_token(
                str(seeded["owner_account"].user_id), "teacher", "access", timedelta(minutes=30)
            )
            downloaded = client.get(
                f"/api/v1/classwork-assignments/classwork/{seeded['classwork'].classwork_id}"
                f"/attachments/{browser_attachment_id}/download",
                headers={"Authorization": f"Bearer {token}", "Range": "bytes=0-11"},
            )
            assert downloaded.status_code == 206
            assert downloaded.content == VIDEO_HEADER

            session.rollback()
            browser_row = session.get(ClassworkAttachment, browser_attachment_id)
            browser_path = ClassworkResponseService.resolve_classwork_file_path(browser_row.file_path)
            assert browser_path.is_file()
            session.rollback()
            with target.begin() as connection:
                connection.execute(text("""
                    CREATE OR REPLACE FUNCTION phase2_reject_attachment_delete()
                    RETURNS trigger LANGUAGE plpgsql AS $$
                    BEGIN
                        RAISE EXCEPTION 'forced phase2 delete failure';
                    END;
                    $$
                """))
                connection.execute(text(f"""
                    CREATE TRIGGER phase2_reject_attachment_delete_trigger
                    BEFORE DELETE ON classwork_attachment
                    FOR EACH ROW WHEN (OLD.classwork_attachment_id = {browser_attachment_id})
                    EXECUTE FUNCTION phase2_reject_attachment_delete()
                """))
            failed_delete = client.delete(
                f"/api/v1/classwork-assignments/classwork/{seeded['classwork'].classwork_id}"
                f"/attachments/{browser_attachment_id}"
            )
            assert failed_delete.status_code == 500
            session.expire_all()
            assert session.get(ClassworkAttachment, browser_attachment_id) is not None
            assert browser_path.is_file()
            session.rollback()
            with target.begin() as connection:
                connection.execute(text(
                    "DROP TRIGGER phase2_reject_attachment_delete_trigger ON classwork_attachment"
                ))
                connection.execute(text("DROP FUNCTION phase2_reject_attachment_delete()"))

            cleanup_failure_row = session.query(ClassworkAttachment).filter_by(
                classwork_id=seeded["classwork"].classwork_id,
                file_name="count-existing-0.pdf",
            ).one()
            cleanup_failure_id = cleanup_failure_row.classwork_attachment_id
            with pytest.raises(HTTPException) as cleanup_failure:
                remove_classwork_attachment(
                    seeded["classwork"].classwork_id,
                    cleanup_failure_id,
                    seeded["owner"].staff_id,
                    session,
                    delete_file_func=lambda _: False,
                )
            assert cleanup_failure.value.status_code == 500
            assert cleanup_failure.value.detail.endswith("stored-file cleanup failed.")
            assert session.get(ClassworkAttachment, cleanup_failure_id) is None

            before_files = {path.name for path in (upload_root / "classworks").glob("*")}
            session.rollback()
            with target.begin() as connection:
                connection.execute(text("""
                    ALTER TABLE classwork_attachment
                    ADD CONSTRAINT phase1_forced_attachment_failure
                    CHECK (file_name <> 'force-db-failure.mp4')
                """))
            forced = _sparse_file(tmp_path / "force-db-failure.mp4", 1024)
            with forced.open("rb") as upload:
                failed = client.post(
                    f"/api/v1/classwork-assignments/classwork/{created_classwork_id}/attachments",
                    files={"file": (forced.name, upload, "video/mp4")},
                )
            assert failed.status_code == 500
            assert failed.json() == {"detail": FileUpload.ATTACHMENT_SAVE_ERROR}
            assert {path.name for path in (upload_root / "classworks").glob("*")} == before_files
            assert session.query(ClassworkAttachment).filter_by(file_name=forced.name).count() == 0
            session.rollback()
            with target.begin() as connection:
                connection.execute(text(
                    "ALTER TABLE classwork_attachment DROP CONSTRAINT phase1_forced_attachment_failure"
                ))

        session.expire_all()
        persisted_classwork = session.query(ClassworkAttachment).all()
        persisted_submissions = session.query(SubmissionAttachment).all()
        assert any(
            row.file_size == 52_161_176
            and ClassworkResponseService.resolve_classwork_file_path(row.file_path).is_file()
            for row in persisted_classwork
        )
        assert any(
            row.file_size == FileUpload.VIDEO_UPLOAD_LIMIT
            and ClassworkResponseService.resolve_classwork_file_path(row.file_path).is_file()
            for row in persisted_classwork
        )
        assert any(row.file_size == FileUpload.VIDEO_UPLOAD_LIMIT and Path(row.file_path).is_file() for row in persisted_submissions)
        session.close()
        session = None

        blocked_downgrade = _run_alembic(
            rendered_target_url, "downgrade", PREVIOUS_REVISION, check=False
        )
        assert blocked_downgrade.returncode != 0
        with target.connect() as connection:
            assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "20261128_video_attachment_limits"
            assert connection.execute(text("SELECT COUNT(*) FROM classwork_attachment")).scalar_one() == len(persisted_classwork)
    finally:
        if session is not None:
            session.close()
        if target is not None:
            target.dispose()
        if created:
            with admin.connect() as connection:
                connection.execute(text(f'DROP DATABASE IF EXISTS "{database_name}" WITH (FORCE)'))
        admin.dispose()
