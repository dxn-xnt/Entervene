"""Stage teacher-only lifecycle notifications in the prediction transaction."""

from __future__ import annotations

from decimal import Decimal, ROUND_DOWN

from sqlalchemy.orm import Session

from app.models.academic.StudentCLass import StudentClass
from app.models.auth.Role import Role
from app.models.auth.UserRoles import UserRoles
from app.models.auth.UserAccount import UserAccount
from app.models.intervention.Intervention import Intervention
from app.models.people.AcademicStaff import AcademicStaff
from app.schemas.Notification import NotificationCreate
from app.services.NotificationService import stage_notification
from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService
from app.services.academic.SubstitutionService import SubstitutionService


def _responsible_teacher_user_id(db: Session, intervention: Intervention):
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
    return user.user_id


def stage_intervention_notification(db: Session, intervention: Intervention, *, event: str, predicted_grade: float) -> None:
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
        payload = NotificationCreate(
            user_id=user_id, notification_type="intervention_resolved",
            title="Intervention resolved after improved prediction",
            body=f"{student_name}'s latest {subject_name} prediction improved to {grade}. Intervention criteria are no longer met; the previous intervention remains in history.",
            action_url="/teacher/interventions",
        )
    else:
        raise ValueError("Unsupported intervention notification event")
    stage_notification(db, payload)
