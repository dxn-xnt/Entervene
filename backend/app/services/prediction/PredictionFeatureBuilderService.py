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
    "QUARTERLY_ASSESSMENT": "quarterly_assessment_percent",
}
READINESS_ACTION = "Collect more graded evidence before generating a model-assisted risk decision."


def map_classwork_category(classwork_type: str, classwork_category: str | None) -> str:
    if classwork_category:
        cat = classwork_category.upper()
        if cat in {"EXAMS", "EXAM", "PERIODICAL_EXAM", "PERIODICAL_ASSESSMENT", "QUARTERLY_ASSESSMENT", "SUMMATIVE_1", "SUMMATIVE_2", "TERM_EXAM"}:
            return "QUARTERLY_ASSESSMENT"
        if cat in {"WRITTEN_WORK", "PERFORMANCE_TASK"}:
            return cat

    t = (classwork_type or "").upper()
    if t in {"EXAM", "PERIODICAL_EXAM", "QUARTERLY_EXAM", "SUMMATIVE"}:
        return "QUARTERLY_ASSESSMENT"
    elif t in {"ACTIVITY", "PROJECT"}:
        return "PERFORMANCE_TASK"
    else:
        return "WRITTEN_WORK"


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


def _classwork_rows(
    db: Session,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    source_period_id: int,
) -> tuple[list[tuple[ClassworkAssignment, Classwork, StudentSubmission | None, bool]], bool]:
    from app.models.classwork.Classwork import Classwork
    from app.models.classwork.ClassworkAssignment import ClassworkAssignment
    from app.models.submissions.StudentSubmission import StudentSubmission

    assignments = (
        db.query(ClassworkAssignment, Classwork)
        .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
        .filter(
            ClassworkAssignment.class_id == class_id,
            Classwork.subject_id == subject_id,
            ClassworkAssignment.academic_period_id == source_period_id,
            Classwork.is_archived.is_(False),
            Classwork.is_graded.is_(True),
            Classwork.classwork_type != "READING",
        )
        .all()
    )

    legacy_exists = (
        db.query(ClassworkAssignment.classwork_assignment_id)
        .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
        .filter(
            ClassworkAssignment.class_id == class_id,
            Classwork.subject_id == subject_id,
            ClassworkAssignment.academic_period_id.is_(None),
            Classwork.is_archived.is_(False),
            Classwork.is_graded.is_(True),
            Classwork.classwork_type != "READING",
        )
        .first()
        is not None
    )
    assignment_ids = [assignment.classwork_assignment_id for assignment, _ in assignments]
    submissions = (
        db.query(StudentSubmission)
        .filter(
            StudentSubmission.student_id == student_id,
            StudentSubmission.classwork_assignment_id.in_(assignment_ids),
        )
        .all()
        if assignment_ids
        else []
    )
    grouped: dict[int, list[StudentSubmission]] = {}
    for submission in submissions:
        grouped.setdefault(submission.classwork_assignment_id, []).append(submission)
    selected: list[tuple[ClassworkAssignment, Classwork, StudentSubmission | None, bool]] = []
    for assignment, classwork in assignments:
        candidates = grouped.get(assignment.classwork_assignment_id, [])
        selected_submission = _select_submission(candidates)
        selected.append((assignment, classwork, selected_submission, bool(candidates and selected_submission is None)))
    return selected, legacy_exists


def _submission_timestamp(submission: StudentSubmission) -> datetime | None:
    # This is the gradebook's selection field.  Do not substitute created_at or
    # graded_at: those are not attempt-authority timestamps.
    return submission.submitted_at


