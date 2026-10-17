from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject


ALLOWED_GRADING_TEMPLATE_STATUSES = ["active", "archived"]
DEFAULT_GRADING_TEMPLATE_STATUS = "active"
DEFAULT_GRADING_TEMPLATE_COMPONENTS = [
    {"component_name": "Written Work", "weight": Decimal("20.00"), "display_order": 1},
    {"component_name": "Performance Tasks", "weight": Decimal("50.00"), "display_order": 2},
    {"component_name": "Exams", "weight": Decimal("30.00"), "display_order": 3},
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


def normalized_components(component_payloads: list[Any]) -> list[dict]:
    if len(component_payloads) != 3:
        raise HTTPException(status_code=422, detail="Exactly three grading components are required.")

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
    if {item["component_name"] for item in components} != {"Written Work", "Performance Tasks", "Exams"}:
        raise HTTPException(status_code=422, detail="Use Written Work, Performance Tasks, and Exams.")
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


def get_assigned_subjects(db: Session, template: GradingTemplate) -> list[dict]:
    subjects = db.query(Subject).options(joinedload(Subject.academic_level)).filter(
        Subject.grading_template_id == template.grading_template_id
    ).all()
    assigned = []
    seen = set()
    for sub in subjects:
        if sub.subject_id not in seen:
            seen.add(sub.subject_id)
            assigned.append({
                "subject_id": sub.subject_id,
                "subject_name": sub.subject_name,
                "subject_codename": sub.subject_codename,
                "academic_level_id": sub.academic_level_id,
                "grade_level": sub.academic_level.grade_level if sub.academic_level else None,
            })
    return assigned


def check_template_locked(db: Session, template: GradingTemplate) -> tuple[bool, str | None]:
    """Fail closed: database errors must never make recorded grades editable."""
    subject_ids = [row["subject_id"] for row in get_assigned_subjects(db, template)]
    if subject_ids:
        if db.query(StudentPeriodGrade.period_grade_id).filter(StudentPeriodGrade.subject_id.in_(subject_ids)).first():
            return True, "Template settings are locked because assigned subjects have recorded period grades."
        from app.models.classwork.Classwork import Classwork
        from app.models.classwork.ClassworkAssignment import ClassworkAssignment
        from app.models.submissions.StudentSubmission import StudentSubmission
        graded = (db.query(StudentSubmission.submission_id)
            .join(ClassworkAssignment, StudentSubmission.classwork_assignment_id == ClassworkAssignment.classwork_assignment_id)
            .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
            .filter(Classwork.subject_id.in_(subject_ids), StudentSubmission.grade.isnot(None)).first())
        if graded:
            return True, "Template settings are locked because assigned subjects have recorded classwork grades."
    return False, None


def template_to_item(template: GradingTemplate, db: Session | None = None) -> dict:
    components = sorted(template.components, key=lambda item: item.display_order)
    total_weight = sum((Decimal(str(component.weight)) for component in components), Decimal("0.00")).quantize(Decimal("0.01"))
    assigned_subjects = get_assigned_subjects(db, template) if db else []
    is_locked, lock_reason = check_template_locked(db, template) if db else (False, None)

    return {
        "grading_template_id": template.grading_template_id,
        "template_name": template.template_name,
        "description": template.description,
        "passing_threshold": float(template.passing_threshold),
        "assigned_subjects": assigned_subjects,
        "assigned_subject_count": len(assigned_subjects),
        "is_locked": is_locked,
        "lock_reason": lock_reason,
        "status": template.status or DEFAULT_GRADING_TEMPLATE_STATUS,
        "total_weight": total_weight,
        "component_count": len(components),
        "components": [component_to_item(component) for component in components],
        "created_at": template.created_at,
        "updated_at": template.updated_at,
    }
