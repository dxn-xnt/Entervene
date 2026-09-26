"""Teacher-only review of corrected development Interventions."""

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
from app.schemas.InterventionSupportMaterial import MaterialCreate, MaterialList, MaterialRead, MaterialUpdate
from app.services.intervention.TeacherInterventionService import (
    activate_teacher_candidate, get_teacher_active, get_teacher_candidate,
    list_teacher_active, list_teacher_candidates,
)
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME
from app.services.intervention.InterventionSupportMaterialService import (
    create_material, get_material, list_materials, update_material,
)
from app.services.intervention.InterventionReviewerGenerationService import generate_reviewer
from app.services.intervention.InterventionReviewerDeliveryService import send_reviewer
from app.services.ai.UsageGuard import actor
from app.services.intervention.InterventionRemediationService import (
    PlanUpdate, generate_advisory, get_workspace, save_plan,
)


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


@router.get("/{intervention_id}/remediation")
def get_remediation_endpoint(
    intervention_id: int, _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id), db: Session = Depends(get_db),
):
    return get_workspace(db, staff_id, intervention_id)


@router.put("/{intervention_id}/remediation")
def save_remediation_endpoint(
    intervention_id: int, body: PlanUpdate, _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id), db: Session = Depends(get_db),
):
    return save_plan(db, staff_id, intervention_id, body)


@router.post("/{intervention_id}/remediation/advisory")
async def generate_remediation_endpoint(
    intervention_id: int, _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id), db: Session = Depends(get_db),
):
    token = actor.set(staff_id)
    try:
        return await generate_advisory(db, staff_id, intervention_id)
    finally:
        actor.reset(token)


@router.get("/candidates", response_model=TeacherInterventionList)
def list_candidates_endpoint(
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return list_teacher_candidates(db, staff_id)


@router.get("/active", response_model=TeacherInterventionList)
def list_active_endpoint(
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return list_teacher_active(db, staff_id)


@router.get("/active/{intervention_id}", response_model=TeacherInterventionDetail)
def get_active_endpoint(
    intervention_id: int,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return get_teacher_active(db, staff_id, intervention_id)


@router.get("/{intervention_id}/materials", response_model=MaterialList)
def list_materials_endpoint(
    intervention_id: int,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return list_materials(db, staff_id, intervention_id)


@router.post("/{intervention_id}/materials", response_model=MaterialRead, status_code=201)
def create_material_endpoint(
    intervention_id: int,
    body: MaterialCreate,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return create_material(db, staff_id, intervention_id, body.kind)


@router.get("/{intervention_id}/materials/{material_id}", response_model=MaterialRead)
def get_material_endpoint(
    intervention_id: int,
    material_id: int,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return get_material(db, staff_id, intervention_id, material_id)


@router.put("/{intervention_id}/materials/{material_id}", response_model=MaterialRead)
def update_material_endpoint(
    intervention_id: int,
    material_id: int,
    body: MaterialUpdate,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return update_material(db, staff_id, intervention_id, material_id, body)


@router.post("/{intervention_id}/materials/{material_id}/generate", response_model=MaterialRead)
async def generate_reviewer_endpoint(
    intervention_id: int,
    material_id: int,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    token = actor.set(staff_id)
    try:
        return await generate_reviewer(db, staff_id, intervention_id, material_id)
    finally:
        actor.reset(token)


@router.post("/{intervention_id}/materials/{material_id}/send", response_model=MaterialRead)
def send_reviewer_endpoint(
    intervention_id: int,
    material_id: int,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return send_reviewer(db, staff_id, intervention_id, material_id)


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