def _select_submission(submissions: list[StudentSubmission]) -> StudentSubmission | None:
    """Mirror the gradebook's latest-submission rule without inventing a tie-break.

    Gradebook orders by submitted_at descending and then submission_id.  A row ID
    only makes the query deterministic; it does not prove which equal-time attempt
    is authoritative for prediction evidence, so Stage 3A marks that case unresolved.
    """
    if not submissions:
        return None
    if len(submissions) == 1:
        return submissions[0]
    # Multiple ungraded submissions have no gradebook observation to establish
    # a defensible evidence attempt, even if their generated row IDs differ.
    if all(submission.grade is None for submission in submissions):
        return None
    timestamps = [_submission_timestamp(submission) for submission in submissions]
    if any(value is None for value in timestamps):
        return None
    latest = max(timestamps)
    if sum(value == latest for value in timestamps) != 1:
        return None
    return submissions[timestamps.index(latest)]


def _classwork_metrics(
    rows: list[tuple[ClassworkAssignment, Classwork, StudentSubmission | None, bool]],
) -> tuple[dict[str, float | None], dict[str, Any]]:
    earned = {component: Decimal("0") for component in COMPONENT_FEATURES}
    possible = {component: Decimal("0") for component in COMPONENT_FEATURES}
    expected = len(rows)
    completed = 0
    graded = 0
    unresolved = 0
    missing = 0
    due_total = 0
    on_time = 0
    late = 0
    lateness_unresolved = False
    components_present: set[str] = set()
    for assignment, classwork, submission, submission_unresolved in rows:
        component = map_classwork_category(classwork.classwork_type, classwork.classwork_category)
        components_present.add(component)
        if submission_unresolved:
            unresolved += 1
            lateness_unresolved = True
            continue
        status = (submission.status or "pending").lower() if submission else "pending"
        if status in {"submitted", "graded", "late"}:
            completed += 1
        elif status == "missed":
            missing += 1
        if submission and submission.grade is not None and classwork.total_points is not None:
            graded += 1
            possible[component] += Decimal(str(classwork.total_points))
            earned[component] += Decimal(str(submission.grade))
        if assignment.due_date is not None:
            due_total += 1
            if submission is None:
                continue
            if submission.submitted_at is None and status != "late":
                lateness_unresolved = True
                continue
            if status == "late" or (
                submission.submitted_at is not None
                and _as_utc(submission.submitted_at) > _as_utc(assignment.due_date)
            ):
                late += 1
            else:
                on_time += 1
    unresolved_state = "UNRESOLVED" if unresolved else None
    completion = completed / expected if expected and not unresolved else None
    coverage = graded / expected if expected and graded and not unresolved else None
    component_features = {
        name: _component_percent(earned[component], possible[component])
        for component, name in COMPONENT_FEATURES.items()
    }
    return component_features, {
        "expected_count": expected,
        "completed_count": completed,
        "graded_count": graded,
        "missing_count": missing,
        "unresolved_submission_count": unresolved,
        "completion_rate": completion,
        "completion_state": unresolved_state or ("AVAILABLE" if expected else "NO_EXPECTED_ITEMS"),
        "coverage_rate": coverage,
        "coverage_state": unresolved_state or ("AVAILABLE" if graded else ("NO_RECORDED_DATA" if expected else "NO_EXPECTED_ITEMS")),
        "late_count": None if lateness_unresolved else late,
        "late_state": "UNRESOLVED" if lateness_unresolved else ("AVAILABLE" if due_total else "NO_DUE_DATES"),
        "on_time_rate": (on_time / due_total) if due_total and not lateness_unresolved else None,
        "components_present": sorted(components_present),
    }


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _component_features(
    assessment_rows: list[tuple[AssessmentItem, StudentAssessmentScore | None]],
    classwork_rows: list[tuple[Classwork, StudentSubmission | None]] | None = None,
) -> tuple[dict[str, float | None], dict[str, Any]]:
    earned_by_component = {component: Decimal("0") for component in COMPONENT_FEATURES}
    possible_by_component = {component: Decimal("0") for component in COMPONENT_FEATURES}
    components_present: set[str] = set()
    recorded_count = 0
    submitted_count = 0
    missing_count = 0

    expected_count = len(assessment_rows) + (len(classwork_rows) if classwork_rows else 0)

    for assessment, score in assessment_rows:
        component = assessment.component_type
        if component in {"PERIODICAL_EXAM", "PERIODICAL_ASSESSMENT", "EXAMS", "EXAM", "SUMMATIVE_1", "SUMMATIVE_2", "TERM_EXAM"}:
            component = "QUARTERLY_ASSESSMENT"
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

    if classwork_rows:
        for cw, sub in classwork_rows:
            if not getattr(cw, "is_graded", True) or (getattr(cw, "classwork_type", "") or "").upper() == "READING":
                continue
            component = map_classwork_category(cw.classwork_type, cw.classwork_category)
            if component not in COMPONENT_FEATURES:
                continue
            components_present.add(component)
            if cw.total_points:
                possible_by_component[component] += Decimal(str(cw.total_points))
            if sub is None or sub.status not in {"graded", "submitted"}:
                missing_count += 1
                continue
            if sub.status in {"graded", "submitted"}:
                submitted_count += 1
                if sub.status == "graded" and sub.grade is not None:
                    earned_by_component[component] += Decimal(str(sub.grade))
                    recorded_count += 1

    features = {
        feature_name: _component_percent(earned_by_component[component], possible_by_component[component])
        for component, feature_name in COMPONENT_FEATURES.items()
    }
    summary = {
        "expected_assessment_count": expected_count,
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
) -> tuple[int, int, str | None]:
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
        return 0, 0, "No published classwork assignments were available for late-submission evidence."

    assignments_with_due_date = [row for row in rows if row[0].due_date]
    total_due_dates = len(assignments_with_due_date)
    if total_due_dates == 0:
        return 0, 0, "Classwork due dates are not available; late_submission_count defaulted to 0."

    late_count = 0
    for assignment, submission in assignments_with_due_date:
        if submission is None or submission.submitted_at is None:
            continue
        due_date = assignment.due_date
        submitted_at = submission.submitted_at
        if due_date.tzinfo is None:
            due_date = due_date.replace(tzinfo=timezone.utc)
        if submitted_at.tzinfo is None:
            submitted_at = submitted_at.replace(tzinfo=timezone.utc)
        if submitted_at > due_date or (submission.status or "").lower() == "late":
            late_count += 1
    return late_count, total_due_dates, None


