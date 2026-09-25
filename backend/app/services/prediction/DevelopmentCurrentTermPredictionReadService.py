from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.attendance.Attendance import AttendanceRecord
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    return float(value)


def _format_student_name(student: Student | None) -> str | None:
    if student is None:
        return None
    last = (student.last_name or "").strip()
    first = (student.first_name or "").strip()
    if last and first and last != "0" and first != "Unknown":
        return f"{last}, {first}"
    if first and first != "Unknown":
        return first
    if last and last != "0":
        return last
    return f"Student {str(student.student_id)[:8]}"


def _readiness(snapshot: Any) -> dict[str, Any]:
    if not isinstance(snapshot, dict):
        return {"readiness_status": None, "readiness_level": None}
    readiness = snapshot.get("readiness")
    if not isinstance(readiness, dict):
        return {"readiness_status": None, "readiness_level": None}
    return {
        "readiness_status": readiness.get("status"),
        "readiness_level": readiness.get("level"),
    }


def _snapshot_features(snapshot: Any) -> dict[str, Any]:
    if not isinstance(snapshot, dict):
        return {}
    rows = snapshot.get("model_features")
    if not isinstance(rows, list):
        return {}
    return {
        row["name"]: row.get("value")
        for row in rows
        if isinstance(row, dict) and isinstance(row.get("name"), str)
    }


def _cutoff(snapshot: Any, generated_at: datetime | None) -> datetime:
    raw = snapshot.get("generation_cutoff_at") if isinstance(snapshot, dict) else None
    if isinstance(raw, str):
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    value = generated_at or datetime.now(timezone.utc)
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _academic_evidence(snapshot: Any) -> dict[str, Any]:
    features = _snapshot_features(snapshot)
    return {
        "written_works": {
            "graded_count": int(features.get("ww_available_activity_count") or 0),
            "performance_percent": _to_float(features.get("ww_percent_so_far")),
        },
        "performance_tasks": {
            "graded_count": int(features.get("pt_available_activity_count") or 0),
            "performance_percent": _to_float(features.get("pt_percent_so_far")),
        },
        "examination": {
            "graded_count": int(features.get("qa_available_activity_count") or 0),
            "performance_percent": _to_float(features.get("qa_percent_so_far"))
            if features.get("qa_has_evidence") else None,
        },
        "overall": {
            "graded_activity_count": int(features.get("overall_available_activity_count") or 0),
            "performance_percent": _to_float(features.get("overall_partial_percent")),
            "observed_component_weight_percent": _to_float(features.get("observed_component_weight_sum")),
        },
    }


def _term_context(period: AcademicPeriod, cutoff_at: datetime) -> dict[str, Any]:
    cutoff_date = cutoff_at.date()
    total_days = max(1, (period.end_date - period.start_date).days)
    elapsed_days = min(total_days, max(0, (cutoff_date - period.start_date).days))
    return {
        "start_date": period.start_date,
        "end_date": period.end_date,
        "evidence_cutoff_date": cutoff_date,
        "progress_percent": round(elapsed_days / total_days * 100, 1),
        "days_remaining": max(0, (period.end_date - cutoff_date).days),
        "is_active": bool(period.is_active),
        "scheduled_end_passed_while_active": bool(period.is_active and date.today() > period.end_date),
    }


