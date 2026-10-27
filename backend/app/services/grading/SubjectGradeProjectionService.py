"""Read-only authoritative subject-grade projections for targeted WW/PT remediation.

The calculator deliberately keeps three different values separate:

* the official Initial Grade produced by the class-record calculation;
* the transmuted Term Grade compared with the subject passing threshold; and
* a classwork cap, which only limits a hypothetical effective item score.

No submission, score, intervention, remediation link, or period grade is written.
"""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.people.Student import Student
from app.services.grading.ComponentMapper import CanonicalGradingComponent, classify_classwork_component
from app.services.grading.ExaminationCalculator import ExaminationObservation, compute_examination_component
from app.services.grading.PassingThresholdReader import (
    read_passing_threshold_context_or_422,
    require_subject_passing_threshold,
)
from app.services.grading.RemedialClassworkResolver import (
    ResolvedClassworkScores,
    resolve_student_classwork_scores,
)
from app.services.grading.RemediationScoreAdjuster import (
    DEFAULT_REMEDIATION_CAP_PERCENTAGE,
    adjust_remediation_score,
    validate_cap_percentage,
)
from app.services.student_record.StudentRecordService import (
    READING_TYPE,
    _categorize_assignment,
    _classwork_assignments,
    _compute_student_period_components,
    _grade_send_readiness,
    _grade_send_requirements,
    _submissions_by_student,
    _teacher_scope,
    resolve_subject_grading_weights,
)


AVAILABLE = "AVAILABLE"
UNAVAILABLE = "UNAVAILABLE"
FINALIZED = "FINALIZED"
GRADE_REPRESENTATION = "TRANSMUTED_TERM_GRADE"


def _reason(code: str, message: str, *, assignment_id: int | None = None) -> dict[str, Any]:
    value: dict[str, Any] = {"code": code, "message": message}
    if assignment_id is not None:
        value["assignment_id"] = assignment_id
    return value


def _score(submissions: dict[int, Any], assignment_id: int) -> float | None:
    submission = submissions.get(assignment_id)
    if submission is None or submission.grade is None:
        return None
    return float(submission.grade)


def _split_assignments(assignments: list[ClassworkAssignment]) -> tuple[list, list, list]:
    written: list[ClassworkAssignment] = []
    performance: list[ClassworkAssignment] = []
    examinations: list[ClassworkAssignment] = []
    for assignment in assignments:
        work = assignment.classwork
        if not getattr(work, "is_graded", True) or (getattr(work, "classwork_type", "") or "").upper() == READING_TYPE:
            continue
        category = _categorize_assignment(assignment)
        if category == "writtenWork":
            written.append(assignment)
        elif category == "performanceTask":
            performance.append(assignment)
        else:
            examinations.append(assignment)
    return written, performance, examinations


def _with_effective_scores(
    resolved: ResolvedClassworkScores,
    effective_scores: dict[int, Decimal | None],
) -> ResolvedClassworkScores:
    return replace(
        resolved,
        effective_scores=effective_scores,
        effective_scores_float={
            assignment_id: float(value) if value is not None else None
            for assignment_id, value in effective_scores.items()
        },
    )


def _strict_exam_reasons(components: dict[str, Any]) -> list[dict[str, Any]]:
    evidence = components["item_evidence"]["quarterly_assessment"]
    observations = [
        ExaminationObservation(
            score=score,
            possible=float(assignment.classwork.total_points or 0),
            exam_subtype=getattr(assignment.classwork, "exam_subtype", None),
            title=getattr(assignment.classwork, "title", None),
            category=getattr(assignment.classwork, "classwork_category", None),
        )
        for assignment, score in evidence
    ]
    result = compute_examination_component(observations, require_complete_for_percent=True)
    if result.complete:
        return []
    return [_reason(
        "INCOMPLETE_EXAMINATION_EVIDENCE",
        "Authoritative projection requires scored Summative 1, Summative 2, and Term Examination evidence.",
    )]