def compute_behavioral_engagement_score(
    risk_adjusted_attendance_rate: float | None,
    on_time_submission_rate: float | None,
    assessment_completion_rate: float | None,
    db: Session | None = None,
) -> float | None:
    """Compute the Consolidated Behavioral Engagement Score (0.0 - 100.0%).

    Uses configurable weights from RiskThreshold (loaded via RiskEngine.load_active_thresholds)
    or default fallbacks:
    - attendance_weight: 0.40
    - ontime_weight: 0.35
    - participation_weight: 0.25

    Dynamically redistributes weights over non-None signals.
    Converts on_time_submission_rate (0-1) and assessment_completion_rate (0-1)
    to a 0-100 scale before computing the weighted score.
    Returns None if all available signals are None.
    """
    weights = {
        "attendance": 0.40,
        "ontime": 0.35,
        "participation": 0.25,
    }

    if db is not None:
        try:
            from app.services.prediction.RiskEngine import load_active_thresholds
            active_thresholds = load_active_thresholds(db)
            for thresh in active_thresholds:
                if thresh.condition_type == "attendance_weight" and thresh.condition_value is not None:
                    weights["attendance"] = float(thresh.condition_value)
                elif thresh.condition_type == "ontime_weight" and thresh.condition_value is not None:
                    weights["ontime"] = float(thresh.condition_value)
                elif thresh.condition_type == "participation_weight" and thresh.condition_value is not None:
                    weights["participation"] = float(thresh.condition_value)
        except Exception:
            pass

    available_signals: dict[str, float] = {}
    if risk_adjusted_attendance_rate is not None:
        available_signals["attendance"] = float(risk_adjusted_attendance_rate)
    if on_time_submission_rate is not None:
        available_signals["ontime"] = float(on_time_submission_rate) * 100.0
    if assessment_completion_rate is not None:
        available_signals["participation"] = float(assessment_completion_rate) * 100.0

    if not available_signals:
        return None

    total_weight = sum(weights[k] for k in available_signals)
    if total_weight <= 0:
        return None

    weighted_sum = sum((weights[k] / total_weight) * available_signals[k] for k in available_signals)
    return round(weighted_sum, 2)


