"""Create, migrate, seed, and validate the isolated Entervene_Demo database."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from hashlib import sha256
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, func, inspect, select, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.orm import Session

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(os.getenv("ENV_FILE", BACKEND_DIR / ".env.demo"))

DEMO_DATABASE = "Entervene_Demo"
ACCEPTANCE_DATABASE = "Entervene_Demo_4M"
FINAL_ACCEPTANCE_DATABASE = "Entervene_Demo_4N"
RETRY_ACCEPTANCE_DATABASE = "Entervene_Demo_4N2"
ACCEPTANCE_DATABASES = frozenset({ACCEPTANCE_DATABASE.casefold(), FINAL_ACCEPTANCE_DATABASE.casefold(), RETRY_ACCEPTANCE_DATABASE.casefold()})
ADMIN_EMAIL = "demo-admin@example.com"
ADMIN_PASSWORD = "DemoAdmin!2026"
TEACHER_EMAIL = "demo-teacher@example.com"
TEACHER_PASSWORD = "DemoTeacher!2026"
SUMMARY_PATH = BACKEND_DIR / ".demo-fixtures" / "current-term-demo-summary.json"
NAMESPACE = uuid.UUID("85f54867-5180-462c-85bc-8a82beec53e8")


def require_demo_database(database_url: str) -> URL:
    url = make_url(database_url)
    if url.drivername.split("+")[0] != "postgresql":
        raise ValueError("The current-term demo requires PostgreSQL.")
    if url.host not in {"localhost", "127.0.0.1"} or (url.database or "").casefold() not in {DEMO_DATABASE.casefold(), *ACCEPTANCE_DATABASES}:
        raise ValueError("Refusing to target a non-local or non-demo database.")
    return url


def summary_path(database_url: str) -> Path:
    database = require_demo_database(database_url).database
    if database.casefold() == DEMO_DATABASE.casefold():
        return SUMMARY_PATH
    suffix = database.casefold().removeprefix("entervene_demo_")
    return SUMMARY_PATH.with_name(f"current-term-demo-{suffix}-summary.json")


def recreate_database(database_url: str) -> None:
    url = require_demo_database(database_url)
    database_name = url.database
    admin_url = url.set(database="postgres")
    engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            if database_name.casefold() in ACCEPTANCE_DATABASES:
                exists = connection.execute(text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": database_name}).scalar()
                if exists:
                    raise ValueError("Refusing to replace an existing acceptance database.")
            connection.execute(text(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = :name AND pid <> pg_backend_pid()"
            ), {"name": database_name})
            if database_name.casefold() not in ACCEPTANCE_DATABASES:
                connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{database_name}"')
            connection.exec_driver_sql(f'CREATE DATABASE "{database_name}"')
    finally:
        engine.dispose()


def migrate(database_url: str) -> None:
    require_demo_database(database_url)
    environment = dict(os.environ)
    environment["DATABASE_URL"] = database_url
    environment["APP_ENVIRONMENT"] = "development"
    environment["DEVELOPMENT_PREDICTION_API_ENABLED"] = "true"
    engine = create_engine(database_url)
    try:
        empty_database = "user_account" not in inspect(engine).get_table_names()
        if empty_database:
            from app.db.Base import Base
            import app.models  # noqa: F401

            Base.metadata.create_all(engine)
    finally:
        engine.dispose()
    command = "stamp" if empty_database else "upgrade"
    subprocess.run(
        [sys.executable, "-m", "alembic", command, "head"],
        cwd=BACKEND_DIR,
        env=environment,
        check=True,
    )


def write_demo_environment(database_url: str) -> None:
    url = require_demo_database(database_url)
    if url.database.casefold() in ACCEPTANCE_DATABASES:
        raise ValueError("Acceptance setup must keep existing demo environment files unchanged.")
    rendered_url = url.render_as_string(hide_password=False)
    (BACKEND_DIR / ".env.demo").write_text(
        "APP_ENVIRONMENT=development\n"
        "DEVELOPMENT_PREDICTION_API_ENABLED=true\n"
        "DEVELOPMENT_CURRENT_TERM_MODEL_NAME=entervene_current_term_official_target_rf_candidate\n"
        f"DATABASE_URL={rendered_url}\n"
        "SECRET_KEY=entervene-demo-only-secret-key-2026-local\n"
        "FRONTEND_URL=http://localhost:5173\n"
        "COOKIE_SECURE=false\n"
        "COOKIE_SAMESITE=lax\n",
        encoding="utf-8",
    )
    (PROJECT_DIR / "frontend" / ".env.demo").write_text(
        "VITE_API_URL=http://localhost:8001\n"
        "VITE_ENABLE_DEVELOPMENT_PREDICTIONS=true\n",
        encoding="utf-8",
    )


def _uuid(label: str) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, label)


def _utc(day: int, hour: int = 9) -> datetime:
    return datetime(2026, 9, 1, hour, tzinfo=timezone.utc) + timedelta(days=day)


PROFILES = [
    ("Avery", "Excellent", 0.97, "very strong"),
    ("Blake", "Capable", 0.92, "strong"),
    ("Casey", "Steady", 0.87, "strong"),
    ("Drew", "Balanced", 0.82, "average"),
    ("Emery", "Growing", 0.77, "developing"),
    ("Finley", "Practice", 0.69, "struggling"),
    ("Gray", "Focused", 0.89, "strong"),
    ("Harper", "Improving", 0.79, "developing"),
    ("Indigo", "Prepared", 0.94, "very strong"),
    ("Jordan", "Starting", 0.72, "insufficient evidence"),
]

ACTIVITIES = [
    ("WW 1 - Number Sense", "ASSIGNMENT", "WRITTEN_WORK", None, 20, 2),
    ("WW 2 - Integer Operations", "QUIZ", "WRITTEN_WORK", None, 20, 5),
    ("WW 3 - Rational Numbers", "ASSIGNMENT", "WRITTEN_WORK", None, 20, 8),
    ("WW 4 - Algebraic Expressions", "QUIZ", "WRITTEN_WORK", None, 20, 11),
    ("PT 1 - Budget Mathematics", "ACTIVITY", "PERFORMANCE_TASK", None, 40, 4),
    ("PT 2 - Equation Modeling", "ACTIVITY", "PERFORMANCE_TASK", None, 40, 10),
    ("PT 3 - Data Investigation", "ACTIVITY", "PERFORMANCE_TASK", None, 40, 16),
    ("Summative Test 1", "EXAM", "EXAMS", "SUMMATIVE_1", 30, 7),
    ("Summative Test 2", "EXAM", "EXAMS", "SUMMATIVE_2", 30, 14),
    ("Term Examination", "EXAM", "EXAMS", "TERM_EXAM", 40, 28),
]


def _register_v3(session: Session) -> int:
    from app.models.ai.AIModelVersion import AIModelVersion
    from app.services.prediction import DevelopmentCurrentTermScoringService as scorer

    schema = scorer.load_development_current_term_schema()
    digest = sha256(json.dumps(schema, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    artifact_digest = sha256(scorer.MODEL_PATH.read_bytes()).hexdigest()
    model = AIModelVersion(
        model_name=scorer.MODEL_NAME,
        model_type="REGRESSOR",
        model_purpose="CURRENT_TERM_FINAL_GRADE_PROJECTION",
        algorithm="RandomForestRegressor",
        target_column="target_final_period_grade",
        lifecycle_status="DEVELOPMENT",
        production_validated=False,
        independent_three_term_validation=False,
        is_active=False,
        artifact_path="data/models/entervene_current_term_development_rf_v3.joblib",
        feature_schema_json=schema,
        registry_metadata_json={
            "supported_subjects": ["CREATIVE_TECHNOLOGY", "ENGLISH", "ICT", "MATHEMATICS", "SCIENCE"],
            "supported_weight_patterns": ["20/50/30", "20/60/20"],
            "period_semantics": "SOURCE_EQUALS_TARGET_SAME_TERM",
            "feature_schema_sha256": digest,
            "feature_schema_version": f"sha256:{digest}",
            "artifact_sha256": artifact_digest,
            "training_dataset_version": "demo-uses-registered-v3-artifact",
        },
    )
    session.add(model)
    session.flush()
    return model.model_version_id


def seed(database_url: str) -> dict:
    require_demo_database(database_url)
    from app.core.Security import hash_password
    from app.models.academic.AcademicLevel import AcademicLevel
    from app.models.academic.AcademicPeriod import AcademicPeriod
    from app.models.academic.AcademicYear import AcademicYear
    from app.models.academic.Class_ import Class
    from app.models.academic.GradingTemplate import GradingTemplate
    from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
    from app.models.academic.StudentCLass import StudentClass
    from app.models.academic.Subject import Subject
    from app.models.academic.SubjectLoad import SubjectLoad
    from app.models.attendance.Attendance import AttendanceRecord
    from app.models.auth.Role import Role
    from app.models.auth.UserAccount import UserAccount
    from app.models.auth.UserRoles import UserRoles
    from app.models.classwork.Classwork import Classwork
    from app.models.classwork.ClassworkAssignment import ClassworkAssignment
    from app.models.people.AcademicStaff import AcademicStaff
    from app.models.people.Student import Student
    from app.models.submissions.StudentSubmission import StudentSubmission

    engine = create_engine(database_url, pool_pre_ping=True)
    with Session(engine) as session:
        if session.scalar(select(UserAccount).where(UserAccount.email == ADMIN_EMAIL)) is not None:
            from app.services.prediction.RegisterCorrectedCurrentTermModel import register_corrected_development_model
            from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
            from app.services.prediction.DevelopmentCurrentTermPredictionPersistenceService import generate_and_persist_development_current_term
            corrected_id = register_corrected_development_model(session)[0].model_version_id
            legacy_scopes = {
                (row.student_id, row.class_id, row.subject_id, row.source_period_id)
                for row in session.query(DevelopmentCurrentTermPrediction).filter(
                    DevelopmentCurrentTermPrediction.model_version_id != corrected_id,
                ).all()
            }
            session.commit()
            session.close()
            results = [
                generate_and_persist_development_current_term(
                    *scope, model_version_id=corrected_id, bind=engine,
                )
                for scope in sorted(legacy_scopes, key=lambda scope: tuple(map(str, scope)))
            ]
            summary = read_summary(database_url)
            summary["selected_model_name"] = "entervene_current_term_official_target_rf_candidate"
            summary["corrected_model_version_id"] = corrected_id
            with Session(engine) as count_session:
                summary["corrected_prediction_count"] = count_session.scalar(
                    select(func.count(func.distinct(DevelopmentCurrentTermPrediction.student_id))).where(
                        DevelopmentCurrentTermPrediction.model_version_id == corrected_id
                    )
                )
            summary_path(database_url).write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
            engine.dispose()
            return summary

        roles = [Role(role_id=1, role_name="Admin"), Role(role_id=2, role_name="Teacher"), Role(role_id=3, role_name="Student")]
        admin = UserAccount(user_id=_uuid("admin"), email=ADMIN_EMAIL, password_hash=hash_password(ADMIN_PASSWORD), account_status="active", email_status="verified")
        teacher_account = UserAccount(user_id=_uuid("teacher"), email=TEACHER_EMAIL, password_hash=hash_password(TEACHER_PASSWORD), account_status="active", email_status="verified")
        teacher = AcademicStaff(staff_id="DEMO-T-001", first_name="Mara", last_name="Santos", email=TEACHER_EMAIL, employment_status="active", user_id=teacher_account.user_id)
        session.add_all(roles + [admin, teacher_account, teacher])
        session.flush()
        session.add_all([UserRoles(user_id=admin.user_id, role_id=1), UserRoles(user_id=teacher_account.user_id, role_id=2)])

        year = AcademicYear(year_label="2026-2027 DEMO", start_date=date(2026, 6, 1), end_date=date(2027, 3, 31), is_active=True)
        level = AcademicLevel(level_name="Grade 9 Demo", grade_level=9)
        session.add_all([year, level])
        session.flush()
        period = AcademicPeriod(period_name="Term 1 Demo", period_type="TERM", period_sequence=1, total_periods_in_year=3, period_progress_ratio=Decimal("0.3333"), start_date=date(2026, 9, 1), end_date=date(2026, 11, 30), is_active=True, academic_year_id=year.academic_year_id)
        class_ = Class(section_name="Demo Archimedes", class_status="active", adviser_staff_id=teacher.staff_id, academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
        subject = Subject(subject_name="Mathematics", subject_codename="MATHEMATICS", academic_level_id=level.academic_level_id, is_math_or_science=True, is_core=True, status="active")
        session.add_all([period, class_, subject])
        session.flush()
        class_.academic_period_id = period.academic_period_id
        template = GradingTemplate(template_name="Demo Mathematics 20-50-30", academic_level_id=level.academic_level_id, subject_id=subject.subject_id, status="active")
        session.add(template)
        session.flush()
        session.add_all([
            GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Written Works", weight=Decimal("20"), display_order=1),
            GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Performance Tasks", weight=Decimal("50"), display_order=2),
            GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Examination", weight=Decimal("30"), display_order=3),
        ])
        subject.default_grading_template = str(template.grading_template_id)
        session.add(SubjectLoad(staff_id=teacher.staff_id, subject_id=subject.subject_id, class_id=class_.class_id, academic_period_id=period.academic_period_id, status="published", is_active_version=True, is_locked=True, published_at=_utc(0)))

        students = []
        for index, (first, last, rate, profile) in enumerate(PROFILES, start=1):
            student = Student(student_id=_uuid(f"student-{index}"), student_lrn=f"99000000{index:04d}", first_name=f"Demo {first}", last_name=last, academic_level_id=level.academic_level_id, prior_gwa=Decimal(str(round(70 + rate * 25, 2))))
            students.append((student, rate, profile))
            session.add(student)
            session.flush()
            session.add(StudentClass(student_id=student.student_id, class_id=class_.class_id, academic_year_id=year.academic_year_id, enrollment_status="enrolled"))

        assignments = []
        for title, kind, category, subtype, points, day in ACTIVITIES:
            work = Classwork(title=f"DEMO - {title}", description="Controlled V3 demonstration evidence.", instructions="Demo database only.", classwork_type=kind, classwork_category=category, exam_subtype=subtype, activity_mode="MANUAL", is_graded=True, total_points=Decimal(points), is_locked=False, is_published=True, show_scores=True, is_archived=False, subject_id=subject.subject_id, created_by_staff_id=teacher.staff_id)
            session.add(work)
            session.flush()
            assignment = ClassworkAssignment(classwork_id=work.classwork_id, class_id=class_.class_id, academic_period_id=period.academic_period_id, assigned_by_staff_id=teacher.staff_id, publish_date=_utc(day - 2), due_date=_utc(day), lock_date=_utc(day + 7), is_published=True, is_locked=False, allow_late_submissions=True, max_attempts=2)
            session.add(assignment)
            session.flush()
            assignments.append(assignment)

        for index, (student, rate, profile) in enumerate(students):
            for day in range(15):
                status = "present"
                if profile in {"developing", "struggling"} and day in {3, 11}:
                    status = "absent"
                elif (index + day) % 7 == 0:
                    status = "late"
                session.add(AttendanceRecord(student_id=student.student_id, class_id=class_.class_id, subject_id=subject.subject_id, date=date(2026, 9, 1) + timedelta(days=day), status=status, remarks="Controlled demo attendance", recorded_by_staff_id=teacher.staff_id))

            if profile == "insufficient evidence":
                submission_indexes = [0, 1, 4]
            else:
                submission_indexes = [0, 1, 2, 3, 4, 5, 7, 8, 9]
            for activity_index in submission_indexes:
                assignment = assignments[activity_index]
                points = Decimal(ACTIVITIES[activity_index][4])
                awaiting = profile == "insufficient evidence" and activity_index != 0
                term_exam = activity_index == 9
                is_late = (index + activity_index) % 5 == 0 and not awaiting
                score_rate = max(Decimal("0"), min(Decimal("1"), Decimal(str(rate)) + Decimal(str(((activity_index % 3) - 1) * 0.02))))
                score = None if awaiting or term_exam else (points * score_rate).quantize(Decimal("0.01"))
                status = "submitted" if score is None else ("late" if is_late else "graded")
                session.add(StudentSubmission(student_id=student.student_id, classwork_assignment_id=assignment.classwork_assignment_id, submitted_at=_utc(ACTIVITIES[activity_index][5], 13 if is_late else 8), status=status, grade=score, attempt_count=1, graded_at=_utc(ACTIVITIES[activity_index][5] + 1) if score is not None else None, graded_by_staff_id=teacher.staff_id if score is not None else None))

        _register_v3(session)
        from app.services.prediction.RegisterCorrectedCurrentTermModel import register_corrected_development_model
        model_version_id = register_corrected_development_model(session)[0].model_version_id
        session.commit()
        scope = {"class_id": class_.class_id, "subject_id": subject.subject_id, "academic_period_id": period.academic_period_id}
        student_records = [(student.student_id, student.first_name + " " + student.last_name, profile) for student, _, profile in students]
        pt3_assignment_id = assignments[6].classwork_assignment_id

    from app.services.prediction.DevelopmentCurrentTermPredictionPersistenceService import generate_and_persist_development_current_term

    revision_student_id = student_records[0][0]
    results = []
    first = generate_and_persist_development_current_term(revision_student_id, scope["class_id"], scope["subject_id"], scope["academic_period_id"], model_version_id=model_version_id, bind=engine)

    with Session(engine) as session:
        revision_student = session.get(Student, revision_student_id)
        rate = Decimal(str(PROFILES[0][2]))
        session.add(StudentSubmission(student_id=revision_student.student_id, classwork_assignment_id=pt3_assignment_id, submitted_at=_utc(16), status="graded", grade=(Decimal("40") * rate).quantize(Decimal("0.01")), attempt_count=1, graded_at=_utc(17), graded_by_staff_id="DEMO-T-001"))
        session.commit()
    second = generate_and_persist_development_current_term(revision_student_id, scope["class_id"], scope["subject_id"], scope["academic_period_id"], model_version_id=model_version_id, bind=engine)
    results.append((student_records[0], second))

    with Session(engine) as session:
        for index, (student_id, _, profile) in enumerate(student_records[1:9], start=1):
            rate = Decimal(str(PROFILES[index][2]))
            session.add(StudentSubmission(student_id=student_id, classwork_assignment_id=pt3_assignment_id, submitted_at=_utc(16), status="graded", grade=(Decimal("40") * rate).quantize(Decimal("0.01")), attempt_count=1, graded_at=_utc(17), graded_by_staff_id="DEMO-T-001"))
        session.commit()
    for record in student_records[1:9]:
        result = generate_and_persist_development_current_term(record[0], scope["class_id"], scope["subject_id"], scope["academic_period_id"], model_version_id=model_version_id, bind=engine)
        results.append((record, result))
    blocked = generate_and_persist_development_current_term(student_records[9][0], scope["class_id"], scope["subject_id"], scope["academic_period_id"], model_version_id=model_version_id, bind=engine)

    behavioral_context = {}
    with Session(engine) as session:
        for student_id, student_name, _ in student_records:
            attendance = session.execute(
                select(AttendanceRecord.status, func.count()).where(
                    AttendanceRecord.student_id == student_id
                ).group_by(AttendanceRecord.status)
            ).all()
            submissions = session.execute(
                select(StudentSubmission.status, func.count()).where(
                    StudentSubmission.student_id == student_id
                ).group_by(StudentSubmission.status)
            ).all()
            behavioral_context[str(student_id)] = {
                "attendance": {status: count for status, count in attendance},
                "submissions": {status: count for status, count in submissions},
            }

    summary = {
        "database": require_demo_database(database_url).database,
        "selected_model_name": "entervene_current_term_official_target_rf_candidate",
        "corrected_model_version_id": model_version_id,
        "corrected_prediction_count": sum(result["prediction_status"] == "DEVELOPMENT_PREDICTION_AVAILABLE" for _, result in results),
        "admin_email": ADMIN_EMAIL,
        "teacher_email": TEACHER_EMAIL,
        "class": "Demo Archimedes",
        "subject": "Mathematics",
        "academic_period": "Term 1 Demo",
        "student_count": len(student_records),
        "scope": scope,
        "revision_example": {"student": student_records[0][1], "revision_1": first, "revision_2": second},
        "insufficient_evidence": {"student": student_records[9][1], "behavioral_context": behavioral_context[str(student_records[9][0])], **blocked},
        "predictions": [{"student": record[1], "academic_profile": record[2], "behavioral_context": behavioral_context[str(record[0])], **result} for record, result in results],
    }
    output_path = summary_path(database_url)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    engine.dispose()
    return summary


def read_summary(database_url: str) -> dict:
    require_demo_database(database_url)
    output_path = summary_path(database_url)
    if not output_path.exists():
        raise ValueError("Demo summary not found; run setup first.")
    summary = json.loads(output_path.read_text(encoding="utf-8"))
    if summary.get("database", "").casefold() != require_demo_database(database_url).database.casefold():
        raise ValueError("Demo summary belongs to an unexpected database.")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("setup", "seed", "status"))
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"), required=os.getenv("DATABASE_URL") is None)
    parser.add_argument("--no-write-environment", action="store_true", help="Keep existing demo environment files unchanged.")
    args = parser.parse_args()
    database = require_demo_database(args.database_url).database
    if args.action == "setup" and database.casefold() in ACCEPTANCE_DATABASES and not args.no_write_environment:
        parser.error("Acceptance setup requires --no-write-environment.")
    if args.action == "setup":
        recreate_database(args.database_url)
        migrate(args.database_url)
        summary = seed(args.database_url)
        if not args.no_write_environment:
            write_demo_environment(args.database_url)
    elif args.action == "seed":
        summary = seed(args.database_url)
    else:
        summary = read_summary(args.database_url)
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
