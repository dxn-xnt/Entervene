"""Shared teacher-content policy; read exceptions never grant mutation rights."""

from collections.abc import Iterable
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.people.AcademicStaff import AcademicStaff
from app.services.academic.SubstitutionService import SubstitutionService


def resolve_content_staff_id(db: Session, current_user: dict) -> str | None:
    value = current_user.get("sub")
    if not value:
        return None
    try:
        user_id = UUID(value) if isinstance(value, str) else value
    except (ValueError, TypeError):
        return None
    staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == user_id).first()
    return staff.staff_id if staff else None


def authorize_teacher_content(
    db: Session,
    *,
    staff_id: str | None,
    owner_staff_id: str | None,
    detail: str,
    read_scopes: Iterable[tuple[int, int, int]] = (),
    owner_only: bool = False,
) -> None:
    """Require ownership or an explicit (class, subject, period) read scope.

    Adapters derive exact period IDs from content assignments. Every load's
    period must belong to its assigned class's school year. A shared subject,
    adviser role, or admin-looking staff ID is never an exception.
    Substitutes require active status and inclusive start/end date bounds.

    Updates, deletes, visibility/unlock and future clone/package selection must
    use owner_only=True, even when an earlier read was authorized.
    Administrator/student policy stays in the existing role-specific adapters.
    """
    if staff_id and staff_id == owner_staff_id:
        return
    if staff_id and not owner_only:
        for class_id, subject_id, period_id in read_scopes:
            if period_id is None:
                continue
            loads = (
                db.query(SubjectLoad)
                .join(Class, Class.class_id == SubjectLoad.class_id)
                .join(AcademicPeriod, AcademicPeriod.academic_period_id == SubjectLoad.academic_period_id)
                .filter(
                    SubjectLoad.class_id == class_id,
                    SubjectLoad.subject_id == subject_id,
                    SubjectLoad.academic_period_id == period_id,
                    SubjectLoad.is_active_version.is_(True),
                    SubjectLoad.status.in_(("active", "published")),
                    AcademicPeriod.academic_year_id == Class.academic_year_id,
                )
                .all()
            )
            for load in loads:
                if load.staff_id == staff_id:
                    return
                substitute = SubstitutionService.get_active_substitution(db, load.subject_load_id)
                if substitute and substitute.substitute_staff_id == staff_id:
                    return
    raise HTTPException(status_code=404, detail=detail)
