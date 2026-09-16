from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.TeacherRiskReview import TeacherRiskReview


ALLOWED_REVIEW_DECISIONS = {
    "CONFIRMED_RISK",
    "DISMISSED_RISK",
    "NEEDS_MORE_DATA",
    "INTERVENTION_ASSIGNED",
    "ESCALATED",
}


def _review_result(review: TeacherRiskReview) -> dict[str, Any]:
    return {
        "review_id": review.review_id,
        "prediction_id": review.prediction_id,
        "staff_id": review.reviewed_by_staff_id,
        "decision": review.review_decision,
        "teacher_notes": review.teacher_notes,
        "reviewed_at": review.reviewed_at,
    }


def _existing_review(db: Session, prediction_id: int, staff_id: str) -> TeacherRiskReview | None:
    return (
        db.query(TeacherRiskReview)
        .filter(
            TeacherRiskReview.prediction_id == prediction_id,
            TeacherRiskReview.reviewed_by_staff_id == staff_id,
        )
        .order_by(TeacherRiskReview.review_id.asc())
        .first()
    )


def review_prediction_risk(
    db: Session,
    prediction_id: int,
    staff_id: str,
    decision: str,
    teacher_notes: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    prediction = db.get(AIPrediction, prediction_id)
    if prediction is None:
        raise LookupError("Prediction not found.")
    if decision not in ALLOWED_REVIEW_DECISIONS:
        raise ValueError(f"Invalid teacher risk review decision: {decision}")

    review = _existing_review(db, prediction_id, staff_id)
    if review is None:
        review = TeacherRiskReview(
            prediction_id=prediction_id,
            student_id=prediction.student_id,
            reviewed_by_staff_id=staff_id,
        )
        db.add(review)

    review.student_id = prediction.student_id
    review.review_decision = decision
    review.teacher_notes = teacher_notes
    review.reviewed_at = datetime.now(timezone.utc)

    db.flush()
    if commit:
        db.commit()
        db.refresh(review)

    return _review_result(review)
