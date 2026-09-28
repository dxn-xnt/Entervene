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
from app.models.classwork.ClassworkCoverage import ClassworkCoverage
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.services.classwork.ClassworkShared import assignment_is_available, assignment_is_locked
from app.models.intervention.Intervention import Intervention
from app.services.ai import Provider
from app.services.intervention.InterventionReviewerGenerationService import build_grounding
from app.services.intervention.InterventionSupportMaterialService import _basis
from app.services.intervention.TeacherInterventionService import _eligible_scope, _source
from app.services.intervention.InterventionRemediationFocusService import build_remediation_focus

FORMATS = {"QUIZ", "TOS", "CLASSWORK", "EXISTING_MATERIAL_ONLY"}


class ResourceRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str
    id: int = Field(gt=0)


class PlanUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    teacher_choice: str | None = None
    grade_treatment: str | None = None
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
    focus = build_remediation_focus(row)
    focus_competencies = set(focus["competency_ids"])
    focus_lessons = set(focus["lesson_ids"])
    source_ids = set(focus["source_classwork_ids"])
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
        competency_match = lesson.competency_id in focus_competencies
        lesson_match = lesson.lesson_id in focus_lessons
        context = focus["evidence_level"] == "ACTIVITY_COVERAGE"
        result.append({"kind": "LESSON", "id": lesson.lesson_id, "title": lesson.title,
                       "description": (lesson.description or "")[:240], "lesson": lesson.title,
                       "topic": lesson.title, "attachments": [],
                       "access": "ALREADY_ACCESSIBLE" if accessible else "PLANNING_ONLY",
                       "ai_read": "METADATA_ONLY",
                       "recommended": bool(competency_match or lesson_match),
                       "match_reason": (f"Matched {'covered competency metadata' if context else 'competency metadata'}: {lesson.competency.statement}" if competency_match
                                        else f"Matched {'covered lesson metadata' if context else 'lesson'}: {lesson.title}" if lesson_match else None),
                       "match_level": ("COMPETENCY" if competency_match else "LESSON" if lesson_match else None),
                       "match_rank": (100 if competency_match else 80 if lesson_match else 0)})
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
        linked_lessons = {lesson.lesson_id for lesson in cw.lessons}
        linked_competencies = {lesson.competency_id for lesson in cw.lessons if lesson.competency_id is not None}
        for coverage in db.query(ClassworkCoverage).filter_by(classwork_id=cw.classwork_id, valid_until=None).all():
            if coverage.competency_id is not None:
                linked_competencies.add(coverage.competency_id)
            if coverage.lesson_id is not None:
                linked_lessons.add(coverage.lesson_id)
        matched_competency = next((item for item in focus["competencies"] if item["id"] in linked_competencies), None)
        matched_lesson = next((item for item in focus["lessons"] if item["id"] in linked_lessons), None)
        source_match = cw.classwork_id in source_ids
        reason = (f"Matched competency metadata: {matched_competency['label']}" if matched_competency and focus["evidence_level"] != "ACTIVITY_COVERAGE"
                  else f"Matched covered competency metadata: {matched_competency['label']}" if matched_competency
                  else f"Matched lesson: {matched_lesson['title']}" if matched_lesson and focus["evidence_level"] != "ACTIVITY_COVERAGE"
                  else f"Matched covered lesson metadata: {matched_lesson['title']}" if matched_lesson
                  else "Source activity metadata; file contents were not analyzed" if source_match else None)
        rank = 100 if matched_competency else 80 if matched_lesson else 60 if source_match else 0
        result.append({"kind": "CLASSWORK", "id": cw.classwork_id, "title": cw.title,
                       "description": (cw.description or "")[:240],
                       "classwork_type": cw.classwork_type,
                       "lesson": ", ".join(lesson.title for lesson in cw.lessons[:4]),
                       "topic": cw.title, "attachments": [a.file_name for a in cw.attachments],
                       "access": "ALREADY_ACCESSIBLE" if accessible else "PLANNING_ONLY",
                       "ai_read": "METADATA_ONLY", "recommended": rank >= 80,
                       "match_reason": reason, "match_level": ("COMPETENCY" if matched_competency else "LESSON" if matched_lesson else "SOURCE_ACTIVITY" if source_match else None),
                       "match_rank": rank})
    return sorted(result, key=lambda item: (-item["match_rank"], item["title"]))


