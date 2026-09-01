# app/api/v1/routes/Competencies.py
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.Dependencies import get_optional_staff_id, require_role
from app.db.Session import get_db
from app.schemas.Competency import (
    CompetencyCreate,
    CompetencyResponse,
    CompetencyUpdate,
    SubjectHierarchyTreeResponse,
)
from app.services.academic.CompetencyService import (
    archive_competency_record,
    create_competency_record,
    get_competency_detail,
    get_subject_hierarchy_tree,
    list_subject_competencies,
    update_competency_record,
)

router = APIRouter()


@router.post("", response_model=CompetencyResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=CompetencyResponse, status_code=status.HTTP_201_CREATED)
def create_competency(
    body: CompetencyCreate,
    staff_id: Optional[str] = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    return create_competency_record(body, staff_id, db)


@router.get("/subject/{subject_id}", response_model=List[CompetencyResponse])
def get_subject_competencies(
    subject_id: int,
    period_id: Optional[int] = Query(None, description="Filter by academic period (quarter)"),
    staff_id: Optional[str] = Query(None, description="Filter by specific teacher staff_id (admin only)"),
    include_archived: bool = Query(False, description="Include archived competencies"),
    current_user: dict = Depends(require_role("teacher", "admin", "student")),
    db: Session = Depends(get_db),
):
    role = current_user.get("role")
    is_admin = role == "admin"
    
    if role == "teacher":
        resolved_staff_id = get_optional_staff_id(current_user=current_user, db=db)
    elif is_admin:
        resolved_staff_id = staff_id
    else:
        resolved_staff_id = staff_id

    return list_subject_competencies(
        subject_id=subject_id,
        db=db,
        staff_id=resolved_staff_id,
        is_admin=is_admin,
        period_id=period_id,
        include_archived=include_archived,
    )


@router.get("/tree/subject/{subject_id}", response_model=SubjectHierarchyTreeResponse)
def get_hierarchy_tree(
    subject_id: int,
    class_id: Optional[int] = Query(None, description="Optional class ID filter for assigned lessons"),
    period_id: Optional[int] = Query(None, description="Filter by academic period (quarter)"),
    staff_id: Optional[str] = Query(None, description="Filter by specific teacher staff_id (admin only)"),
    current_user: dict = Depends(require_role("teacher", "admin", "student")),
    db: Session = Depends(get_db),
):
    role = current_user.get("role")
    is_admin = role == "admin"

    if role == "teacher":
        resolved_staff_id = get_optional_staff_id(current_user=current_user, db=db)
    elif is_admin:
        resolved_staff_id = staff_id
    else:
        resolved_staff_id = staff_id

    return get_subject_hierarchy_tree(
        subject_id=subject_id,
        db=db,
        staff_id=resolved_staff_id,
        is_admin=is_admin,
        class_id=class_id,
        period_id=period_id,
    )


# Note: Dynamic /{competency_id} must remain below static routes like /subject/... and /tree/...
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
    current_user: dict = Depends(require_role("teacher", "admin")),
    db: Session = Depends(get_db),
):
    role = current_user.get("role")
    is_admin = role == "admin"
    staff_id = get_optional_staff_id(current_user=current_user, db=db) if role == "teacher" else None
    return update_competency_record(competency_id, body, staff_id, is_admin, db)


@router.delete("/{competency_id}")
def delete_competency(
    competency_id: int,
    current_user: dict = Depends(require_role("teacher", "admin")),
    db: Session = Depends(get_db),
):
    role = current_user.get("role")
    is_admin = role == "admin"
    staff_id = get_optional_staff_id(current_user=current_user, db=db) if role == "teacher" else None
    return archive_competency_record(competency_id, staff_id, is_admin, db)
