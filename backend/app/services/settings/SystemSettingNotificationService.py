"""System setting notification generation for administrators."""

from __future__ import annotations

import uuid
from datetime import datetime
from uuid import UUID, uuid5

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AcademicYearPassingPolicy import PassingPolicyAudit
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.notifications.Notification import Notification
from app.models.people.AcademicStaff import AcademicStaff

SETTING_NOTIFICATION_NAMESPACE = UUID("13b8253d-24e5-4f76-8809-5a50e181c0c1")


def _resolve_actor_display_name(db: Session, actor_user_id: UUID) -> str:
    staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == actor_user_id).first()
    if staff:
        name_parts = [p for p in [staff.first_name, staff.middle_name, staff.last_name] if p]
        if name_parts:
            return " ".join(name_parts)
    user = db.get(UserAccount, actor_user_id)
    if user and user.email:
        return user.email
    return "Administrator"


def _format_audit_notification(audit: PassingPolicyAudit, actor_name: str, year_label: str) -> tuple[str, str]:
    changed_at_str = audit.created_at.strftime("%B %d, %Y at %I:%M %p") if audit.created_at else "Unknown date"

    if audit.policy_scope == "general_average":
        title = "General Average Passing Grade Adjusted"
        if audit.old_threshold is not None:
            details = f"General Average Passing Grade adjusted from {audit.old_threshold:.2f}% to {audit.new_threshold:.2f}%."
        else:
            details = f"General Average Passing Grade set to {audit.new_threshold:.2f}%."
    else:
        title = "Template Passing Threshold Adjusted"
        if audit.old_threshold is not None:
            details = f"Passing threshold adjusted from {audit.old_threshold:.2f}% to {audit.new_threshold:.2f}%."
        else:
            details = f"Passing threshold set to {audit.new_threshold:.2f}%."

    body = (
        f"{details}\n"
        f"• Changed by: {actor_name}\n"
        f"• Academic Year: {year_label}\n"
        f"• Changed on: {changed_at_str}\n"
        f"• Reason: {audit.reason or 'No reason provided'}"
    )
    return title, body


def check_and_generate_system_setting_notifications(
    db: Session,
    user_id: UUID | str,
) -> list[Notification]:
    """Ensure all PassingPolicyAudit records have corresponding notifications for the admin user."""
    if isinstance(user_id, str):
        user_uuid = UUID(user_id)
    else:
        user_uuid = user_id

    audits = db.query(PassingPolicyAudit).order_by(PassingPolicyAudit.created_at.desc()).all()
    if not audits:
        return []

    created_notifications: list[Notification] = []

    # Cache academic years and actor names to minimize DB queries
    years_cache: dict[int, str] = {}
    actors_cache: dict[UUID, str] = {}

    for audit in audits:
        notif_id = uuid5(
            SETTING_NOTIFICATION_NAMESPACE,
            f"setting_audit_{audit.audit_id}_{user_uuid}",
        )
        existing = db.query(Notification.notification_id).filter_by(
            notification_id=notif_id,
        ).first()
        if existing is not None:
            continue

        if audit.academic_year_id not in years_cache:
            ay = db.get(AcademicYear, audit.academic_year_id)
            years_cache[audit.academic_year_id] = ay.year_label if ay else f"Academic Year {audit.academic_year_id}"
        year_label = years_cache[audit.academic_year_id]

        if audit.actor_user_id not in actors_cache:
            actors_cache[audit.actor_user_id] = _resolve_actor_display_name(db, audit.actor_user_id)
        actor_name = actors_cache[audit.actor_user_id]

        title, body = _format_audit_notification(audit, actor_name, year_label)

        notif = Notification(
            notification_id=notif_id,
            user_id=user_uuid,
            notification_type="system_setting_updated",
            title=title,
            body=body,
            action_url="/admin/settings",
            is_read=False,
            created_at=audit.created_at,
        )
        db.add(notif)
        created_notifications.append(notif)

    if created_notifications:
        db.commit()

    return created_notifications
