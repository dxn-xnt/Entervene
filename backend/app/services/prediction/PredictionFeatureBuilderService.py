from __future__ import annotations

import re
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AssessmentItem import AssessmentItem
from app.models.academic.Class_ import Class
from app.models.academic.StudentAssessmentScore import StudentAssessmentScore
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission


COMPONENT_FEATURES = {
    "WRITTEN_WORK": "written_work_percent",
    "PERFORMANCE_TASK": "performance_task_percent",
    "PERIODICAL_ASSESSMENT": "periodical_assessment_percent",
}
READINESS_ACTION = "Collect more graded evidence before generating a model-assisted risk decision."


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    return float(value)


def _round_or_none(value: float | None, places: int = 4) -> float | None:
    if value is None:
        return None
    return round(float(value), places)


def _component_percent(earned: Decimal, possible: Decimal) -> float | None:
    if possible <= 0:
        return None
    return round(float((earned / possible) * Decimal("100")), 2)


def _subject_feature_name(subject: Subject) -> str | None:
    label = subject.subject_codename or subject.subject_name
    if not label:
        return None
    normalized = re.sub(r"[^A-Za-z0-9]+", "_", label).strip("_").upper()
    if not normalized:
        return None
    return f"subject_{normalized}"


def _period_grade(
    db: Session,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    period_id: int,
) -> StudentPeriodGrade | None:
    return (
        db.query(StudentPeriodGrade)
        .filter(
            StudentPeriodGrade.student_id == student_id,
            StudentPeriodGrade.class_id == class_id,
            StudentPeriodGrade.subject_id == subject_id,
            StudentPeriodGrade.academic_period_id == period_id,
        )
        .one_or_none()
    )


def _previous_period(
    db: Session,
    source_period: AcademicPeriod,
) -> AcademicPeriod | None:
    return (
        db.query(AcademicPeriod)
        .filter(
            AcademicPeriod.academic_year_id == source_period.academic_year_id,
            AcademicPeriod.period_type == source_period.period_type,
            AcademicPeriod.period_sequence < source_period.period_sequence,
        )
        .order_by(AcademicPeriod.period_sequence.desc())
        .first()
    )


def _assessment_rows(
    db: Session,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    source_period_id: int,
) -> list[tuple[AssessmentItem, StudentAssessmentScore | None]]:
    return (
        db.query(AssessmentItem, StudentAssessmentScore)
        .outerjoin(
            StudentAssessmentScore,
            (StudentAssessmentScore.assessment_id == AssessmentItem.assessment_id)
            & (StudentAssessmentScore.student_id == student_id),
        )
        .filter(
            AssessmentItem.class_id == class_id,
            AssessmentItem.subject_id == subject_id,
            AssessmentItem.academic_period_id == source_period_id,
        )
        .order_by(AssessmentItem.component_type, AssessmentItem.item_number)
        .all()
    )


def _component_features(
    assessment_rows: list[tuple[AssessmentItem, StudentAssessmentScore | None]],
) -> tuple[dict[str, float | None], dict[str, Any]]:
    earned_by_component = {component: Decimal("0") for component in COMPONENT_FEATURES}
    possible_by_component = {component: Decimal("0") for component in COMPONENT_FEATURES}
    components_present: set[str] = set()
    recorded_count = 0
    submitted_count = 0
    missing_count = 0

    for assessment, score in assessment_rows:
        component = assessment.component_type
        if component not in COMPONENT_FEATURES:
            continue
        components_present.add(component)
        possible_by_component[component] += Decimal(str(assessment.max_score or 0))
        if score is None or score.score_status in {"MISSING_NOT_ENCODED", "ABSENT"}:
            missing_count += 1
            continue
        if score.score_status == "RECORDED" and score.raw_score is not None:
            earned_by_component[component] += Decimal(str(score.raw_score))
            recorded_count += 1
            submitted_count += 1

    features = {
        feature_name: _component_percent(earned_by_component[component], possible_by_component[component])
        for component, feature_name in COMPONENT_FEATURES.items()
    }
    summary = {
        "expected_assessment_count": len(assessment_rows),
        "recorded_assessment_count": recorded_count,
        "submitted_assessment_count": submitted_count,
        "missing_assessment_count": missing_count,
        "components_present": sorted(components_present),
        "components_missing": sorted(set(COMPONENT_FEATURES) - components_present),
    }
    return features, summary


