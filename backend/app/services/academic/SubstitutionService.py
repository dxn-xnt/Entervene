from __future__ import annotations
from datetime import date as date_type
from typing import Any
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.people.AcademicStaff import AcademicStaff


def _staff_full_name(staff: AcademicStaff | None) -> str:
    if staff is None:
        return "Unknown Staff"
    parts = [staff.first_name, staff.middle_name, staff.last_name, staff.suffix]
    return " ".join(p.strip() for p in parts if p and p.strip()) or "Unknown Staff"


class SubstitutionService:

    @staticmethod
    def is_active_on_date(sub: TeacherSubstitution, as_of: date_type | None = None) -> bool:
        if as_of is None:
            as_of = date_type.today()
        if sub.status != "active":
            return False
        if as_of < sub.start_date:
            return False
        if sub.end_date is not None and as_of > sub.end_date:
            return False
        return True

    @classmethod
    def get_active_substitution(
        cls,
        db: Session,
        subject_load_id: int,
        as_of: date_type | None = None,
    ) -> TeacherSubstitution | None:
        if as_of is None:
            as_of = date_type.today()

        sub = (
            db.query(TeacherSubstitution)
            .filter(
                TeacherSubstitution.subject_load_id == subject_load_id,
                TeacherSubstitution.status == "active",
                TeacherSubstitution.start_date <= as_of,
            )
            .all()
        )
        for s in sub:
            if s.end_date is None or as_of <= s.end_date:
                return s
        return None

    @classmethod
    def is_view_only(
        cls,
        db: Session,
        staff_id: str,
        subject_load_id: int,
        as_of: date_type | None = None,
    ) -> bool:
        active_sub = cls.get_active_substitution(db, subject_load_id, as_of)
        if active_sub is not None:
            if active_sub.original_staff_id == staff_id:
                return True
        return False

    @classmethod
    def assert_can_write(
        cls,
        db: Session,
        staff_id: str,
        subject_load_id: int,
        as_of: date_type | None = None,
    ) -> None:
        if cls.is_view_only(db, staff_id, subject_load_id, as_of):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are currently on leave for this class/subject. Records are read-only.",
            )

    @classmethod
    def resolve_effective_staff(
        cls,
        db: Session,
        subject_load_id: int,
        as_of: date_type | None = None,
    ) -> tuple[str | None, bool]:
        active_sub = cls.get_active_substitution(db, subject_load_id, as_of)
        if active_sub is not None:
            return active_sub.substitute_staff_id, True

        load = db.query(SubjectLoad).filter(SubjectLoad.subject_load_id == subject_load_id).first()
        return (load.staff_id if load else None), False

    @classmethod
    def get_staff_leave_summary(
        cls,
        db: Session,
        staff_ids: set[str],
        as_of: date_type | None = None,
    ) -> dict[str, dict[str, Any]]:
        if as_of is None:
            as_of = date_type.today()

        if not staff_ids:
            return {}

        subs = (
            db.query(TeacherSubstitution)
            .filter(
                TeacherSubstitution.original_staff_id.in_(staff_ids),
                TeacherSubstitution.status == "active",
                TeacherSubstitution.start_date <= as_of,
            )
            .all()
        )

        result: dict[str, dict[str, Any]] = {
            sid: {"is_on_leave": False, "active_substitutions_count": 0}
            for sid in staff_ids
        }

        for s in subs:
            if s.end_date is None or as_of <= s.end_date:
                entry = result.setdefault(s.original_staff_id, {"is_on_leave": False, "active_substitutions_count": 0})
                entry["is_on_leave"] = True
                entry["active_substitutions_count"] += 1

        return result

    @classmethod
    def get_substitute_covered_loads(
        cls,
        db: Session,
        staff_id: str,
        academic_period_id: int,
        as_of: date_type | None = None,
    ) -> list[tuple[SubjectLoad, str]]:
        """Returns list of (SubjectLoad, original_teacher_full_name) covered by this substitute today."""
        if as_of is None:
            as_of = date_type.today()

        active_subs = (
            db.query(TeacherSubstitution, SubjectLoad, AcademicStaff)
            .join(SubjectLoad, SubjectLoad.subject_load_id == TeacherSubstitution.subject_load_id)
            .join(AcademicStaff, AcademicStaff.staff_id == TeacherSubstitution.original_staff_id)
            .filter(
                TeacherSubstitution.substitute_staff_id == staff_id,
                TeacherSubstitution.status == "active",
                TeacherSubstitution.start_date <= as_of,
                SubjectLoad.academic_period_id == academic_period_id,
                SubjectLoad.status == "published",
            )
            .all()
        )

        covered: list[tuple[SubjectLoad, str]] = []
        for sub, load, orig_staff in active_subs:
            if sub.end_date is None or as_of <= sub.end_date:
                covered.append((load, _staff_full_name(orig_staff)))
        return covered

    @classmethod
    def get_original_teacher_covered_load_ids(
        cls,
        db: Session,
        staff_id: str,
        academic_period_id: int,
        as_of: date_type | None = None,
    ) -> dict[int, str]:
        """Returns dict of {subject_load_id: substitute_teacher_full_name} for active substitutions covering this teacher."""
        if as_of is None:
            as_of = date_type.today()

        active_subs = (
            db.query(TeacherSubstitution, AcademicStaff)
            .join(SubjectLoad, SubjectLoad.subject_load_id == TeacherSubstitution.subject_load_id)
            .join(AcademicStaff, AcademicStaff.staff_id == TeacherSubstitution.substitute_staff_id)
            .filter(
                TeacherSubstitution.original_staff_id == staff_id,
                TeacherSubstitution.status == "active",
                TeacherSubstitution.start_date <= as_of,
                SubjectLoad.academic_period_id == academic_period_id,
                SubjectLoad.status == "published",
            )
            .all()
        )

        res: dict[int, str] = {}
        for sub, sub_staff in active_subs:
            if sub.end_date is None or as_of <= sub.end_date:
                res[sub.subject_load_id] = _staff_full_name(sub_staff)
        return res
