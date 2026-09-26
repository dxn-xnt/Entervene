"""Teacher-only review of corrected development Intervention candidates."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from uuid import UUID

from app.core.Config import settings
from app.core.Dependencies import get_staff_id, require_role
from app.db.Session import get_db
from app.models.auth.Role import Role
from app.models.auth.UserRoles import UserRoles
from app.schemas.TeacherIntervention import TeacherInterventionDetail, TeacherInterventionList
from app.services.intervention.TeacherInterventionService import (
    activate_teacher_candidate, get_teacher_candidate, list_teacher_candidates,
)
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME


def require_development_intervention_api() -> None:
    if (
        settings.app_environment.lower() not in {"development", "test"}
        or not settings.development_prediction_api_enabled
        or settings.development_current_term_model_name != CORRECTED_MODEL_NAME
    ):
        raise HTTPException(status_code=404, detail="Not found")


def require_intervention_teacher(
    current_user: dict = Depends(require_role("teacher")),
    db: Session = Depends(get_db),
) -> dict:
    user_id = current_user.get("sub") or current_user.get("user_id")
    try:
        parsed_id = UUID(str(user_id))
    except (TypeError, ValueError):
        raise HTTPException(status_code=403, detail="Teacher identity is invalid") from None
    has_admin_role = db.query(UserRoles.user_id).join(Role, UserRoles.role_id == Role.role_id).filter(
        UserRoles.user_id == parsed_id, func.lower(Role.role_name) == "admin",
    ).first() is not None
    if has_admin_role:
        raise HTTPException(status_code=403, detail="Admin accounts cannot manage interventions")
    return current_user


router = APIRouter(dependencies=[Depends(require_development_intervention_api)])


@router.get("/candidates", response_model=TeacherInterventionList)
def list_candidates_endpoint(
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return list_teacher_candidates(db, staff_id)


@router.get("/candidates/{intervention_id}", response_model=TeacherInterventionDetail)
def get_candidate_endpoint(
    intervention_id: int,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return get_teacher_candidate(db, staff_id, intervention_id)


@router.post("/candidates/{intervention_id}/activate", response_model=TeacherInterventionDetail)
def activate_candidate_endpoint(
    intervention_id: int,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return activate_teacher_candidate(db, staff_id, intervention_id)
