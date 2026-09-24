from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.Config import settings
from app.core.Dependencies import require_role
from app.db.Session import get_db
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.services.prediction import DevelopmentCurrentTermPredictionPersistenceService as persistence
from app.services.prediction import DevelopmentCurrentTermPredictionReadService as read_service
from app.services.prediction import DevelopmentCurrentTermPredictionService as prediction
from app.services.prediction import DevelopmentCurrentTermRiskService as intervention
from app.services.prediction import DevelopmentCurrentTermScoringService as scorer
from app.services.prediction.DevelopmentCurrentTermModelSelection import MODEL_NAMES, selected_development_model_name, require_development_model_name
from app.services.prediction.V3PredictionScopeAuthorizationService import (
    authorize_v3_prediction_view,
)


router = APIRouter()


class DevelopmentCurrentTermRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    student_id: UUID
    class_id: int = Field(gt=0)
    subject_id: int = Field(gt=0)
    source_period_id: int = Field(gt=0)
    target_period_id: int | None = Field(default=None, gt=0)


def require_development_prediction_api() -> None:
    if (
        settings.app_environment.lower() not in {"development", "test"}
        or not settings.development_prediction_api_enabled
    ):
        raise HTTPException(status_code=404, detail="Not found")


def _registered_v3(db: Session, model_name: str | None = None) -> AIModelVersion:
    try:
        name = require_development_model_name(model_name or selected_development_model_name())
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    versions = db.query(AIModelVersion).filter(
        AIModelVersion.model_name == name,
        AIModelVersion.model_purpose == ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value,
        AIModelVersion.lifecycle_status == "DEVELOPMENT",
        AIModelVersion.production_validated.is_(False),
        AIModelVersion.independent_three_term_validation.is_(False),
        AIModelVersion.is_active.is_(False),
    ).all()
    if len(versions) != 1:
        raise HTTPException(status_code=503, detail="Selected development model registry entry unavailable")
    return versions[0]


@router.post("/current-term-predictions", dependencies=[Depends(require_development_prediction_api)])
def generate_development_current_term_prediction(
    request: DevelopmentCurrentTermRequest,
    _admin: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
) -> dict:
    version = _registered_v3(db)
    target = request.target_period_id or request.source_period_id
    if target != request.source_period_id:
        blocked = prediction.predict_development_current_term(
            db, request.student_id, request.class_id, request.subject_id,
            request.source_period_id, target, model_name=version.model_name,
        )
        assessment = intervention.assess_development_current_term_intervention(blocked)
        return {
            "persisted": False,
            "prediction_status": blocked["status"],
            "intervention_level": assessment["intervention_level"],
            "reason_codes": assessment["upstream_reason_codes"],
            "readiness_status": "NOT_READY",
            "readiness_level": None,
            "readiness_reason_codes": blocked["readiness_reason_codes"],
            "source_period_id": request.source_period_id,
            "target_period_id": target,
            "prediction_purpose": blocked["prediction_purpose"],
            "model_name": version.model_name,
            "model_version_id": version.model_version_id,
            "lifecycle_status": version.lifecycle_status,
            "development_status": blocked["model_development_status"],
        }
    try:
        result = persistence.generate_and_persist_development_current_term(
            request.student_id, request.class_id, request.subject_id,
            request.source_period_id, model_version_id=version.model_version_id,
            bind=db.get_bind(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    result.pop("risk_score", None)
    return result


@router.get("/current-term-predictions", dependencies=[Depends(require_development_prediction_api)])
def list_development_current_term_predictions(
    class_id: int = Query(..., gt=0),
    subject_id: int = Query(..., gt=0),
    academic_period_id: int = Query(..., gt=0),
    model_version_id: int | None = Query(default=None, gt=0),
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
    if model_version_id is None:
        version = _registered_v3(db)
    else:
        version = db.get(AIModelVersion, model_version_id)
        if version is None or version.model_name not in MODEL_NAMES or version.model_purpose != ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value or version.lifecycle_status != "DEVELOPMENT":
            raise HTTPException(status_code=404, detail="Development model history unavailable")
    return read_service.list_latest_development_current_term_predictions(
        db,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
        model_version_id=version.model_version_id,
        require_active_enrollment=access.require_active_enrollment,
    )
