"""Create audit-only WW/PT remediation links without changing official grades."""

from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.intervention.Intervention import Intervention
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.classwork.ClassworkShared import is_quiz_type
from app.services.grading.ComponentMapper import (
    CanonicalGradingComponent,
    classify_classwork_component,
)
from app.services.grading.RemediationScoreAdjuster import (
    DEFAULT_REMEDIATION_CAP_PERCENTAGE,
    validate_cap_percentage,
)


LINKABLE_COMPONENTS = {
    "WRITTEN_WORK": CanonicalGradingComponent.WRITTEN_WORK,
    "PERFORMANCE_TASK": CanonicalGradingComponent.PERFORMANCE_TASK,
}


def create_remediation_assignment_link(
    db: Session,
    *,
    intervention: Intervention,
    remediation_assignment: ClassworkAssignment,
    original_assignment_id: int,
    component: str,
    staff_id: str,
    score_adjustment_cap: Decimal | float | int | str | None = None,
) -> RemediationAssignmentLink:
    """Stage one immutable provenance link in the caller's transaction."""
    existing = db.query(RemediationAssignmentLink).filter_by(
        remediation_assignment_id=remediation_assignment.classwork_assignment_id,
    ).one_or_none()
    if existing is not None:
        if (
            existing.original_assignment_id == original_assignment_id
            and existing.source_intervention_id == intervention.intervention_id
            and existing.student_id == intervention.student_id
            and existing.component == component
        ):
            return existing
        raise HTTPException(409, "This remediation attempt is already linked to another original classwork")

    conflicting = (
        db.query(RemediationAssignmentLink)
        .filter_by(
            original_assignment_id=original_assignment_id,
            student_id=intervention.student_id,
        )
        .filter(RemediationAssignmentLink.remediation_assignment_id != remediation_assignment.classwork_assignment_id)
        .first()
    )
    if conflicting is not None:
        raise HTTPException(409, "A remediation activity is already linked to this original classwork")

    expected_component = LINKABLE_COMPONENTS.get(component)
    if expected_component is None:
        raise HTTPException(400, "WW/PT remediation linkage requires Written Work or Performance Task treatment")
    if remediation_assignment.classwork_assignment_id == original_assignment_id:
        raise HTTPException(400, "A remediation attempt cannot link to itself")
    if (
        remediation_assignment.source_intervention_id != intervention.intervention_id
        or remediation_assignment.recipient_student_id != intervention.student_id
        or remediation_assignment.assigned_by_staff_id != staff_id
    ):
        raise HTTPException(403, "Remediation assignment provenance does not match this teacher intervention")
    if (
        remediation_assignment.class_id != intervention.class_id
        or remediation_assignment.academic_period_id != intervention.academic_period_id
        or remediation_assignment.classwork.subject_id != intervention.subject_id
        or remediation_assignment.original_exam_assignment_id is not None
    ):
        raise HTTPException(400, "Remediation assignment is outside the intervention scope")
    if not remediation_assignment.classwork.is_graded:
        raise HTTPException(400, "Only a graded remediation attempt can be linked")
    remediation_component = classify_classwork_component(
        remediation_assignment.classwork.classwork_type,
        remediation_assignment.classwork.classwork_category,
        remediation_assignment.classwork.exam_subtype,
    )
    if remediation_component != expected_component:
        raise HTTPException(400, "Remediation assignment grading category does not match the saved treatment")
    if (
        is_quiz_type(remediation_assignment.classwork.classwork_type)
        and remediation_assignment.max_attempts != 1
    ):
        raise HTTPException(400, "Remedial classwork quiz permits one attempt per activity")

    plan_targets = (intervention.remediation_plan or {}).get("target_assignment_ids") or []
    if not plan_targets:
        raise HTTPException(400, "WW/PT linkage requires explicitly saved original classwork targets")
    if original_assignment_id not in plan_targets:
        raise HTTPException(400, "Selected classwork target is not in the intervention plan's saved targets")

    original = db.get(ClassworkAssignment, original_assignment_id)
    if original is None or original.classwork is None:
        raise HTTPException(400, "Original classwork assignment was not found")
    if original.source_intervention_id is not None or original.original_exam_assignment_id is not None:
        raise HTTPException(400, "A remediation assignment cannot be used as the original classwork")
    if (
        original.class_id != intervention.class_id
        or original.academic_period_id != intervention.academic_period_id
        or original.classwork.subject_id != intervention.subject_id
        or original.recipient_student_id not in (None, intervention.student_id)
    ):
        raise HTTPException(400, "Original classwork is outside this student, class, subject, or period")
    if original.classwork.is_archived or not original.classwork.is_graded:
        raise HTTPException(400, "Original classwork is unavailable for remediation linkage")
    original_component = classify_classwork_component(
        original.classwork.classwork_type,
        original.classwork.classwork_category,
        original.classwork.exam_subtype,
    )
    if original_component != expected_component:
        raise HTTPException(400, "Original and remediation classworks must use the same grading category")

    orig_points = original.classwork.total_points
    rem_points = remediation_assignment.classwork.total_points
    if (
        orig_points is None
        or orig_points <= 0
        or rem_points is None
        or Decimal(str(rem_points)) != Decimal(str(orig_points))
    ):
        raise HTTPException(400, "Remedial maximum points must equal the original classwork")

    if not db.query(StudentSubmission.submission_id).filter_by(
        classwork_assignment_id=original_assignment_id,
        student_id=intervention.student_id,
    ).filter(StudentSubmission.grade.isnot(None)).first():
        raise HTTPException(400, "Original classwork needs a recorded score")
    if db.query(StudentPeriodGrade.period_grade_id).filter_by(
        student_id=intervention.student_id,
        class_id=intervention.class_id,
        subject_id=intervention.subject_id,
        academic_period_id=intervention.academic_period_id,
        is_finalized=True,
    ).first():
        raise HTTPException(409, "The period grade is finalized")

    plan_cap_raw = (intervention.remediation_plan or {}).get("score_adjustment_cap")
    if plan_cap_raw is None:
        plan_cap_raw = DEFAULT_REMEDIATION_CAP_PERCENTAGE
    try:
        authoritative_cap = validate_cap_percentage(plan_cap_raw)
    except (ValueError, TypeError) as err:
        raise HTTPException(400, f"Invalid intervention plan score adjustment cap: {err}") from err

    if score_adjustment_cap is not None:
        try:
            supplied_cap = validate_cap_percentage(score_adjustment_cap)
        except (ValueError, TypeError) as err:
            raise HTTPException(400, f"Invalid score adjustment cap: {err}") from err
        if supplied_cap != authoritative_cap:
            raise HTTPException(
                400,
                f"Client score adjustment cap override ({supplied_cap}) is not permitted; authoritative cap must come from the saved intervention plan ({authoritative_cap})",
            )

    resolved_cap = authoritative_cap

    link = RemediationAssignmentLink(
        source_intervention_id=intervention.intervention_id,
        remediation_assignment_id=remediation_assignment.classwork_assignment_id,
        original_assignment_id=original_assignment_id,
        student_id=intervention.student_id,
        component=component,
        score_adjustment_cap=resolved_cap,
        created_by_staff_id=staff_id,
    )
    db.add(link)
    db.flush()
    return link
