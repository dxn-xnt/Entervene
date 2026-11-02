from __future__ import annotations
from datetime import date as date_type
from enum import Enum
import re
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.SubjectLoad import SubjectLoad
from app.services.academic.AcademicLifecycleService import (
    resolve_active_academic_period,
    resolve_active_academic_year,
)
from app.services.academic.SubstitutionService import SubstitutionService


class SubjectAccessLevel(str, Enum):
    WRITE = "WRITE"
    VIEW_ONLY = "VIEW_ONLY"
    DENIED = "DENIED"


class AcademicContextState(str, Enum):
    HISTORICAL = "HISTORICAL"
    CURRENT = "CURRENT"
    FUTURE = "FUTURE"


class SubjectLoadAuthorizationService:

    @staticmethod
    def is_class_archived(class_obj: Class | None) -> bool:
        return bool(class_obj and (class_obj.class_status or "").strip().lower() == "archived")

    @staticmethod
    def _parse_start_year(year_label: str | None) -> int | None:
        if not year_label:
            return None
        match = re.search(r"(\d{4})", str(year_label))
        return int(match.group(1)) if match else None

    @classmethod
    def classify_academic_year(
        cls,
        db: Session,
        year_obj: AcademicYear | None,
        as_of: date_type | None = None,
    ) -> AcademicContextState:
        target_date = SubstitutionService.get_academic_date(as_of)
        active_year = resolve_active_academic_year(db, required=False)
        if year_obj is None:
            return AcademicContextState.CURRENT
        if (
            active_year is not None
            and year_obj.academic_year_id == active_year.academic_year_id
        ):
            return AcademicContextState.CURRENT

        if active_year is not None:
            if year_obj.end_date and active_year.start_date and year_obj.end_date <= active_year.start_date:
                return AcademicContextState.HISTORICAL
            if year_obj.start_date and active_year.end_date and year_obj.start_date >= active_year.end_date:
                return AcademicContextState.FUTURE
            if year_obj.start_date and active_year.start_date and year_obj.start_date != active_year.start_date:
                return (
                    AcademicContextState.HISTORICAL
                    if year_obj.start_date < active_year.start_date
                    else AcademicContextState.FUTURE
                )
            y_start = cls._parse_start_year(year_obj.year_label)
            active_start = cls._parse_start_year(active_year.year_label)
            if y_start is not None and active_start is not None and y_start != active_start:
                return (
                    AcademicContextState.HISTORICAL
                    if y_start < active_start
                    else AcademicContextState.FUTURE
                )
            if year_obj.academic_year_id is not None and active_year.academic_year_id is not None:
                return (
                    AcademicContextState.HISTORICAL
                    if year_obj.academic_year_id < active_year.academic_year_id
                    else AcademicContextState.FUTURE
                )

        if year_obj.end_date and year_obj.end_date < target_date:
            return AcademicContextState.HISTORICAL
        if year_obj.start_date and year_obj.start_date > target_date:
            return AcademicContextState.FUTURE
        y_start = cls._parse_start_year(year_obj.year_label)
        if y_start is not None and y_start != target_date.year:
            return (
                AcademicContextState.HISTORICAL
                if y_start < target_date.year
                else AcademicContextState.FUTURE
            )
        return AcademicContextState.HISTORICAL

    @classmethod
    def classify_academic_period(
        cls,
        db: Session,
        period_obj: AcademicPeriod | None,
        year_obj: AcademicYear | None = None,
        as_of: date_type | None = None,
    ) -> AcademicContextState:
        if period_obj is None:
            return cls.classify_academic_year(db, year_obj, as_of=as_of)

        if year_obj is None and period_obj.academic_year_id is not None:
            year_obj = db.get(AcademicYear, period_obj.academic_year_id)

        active_period = resolve_active_academic_period(db, required=False)
        year_state = cls.classify_academic_year(db, year_obj, as_of=as_of)
        if year_state != AcademicContextState.CURRENT:
            return year_state

        if (
            active_period is not None
            and period_obj.academic_period_id == active_period.academic_period_id
        ):
            return AcademicContextState.CURRENT

        if active_period is None:
            return AcademicContextState.CURRENT

        if (
            period_obj.period_sequence is not None
            and active_period.period_sequence is not None
            and period_obj.period_sequence != active_period.period_sequence
        ):
            return (
                AcademicContextState.HISTORICAL
                if period_obj.period_sequence < active_period.period_sequence
                else AcademicContextState.FUTURE
            )
        if period_obj.end_date and active_period.start_date and period_obj.end_date <= active_period.start_date:
            return AcademicContextState.HISTORICAL
        if period_obj.start_date and active_period.end_date and period_obj.start_date >= active_period.end_date:
            return AcademicContextState.FUTURE
        if period_obj.start_date and active_period.start_date and period_obj.start_date != active_period.start_date:
            return (
                AcademicContextState.HISTORICAL
                if period_obj.start_date < active_period.start_date
                else AcademicContextState.FUTURE
            )
        if period_obj.academic_period_id is not None and active_period.academic_period_id is not None:
            return (
                AcademicContextState.HISTORICAL
                if period_obj.academic_period_id < active_period.academic_period_id
                else AcademicContextState.FUTURE
            )
        return AcademicContextState.FUTURE

    @classmethod
    def get_write_restriction_reason(
        cls,
        db: Session,
        class_id: int | None = None,
        academic_period_id: int | None = None,
        as_of: date_type | None = None,
        *,
        block_future_period_in_current_year: bool = False,
    ) -> str | None:
        resolve_active_academic_period(db, required=True)
        class_obj = db.get(Class, class_id) if class_id is not None else None
        period_obj = db.get(AcademicPeriod, academic_period_id) if academic_period_id is not None else None

        if cls.is_class_archived(class_obj):
            return "Class is archived. Historical and archived records are read-only."

        if (
            class_obj is not None
            and period_obj is not None
            and class_obj.academic_year_id != period_obj.academic_year_id
        ):
            return "Academic class and period must belong to the same academic year."

        year_id = (
            period_obj.academic_year_id
            if period_obj is not None and period_obj.academic_year_id is not None
            else (class_obj.academic_year_id if class_obj is not None else None)
        )
        year_obj = db.get(AcademicYear, year_id) if year_id is not None else None

        if year_obj is not None:
            year_state = cls.classify_academic_year(db, year_obj, as_of=as_of)
            if year_state == AcademicContextState.HISTORICAL:
                return "Academic year is closed. Historical records are read-only."
            if year_state == AcademicContextState.FUTURE:
                return "Academic year is not currently active. Records are read-only."

        if period_obj is not None:
            period_state = cls.classify_academic_period(db, period_obj, year_obj=year_obj, as_of=as_of)
            if period_state == AcademicContextState.HISTORICAL:
                return "Academic period is closed. Historical records are read-only."
            if block_future_period_in_current_year and period_state == AcademicContextState.FUTURE:
                return "Academic period is not yet active. Live records cannot be modified for a future period."

        return None

    @classmethod
    def assert_context_writable(
        cls,
        db: Session,
        class_id: int | None = None,
        academic_period_id: int | None = None,
        as_of: date_type | None = None,
        *,
        block_future_period_in_current_year: bool = False,
    ) -> None:
        reason = cls.get_write_restriction_reason(
            db,
            class_id=class_id,
            academic_period_id=academic_period_id,
            as_of=as_of,
            block_future_period_in_current_year=block_future_period_in_current_year,
        )
        if reason:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=reason,
            )

    @classmethod
    def get_configuration_restriction_reason(
        cls,
        db: Session,
        *,
        academic_year_id: int | None = None,
        class_id: int | None = None,
        academic_period_id: int | None = None,
        as_of: date_type | None = None,
    ) -> str | None:
        """Return why an academic planning context cannot be changed.

        Configuration is intentionally broader than operational writes: prepared
        future years and periods may be configured, but historical or archived
        contexts remain read-only. Operational callers must continue to use
        ``assert_context_writable``.
        """
        resolve_active_academic_period(db, required=False)
        class_obj = db.get(Class, class_id) if class_id is not None else None
        period_obj = db.get(AcademicPeriod, academic_period_id) if academic_period_id is not None else None

        if cls.is_class_archived(class_obj):
            return "Class is archived. Historical and archived records are read-only."

        context_year_ids = {
            year_id
            for year_id in (
                academic_year_id,
                period_obj.academic_year_id if period_obj is not None else None,
                class_obj.academic_year_id if class_obj is not None else None,
            )
            if year_id is not None
        }
        if len(context_year_ids) > 1:
            return "Academic class, year, and period must belong to the same academic year."

        year_id = next(iter(context_year_ids), None)
        year_obj = db.get(AcademicYear, year_id) if year_id is not None else None
        if year_obj is not None and cls.classify_academic_year(db, year_obj, as_of=as_of) == AcademicContextState.HISTORICAL:
            return "Academic year is closed. Historical configuration is read-only."

        if (
            period_obj is not None
            and cls.classify_academic_period(db, period_obj, year_obj=year_obj, as_of=as_of)
            == AcademicContextState.HISTORICAL
        ):
            return "Academic period is closed. Historical configuration is read-only."

        return None

    @classmethod
    def assert_context_configurable(
        cls,
        db: Session,
        *,
        academic_year_id: int | None = None,
        class_id: int | None = None,
        academic_period_id: int | None = None,
        as_of: date_type | None = None,
    ) -> None:
        reason = cls.get_configuration_restriction_reason(
            db,
            academic_year_id=academic_year_id,
            class_id=class_id,
            academic_period_id=academic_period_id,
            as_of=as_of,
        )
        if reason:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=reason)

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

        class_obj = db.get(Class, class_id) if class_id is not None else None
        period_obj = db.get(AcademicPeriod, academic_period_id) if academic_period_id is not None else None
        if (
            class_obj is not None
            and period_obj is not None
            and class_obj.academic_year_id is not None
            and period_obj.academic_year_id is not None
            and class_obj.academic_year_id != period_obj.academic_year_id
        ):
            return SubjectAccessLevel.DENIED

        try:
            restriction_reason = cls.get_write_restriction_reason(
                db, class_id=class_id, academic_period_id=academic_period_id, as_of=as_of
            )
        except HTTPException as exc:
            if exc.status_code != status.HTTP_409_CONFLICT:
                raise
            # Assigned users retain read-only access while operational writes
            # are blocked until the lifecycle inconsistency is repaired.
            restriction_reason = str(exc.detail)

        try:
            from app.models.people.AcademicStaff import AcademicStaff
            admin_staff = (
                db.query(AcademicStaff)
                .filter(AcademicStaff.staff_id == staff_id)
                .first()
            )
            if admin_staff and admin_staff.user_id:
                from app.models.auth.Role import Role
                from app.models.auth.UserRoles import UserRoles
                is_admin = (
                    db.query(Role.role_id)
                    .join(UserRoles, UserRoles.role_id == Role.role_id)
                    .filter(
                        UserRoles.user_id == admin_staff.user_id,
                        func.lower(Role.role_name) == "admin",
                    )
                    .first()
                )
                if is_admin:
                    return SubjectAccessLevel.VIEW_ONLY if restriction_reason else SubjectAccessLevel.WRITE
        except Exception:
            pass

        load = cls.get_active_published_load(db, class_id, subject_id, academic_period_id)
        if not load:
            return SubjectAccessLevel.DENIED

        active_sub = SubstitutionService.get_active_substitution(db, load.subject_load_id, as_of=target_date)
        if active_sub is not None:
            # 1. Substitute teacher has active write/grading authority (downgraded to VIEW_ONLY if historical/archived)
            if staff_id == active_sub.substitute_staff_id:
                return SubjectAccessLevel.VIEW_ONLY if restriction_reason else SubjectAccessLevel.WRITE

            # 2. Current permanent primary teacher on SubjectLoad has view-only access during substitution
            if staff_id == load.staff_id:
                return SubjectAccessLevel.VIEW_ONLY

            # 3. Original on-leave primary teacher: retains view-only access ONLY if they are still the primary teacher on SubjectLoad
            # If permanently replaced (A -> B), former Teacher A receives DENIED per least privilege.
            if staff_id == active_sub.original_staff_id and load.staff_id == active_sub.original_staff_id:
                return SubjectAccessLevel.VIEW_ONLY

            return SubjectAccessLevel.DENIED

        # No active substitution: assigned primary teacher has write authority in open contexts, view-only in historical/archived
        if staff_id == load.staff_id:
            return SubjectAccessLevel.VIEW_ONLY if restriction_reason else SubjectAccessLevel.WRITE

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
            restriction_reason = cls.get_write_restriction_reason(
                db, class_id=class_id, academic_period_id=academic_period_id, as_of=as_of
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=restriction_reason or "You are currently on leave for this class/subject. Records are read-only.",
            )
        if level == SubjectAccessLevel.DENIED:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not authorized to modify records for this class and subject.",
            )