def _prediction_mode(source_period: AcademicPeriod, target_period_id: int | None) -> str:
    if target_period_id is None or target_period_id == source_period.academic_period_id or source_period.is_active:
        return "CURRENT_PERIOD_PROJECTION"
    return "NEXT_PERIOD_PREDICTION"


def check_prediction_readiness(feature_payload: dict[str, Any]) -> dict[str, Any]:
    features = feature_payload.get("features", feature_payload)
    summary = feature_payload.get("evidence_summary") or {}
    coverage = features.get("data_coverage_ratio")
    completion = features.get("assessment_completion_rate")
    source_grade = features.get("source_period_grade")
    reasons: list[str] = []

    if source_grade is None:
        reasons.append("Source period grade is not available.")
    if summary.get("assessment_completion_state") == "UNRESOLVED":
        reasons.append("Activity completion evidence is unresolved.")
    elif completion is None:
        reasons.append("Activity completion evidence is unavailable.")
    elif completion < 0.50:
        reasons.append("Assessment completion rate is below the minimum 50% threshold.")
    if summary.get("data_coverage_state") == "UNRESOLVED":
        reasons.append("Grade coverage evidence is unresolved.")
    elif coverage is None:
        reasons.append("Grade coverage evidence is unavailable.")
    elif coverage < 0.50:
        reasons.append("Data coverage is below the minimum 50% threshold.")

    if reasons:
        level = "INSUFFICIENT"
    elif coverage is not None and coverage < 0.70:
        level = "MINIMUM"
    elif coverage is not None and coverage < 0.85:
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


def _select_grade_with_provenance(row: StudentPeriodGrade | None) -> tuple[float | None, str, str | None]:
    if row is None:
        return None, "NONE", None
    if row.is_finalized and row.final_period_grade is not None:
        return _to_float(row.final_period_grade), "OFFICIAL", "final_period_grade"
    for field in ("final_period_grade", "transmuted_grade", "initial_grade"):
        value = getattr(row, field)
        if value is not None:
            return _to_float(value), "RECORDED_PROVISIONAL", field
    return None, "NONE", None


def _assessment_component_observations(
    rows: list[tuple[AssessmentItem, StudentAssessmentScore | None]],
) -> tuple[dict[str, float | None], dict[str, Any]]:
    earned = {component: Decimal("0") for component in COMPONENT_FEATURES}
    possible = {component: Decimal("0") for component in COMPONENT_FEATURES}
    recorded = 0
    for assessment, score in rows:
        component = assessment.component_type
        if component not in COMPONENT_FEATURES:
            continue
        if score is not None and score.score_status == "RECORDED" and score.raw_score is not None:
            earned[component] += Decimal(str(score.raw_score))
            possible[component] += Decimal(str(assessment.max_score))
            recorded += 1
    return (
        {name: _component_percent(earned[component], possible[component]) for component, name in COMPONENT_FEATURES.items()},
        {
            "assessment_observation_count": recorded,
            "assessment_item_count": len(rows),
            "components_present": sorted({
                assessment.component_type for assessment, _ in rows
                if assessment.component_type in COMPONENT_FEATURES
            }),
            "components_missing": sorted(
                set(COMPONENT_FEATURES) - {
                    assessment.component_type for assessment, _ in rows
                    if assessment.component_type in COMPONENT_FEATURES
                }
            ),
        },
    )


