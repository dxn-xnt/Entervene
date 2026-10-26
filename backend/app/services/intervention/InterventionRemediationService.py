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
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.services.classwork.ClassworkShared import assignment_is_available, assignment_is_locked
from app.models.intervention.Intervention import Intervention
from app.services.ai import Provider
from app.services.intervention.InterventionReviewerGenerationService import build_grounding
from app.services.intervention.InterventionSupportMaterialService import _basis
from app.services.intervention.TeacherInterventionService import _eligible_scope, _source
from app.services.intervention.InterventionRemediationFocusService import build_remediation_focus
from app.services.grading.ExaminationCalculator import EXAM_SUBTYPES, categorize_exam_subtype
from app.services.grading.ComponentMapper import CanonicalGradingComponent, classify_classwork_component
from app.services.grading.RemediationScoreAdjuster import (
    DEFAULT_REMEDIATION_CAP_PERCENTAGE,
    adjust_remediation_score,
    validate_cap_percentage,
)

FORMATS = {"QUIZ", "TOS", "CLASSWORK", "EXISTING_MATERIAL_ONLY"}
GRADED_TREATMENTS = {"WRITTEN_WORK", "PERFORMANCE_TASK", "EXAMINATION"}


def _validate_grade_treatment_focus(row: Intervention, treatment: str | None) -> None:
    if treatment not in GRADED_TREATMENTS:
        return
    component = build_remediation_focus(row)["component"]
    if component is None:
        raise HTTPException(
            422,
            "Graded remediation requires one verified weakest grading component",
        )
    if treatment != component:
        raise HTTPException(
            422,
            f"Grade treatment must match the verified {component.replace('_', ' ').title()} intervention focus",
        )


class ResourceRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str
    id: int = Field(gt=0)


class PlanUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    teacher_choice: str | None = None
    grade_treatment: str | None = None
    original_exam_assignment_id: int | None = None
    target_assignment_ids: list[int] | None = None
    score_adjustment_cap: float | None = None
    selected_resources: list[ResourceRef] = Field(default_factory=list, max_length=30)


