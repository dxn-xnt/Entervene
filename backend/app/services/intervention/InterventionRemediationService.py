"""Teacher-private preparation; references never grant student access."""
import json
import re
from decimal import Decimal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.orm import Session, selectinload

from app.core.Config import settings
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkCoverage import ClassworkCoverage
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.services.classwork.ClassworkAccessService import assignment_allows_student
from app.services.classwork.ClassworkShared import assignment_is_available, assignment_is_locked
from app.models.intervention.Intervention import Intervention
from app.services.intervention.InterventionResourceRecipientService import (
    ResourceRecipientScope,
    apply_resource_recipient_scope,
    describe_resource_recipient_scope,
    resolve_authorized_subject_class_ids,
    resolve_intervention_recipient_scopes,
)
from app.services.grading.PassingThresholdReader import require_subject_passing_threshold
from app.services.ai import Provider
from app.services.intervention.InterventionDiagnosisService import effective_diagnosis_snapshot
from app.services.intervention.InterventionReviewerGenerationService import build_grounding
from app.services.intervention.InterventionSupportMaterialService import _basis
from app.services.intervention.TeacherInterventionService import _eligible_scope, _source
from app.services.intervention.InterventionRemediationFocusService import build_remediation_focus
from app.services.intervention.RemediationGenerationEligibilityService import resolve_remediation_generation_eligibility
from app.services.intervention.RemediationRubricService import serialize_classwork_rubric_levels
from app.services.grading.ExaminationCalculator import EXAM_SUBTYPES, categorize_exam_subtype
from app.services.grading.ComponentMapper import CanonicalGradingComponent, classify_classwork_component
from app.services.grading.RemediationScoreAdjuster import (
    DEFAULT_REMEDIATION_CAP_PERCENTAGE,
    adjust_remediation_score,
    validate_cap_percentage,
)
from app.services.grading.SubjectGradeProjectionService import calculate_subject_grade_projection
from app.services.grading.MidtermRemediationProjectionService import calculate_ai_midterm_what_if

FORMATS = {"QUIZ", "TOS", "CLASSWORK", "EXISTING_MATERIAL_ONLY"}
AI_RECOMMENDATION_FORMATS = {"QUIZ", "CLASSWORK", "EXISTING_MATERIAL_ONLY"}
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
    recipient_scope: ResourceRecipientScope | None = None


class PlanUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    teacher_choice: str | None = None
    grade_treatment: str | None = None
    original_exam_assignment_id: int | None = None
    target_assignment_ids: list[int] | None = None
    score_adjustment_cap: float | None = None
    selected_resources: list[ResourceRef] = Field(default_factory=list, max_length=30)
    resource_recipient_scope: ResourceRecipientScope | None = None


