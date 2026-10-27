"""Authenticated student reads and reviews of their own active persistent Interventions."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.v1.routes.TeacherInterventions import require_development_intervention_api
from app.core.Dependencies import get_student_record
from app.db.Session import get_db
from app.schemas.StudentPersistentIntervention import (
    ReviewReadingRequest,
    StudentPersistentIntervention,
    StudentPersistentInterventionList,
    StudentReadingReviewResponse,
)
from app.services.intervention.InterventionReadingReviewService import (
    acknowledge_intervention_reading_review,
    intervention_reading_reviews,
)
from app.services.intervention.StudentPersistentInterventionService import (
    get_active,
    get_resolved,
    list_active,
    list_resolved,
)


router = APIRouter(dependencies=[Depends(require_development_intervention_api)])


@router.get("", response_model=StudentPersistentInterventionList)
def list_mine(student=Depends(get_student_record), db: Session = Depends(get_db)):
    return list_active(db, student.student_id)


@router.get("/resolved", response_model=StudentPersistentInterventionList)
def list_previous(student=Depends(get_student_record), db: Session = Depends(get_db)):
    return list_resolved(db, student.student_id)


@router.get("/resolved/{intervention_id}", response_model=StudentPersistentIntervention)
def read_previous(intervention_id: int, student=Depends(get_student_record), db: Session = Depends(get_db)):
    return get_resolved(db, student.student_id, intervention_id)


@router.get("/{intervention_id}", response_model=StudentPersistentIntervention)
def read_mine(intervention_id: int, student=Depends(get_student_record), db: Session = Depends(get_db)):
    return get_active(db, student.student_id, intervention_id)


@router.post(
    "/{intervention_id}/readings/{reading_assignment_id}/review",
    response_model=StudentReadingReviewResponse,
)
@router.post(
    "/{intervention_id}/readings/{reading_assignment_id}/acknowledge",
    response_model=StudentReadingReviewResponse,
)
@router.post(
    "/{intervention_id}/readings/{reading_assignment_id}",
    response_model=StudentReadingReviewResponse,
)
def review_reading_path(
    intervention_id: int,
    reading_assignment_id: int,
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    review = acknowledge_intervention_reading_review(
        db,
        intervention_id=intervention_id,
        reading_assignment_id=reading_assignment_id,
        student=student,
    )
    return StudentReadingReviewResponse.model_validate(review)


@router.post(
    "/{intervention_id}/reviews",
    response_model=StudentReadingReviewResponse,
)
def create_review_body(
    intervention_id: int,
    payload: ReviewReadingRequest,
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    target_id = payload.reading_assignment_id or payload.assignment_id
    if target_id is None:
        raise HTTPException(
            status_code=400,
            detail="reading_assignment_id is required",
        )
    review = acknowledge_intervention_reading_review(
        db,
        intervention_id=intervention_id,
        reading_assignment_id=target_id,
        student=student,
    )
    return StudentReadingReviewResponse.model_validate(review)


@router.get(
    "/{intervention_id}/reviews",
    response_model=list[StudentReadingReviewResponse],
)
def list_reviews(
    intervention_id: int,
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    reviews = intervention_reading_reviews(
        db,
        intervention_id=intervention_id,
        student=student,
    )
    return [StudentReadingReviewResponse.model_validate(r) for r in reviews]

