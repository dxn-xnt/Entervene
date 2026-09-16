"""
PredictionSuggestionService.py
==============================
Service layer for converting AIPrediction recommendations into persistent
StudentSuggestion records and logging TeacherRiskReview entries.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.TeacherRiskReview import TeacherRiskReview
from app.models.suggestion.StudentSuggestion import StudentSuggestion
from app.models.suggestion.SuggestionClasswork import SuggestionClasswork


def assign_intervention_from_prediction(
    db: Session,
    prediction_id: int,
    staff_id: str | None,
    payload: dict[str, Any],
) -> StudentSuggestion:
    """
    Create a persistent StudentSuggestion linked to an AIPrediction.
    Also creates SuggestionClasswork if resource_type == 'CLASSWORK'
    and logs a TeacherRiskReview entry.
    """
    prediction = (
        db.query(AIPrediction)
        .filter(AIPrediction.prediction_id == prediction_id)
        .first()
    )
    if not prediction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prediction ID {prediction_id} not found.",
        )

    resource_type = payload.get("resource_type", "LESSON").upper()
    if resource_type not in ("LESSON", "CLASSWORK"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="resource_type must be either 'LESSON' or 'CLASSWORK'.",
        )

    title = payload.get("title") or "AI Recommended Intervention"
    description = payload.get("description")
    priority = payload.get("priority", "HIGH")

    # Validate staff_id exists in AcademicStaff table (e.g. admin accounts vs staff IDs)
    valid_staff_id = None
    if staff_id:
        from app.models.people.AcademicStaff import AcademicStaff
        staff_exists = (
            db.query(AcademicStaff)
            .filter(AcademicStaff.staff_id == staff_id)
            .first()
        )
        if staff_exists:
            valid_staff_id = staff_id

    # Auto-resolve lesson_id if resource_type == 'LESSON' and lesson_id not provided
    lesson_id = payload.get("lesson_id")
    if resource_type == "LESSON" and not lesson_id:
        from app.models.academic.Lesson import Lesson
        existing_lesson = (
            db.query(Lesson)
            .filter(Lesson.subject_id == prediction.subject_id)
            .first()
        )
        if existing_lesson:
            lesson_id = existing_lesson.lesson_id
        else:
            # Create a default remedial lesson for this subject
            new_lesson = Lesson(
                subject_id=prediction.subject_id,
                title=f"Remedial Module: {title}",
                description="AI-generated remedial lesson for student intervention.",
                is_published=True,
                is_draft=False,
                created_by_staff_id=valid_staff_id,
            )
            db.add(new_lesson)
            db.flush()
            lesson_id = new_lesson.lesson_id

    # Create StudentSuggestion
    suggestion = StudentSuggestion(
        student_id=prediction.student_id,
        subject_id=prediction.subject_id,
        suggestion_type="AUTOMATED",
        resource_type=resource_type,
        lesson_id=lesson_id if resource_type == "LESSON" else None,
        prediction_id=prediction_id,
        created_by_staff_id=valid_staff_id,
        title=title,
        description=description,
        priority=priority,
        status="ACTIVE",
    )
    db.add(suggestion)
    db.flush()  # Gets student_suggestion_id

    # If classwork, add link row
    if resource_type == "CLASSWORK":
        classwork_assignment_id = payload.get("classwork_assignment_id")
        if not classwork_assignment_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="classwork_assignment_id is required when resource_type is CLASSWORK.",
            )
        classwork_link = SuggestionClasswork(
            student_suggestion_id=suggestion.student_suggestion_id,
            classwork_assignment_id=classwork_assignment_id,
            is_completed=False,
        )
        db.add(classwork_link)

    # Log TeacherRiskReview
    review = TeacherRiskReview(
        prediction_id=prediction_id,
        student_id=prediction.student_id,
        reviewed_by_staff_id=valid_staff_id,
        review_decision="INTERVENTION_ASSIGNED",
        teacher_notes=f"Assigned intervention: {title}",
    )
    db.add(review)

    db.commit()
    db.refresh(suggestion)
    return suggestion


def get_suggestions_for_prediction(
    db: Session, prediction_id: int
) -> list[StudentSuggestion]:
    """Fetch all StudentSuggestion records linked to a specific prediction."""
    return (
        db.query(StudentSuggestion)
        .options(
            joinedload(StudentSuggestion.lesson),
            joinedload(StudentSuggestion.classwork_link).joinedload(
                SuggestionClasswork.classwork_assignment
            ),
        )
        .filter(StudentSuggestion.prediction_id == prediction_id)
        .order_by(StudentSuggestion.created_at.desc())
        .all()
    )
