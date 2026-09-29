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
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session
from alembic.config import Config
from alembic.script import ScriptDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.core.Config import settings
from app.core.Security import hash_password
from app.models.academic.StudentCLass import StudentClass
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.intervention.Intervention import Intervention
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Quiz import QuizBuilderUpsert, QuizSubmitRequest
from app.schemas.Submission import GradeRequest
from app.services.quiz import QuizAttemptService as attempts
from app.services.quiz.QuizBuilderService import upsert_quiz_builder
from app.services.submission.SubmissionService import grade_student_submission
from tests.test_development_current_term_model_4l import _register_corrected
from tests.test_natural_exam_intervention_postgres import _academic_scope, _assignment


PREFIX = "entervene_browser_remediation_"
BACKEND = Path(__file__).resolve().parents[2]
SOURCE = create_engine(settings.database_url).url


def _target(state: dict):
    name = state["database"]
    if (SOURCE.get_backend_name() != "postgresql" or SOURCE.host not in {"localhost", "127.0.0.1"}
            or not name.startswith(PREFIX) or name.casefold() in {"entervene_demo", "main", "entervene"}):
        raise ValueError("Refusing non-disposable PostgreSQL target")
    return SOURCE.set(database=name)


def _admin():
    if SOURCE.get_backend_name() != "postgresql" or SOURCE.host not in {"localhost", "127.0.0.1"}:
        raise ValueError("A local PostgreSQL source is required")
    return create_engine(SOURCE.set(database="postgres"), isolation_level="AUTOCOMMIT")


def _drop(state: dict):
    url = _target(state)
    admin = _admin()
    try:
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{url.database}" WITH (FORCE)'))
    finally:
        admin.dispose()


def prepare(state_path: Path):
    if state_path.exists():
        raise ValueError("Refusing to replace a browser fixture state file")
    state = {"database": PREFIX + uuid4().hex,
             "password": secrets.token_urlsafe(24),
             "teacher_email": "browser-teacher@example.com",
             "target_email": "browser-target@example.com",
             "control_email": "browser-control@example.com"}
    url = _target(state)
    admin = _admin()
    try:
        with admin.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{url.database}"'))
    finally:
        admin.dispose()
    state_path.write_text(json.dumps(state), encoding="utf-8")
    try:
        environment = dict(os.environ)
        environment["DATABASE_URL"] = url.render_as_string(hide_password=False)
        subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"],
                       cwd=BACKEND, env=environment, check=True, capture_output=True, text=True)
        engine = create_engine(url)
        try:
            with engine.connect() as connection:
                state["migration_head"] = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            current_head = ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini"))).get_current_head()
            if state["migration_head"] != current_head:
                raise AssertionError(f"Unexpected migration head: {state['migration_head']}")
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
                _register_corrected({"db": db})
                wrong = next(option.option_id for option in built.questions[0].options if not option.is_correct)
                attempts.start_student_quiz_attempt(db, target, original.classwork_assignment_id)
                attempts.submit_student_quiz_attempt(db, target, original.classwork_assignment_id,
                    QuizSubmitRequest(answers=[{"quiz_question_id": built.questions[0].quiz_question_id,
                                                "selected_option_id": wrong}]))
                candidate = db.query(Intervention).one()
                prediction = db.get(DevelopmentCurrentTermPrediction, candidate.source_prediction_id)
                if candidate.status != "CANDIDATE" or prediction.evidence_snapshot["projected_final_term_grade_raw"] >= 85:
                    raise AssertionError("Natural below-85 Intervention candidate was not created")
                state.update(intervention_id=candidate.intervention_id,
                             original_assignment_id=original.classwork_assignment_id,
                             target_student_id=str(target.student_id), control_student_id=str(control.student_id))
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
                original_exam_assignment_id=state["original_assignment_id"],
            ).all()
            result = []
            for assignment in assignments:
                result.append({"assignment_id": assignment.classwork_assignment_id,
                               "recipient_student_id": str(assignment.recipient_student_id),
                               "published": bool(assignment.is_published and assignment.classwork.is_published),
                               "submission_count": db.query(StudentSubmission).filter_by(
                                   classwork_assignment_id=assignment.classwork_assignment_id).count()})
            print(json.dumps({"database": db.execute(text("SELECT current_database()")).scalar_one(),
                              "assignments": result}))
    finally:
        engine.dispose()


def cleanup(state_path: Path):
    if state_path.exists():
        _drop(json.loads(state_path.read_text(encoding="utf-8")))
        state_path.unlink()
    print("Disposable browser database removed")


if __name__ == "__main__":
    action, file_name = sys.argv[1:]
    actions = {"prepare": prepare, "inspect": inspect_remediation, "cleanup": cleanup,
               "url": lambda path: print(_target(json.loads(path.read_text(encoding="utf-8"))).render_as_string(hide_password=False))}
    actions[action](Path(file_name))