class Advisory(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    recommended_format: str
    reason: str = Field(min_length=10, max_length=400)


_WEAKNESS_CLAIM_RE = re.compile(
    r"\b(weak\w*|struggl\w*|poor|deficit|failed|low.perform\w*|needs? reinforcement)\b"
)


def _validate_advisory_reason(advice: Advisory, grounding: dict, focus: dict) -> None:
    """Keep method advice bounded by the frozen diagnostic evidence."""
    reason = advice.reason.lower()
    component = focus.get("component")
    scrubbed = reason
    if component:
        component_label = re.escape(component.replace("_", " ").lower())
        allowed_component_phrases = (
            rf"\b(?:the\s+)?(?:verified\s+)?weakest\s+(?:supported\s+)?(?:{component_label}\s+)?(?:grading\s+)?component\b",
            rf"\b{component_label}\s+(?:is|as)\s+(?:the\s+)?(?:verified\s+)?weakest\s+(?:grading\s+)?component\b",
        )
        for pattern in allowed_component_phrases:
            scrubbed = re.sub(pattern, " verified component ", scrubbed)
    if _WEAKNESS_CLAIM_RE.search(scrubbed):
        raise HTTPException(502, "AI returned an unsupported weakness claim")

    measured = {
        str(item["competency"]).strip().lower()
        for item in grounding["measured_scored_competencies"]
        if item.get("competency")
    }
    for coverage in grounding["unranked_manual_coverage_context"]:
        for topic in coverage["covered_competencies"] + coverage["covered_lessons"]:
            normalized = str(topic).strip().lower()
            if normalized and normalized not in measured and normalized in reason:
                raise HTTPException(502, "AI named unscored coverage as an advisory focus")


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

    # Supporting Resources are genuine, non-graded READING classworks only (Lessons are not supporting resources).
    classworks = db.query(Classwork).filter(
        Classwork.subject_id == row.subject_id,
        Classwork.created_by_staff_id == staff_id,
        Classwork.is_archived == False,
        Classwork.classwork_type == "READING",
        Classwork.is_graded == False,
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

        if matched_competency:
            reason = (f"Matched competency metadata: {matched_competency['label']}"
                      if focus["evidence_level"] != "ACTIVITY_COVERAGE"
                      else f"Matched covered competency metadata: {matched_competency['label']}")
            rank = 100
            recommended = True
            match_level = "COMPETENCY"
        elif matched_lesson:
            reason = (f"Matched lesson: {matched_lesson['title']}"
                      if focus["evidence_level"] != "ACTIVITY_COVERAGE"
                      else f"Matched covered lesson metadata: {matched_lesson['title']}")
            rank = 80
            recommended = True
            match_level = "LESSON"
        else:
            reason = None
            rank = 0
            recommended = False
            match_level = None

        result.append({
            "kind": "CLASSWORK",
            "id": cw.classwork_id,
            "title": cw.title,
            "description": (cw.description or "")[:240],
            "classwork_type": "READING",
            "lesson": ", ".join(lesson.title for lesson in cw.lessons[:4]),
            "topic": cw.title,
            "attachments": [a.file_name for a in cw.attachments],
            "access": "ALREADY_ACCESSIBLE" if accessible else "PLANNING_ONLY",
            "ai_read": "METADATA_ONLY",
            "recommended": recommended,
            "match_reason": reason,
            "match_level": match_level,
            "match_rank": rank,
            "is_graded": False,
        })
    return sorted(result, key=lambda item: (-item["match_rank"], item["title"]))


def _is_selectable_resource(resource: dict) -> bool:
    if resource.get("match_level") == "SOURCE_ACTIVITY":
        return False
    return (
        resource.get("kind") == "CLASSWORK"
        and resource.get("classwork_type") == "READING"
        and not resource.get("is_graded", True)
    )


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
        work = assignment.classwork
        if not work or work.is_archived:
            continue
        is_published = bool(assignment.is_published and work.is_published)
        submission = db.query(StudentSubmission).filter_by(
            classwork_assignment_id=assignment.classwork_assignment_id, student_id=row.student_id,
        ).order_by(StudentSubmission.submission_id.desc()).first()
        original_result = None
        effective_result = None
        original_assignment_id = assignment.original_exam_assignment_id
        original = None
        if assignment.original_exam_assignment_id is not None:
            original = db.get(ClassworkAssignment, assignment.original_exam_assignment_id)
            original_submission = db.query(StudentSubmission).filter_by(
                classwork_assignment_id=original.classwork_assignment_id, student_id=row.student_id,
            ).order_by(StudentSubmission.submission_id.desc()).first() if original else None
            original_result = float(original_submission.grade) if original_submission and original_submission.grade is not None else None
            if original_result is not None:
                from app.services.grading.RemedialExamination import effective_exam_score_for_change
                effective_result = effective_exam_score_for_change(db, assignment, row.student_id,
                    float(submission.grade) if submission and submission.grade is not None else None)
        else:
            from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
            link = db.query(RemediationAssignmentLink).filter_by(
                remediation_assignment_id=assignment.classwork_assignment_id
            ).first()
            if link is not None:
                original_assignment_id = link.original_assignment_id
                original = db.get(ClassworkAssignment, link.original_assignment_id)
                original_submission = db.query(StudentSubmission).filter_by(
                    classwork_assignment_id=link.original_assignment_id, student_id=row.student_id,
                ).order_by(StudentSubmission.submission_id.desc()).first() if original else None
                original_result = float(original_submission.grade) if original_submission and original_submission.grade is not None else None
                rem_grade = float(submission.grade) if submission and submission.grade is not None else None
                if original_result is not None and rem_grade is not None and original and original.classwork and original.classwork.total_points:
                    from app.services.grading.RemediationScoreAdjuster import adjust_remediation_score
                    adj = adjust_remediation_score(
                        original_score=original_result,
                        remediation_score=rem_grade,
                        max_points=float(original.classwork.total_points),
                        cap_percentage=link.score_adjustment_cap,
                    )
                    effective_result = float(adj.effective_score)
                elif original_result is not None:
                    effective_result = original_result
        assigned.append({"title": work.title, "assignment_id": assignment.classwork_assignment_id,
                         "classwork_id": work.classwork_id,
                         "classwork_type": work.classwork_type,
                         "original_assignment_id": original_assignment_id,
                         "exam_subtype": work.exam_subtype,
                         "original_title": original.classwork.title if original and original.classwork else None,
                         "original_grade": original_result,
                         "effective_grade": effective_result,
                         "component": work.classwork_category,
                         "is_graded": work.is_graded,
                         "is_published": is_published,
                         "submission_status": submission.status if submission else ("draft" if not is_published else None),
                         "grade": float(submission.grade) if submission and submission.grade is not None and work.show_scores else None,
                         "total_points": float(work.total_points) if work.total_points is not None and work.show_scores else None})
        if is_published and submission and submission.status == "graded":
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
    stored_plan = dict(row.remediation_plan or {})
    target_ids = stored_plan.get("target_assignment_ids")
    if target_ids is None:
        orig_exam = stored_plan.get("original_exam_assignment_id")
        target_ids = [orig_exam] if orig_exam is not None else []
    cap = stored_plan.get("score_adjustment_cap")
    if cap is None:
        cap = float(DEFAULT_REMEDIATION_CAP_PERCENTAGE)

    plan_data = {
        "grade_treatment": None,
        "teacher_choice": None,
        "selected_resources": [],
        "ai_suggestion": None,
        **stored_plan,
        "target_assignment_ids": target_ids,
        "score_adjustment_cap": cap,
    }
    preview_data = preview_score_adjustment(
        db, staff_id, intervention_id, cap_percentage=cap, target_assignment_ids=target_ids
    )
    return {"plan": plan_data,
            "resources": resources(db, row, staff_id), "focus": build_remediation_focus(row),
            "original_exams": original_exams(db, row),
            "progress": progress(db, row),
            "score_previews": preview_data.get("previews", [])}


def original_exams(db: Session, row: Intervention) -> list[dict]:
    assignments = db.query(ClassworkAssignment).join(Classwork).filter(
        ClassworkAssignment.class_id == row.class_id,
        ClassworkAssignment.academic_period_id == row.academic_period_id,
        Classwork.subject_id == row.subject_id,
        Classwork.is_graded.is_(True),
        Classwork.is_archived.is_(False),
        ClassworkAssignment.original_exam_assignment_id.is_(None),
    ).order_by(ClassworkAssignment.classwork_assignment_id).all()
    results = []
    for assignment in assignments:
        work = assignment.classwork
        subtype = categorize_exam_subtype(work.exam_subtype, work.title, work.classwork_category)
        if (assignment.recipient_student_id not in (None, row.student_id)
            or work.classwork_category not in {"EXAMS", "QUARTERLY_ASSESSMENT"}
            or subtype not in EXAM_SUBTYPES or work.total_points is None or work.total_points <= 0):
            continue
        submission = db.query(StudentSubmission).filter_by(
            classwork_assignment_id=assignment.classwork_assignment_id, student_id=row.student_id,
        ).filter(StudentSubmission.grade.isnot(None)).order_by(StudentSubmission.submission_id.desc()).first()
        if submission:
            results.append({"assignment_id": assignment.classwork_assignment_id, "title": work.title,
                            "subtype": subtype, "score": float(submission.grade),
                            "total_points": float(work.total_points)})
    return results


def save_plan(db: Session, staff_id: str, intervention_id: int, body: PlanUpdate) -> dict:
    row = _row(db, staff_id, intervention_id)
    if body.teacher_choice is not None and body.teacher_choice not in FORMATS:
        raise HTTPException(422, "Unsupported remediation format")
    if body.grade_treatment is not None and body.grade_treatment not in {"PRACTICE_ONLY", "WRITTEN_WORK", "PERFORMANCE_TASK", "EXAMINATION"}:
        raise HTTPException(422, "Unsupported remediation grade treatment")
    requested_treatment = ((body.grade_treatment or "PRACTICE_ONLY")
                           if body.teacher_choice in {"QUIZ", "CLASSWORK"} else None)

    current_plan = dict(row.remediation_plan or {})
    existing_activity = db.query(ClassworkAssignment.classwork_assignment_id).filter_by(
        source_intervention_id=row.intervention_id,
        recipient_student_id=row.student_id,
    ).first()
    if not existing_activity:
        _validate_grade_treatment_focus(row, requested_treatment)

    # Check duplicate target classwork assignment IDs
    if body.target_assignment_ids is not None:
        if len(set(body.target_assignment_ids)) != len(body.target_assignment_ids):
            raise HTTPException(422, "Duplicate target classwork assignment IDs are not permitted")

    # Validate and resolve score adjustment cap
    if body.score_adjustment_cap is not None:
        try:
            resolved_cap = float(validate_cap_percentage(body.score_adjustment_cap))
        except (ValueError, TypeError) as err:
            raise HTTPException(422, str(err))
    else:
        resolved_cap = float(current_plan.get("score_adjustment_cap", DEFAULT_REMEDIATION_CAP_PERCENTAGE))

    # Resolve target assignment IDs and requested exam ID
    if body.target_assignment_ids is not None:
        target_ids = list(body.target_assignment_ids)
    elif requested_treatment in (None, "PRACTICE_ONLY"):
        # An explicit save to ungraded/non-activity support reconciles stale graded targets.
        target_ids = []
    else:
        target_ids = list(current_plan.get("target_assignment_ids", []))

    if requested_treatment == "EXAMINATION":
        if body.original_exam_assignment_id is not None:
            if body.original_exam_assignment_id not in target_ids:
                target_ids.insert(0, body.original_exam_assignment_id)
        requested_exam_id = body.original_exam_assignment_id if body.original_exam_assignment_id is not None else (target_ids[0] if target_ids else None)
    else:
        requested_exam_id = None

    if requested_treatment in (None, "PRACTICE_ONLY") and target_ids:
        raise HTTPException(422, "Target classwork assignments can only be set for graded remediation treatments")

    if requested_treatment in GRADED_TREATMENTS and target_ids:
        # Check period finalized state
        finalized = db.query(StudentPeriodGrade.period_grade_id).filter_by(
            student_id=row.student_id,
            class_id=row.class_id,
            subject_id=row.subject_id,
            academic_period_id=row.academic_period_id,
            is_finalized=True,
        ).first()
        if finalized:
            raise HTTPException(409, "The period grade is finalized; cannot target classworks in a finalized period")

        for target_id in target_ids:
            target_assignment = db.get(ClassworkAssignment, target_id)
            if target_assignment is None:
                raise HTTPException(422, f"Target classwork assignment {target_id} not found")
            work = target_assignment.classwork
            if work is None or work.is_archived:
                raise HTTPException(422, f"Target classwork assignment {target_id} is unavailable or archived")
            if not work.is_graded:
                raise HTTPException(422, f"Target classwork assignment {target_id} must be a graded classwork")
            if (
                target_assignment.class_id != row.class_id
                or work.subject_id != row.subject_id
                or target_assignment.academic_period_id != row.academic_period_id
            ):
                raise HTTPException(422, f"Target classwork assignment {target_id} is outside this student's intervention scope")
            if target_assignment.recipient_student_id not in (None, row.student_id):
                raise HTTPException(422, f"Target classwork assignment {target_id} was assigned to another individual student")
            if target_assignment.source_intervention_id is not None or target_assignment.original_exam_assignment_id is not None:
                raise HTTPException(422, f"Target classwork assignment {target_id} is already a remedial assignment")

            sub = (
                db.query(StudentSubmission)
                .filter_by(
                    classwork_assignment_id=target_assignment.classwork_assignment_id,
                    student_id=row.student_id,
                )
                .filter(StudentSubmission.grade.isnot(None))
                .order_by(StudentSubmission.submission_id.desc())
                .first()
            )
            if sub is None:
                raise HTTPException(422, f"Target classwork '{work.title}' has no scored submission for this student")

            comp = classify_classwork_component(work.classwork_type, work.classwork_category, work.exam_subtype)
            if requested_treatment == "WRITTEN_WORK" and comp != CanonicalGradingComponent.WRITTEN_WORK:
                raise HTTPException(
                    422,
                    f"Target classwork '{work.title}' belongs to {comp.value}, not Written Work (cross-category adjustment not allowed)",
                )
            elif requested_treatment == "PERFORMANCE_TASK" and comp != CanonicalGradingComponent.PERFORMANCE_TASK:
                raise HTTPException(
                    422,
                    f"Target classwork '{work.title}' belongs to {comp.value}, not Performance Task (cross-category adjustment not allowed)",
                )
            elif requested_treatment == "EXAMINATION" and comp != CanonicalGradingComponent.ASSESSMENT:
                raise HTTPException(
                    422,
                    f"Target classwork '{work.title}' belongs to {comp.value}, not Examination (cross-category adjustment not allowed)",
                )

    if requested_treatment == "EXAMINATION":
        if not target_ids and body.original_exam_assignment_id is None:
            raise HTTPException(422, "Select a scored original Examination in this student scope")
        if body.original_exam_assignment_id is not None and body.original_exam_assignment_id not in {
            exam["assignment_id"] for exam in original_exams(db, row)
        }:
            raise HTTPException(422, "Select a scored original Examination in this student scope")

    current_treatment = current_plan.get("grade_treatment")
    if current_plan.get("teacher_choice") in {"QUIZ", "CLASSWORK"} and current_treatment is None:
        current_treatment = "PRACTICE_ONLY"
    if existing_activity:
        current_targets = list(current_plan.get("target_assignment_ids", []))
        targets_modified = (
            body.target_assignment_ids is not None
            and target_ids[:len(current_targets)] != current_targets
        )
        if (
            body.teacher_choice != current_plan.get("teacher_choice")
            or requested_treatment != current_treatment
            or requested_exam_id != current_plan.get("original_exam_assignment_id")
            or targets_modified
            or (body.score_adjustment_cap is not None and resolved_cap != current_plan.get("score_adjustment_cap", float(DEFAULT_REMEDIATION_CAP_PERCENTAGE)))
        ):
            raise HTTPException(409, "Remediation format, grade treatment, and targeted classworks cannot change after a targeted activity is created")
    _validate_grade_treatment_focus(row, requested_treatment)

    available = {
        (resource["kind"], resource["id"])
        for resource in resources(db, row, staff_id)
        if _is_selectable_resource(resource)
    }
    selected = [(ref.kind, ref.id) for ref in body.selected_resources]
    if len(set(selected)) != len(selected) or any(item not in available for item in selected):
        raise HTTPException(422, "Selected material is unavailable in this teaching scope")

    plan = dict(row.remediation_plan or {})
    current_selected = {
        (ref.get("kind"), ref.get("id"))
        for ref in plan.get("selected_resources", [])
        if isinstance(ref, dict)
    }
    if set(selected) != current_selected:
        plan.pop("ai_suggestion", None)

    plan.update({
        "teacher_choice": body.teacher_choice,
        "grade_treatment": requested_treatment,
        "original_exam_assignment_id": requested_exam_id,
        "target_assignment_ids": target_ids,
        "score_adjustment_cap": resolved_cap,
        "selected_resources": [ref.model_dump() for ref in body.selected_resources],
        "evidence_basis": _basis(row),
    })
    row.remediation_plan = plan
    db.commit()
    return get_workspace(db, staff_id, intervention_id)


async def generate_advisory(db: Session, staff_id: str, intervention_id: int) -> dict:
    row = _row(db, staff_id, intervention_id)
    if not settings.groq_api_key:
        raise HTTPException(503, "Groq is not configured for remediation advice")
    grounding = build_grounding(row, _source(db, row))
    system = ("You advise a teacher on a remediation FORMAT. Return only JSON with recommended_format and reason. "
              "Format is one of QUIZ, TOS, CLASSWORK, EXISTING_MATERIAL_ONLY. Advisory only. "
              "Use only the supplied facts. Question scores support missed concepts; scored competencies support measured weakness. "
              "Activity totals plus coverage allow review suggestions but never prove each covered topic weak. "
              "Component-only evidence supports only component-level advice. "
              "TOS is a planning/export tool. No examination slot or subtype may be selected. "
              "Keep reason short and format-level. Refer only to the verified grading component and evidence level. "
              "Do not name a lesson or competency unless it appears under measured_scored_competencies. "
              "When evidence is coverage-only or component-only, do not claim a topic weakness. "
              "Prefer neutral wording such as 'supports the verified Performance Task focus'.")
    focus = build_remediation_focus(row)
    raw = await Provider.generate_text(json.dumps({"evidence": grounding, "deterministic_focus": focus}),
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
    _validate_advisory_reason(advice, grounding, focus)
    db.refresh(row)
    if row.status != "ACTIVE" or not _eligible_scope(db, staff_id, row):
        raise HTTPException(409, "Intervention scope changed while preparing advice")
    plan = dict(row.remediation_plan or {})
    plan["ai_suggestion"] = {
        **advice.model_dump(),
        "focus": grounding["measured_scored_competencies"],
        "evidence_used": _basis(row),
    }
    plan.setdefault("teacher_choice", None)
    plan.setdefault("selected_resources", [])
    plan["evidence_basis"] = _basis(row)
    row.remediation_plan = plan
    db.commit()
    return get_workspace(db, staff_id, intervention_id)


def preview_score_adjustment(
    db: Session,
    staff_id: str,
    intervention_id: int,
    cap_percentage: float | int | str,
    target_assignment_ids: list[int] | None = None,
    items: list[dict] | None = None,
) -> dict:
    row = _row(db, staff_id, intervention_id)
    cap_dec = validate_cap_percentage(cap_percentage)

    targets = list(target_assignment_ids or [])
    provided_items = {
        item["assignment_id"]: item for item in (items or []) if "assignment_id" in item
    }

    diag_activities: dict[int, dict] = {}
    for act in (row.diagnosis_snapshot or {}).get("supporting_activities", []):
        if "classwork_assignment_id" in act and act["classwork_assignment_id"] is not None:
            diag_activities[act["classwork_assignment_id"]] = act
        if "classwork_id" in act and act["classwork_id"] is not None:
            diag_activities[act["classwork_id"]] = act

    for exam in original_exams(db, row):
        diag_activities[exam["assignment_id"]] = {
            "score": exam.get("score"),
            "possible_score": exam.get("total_points"),
            "title": exam.get("title"),
        }

    for item_id in provided_items:
        if item_id not in targets:
            targets.append(item_id)

    previews = []
    for target_id in targets:
        orig_score = None
        max_points = None
        title = None

        if target_id in provided_items:
            p = provided_items[target_id]
            if p.get("original_score") is not None and p.get("max_points") is not None:
                orig_score = p["original_score"]
                max_points = p["max_points"]
                title = p.get("title")

        if orig_score is None or max_points is None:
            if target_id in diag_activities:
                act = diag_activities[target_id]
                orig_score = act.get("score")
                max_points = act.get("possible_score")
                title = act.get("title")

        if orig_score is None or max_points is None:
            assignment = db.query(ClassworkAssignment).filter_by(classwork_assignment_id=target_id).first()
            if not assignment:
                assignment = (
                    db.query(ClassworkAssignment)
                    .filter_by(
                        classwork_id=target_id,
                        class_id=row.class_id,
                        academic_period_id=row.academic_period_id,
                    )
                    .first()
                )
            if assignment and assignment.classwork:
                max_points = (
                    float(assignment.classwork.total_points)
                    if assignment.classwork.total_points is not None
                    else None
                )
                title = assignment.classwork.title
                sub = (
                    db.query(StudentSubmission)
                    .filter_by(
                        classwork_assignment_id=assignment.classwork_assignment_id,
                        student_id=row.student_id,
                    )
                    .filter(StudentSubmission.grade.isnot(None))
                    .order_by(StudentSubmission.submission_id.desc())
                    .first()
                )
                if sub and sub.grade is not None:
                    orig_score = float(sub.grade)

        if orig_score is not None and max_points is not None and max_points > 0:
            adj = adjust_remediation_score(
                original_score=orig_score,
                remediation_score=max_points,
                max_points=max_points,
                cap_percentage=cap_dec,
            )
            previews.append({
                "assignment_id": target_id,
                "title": title,
                "original_score": float(adj.original_score),
                "max_points": float(adj.max_points),
                "max_adjusted_score": float(adj.effective_score),
                "possible_gain": float(adj.effective_score - adj.original_score),
                "cap_percentage": float(adj.cap_percentage),
                "was_adjusted": adj.was_adjusted,
                "was_capped": adj.was_capped,
            })

    return {
        "score_adjustment_cap": float(cap_dec),
        "previews": previews,
        "disclaimer": "Hypothetical maximum achievable adjusted scores based on selected cap. Not actual awarded grades.",
    }
