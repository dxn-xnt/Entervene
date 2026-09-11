from __future__ import annotations
from datetime import date as date_type
from enum import Enum
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.models.academic.SubjectLoad import SubjectLoad
from app.services.academic.SubstitutionService import SubstitutionService


class SubjectAccessLevel(str, Enum):
    WRITE = "WRITE"
    VIEW_ONLY = "VIEW_ONLY"
    DENIED = "DENIED"


class SubjectLoadAuthorizationService:

    @classmethod
    def get_active_published_load(
        cls,
        db: Session,
        class_id: int,
        subject_id: int,
        academic_period_id: int,
    ) -> SubjectLoad | None:
        return (
            db.query(SubjectLoad)
            .filter(
                SubjectLoad.class_id == class_id,
                SubjectLoad.subject_id == subject_id,
                SubjectLoad.academic_period_id == academic_period_id,
                SubjectLoad.is_active_version.is_(True),
                SubjectLoad.status.in_(["published", "active"]),
            )
            .first()
        )

    @classmethod
    def get_teacher_access_level(
        cls,
        db: Session,
        staff_id: str,
        class_id: int,
        subject_id: int,
        academic_period_id: int,
        as_of: date_type | None = None,
    ) -> SubjectAccessLevel:
        target_date = SubstitutionService.get_academic_date(as_of)

        # Check if staff_id is an administrator
        if staff_id and staff_id.upper().startswith("ADM"):
            return SubjectAccessLevel.WRITE

        try:
            from app.models.people.AcademicStaff import AcademicStaff
            admin_staff = (
                db.query(AcademicStaff)
                .filter(AcademicStaff.staff_id == staff_id)
                .first()
            )
            if admin_staff and admin_staff.user_id:
                from app.models.auth.Role import Role
                from app.models.auth.UserRoles import UserRole
                is_admin = (
                    db.query(Role.role_id)
                    .join(UserRole, UserRole.role_id == Role.role_id)
                    .filter(UserRole.user_id == admin_staff.user_id, Role.role_name == "admin")
                    .first()
                )
                if is_admin:
                    return SubjectAccessLevel.WRITE
        except Exception:
            pass

        load = cls.get_active_published_load(db, class_id, subject_id, academic_period_id)
        if not load:
            return SubjectAccessLevel.DENIED

        active_sub = SubstitutionService.get_active_substitution(db, load.subject_load_id, as_of=target_date)
        if active_sub is not None:
            # 1. Substitute teacher has active write/grading authority
            if staff_id == active_sub.substitute_staff_id:
                return SubjectAccessLevel.WRITE

            # 2. Current permanent primary teacher on SubjectLoad has view-only access during substitution
            if staff_id == load.staff_id:
                return SubjectAccessLevel.VIEW_ONLY

            # 3. Original on-leave primary teacher: retains view-only access ONLY if they are still the primary teacher on SubjectLoad
            # If permanently replaced (A -> B), former Teacher A receives DENIED per least privilege.
            if staff_id == active_sub.original_staff_id and load.staff_id == active_sub.original_staff_id:
                return SubjectAccessLevel.VIEW_ONLY

            return SubjectAccessLevel.DENIED

        # No active substitution: assigned primary teacher has full write authority
        if staff_id == load.staff_id:
            return SubjectAccessLevel.WRITE

        return SubjectAccessLevel.DENIED

    @classmethod
    def can_view(
        cls,
        db: Session,
        staff_id: str,
        class_id: int,
        subject_id: int,
        academic_period_id: int,
        as_of: date_type | None = None,
    ) -> bool:
        level = cls.get_teacher_access_level(db, staff_id, class_id, subject_id, academic_period_id, as_of=as_of)
        return level in (SubjectAccessLevel.WRITE, SubjectAccessLevel.VIEW_ONLY)

    @classmethod
    def can_write(
        cls,
        db: Session,
        staff_id: str,
        class_id: int,
        subject_id: int,
        academic_period_id: int,
        as_of: date_type | None = None,
    ) -> bool:
        level = cls.get_teacher_access_level(db, staff_id, class_id, subject_id, academic_period_id, as_of=as_of)
        return level == SubjectAccessLevel.WRITE

    @classmethod
    def assert_can_view(
        cls,
        db: Session,
        staff_id: str,
        class_id: int,
        subject_id: int,
        academic_period_id: int,
        as_of: date_type | None = None,
    ) -> None:
        if not cls.can_view(db, staff_id, class_id, subject_id, academic_period_id, as_of=as_of):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to view records for this class and subject.",
            )

    @classmethod
    def assert_can_write(
        cls,
        db: Session,
        staff_id: str,
        class_id: int,
        subject_id: int,
        academic_period_id: int,
        as_of: date_type | None = None,
    ) -> None:
        level = cls.get_teacher_access_level(db, staff_id, class_id, subject_id, academic_period_id, as_of=as_of)
        if level == SubjectAccessLevel.VIEW_ONLY:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are currently on leave for this class/subject. Records are read-only.",
            )
        if level == SubjectAccessLevel.DENIED:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not authorized to modify records for this class and subject.",
            )