def _participation_context(
    db: Session,
    prediction: DevelopmentCurrentTermPrediction,
    period: AcademicPeriod,
    cutoff_at: datetime,
) -> dict[str, Any]:
    cutoff_date = cutoff_at.date()
    attendance = db.query(AttendanceRecord).filter(
        AttendanceRecord.student_id == prediction.student_id,
        AttendanceRecord.class_id == prediction.class_id,
        AttendanceRecord.subject_id == prediction.subject_id,
        AttendanceRecord.date >= period.start_date,
        AttendanceRecord.date <= min(cutoff_date, period.end_date),
    ).all()
    attendance_counts = {
        status: sum(1 for row in attendance if (row.status or "").lower() == status)
        for status in ("present", "absent", "late", "excused")
    }
    attended = attendance_counts["present"] + attendance_counts["late"] + attendance_counts["excused"]
    attendance_rate = round(attended / len(attendance) * 100, 1) if attendance else None

    assignments = (
        db.query(ClassworkAssignment, Classwork)
        .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
        .filter(
            ClassworkAssignment.class_id == prediction.class_id,
            ClassworkAssignment.academic_period_id == prediction.source_period_id,
            Classwork.subject_id == prediction.subject_id,
            ClassworkAssignment.is_published.is_(True),
            Classwork.is_archived.is_(False),
            Classwork.is_graded.is_(True),
            Classwork.classwork_type != "READING",
        )
        .all()
    )
    assignment_ids = [assignment.classwork_assignment_id for assignment, _ in assignments]
    submissions = db.query(StudentSubmission).filter(
        StudentSubmission.student_id == prediction.student_id,
        StudentSubmission.classwork_assignment_id.in_(assignment_ids),
    ).all() if assignment_ids else []
    grouped: dict[int, list[StudentSubmission]] = {}
    for submission in submissions:
        if submission.submitted_at is None or _as_utc(submission.submitted_at) <= cutoff_at:
            grouped.setdefault(submission.classwork_assignment_id, []).append(submission)

    submitted_count = missing_count = late_count = upcoming_count = 0
    for assignment, _classwork in assignments:
        candidates = grouped.get(assignment.classwork_assignment_id, [])
        latest = max(candidates, key=lambda row: ((_as_utc(row.submitted_at) if row.submitted_at else datetime.min.replace(tzinfo=timezone.utc)), row.submission_id), default=None)
        status = (latest.status or "").lower() if latest else ""
        completed = latest is not None and status in {"submitted", "graded", "late"}
        if completed:
            submitted_count += 1
        due_at = assignment.due_date
        if due_at is not None and due_at.tzinfo is None:
            due_at = due_at.replace(tzinfo=timezone.utc)
        if due_at is not None and due_at <= cutoff_at:
            if not completed:
                missing_count += 1
            elif status == "late" or (latest.submitted_at and _as_utc(latest.submitted_at) > due_at):
                late_count += 1
        elif not completed:
            upcoming_count += 1

    assigned_count = len(assignments)
    return {
        "attendance": {
            "recorded_days": len(attendance),
            "attendance_rate": attendance_rate,
            **attendance_counts,
        },
        "submissions": {
            "assigned_count": assigned_count,
            "submitted_count": submitted_count,
            "missing_count": missing_count,
            "late_count": late_count,
            "upcoming_count": upcoming_count,
            "completion_rate": round(submitted_count / assigned_count * 100, 1) if assigned_count else None,
        },
    }


