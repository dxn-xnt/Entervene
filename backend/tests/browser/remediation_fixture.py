"""Disposable PostgreSQL fixture for the targeted remediation browser test.

The configured DATABASE_URL supplies only local PostgreSQL connection details.
All schema and fixture writes go to a newly named database, never that URL's
database. The CLI state file lives in the runner's temporary directory.
"""

from __future__ import annotations

import json
import os
import secrets
import subprocess
import sys
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session
from alembic.config import Config
from alembic.script import ScriptDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.core.Config import settings
from app.core.Security import hash_password
from app.models.academic.StudentCLass import StudentClass
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.classwork.ClassworkAttachment import ClassworkAttachment
from app.models.intervention.Intervention import Intervention
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Quiz import QuizBuilderUpsert, QuizSubmitRequest
from app.schemas.Submission import GradeRequest
from app.services.quiz import QuizAttemptService as attempts
from app.services.quiz.QuizBuilderService import upsert_quiz_builder
from app.services.submission.SubmissionService import grade_student_submission
from app.services.intervention.RemediationReadingPrerequisiteService import (
    ReadingPrerequisiteSnapshotItem,
    stage_remediation_reading_prerequisites,
)
from app.services.intervention.StudentPersistentInterventionService import get_active
from tests.test_development_current_term_model_4l import _register_corrected
from tests.test_natural_exam_intervention_postgres import _academic_scope, _assignment
from tests.test_study_support_snapshot_contract import (
    _create_reading,
    _create_remedial_classwork,
    _create_remedial_quiz,
)


PREFIX = "entervene_browser_remediation_"
BACKEND = Path(__file__).resolve().parents[2]
SOURCE = create_engine(settings.database_url).url

PROTECTED_DATABASES = {
    "entervendb",
    "entervene_pm_practice_demo",
    "entervene_db",
    "enterevene_db",
    "activity_db",
    "entervene_demo",
    "entervene_demo_disposable",
    "entervene_preview",
    "entervene_repost_smoke",
    "main",
    "entervene",
    "postgres",
    "schooldb",
    "school_db",
    "schooldb3",
}


def _active_development_databases() -> set[str]:
    """Dynamically resolve all database names configured in settings, environment, or backend/.env."""
    from sqlalchemy.engine import make_url
    dbs = set()
    if SOURCE.database:
        dbs.add(SOURCE.database.casefold())
    env_url = os.environ.get("DATABASE_URL")
    if env_url:
        try:
            parsed = make_url(env_url).database
            if parsed:
                dbs.add(parsed.casefold())
        except Exception:
            pass
    env_file = BACKEND / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("DATABASE_URL=") and not line.startswith("#"):
                val = line.split("=", 1)[1].strip().strip('"').strip("'")
                try:
                    parsed = make_url(val).database
                    if parsed:
                        dbs.add(parsed.casefold())
                except Exception:
                    pass
    return dbs


def _target(state: dict, is_destructive: bool = False):
    name = state.get("database", "")
    if not isinstance(name, str) or not name:
        raise ValueError("Invalid or missing database name in state")

    if (SOURCE.get_backend_name() != "postgresql" or SOURCE.host not in {"localhost", "127.0.0.1"}
            or not name.startswith(PREFIX) or name.casefold() in PROTECTED_DATABASES):
        raise ValueError(f"Refusing non-disposable or protected PostgreSQL target: '{name}'")

    if is_destructive:
        if not state.get("disposable"):
            raise ValueError(f"Refusing destructive operation: state lacks 'disposable: true' marker for '{name}'")
        if not state.get("test_run_id"):
            raise ValueError(f"Refusing destructive operation: state lacks 'test_run_id' verification for '{name}'")

        # Guard against accidentally targeting any database currently active in settings, process env, or backend/.env
        active_databases = _active_development_databases()
        if name.casefold() in active_databases and os.environ.get("ALLOW_DESTRUCTIVE_FIXTURE_ON_ACTIVE_DEV") != "true":
            raise RuntimeError(
                f"Refusing destructive fixture execution: target database '{name}' is currently "
                f"configured as the active backend database in settings/environment. "
                f"Destructive fixtures must run against independently provisioned databases, "
                f"not the active development server database. "
                f"Set ALLOW_DESTRUCTIVE_FIXTURE_ON_ACTIVE_DEV=true to override."
            )

    return SOURCE.set(database=name)


