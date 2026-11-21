"""Stage teacher-only lifecycle notifications in the prediction transaction."""

from __future__ import annotations

from decimal import Decimal, ROUND_DOWN

from sqlalchemy.orm import Session

from app.models.academic.StudentCLass import StudentClass
from app.models.auth.Role import Role
from app.models.auth.UserRoles import UserRoles
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.notifications.Notification import Notification
from app.models.people.AcademicStaff import AcademicStaff
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Notification import NotificationCreate
from app.services.NotificationService import stage_notification
from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService
from app.services.academic.SubstitutionService import SubstitutionService


def _responsible_teacher_identity(db: Session, intervention: Intervention):
    load = SubjectLoadAuthorizationService.get_active_published_load(
        db, intervention.class_id, intervention.subject_id, intervention.academic_period_id,
    )
    if load is None:
        return None
    staff_id, _ = SubstitutionService.resolve_effective_staff(db, load.subject_load_id)
    if not staff_id:
        return None
    enrolled = db.query(StudentClass.student_class_id).filter_by(
        student_id=intervention.student_id, class_id=intervention.class_id, enrollment_status="enrolled",
    ).first()
    if enrolled is None:
        return None
    staff = db.get(AcademicStaff, staff_id)
    if staff is None or staff.user_id is None:
        return None
    user = db.get(UserAccount, staff.user_id)
    if user is None or user.account_status != "active":
        return None
    roles = {
        name.lower() for (name,) in db.query(Role.role_name).join(
            UserRoles, UserRoles.role_id == Role.role_id,
        ).filter(UserRoles.user_id == user.user_id).all()
    }
    if "teacher" not in roles or "admin" in roles:
        return None
    return staff_id, user.user_id


def _responsible_teacher_user_id(db: Session, intervention: Intervention):
    identity = _responsible_teacher_identity(db, intervention)
    return identity[1] if identity else None


def _assessment_scope(
    db: Session,
    assignment: ClassworkAssignment,
    submission: StudentSubmission,
):
    if assignment.source_intervention_id is None or assignment.classwork is None:
        return None
    if not assignment.classwork.is_graded or assignment.recipient_student_id != submission.student_id:
        return None
    intervention = db.get(Intervention, assignment.source_intervention_id)
    if intervention is None or intervention.student_id != submission.student_id:
        return None
    identity = _responsible_teacher_identity(db, intervention)
    if identity is None:
        return None
    return intervention, identity


def _assessment_action_url(
    assignment: ClassworkAssignment,
    submission: StudentSubmission,
) -> str:
    return (
        f"/teacher/classworks/{assignment.classwork_id}"
        f"?assignment={assignment.classwork_assignment_id}&submission={submission.submission_id}"
    )


def _stage_assessment_event(
    db: Session,
    assignment: ClassworkAssignment,
    submission: StudentSubmission,
    *,
    event: str,
) -> bool:
    scope = _assessment_scope(db, assignment, submission)
    if scope is None:
        return False
    intervention, (_staff_id, user_id) = scope
    action_url = _assessment_action_url(assignment, submission)
    notification_type = {
        "SUBMITTED": "intervention_assessment_submitted",
        "PASSED": "intervention_passed",
        "NOT_PASSED": "intervention_assessment_not_passed",
    }[event]
    if db.query(Notification.notification_id).filter_by(
        user_id=user_id,
        notification_type=notification_type,
        action_url=action_url,
    ).first() is not None:
        return False

    student_name = " ".join(
        part for part in (
            intervention.student.first_name,
            intervention.student.middle_name,
            intervention.student.last_name,
            intervention.student.suffix,
        ) if part
    )
    subject_name = intervention.subject.subject_name
    title = {
        "SUBMITTED": "Intervention Assessment Submitted",
        "PASSED": "Intervention Passed",
        "NOT_PASSED": "Intervention Assessment Not Passed",
    }[event]
    if event == "SUBMITTED":
        body = f"{student_name} submitted the {subject_name} Intervention Assessment."
    else:
        score = (
            f" Score: {format(Decimal(str(submission.grade)).normalize(), 'f')}"
            f"/{format(Decimal(str(assignment.classwork.total_points)).normalize(), 'f')}."
            if submission.grade is not None and assignment.classwork.total_points is not None
            else ""
        )
        result = "reached" if event == "PASSED" else "did not reach"
        body = f"{student_name} {result} the {subject_name} passing threshold.{score}"
    stage_notification(db, NotificationCreate(
        user_id=user_id,
        notification_type=notification_type,
        title=title,
        body=body,
        action_url=action_url,
    ))
    return True


