from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIPredictionFeature import AIPredictionFeature
from app.models.ai.PredictionOutcome import PredictionOutcome
from app.models.ai.TeacherRiskReview import TeacherRiskReview
from app.models.people.Student import Student
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.AcademicLevel import AcademicLevel
from app.services.prediction.PredictionExplanationService import (
    build_prediction_causes,
    build_recommended_actions,
)
from app.services.prediction.TeacherAssignmentResolver import resolve_teacher_for_load
from app.services.prediction.TeacherEvidenceService import teacher_evidence_from_snapshot


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
    if student.student_lrn:
        return f"Student {student.student_lrn}"
    return f"Student {str(student.student_id)[:8]}"


def _model_version(version: AIModelVersion | None) -> dict[str, Any] | None:
    if version is None:
        return None
    return {
        "model_version_id": version.model_version_id,
        "model_name": version.model_name,
        "model_type": version.model_type,
        "algorithm": version.algorithm,
        "is_active": bool(version.is_active),
    }


def _feature(row: AIPredictionFeature) -> dict[str, Any]:
    return {
        "feature_id": row.feature_id,
        "feature_name": row.feature_name,
        "feature_value": _to_float(row.feature_value),
        "feature_contribution": _to_float(row.feature_contribution),
        "direction": row.direction,
        "feature_rank": row.feature_rank,
        "explanation_method": row.explanation_method,
    }


def _outcome(row: PredictionOutcome | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "outcome_id": row.outcome_id,
        "actual_period_grade": _to_float(row.actual_period_grade),
        "prediction_error": _to_float(row.prediction_error),
        "absolute_error": _to_float(row.absolute_error),
        "actual_passed": row.actual_passed,
        "actual_risk_label": row.actual_risk_label,
        "outcome_status": row.outcome_status,
        "evaluated_at": row.evaluated_at,
    }


def _review(row: TeacherRiskReview) -> dict[str, Any]:
    return {
        "review_id": row.review_id,
        "prediction_id": row.prediction_id,
        "staff_id": row.reviewed_by_staff_id,
        "decision": row.review_decision,
        "teacher_notes": row.teacher_notes,
        "reviewed_at": row.reviewed_at,
    }


def _load_prediction(db: Session, prediction_id: int) -> AIPrediction:
    prediction = db.get(AIPrediction, prediction_id)
    if prediction is None:
        raise LookupError("Prediction not found.")
    return prediction


def _features(db: Session, prediction_id: int) -> list[AIPredictionFeature]:
    return (
        db.query(AIPredictionFeature)
        .filter(AIPredictionFeature.prediction_id == prediction_id)
        .order_by(AIPredictionFeature.feature_rank.asc(), AIPredictionFeature.feature_id.asc())
        .all()
    )


def _latest_outcome(db: Session, prediction_id: int) -> PredictionOutcome | None:
    return (
        db.query(PredictionOutcome)
        .filter(PredictionOutcome.prediction_id == prediction_id)
        .order_by(PredictionOutcome.evaluated_at.desc().nullslast(), PredictionOutcome.outcome_id.desc())
        .first()
    )


def _reviews(db: Session, prediction_id: int, staff_id: str | None = None) -> list[TeacherRiskReview]:
    query = db.query(TeacherRiskReview).filter(TeacherRiskReview.prediction_id == prediction_id)
    if staff_id is not None:
        query = query.filter(TeacherRiskReview.reviewed_by_staff_id == staff_id)
    return query.order_by(TeacherRiskReview.reviewed_at.desc(), TeacherRiskReview.review_id.desc()).all()


def get_teacher_reviews_for_prediction(
    db: Session,
    prediction_id: int,
    staff_id: str | None = None,
    current_user_only: bool = False,
) -> dict[str, Any]:
    _load_prediction(db, prediction_id)
    review_rows = _reviews(db, prediction_id, staff_id if current_user_only else None)
    current_user_review = None
    if staff_id is not None:
        current_user_review = next((_review(row) for row in _reviews(db, prediction_id, staff_id)), None)
    return {
        "prediction_id": prediction_id,
        "teacher_reviews": [_review(row) for row in review_rows],
        "current_user_review": current_user_review,
    }