def _running_grade(component_values: dict[str, float | None]) -> float | None:
    values = [value for value in component_values.values() if value is not None]
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def _late_submission_count(
    db: Session,
    student_id: UUID,
    class_id: int,
    subject_id: int,
) -> tuple[int, str | None]:
    rows = (
        db.query(ClassworkAssignment, StudentSubmission)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .outerjoin(
            StudentSubmission,
            (StudentSubmission.classwork_assignment_id == ClassworkAssignment.classwork_assignment_id)
            & (StudentSubmission.student_id == student_id),
        )
        .filter(
            ClassworkAssignment.class_id == class_id,
            Classwork.subject_id == subject_id,
            ClassworkAssignment.is_published == True,
            Classwork.is_archived == False,
        )
        .all()
    )
    if not rows:
        return 0, "No published classwork assignments were available for late-submission evidence."
    if not any(assignment.due_date for assignment, _ in rows):
        return 0, "Classwork due dates are not available; late_submission_count defaulted to 0."

    late_count = 0
    for assignment, submission in rows:
        if not assignment.due_date or submission is None or submission.submitted_at is None:
            continue
        due_date = assignment.due_date
        submitted_at = submission.submitted_at
        if due_date.tzinfo is None:
            due_date = due_date.replace(tzinfo=timezone.utc)
        if submitted_at.tzinfo is None:
            submitted_at = submitted_at.replace(tzinfo=timezone.utc)
        if submitted_at > due_date or (submission.status or "").lower() == "late":
            late_count += 1
    return late_count, None


def _prediction_mode(source_period: AcademicPeriod, target_period_id: int | None) -> str:
    if target_period_id is None or target_period_id == source_period.academic_period_id or source_period.is_active:
        return "CURRENT_PERIOD_PROJECTION"
    return "NEXT_PERIOD_PREDICTION"


def check_prediction_readiness(feature_payload: dict[str, Any]) -> dict[str, Any]:
    features = feature_payload.get("features", feature_payload)
    coverage = features.get("data_coverage_ratio") or 0
    completion = features.get("assessment_completion_rate") or 0
    source_grade = features.get("source_period_grade")
    reasons: list[str] = []

    if source_grade is None:
        reasons.append("Source period grade is not available.")
    if coverage < 0.50:
        reasons.append("Data coverage is below the minimum 50% threshold.")
    if completion < 0.50:
        reasons.append("Assessment completion rate is below the minimum 50% threshold.")

    if reasons:
        level = "INSUFFICIENT"
    elif coverage < 0.70:
        level = "MINIMUM"
    elif coverage < 0.85:
        level = "GOOD"
    else:
        level = "STRONG"

    return {
        "ready": level != "INSUFFICIENT",
        "readiness_level": level,
        "reasons": reasons,
    }


def insufficient_prediction_response(built: dict[str, Any]) -> dict[str, Any]:
    reasons = built.get("readiness_reasons") or ["Prediction readiness is insufficient."]
    return {
        "ready": False,
        "readiness_level": "INSUFFICIENT",
        "prediction_mode": built.get("prediction_mode", "CURRENT_PERIOD_PROJECTION"),
        "predicted_period_grade": None,
        "risk_level": "INSUFFICIENT_DATA",
        "risk_score": 0,
        "data_status": "INSUFFICIENT_DATA",
        "reasons": reasons,
        "recommended_action": READINESS_ACTION,
        "triggered_rules": ["insufficient_prediction_readiness"],
        "features": built.get("features", {}),
        "evidence_summary": built.get("evidence_summary", {}),
        "warnings": built.get("warnings", []),
    }