def list_latest_development_current_term_predictions(
    db: Session,
    *,
    class_id: int,
    subject_id: int,
    academic_period_id: int,
    model_version_id: int,
    require_active_enrollment: bool = False,
) -> dict[str, Any]:
    latest_revision = (
        db.query(
            DevelopmentCurrentTermPrediction.student_id.label("student_id"),
            DevelopmentCurrentTermPrediction.class_id.label("class_id"),
            DevelopmentCurrentTermPrediction.subject_id.label("subject_id"),
            DevelopmentCurrentTermPrediction.source_period_id.label("source_period_id"),
            DevelopmentCurrentTermPrediction.target_period_id.label("target_period_id"),
            DevelopmentCurrentTermPrediction.model_version_id.label("model_version_id"),
            func.max(DevelopmentCurrentTermPrediction.revision).label("revision"),
        )
        .join(AIModelVersion, DevelopmentCurrentTermPrediction.model_version_id == AIModelVersion.model_version_id)
        .filter(
            DevelopmentCurrentTermPrediction.class_id == class_id,
            DevelopmentCurrentTermPrediction.subject_id == subject_id,
            DevelopmentCurrentTermPrediction.source_period_id == academic_period_id,
            DevelopmentCurrentTermPrediction.target_period_id == academic_period_id,
            AIModelVersion.model_purpose == ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value,
            AIModelVersion.lifecycle_status == "DEVELOPMENT",
            DevelopmentCurrentTermPrediction.model_version_id == model_version_id,
        )
        .group_by(
            DevelopmentCurrentTermPrediction.student_id,
            DevelopmentCurrentTermPrediction.class_id,
            DevelopmentCurrentTermPrediction.subject_id,
            DevelopmentCurrentTermPrediction.source_period_id,
            DevelopmentCurrentTermPrediction.target_period_id,
            DevelopmentCurrentTermPrediction.model_version_id,
        )
        .subquery()
    )

    query = (
        db.query(
            DevelopmentCurrentTermPrediction,
            Student,
            Class,
            Subject,
            AcademicPeriod,
            AIModelVersion,
        )
        .join(
            latest_revision,
            and_(
                DevelopmentCurrentTermPrediction.student_id == latest_revision.c.student_id,
                DevelopmentCurrentTermPrediction.class_id == latest_revision.c.class_id,
                DevelopmentCurrentTermPrediction.subject_id == latest_revision.c.subject_id,
                DevelopmentCurrentTermPrediction.source_period_id == latest_revision.c.source_period_id,
                DevelopmentCurrentTermPrediction.target_period_id == latest_revision.c.target_period_id,
                DevelopmentCurrentTermPrediction.model_version_id == latest_revision.c.model_version_id,
                DevelopmentCurrentTermPrediction.revision == latest_revision.c.revision,
            ),
        )
        .join(Student, DevelopmentCurrentTermPrediction.student_id == Student.student_id)
        .join(Class, DevelopmentCurrentTermPrediction.class_id == Class.class_id)
        .join(Subject, DevelopmentCurrentTermPrediction.subject_id == Subject.subject_id)
        .join(AcademicPeriod, DevelopmentCurrentTermPrediction.source_period_id == AcademicPeriod.academic_period_id)
        .join(AIModelVersion, DevelopmentCurrentTermPrediction.model_version_id == AIModelVersion.model_version_id)
    )
    if require_active_enrollment:
        query = query.join(
            StudentClass,
            and_(
                StudentClass.student_id == DevelopmentCurrentTermPrediction.student_id,
                StudentClass.class_id == DevelopmentCurrentTermPrediction.class_id,
                StudentClass.academic_year_id == Class.academic_year_id,
            ),
        ).filter(func.lower(StudentClass.enrollment_status) == "enrolled")

    rows = query.order_by(
        Student.last_name.asc(),
        Student.first_name.asc(),
        DevelopmentCurrentTermPrediction.generated_at.desc(),
    ).all()

    items = []
    for prediction, student, class_, subject, period, version in rows:
        readiness = _readiness(prediction.evidence_snapshot)
        cutoff_at = _cutoff(prediction.evidence_snapshot, prediction.generated_at)
        finalized_grade = db.query(StudentPeriodGrade).filter(
            StudentPeriodGrade.student_id == prediction.student_id,
            StudentPeriodGrade.class_id == prediction.class_id,
            StudentPeriodGrade.subject_id == prediction.subject_id,
            StudentPeriodGrade.academic_period_id == prediction.source_period_id,
            StudentPeriodGrade.is_finalized.is_(True),
            StudentPeriodGrade.final_period_grade.isnot(None),
        ).first()
        items.append({
            "prediction_id": prediction.prediction_id,
            "revision": prediction.revision,
            "student_id": prediction.student_id,
            "student_name": _format_student_name(student),
            "class_id": prediction.class_id,
            "class_name": class_.section_name,
            "subject_id": prediction.subject_id,
            "subject_name": subject.subject_name,
            "subject_codename": subject.subject_codename,
            "academic_period_id": prediction.source_period_id,
            "period_name": period.period_name,
            "projected_final_term_grade": _to_float(prediction.predicted_period_grade),
            "intervention_level": prediction.intervention_level,
            "intervention_basis": prediction.intervention_basis,
            "readiness_status": readiness["readiness_status"],
            "readiness_level": readiness["readiness_level"],
            "readiness_label": "Enough evidence available for projection"
            if readiness["readiness_status"] == "READY"
            else "More academic evidence is needed before a projection can be generated.",
            "academic_evidence": _academic_evidence(prediction.evidence_snapshot),
            "participation_context": _participation_context(db, prediction, period, cutoff_at),
            "term_context": _term_context(period, cutoff_at),
            "official_final_grade_available": finalized_grade is not None,
            "official_final_grade": _to_float(finalized_grade.final_period_grade) if finalized_grade else None,
            "model_version_id": prediction.model_version_id,
            "model_name": version.model_name,
            "lifecycle_status": version.lifecycle_status,
            "generated_at": prediction.generated_at,
        })

    return {"items": items, "total": len(items)}
