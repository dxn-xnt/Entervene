from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.Dependencies import require_role
from app.db.Session import get_db
from app.models.academic.Subject import Subject
from app.models.academic.SubjectGroup import SubjectGroup
from app.schemas.SubjectGroup import (
    SubjectGroupCreate,
    SubjectGroupListResponse,
    SubjectGroupRead,
    SubjectGroupUpdate,
)


router = APIRouter()


def _to_read(group: SubjectGroup, db: Session) -> SubjectGroupRead:
    count = (
        db.query(func.count(Subject.subject_id))
        .filter(Subject.subject_group_id == group.subject_group_id)
        .scalar()
        or 0
    )
    return SubjectGroupRead(
        subject_group_id=group.subject_group_id,
        name=group.name,
        passing_threshold=float(group.passing_threshold),
        is_active=group.is_active,
        display_order=group.display_order,
        subject_count=count,
    )


@router.get("", response_model=SubjectGroupListResponse)
def list_subject_groups(
    _admin: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    groups = (
        db.query(SubjectGroup)
        .order_by(SubjectGroup.display_order, func.lower(SubjectGroup.name))
        .all()
    )
    return SubjectGroupListResponse(groups=[_to_read(g, db) for g in groups])


@router.post("", response_model=SubjectGroupRead, status_code=201)
def create_subject_group(
    payload: SubjectGroupCreate,
    _admin: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    group = SubjectGroup(
        name=payload.name.strip(),
        passing_threshold=payload.passing_threshold,
        display_order=payload.display_order,
    )
    db.add(group)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f'A subject group named "{payload.name.strip()}" already exists.',
        )
    db.refresh(group)
    return _to_read(group, db)


@router.patch("/{group_id}", response_model=SubjectGroupRead)
def update_subject_group(
    group_id: int,
    payload: SubjectGroupUpdate,
    _admin: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    group = db.get(SubjectGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Subject group not found.")

    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        group.name = data["name"].strip()
    if "passing_threshold" in data and data["passing_threshold"] is not None:
        group.passing_threshold = data["passing_threshold"]
    if "is_active" in data and data["is_active"] is not None:
        group.is_active = data["is_active"]
    if "display_order" in data and data["display_order"] is not None:
        group.display_order = data["display_order"]

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f'A subject group named "{group.name}" already exists.',
        )
    db.refresh(group)
    return _to_read(group, db)


@router.delete("/{group_id}", status_code=200)
def deactivate_subject_group(
    group_id: int,
    _admin: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    """Soft-delete a group by setting is_active=False.

    Blocked if any subjects (regardless of status) reference this group,
    to avoid orphaning subject records.  Returns a 409 with the list of
    affected subjects so the admin knows what to reassign first.
    """
    group = db.get(SubjectGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Subject group not found.")

    affected_subjects = (
        db.query(Subject)
        .filter(Subject.subject_group_id == group_id)
        .all()
    )
    if affected_subjects:
        raise HTTPException(
            status_code=409,
            detail={
                "message": (
                    f'Cannot deactivate "{group.name}" — {len(affected_subjects)} subject(s) '
                    "are still assigned to this group. Reassign them first."
                ),
                "affected_subjects": [
                    {
                        "subject_id": s.subject_id,
                        "subject_name": s.subject_name,
                        "subject_codename": s.subject_codename,
                    }
                    for s in affected_subjects
                ],
            },
        )

    group.is_active = False
    db.commit()
    return {"message": f'"{group.name}" has been deactivated.'}