def build_prediction_features_from_records(
    db: Session,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    source_period_id: int,
    target_period_id: int | None = None,
) -> dict[str, Any]:
    student = db.get(Student, student_id)
    class_ = db.get(Class, class_id)
    subject = db.get(Subject, subject_id)
    source_period = db.get(AcademicPeriod, source_period_id)
    if student is None:
        raise ValueError("Referenced student was not found.")
    if class_ is None:
        raise ValueError("Referenced class was not found.")
    if subject is None:
        raise ValueError("Referenced subject was not found.")
    if source_period is None:
        raise ValueError("Referenced source academic period was not found.")
    if target_period_id is not None and db.get(AcademicPeriod, target_period_id) is None:
        raise ValueError("Referenced target academic period was not found.")

    warnings: list[str] = []
    rows = _assessment_rows(db, student_id, class_id, subject_id, source_period_id)
    component_features, evidence_summary = _component_features(rows)
    late_count, late_warning = _late_submission_count(db, student_id, class_id, subject_id)
    if late_warning:
        warnings.append(late_warning)
    evidence_summary["late_submission_count"] = late_count

    expected_count = evidence_summary["expected_assessment_count"]
    recorded_count = evidence_summary["recorded_assessment_count"]
    submitted_count = evidence_summary["submitted_assessment_count"]
    if expected_count == 0:
        warnings.append("No assessment items were found; expected assessment count was inferred as 0.")
    data_coverage_ratio = (recorded_count / expected_count) if expected_count else 0
    completion_rate = (submitted_count / expected_count) if expected_count else 0

    period_grade = _period_grade(db, student_id, class_id, subject_id, source_period_id)
    source_period_grade = None
    if period_grade is not None:
        source_period_grade = (
            _to_float(period_grade.final_period_grade)
            or _to_float(period_grade.transmuted_grade)
            or _to_float(period_grade.initial_grade)
        )
        for column in ("written_work_percent", "performance_task_percent", "periodical_assessment_percent"):
            if component_features[column] is None:
                component_features[column] = _to_float(getattr(period_grade, column))

    if source_period_grade is None:
        source_period_grade = _running_grade(component_features)
        if source_period_grade is not None:
            warnings.append("Source period grade was estimated from available assessment component percentages.")

    previous = _previous_period(db, source_period)
    previous_grade = None
    if previous is not None:
        previous_row = _period_grade(db, student_id, class_id, subject_id, previous.academic_period_id)
        if previous_row is not None:
            previous_grade = (
                _to_float(previous_row.final_period_grade)
                or _to_float(previous_row.transmuted_grade)
                or _to_float(previous_row.initial_grade)
            )
    has_previous = previous_grade is not None
    trend = round(source_period_grade - previous_grade, 2) if source_period_grade is not None and previous_grade is not None else None

    # Normalise period_sequence to a 4-quarter-equivalent scale so the model
    # (which was trained on quarter data where sequence 4 == 100% of year) receives
    # a semantically consistent value regardless of whether the source period is a
    # TERM, QUARTER, or SEMESTER.  For 4-quarter data this is an identity:
    #   (3 / 4) * 4 = 3.0  (unchanged)
    # For 3-term data it rescales correctly:
    #   (2 / 3) * 4 ≈ 2.6667  (Term 2 now means ~67% of year, not 50%)
    # The feature key stays "period_sequence" so the .joblib model schema is not broken.
    _normalised_period_sequence = round(
        (source_period.period_sequence / source_period.total_periods_in_year) * 4, 4
    )
    features: dict[str, Any] = {
        "grade_level": getattr(student.academic_level, "grade_level", None),
        "period_sequence": _normalised_period_sequence,
        "source_period_grade": source_period_grade,
        "written_work_percent": component_features["written_work_percent"],
        "performance_task_percent": component_features["performance_task_percent"],
        "periodical_assessment_percent": component_features["periodical_assessment_percent"],
        "assessment_completion_rate": _round_or_none(completion_rate),
        "missing_activity_count": evidence_summary["missing_assessment_count"],
        "late_submission_count": late_count,
        "data_coverage_ratio": _round_or_none(data_coverage_ratio),
        "grade_trend_vs_previous_period": trend,
        "has_previous_period": has_previous,
    }
    # FIX: previously filtered by academic_period_id <= source_period_id, which
    # relied on PK integer ordering.  That breaks when two period types coexist
    # (e.g. old QUARTER rows and new TERM rows) because IDs are simply auto-incremented
    # in insertion order, not by academic sequence.  Instead, join AcademicPeriod and
    # restrict by year, type, and sequence so only periods of the same type and year
    # that came before (or at) the source period are included.
    previous_grades = (
        db.query(StudentPeriodGrade)
        .join(
            AcademicPeriod,
            AcademicPeriod.academic_period_id == StudentPeriodGrade.academic_period_id,
        )
        .filter(
            StudentPeriodGrade.student_id == student_id,
            StudentPeriodGrade.class_id == class_id,
            StudentPeriodGrade.subject_id == subject_id,
            AcademicPeriod.academic_year_id == source_period.academic_year_id,
            AcademicPeriod.period_type == source_period.period_type,
            AcademicPeriod.period_sequence <= source_period.period_sequence,
            StudentPeriodGrade.final_period_grade.isnot(None),
        )
        .all()
    )
    if previous_grades:
        grades = [float(row.final_period_grade) for row in previous_grades]
        features["cumulative_period_grade_avg"] = round(sum(grades) / len(grades), 2)
    subject_feature = _subject_feature_name(subject)
    if subject_feature:
        features[subject_feature] = 1

    readiness = check_prediction_readiness({"features": features})
    return {
        "ready": readiness["ready"],
        "readiness_level": readiness["readiness_level"],
        "prediction_mode": _prediction_mode(source_period, target_period_id),
        "features": features,
        "evidence_summary": evidence_summary,
        "warnings": warnings,
        "readiness_reasons": readiness["reasons"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
