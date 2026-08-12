from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.Dependencies import require_role
from app.db.Session import get_db
from app.schemas.AcademicPathway import (
    AcademicPathwayRead,
    PathwayCreate,
    PathwayListResponse,
    PathwayUpdate,
)
from app.services.pathways import PathwayQueryService, PathwayService


router = APIRouter()


@router.get("", response_model=PathwayListResponse)
def list_pathways(
    is_enabled: bool | None = Query(None),
    _user: dict = Depends(require_role("admin", "teacher", "student")),
    db: Session = Depends(get_db),
):
    return PathwayQueryService.list_pathways(db, is_enabled=is_enabled)


@router.post("", response_model=AcademicPathwayRead, status_code=201)
def create_pathway(
    payload: PathwayCreate,
    _admin: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return PathwayService.create_pathway(db, payload)


from app.schemas.AcademicLevelPathwayScope import PathwayScopeBatchPayload, PathwayScopeListResponse
from app.services.pathways import PathwayScopeService


@router.get("/scopes", response_model=PathwayScopeListResponse)
def get_pathway_scopes(
    academic_year_id: int = Query(...),
    _user: dict = Depends(require_role("admin", "teacher", "student")),
    db: Session = Depends(get_db),
):
    return PathwayScopeService.get_pathway_scopes_for_year(db, academic_year_id)


@router.patch("/scopes", response_model=PathwayScopeListResponse)
def upsert_pathway_scopes(
    payload: PathwayScopeBatchPayload,
    _admin: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return PathwayScopeService.upsert_pathway_scopes(db, payload)


@router.patch("/{pathway_id}", response_model=AcademicPathwayRead)
def update_pathway(
    pathway_id: int,
    payload: PathwayUpdate,
    _admin: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return PathwayService.update_pathway(db, pathway_id, payload)
