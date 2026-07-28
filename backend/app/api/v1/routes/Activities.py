# app/api/v1/routes/Activities.py
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.Dependencies import get_staff_id
from app.db.Session import get_db
from app.schemas.Activity import (
    ActivityCreateRequest,
    ActivityScoresResponse,
    BulkScoreUpdateRequest,
)
from app.services.activity.ActivityService import (
    bulk_update_activity_scores,
    create_activity,
    delete_activity as delete_activity_service,
    get_activity_scores,
)

router = APIRouter()


@router.post("", response_model=dict)
@router.post("/", response_model=dict)
def create_activity_endpoint(
    body: ActivityCreateRequest,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return create_activity(db, staff_id, body)


@router.get("/{activity_id}/scores", response_model=ActivityScoresResponse)
def get_scores_endpoint(
    activity_id: int,
    class_id: int = Query(...),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return get_activity_scores(db, staff_id, activity_id, class_id)


@router.put("/{activity_id}/scores", response_model=ActivityScoresResponse)
def bulk_update_scores_endpoint(
    activity_id: int,
    body: BulkScoreUpdateRequest,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return bulk_update_activity_scores(db, staff_id, activity_id, body)


@router.delete("/{activity_id}", response_model=dict)
def delete_activity_endpoint(
    activity_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return delete_activity_service(db, staff_id, activity_id)
