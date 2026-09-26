# app/api/v1/routes/Activities.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.Dependencies import get_staff_id, require_role
from app.db.Session import get_db
from app.schemas.Activity import (
    ActivityCreateRequest,
    ActivityScoresResponse,
    BulkScoreUpdateRequest,
)
from app.schemas.ActivityCoverage import ActivityCoverageResponse, ActivityCoverageUpdate
from app.services.activity.ActivityCoverageService import get_manual_activity_coverage, replace_manual_activity_coverage
from app.services.activity.ActivityService import (
    bulk_update_activity_scores,
    create_activity,
    delete_activity as delete_activity_service,
    get_activity_scores,
)

router = APIRouter()


@router.get("/{activity_id}/coverage", response_model=ActivityCoverageResponse)
def get_coverage_endpoint(
    activity_id: int,
    class_id: int = Query(...),
    _teacher: dict = Depends(require_role("teacher")),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return get_manual_activity_coverage(db, staff_id, activity_id, class_id)


@router.put("/{activity_id}/coverage", response_model=ActivityCoverageResponse)
def replace_coverage_endpoint(
    activity_id: int,
    body: ActivityCoverageUpdate,
    class_id: int = Query(...),
    _teacher: dict = Depends(require_role("teacher")),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return replace_manual_activity_coverage(db, staff_id, activity_id, class_id, body)


@router.post("", response_model=dict)
@router.post("/", response_model=dict)
def create_activity_endpoint(
    body: ActivityCreateRequest,
    current_user: dict = Depends(require_role("teacher", "admin")),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "teacher" and body.activity_mode == "MANUAL" and body.lesson_ids:
        raise HTTPException(status_code=403, detail="Only teachers may link manual activity coverage")
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
