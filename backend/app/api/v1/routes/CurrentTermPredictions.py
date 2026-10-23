from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.Dependencies import require_role
from app.db.Session import get_db
from app.models.ai.AIModelVersion import ModelPurpose
from app.services.prediction import DevelopmentCurrentTermPredictionReadService as read_service
from app.services.prediction.CurrentTermV3Domain import resolve_v3_academic_scope
from app.services.prediction.ModelVersionService import get_production_model_versions
from app.services.prediction.V3PredictionScopeAuthorizationService import authorize_v3_prediction_view


router = APIRouter()


def _approved_current_term_model(db: Session):
    versions = get_production_model_versions(
        db,
        ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION,
    )
    if len(versions) != 1:
        raise HTTPException(
            status_code=503,
            detail="Approved current-term prediction model is unavailable.",
        )
    return versions[0]


@router.get("")
def list_current_term_predictions(
    class_id: int = Query(..., gt=0),
    subject_id: int = Query(..., gt=0),
    academic_period_id: int = Query(..., gt=0),
    current_user: dict = Depends(require_role("admin", "teacher")),
    db: Session = Depends(get_db),
) -> dict:
    access = authorize_v3_prediction_view(
        db,
        current_user,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
    )
    domain = resolve_v3_academic_scope(db, class_id, subject_id)
    if not domain["supported"]:
        raise HTTPException(
            status_code=404,
            detail="Current-term predictions are unavailable for this academic scope.",
        )
    version = _approved_current_term_model(db)
    return read_service.list_latest_development_current_term_predictions(
        db,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
        model_version_id=version.model_version_id,
        require_active_enrollment=access.require_active_enrollment,
        lifecycle_status="PRODUCTION",
    )