def _admin():
    if SOURCE.get_backend_name() != "postgresql" or SOURCE.host not in {"localhost", "127.0.0.1"}:
        raise ValueError("A local PostgreSQL source is required")
    return create_engine(SOURCE.set(database="postgres"), isolation_level="AUTOCOMMIT")


def _write_pdf(path: Path) -> None:
    """Write a tiny, structurally valid one-page PDF."""
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length 48 >>\nstream\nBT /F1 18 Tf 36 84 Td (Study Support PDF) Tj ET\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    content = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, body in enumerate(objects, start=1):
        offsets.append(len(content))
        content.extend(f"{index} 0 obj\n".encode())
        content.extend(body + b"\nendobj\n")
    xref = len(content)
    content.extend(f"xref\n0 {len(objects) + 1}\n".encode())
    content.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        content.extend(f"{offset:010d} 00000 n \n".encode())
    content.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    path.write_bytes(content)


def _write_docx(path: Path) -> None:
    """Write a minimal Office Open XML Word document consumable by Mammoth."""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>""")
        archive.writestr("_rels/.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>""")
        archive.writestr("word/document.xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
  <w:p><w:r><w:t>Study Support DOCX</w:t></w:r></w:p><w:sectPr/>
</w:body></w:document>""")


def _write_pptx(path: Path) -> None:
    """Write a minimal one-slide Office Open XML presentation."""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>""")
        archive.writestr("_rels/.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>""")
        archive.writestr("ppt/presentation.xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>""")
        archive.writestr("ppt/_rels/presentation.xml.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>""")
        archive.writestr("ppt/slides/slide1.xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>
  <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
  <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Study Support PPTX</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>""")


def _attach_documents(db: Session, directory: Path, readings: list[tuple]) -> list[int]:
    specs = [
        ("study-support.pdf", "application/pdf", _write_pdf),
        ("study-support.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", _write_docx),
        ("study-support.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", _write_pptx),
    ]
    attachment_ids = []
    for (classwork, _), (name, content_type, writer) in zip(readings, specs, strict=True):
        path = directory / name
        writer(path)
        if path.suffix == ".pdf":
            content = path.read_bytes()
            if not content.startswith(b"%PDF-") or not content.rstrip().endswith(b"%%EOF"):
                raise AssertionError("Generated PDF fixture is invalid")
        else:
            if not zipfile.is_zipfile(path):
                raise AssertionError(f"Generated Office fixture is invalid: {name}")
            with zipfile.ZipFile(path) as archive:
                if archive.testzip() is not None:
                    raise AssertionError(f"Generated Office fixture is corrupt: {name}")
        attachment = ClassworkAttachment(
            classwork_id=classwork.classwork_id,
            file_name=name,
            file_path=str(path.resolve()),
            file_type=content_type,
            file_size=path.stat().st_size,
        )
        db.add(attachment)
        db.flush()
        attachment_ids.append(attachment.classwork_attachment_id)
    return attachment_ids


def _drop(state: dict):
    url = _target(state, is_destructive=True)
    admin = _admin()
    try:
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{url.database}" WITH (FORCE)'))
    finally:
        admin.dispose()


def _snapshot(db: Session, remediation: ClassworkAssignment, readings: list[tuple]) -> None:
    stage_remediation_reading_prerequisites(
        db,
        remediation_assignment_id=remediation.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(
                reading_classwork_id=classwork.classwork_id,
                reading_assignment_id=assignment.classwork_assignment_id,
                display_order=index,
            )
            for index, (classwork, assignment) in enumerate(readings, start=1)
        ],
    )


def _seed_study_support(
    db: Session,
    *,
    directory: Path,
    intervention: Intervention,
    teacher,
    student: Student,
    class_,
    subject,
    period,
) -> dict:
    """Create deterministic Study Support records without production bypasses."""
    context = {
        "db": db,
        "owner": teacher,
        "student": student,
        "allowed_class": class_,
        "subject": subject,
        "period": period,
    }
    readings = [
        _create_reading(context, "Foundations Reading"),
        _create_reading(context, "Worked Examples Reading"),
        _create_reading(context, "Practice Strategies Reading"),
    ]
    locked_reading = _create_reading(context, "Unavailable Teacher Draft", is_locked=True)
    attachment_ids = _attach_documents(db, directory, readings)

    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "PRACTICE_ONLY",
        "selected_resources": [
            {"kind": "CLASSWORK", "id": classwork.classwork_id}
            for classwork, _ in readings
        ],
    }

    _, quiz_assignment, _ = _create_remedial_quiz(
        context,
        intervention,
        title="Deterministic Remedial Quiz",
    )
    _snapshot(db, quiz_assignment, readings)

    _, classwork_assignment = _create_remedial_classwork(
        context,
        intervention,
        title="Deterministic Remedial Classwork",
        instructions="Use the first two Supporting Readings to complete this practice.",
    )
    _snapshot(db, classwork_assignment, readings[:2])

    _, blocked_assignment = _create_remedial_classwork(
        context,
        intervention,
        title="Blocked Remedial Classwork",
    )
    _snapshot(db, blocked_assignment, [locked_reading])

    _, historical_assignment = _create_remedial_classwork(
        context,
        intervention,
        title="Historical Activity Without Snapshot",
    )
    db.commit()

    return {
        "reading_assignment_ids": [assignment.classwork_assignment_id for _, assignment in readings],
        "reading_classwork_ids": [classwork.classwork_id for classwork, _ in readings],
        "locked_reading_assignment_id": locked_reading[1].classwork_assignment_id,
        "quiz_assignment_id": quiz_assignment.classwork_assignment_id,
        "classwork_assignment_id": classwork_assignment.classwork_assignment_id,
        "blocked_assignment_id": blocked_assignment.classwork_assignment_id,
        "historical_assignment_id": historical_assignment.classwork_assignment_id,
        "attachment_ids": attachment_ids,
    }


def set_completion_state(state_path: Path, count: int) -> None:
    if count not in {0, 2, 3}:
        raise ValueError("Supported completion counts are 0, 2, and 3")
    state = json.loads(state_path.read_text(encoding="utf-8"))
    engine = create_engine(_target(state))
    try:
        with Session(engine) as db:
            reading_ids = state["reading_assignment_ids"]
            db.query(StudentSubmission).filter(
                StudentSubmission.student_id == UUID(state["target_student_id"]),
                StudentSubmission.classwork_assignment_id.in_(reading_ids),
            ).delete(synchronize_session=False)
            db.commit()
            student = db.get(Student, UUID(state["target_student_id"]))
            if student is None:
                raise AssertionError("Fixture student is missing")
            from app.services.submission.SubmissionService import complete_reading_assignment
            from app.models.intervention.InterventionReadingReview import InterventionReadingReview
            intervention_id = state.get("intervention_id")
            if intervention_id:
                db.query(InterventionReadingReview).filter_by(
                    intervention_id=intervention_id,
                    student_id=student.student_id,
                ).delete(synchronize_session=False)
            for assignment_id in reading_ids[:count]:
                complete_reading_assignment(assignment_id, student, db)
                if intervention_id:
                    db.add(InterventionReadingReview(
                        intervention_id=intervention_id,
                        student_id=student.student_id,
                        reading_assignment_id=assignment_id,
                        acknowledged_at=datetime.now(timezone.utc),
                    ))
            db.commit()
    finally:
        engine.dispose()
    print(f"Reading completion state set to {count}/3")


def prepare(state_path: Path):
    if state_path.exists():
        raise ValueError("Refusing to replace a browser fixture state file")
    state = {
        "database": PREFIX + uuid4().hex,
        "password": secrets.token_urlsafe(24),
        "teacher_email": "browser-teacher@example.com",
        "target_email": "browser-target@example.com",
        "control_email": "browser-control@example.com",
        "test_run_id": str(uuid4()),
        "disposable": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    url = _target(state)
    admin = _admin()
    try:
        with admin.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{url.database}"'))
    finally:
        admin.dispose()
    state_path.write_text(json.dumps(state), encoding="utf-8")
    try:
        target_db_url = url.render_as_string(hide_password=False)
        environment = dict(os.environ)
        environment["DATABASE_URL"] = target_db_url
        subprocess.run([sys.executable, "-m", "alembic", "-x", f"sqlalchemy.url={target_db_url}", "upgrade", "head"],
                       cwd=BACKEND, env=environment, check=True, capture_output=True, text=True)
        engine = create_engine(url)
        try:
            with engine.connect() as connection:
                state["migration_head"] = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            current_head = ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini"))).get_current_head()
            if state["migration_head"] != current_head:
                raise AssertionError(f"Unexpected migration head: {state['migration_head']}")
            if not inspect(engine).has_table("remediation_reading_prerequisite"):
                raise AssertionError("Reading prerequisite migration table missing")
            if "original_exam_assignment_id" not in {column["name"] for column in inspect(engine).get_columns("classwork_assignment")}:
                raise AssertionError("Remedial link column missing")
            settings.app_environment = "test"
            settings.development_prediction_api_enabled = True
            settings.development_current_term_model_name = "entervene_current_term_official_target_rf_candidate"
            with Session(engine) as db:
                teacher, target, class_, subject, period, _, lesson = _academic_scope(db)
                today = date.today()
                period.start_date = today - timedelta(days=30)
                period.end_date = today + timedelta(days=60)
                period.academic_year.start_date = today - timedelta(days=90)
                period.academic_year.end_date = today + timedelta(days=300)
                teacher.employment_status = "active"
                control = Student(student_id=uuid4(), student_lrn="300000000204", first_name="Control",
                                  last_name="Student", academic_level_id=target.academic_level_id)
                db.add(control)
                db.flush()
                db.add(StudentClass(student_id=control.student_id, class_id=class_.class_id,
                                    academic_year_id=class_.academic_year_id, enrollment_status="enrolled"))
                db.add_all([Role(role_id=2, role_name="Teacher"), Role(role_id=3, role_name="Student")])
                for person, role, email in ((teacher, 2, state["teacher_email"]),
                                            (target, 3, state["target_email"]),
                                            (control, 3, state["control_email"])):
                    account = UserAccount(email=email, password_hash=hash_password(state["password"]),
                                          account_status="active", email_status="verified")
                    db.add(account)
                    db.flush()
                    db.add(UserRoles(user_id=account.user_id, role_id=role))
                    person.user_id = account.user_id
                db.commit()
                for title, category, subtype, score in (
                    ("Written Work 1", "WRITTEN_WORK", None, 3),
                    ("Written Work 2", "WRITTEN_WORK", None, 4),
                    ("Performance Task 1", "PERFORMANCE_TASK", None, 3),
                    ("Performance Task 2", "PERFORMANCE_TASK", None, 4),
                    ("Summative 2", "QUARTERLY_ASSESSMENT", "SUMMATIVE_2", 4),
                    ("Term Exam", "QUARTERLY_ASSESSMENT", "TERM_EXAM", 3),
                ):
                    assignment = _assignment(db, title=title, category=category, subtype=subtype,
                                             teacher=teacher, class_=class_, subject=subject,
                                             period=period, activity_mode="MANUAL")
                    submission = StudentSubmission(student_id=target.student_id,
                        classwork_assignment_id=assignment.classwork_assignment_id,
                        status="submitted", submitted_at=datetime.now(timezone.utc))
                    db.add(submission)
                    db.commit()
                    grade_student_submission(submission.submission_id, GradeRequest(grade=score), teacher.staff_id, db)
                original = _assignment(db, title="Original Summative 1", category="QUARTERLY_ASSESSMENT",
                    subtype="SUMMATIVE_1", teacher=teacher, class_=class_, subject=subject,
                    period=period, activity_mode="ONLINE")
                db.add(ClassworkLesson(classwork_id=original.classwork_id, lesson_id=lesson.lesson_id))
                built = upsert_quiz_builder(db, original.classwork, QuizBuilderUpsert.model_validate({
                    "status": "READY", "settings": {"max_attempts": 1},
                    "questions": [{"question_text": "Which ratio is 2 to 1?", "question_type": "MULTIPLE_CHOICE",
                                   "points": 10, "display_order": 1, "lesson_id": lesson.lesson_id,
                                   "options": [{"option_text": "2:1", "is_correct": True, "option_order": 1},
                                               {"option_text": "1:2", "is_correct": False, "option_order": 2}]}]}))
                db.commit()
                try:
                    _register_corrected({"db": db})
                    wrong = next(option.option_id for option in built.questions[0].options if not option.is_correct)
                    attempts.start_student_quiz_attempt(db, target, original.classwork_assignment_id)
                    attempts.submit_student_quiz_attempt(db, target, original.classwork_assignment_id,
                        QuizSubmitRequest(answers=[{"quiz_question_id": built.questions[0].quiz_question_id,
                                                    "selected_option_id": wrong}]))
                except Exception:
                    pass
                prediction = db.query(DevelopmentCurrentTermPrediction).filter_by(
                    student_id=target.student_id,
                    class_id=class_.class_id,
                    subject_id=subject.subject_id,
                    source_period_id=period.academic_period_id,
                    target_period_id=period.academic_period_id,
                ).order_by(DevelopmentCurrentTermPrediction.revision.desc()).first()
                if prediction is None:
                    model = db.query(AIModelVersion).filter_by(model_name="entervene_current_term_official_target_rf_candidate").first()
                    if model is None:
                        model = AIModelVersion(
                            model_name="entervene_current_term_official_target_rf_candidate",
                            model_type="REGRESSOR",
                            model_purpose="CURRENT_TERM_FINAL_GRADE_PROJECTION",
                            algorithm="RandomForestRegressor",
                            target_column="target_final_period_grade",
                            lifecycle_status="DEVELOPMENT",
                            production_validated=False,
                            independent_three_term_validation=False,
                            is_active=False,
                            artifact_path="data/models/entervene_current_term_official_target_rf_candidate.joblib",
                            feature_schema_json={},
                            registry_metadata_json={
                                "supported_subjects": ["CREATIVE_TECHNOLOGY", "ENGLISH", "ICT", "MATHEMATICS", "SCIENCE"],
                                "supported_weight_patterns": ["20/50/30", "20/60/20"],
                                "period_semantics": "SOURCE_EQUALS_TARGET_SAME_TERM",
                            },
                        )
                        db.add(model)
                        db.flush()
                    prediction = DevelopmentCurrentTermPrediction(
                        student_id=target.student_id,
                        class_id=class_.class_id,
                        subject_id=subject.subject_id,
                        source_period_id=period.academic_period_id,
                        target_period_id=period.academic_period_id,
                        model_version_id=model.model_version_id,
                        revision=1,
                        predicted_period_grade=68.50,
                        intervention_level="HIGH_RISK",
                        intervention_basis="MODEL_PROJECTION",
                        evidence_snapshot={"reason": "Low summative performance"},
                    )
                    db.add(prediction)
                    db.flush()

                intervention = db.query(Intervention).filter_by(
                    student_id=target.student_id,
                    class_id=class_.class_id,
                    subject_id=subject.subject_id,
                    academic_period_id=period.academic_period_id,
                ).one_or_none()
                if intervention is None:
                    intervention = Intervention(
                        student_id=target.student_id,
                        class_id=class_.class_id,
                        subject_id=subject.subject_id,
                        academic_period_id=period.academic_period_id,
                        source_prediction_id=prediction.prediction_id,
                        status="ACTIVE",
                        diagnosis_snapshot=prediction.evidence_snapshot,
                        remediation_plan=None,
                        activated_at=datetime.now(timezone.utc),
                        activated_by_staff_id=teacher.staff_id,
                    )
                    db.add(intervention)
                else:
                    intervention.status = "ACTIVE"
                    intervention.activated_at = datetime.now(timezone.utc)
                    intervention.activated_by_staff_id = teacher.staff_id
                db.flush()

                study_support = _seed_study_support(
                    db,
                    directory=state_path.parent,
                    intervention=intervention,
                    teacher=teacher,
                    student=target,
                    class_=class_,
                    subject=subject,
                    period=period,
                )
                state.update(intervention_id=intervention.intervention_id,
                             original_assignment_id=original.classwork_assignment_id,
                             target_student_id=str(target.student_id), control_student_id=str(control.student_id),
                             **study_support)
                state_path.write_text(json.dumps(state), encoding="utf-8")
        finally:
            engine.dispose()
    except BaseException:
        _drop(state)
        state_path.unlink(missing_ok=True)
        raise
    print("Disposable migrated browser fixture ready")


def inspect_remediation(state_path: Path):
    state = json.loads(state_path.read_text(encoding="utf-8"))
    engine = create_engine(_target(state))
    try:
        with Session(engine) as db:
            assignments = db.query(ClassworkAssignment).filter_by(
                source_intervention_id=state["intervention_id"],
                classwork_assignment_id=state["quiz_assignment_id"],
            ).all()
            result = []
            for assignment in assignments:
                result.append({"assignment_id": assignment.classwork_assignment_id,
                               "recipient_student_id": str(assignment.recipient_student_id),
                               "published": bool(assignment.is_published and assignment.classwork.is_published),
                               "submission_count": db.query(StudentSubmission).filter_by(
                                   classwork_assignment_id=assignment.classwork_assignment_id).count()})
            support = get_active(
                db,
                UUID(state["target_student_id"]),
                state["intervention_id"],
            ).model_dump(mode="json")
            print(json.dumps({"database": db.execute(text("SELECT current_database()")).scalar_one(),
                              "migration_head": db.execute(text("SELECT version_num FROM alembic_version")).scalar_one(),
                              "prerequisite_table": inspect(engine).has_table("remediation_reading_prerequisite"),
                              "assignments": result,
                              "study_support": support}))
    finally:
        engine.dispose()


def count_reading_reviews(state_path: Path):
    state = json.loads(state_path.read_text(encoding="utf-8"))
    engine = create_engine(_target(state))
    try:
        with Session(engine) as db:
            from app.models.intervention.InterventionReadingReview import InterventionReadingReview
            count = db.query(InterventionReadingReview).filter_by(
                intervention_id=state["intervention_id"],
                student_id=UUID(state["target_student_id"]),
            ).count()
            print(json.dumps({"reading_reviews_count": count}))
    finally:
        engine.dispose()


def seed_20_practice_questions(state_path: Path, allow_overwrite: bool = False):
    state = json.loads(state_path.read_text(encoding="utf-8"))
    target_url = _target(state, is_destructive=True)
    engine = create_engine(target_url)
    try:
        with Session(engine) as db:
            from decimal import Decimal
            from app.models.intervention.PracticeAssessment import PracticeAssessment
            from app.models.intervention.PracticeQuestion import PracticeQuestion
            from app.models.intervention.PracticeQuestionOption import PracticeQuestionOption
            from app.models.intervention.PracticeAttempt import PracticeAttempt
            from app.models.intervention.PracticeAttemptAnswer import PracticeAttemptAnswer

            intervention_id = state["intervention_id"]
            assessment = db.query(PracticeAssessment).filter_by(intervention_id=intervention_id).first()
            if not assessment:
                assessment = PracticeAssessment(
                    intervention_id=intervention_id,
                    title="Comprehensive Practice Assessment (20 Questions)",
                    status="PUBLISHED",
                    gatekeeper_policy="REQUIRE_PASS",
                    passing_percentage=Decimal("75.00"),
                    version=1,
                )
                db.add(assessment)
                db.flush()
            else:
                existing_questions_count = db.query(PracticeQuestion).filter_by(
                    practice_assessment_id=assessment.practice_assessment_id
                ).count()
                existing_attempts_count = db.query(PracticeAttempt).filter_by(
                    practice_assessment_id=assessment.practice_assessment_id
                ).count()

                env_allow_overwrite = os.environ.get("ALLOW_FIXTURE_QUESTION_OVERWRITE") == "true"
                if (existing_questions_count > 0 or existing_attempts_count > 0) and not (allow_overwrite or env_allow_overwrite):
                    raise RuntimeError(
                        f"Refusing to overwrite existing Practice Assessment on intervention {intervention_id}. "
                        f"Found {existing_questions_count} existing questions and {existing_attempts_count} existing attempts. "
                        f"To prevent silent question replacement, destructive overwrites require explicit authorization "
                        f"(ALLOW_FIXTURE_QUESTION_OVERWRITE=true or --overwrite)."
                    )

                assessment.status = "PUBLISHED"
                assessment.title = "Comprehensive Practice Assessment (20 Questions)"
                assessment.passing_percentage = Decimal("75.00")
                assessment.gatekeeper_policy = "REQUIRE_PASS"
                attempts = db.query(PracticeAttempt).filter_by(practice_assessment_id=assessment.practice_assessment_id).all()
                for a in attempts:
                    db.query(PracticeAttemptAnswer).filter_by(attempt_id=a.attempt_id).delete()
                    db.delete(a)
                questions = db.query(PracticeQuestion).filter_by(practice_assessment_id=assessment.practice_assessment_id).all()
                for q in questions:
                    db.query(PracticeQuestionOption).filter_by(practice_question_id=q.practice_question_id).delete()
                    db.delete(q)
                db.flush()

            for i in range(1, 21):
                if i <= 14:
                    q = PracticeQuestion(
                        practice_assessment_id=assessment.practice_assessment_id,
                        question_text=f"Question {i}: What is the solution to problem {i}?",
                        question_type="MULTIPLE_CHOICE",
                        points=Decimal("1.00"),
                        display_order=i,
                        explanation=f"Explanation for question {i}.",
                    )
                    db.add(q)
                    db.flush()
                    for opt_idx, letter in enumerate(["A", "B", "C", "D"], start=1):
                        db.add(PracticeQuestionOption(
                            practice_question_id=q.practice_question_id,
                            option_text=f"Option {letter} for Q{i}",
                            is_correct=(opt_idx == 1),
                            option_order=opt_idx,
                        ))
                elif i <= 18:
                    q = PracticeQuestion(
                        practice_assessment_id=assessment.practice_assessment_id,
                        question_text=f"Question {i}: Statement {i} is scientifically accurate.",
                        question_type="TRUE_FALSE",
                        points=Decimal("1.00"),
                        display_order=i,
                        explanation=f"Explanation for question {i}.",
                    )
                    db.add(q)
                    db.flush()
                    db.add(PracticeQuestionOption(
                        practice_question_id=q.practice_question_id,
                        option_text="True",
                        is_correct=True,
                        option_order=1,
                    ))
                    db.add(PracticeQuestionOption(
                        practice_question_id=q.practice_question_id,
                        option_text="False",
                        is_correct=False,
                        option_order=2,
                    ))
                else:
                    q = PracticeQuestion(
                        practice_assessment_id=assessment.practice_assessment_id,
                        question_text=f"Question {i}: Identify the primary term for concept {i}.",
                        question_type="IDENTIFICATION",
                        points=Decimal("1.00"),
                        display_order=i,
                        explanation=f"Explanation for question {i}.",
                    )
                    db.add(q)
                    db.flush()
                    db.add(PracticeQuestionOption(
                        practice_question_id=q.practice_question_id,
                        option_text=f"Answer{i}",
                        is_correct=True,
                        option_order=1,
                    ))
            db.commit()
            print(json.dumps({"seeded_practice_questions": 20, "assessment_id": assessment.practice_assessment_id}))
    finally:
        engine.dispose()


def inspect_practice_attempt(state_path: Path):
    state = json.loads(state_path.read_text(encoding="utf-8"))
    engine = create_engine(_target(state))
    try:
        with Session(engine) as db:
            from app.models.intervention.PracticeAssessment import PracticeAssessment
            from app.models.intervention.PracticeAttempt import PracticeAttempt

            intervention_id = state["intervention_id"]
            assessment = db.query(PracticeAssessment).filter_by(intervention_id=intervention_id).first()
            if not assessment:
                print(json.dumps({"error": "no assessment"}))
                return
            attempts = (
                db.query(PracticeAttempt)
                .filter_by(practice_assessment_id=assessment.practice_assessment_id)
                .order_by(PracticeAttempt.attempt_number.desc())
                .all()
            )
            data = []
            for a in attempts:
                data.append({
                    "attempt_id": a.attempt_id,
                    "attempt_number": a.attempt_number,
                    "status": a.status,
                    "total_score": float(a.total_score),
                    "score_percentage": float(a.score_percentage),
                    "is_passed": a.is_passed,
                    "completed_at": a.completed_at.isoformat() if a.completed_at else None,
                    "draft_answers": (a.attempt_snapshot or {}).get("draft_answers", []),
                })
            print(json.dumps({"attempts_count": len(attempts), "attempts": data}))
    finally:
        engine.dispose()


def cleanup(state_path: Path):
    if state_path.exists():
        _drop(json.loads(state_path.read_text(encoding="utf-8")))
        state_path.unlink()
    print("Disposable browser database removed")


if __name__ == "__main__":
    action = sys.argv[1]
    file_name = sys.argv[2]
    extra_flags = set(sys.argv[3:])
    allow_overwrite = "--overwrite" in extra_flags or "--force" in extra_flags

    actions = {
        "prepare": prepare,
        "inspect": inspect_remediation,
        "cleanup": cleanup,
        "count_reading_reviews": count_reading_reviews,
        "seed_20_practice_questions": lambda path: seed_20_practice_questions(path, allow_overwrite=allow_overwrite),
        "inspect_practice_attempt": inspect_practice_attempt,
        "zero": lambda path: set_completion_state(path, 0),
        "partial": lambda path: set_completion_state(path, 2),
        "complete": lambda path: set_completion_state(path, 3),
        "url": lambda path: print(_target(json.loads(path.read_text(encoding="utf-8"))).render_as_string(hide_password=False)),
    }
    actions[action](Path(file_name))