class Advisory(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    recommended_format: str
    recommended_grade_treatment: str | None
    reason: str = Field(min_length=10, max_length=400)


def _advisory_options(focus: dict, exams: list[dict], has_resources: bool) -> list[dict]:
    """Return only format/treatment pairs supported by the existing authoring workflow."""
    component = focus.get("component")
    options: list[tuple[str, str | None]] = []
    if component == "WRITTEN_WORK":
        options.extend((
            ("QUIZ", "WRITTEN_WORK"),
            ("QUIZ", "PRACTICE_ONLY"),
            ("CLASSWORK", "WRITTEN_WORK"),
            ("CLASSWORK", "PRACTICE_ONLY"),
        ))
    elif component == "PERFORMANCE_TASK":
        options.extend((
            ("CLASSWORK", "PERFORMANCE_TASK"),
            ("CLASSWORK", "PRACTICE_ONLY"),
        ))
    elif component == "EXAMINATION":
        options.append(("QUIZ", "PRACTICE_ONLY"))
        subtype = focus.get("exam_subtype")
        if subtype and any(exam.get("subtype") == subtype for exam in exams):
            options.insert(0, ("QUIZ", "EXAMINATION"))
    else:
        # Ambiguous component evidence cannot support a graded recommendation.
        options.extend((
            ("QUIZ", "PRACTICE_ONLY"),
            ("CLASSWORK", "PRACTICE_ONLY"),
        ))
    if has_resources:
        options.append(("EXISTING_MATERIAL_ONLY", None))
    return [
        {"recommended_format": method, "recommended_grade_treatment": treatment}
        for method, treatment in options
    ]


def _validate_advisory_mapping(advice: Advisory, options: list[dict]) -> None:
    if advice.recommended_format not in AI_RECOMMENDATION_FORMATS:
        raise HTTPException(502, "AI returned a non-assignable remediation format")
    candidate = {
        "recommended_format": advice.recommended_format,
        "recommended_grade_treatment": advice.recommended_grade_treatment,
    }
    if candidate not in options:
        raise HTTPException(502, "AI returned a remediation format that is incompatible with the verified evidence")


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


def _active_target_assignment_id(
    db: Session,
    row: Intervention,
    explicit_target_id: int | None = None,
) -> int | None:
    """Resolve the single active target original assignment for scoping focus/resources."""
    if explicit_target_id is not None:
        return explicit_target_id
    plan = row.remediation_plan if isinstance(row.remediation_plan, dict) else {}
    if plan.get("grade_treatment") == "EXAMINATION":
        exam_id = plan.get("original_exam_assignment_id")
        if isinstance(exam_id, int):
            return exam_id
    plan_targets = [
        tid for tid in (plan.get("target_assignment_ids") or [])
        if isinstance(tid, int)
    ]
    if not plan_targets:
        return None
    linked_ids = {
        item[0]
        for item in db.query(RemediationAssignmentLink.original_assignment_id)
        .filter_by(student_id=row.student_id)
        .all()
    }
    unlinked = [tid for tid in plan_targets if tid not in linked_ids]
    if unlinked:
        return unlinked[-1]
    if len(plan_targets) == 1:
        return plan_targets[0]
    return None


def resources(
    db: Session,
    row: Intervention,
    staff_id: str,
    *,
    target_assignment_id: int | None = None,
) -> list[dict]:
    result = []
    focus = build_remediation_focus(row, db=db, target_assignment_id=target_assignment_id)
    focus_lesson_ids = {
        item["id"] for item in focus["lessons"] if item.get("id") is not None
    }
    selected_cw_ids = {
        ref.get("id")
        for ref in (
            row.remediation_plan.get("selected_resources", [])
            if isinstance(row.remediation_plan, dict)
            else []
        )
        if isinstance(ref, dict) and ref.get("kind") == "CLASSWORK" and ref.get("id") is not None
    }

    # Supporting Resources are genuine, non-graded READING classworks only (Lessons are not supporting resources).
    classworks = db.query(Classwork).filter(
        Classwork.subject_id == row.subject_id,
        Classwork.created_by_staff_id == staff_id,
        Classwork.is_archived == False,
        Classwork.classwork_type == "READING",
        Classwork.is_graded == False,
    ).order_by(Classwork.title).all()

    authorized_subject_class_ids = set(
        resolve_authorized_subject_class_ids(
            db, staff_id, row.subject_id, row.academic_period_id
        )
    ) | {row.class_id}

    for cw in classworks:
        assignments = (
            db.query(ClassworkAssignment)
            .options(selectinload(ClassworkAssignment.recipients))
            .filter_by(classwork_id=cw.classwork_id)
            .all()
        )
        period_assignments = [
            a for a in assignments
            if a.class_id in authorized_subject_class_ids
            and a.academic_period_id == row.academic_period_id
        ]
        if assignments and not period_assignments:
            continue

        allows_student_in_class = any(
            a.class_id == row.class_id and assignment_allows_student(a, row.student_id)
            for a in period_assignments
        )
        has_classwide_assignment = any(
            a.recipient_student_id is None and not (getattr(a, "recipients", None) or [])
            for a in period_assignments
        )
        is_from_other_intervention = (
            cw.intervention_resource_origin_id is not None
            and cw.intervention_resource_origin_id != row.intervention_id
        )
        if is_from_other_intervention:
            # Another student's intervention-created reading may only be shown when
            # legitimately shared with this student's class or all subject students.
            if cw.classwork_id not in selected_cw_ids and not allows_student_in_class:
                if not (
                    cw.intervention_resource_recipient_scope == "ALL_SUBJECT_STUDENTS"
                    and has_classwide_assignment
                ):
                    continue
        elif period_assignments and cw.classwork_id not in selected_cw_ids:
            # Exclude individual-only readings targeted exclusively to other students.
            if not allows_student_in_class and not has_classwide_assignment:
                continue

        accessible = bool(cw.is_published and any(
            a.class_id == row.class_id
            and a.academic_period_id == row.academic_period_id
            and assignment_allows_student(a, row.student_id)
            and assignment_is_available(a)
            and not assignment_is_locked(a)
            for a in assignments
        ))
        is_added_for_this_intervention = cw.intervention_resource_origin_id == row.intervention_id
        current_scope = (
            cw.intervention_resource_recipient_scope
            if is_added_for_this_intervention
            else describe_resource_recipient_scope(
                assignments,
                row=row,
                authorized_subject_class_ids=authorized_subject_class_ids,
            )
        ) or "UNASSIGNED"
        linked_lessons = {lesson.lesson_id for lesson in cw.lessons}
        direct_coverage_competencies: set[int] = set()
        for coverage in db.query(ClassworkCoverage).filter_by(classwork_id=cw.classwork_id, valid_until=None).all():
            if coverage.competency_id is not None:
                direct_coverage_competencies.add(coverage.competency_id)
            if coverage.lesson_id is not None:
                linked_lessons.add(coverage.lesson_id)
        matched_lesson = next((item for item in focus["lessons"] if item["id"] in linked_lessons), None)

        # Avoid inferring relevance across unrelated lessons solely because they share a competency.
        linked_competencies: set[int] = set()
        if not linked_lessons or not focus_lesson_ids or matched_lesson is not None:
            linked_competencies.update(direct_coverage_competencies)
            for lesson in cw.lessons:
                if lesson.competency_id is not None and (
                    not focus_lesson_ids or lesson.lesson_id in focus_lesson_ids
                ):
                    linked_competencies.add(lesson.competency_id)
        matched_competency = next((item for item in focus["competencies"] if item["id"] in linked_competencies), None)

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
            "added_by_teacher": is_added_for_this_intervention,
            "match_reason": reason,
            "match_level": match_level,
            "match_rank": rank,
            "is_graded": False,
            "current_recipient_scope": current_scope,
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
        from app.services.intervention.RemediationAttemptPolicy import (
            evaluate_remediation_attempt_state,
            list_remediation_attempt_history,
        )
        attempt_state = evaluate_remediation_attempt_state(db, assignment, work, submission)
        attempt_rows = list_remediation_attempt_history(
            db, assignment.classwork_assignment_id, row.student_id,
        )
        attempt_history = [
            {
                "submission_id": item.submission_id,
                "attempt_count": item.attempt_count,
                "status": item.status,
                "grade": float(item.grade) if item.grade is not None and work.show_scores else None,
                "submitted_at": item.submitted_at.isoformat() if item.submitted_at else None,
                "graded_at": item.graded_at.isoformat() if item.graded_at else None,
            }
            for item in attempt_rows
        ]
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
                         "attempt_count": attempt_state["attempts_used"],
                         "max_attempts": attempt_state["max_attempts"],
                         "attempts_remaining": attempt_state["attempts_remaining"],
                         "is_passed": attempt_state["is_passed"],
                         "needs_teacher_review": attempt_state["needs_teacher_review"],
                         "attempt_history": attempt_history,
                         "grade": float(submission.grade) if submission and submission.grade is not None and work.show_scores else None,
                         "total_points": float(work.total_points) if work.total_points is not None and work.show_scores else None})
        if is_published and submission and submission.status == "graded":
            completed.append({"title": work.title, "assignment_id": assignment.classwork_assignment_id,
                              "grade": float(submission.grade) if submission.grade is not None and work.show_scores else None,
                              "total_points": float(work.total_points) if work.total_points is not None and work.show_scores else None})
    period = db.get(AcademicPeriod, row.academic_period_id)
    threshold_val = 85.0
    try:
        if period:
            res = require_subject_passing_threshold(
                db,
                academic_year_id=period.academic_year_id,
                subject_id=row.subject_id,
                academic_period_id=row.academic_period_id,
            )
            threshold_val = float(res.threshold)
    except Exception:
        pass

    published_assigned = [item for item in assigned if item.get("is_published")]
    has_submitted_awaiting_grading = any(
        (item.get("submission_status") or "").lower() in {"submitted", "late"}
        and item.get("grade") is None
        for item in published_assigned
    )
    has_awaiting_submission = any(
        (item.get("submission_status") or "").lower() not in {"submitted", "late", "graded"}
        for item in published_assigned
    )
    if not assigned:
        remediation_status = "NOT_ASSIGNED"
        status_reason = (
            f"No remediation activity has been assigned yet. Latest AI-predicted grade is below {threshold_val:g}."
            if latest_grade is not None and float(latest_grade) < threshold_val
            else "Latest valid projection is unavailable."
            if latest_grade is None
            else f"Latest AI-predicted grade reached the passing target ({threshold_val:g}). Review to continue support or confirm resolution."
        )
    elif not published_assigned:
        remediation_status = "DRAFT"
        status_reason = "Remediation draft is prepared and not yet published to the student."
    elif has_submitted_awaiting_grading:
        remediation_status = "SUBMITTED"
        status_reason = (
            "Student submitted the remediation activity. "
            "Grade the submission to update the AI prediction."
        )
    elif has_awaiting_submission:
        remediation_status = "ASSIGNED"
        status_reason = (
            "Remediation activity is published and awaiting student submission. "
            "The AI prediction will update after grading."
        )
    else:
        remediation_status = "GRADED"
        has_needs_teacher_review = any(
            bool(item.get("needs_teacher_review")) for item in published_assigned
        )
        if has_needs_teacher_review:
            status_reason = (
                "Student exhausted all 3 remediation attempts without passing. "
                "Needs Teacher Review."
            )
        else:
            status_reason = (
                f"Graded remediation has been applied, and the latest AI-predicted grade remains below {threshold_val:g}."
                if latest_grade is not None and float(latest_grade) < threshold_val
                else "Latest valid projection is unavailable."
                if latest_grade is None
                else f"Latest AI-predicted grade reached the passing target ({threshold_val:g}). Review to continue support or confirm resolution."
            )

    return {"triggering_projection": float(source_grade if source_grade is not None else source.predicted_period_grade),
            "latest_projection": float(latest_grade) if latest_grade is not None else None,
            "latest_revision": latest.revision if ready else None,
            "passing_threshold": threshold_val,
            "remediation_status": remediation_status,
            "completed_remediation": completed,
            "assigned_remediation": assigned,
            "status_reason": status_reason,
            "status": row.status}


