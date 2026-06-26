from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.Dependencies import get_staff_id, get_student_record
from app.db.Session import get_db
from app.schemas.Suggestion import RecommendationDraftRequest, ManualSuggestionCreate, SuggestionListResponse, SuggestionResponse
from app.services.suggestion.RecommendationService import generate_recommendation_drafts
from app.services.suggestion.SuggestionService import (
    approve_teacher_suggestion,
    archive_teacher_suggestion,
    complete_student_suggestion,
    create_manual_suggestion,
    dismiss_teacher_suggestion,
    get_student_suggestion,
    list_student_suggestions,
    list_teacher_suggestions,
    mark_student_suggestion_viewed,
)


router = APIRouter()


@router.post("/manual", response_model=SuggestionResponse)
def create_manual_study_suggestion(
    body: ManualSuggestionCreate,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return create_manual_suggestion(db, staff_id, body)


@router.post("/recommendations/drafts", response_model=SuggestionListResponse)
def create_recommendation_drafts(
    body: RecommendationDraftRequest,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return generate_recommendation_drafts(db, staff_id, body)


@router.get("/teacher", response_model=SuggestionListResponse)
def get_teacher_study_suggestions(
    class_id: Optional[int] = Query(None),
    subject_id: Optional[int] = Query(None),
    student_id: Optional[UUID] = Query(None),
    status: Optional[str] = Query(None),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return list_teacher_suggestions(
        db,
        staff_id,
        class_id=class_id,
        subject_id=subject_id,
        student_id=student_id,
        status=status,
    )


@router.patch("/{suggestion_id}/dismiss", response_model=SuggestionResponse)
def dismiss_study_suggestion(
    suggestion_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return dismiss_teacher_suggestion(db, staff_id, suggestion_id)


@router.patch("/{suggestion_id}/approve", response_model=SuggestionResponse)
def approve_study_suggestion(
    suggestion_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return approve_teacher_suggestion(db, staff_id, suggestion_id)


@router.patch("/{suggestion_id}/archive", response_model=SuggestionResponse)
def archive_study_suggestion(
    suggestion_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return archive_teacher_suggestion(db, staff_id, suggestion_id)


@router.get("/my", response_model=SuggestionListResponse)
def get_my_study_suggestions(
    status: Optional[str] = Query(None),
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    return list_student_suggestions(db, student, status=status)


@router.get("/my/{suggestion_id}", response_model=SuggestionResponse)
def get_my_study_suggestion(
    suggestion_id: int,
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    return get_student_suggestion(db, student, suggestion_id)


@router.patch("/my/{suggestion_id}/viewed", response_model=SuggestionResponse)
def mark_my_study_suggestion_viewed(
    suggestion_id: int,
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    return mark_student_suggestion_viewed(db, student, suggestion_id)


@router.patch("/my/{suggestion_id}/complete", response_model=SuggestionResponse)
def complete_my_study_suggestion(
    suggestion_id: int,
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    return complete_student_suggestion(db, student, suggestion_id)
