"""Teacher-private preparation; references never grant student access."""
import json
import re

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.orm import Session

from app.core.Config import settings
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.services.classwork.ClassworkShared import assignment_is_available, assignment_is_locked
from app.models.intervention.Intervention import Intervention
from app.services.ai import Provider
from app.services.intervention.InterventionReviewerGenerationService import build_grounding
from app.services.intervention.InterventionSupportMaterialService import _basis
from app.services.intervention.TeacherInterventionService import _eligible_scope, _source

FORMATS = {"QUIZ", "TOS", "CLASSWORK", "EXISTING_MATERIAL_ONLY"}


class ResourceRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str
    id: int = Field(gt=0)


class PlanUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    teacher_choice: str | None = None
    selected_resources: list[ResourceRef] = Field(default_factory=list, max_length=30)


class Advisory(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    recommended_format: str
    reason: str = Field(min_length=10, max_length=400)


def _row(db: Session, staff_id: str, intervention_id: int) -> Intervention:
    row = db.get(Intervention, intervention_id)
    if row is None or not _eligible_scope(db, staff_id, row):
        raise HTTPException(404, "Intervention not found")
    if row.status != "ACTIVE":
        raise HTTPException(409, "Remediation preparation requires an active intervention")
    return row


def resources(db: Session, row: Intervention, staff_id: str) -> list[dict]:
    result = []
    lessons = db.query(Lesson).filter(
        Lesson.subject_id == row.subject_id,
        Lesson.created_by_staff_id == staff_id,
        Lesson.is_archived == False,
    ).order_by(Lesson.title).all()
    for lesson in lessons:
        assignments = db.query(LessonAssignment).filter_by(lesson_id=lesson.lesson_id).all()
        if assignments and not any(a.class_id == row.class_id for a in assignments):
            continue
        accessible = bool(lesson.is_published and any(
            a.class_id == row.class_id and a.is_published for a in assignments
        ))
        result.append({"kind": "LESSON", "id": lesson.lesson_id, "title": lesson.title,
                       "description": (lesson.description or "")[:240], "lesson": lesson.title,
                       "topic": lesson.title, "attachments": [],
                       "access": "ALREADY_ACCESSIBLE" if accessible else "PLANNING_ONLY",
                       "ai_read": "METADATA_ONLY"})
    classworks = db.query(Classwork).filter(
        Classwork.subject_id == row.subject_id,
        Classwork.created_by_staff_id == staff_id,
        Classwork.is_archived == False,
    ).order_by(Classwork.title).all()
    for cw in classworks:
        assignments = db.query(ClassworkAssignment).filter_by(classwork_id=cw.classwork_id).all()
        if assignments and not any(a.class_id == row.class_id and a.academic_period_id == row.academic_period_id for a in assignments):
            continue
        accessible = bool(cw.is_published and any(
            a.class_id == row.class_id and a.academic_period_id == row.academic_period_id
            and assignment_is_available(a) and not assignment_is_locked(a)
            for a in assignments
        ))
        result.append({"kind": "CLASSWORK", "id": cw.classwork_id, "title": cw.title,
                       "description": (cw.description or "")[:240],
                       "classwork_type": cw.classwork_type,
                       "lesson": ", ".join(lesson.title for lesson in cw.lessons[:4]),
                       "topic": cw.title, "attachments": [a.file_name for a in cw.attachments],
                       "access": "ALREADY_ACCESSIBLE" if accessible else "PLANNING_ONLY",
                       "ai_read": "METADATA_ONLY"})
    return result


def get_workspace(db: Session, staff_id: str, intervention_id: int) -> dict:
    row = _row(db, staff_id, intervention_id)
    return {"plan": row.remediation_plan or {"teacher_choice": None, "selected_resources": [], "ai_suggestion": None},
            "resources": resources(db, row, staff_id)}


def save_plan(db: Session, staff_id: str, intervention_id: int, body: PlanUpdate) -> dict:
    row = _row(db, staff_id, intervention_id)
    if body.teacher_choice is not None and body.teacher_choice not in FORMATS:
        raise HTTPException(422, "Unsupported remediation format")
    available = {(r["kind"], r["id"]) for r in resources(db, row, staff_id)}
    selected = [(ref.kind, ref.id) for ref in body.selected_resources]
    if len(set(selected)) != len(selected) or any(item not in available for item in selected):
        raise HTTPException(422, "Selected material is unavailable in this teaching scope")
    plan = dict(row.remediation_plan or {})
    plan.update({"teacher_choice": body.teacher_choice,
                 "selected_resources": [ref.model_dump() for ref in body.selected_resources],
                 "evidence_basis": _basis(row)})
    row.remediation_plan = plan
    db.commit()
    return get_workspace(db, staff_id, intervention_id)


async def generate_advisory(db: Session, staff_id: str, intervention_id: int) -> dict:
    row = _row(db, staff_id, intervention_id)
    if not settings.groq_api_key:
        raise HTTPException(503, "Groq is not configured for remediation advice")
    grounding = build_grounding(row, _source(db, row))
    selected = {(r.get("kind"), r.get("id")) for r in (row.remediation_plan or {}).get("selected_resources", [])}
    material_context = [{"title": r["title"], "type": r["kind"], "lesson": r["lesson"],
                         "description": r["description"], "content_access": "METADATA_ONLY"}
                        for r in resources(db, row, staff_id) if (r["kind"], r["id"]) in selected]
    system = ("You advise a teacher on a remediation FORMAT. Return only JSON with recommended_format and reason. "
              "Format is one of QUIZ, TOS, CLASSWORK, EXISTING_MATERIAL_ONLY. Advisory only. "
              "Use only the supplied facts. Question scores support missed concepts; scored competencies support measured weakness. "
              "Activity totals plus coverage allow review suggestions but never prove each covered topic weak. "
              "Component-only evidence supports only component-level advice. Materials are metadata only and never prove weakness. "
              "TOS is a planning/export tool. No examination slot or subtype may be selected. "
              "Keep reason short and format-level; do not name any topic or competency in the reason.")
    raw = await Provider.generate_text(json.dumps({"evidence": grounding, "selected_material_metadata": material_context}),
                                       system, json_output=True, max_tokens=350)
    try:
        candidate = raw.strip()
        if candidate.startswith("```json"):
            candidate = candidate[7:].removesuffix("```").strip()
        advice = Advisory.model_validate(json.loads(candidate))
    except (ValueError, ValidationError, TypeError):
        raise HTTPException(502, "AI returned an invalid remediation advisory") from None
    if advice.recommended_format not in FORMATS:
        raise HTTPException(502, "AI returned an unsupported remediation format")
    if re.search(r"\b(weak\w*|struggl\w*|poor|deficit|failed)\b", advice.reason.lower()):
        raise HTTPException(502, "AI returned an unsupported weakness claim")
    measured = {str(item["competency"]).lower() for item in grounding["measured_scored_competencies"]}
    for coverage in grounding["unranked_manual_coverage_context"]:
        for topic in coverage["covered_competencies"] + coverage["covered_lessons"]:
            if topic and topic.lower() not in measured and topic.lower() in advice.reason.lower():
                raise HTTPException(502, "AI named unscored coverage as an advisory focus")
    db.refresh(row)
    if row.status != "ACTIVE" or not _eligible_scope(db, staff_id, row):
        raise HTTPException(409, "Intervention scope changed while preparing advice")
    plan = dict(row.remediation_plan or {})
    plan["ai_suggestion"] = {**advice.model_dump(), "focus": grounding["measured_scored_competencies"],
                             "evidence_used": _basis(row), "selected_materials_are_metadata_only": True}
    plan.setdefault("teacher_choice", None)
    plan.setdefault("selected_resources", [])
    plan["evidence_basis"] = _basis(row)
    row.remediation_plan = plan
    db.commit()
    return get_workspace(db, staff_id, intervention_id)