def build_remediation_prediction_impact(
    db: Session,
    row: Intervention,
    plan: dict,
    assigned: list[dict],
) -> dict:
    """Compute read-only before/after AI prediction impact using live evidence and locked caps."""
    with db.no_autoflush:
        period = db.get(AcademicPeriod, row.academic_period_id)
        threshold_val = 85.0
        try:
            if period:
                res = require_subject_passing_threshold(
                    db,
                    academic_year_id=period.academic_year_id,
                    subject_id=row.subject_id,
                    academic_period_id=row.academic_period_id,
                )
                threshold_val = float(res.threshold)
        except Exception:
            pass

        grade_treatment = plan.get("grade_treatment")
        is_practice_only = grade_treatment == "PRACTICE_ONLY" or (
            bool(assigned) and all(not item.get("is_graded", True) for item in assigned)
        )

        # Collect locked remediation links first (authoritative cap per linked original),
        # then any unlinked planned target IDs using the plan's cap.
        plan_cap = plan.get("score_adjustment_cap")
        try:
            resolved_plan_cap = float(
                validate_cap_percentage(
                    plan_cap if plan_cap is not None else DEFAULT_REMEDIATION_CAP_PERCENTAGE
                )
            )
        except (TypeError, ValueError):
            resolved_plan_cap = float(DEFAULT_REMEDIATION_CAP_PERCENTAGE)

        target_specs: list[tuple[int, float, str | None]] = []
        seen_target_ids: set[int] = set()

        if not is_practice_only:
            links = (
                db.query(RemediationAssignmentLink)
                .filter_by(
                    source_intervention_id=row.intervention_id,
                    student_id=row.student_id,
                )
                .order_by(RemediationAssignmentLink.remediation_link_id.asc())
                .all()
            )
            for link in links:
                if link.original_assignment_id not in seen_target_ids:
                    seen_target_ids.add(link.original_assignment_id)
                    target_specs.append((
                        int(link.original_assignment_id),
                        float(link.score_adjustment_cap),
                        None,
                    ))

            for item in assigned:
                orig_id = item.get("original_assignment_id")
                if orig_id is None or int(orig_id) in seen_target_ids:
                    continue
                if not item.get("is_graded", True):
                    continue
                seen_target_ids.add(int(orig_id))
                comp = "EXAMINATION" if (item.get("exam_subtype") or grade_treatment == "EXAMINATION") else None
                cap_for_item = 100.0 if comp == "EXAMINATION" else resolved_plan_cap
                target_specs.append((int(orig_id), cap_for_item, comp))

            planned_targets = list(plan.get("target_assignment_ids") or [])
            if grade_treatment == "EXAMINATION" and plan.get("original_exam_assignment_id") is not None:
                exam_id = int(plan["original_exam_assignment_id"])
                if exam_id not in planned_targets:
                    planned_targets.insert(0, exam_id)
            for raw_id in planned_targets:
                if raw_id is None or int(raw_id) in seen_target_ids:
                    continue
                seen_target_ids.add(int(raw_id))
                comp = "EXAMINATION" if grade_treatment == "EXAMINATION" else None
                cap_for_item = 100.0 if comp == "EXAMINATION" else resolved_plan_cap
                target_specs.append((int(raw_id), cap_for_item, comp))

        # Build live target score bounds (using live submissions and any applied remediation).
        target_details: list[dict] = []
        what_if_inputs: list[dict] = []
        for target_id, cap_pct, forced_component in target_specs:
            assignment = db.get(ClassworkAssignment, target_id)
            work = assignment.classwork if assignment is not None else None
            if (
                assignment is None
                or work is None
                or assignment.class_id != row.class_id
                or assignment.academic_period_id != row.academic_period_id
                or work.subject_id != row.subject_id
                or work.is_archived
                or not work.is_graded
                or work.total_points is None
                or float(work.total_points) <= 0
            ):
                continue

            sub = (
                db.query(StudentSubmission)
                .filter_by(
                    classwork_assignment_id=target_id,
                    student_id=row.student_id,
                )
                .filter(StudentSubmission.grade.isnot(None))
                .order_by(StudentSubmission.submission_id.desc())
                .first()
            )
            if sub is None or sub.grade is None:
                continue

            orig_score = float(sub.grade)
            max_points = float(work.total_points)
            classified = classify_classwork_component(
                work.classwork_type, work.classwork_category, work.exam_subtype,
            )
            component = (
                forced_component
                if forced_component is not None
                else (
                    "EXAMINATION"
                    if classified == CanonicalGradingComponent.ASSESSMENT
                    else classified.value
                )
            )

            # Determine current effective score (including any already-graded remediation).
            current_effective = orig_score
            if component == "EXAMINATION":
                remedial_exams = db.query(ClassworkAssignment).filter_by(
                    original_exam_assignment_id=target_id,
                    recipient_student_id=row.student_id,
                ).all()
                for rem_exam in remedial_exams:
                    rem_sub = (
                        db.query(StudentSubmission)
                        .filter_by(
                            classwork_assignment_id=rem_exam.classwork_assignment_id,
                            student_id=row.student_id,
                        )
                        .filter(StudentSubmission.grade.isnot(None))
                        .order_by(StudentSubmission.submission_id.desc())
                        .first()
                    )
                    if rem_sub is not None and rem_sub.grade is not None:
                        current_effective = max(current_effective, float(rem_sub.grade))
                effective_max = max(current_effective, max_points)
                applied_cap = 100.0
            else:
                link_for_target = db.query(RemediationAssignmentLink).filter_by(
                    original_assignment_id=target_id,
                    student_id=row.student_id,
                ).first()
                applied_cap = float(link_for_target.score_adjustment_cap) if link_for_target else cap_pct
                if link_for_target is not None:
                    rem_sub = (
                        db.query(StudentSubmission)
                        .filter_by(
                            classwork_assignment_id=link_for_target.remediation_assignment_id,
                            student_id=row.student_id,
                        )
                        .filter(StudentSubmission.grade.isnot(None))
                        .order_by(StudentSubmission.submission_id.desc())
                        .first()
                    )
                    if rem_sub is not None and rem_sub.grade is not None:
                        applied_adj = adjust_remediation_score(
                            original_score=orig_score,
                            remediation_score=float(rem_sub.grade),
                            original_max_points=max_points,
                            remediation_max_points=max_points,
                            cap_percentage=applied_cap,
                        )
                        current_effective = float(applied_adj.effective_score)
                max_adj = adjust_remediation_score(
                    original_score=orig_score,
                    remediation_score=max_points,
                    original_max_points=max_points,
                    remediation_max_points=max_points,
                    cap_percentage=applied_cap,
                )
                effective_max = max(current_effective, float(max_adj.effective_score))

            target_details.append({
                "assignment_id": target_id,
                "title": work.title,
                "component": component,
                "original_score": orig_score,
                "current_effective_score": current_effective,
                "max_points": max_points,
                "cap_percentage": applied_cap,
                "effective_max_score": effective_max,
                "possible_score_gain": round(max(0.0, effective_max - current_effective), 4),
                "hypothetical_predicted_grade": None,
                "predicted_gain": None,
            })
            what_if_inputs.append({
                "assignment_id": target_id,
                "component": component,
                "applied": True,
                "maximum_hypothetical_effective_score": effective_max,
            })

        source = _source(db, row)
        version = db.get(AIModelVersion, source.model_version_id)
        what_if = calculate_ai_midterm_what_if(
            db,
            student_id=row.student_id,
            class_id=row.class_id,
            subject_id=row.subject_id,
            academic_period_id=row.academic_period_id,
            model_version_id=source.model_version_id if version is not None else None,
            model_name=version.model_name if version is not None else None,
            target_projections=[] if is_practice_only else what_if_inputs,
        )

        if what_if["status"] != "AVAILABLE":
            return {
                "status": "UNAVAILABLE",
                "is_official_grade": False,
                "is_guaranteed": False,
                "is_practice_only": is_practice_only,
                "model_version_id": what_if.get("model_version_id"),
                "model_name": what_if.get("model_name"),
                "current_predicted_grade": None,
                "max_remediation_predicted_grade": None,
                "predicted_gain": None,
                "passing_threshold": threshold_val,
                "score_adjustment_cap": (
                    target_details[0]["cap_percentage"]
                    if target_details
                    else (None if is_practice_only else resolved_plan_cap)
                ),
                "targets": target_details,
                "unavailable_reasons": what_if.get("unavailable_reasons") or [],
            }

        baseline_grade = float(what_if["baseline_predicted_term_grade"])
        estimates_by_id = {
            int(est["assignment_id"]): est for est in what_if.get("target_estimates", [])
        }
        for detail in target_details:
            est = estimates_by_id.get(detail["assignment_id"])
            if est is not None:
                detail["hypothetical_predicted_grade"] = float(est["hypothetical_predicted_term_grade"])
                detail["predicted_gain"] = float(est["estimated_difference_from_baseline"])

        if is_practice_only:
            max_predicted = baseline_grade
            predicted_gain = 0.0
        elif what_if.get("target_estimates"):
            last_est = what_if["target_estimates"][-1]
            max_predicted = float(last_est["hypothetical_predicted_term_grade"])
            predicted_gain = float(last_est["estimated_difference_from_baseline"])
        else:
            max_predicted = None
            predicted_gain = None

        return {
            "status": "AVAILABLE",
            "is_official_grade": False,
            "is_guaranteed": False,
            "is_practice_only": is_practice_only,
            "model_version_id": what_if.get("model_version_id"),
            "model_name": what_if.get("model_name"),
            "current_predicted_grade": baseline_grade,
            "max_remediation_predicted_grade": max_predicted,
            "predicted_gain": predicted_gain,
            "passing_threshold": threshold_val,
            "score_adjustment_cap": (
                target_details[0]["cap_percentage"]
                if target_details
                else (None if is_practice_only else resolved_plan_cap)
            ),
            "targets": target_details,
            "unavailable_reasons": [],
        }


