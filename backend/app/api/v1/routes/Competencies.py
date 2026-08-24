# app/api/v1/routes/Competencies.py
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.Dependencies import get_staff_id, require_role
from app.db.Session import get_db
from app.schemas.Competency import CompetencyCreate, CompetencyResponse, CompetencyUpdate
from app.services.academic.CompetencyService import (
    archive_competency_record,
    create_competency_record,
    get_competency_detail,
    list_subject_competencies,
    update_competency_record,
)

router = APIRouter()


@router.post("", response_model=CompetencyResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=CompetencyResponse, status_code=status.HTTP_201_CREATED)
def create_competency(
    body: CompetencyCreate,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return create_competency_record(body, staff_id, db)


@router.get("/subject/{subject_id}", response_model=List[CompetencyResponse])
def get_subject_competencies(
    subject_id: int,
    period_id: Optional[int] = Query(None, description="Filter by academic period (quarter)"),
    include_archived: bool = Query(False, description="Include archived competencies"),
    current_user: dict = Depends(require_role("teacher", "admin", "student")),
    db: Session = Depends(get_db),
):
    return list_subject_competencies(
        subject_id=subject_id,
        db=db,
        period_id=period_id,
        include_archived=include_archived,
    )


@router.get("/{competency_id}", response_model=CompetencyResponse)
def get_competency(
    competency_id: int,
    current_user: dict = Depends(require_role("teacher", "admin", "student")),
    db: Session = Depends(get_db),
):
    return get_competency_detail(competency_id, db)


@router.put("/{competency_id}", response_model=CompetencyResponse)
def update_competency(
    competency_id: int,
    body: CompetencyUpdate,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return update_competency_record(competency_id, body, staff_id, db)


@router.delete("/{competency_id}")
def delete_competency(
    competency_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return archive_competency_record(competency_id, staff_id, db)