def stage_intervention_assessment_submitted(
    db: Session,
    assignment: ClassworkAssignment,
    submission: StudentSubmission,
) -> bool:
    return _stage_assessment_event(db, assignment, submission, event="SUBMITTED")


def stage_intervention_assessment_result_or_submission(
    db: Session,
    assignment: ClassworkAssignment,
    submission: StudentSubmission,
) -> str | None:
    """Stage one result notification, or one submitted fallback when no result is authoritative."""
    scope = _assessment_scope(db, assignment, submission)
    if scope is None:
        return None
    intervention, (staff_id, _user_id) = scope
    from app.services.grading.SubjectGradeProjectionService import (
        AVAILABLE,
        FINALIZED,
        calculate_subject_grade_projection,
    )
    from app.services.grading.RemediationScoreAdjuster import DEFAULT_REMEDIATION_CAP_PERCENTAGE

    plan = intervention.remediation_plan if isinstance(intervention.remediation_plan, dict) else {}
    outcome = calculate_subject_grade_projection(
        db,
        staff_id=staff_id,
        student_id=intervention.student_id,
        class_id=intervention.class_id,
        subject_id=intervention.subject_id,
        academic_period_id=intervention.academic_period_id,
        target_assignment_ids=[],
        cap_percentage=plan.get("score_adjustment_cap", DEFAULT_REMEDIATION_CAP_PERCENTAGE),
        source_intervention_id=None,
    )
    reaches = outcome.get("current_reaches_passing_threshold")
    if outcome.get("status") in {AVAILABLE, FINALIZED} and reaches is not None:
        event = "PASSED" if reaches else "NOT_PASSED"
        _stage_assessment_event(db, assignment, submission, event=event)
        return event
    stage_intervention_assessment_submitted(db, assignment, submission)
    return "SUBMITTED"


def stage_intervention_notification(
    db: Session,
    intervention: Intervention,
    *,
    event: str,
    predicted_grade: float,
    is_remediation_adjusted: bool = False,
) -> None:
    """Only the effective teacher can receive one notification for a real transition."""
    user_id = _responsible_teacher_user_id(db, intervention)
    if user_id is None:
        return
    student_name = " ".join(
        part for part in (
            intervention.student.first_name, intervention.student.middle_name,
            intervention.student.last_name, intervention.student.suffix,
        ) if part
    )
    subject_name = intervention.subject.subject_name
    grade = format(Decimal(str(predicted_grade)).quantize(Decimal("0.001"), rounding=ROUND_DOWN).normalize(), "f")
    if event == "CANDIDATE":
        payload = NotificationCreate(
            user_id=user_id, notification_type="intervention_candidate",
            title="Intervention candidate ready for review",
            body=f"{student_name} in {subject_name} is a candidate (projected grade {grade}). Evidence is available for review.",
            action_url=f"/teacher/interventions?candidate={intervention.intervention_id}",
        )
    elif event == "IMPROVED_PREDICTION":
        body = (
            f"{student_name}'s remediation-adjusted {subject_name} projection reached {grade}. "
            "Intervention criteria are no longer met; the previous intervention remains in history."
            if is_remediation_adjusted
            else f"{student_name}'s latest {subject_name} prediction improved to {grade}. "
            "Intervention criteria are no longer met; the previous intervention remains in history."
        )
        payload = NotificationCreate(
            user_id=user_id, notification_type="intervention_resolved",
            title="Intervention resolved after improved prediction",
            body=body,
            action_url="/teacher/interventions",
        )
    else:
        raise ValueError("Unsupported intervention notification event")
    stage_notification(db, payload)