def get_workspace(
    db: Session,
    staff_id: str,
    intervention_id: int,
    *,
    target_assignment_id: int | None = None,
) -> dict:
    row = _row(db, staff_id, intervention_id)
    stored_plan = dict(row.remediation_plan or {})
    stored_treatment = stored_plan.get("grade_treatment")
    orig_exam = (
        stored_plan.get("original_exam_assignment_id")
        if stored_treatment in (None, "EXAMINATION")
        else None
    )
    target_ids = stored_plan.get("target_assignment_ids")
    if target_ids is None:
        target_ids = [orig_exam] if orig_exam is not None else []
    cap = stored_plan.get("score_adjustment_cap")
    if cap is None:
        cap = float(DEFAULT_REMEDIATION_CAP_PERCENTAGE)

    active_target_id = _active_target_assignment_id(db, row, target_assignment_id)
    focus = build_remediation_focus(row, db=db, target_assignment_id=active_target_id)
    cached_suggestion = stored_plan.get("ai_suggestion")
    if (
        isinstance(cached_suggestion, dict)
        and isinstance(cached_suggestion.get("evidence_used"), dict)
        and cached_suggestion["evidence_used"].get("has_scored_competency_evidence") is False
        and focus.get("evidence_level") in {"QUESTION_SCORE", "SCORED_COMPETENCY"}
    ):
        cached_suggestion = None

    plan_data = {
        "grade_treatment": None,
        "teacher_choice": None,
        "selected_resources": [],
        **stored_plan,
        "ai_suggestion": cached_suggestion,
        "original_exam_assignment_id": orig_exam,
        "target_assignment_ids": target_ids,
        "score_adjustment_cap": cap,
    }
    preview_data = preview_score_adjustment(
        db, staff_id, intervention_id, cap_percentage=cap, target_assignment_ids=target_ids
    )
    eligibility = resolve_remediation_generation_eligibility(
        db, row, target_assignment_id=active_target_id,
    )
    eligibility.pop("scope", None)
    progress_data = progress(db, row)
    prediction_impact = build_remediation_prediction_impact(
        db, row, plan_data, progress_data["assigned_remediation"],
    )
    return {"plan": plan_data,
            "resources": resources(db, row, staff_id, target_assignment_id=active_target_id), "focus": focus,
            "recipient_scopes": resolve_intervention_recipient_scopes(db, staff_id, row),
            "generation_eligibility": eligibility,
            "original_exams": original_exams(db, row),
            "progress": progress_data,
            "prediction_impact": prediction_impact,
            "score_previews": preview_data.get("previews", [])}


