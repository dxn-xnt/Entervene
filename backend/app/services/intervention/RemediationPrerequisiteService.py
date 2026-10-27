"""Reusable student preparation policy for targeted remediation activities.

This module does not wire the policy into student endpoints. Callers in a later
stage must invoke ``require_remediation_prerequisite`` before returning or
starting a linked remediation activity.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.StudentCLass import StudentClass
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionReadingReview import InterventionReadingReview
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.StudentPersistentIntervention import (
    StudentPreparationProgress,
    StudentRequiredReading,
    StudentRequiredReadingIssue,
)
from app.services.classwork.ClassworkShared import (
    assignment_is_available,
    assignment_is_locked,
    is_reading_type,
    normalize_classwork_type,
)
from app.services.intervention.RemediationReadingPrerequisiteService import (
    remediation_reading_prerequisites,
)
from app.services.intervention.StudentPersistentInterventionService import (
    COMPLETED_READING_STATUSES,
)


PrerequisiteCode = Literal[
    "NOT_REMEDIATION",
    "REMEDIATION_LINK_MISMATCH",
    "STUDENT_SCOPE_MISMATCH",
    "INTERVENTION_NOT_ACTIVE",
    "INTERVENTION_SCOPE_MISMATCH",
    "REMEDIATION_UNAVAILABLE",
    "PREREQUISITE_SNAPSHOT_MISSING",
    "PREPARATION_REQUIRED",
    "PREPARATION_COMPLETE",
]

REMEDIATION_ACTIVITY_TYPES = {"QUIZ", "ASSIGNMENT", "ACTIVITY", "CLASSWORK"}


@dataclass(frozen=True)
class RemediationPrerequisiteDecision:
    applies: bool
    allowed: bool
    code: PrerequisiteCode
    message: str
    intervention_id: int | None = None
    preparation: StudentPreparationProgress | None = None
    resource_issues: tuple[StudentRequiredReadingIssue, ...] = ()
    readings: tuple[StudentRequiredReading, ...] = ()


def _decision(
    *,
    allowed: bool,
    code: PrerequisiteCode,
    message: str,
    intervention_id: int | None = None,
    preparation: StudentPreparationProgress | None = None,
    resource_issues: list[StudentRequiredReadingIssue] | None = None,
    readings: list[StudentRequiredReading] | None = None,
    applies: bool = True,
) -> RemediationPrerequisiteDecision:
    return RemediationPrerequisiteDecision(
        applies=applies,
        allowed=allowed,
        code=code,
        message=message,
        intervention_id=intervention_id,
        preparation=preparation,
        resource_issues=tuple(resource_issues or ()),
        readings=tuple(readings or ()),
    )


def evaluate_remediation_prerequisite(
    db: Session,
    assignment: ClassworkAssignment,
    student: Student,
) -> RemediationPrerequisiteDecision:
    """Evaluate the dynamic Reading prerequisite for one student assignment.

    Ordinary assignments are outside this policy and return an allowed,
    non-applicable decision. Targeted remediation is recognized only through
    persisted provenance fields, never through titles or naming conventions.
    """
    audit_link = db.query(RemediationAssignmentLink).filter_by(
        remediation_assignment_id=assignment.classwork_assignment_id,
    ).one_or_none()
    direct_intervention_id = assignment.source_intervention_id
    audit_intervention_id = audit_link.source_intervention_id if audit_link else None

    if direct_intervention_id is None and audit_intervention_id is None:
        return _decision(
            applies=False,
            allowed=True,
            code="NOT_REMEDIATION",
            message="This assignment is not linked to an intervention.",
        )

    intervention_id = direct_intervention_id or audit_intervention_id
    if (
        direct_intervention_id is None
        or assignment.remediation_request_id is None
        or assignment.recipient_student_id is None
        or (audit_intervention_id is not None and audit_intervention_id != direct_intervention_id)
        or (audit_link is not None and audit_link.student_id != assignment.recipient_student_id)
    ):
        return _decision(
            allowed=False,
            code="REMEDIATION_LINK_MISMATCH",
            message="The remediation assignment has inconsistent intervention provenance.",
            intervention_id=intervention_id,
        )

    intervention = db.get(Intervention, direct_intervention_id)
    if intervention is None:
        return _decision(
            allowed=False,
            code="REMEDIATION_LINK_MISMATCH",
            message="The linked intervention does not exist.",
            intervention_id=direct_intervention_id,
        )
    if (
        assignment.recipient_student_id != student.student_id
        or intervention.student_id != student.student_id
    ):
        return _decision(
            allowed=False,
            code="STUDENT_SCOPE_MISMATCH",
            message="This remediation activity is assigned to another student.",
            intervention_id=intervention.intervention_id,
        )
    if intervention.status != "ACTIVE":
        return _decision(
            allowed=False,
            code="INTERVENTION_NOT_ACTIVE",
            message="The linked intervention is not active.",
            intervention_id=intervention.intervention_id,
        )

    work = assignment.classwork
    if (
        work is None
        or assignment.class_id != intervention.class_id
        or assignment.academic_period_id != intervention.academic_period_id
        or work.subject_id != intervention.subject_id
        or normalize_classwork_type(work.classwork_type or "") not in REMEDIATION_ACTIVITY_TYPES
    ):
        return _decision(
            allowed=False,
            code="INTERVENTION_SCOPE_MISMATCH",
            message="The remediation activity is outside the intervention class, subject, period, or activity type.",
            intervention_id=intervention.intervention_id,
        )
    enrolled = db.query(StudentClass.student_class_id).filter_by(
        student_id=student.student_id,
        class_id=assignment.class_id,
        enrollment_status="enrolled",
    ).first()
    if (
        not enrolled
        or work.is_archived
        or not work.is_published
        or not assignment_is_available(assignment)
        or assignment_is_locked(assignment)
    ):
        return _decision(
            allowed=False,
            code="REMEDIATION_UNAVAILABLE",
            message="The remediation activity is not published and accessible to this student.",
            intervention_id=intervention.intervention_id,
        )

    prereqs = remediation_reading_prerequisites(db, assignment.classwork_assignment_id)
    if not prereqs:
        return _decision(
            allowed=False,
            code="PREREQUISITE_SNAPSHOT_MISSING",
            message="The remediation activity is missing an immutable Reading prerequisite snapshot.",
            intervention_id=intervention.intervention_id,
        )

    issues: list[StudentRequiredReadingIssue] = []
    readings: list[StudentRequiredReading] = []
    completed_count = 0
    in_progress_count = 0

    reviews = db.query(InterventionReadingReview).filter_by(
        intervention_id=intervention.intervention_id,
        student_id=student.student_id,
    ).all()
    reviews_by_assignment = {
        r.reading_assignment_id: r.acknowledged_at for r in reviews
    }

    for row in prereqs:
        reading_work = db.get(Classwork, row.reading_classwork_id)
        if reading_work is None:
            issues.append(
                StudentRequiredReadingIssue(
                    resource_id=row.reading_classwork_id,
                    order=row.display_order,
                    reason="MISSING_RESOURCE",
                )
            )
            continue

        if (
            not is_reading_type(reading_work.classwork_type)
            or reading_work.is_graded
        ):
            issues.append(
                StudentRequiredReadingIssue(
                    resource_id=row.reading_classwork_id,
                    order=row.display_order,
                    reason="NOT_REQUIRED_READING",
                )
            )
            continue

        if (
            reading_work.is_archived
            or reading_work.subject_id != intervention.subject_id
            or not enrolled
        ):
            issues.append(
                StudentRequiredReadingIssue(
                    resource_id=row.reading_classwork_id,
                    order=row.display_order,
                    reason="INACCESSIBLE",
                )
            )
            continue

        reading_assignment = db.get(ClassworkAssignment, row.reading_assignment_id)
        if (
            reading_assignment is None
            or reading_assignment.classwork_id != reading_work.classwork_id
        ):
            issues.append(
                StudentRequiredReadingIssue(
                    resource_id=row.reading_classwork_id,
                    order=row.display_order,
                    reason="PLANNING_ONLY",
                )
            )
            continue

        if (
            reading_assignment.class_id != intervention.class_id
            or reading_assignment.academic_period_id != intervention.academic_period_id
            or (
                reading_assignment.recipient_student_id is not None
                and reading_assignment.recipient_student_id != student.student_id
            )
        ):
            issues.append(
                StudentRequiredReadingIssue(
                    resource_id=row.reading_classwork_id,
                    order=row.display_order,
                    reason="INACCESSIBLE",
                )
            )
            continue

        if not reading_work.is_published or not reading_assignment.is_published:
            issues.append(
                StudentRequiredReadingIssue(
                    resource_id=row.reading_classwork_id,
                    order=row.display_order,
                    reason="UNPUBLISHED",
                )
            )
            continue

        if assignment_is_locked(reading_assignment):
            issues.append(
                StudentRequiredReadingIssue(
                    resource_id=row.reading_classwork_id,
                    order=row.display_order,
                    reason="LOCKED",
                )
            )
            continue

        submission = (
            db.query(StudentSubmission)
            .filter(
                StudentSubmission.classwork_assignment_id == reading_assignment.classwork_assignment_id,
                StudentSubmission.student_id == student.student_id,
            )
            .order_by(StudentSubmission.submission_id.desc())
            .first()
        )

        persisted_status = (submission.status or "").lower() if submission else ""
        focused_seconds = max(0, submission.reading_focused_seconds or 0) if submission else 0
        if persisted_status in COMPLETED_READING_STATUSES:
            completion_status = "COMPLETED"
        elif submission is not None:
            completion_status = "IN_PROGRESS"
        else:
            completion_status = "NOT_STARTED"

        reviewed_at = reviews_by_assignment.get(reading_assignment.classwork_assignment_id)
        review_status = "REVIEWED" if reviewed_at is not None else "NOT_REVIEWED"
        if review_status == "REVIEWED":
            completed_count += 1

        readings.append(
            StudentRequiredReading(
                classwork_id=reading_work.classwork_id,
                title=reading_work.title,
                assignment_id=reading_assignment.classwork_assignment_id,
                order=row.display_order,
                completion_status=completion_status,
                focused_seconds=focused_seconds,
                completed_at=submission.submitted_at if completion_status == "COMPLETED" else None,
                review_status=review_status,
                reviewed_at=reviewed_at,
            )
        )

    required_count = len(prereqs)
    accessible_count = max(0, required_count - len(issues))
    unavailable_count = len(issues)

    if issues:
        state = "BLOCKED"
    elif completed_count == required_count:
        state = "COMPLETE"
    elif completed_count > 0:
        state = "IN_PROGRESS"
    else:
        state = "NOT_STARTED"

    preparation = StudentPreparationProgress(
        state=state,
        is_satisfied=state == "COMPLETE",
        completed_count=completed_count,
        required_count=required_count,
        accessible_count=accessible_count,
        unavailable_count=unavailable_count,
        summary=f"{completed_count} of {required_count} completed",
    )

    if not preparation.is_satisfied:
        issue_reasons = ", ".join(issue.reason for issue in issues)
        suffix = f" Unavailable requirements: {issue_reasons}." if issue_reasons else ""
        return _decision(
            allowed=False,
            code="PREPARATION_REQUIRED",
            message=f"Required Reading preparation is incomplete ({preparation.summary}).{suffix}",
            intervention_id=intervention.intervention_id,
            preparation=preparation,
            resource_issues=issues,
            readings=readings,
        )
    return _decision(
        allowed=True,
        code="PREPARATION_COMPLETE",
        message=f"Required Reading preparation is complete ({preparation.summary}).",
        intervention_id=intervention.intervention_id,
        preparation=preparation,
        readings=readings,
    )


def require_remediation_prerequisite(
    db: Session,
    assignment: ClassworkAssignment,
    student: Student,
) -> RemediationPrerequisiteDecision:
    """Raise a consistent denial for a linked activity that fails the policy."""
    decision = evaluate_remediation_prerequisite(db, assignment, student)
    if decision.allowed:
        return decision
    raise HTTPException(
        status_code=403,
        detail={
            "code": decision.code,
            "message": decision.message,
            "intervention_id": decision.intervention_id,
            "preparation": (
                decision.preparation.model_dump(mode="json")
                if decision.preparation is not None
                else None
            ),
            "resource_issues": [
                issue.model_dump(mode="json") for issue in decision.resource_issues
            ],
        },
    )


def resolve_assignment_from_attempt(
    db: Session,
    attempt_id: int,
) -> ClassworkAssignment | None:
    """Resolve the exact ClassworkAssignment when a caller references only a quiz attempt ID."""
    from app.models.submissions.StudentSubmission import StudentSubmission
    submission = db.get(StudentSubmission, attempt_id)
    if submission is None or submission.classwork_assignment_id is None:
        return None
    return db.get(ClassworkAssignment, submission.classwork_assignment_id)


def require_remediation_prerequisite_for_attempt(
    db: Session,
    attempt_id: int,
    student: Student,
) -> RemediationPrerequisiteDecision:
    """Resolve the remediation assignment from an attempt ID and verify Reading prerequisites."""
    from app.models.submissions.StudentSubmission import StudentSubmission
    submission = db.get(StudentSubmission, attempt_id)
    if submission is None or submission.classwork_assignment_id is None:
        raise HTTPException(status_code=404, detail="Quiz attempt not found")
    if submission.student_id != student.student_id:
        raise HTTPException(status_code=403, detail="Access denied")
    assignment = db.get(ClassworkAssignment, submission.classwork_assignment_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return require_remediation_prerequisite(db, assignment, student)

