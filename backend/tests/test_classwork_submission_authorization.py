import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
import app.api.v1.routes.Classworks as classwork_routes
import app.api.v1.routes.Submissions as submission_routes
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Classworks import router as classworks_router
from app.api.v1.routes.Submissions import router as submissions_router
from app.core.Security import create_access_token
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.Lesson import Lesson
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkAttachment import ClassworkAttachment
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.submissions.SubmissionAttachment import SubmissionAttachment


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    Subject.__table__,
    AcademicPeriod.__table__,
    Class.__table__,
    StudentClass.__table__,
    SubjectLoad.__table__,
    Lesson.__table__,
    Classwork.__table__,
    ClassworkLesson.__table__,
    ClassworkAttachment.__table__,
    ClassworkAssignment.__table__,
    StudentSubmission.__table__,
    SubmissionAttachment.__table__,
]


@pytest.fixture
def authz_context(tmp_path):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    lrn_check = next(
        constraint
        for constraint in Student.__table__.constraints
        if isinstance(constraint, CheckConstraint) and constraint.name == "lrn_check"
    )
    Student.__table__.constraints.remove(lrn_check)
    Base.metadata.create_all(bind=engine, tables=TABLES)
    Student.__table__.append_constraint(lrn_check)
    db = sessionmaker(bind=engine)()

    year = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add_all([year, level])
    db.flush()
    period = AcademicPeriod(
        period_name="Q1",
        period_type="QUARTER",
        start_date=date(2025, 6, 1),
        end_date=date(2025, 8, 31),
        academic_year_id=year.academic_year_id,
    )
    subject = Subject(subject_name="Science", academic_level_id=level.academic_level_id)
    db.add_all([period, subject])
    db.flush()

    accounts = {}
    for name in ("owner", "other_teacher", "student", "other_student"):
        accounts[name] = UserAccount(
            user_id=uuid.uuid4(),
            email=f"{name}@example.test",
            password_hash="hash",
        )
    db.add_all(accounts.values())
    db.flush()
    owner = AcademicStaff(
        staff_id="T-OWNER",
        first_name="Owner",
        last_name="Teacher",
        user_id=accounts["owner"].user_id,
    )
    other_teacher = AcademicStaff(
        staff_id="T-OTHER",
        first_name="Other",
        last_name="Teacher",
        user_id=accounts["other_teacher"].user_id,
    )
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000001",
        first_name="Allowed",
        last_name="Student",
        academic_level_id=level.academic_level_id,
        user_id=accounts["student"].user_id,
    )
    other_student = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000002",
        first_name="Other",
        last_name="Student",
        academic_level_id=level.academic_level_id,
        user_id=accounts["other_student"].user_id,
    )
    allowed_class = Class(
        section_name="Allowed",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    other_class = Class(
        section_name="Other",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add_all([owner, other_teacher, student, other_student, allowed_class, other_class])
    db.flush()
    db.add_all(
        [
            StudentClass(
                student_id=student.student_id,
                class_id=allowed_class.class_id,
                academic_year_id=year.academic_year_id,
                enrollment_status="enrolled",
            ),
            StudentClass(
                student_id=other_student.student_id,
                class_id=other_class.class_id,
                academic_year_id=year.academic_year_id,
                enrollment_status="enrolled",
            ),
            SubjectLoad(
                staff_id=owner.staff_id,
                subject_id=subject.subject_id,
                class_id=allowed_class.class_id,
                academic_period_id=period.academic_period_id,
                status="active",
            ),
        ]
    )
    classwork = Classwork(
        title="Protected work",
        classwork_type="ASSIGNMENT",
        total_points=100,
        subject_id=subject.subject_id,
        created_by_staff_id=owner.staff_id,
        is_published=True,
    )
    db.add(classwork)
    db.flush()
    assignment = ClassworkAssignment(
        classwork_id=classwork.classwork_id,
        class_id=allowed_class.class_id,
        assigned_by_staff_id=owner.staff_id,
        is_published=True,
    )
    db.add(assignment)
    db.flush()
    submission = StudentSubmission(
        student_id=student.student_id,
        classwork_assignment_id=assignment.classwork_assignment_id,
        status="submitted",
        attempt_count=1,
    )
    classwork_file = tmp_path / "classwork.txt"
    classwork_file.write_text("classwork", encoding="utf-8")
    submission_file = tmp_path / "submission.txt"
    submission_file.write_text("submission", encoding="utf-8")
    db.add(submission)
    db.flush()
    classwork_attachment = ClassworkAttachment(
        classwork_id=classwork.classwork_id,
        file_name="classwork.txt",
        file_path=str(classwork_file),
        file_type="text/plain",
        file_size=9,
    )
    submission_attachment = SubmissionAttachment(
        submission_id=submission.submission_id,
        file_name="submission.txt",
        file_path=str(submission_file),
        file_type="text/plain",
        file_size=10,
    )
    db.add_all([classwork_attachment, submission_attachment])
    db.commit()

    identity = {"sub": accounts["owner"].user_id, "role": "teacher"}
    test_app = FastAPI()
    test_app.include_router(classworks_router, prefix="/api/v1/classwork-assignments")
    test_app.include_router(submissions_router, prefix="/api/v1/submissions")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: identity
    with TestClient(test_app) as client:
        yield {
            "client": client,
            "db": db,
            "identity": identity,
            "accounts": accounts,
            "owner": owner,
            "student": student,
            "subject": subject,
            "allowed_class": allowed_class,
            "other_class": other_class,
            "classwork": classwork,
            "assignment": assignment,
            "submission": submission,
            "classwork_attachment": classwork_attachment,
            "submission_attachment": submission_attachment,
            "tmp_path": tmp_path,
        }
    db.close()
    Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
    engine.dispose()


def _act_as(context, account_name: str, role: str) -> None:
    context["identity"].update(
        sub=context["accounts"][account_name].user_id,
        role=role,
    )


def _bearer(context, account_name: str, role: str) -> dict[str, str]:
    token = create_access_token(str(context["accounts"][account_name].user_id), role)
    return {"Authorization": f"Bearer {token}"}


def test_classwork_and_assignment_direct_access_follow_access_matrix(authz_context):
    c = authz_context
    classwork_url = f"/api/v1/classwork-assignments/classwork/{c['classwork'].classwork_id}"
    assignment_url = f"/api/v1/classwork-assignments/assignment/{c['assignment'].classwork_assignment_id}"

    assert c["client"].get(classwork_url).status_code == 200
    assert c["client"].get(classwork_url).json()["assignments"][0]["class_id"] == c["assignment"].class_id
    _act_as(c, "other_teacher", "teacher")
    assert c["client"].get(classwork_url).status_code == 403
    assert c["client"].get(assignment_url).status_code == 403
    _act_as(c, "student", "student")
    assert c["client"].get(classwork_url).status_code == 200
    assert c["client"].get(assignment_url).status_code == 200
    _act_as(c, "other_student", "student")
    assert c["client"].get(classwork_url).status_code == 403
    assert c["client"].get(assignment_url).status_code == 403
    c["identity"].update(sub=str(uuid.uuid4()), role="admin")
    assert c["client"].get(classwork_url).status_code == 200
    assert c["client"].get(assignment_url).status_code == 403


def test_assignment_rejects_class_without_active_teacher_subject_load(authz_context):
    c = authz_context
    before = c["db"].query(ClassworkAssignment).count()
    response = c["client"].post(
        f"/api/v1/classwork-assignments/classwork/{c['classwork'].classwork_id}/assign",
        json={"class_ids": [c["other_class"].class_id]},
    )

    assert response.status_code == 403
    assert c["db"].query(ClassworkAssignment).count() == before


def test_classwork_create_rejects_non_positive_points(authz_context):
    c = authz_context
    before = c["db"].query(Classwork).count()
    response = c["client"].post(
        "/api/v1/classwork-assignments/",
        json={
            "title": "Invalid points",
            "classwork_type": "ASSIGNMENT",
            "total_points": 0,
            "subject_id": c["subject"].subject_id,
        },
    )

    assert response.status_code == 400
    assert c["db"].query(Classwork).count() == before


def test_assignment_rejects_invalid_schedule_and_attempts(authz_context):
    c = authz_context
    url = f"/api/v1/classwork-assignments/classwork/{c['classwork'].classwork_id}/assign"
    before = c["db"].query(ClassworkAssignment).count()

    invalid_schedule = c["client"].post(
        url,
        json={
            "class_ids": [c["allowed_class"].class_id],
            "publish_date": "2025-10-30T00:00:00",
            "due_date": "2025-10-29T00:00:00",
        },
    )
    invalid_attempts = c["client"].post(
        url,
        json={"class_ids": [c["allowed_class"].class_id], "max_attempts": 0},
    )

    assert invalid_schedule.status_code == 400
    assert invalid_attempts.status_code == 400
    assert c["db"].query(ClassworkAssignment).count() == before


def test_atomic_classwork_create_rolls_back_on_upload_failure(authz_context, monkeypatch):
    c = authz_context
    counts = {
        "classworks": c["db"].query(Classwork).count(),
        "assignments": c["db"].query(ClassworkAssignment).count(),
        "attachments": c["db"].query(ClassworkAttachment).count(),
    }

    async def fail_upload(file, folder):
        raise HTTPException(status_code=400, detail="Upload failed")

    monkeypatch.setattr(classwork_routes, "save_file", fail_upload)

    response = c["client"].post(
        "/api/v1/classwork-assignments/with-assignments",
        data={
            "title": "Atomic failure",
            "classwork_type": "ASSIGNMENT",
            "subject_id": str(c["subject"].subject_id),
            "total_points": "10",
            "is_published": "true",
            "class_ids": f"[{c['allowed_class'].class_id}]",
            "max_attempts": "1",
        },
        files=[("files", ("broken.pdf", b"%PDF", "application/pdf"))],
    )

    assert response.status_code == 400
    assert c["db"].query(Classwork).count() == counts["classworks"]
    assert c["db"].query(ClassworkAssignment).count() == counts["assignments"]
    assert c["db"].query(ClassworkAttachment).count() == counts["attachments"]


def test_atomic_classwork_create_persists_assignments_materials_and_lesson(authz_context, monkeypatch):
    c = authz_context
    lesson = Lesson(
        title="Linked lesson",
        content="Read this first",
        subject_id=c["subject"].subject_id,
        created_by_staff_id=c["owner"].staff_id,
        is_published=True,
        is_draft=False,
    )
    c["db"].add(lesson)
    c["db"].commit()

    async def fake_upload(file, folder):
        path = c["tmp_path"] / file.filename
        path.write_bytes(await file.read())
        return {
            "file_name": file.filename,
            "file_path": str(path),
            "file_type": file.content_type,
            "file_size": path.stat().st_size,
        }

    monkeypatch.setattr(classwork_routes, "save_file", fake_upload)

    response = c["client"].post(
        "/api/v1/classwork-assignments/with-assignments",
        data={
            "title": "Atomic success",
            "description": "One clean lifecycle",
            "classwork_type": "ASSIGNMENT",
            "subject_id": str(c["subject"].subject_id),
            "total_points": "10",
            "is_published": "true",
            "class_ids": f"[{c['allowed_class'].class_id}]",
            "lesson_ids": f"[{lesson.lesson_id}]",
            "due_date": "2025-10-31T00:00:00",
            "max_attempts": "2",
        },
        files=[("files", ("guide.pdf", b"%PDF", "application/pdf"))],
    )

    assert response.status_code == 200
    created = response.json()
    assert created["title"] == "Atomic success"
    assert len(created["assignments"]) == 1
    assert len(created["attachments"]) == 1
    assert c["db"].query(ClassworkLesson).filter_by(
        classwork_id=created["classwork_id"],
        lesson_id=lesson.lesson_id,
    ).count() == 1


def test_student_classwork_list_respects_publish_date_and_returns_attempt_lock_metadata(authz_context):
    c = authz_context
    c["assignment"].max_attempts = 3
    c["assignment"].lock_date = datetime.now(timezone.utc) + timedelta(days=1)
    c["db"].commit()

    _act_as(c, "student", "student")
    url = (
        f"/api/v1/classwork-assignments/class/{c['allowed_class'].class_id}"
        f"/subject/{c['subject'].subject_id}"
    )
    visible = c["client"].get(url)

    assert visible.status_code == 200
    assert visible.json()[0]["max_attempts"] == 3
    assert visible.json()[0]["is_locked"] is False

    c["assignment"].publish_date = datetime.now(timezone.utc) + timedelta(days=1)
    c["db"].commit()
    hidden = c["client"].get(url)

    assert hidden.status_code == 200
    assert hidden.json() == []


def test_archiving_classwork_with_turned_in_submissions_is_blocked(authz_context):
    c = authz_context

    response = c["client"].put(
        f"/api/v1/classwork-assignments/classwork/{c['classwork'].classwork_id}/archive"
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Classwork has turned-in submissions and cannot be archived"
    c["db"].refresh(c["classwork"])
    assert c["classwork"].is_archived is False


def test_unsubmitted_classwork_archive_preserves_lesson_link_and_hides_normal_lists(authz_context):
    c = authz_context
    lesson = Lesson(
        title="Linked Lesson",
        subject_id=c["subject"].subject_id,
        created_by_staff_id=c["owner"].staff_id,
        is_published=True,
        is_draft=False,
    )
    c["db"].add(lesson)
    c["db"].flush()
    c["db"].add(
        ClassworkLesson(
            classwork_id=c["classwork"].classwork_id,
            lesson_id=lesson.lesson_id,
        )
    )
    c["db"].commit()
    c["submission"].status = "pending"
    c["db"].commit()

    response = c["client"].put(
        f"/api/v1/classwork-assignments/classwork/{c['classwork'].classwork_id}/archive"
    )

    assert response.status_code == 200
    assert response.json()["is_archived"] is True
    c["db"].refresh(c["classwork"])
    c["db"].refresh(lesson)
    assert c["classwork"].is_archived is True
    assert lesson.is_archived is False
    assert c["db"].query(Classwork).filter_by(classwork_id=c["classwork"].classwork_id).count() == 1
    assert c["db"].query(ClassworkLesson).filter_by(
        classwork_id=c["classwork"].classwork_id,
        lesson_id=lesson.lesson_id,
    ).count() == 1

    assert c["client"].get("/api/v1/classwork-assignments/my-classworks").json() == []
    _act_as(c, "student", "student")
    student_list = c["client"].get(
        f"/api/v1/classwork-assignments/class/{c['allowed_class'].class_id}"
        f"/subject/{c['subject'].subject_id}"
    )
    assert student_list.status_code == 200
    assert student_list.json() == []


def test_delete_resubmit_preserves_attempt_count_and_cannot_bypass_limit(authz_context):
    c = authz_context
    c["assignment"].max_attempts = 1
    c["db"].commit()
    _act_as(c, "student", "student")

    url = f"/api/v1/submissions/assignment/{c['assignment'].classwork_assignment_id}/submit"

    cleared = c["client"].delete(url)
    resubmit = c["client"].post(
        url,
        files=[("files", ("answer2.pdf", b"%PDF", "application/pdf"))],
    )

    assert cleared.status_code == 200
    assert resubmit.status_code == 403
    assert resubmit.json()["detail"] == "Maximum attempts reached"
    c["db"].refresh(c["submission"])
    assert c["submission"].attempt_count == 1


def test_submission_upload_failure_rolls_back_attempt_count(authz_context, monkeypatch):
    c = authz_context
    c["assignment"].max_attempts = 2
    c["db"].commit()
    _act_as(c, "student", "student")

    async def fail_upload(file, folder):
        raise HTTPException(status_code=400, detail="Upload failed")

    monkeypatch.setattr(submission_routes, "save_file", fail_upload)
    before_attachments = len(c["submission"].attachments)
    response = c["client"].post(
        f"/api/v1/submissions/assignment/{c['assignment'].classwork_assignment_id}/submit",
        files=[("files", ("retry.pdf", b"%PDF", "application/pdf"))],
    )

    assert response.status_code == 400
    c["db"].refresh(c["submission"])
    assert c["submission"].attempt_count == 1
    assert len(c["submission"].attachments) == before_attachments


def test_submission_detail_and_grading_require_owner(authz_context):
    c = authz_context
    base = f"/api/v1/submissions/{c['submission'].submission_id}"

    assert c["client"].get(f"{base}/detail").status_code == 200
    assert c["client"].put(f"{base}/grade", json={"grade": 90}).status_code == 200
    _act_as(c, "other_teacher", "teacher")
    assert c["client"].get(f"{base}/detail").status_code == 403
    assert c["client"].put(f"{base}/grade", json={"grade": 80}).status_code == 403
    _act_as(c, "student", "student")
    assert c["client"].get(base).status_code == 200
    _act_as(c, "other_student", "student")
    assert c["client"].get(base).status_code == 403
    c["identity"].update(sub=str(uuid.uuid4()), role="admin")
    assert c["client"].get(base).status_code == 403
    assert c["client"].get(f"{base}/detail").status_code == 403
    assert c["client"].put(f"{base}/grade", json={"grade": 80}).status_code == 403


def test_attachment_downloads_are_scoped_and_debug_route_is_removed(authz_context):
    c = authz_context
    cw_url = (
        f"/api/v1/classwork-assignments/classwork/{c['classwork'].classwork_id}"
        f"/attachments/{c['classwork_attachment'].classwork_attachment_id}/download"
    )
    sub_url = (
        f"/api/v1/submissions/{c['submission'].submission_id}"
        f"/attachments/{c['submission_attachment'].submission_attachment_id}/download"
    )

    assert c["client"].get(cw_url, headers=_bearer(c, "student", "student")).status_code == 200
    assert c["client"].get(cw_url, headers=_bearer(c, "other_student", "student")).status_code == 403
    assert c["client"].get(sub_url, headers=_bearer(c, "owner", "teacher")).status_code == 200
    assert c["client"].get(sub_url, headers=_bearer(c, "other_teacher", "teacher")).status_code == 403
    assert c["client"].get(sub_url, headers=_bearer(c, "student", "student")).status_code == 200
    assert c["client"].get(sub_url, headers=_bearer(c, "other_student", "student")).status_code == 403
    assert c["client"].get(
        f"/api/v1/submissions/classwork/{c['classwork'].classwork_id}/debug"
    ).status_code == 404


def test_teacher_can_delete_owned_classwork_attachment(authz_context, monkeypatch):
    c = authz_context
    deleted_paths = []
    monkeypatch.setattr(classwork_routes, "delete_file", deleted_paths.append)

    response = c["client"].delete(
        f"/api/v1/classwork-assignments/classwork/{c['classwork'].classwork_id}"
        f"/attachments/{c['classwork_attachment'].classwork_attachment_id}"
    )

    assert response.status_code == 200
    assert deleted_paths == [c["classwork_attachment"].file_path]
    assert c["db"].query(ClassworkAttachment).filter_by(
        classwork_attachment_id=c["classwork_attachment"].classwork_attachment_id
    ).count() == 0