def project_subject_grade(
    db: Session,
    staff_id: str,
    intervention_id: int,
    target_assignment_ids: list[int],
    score_adjustment_cap: Decimal | float | None = None,
) -> dict:
    """Authorize and calculate a preview without selecting or persisting targets."""
    with db.no_autoflush:
        row = _row(db, staff_id, intervention_id)
        if len(set(target_assignment_ids)) != len(target_assignment_ids):
            raise HTTPException(status_code=422, detail={
                "code": "DUPLICATE_PROJECTION_TARGETS",
                "message": "Each original assignment may appear only once in a projection request.",
            })

        focus = build_remediation_focus(row)
        expected_components = {
            "WRITTEN_WORK": CanonicalGradingComponent.WRITTEN_WORK,
            "PERFORMANCE_TASK": CanonicalGradingComponent.PERFORMANCE_TASK,
        }
        expected_component = expected_components.get(focus.get("component"))
        if target_assignment_ids and expected_component is None:
            raise HTTPException(status_code=422, detail={
                "code": "PROJECTION_COMPONENT_UNSUPPORTED",
                "message": "Subject-grade target projection requires a verified Written Work or Performance Task focus.",
            })

        invalid: list[dict] = []
        for assignment_id in target_assignment_ids:
            assignment = db.get(ClassworkAssignment, assignment_id)
            work = assignment.classwork if assignment is not None else None
            code = None
            message = None
            if assignment is None or work is None:
                code, message = "TARGET_NOT_FOUND", "Target assignment was not found."
            elif (
                assignment.class_id != row.class_id
                or assignment.academic_period_id != row.academic_period_id
                or work.subject_id != row.subject_id
            ):
                code, message = "TARGET_OUTSIDE_INTERVENTION_SCOPE", "Target assignment is outside the intervention class, subject, or period."
            elif assignment.recipient_student_id not in (None, row.student_id):
                code, message = "TARGET_OUTSIDE_STUDENT_SCOPE", "Target assignment belongs to another student."
            elif assignment.source_intervention_id is not None or assignment.original_exam_assignment_id is not None:
                code, message = "TARGET_IS_REMEDIATION", "A remediation activity cannot be used as an original target."
            elif work.is_archived or not work.is_graded:
                code, message = "TARGET_UNAVAILABLE", "Target assignment is archived or is not graded."
            elif work.total_points is None or work.total_points <= 0:
                code, message = "TARGET_INVALID_MAX_POINTS", "Target assignment must have positive maximum points."
            else:
                component = classify_classwork_component(
                    work.classwork_type, work.classwork_category, work.exam_subtype,
                )
                if component != expected_component:
                    code, message = "TARGET_COMPONENT_MISMATCH", "Target assignment does not match the intervention's diagnosed grading component."
                elif db.query(RemediationAssignmentLink.remediation_link_id).filter_by(
                    original_assignment_id=assignment_id,
                    student_id=row.student_id,
                ).first() is not None:
                    code, message = "TARGET_ALREADY_REMEDIATED", "This original assignment already has a remediation activity for the student."
                elif db.query(StudentSubmission.submission_id).filter_by(
                    classwork_assignment_id=assignment_id,
                    student_id=row.student_id,
                ).filter(StudentSubmission.grade.isnot(None)).first() is None:
                    code, message = "TARGET_ORIGINAL_UNSCORED", "Target assignment needs a recorded original score."
            if code is not None:
                invalid.append({"assignment_id": assignment_id, "code": code, "message": message})

        if invalid:
            raise HTTPException(status_code=422, detail={
                "code": "INVALID_PROJECTION_TARGETS",
                "message": "One or more projection targets are not eligible.",
                "reasons": invalid,
            })

        plan = row.remediation_plan if isinstance(row.remediation_plan, dict) else {}
        authoritative_cap = (
            score_adjustment_cap
            if score_adjustment_cap is not None
            else plan.get("score_adjustment_cap", DEFAULT_REMEDIATION_CAP_PERCENTAGE)
        )
        authoritative = calculate_subject_grade_projection(
            db,
            staff_id=staff_id,
            student_id=row.student_id,
            class_id=row.class_id,
            subject_id=row.subject_id,
            academic_period_id=row.academic_period_id,
            target_assignment_ids=target_assignment_ids,
            cap_percentage=authoritative_cap,
            eligible_components={expected_component} if expected_component is not None else set(),
            source_intervention_id=None,
        )
        source = _source(db, row)
        version = db.get(AIModelVersion, source.model_version_id)
        authoritative["ai_midterm_what_if"] = calculate_ai_midterm_what_if(
            db,
            student_id=row.student_id,
            class_id=row.class_id,
            subject_id=row.subject_id,
            academic_period_id=row.academic_period_id,
            model_version_id=source.model_version_id if version is not None else None,
            model_name=version.model_name if version is not None else None,
            target_projections=authoritative["target_projections"],
        )
        return authoritative


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
            results.append({"assignment_id": assignment.classwork_assignment_id,
                            "classwork_id": work.classwork_id,
                            "classwork_type": work.classwork_type,
                            "title": work.title,
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
        if requested_exam_id is None:
            raise HTTPException(422, "Select a scored original Examination in this student scope")
        if requested_exam_id not in {
            exam["assignment_id"] for exam in original_exams(db, row)
        }:
            raise HTTPException(422, "Select a scored original Examination in this student scope")

    current_treatment = current_plan.get("grade_treatment")
    if current_plan.get("teacher_choice") in {"QUIZ", "CLASSWORK"} and current_treatment is None:
        current_treatment = "PRACTICE_ONLY"
    if existing_activity:
        current_targets = list(current_plan.get("target_assignment_ids", []))
        linked_original_ids: list[int] = []
        existing_assignments = (
            db.query(ClassworkAssignment)
            .filter_by(
                source_intervention_id=row.intervention_id,
                recipient_student_id=row.student_id,
            )
            .order_by(ClassworkAssignment.classwork_assignment_id)
            .all()
        )
        for assignment in existing_assignments:
            if assignment.original_exam_assignment_id is not None:
                orig_id = assignment.original_exam_assignment_id
            else:
                link = (
                    db.query(RemediationAssignmentLink)
                    .filter_by(remediation_assignment_id=assignment.classwork_assignment_id)
                    .first()
                )
                orig_id = link.original_assignment_id if link is not None else None
            if orig_id is not None and orig_id not in linked_original_ids:
                linked_original_ids.append(orig_id)

        linked_set = set(linked_original_ids)
        immutable_targets = [t for t in current_targets if t in linked_set]
        for orig_id in linked_original_ids:
            if orig_id not in immutable_targets:
                immutable_targets.append(orig_id)

        targets_modified = (
            body.target_assignment_ids is not None
            and (
                target_ids[:len(immutable_targets)] != immutable_targets
                or any(t in linked_set for t in target_ids[len(immutable_targets):])
            )
        )
        current_exam_id = (
            current_plan.get("original_exam_assignment_id")
            if current_treatment == "EXAMINATION"
            else None
        )
        if (
            body.teacher_choice != current_plan.get("teacher_choice")
            or requested_treatment != current_treatment
            or requested_exam_id != current_exam_id
            or targets_modified
            or (body.score_adjustment_cap is not None and resolved_cap != current_plan.get("score_adjustment_cap", float(DEFAULT_REMEDIATION_CAP_PERCENTAGE)))
        ):
            raise HTTPException(409, "Remediation format, grade treatment, and targeted classworks cannot change after a targeted activity is created")
        if body.target_assignment_ids is not None and requested_treatment in {"WRITTEN_WORK", "PERFORMANCE_TASK"}:
            unlinked_targets = [t for t in target_ids[len(immutable_targets):] if t not in linked_set]
            target_ids = immutable_targets + (unlinked_targets[-1:] if unlinked_targets else [])
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
        "selected_resources": [
            {"kind": ref.kind, "id": ref.id} for ref in body.selected_resources
        ],
        "evidence_basis": _basis(row, diagnosis_override=effective_diagnosis_snapshot(db, row)),
    })
    row.remediation_plan = plan

    newly_shared_notifications: list[tuple[Classwork, list[int]]] = []
    for ref in body.selected_resources:
        effective_scope = ref.recipient_scope or body.resource_recipient_scope
        if ref.kind == "CLASSWORK" and effective_scope is not None:
            cw = db.get(Classwork, ref.id)
            if cw is not None:
                scope_result = apply_resource_recipient_scope(
                    db,
                    classwork=cw,
                    intervention=row,
                    staff_id=staff_id,
                    scope=effective_scope,
                )
                shared_cids = scope_result.get("newly_classwide_published_class_ids") or []
                if shared_cids:
                    newly_shared_notifications.append((cw, shared_cids))

    if selected:
        # Backfill active interventions created before activation notifications
        # existed. The stable intervention URL makes repeated saves idempotent.
        from app.services.intervention.StudySupportReminderService import (
            stage_intervention_study_support_available,
        )
        stage_intervention_study_support_available(db, row)
    db.commit()

    if newly_shared_notifications:
        from app.models.classwork.ClassworkLesson import ClassworkLesson
        from app.services.classwork.ClassworkService import (
            build_classwork_notification_details,
            notify_students_for_classwork,
        )
        for cw, shared_cids in newly_shared_notifications:
            try:
                lesson_rows = (
                    db.query(ClassworkLesson.lesson_id)
                    .filter(ClassworkLesson.classwork_id == cw.classwork_id)
                    .all()
                )
                lesson_ids_list = [r[0] for r in lesson_rows] if lesson_rows else None
                notif_title, notif_body = build_classwork_notification_details(
                    db=db,
                    classwork_title=cw.title,
                    staff_id=staff_id,
                    subject_id=cw.subject_id,
                    lesson_ids=lesson_ids_list,
                    due_date=None,
                    action_type="New",
                )
                notify_students_for_classwork(
                    db=db,
                    class_ids=shared_cids,
                    title=notif_title,
                    body_text=notif_body,
                    notification_type="assignment_due",
                    classwork_id=cw.classwork_id,
                    subject_id=cw.subject_id,
                )
            except Exception:
                pass

    return get_workspace(db, staff_id, intervention_id)