def get_prediction_detail(
    db: Session,
    prediction_id: int,
    staff_id: str | None = None,
    is_admin: bool = True,
) -> dict[str, Any]:
    prediction = _load_prediction(db, prediction_id)

    # Resolve responsible teacher assignment using canonical triplet resolver
    teacher_info = resolve_teacher_for_load(
        db,
        prediction.class_id,
        prediction.subject_id,
        prediction.target_period_id,
    )

    # Server-side teacher role isolation
    if not is_admin:
        if not staff_id or teacher_info.staff_id != staff_id:
            raise PermissionError("Access denied. You are not assigned to this class, subject, and term.")

    # Retrieve relational entities for display
    student = db.get(Student, prediction.student_id)
    student_name = _format_student_name(student)
    student_lrn = student.student_lrn if student else None

    class_obj = db.get(Class, prediction.class_id)
    class_name = class_obj.section_name if class_obj else None

    grade_level = None
    level_name = None
    if class_obj and class_obj.academic_level_id:
        level_obj = db.get(AcademicLevel, class_obj.academic_level_id)
        if level_obj:
            grade_level = level_obj.grade_level
            level_name = level_obj.level_name

    subject_obj = db.get(Subject, prediction.subject_id)
    subject_name = subject_obj.subject_name if subject_obj else None
    subject_codename = subject_obj.subject_codename if subject_obj else None

    feature_rows = _features(db, prediction_id)
    teacher_evidence = teacher_evidence_from_snapshot(prediction.evidence_snapshot)
    # Audited rows have a saved teacher projection; do not feed legacy feature
    # aliases back into an explanation for an immutable historical prediction.
    causes = [] if prediction.evidence_snapshot is not None else build_prediction_causes(prediction, feature_rows)
    review_rows = _reviews(db, prediction_id)
    current_user_review = None
    if staff_id is not None:
        current_user_review = next((_review(row) for row in _reviews(db, prediction_id, staff_id)), None)

    return {
        "prediction_id": prediction.prediction_id,
        "student_id": prediction.student_id,
        "student_name": student_name,
        "student_lrn": student_lrn,
        "grade_level": grade_level,
        "level_name": level_name,
        "class_id": prediction.class_id,
        "class_name": class_name,
        "subject_id": prediction.subject_id,
        "subject_name": subject_name,
        "subject_codename": subject_codename,
        "teacher_name": teacher_info.teacher_name,
        "teacher_staff_id": teacher_info.staff_id,
        "teacher_status_label": teacher_info.status_label,
        "is_substitute": teacher_info.is_substitute,
        "substitution_id": teacher_info.substitution_id,
        "substitute_start_date": teacher_info.substitute_start_date,
        "substitute_end_date": teacher_info.substitute_end_date,
        "original_teacher_name": teacher_info.original_teacher_name,
        "source_period_id": prediction.source_period_id,
        "target_period_id": prediction.target_period_id,
        "predicted_period_grade": _to_float(prediction.predicted_period_grade),
        "risk_score": _to_float(prediction.risk_score),
        "risk_level": prediction.risk_level,
        "data_status": prediction.data_status,
        "generated_at": prediction.generated_at,
        "model_version": _model_version(prediction.model_version),
        "features": [] if prediction.evidence_snapshot is not None else [_feature(row) for row in feature_rows],
        "prediction_status": teacher_evidence["prediction_status"],
        "model_execution": teacher_evidence["model_execution"],
        "evidence": teacher_evidence["evidence"],
        "interpretations": teacher_evidence["interpretations"],
        "limitations": teacher_evidence["limitations"],
        "causes": causes,
        "recommended_actions": build_recommended_actions(prediction, causes),
        "outcome": _outcome(_latest_outcome(db, prediction_id)),
        "teacher_reviews": [_review(row) for row in review_rows],
        "current_user_review": current_user_review,
    }
