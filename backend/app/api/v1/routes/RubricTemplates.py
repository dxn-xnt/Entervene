from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.Dependencies import get_staff_id, require_role
from app.db.Session import get_db
from app.models.classwork.RubricTemplate import RubricTemplate
from app.schemas.RubricTemplate import RubricTemplateInput, RubricTemplateResponse


router = APIRouter(dependencies=[Depends(require_role("teacher"))])


def _visible(db: Session, staff_id: str):
    return db.query(RubricTemplate).filter(
        or_(RubricTemplate.is_system.is_(True), RubricTemplate.owner_staff_id == staff_id)
    )


def _owned(db: Session, template_id: int, staff_id: str) -> RubricTemplate:
    template = db.query(RubricTemplate).filter(RubricTemplate.rubric_template_id == template_id).first()
    if not template or template.is_system or template.owner_staff_id != staff_id:
        raise HTTPException(status_code=404, detail="Personal rubric template not found")
    return template


def _levels(body: RubricTemplateInput) -> list[dict]:
    return [
        {
            "level_name": level.level_name.strip(),
            "description": level.description.strip(),
            "points": level.points,
            "display_order": index,
        }
        for index, level in enumerate(body.levels)
    ]


def _unique_name(db: Session, staff_id: str, name: str, exclude_id: int | None = None) -> None:
    query = db.query(RubricTemplate).filter(
        RubricTemplate.owner_staff_id == staff_id,
        func.lower(RubricTemplate.name) == name.lower(),
    )
    if exclude_id is not None:
        query = query.filter(RubricTemplate.rubric_template_id != exclude_id)
    if query.first():
        raise HTTPException(status_code=409, detail="You already have a template with this name")


@router.get("", response_model=list[RubricTemplateResponse])
def list_rubric_templates(staff_id: str = Depends(get_staff_id), db: Session = Depends(get_db)):
    return _visible(db, staff_id).order_by(RubricTemplate.is_system.desc(), RubricTemplate.name).all()


@router.post("", response_model=RubricTemplateResponse, status_code=status.HTTP_201_CREATED)
def create_rubric_template(
    body: RubricTemplateInput,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    _unique_name(db, staff_id, body.name)
    template = RubricTemplate(
        owner_staff_id=staff_id,
        name=body.name,
        description=body.description,
        levels=_levels(body),
        is_system=False,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


@router.put("/{template_id}", response_model=RubricTemplateResponse)
def update_rubric_template(
    template_id: int,
    body: RubricTemplateInput,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    template = _owned(db, template_id, staff_id)
    _unique_name(db, staff_id, body.name, template_id)
    template.name = body.name
    template.description = body.description
    template.levels = _levels(body)
    db.commit()
    db.refresh(template)
    return template


@router.post("/{template_id}/duplicate", response_model=RubricTemplateResponse, status_code=status.HTTP_201_CREATED)
def duplicate_rubric_template(
    template_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    source = _visible(db, staff_id).filter(RubricTemplate.rubric_template_id == template_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Rubric template not found")
    base_name = f"Copy of {source.name}"[:100]
    name = base_name
    number = 2
    while db.query(RubricTemplate).filter(
        RubricTemplate.owner_staff_id == staff_id,
        func.lower(RubricTemplate.name) == name.lower(),
    ).first():
        suffix = f" ({number})"
        name = f"{base_name[:100 - len(suffix)]}{suffix}"
        number += 1
    copy = RubricTemplate(
        owner_staff_id=staff_id,
        name=name,
        description=source.description,
        levels=[dict(level) for level in source.levels],
        is_system=False,
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return copy


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rubric_template(
    template_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    db.delete(_owned(db, template_id, staff_id))
    db.commit()