async def generate_advisory(db: Session, staff_id: str, intervention_id: int) -> dict:
    row = _row(db, staff_id, intervention_id)
    if not settings.groq_api_key and not settings.gemini_api_key:
        raise HTTPException(503, "AI service is not configured for remediation advice")
    effective_diagnosis = effective_diagnosis_snapshot(db, row)
    grounding = build_grounding(row, _source(db, row), db=db)
    focus = build_remediation_focus(row, db=db)
    exams = original_exams(db, row)
    options = _advisory_options(focus, exams, bool(resources(db, row, staff_id)))
    weakest_activity_types = sorted({
        str(item["classwork_type"])
        for item in grounding["supporting_scored_activities"]
        if item.get("component") == focus.get("component") and item.get("classwork_type")
    })
    evidence_payload = {
        **grounding,
        "weakest_component_activity_types": weakest_activity_types,
    }
    system = ("You advise a teacher on a remediation format and grade treatment. Return only JSON with "
              "recommended_format, recommended_grade_treatment, and reason. Choose one exact pair from eligible_recommendations. "
              "TOS is teacher planning only and is never a student remediation recommendation. Advisory only. "
              "Use only the supplied facts. Question scores support missed concepts; scored competencies support measured weakness. "
              "Activity totals plus coverage allow review suggestions but never prove each covered topic weak. "
              "Component-only evidence supports only component-level advice. "
              "When both QUIZ and CLASSWORK are eligible for WRITTEN_WORK, weigh the weak supporting activity types and evidence: "
              "prefer QUIZ when the weak Written Work evidence comes from quizzes or targeted concept-check items, "
              "and prefer CLASSWORK when the weak Written Work evidence comes from written assignments/activities or calls for guided step-by-step written practice. "
              "Do not select or invent an examination slot, subtype, question, task, lesson, or competency. "
              "Keep reason short and format-level. Refer only to the verified grading component and evidence level. "
              "Do not name a lesson or competency unless it appears under measured_scored_competencies. "
              "When evidence is coverage-only or component-only, do not claim a topic weakness. "
              "Prefer neutral wording such as 'supports the verified Written Work focus'.")
    raw = await Provider.generate_text(json.dumps({
                                           "evidence": evidence_payload,
                                           "deterministic_focus": focus,
                                           "eligible_recommendations": options,
                                       }),
                                       system, json_output=True, max_tokens=350)
    try:
        candidate = raw.strip()
        if candidate.startswith("```json"):
            candidate = candidate[7:].removesuffix("```").strip()
        advice = Advisory.model_validate(json.loads(candidate))
    except (ValueError, ValidationError, TypeError):
        raise HTTPException(502, "AI returned an invalid remediation advisory") from None
    _validate_advisory_mapping(advice, options)
    _validate_advisory_reason(advice, grounding, focus)
    db.refresh(row)
    if row.status != "ACTIVE" or not _eligible_scope(db, staff_id, row):
        raise HTTPException(409, "Intervention scope changed while preparing advice")
    plan = dict(row.remediation_plan or {})
    plan["ai_suggestion"] = {
        **advice.model_dump(),
        "focus": grounding["measured_scored_competencies"],
        "evidence_used": _basis(row, diagnosis_override=effective_diagnosis),
    }
    plan.setdefault("teacher_choice", None)
    plan.setdefault("selected_resources", [])
    plan["evidence_basis"] = _basis(row, diagnosis_override=effective_diagnosis)
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

    diag_by_assignment_id: dict[int, dict] = {}
    diag_by_classwork_id: dict[int, dict] = {}
    for act in (row.diagnosis_snapshot or {}).get("supporting_activities", []):
        asgn_id = act.get("classwork_assignment_id")
        cw_id = act.get("classwork_id")
        if asgn_id is not None:
            diag_by_assignment_id[asgn_id] = act
        if cw_id is not None and cw_id not in diag_by_classwork_id:
            diag_by_classwork_id[cw_id] = act

    for exam in original_exams(db, row):
        diag_by_assignment_id[exam["assignment_id"]] = {
            "classwork_id": exam.get("classwork_id"),
            "classwork_assignment_id": exam.get("assignment_id"),
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
        resolved_classwork_id = None

        # Always resolve the authoritative assignment by primary key first so a
        # different classwork whose classwork_id numerically equals target_id
        # can never overwrite this assignment's metadata or score.
        assignment = (
            db.query(ClassworkAssignment)
            .filter_by(classwork_assignment_id=target_id)
            .first()
        )
        if assignment and (
            assignment.class_id != row.class_id
            or assignment.academic_period_id != row.academic_period_id
            or assignment.classwork is None
            or assignment.classwork.subject_id != row.subject_id
        ):
            assignment = None

        if target_id in provided_items:
            p = provided_items[target_id]
            if p.get("original_score") is not None and p.get("max_points") is not None:
                orig_score = p["original_score"]
                max_points = p["max_points"]
                title = p.get("title")

        matched_diag = diag_by_assignment_id.get(target_id)
        if matched_diag is None and assignment is None:
            matched_diag = diag_by_classwork_id.get(target_id)
            assignment = (
                db.query(ClassworkAssignment)
                .filter_by(
                    classwork_id=target_id,
                    class_id=row.class_id,
                    academic_period_id=row.academic_period_id,
                )
                .first()
            )
            if assignment and (
                assignment.classwork is None
                or assignment.classwork.subject_id != row.subject_id
            ):
                assignment = None

        if assignment and assignment.classwork:
            resolved_classwork_id = assignment.classwork_id
        elif matched_diag and matched_diag.get("classwork_id") is not None:
            resolved_classwork_id = matched_diag.get("classwork_id")

        if orig_score is None or max_points is None:
            if matched_diag is not None:
                orig_score = matched_diag.get("score")
                max_points = matched_diag.get("possible_score")
                title = matched_diag.get("title")

        if orig_score is None or max_points is None:
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

        rubric_levels = serialize_classwork_rubric_levels(assignment.classwork if assignment else None)
        if orig_score is not None and max_points is not None and max_points > 0:
            adj = adjust_remediation_score(
                original_score=orig_score,
                remediation_score=max_points,
                max_points=max_points,
                cap_percentage=cap_dec,
            )
            previews.append({
                "assignment_id": target_id,
                "classwork_id": resolved_classwork_id,
                "title": title,
                "original_score": float(adj.original_score),
                "max_points": float(adj.max_points),
                "max_adjusted_score": float(adj.effective_score),
                "possible_gain": float(adj.effective_score - adj.original_score),
                "cap_percentage": float(adj.cap_percentage),
                "was_adjusted": adj.was_adjusted,
                "was_capped": adj.was_capped,
                "rubric_levels": rubric_levels,
            })

    return {
        "score_adjustment_cap": float(cap_dec),
        "previews": previews,
        "disclaimer": "Hypothetical maximum achievable adjusted scores based on selected cap. Not actual awarded grades.",
    }
