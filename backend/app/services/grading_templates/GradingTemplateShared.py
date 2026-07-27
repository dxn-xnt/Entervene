from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.Subject import Subject


ALLOWED_GRADING_TEMPLATE_STATUSES = ["active", "archived"]
DEFAULT_GRADING_TEMPLATE_STATUS = "active"
DEFAULT_GRADING_TEMPLATE_COMPONENTS = [
    {"component_name": "Written Works", "weight": Decimal("25.00"), "display_order": 1},
    {"component_name": "Performance Tasks", "weight": Decimal("50.00"), "display_order": 2},
    {"component_name": "Quarterly/Term Assessment", "weight": Decimal("25.00"), "display_order": 3},
]


def readable_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def normalize_optional_text(value: Any) -> str | None:
    text = readable_text(value)
    return text or None


def normalize_status(value: Any) -> str:
    status = readable_text(value or DEFAULT_GRADING_TEMPLATE_STATUS).casefold()
    if status not in ALLOWED_GRADING_TEMPLATE_STATUSES:
        raise HTTPException(status_code=422, detail="Grading template status must be active or archived.")
    return status


def get_academic_level_or_404(db: Session, academic_level_id: int | None) -> AcademicLevel | None:
    if academic_level_id is None:
        return None
    academic_level = db.query(AcademicLevel).filter(AcademicLevel.academic_level_id == academic_level_id).first()
    if academic_level is None:
        raise HTTPException(status_code=404, detail="Academic level not found.")
    return academic_level


def get_subject_or_404(db: Session, subject_id: int | None) -> Subject | None:
    if subject_id is None:
        return None
    subject = db.query(Subject).filter(Subject.subject_id == subject_id).first()
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found.")
    return subject


def validate_scope(db: Session, academic_level_id: int | None, subject_id: int | None) -> tuple[AcademicLevel | None, Subject | None]:
    academic_level = get_academic_level_or_404(db, academic_level_id)
    subject = get_subject_or_404(db, subject_id)
    if academic_level is not None and subject is not None and subject.academic_level_id != academic_level.academic_level_id:
        raise HTTPException(status_code=422, detail="Subject must belong to the selected academic level.")
    return academic_level, subject


def ensure_template_name_available(
    db: Session,
    template_name: str,
    academic_level_id: int | None,
    subject_id: int | None,
    exclude_template_id: int | None = None,
) -> None:
    query = db.query(GradingTemplate).filter(func.lower(GradingTemplate.template_name) == template_name.casefold())
    if academic_level_id is None:
        query = query.filter(GradingTemplate.academic_level_id.is_(None))
    else:
        query = query.filter(GradingTemplate.academic_level_id == academic_level_id)
    if subject_id is None:
        query = query.filter(GradingTemplate.subject_id.is_(None))
    else:
        query = query.filter(GradingTemplate.subject_id == subject_id)
    if exclude_template_id is not None:
        query = query.filter(GradingTemplate.grading_template_id != exclude_template_id)
    if query.first() is not None:
        raise HTTPException(status_code=409, detail="Grading template name already exists for this scope.")


def normalized_components(component_payloads: list[Any]) -> list[dict]:
    if not component_payloads:
        raise HTTPException(status_code=422, detail="At least one grading component is required.")

    seen_names: set[str] = set()
    seen_orders: set[int] = set()
    components: list[dict] = []
    total = Decimal("0.00")
    for index, component in enumerate(component_payloads, start=1):
        data = component.model_dump() if hasattr(component, "model_dump") else dict(component)
        name = normalize_optional_text(data.get("component_name"))
        if name is None:
            raise HTTPException(status_code=422, detail="Component names cannot be blank.")
        name_key = name.casefold()
        if name_key in seen_names:
            raise HTTPException(status_code=422, detail="Component names cannot be duplicated within a template.")
        seen_names.add(name_key)

        weight = Decimal(str(data.get("weight"))).quantize(Decimal("0.01"))
        if weight <= 0:
            raise HTTPException(status_code=422, detail="Component weights must be greater than zero.")
        total += weight

        display_order = data.get("display_order") or index
        display_order = int(display_order)
        if display_order in seen_orders:
            raise HTTPException(status_code=422, detail="Component display order cannot be duplicated.")
        seen_orders.add(display_order)
        components.append(
            {
                "component_name": name,
                "weight": weight,
                "display_order": display_order,
            }
        )

    if total != Decimal("100.00"):
        raise HTTPException(status_code=422, detail="Component weights must total 100.")
    return sorted(components, key=lambda item: item["display_order"])


def component_to_item(component: GradingTemplateComponent) -> dict:
    return {
        "component_id": component.component_id,
        "component_name": component.component_name,
        "weight": Decimal(str(component.weight)).quantize(Decimal("0.01")),
        "display_order": component.display_order,
        "created_at": component.created_at,
        "updated_at": component.updated_at,
    }


def template_to_item(template: GradingTemplate) -> dict:
    components = sorted(template.components, key=lambda item: item.display_order)
    total_weight = sum((Decimal(str(component.weight)) for component in components), Decimal("0.00")).quantize(Decimal("0.01"))
    academic_level = template.academic_level
    subject = template.subject
    return {
        "grading_template_id": template.grading_template_id,
        "template_name": template.template_name,
        "description": template.description,
        "academic_level": {
            "academic_level_id": academic_level.academic_level_id,
            "level_name": academic_level.level_name,
            "grade_level": academic_level.grade_level,
        } if academic_level else None,
        "subject": {
            "subject_id": subject.subject_id,
            "subject_name": subject.subject_name,
            "subject_codename": subject.subject_codename,
        } if subject else None,
        "status": template.status or DEFAULT_GRADING_TEMPLATE_STATUS,
        "total_weight": total_weight,
        "component_count": len(components),
        "components": [component_to_item(component) for component in components],
        "created_at": template.created_at,
        "updated_at": template.updated_at,
    }