def build_prediction_features_from_records(
    db: Session,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    source_period_id: int,
    target_period_id: int | None = None,
    model_name: str = "entervene_next_period_grade_rf",
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
    assessment_rows = _assessment_rows(db, student_id, class_id, subject_id, source_period_id)
    assessment_components, assessment_summary = _assessment_component_observations(assessment_rows)
    classwork_rows, legacy_classwork_exists = _classwork_rows(
        db, student_id, class_id, subject_id, source_period_id
    )
    classwork_components, classwork_summary = _classwork_metrics(classwork_rows)

    # Activity completion/coverage are classwork-only in Stage 3A. Assessment
    # rows remain a separate score observation because no cross-source identity
    # or assessment-completion authority exists.
    component_features = classwork_components if classwork_rows else assessment_components
    component_source = "CLASSWORK" if classwork_rows else ("ASSESSMENT" if assessment_rows else "NONE")
    completion_rate = classwork_summary["completion_rate"]
    data_coverage_ratio = classwork_summary["coverage_rate"]
    if legacy_classwork_exists and not classwork_rows:
        completion_rate = None
        data_coverage_ratio = None
        classwork_summary["completion_state"] = "UNRESOLVED"
        classwork_summary["coverage_state"] = "UNRESOLVED"
    if classwork_summary["completion_state"] == "UNRESOLVED":
        warnings.append("Classwork submission authority is unresolved; dependent activity evidence was omitted.")
    if legacy_classwork_exists:
        warnings.append("Legacy classwork without academic-period attribution was excluded as unresolved.")

    late_count = classwork_summary["late_count"]
    on_time_submission_rate = classwork_summary["on_time_rate"]
    if classwork_summary["late_state"] == "UNRESOLVED":
        warnings.append("Late-submission evidence is unresolved because the selected submission is not authoritative.")

    from app.services.attendance.AttendanceService import get_risk_adjusted_attendance_rate
    cutoff = min(datetime.now(timezone.utc).date(), source_period.end_date)
    att_summary = get_risk_adjusted_attendance_rate(
        db,
        student_id,
        class_id=class_id,
        subject_id=subject_id,
        start_date=source_period.start_date,
        end_date=source_period.end_date,
        cutoff_date=cutoff,
    )
    risk_adjusted_attendance_rate = att_summary["risk_adjusted_rate"]
    if att_summary["total_days"] == 0:
        warnings.append("No attendance records exist in the requested period through the generation cutoff.")

    behavioral_cold_start = (att_summary["total_days"] == 0 and on_time_submission_rate is None)
    behavioral_score = compute_behavioral_engagement_score(
        risk_adjusted_attendance_rate=risk_adjusted_attendance_rate,
        on_time_submission_rate=on_time_submission_rate,
        assessment_completion_rate=completion_rate,
        db=db,
    )

    evidence_summary = {
        **assessment_summary,
        **classwork_summary,
        "component_source": component_source,
        "assessment_completion_state": classwork_summary["completion_state"],
        "data_coverage_state": classwork_summary["coverage_state"],
        "attendance_state": "AVAILABLE" if att_summary["total_days"] else "NO_RECORDED_DATA",
        "attendance_start_date": source_period.start_date.isoformat(),
        "attendance_end_date": source_period.end_date.isoformat(),
        "generation_cutoff_date": cutoff.isoformat(),
    }
    evidence_summary["attendance_total_days"] = att_summary["total_days"]
    evidence_summary["attendance_present_count"] = att_summary["present_count"]
    evidence_summary["attendance_absent_count"] = att_summary["absent_count"]
    evidence_summary["attendance_late_count"] = att_summary["late_count"]
    evidence_summary["attendance_excused_count"] = att_summary["excused_count"]
    evidence_summary["risk_adjusted_attendance_rate"] = risk_adjusted_attendance_rate
    evidence_summary["on_time_submission_rate"] = on_time_submission_rate
    evidence_summary["behavioral_engagement_score"] = behavioral_score
    evidence_summary["behavioral_score_cold_start"] = behavioral_cold_start
    evidence_summary["late_submission_count"] = late_count

    period_grade = _period_grade(db, student_id, class_id, subject_id, source_period_id)
    source_period_grade, grade_provenance, grade_field = _select_grade_with_provenance(period_grade)
    if period_grade is not None:
        for column in ("written_work_percent", "performance_task_percent", "quarterly_assessment_percent"):
            if component_features.get(column) is None:
                component_features[column] = _to_float(getattr(period_grade, column))

    if source_period_grade is None:
        source_period_grade = _running_grade(component_features)
        if source_period_grade is not None:
            grade_provenance, grade_field = "ESTIMATED", "equal_component_average"
            warnings.append("Source period grade was estimated from available assessment component percentages.")

    previous = _previous_period(db, source_period)
    previous_grade = None
    if previous is not None:
        previous_row = _period_grade(db, student_id, class_id, subject_id, previous.academic_period_id)
        if previous_row is not None:
            previous_grade, _, _ = _select_grade_with_provenance(previous_row)
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
    # Fallback grade_level from class_.academic_level if student.academic_level is None
    _grade_level = getattr(student.academic_level, "grade_level", None)
    if _grade_level is None and class_ is not None and getattr(class_, "academic_level", None) is not None:
        _grade_level = class_.academic_level.grade_level

    features: dict[str, Any] = {
        "grade_level": _grade_level,
        "period_sequence": _normalised_period_sequence,
        "source_period_grade": source_period_grade,
        "written_work_percent": component_features["written_work_percent"],
        "performance_task_percent": component_features["performance_task_percent"],
        "quarterly_assessment_percent": component_features["quarterly_assessment_percent"],
        "assessment_completion_rate": _round_or_none(completion_rate),
        "missing_activity_count": classwork_summary["missing_count"],
        "late_submission_count": late_count,
        "data_coverage_ratio": _round_or_none(data_coverage_ratio),
        "grade_trend_vs_previous_period": trend,
        "has_previous_period": has_previous,
        "behavioral_engagement_score": behavioral_score,
        "behavioral_score_cold_start": behavioral_cold_start,
        "risk_adjusted_attendance_rate": risk_adjusted_attendance_rate,
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
        )
        .all()
    )
    grades = [_select_grade_with_provenance(row)[0] for row in previous_grades]
    grades = [grade for grade in grades if grade is not None]
    if grades:
        features["cumulative_period_grade_avg"] = round(sum(grades) / len(grades), 2)
    subject_feature = _subject_feature_name(subject)
    if subject_feature:
        features[subject_feature] = 1
    evidence_summary["source_grade_provenance"] = grade_provenance
    evidence_summary["source_grade_field"] = grade_field

    readiness = check_prediction_readiness({"features": features, "evidence_summary": evidence_summary})
    # READY is a model contract: validate the exact registered vector before
    # callers can attempt scoring. The same prepare_feature_row path is used by
    # ModelScoringService.
    if readiness["ready"]:
        try:
            from app.services.prediction.ModelScoringService import (
                DEFAULT_MODEL_NAME,
                get_active_model_version,
                load_feature_schema_from_model_version,
                prepare_feature_row,
            )
            model_version = get_active_model_version(db, model_name or DEFAULT_MODEL_NAME)
            prepare_feature_row(features, load_feature_schema_from_model_version(model_version))
        except (LookupError, ValueError) as exc:
            readiness = {
                "ready": False,
                "readiness_level": "INSUFFICIENT",
                "reasons": [*readiness["reasons"], f"Model input is unavailable: {exc}"],
            }
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
