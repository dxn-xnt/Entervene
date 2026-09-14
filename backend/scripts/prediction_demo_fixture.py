"""Seed or remove the isolated Grade 7 prediction demonstration fixture.

This is development/demo tooling, not an application feature.  It refuses any
database whose name does not explicitly contain ``demo`` or ``test`` and keeps
the exact created primary keys in a local manifest for constrained cleanup.

Example (PowerShell):
    $env:DATABASE_URL = 'postgresql://.../Entervene_prediction_demo'
    python scripts/prediction_demo_fixture.py seed --run-id DEMO-PRED-G7-2026
    python scripts/prediction_demo_fixture.py cleanup --run-id DEMO-PRED-G7-2026 --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

# Allow `python scripts/...` from backend while keeping application imports.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models.academic.AssessmentItem import AssessmentItem
from app.models.academic.StudentAssessmentScore import StudentAssessmentScore
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.attendance.Attendance import AttendanceRecord
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIPredictionFeature import AIPredictionFeature


MANIFEST_DIR = Path(__file__).resolve().parents[1] / ".demo-fixtures"
TERM_1_ID = 1
STAFF_ID = "2026-0004"
LABEL_PREFIX = "DEMO-PRED-G7-2026"


SCOPES = {
    "math": {
        "class_id": 6,
        "subject_id": 2,
        "topic_rows": [
            ("Operations with Integers", "ASSIGNMENT", "WRITTEN_WORK", None),
            ("Rational Number Practice", "ASSIGNMENT", "WRITTEN_WORK", None),
            ("Algebraic Expressions Quiz", "QUIZ", "WRITTEN_WORK", None),
            ("Integer Problem-Solving Task", "ACTIVITY", "PERFORMANCE_TASK", None),
            ("Modeling Rational Numbers", "ACTIVITY", "PERFORMANCE_TASK", None),
            ("Linear Equations Performance Task", "ACTIVITY", "PERFORMANCE_TASK", None),
            ("Linear Equations Summative Test", "QUIZ", "QUARTERLY_ASSESSMENT", "SUMMATIVE_1"),
            ("Term 1 Mathematics Examination", "QUIZ", "QUARTERLY_ASSESSMENT", "TERM_EXAM"),
        ],
        "profiles": {
            "978000000000": {"key": "low", "grade": "92", "final": False},
            "786966032787": {"key": "high_hypothesis", "grade": "76", "final": False},
            "419944503660": {"key": "zero_completion", "grade": "85", "final": False},
        },
    },
    "science": {
        "class_id": 5,
        "subject_id": 3,
        "topic_rows": [
            ("Scientific Investigation Notes", "ASSIGNMENT", "WRITTEN_WORK", None),
            ("Mixtures and Solutions Quiz", "QUIZ", "WRITTEN_WORK", None),
            ("Heat Transfer Worksheet", "ASSIGNMENT", "WRITTEN_WORK", None),
            ("Mixture Separation Lab", "ACTIVITY", "PERFORMANCE_TASK", None),
            ("Heat Transfer Demonstration", "ACTIVITY", "PERFORMANCE_TASK", None),
            ("Ecosystem Observation Task", "ACTIVITY", "PERFORMANCE_TASK", None),
            ("Ecosystems Summative Test", "QUIZ", "QUARTERLY_ASSESSMENT", "SUMMATIVE_1"),
            ("Term 1 Science Examination", "QUIZ", "QUARTERLY_ASSESSMENT", "TERM_EXAM"),
        ],
        "profiles": {
            "470291886195": {"key": "monitor_hypothesis", "grade": "87", "final": False},
            "123212212321": {"key": "moderate_hypothesis", "grade": "80", "final": False},
            "974300000000": {"key": "completed_ungraded", "grade": "82", "final": False},
            "743341803726": {"key": "attempt_unresolved", "grade": "83", "final": False},
        },
    },
}


def manifest_path(run_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", run_id)
    return MANIFEST_DIR / f"{safe}.json"


def require_demo_database(database_url: str) -> None:
    database = make_url(database_url).database or ""
    if not re.search(r"(?:demo|test)", database, flags=re.IGNORECASE):
        raise ValueError("Refusing to run outside a database whose name contains 'demo' or 'test'.")


def write_manifest(path: Path, manifest: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    temporary.replace(path)


def demo_datetime(day_offset: int, late_hours: int = 0) -> datetime:
    return datetime(2025, 6, 3, 9, tzinfo=timezone.utc) + timedelta(days=day_offset, hours=late_hours)


def record_id(manifest: dict[str, Any], table: str, value: int) -> None:
    manifest["created_ids"].setdefault(table, []).append(value)


def preflight(session: Session) -> dict[str, dict[str, Any]]:
    staff = session.get(AcademicStaff, STAFF_ID)
    if staff is None:
        raise ValueError(f"Expected Joselito Manalo staff record {STAFF_ID} was not found.")

    resolved: dict[str, dict[str, Any]] = {}
    for scope_name, scope in SCOPES.items():
        students = session.execute(
            select(Student).where(Student.student_lrn.in_(scope["profiles"].keys()))
        ).scalars().all()
        by_lrn = {student.student_lrn: student for student in students}
        missing = set(scope["profiles"]) - set(by_lrn)
        if missing:
            raise ValueError(f"{scope_name} fixture students are missing: {sorted(missing)}")
        resolved[scope_name] = {"staff": staff, "students": by_lrn}
    return resolved


def create_assignment(session: Session, manifest: dict[str, Any], *, scope: dict[str, Any], row: tuple[str, str, str, str | None], index: int) -> ClassworkAssignment:
    topic, classwork_type, category, exam_subtype = row
    classwork = Classwork(
        title=f"{LABEL_PREFIX} — {topic}",
        description="Development/demo prediction evidence fixture.",
        instructions="Demo fixture only; not for student-facing use outside the isolated demo database.",
        classwork_type=classwork_type,
        classwork_category=category,
        exam_subtype=exam_subtype,
        activity_mode="MANUAL",
        is_graded=True,
        total_points=Decimal("20"),
        is_locked=True,
        is_published=True,
        show_scores=True,
        is_archived=False,
        subject_id=scope["subject_id"],
        created_by_staff_id=STAFF_ID,
    )
    session.add(classwork)
    session.flush()
    record_id(manifest, "classwork", classwork.classwork_id)
    assignment = ClassworkAssignment(
        classwork_id=classwork.classwork_id,
        class_id=scope["class_id"],
        academic_period_id=TERM_1_ID,
        assigned_by_staff_id=STAFF_ID,
        publish_date=demo_datetime(index),
        due_date=demo_datetime(index + 2),
        lock_date=demo_datetime(index + 7),
        is_published=True,
        is_locked=True,
        allow_late_submissions=True,
        max_attempts=3,
    )
    session.add(assignment)
    session.flush()
    record_id(manifest, "classwork_assignment", assignment.classwork_assignment_id)
    return assignment


def add_submission(session: Session, manifest: dict[str, Any], student: Student, assignment: ClassworkAssignment, *, status: str, grade: str | None, day: int, attempt: int = 1, same_time: bool = False) -> None:
    submitted_at = demo_datetime(day + 1 if status == "late" else day, late_hours=4 if status == "late" else 0)
    if same_time:
        submitted_at = demo_datetime(day)
    submission = StudentSubmission(
        student_id=student.student_id,
        classwork_assignment_id=assignment.classwork_assignment_id,
        submitted_at=submitted_at,
        status=status,
        grade=Decimal(grade) if grade is not None else None,
        attempt_count=attempt,
        graded_at=demo_datetime(day + 1) if grade is not None else None,
        graded_by_staff_id=STAFF_ID if grade is not None else None,
    )
    session.add(submission)
    session.flush()
    record_id(manifest, "student_submission", submission.submission_id)


def create_profile_submissions(session: Session, manifest: dict[str, Any], student: Student, assignments: list[ClassworkAssignment], profile_key: str) -> None:
    for index, assignment in enumerate(assignments):
        if profile_key == "zero_completion":
            continue
        if profile_key == "high_hypothesis" and index >= 4:
            add_submission(session, manifest, student, assignment, status="missed", grade=None, day=index)
        elif profile_key == "moderate_hypothesis" and index >= 6:
            add_submission(session, manifest, student, assignment, status="missed", grade=None, day=index)
        elif profile_key == "completed_ungraded":
            add_submission(session, manifest, student, assignment, status="submitted", grade=None, day=index)
        elif profile_key == "attempt_unresolved" and index == 0:
            # Current prediction behavior is intentionally documented as an
            # unresolved-authoritative-attempt policy case.
            add_submission(session, manifest, student, assignment, status="submitted", grade=None, day=index, attempt=1, same_time=True)
            add_submission(session, manifest, student, assignment, status="submitted", grade=None, day=index, attempt=2, same_time=True)
        else:
            is_late = profile_key == "monitor_hypothesis" and index == len(assignments) - 1
            add_submission(session, manifest, student, assignment, status="late" if is_late else "graded", grade=str(15 + (index % 5)), day=index)


def create_assessments(session: Session, manifest: dict[str, Any], *, scope: dict[str, Any], students: dict[str, Student]) -> None:
    items: list[AssessmentItem] = []
    for number, component in enumerate(("WRITTEN_WORK", "PERFORMANCE_TASK", "QUARTERLY_ASSESSMENT"), start=91):
        item = AssessmentItem(
            class_id=scope["class_id"], subject_id=scope["subject_id"], academic_period_id=TERM_1_ID,
            component_type=component, item_number=number, max_score=Decimal("20"), entered_by_staff_id=STAFF_ID,
        )
        session.add(item)
        session.flush()
        record_id(manifest, "assessment_item", item.assessment_id)
        items.append(item)
    for lrn, profile in scope["profiles"].items():
        student = students[lrn]
        for item in items:
            missed_quiz = profile["key"] == "moderate_hypothesis" and item.component_type == "WRITTEN_WORK"
            score = StudentAssessmentScore(
                assessment_id=item.assessment_id,
                student_id=student.student_id,
                raw_score=None if missed_quiz else Decimal("16"),
                score_status="MISSING_NOT_ENCODED" if missed_quiz else "RECORDED",
                entered_by_staff_id=STAFF_ID,
            )
            session.add(score)
            session.flush()
            record_id(manifest, "student_assessment_score", score.score_id)


def create_attendance(session: Session, manifest: dict[str, Any], *, scope: dict[str, Any], students: dict[str, Student]) -> None:
    status_patterns = {
        "low": ["present"] * 10,
        "high_hypothesis": ["absent", "absent", "late", "absent", "present", "absent", "late", "absent", "present", "excused"],
        "zero_completion": ["present", "excused", "present", "late", "present", "present", "excused", "present", "late", "present"],
        "monitor_hypothesis": ["present", "late", "present", "excused", "present", "present", "late", "present", "present", "excused"],
        "moderate_hypothesis": ["present", "absent", "late", "present", "excused", "present", "absent", "present", "late", "present"],
        "completed_ungraded": ["present", "present", "excused", "present", "late", "present", "present", "excused", "present", "present"],
        "attempt_unresolved": ["present", "late", "present", "present", "excused", "present", "absent", "present", "late", "present"],
    }
    for lrn, profile in scope["profiles"].items():
        for offset, status in enumerate(status_patterns[profile["key"]]):
            record = AttendanceRecord(
                student_id=students[lrn].student_id, class_id=scope["class_id"], subject_id=scope["subject_id"],
                date=date(2025, 6, 3) + timedelta(days=offset), status=status,
                remarks=f"{LABEL_PREFIX} fixture attendance", recorded_by_staff_id=STAFF_ID,
            )
            session.add(record)
            session.flush()
            record_id(manifest, "attendance_record", record.attendance_id)


def create_period_grades(session: Session, manifest: dict[str, Any], *, scope: dict[str, Any], students: dict[str, Student]) -> None:
    for lrn, profile in scope["profiles"].items():
        value = Decimal(profile["grade"])
        grade = StudentPeriodGrade(
            student_id=students[lrn].student_id, class_id=scope["class_id"], subject_id=scope["subject_id"], academic_period_id=TERM_1_ID,
            written_work_percent=value, performance_task_percent=value, quarterly_assessment_percent=value,
            initial_grade=None if profile["final"] else value,
            transmuted_grade=None if profile["final"] else value,
            final_period_grade=value if profile["final"] else None,
            is_finalized=profile["final"], finalized_at=demo_datetime(80) if profile["final"] else None,
            finalized_by_staff_id=STAFF_ID if profile["final"] else None, entered_by_staff_id=STAFF_ID,
            remarks=f"{LABEL_PREFIX} fixture grade", source_file_name=f"{LABEL_PREFIX}.json",
        )
        session.add(grade)
        session.flush()
        record_id(manifest, "student_period_grade", grade.period_grade_id)


def seed(database_url: str, run_id: str, replace: bool) -> Path:
    require_demo_database(database_url)
    path = manifest_path(run_id)
    if path.exists():
        if not replace:
            raise ValueError(f"Completed or incomplete run manifest already exists: {path}. Use cleanup, or explicitly pass --replace.")
        cleanup(database_url, run_id, dry_run=False)

    manifest: dict[str, Any] = {
        "run_id": run_id, "label_prefix": LABEL_PREFIX, "database": make_url(database_url).database,
        "status": "CREATING", "created_ids": {}, "scopes": {name: {"class_id": item["class_id"], "subject_id": item["subject_id"], "source_period_id": TERM_1_ID, "target_period_id": TERM_1_ID} for name, item in SCOPES.items()},
    }
    engine = create_engine(database_url)
    try:
        with Session(engine) as session, session.begin():
            resolved = preflight(session)
            for name, scope in SCOPES.items():
                assignments = [create_assignment(session, manifest, scope=scope, row=row, index=index * 3) for index, row in enumerate(scope["topic_rows"])]
                students = resolved[name]["students"]
                for lrn, profile in scope["profiles"].items():
                    create_profile_submissions(session, manifest, students[lrn], assignments, profile["key"])
                create_assessments(session, manifest, scope=scope, students=students)
                create_attendance(session, manifest, scope=scope, students=students)
                create_period_grades(session, manifest, scope=scope, students=students)
        manifest["status"] = "COMPLETE"
        write_manifest(path, manifest)
        return path
    except Exception:
        # The single database transaction rolls back fixture rows.  The manifest
        # is deliberately not written as complete after a failed seed.
        raise
    finally:
        engine.dispose()


def cleanup(database_url: str, run_id: str, dry_run: bool) -> None:
    require_demo_database(database_url)
    path = manifest_path(run_id)
    if not path.exists():
        raise ValueError(f"No manifest exists for run_id={run_id}.")
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("database") != make_url(database_url).database:
        raise ValueError("Manifest belongs to a different database; refusing cleanup.")
    created = manifest.get("created_ids", {})
    ordered = [
        ("ai_prediction_feature", AIPredictionFeature, "feature_id"),
        ("ai_prediction", AIPrediction, "prediction_id"),
        ("student_submission", StudentSubmission, "submission_id"),
        ("student_assessment_score", StudentAssessmentScore, "score_id"),
        ("attendance_record", AttendanceRecord, "attendance_id"),
        ("student_period_grade", StudentPeriodGrade, "period_grade_id"),
        ("subject_load", SubjectLoad, "subject_load_id"),
        ("assessment_item", AssessmentItem, "assessment_id"),
        ("classwork_assignment", ClassworkAssignment, "classwork_assignment_id"),
        ("classwork", Classwork, "classwork_id"),
    ]
    summary = {table: len(created.get(table, [])) for table, _, _ in ordered if created.get(table)}
    if dry_run:
        print(json.dumps({"run_id": run_id, "would_delete": summary}, indent=2, sort_keys=True))
        return
    engine = create_engine(database_url)
    try:
        with Session(engine) as session, session.begin():
            for table, model, primary_key in ordered:
                ids = created.get(table, [])
                if ids:
                    session.query(model).filter(getattr(model, primary_key).in_(ids)).delete(synchronize_session=False)
        path.unlink()
        print(json.dumps({"run_id": run_id, "deleted": summary}, indent=2, sort_keys=True))
    finally:
        engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("seed", "cleanup"))
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"), required=os.getenv("DATABASE_URL") is None)
    parser.add_argument("--run-id", default=LABEL_PREFIX)
    parser.add_argument("--replace", action="store_true", help="Explicitly remove this run's manifest records before reseeding.")
    parser.add_argument("--dry-run", action="store_true", help="Show constrained cleanup without deleting records.")
    args = parser.parse_args()
    if args.action == "seed":
        if args.dry_run:
            raise ValueError("seed does not support dry-run; use an isolated demo database.")
        print(f"Seeded demo fixture. Manifest: {seed(args.database_url, args.run_id, args.replace)}")
    else:
        cleanup(args.database_url, args.run_id, args.dry_run)


if __name__ == "__main__":
    main()