def _target_problem(
    assignment_id: int,
    *,
    assignments_by_id: dict[int, ClassworkAssignment],
    student_id: UUID,
    linked_original_ids: set[int],
    remedial_ids: frozenset[int],
    submissions: dict[int, Any],
) -> dict[str, Any]:
    assignment = assignments_by_id.get(assignment_id)
    if assignment is None:
        return _reason("TARGET_OUTSIDE_SCOPE", "Target assignment is outside the requested class, subject, or period.", assignment_id=assignment_id)
    if assignment.recipient_student_id not in (None, student_id):
        return _reason("TARGET_OUTSIDE_STUDENT_SCOPE", "Target assignment belongs to another student.", assignment_id=assignment_id)
    if assignment_id in remedial_ids or assignment.source_intervention_id is not None or assignment.original_exam_assignment_id is not None:
        return _reason("TARGET_IS_REMEDIATION", "A remediation activity cannot be used as an original target.", assignment_id=assignment_id)
    if assignment_id in linked_original_ids:
        return _reason("TARGET_ALREADY_REMEDIATED", "This original assignment already has a remediation activity for the student.", assignment_id=assignment_id)
    work = assignment.classwork
    if work is None or work.is_archived or not work.is_graded:
        return _reason("TARGET_UNAVAILABLE", "Target assignment is archived or is not graded.", assignment_id=assignment_id)
    component = classify_classwork_component(work.classwork_type, work.classwork_category, work.exam_subtype)
    if component not in {CanonicalGradingComponent.WRITTEN_WORK, CanonicalGradingComponent.PERFORMANCE_TASK}:
        return _reason("TARGET_COMPONENT_UNSUPPORTED", "Only Written Work and Performance Task originals can be projected here.", assignment_id=assignment_id)
    if work.total_points is None or Decimal(str(work.total_points)) <= 0:
        return _reason("TARGET_INVALID_MAX_POINTS", "Target assignment must have positive maximum points.", assignment_id=assignment_id)
    if _score(submissions, assignment_id) is None:
        return _reason("TARGET_ORIGINAL_UNSCORED", "Target assignment needs a recorded original score.", assignment_id=assignment_id)
    return _reason("TARGET_UNAVAILABLE", "Target assignment is unavailable for projection.", assignment_id=assignment_id)