def progress(db: Session, row: Intervention) -> dict:
    source = _source(db, row)
    latest = db.query(DevelopmentCurrentTermPrediction).filter_by(
        student_id=row.student_id, class_id=row.class_id, subject_id=row.subject_id,
        source_period_id=row.academic_period_id, target_period_id=row.academic_period_id,
        model_version_id=source.model_version_id,
    ).order_by(DevelopmentCurrentTermPrediction.revision.desc()).first()
    ready = latest and isinstance(latest.evidence_snapshot, dict) and latest.evidence_snapshot.get("readiness", {}).get("status") == "READY"
    source_grade = source.evidence_snapshot.get("projected_final_term_grade_raw") if isinstance(source.evidence_snapshot, dict) else None
    latest_grade = latest.evidence_snapshot.get("projected_final_term_grade_raw") if ready else None
    completed = []
    assigned = []
    assignments = db.query(ClassworkAssignment).filter_by(
        source_intervention_id=row.intervention_id, recipient_student_id=row.student_id,
    ).order_by(ClassworkAssignment.classwork_assignment_id).all()
    for assignment in assignments:
        if not assignment.is_published or not assignment.classwork.is_published:
            continue
        submission = db.query(StudentSubmission).filter_by(
            classwork_assignment_id=assignment.classwork_assignment_id, student_id=row.student_id,
        ).order_by(StudentSubmission.submission_id.desc()).first()
        work = assignment.classwork
        assigned.append({"title": work.title, "assignment_id": assignment.classwork_assignment_id,
                         "component": work.classwork_category,
                         "is_graded": work.is_graded,
                         "submission_status": submission.status if submission else None,
                         "grade": float(submission.grade) if submission and submission.grade is not None and work.show_scores else None,
                         "total_points": float(work.total_points) if work.total_points is not None and work.show_scores else None})
        if submission and submission.status == "graded":
            completed.append({"title": work.title, "assignment_id": assignment.classwork_assignment_id,
                              "grade": float(submission.grade) if submission.grade is not None and work.show_scores else None,
                              "total_points": float(work.total_points) if work.total_points is not None and work.show_scores else None})
    return {"triggering_projection": float(source_grade if source_grade is not None else source.predicted_period_grade),
            "latest_projection": float(latest_grade) if latest_grade is not None else None,
            "latest_revision": latest.revision if ready else None,
            "completed_remediation": completed,
            "assigned_remediation": assigned,
            "status_reason": ("Latest projected final grade remains below 85." if latest_grade is not None and float(latest_grade) < 85
                              else "Latest valid projection is unavailable." if latest_grade is None
                              else "Current status is awaiting reconciliation."),
            "status": row.status}


def get_workspace(db: Session, staff_id: str, intervention_id: int) -> dict:
    row = _row(db, staff_id, intervention_id)
    return {"plan": {"grade_treatment": None, "teacher_choice": None, "selected_resources": [], "ai_suggestion": None, **(row.remediation_plan or {})},
            "resources": resources(db, row, staff_id), "focus": build_remediation_focus(row),
            "progress": progress(db, row)}


def save_plan(db: Session, staff_id: str, intervention_id: int, body: PlanUpdate) -> dict:
    row = _row(db, staff_id, intervention_id)
    if body.teacher_choice is not None and body.teacher_choice not in FORMATS:
        raise HTTPException(422, "Unsupported remediation format")
    if body.grade_treatment is not None and body.grade_treatment not in {"PRACTICE_ONLY", "WRITTEN_WORK", "PERFORMANCE_TASK"}:
        raise HTTPException(422, "Unsupported remediation grade treatment")
    available = {(r["kind"], r["id"]) for r in resources(db, row, staff_id)}
    selected = [(ref.kind, ref.id) for ref in body.selected_resources]
    if len(set(selected)) != len(selected) or any(item not in available for item in selected):
        raise HTTPException(422, "Selected material is unavailable in this teaching scope")
    plan = dict(row.remediation_plan or {})
    plan.update({"teacher_choice": body.teacher_choice,
                 "grade_treatment": (body.grade_treatment or "PRACTICE_ONLY") if body.teacher_choice in {"QUIZ", "CLASSWORK"} else None,
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
                         "description": r["description"], "content_access": "METADATA_ONLY",
                         "match_reason": r["match_reason"]}
                        for r in resources(db, row, staff_id) if (r["kind"], r["id"]) in selected]
    system = ("You advise a teacher on a remediation FORMAT. Return only JSON with recommended_format and reason. "
              "Format is one of QUIZ, TOS, CLASSWORK, EXISTING_MATERIAL_ONLY. Advisory only. "
              "Use only the supplied facts. Question scores support missed concepts; scored competencies support measured weakness. "
              "Activity totals plus coverage allow review suggestions but never prove each covered topic weak. "
              "Component-only evidence supports only component-level advice. Materials are metadata only and never prove weakness. "
              "TOS is a planning/export tool. No examination slot or subtype may be selected. "
              "Keep reason short and format-level; do not name any topic or competency in the reason.")
    raw = await Provider.generate_text(json.dumps({"evidence": grounding, "deterministic_focus": build_remediation_focus(row),
                                         "selected_material_metadata": material_context}),
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
