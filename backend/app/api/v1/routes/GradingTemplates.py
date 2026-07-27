from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.Dependencies import require_role
from app.db.Session import get_db
from app.schemas.GradingTemplate import (
    GradingTemplateCreate,
    GradingTemplateFormOptions,
    GradingTemplateListResponse,
    GradingTemplateResponse,
    GradingTemplateUpdate,
)
from app.services.grading_templates.GradingTemplateQueryService import (
    get_grading_template_detail_data,
    get_grading_template_form_options_data,
    list_grading_templates_data,
)
from app.services.grading_templates.GradingTemplateService import (
    archive_grading_template_record,
    create_grading_template_record,
    restore_grading_template_record,
    update_grading_template_record,
)


router = APIRouter()


@router.get("/form-options", response_model=GradingTemplateFormOptions)
def get_grading_template_form_options(
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return get_grading_template_form_options_data(db=db)


@router.get("", response_model=GradingTemplateListResponse)
def list_grading_templates(
    status: str | None = Query(None),
    academic_level_id: int | None = Query(None),
    subject_id: int | None = Query(None),
    search: str = "",
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return list_grading_templates_data(
        db=db,
        status=status,
        academic_level_id=academic_level_id,
        subject_id=subject_id,
        search=search,
    )


@router.get("/{grading_template_id}", response_model=GradingTemplateResponse)
def get_grading_template_detail(
    grading_template_id: int,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return get_grading_template_detail_data(db=db, grading_template_id=grading_template_id)


@router.post("", response_model=GradingTemplateResponse, status_code=201)
def create_grading_template(
    payload: GradingTemplateCreate,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return create_grading_template_record(db=db, payload=payload)


@router.patch("/{grading_template_id}", response_model=GradingTemplateResponse)
def update_grading_template(
    grading_template_id: int,
    payload: GradingTemplateUpdate,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return update_grading_template_record(db=db, grading_template_id=grading_template_id, payload=payload)


@router.patch("/{grading_template_id}/archive", response_model=GradingTemplateResponse)
def archive_grading_template(
    grading_template_id: int,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return archive_grading_template_record(db=db, grading_template_id=grading_template_id)


@router.patch("/{grading_template_id}/restore", response_model=GradingTemplateResponse)
def restore_grading_template(
    grading_template_id: int,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return restore_grading_template_record(db=db, grading_template_id=grading_template_id)