def calculate_subject_grade_projection(
    db: Session,
    *,
    staff_id: str,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    academic_period_id: int,
    target_assignment_ids: list[int] | None = None,
    cap_percentage: Decimal | float | int | str = DEFAULT_REMEDIATION_CAP_PERCENTAGE,
    eligible_components: set[CanonicalGradingComponent] | None = None,
    source_intervention_id: int | None = None,
) -> dict[str, Any]:
    """Calculate current and cumulative hypothetical grades without database writes.

    Target order is teacher supplied and retained. Duplicate originals are reported and
    never applied twice. Existing linked remediation is part of the current effective
    score, but its original cannot be selected for a second remediation activity.
    """
    targets = list(target_assignment_ids or [])
    allowed_components = (
        eligible_components
        if eligible_components is not None
        else {
            CanonicalGradingComponent.WRITTEN_WORK,
            CanonicalGradingComponent.PERFORMANCE_TASK,
        }
    )
    try:
        cap = validate_cap_percentage(cap_percentage)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    with db.no_autoflush:
        scope = _teacher_scope(db, staff_id, class_id, subject_id, academic_period_id)
        student = db.get(Student, student_id)
        enrolled = db.query(StudentClass.student_class_id).filter_by(
            student_id=student_id,
            class_id=class_id,
            enrollment_status="enrolled",
        ).first()
        if student is None or enrolled is None:
            raise HTTPException(status_code=404, detail="Student not found in this teaching scope.")

        assignments = _classwork_assignments(db, scope)
        assignments_by_id = {assignment.classwork_assignment_id: assignment for assignment in assignments}
        submissions_by_student = _submissions_by_student(db, assignments)
        submissions = submissions_by_student.get(student_id, {})
        assignment_ids = list(assignments_by_id)
        links = []
        if assignment_ids:
            links = db.query(RemediationAssignmentLink).filter(
                RemediationAssignmentLink.student_id == student_id,
                (
                    RemediationAssignmentLink.original_assignment_id.in_(assignment_ids)
                    | RemediationAssignmentLink.remediation_assignment_id.in_(assignment_ids)
                ),
            ).all()
        resolved = resolve_student_classwork_scores(
            student_id=student_id,
            assignments=assignments,
            submissions=submissions,
            links=links,
        )
        written, performance, examinations = _split_assignments(assignments)

        unavailable_reasons: list[dict[str, Any]] = []
        threshold = None
        threshold_policy = None
        weights = None
        try:
            weights = resolve_subject_grading_weights(db, subject_id, scope.class_.academic_level_id)
            policy_context = read_passing_threshold_context_or_422(
                db,
                academic_year_id=scope.year.academic_year_id,
                subject_ids=[subject_id],
            )
            threshold = require_subject_passing_threshold(
                db,
                academic_year_id=scope.year.academic_year_id,
                subject_id=subject_id,
                context=policy_context,
            )
            threshold_policy = {
                "academic_year_id": threshold.academic_year_id,
                "subject_id": threshold.subject_id,
                "grading_template_id": threshold.grading_template_id,
                "source": threshold.source,
                "policy_version": threshold.policy_version,
                "revision": threshold.revision,
                "captured_at": threshold.captured_at,
            }
        except HTTPException:
            unavailable_reasons.append(_reason(
                "GRADING_POLICY_UNAVAILABLE",
                "The subject grading template or passing-threshold policy is unavailable.",
            ))

        finalized = db.query(StudentPeriodGrade).filter_by(
            student_id=student_id,
            class_id=class_id,
            subject_id=subject_id,
            academic_period_id=academic_period_id,
            is_finalized=True,
        ).one_or_none()

        actual_components = None
        if weights is not None:
            actual_components = _compute_student_period_components(
                student,
                written,
                performance,
                examinations,
                submissions_by_student,
                weights,
                resolved_scores=resolved,
                db=db,
            )
            readiness = _grade_send_readiness(
                actual_components,
                _grade_send_requirements(db, scope, weights),
            )
            if readiness.code is not None:
                unavailable_reasons.append(_reason(
                    "INCOMPLETE_ACADEMIC_EVIDENCE",
                    readiness.message,
                ))
            unavailable_reasons.extend(_strict_exam_reasons(actual_components))
            for audit in resolved.audit_records:
                if audit.status.startswith("CORRUPT_") or audit.status in {"REJECTED_MISMATCHED_MAX_POINTS", "INVALID_SCORE"}:
                    unavailable_reasons.append(_reason(
                        "INVALID_REMEDIATION_EVIDENCE",
                        "Existing remediation evidence is inconsistent and cannot support an authoritative projection.",
                        assignment_id=audit.original_assignment_id,
                    ))

        if finalized is not None:
            unavailable_reasons.append(_reason(
                "FINALIZED_PERIOD_GRADE",
                "The period grade is finalized; further remediation projection is unavailable.",
            ))

        # Preserve order while eliminating repeated general reasons.
        unique_reasons: list[dict[str, Any]] = []
        seen_reasons: set[tuple[Any, ...]] = set()
        for item in unavailable_reasons:
            key = (item["code"], item.get("assignment_id"))
            if key not in seen_reasons:
                seen_reasons.add(key)
                unique_reasons.append(item)
        unavailable_reasons = unique_reasons

        projection_available = not unavailable_reasons and actual_components is not None and threshold is not None
        current_initial = actual_components["initial_grade"] if projection_available else None
        current_grade = actual_components["transmuted_grade"] if projection_available else None
        if finalized is not None:
            stored_grade = finalized.final_period_grade if finalized.final_period_grade is not None else finalized.transmuted_grade
            current_grade = float(stored_grade) if stored_grade is not None else None
            current_initial = float(finalized.initial_grade) if finalized.initial_grade is not None else None

        linked_original_ids = {
            link.original_assignment_id
            for link in links
            if source_intervention_id is None or link.source_intervention_id != source_intervention_id
        }
        opportunities: dict[int, dict[str, Any]] = {}
        candidate_assignments = [] if finalized is not None else [*written, *performance]
        for assignment in candidate_assignments:
            assignment_id = assignment.classwork_assignment_id
            if (
                assignment_id in resolved.remedial_assignment_ids
                or assignment_id in linked_original_ids
                or assignment.source_intervention_id is not None
                or assignment.original_exam_assignment_id is not None
                or assignment.recipient_student_id not in (None, student_id)
                or assignment.classwork.is_archived
                or not assignment.classwork.is_graded
            ):
                continue
            original = _score(submissions, assignment_id)
            maximum = assignment.classwork.total_points
            if original is None or maximum is None or Decimal(str(maximum)) <= 0:
                continue
            try:
                adjustment = adjust_remediation_score(
                    original_score=original,
                    remediation_score=maximum,
                    original_max_points=maximum,
                    remediation_max_points=maximum,
                    cap_percentage=cap,
                )
            except (TypeError, ValueError):
                continue
            component = classify_classwork_component(
                assignment.classwork.classwork_type,
                assignment.classwork.classwork_category,
                assignment.classwork.exam_subtype,
            )
            if component not in allowed_components:
                continue
            current_effective = resolved.effective_scores.get(assignment_id)
            opportunities[assignment_id] = {
                "assignment_id": assignment_id,
                "title": assignment.classwork.title,
                "component": component.value,
                "original_score": float(adjustment.original_score),
                "current_effective_score": float(current_effective if current_effective is not None else adjustment.original_score),
                "max_points": float(adjustment.max_points),
                "cap_percentage": float(adjustment.cap_percentage),
                "maximum_hypothetical_effective_score": float(adjustment.effective_score),
                "possible_score_gain": float(adjustment.effective_score - adjustment.original_score),
            }

        cumulative_scores = dict(resolved.effective_scores)
        applied_ids: set[int] = set()
        target_results: list[dict[str, Any]] = []
        previous_grade = current_grade if projection_available else None
        for assignment_id in targets:
            if finalized is not None:
                target_results.append({
                    "assignment_id": assignment_id,
                    "applied": False,
                    "unavailable_reasons": [_reason(
                        "FINALIZED_PERIOD_GRADE",
                        "The period grade is finalized; further remediation projection is unavailable.",
                        assignment_id=assignment_id,
                    )],
                    "projected_subject_grade": None,
                    "reaches_passing_threshold": None,
                })
                continue
            if assignment_id in applied_ids:
                target_results.append({
                    "assignment_id": assignment_id,
                    "applied": False,
                    "unavailable_reasons": [_reason(
                        "DUPLICATE_TARGET",
                        "Each original assignment can be hypothetically adjusted only once.",
                        assignment_id=assignment_id,
                    )],
                    "projected_subject_grade": previous_grade,
                    "reaches_passing_threshold": (
                        Decimal(str(previous_grade)) >= threshold.threshold
                        if projection_available and previous_grade is not None and threshold is not None else None
                    ),
                })
                continue
            opportunity = opportunities.get(assignment_id)
            if opportunity is None:
                target_results.append({
                    "assignment_id": assignment_id,
                    "applied": False,
                    "unavailable_reasons": [_target_problem(
                        assignment_id,
                        assignments_by_id=assignments_by_id,
                        student_id=student_id,
                        linked_original_ids=linked_original_ids,
                        remedial_ids=resolved.remedial_assignment_ids,
                        submissions=submissions,
                    )],
                    "projected_subject_grade": previous_grade,
                    "reaches_passing_threshold": (
                        Decimal(str(previous_grade)) >= threshold.threshold
                        if projection_available and previous_grade is not None and threshold is not None else None
                    ),
                })
                continue

            applied_ids.add(assignment_id)
            cumulative_scores[assignment_id] = Decimal(str(opportunity["maximum_hypothetical_effective_score"]))
            projected_initial = None
            projected_grade = None
            reaches = None
            step_improvement = None
            total_improvement = None
            if projection_available and weights is not None and threshold is not None:
                hypothetical = _compute_student_period_components(
                    student,
                    written,
                    performance,
                    examinations,
                    submissions_by_student,
                    weights,
                    resolved_scores=_with_effective_scores(resolved, cumulative_scores),
                    db=db,
                )
                projected_initial = hypothetical["initial_grade"]
                projected_grade = hypothetical["transmuted_grade"]
                if projected_grade is not None:
                    reaches = Decimal(str(projected_grade)) >= threshold.threshold
                    step_improvement = projected_grade - previous_grade if previous_grade is not None else None
                    total_improvement = projected_grade - current_grade if current_grade is not None else None
                    previous_grade = projected_grade
            target_results.append({
                **opportunity,
                "applied": True,
                "projected_initial_grade": projected_initial,
                "projected_subject_grade": projected_grade,
                "step_subject_grade_improvement": step_improvement,
                "possible_grade_improvement": total_improvement,
                "reaches_passing_threshold": reaches,
                "unavailable_reasons": [] if projection_available else list(unavailable_reasons),
            })

        remaining = [item for assignment_id, item in opportunities.items() if assignment_id not in applied_ids and item["possible_score_gain"] > 0]
        cumulative_grade = previous_grade if projection_available else None
        threshold_reached = (
            Decimal(str(cumulative_grade)) >= threshold.threshold
            if projection_available and cumulative_grade is not None and threshold is not None else None
        )
        additional_positive = bool(remaining) and threshold_reached is not True

        recommended_id = None
        if additional_positive:
            if projection_available and weights is not None:
                ranked: list[tuple[float, float, int]] = []
                for item in remaining:
                    trial_scores = dict(cumulative_scores)
                    trial_scores[item["assignment_id"]] = Decimal(str(item["maximum_hypothetical_effective_score"]))
                    trial = _compute_student_period_components(
                        student,
                        written,
                        performance,
                        examinations,
                        submissions_by_student,
                        weights,
                        resolved_scores=_with_effective_scores(resolved, trial_scores),
                        db=db,
                    )
                    ranked.append((float(trial["transmuted_grade"] or -1), float(trial["initial_grade"] or -1), item["assignment_id"]))
                ranked.sort(key=lambda value: (-value[0], -value[1], value[2]))
                recommended_id = ranked[0][2] if ranked else None
            else:
                remaining.sort(key=lambda item: (-item["possible_score_gain"], item["assignment_id"]))
                recommended_id = remaining[0]["assignment_id"] if remaining else None

        return {
            "status": FINALIZED if finalized is not None else AVAILABLE if projection_available else UNAVAILABLE,
            "grade_representation": "FINAL_PERIOD_GRADE" if finalized is not None else GRADE_REPRESENTATION,
            "current_initial_grade": current_initial,
            "current_subject_grade": current_grade,
            "passing_threshold": float(threshold.threshold) if threshold is not None else None,
            "passing_threshold_policy": threshold_policy,
            "current_reaches_passing_threshold": (
                Decimal(str(current_grade)) >= threshold.threshold
                if projection_available and current_grade is not None and threshold is not None else None
            ),
            "target_projections": target_results,
            "eligible_target_gains": list(opportunities.values()),
            "additional_eligible_targets_have_positive_improvement": additional_positive,
            "recommended_target_assignment_id": recommended_id,
            "assumptions": [
                "The compared subject grade is the authoritative transmuted Term Grade, not the raw Initial Grade or an AI prediction.",
                "Hypothetical WW/PT scores use the requested cap and are not awarded scores or stored submissions.",
                "Existing graded remediation uses its saved link cap and actual effective score before new targets are simulated.",
                "Each selected original is applied at most once and target order remains teacher supplied.",
                "Authoritative projection requires complete scored academic evidence, including Summative 1, Summative 2, and Term Examination.",
            ],
            "unavailable_reasons": unavailable_reasons,
        }
