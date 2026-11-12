from datetime import date, datetime
import re
from typing import Any
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.academic.AcademicYear import AcademicYear
from app.services.academic.AcademicLifecycleService import resolve_active_academic_year
from app.services.academic.SubjectLoadAuthorizationService import (
    SubjectLoadAuthorizationService,
    AcademicContextState,
)


def _parse_start_year(year_label: str) -> int | None:
    match = re.match(r"^(\d{4})", year_label.strip())
    if match:
        return int(match.group(1))
    return None


def ensure_future_academic_years(db: Session, years_ahead: int = 2) -> list[AcademicYear]:
    """
    Ensures that academic years exist up to ``years_ahead`` from the current/active academic year.
    If missing, creates future AcademicYear records with standard dates and is_active=False.
    Repeated calls target the same active/calendar year range.
    """
    # 1. Determine base start year
    active_year = resolve_active_academic_year(db, required=False)

    base_start_year: int | None = None

    if active_year:
        base_start_year = _parse_start_year(active_year.year_label)
        if not base_start_year and active_year.start_date:
            base_start_year = active_year.start_date.year

    if not base_start_year:
        now = datetime.now()
        # In PH/DepEd cycle: if June or later, start year is current year, else prior year
        base_start_year = now.year if now.month >= 6 else now.year - 1

    # 2. Query all existing year labels into a set
    existing_years = db.query(AcademicYear).all()
    existing_labels = {ay.year_label.strip().casefold() for ay in existing_years}
    existing_start_years = {
        _parse_start_year(ay.year_label)
        for ay in existing_years
        if _parse_start_year(ay.year_label) is not None
    }

    created_any = False
    for offset in range(years_ahead + 1):
        sy_start = base_start_year + offset
        sy_end = sy_start + 1
        label = f"{sy_start}-{sy_end}"

        if label.casefold() not in existing_labels and sy_start not in existing_start_years:
            new_ay = AcademicYear(
                year_label=label,
                start_date=date(sy_start, 8, 1),
                end_date=date(sy_end, 5, 31),
                is_active=False,
            )
            db.add(new_ay)
            existing_labels.add(label.casefold())
            existing_start_years.add(sy_start)
            created_any = True

    if created_any:
        db.commit()

    return db.query(AcademicYear).order_by(AcademicYear.start_date.desc(), func.lower(AcademicYear.year_label).desc()).all()


def get_authorized_academic_years(
    db: Session,
    user: dict[str, Any] | None = None,
    *,
    role: str | None = None,
    user_id: UUID | str | None = None,
    staff_id: str | None = None,
    student_id: UUID | str | None = None,
    as_of: date | None = None,
) -> list[AcademicYear]:
    """Resolves authorized academic years for a user based on centralized visibility rules.

    Rules:
    - Admin: May view all academic years (historical, active, and prepared future).
    - Teacher: May view the active year and historical years with legitimate teaching,
      substitution, or advisory records. Strictly excludes future academic years.
    - Student: May view the active year and historical years with their own valid enrollment
      or academic records. Strictly excludes future academic years.
    - Unauthenticated / unknown: May view the active year only. Excludes future years.

    Uses existing academic lifecycle classification (SubjectLoadAuthorizationService),
    never relying on database ID ordering or today's date alone.
    """
    from app.models.academic.AcademicPeriod import AcademicPeriod
    from app.models.academic.Class_ import Class
    from app.models.academic.SubjectLoad import SubjectLoad
    from app.models.academic.TeacherSubstitution import TeacherSubstitution
    from app.models.academic.StudentCLass import StudentClass
    from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
    from app.models.people.AcademicStaff import AcademicStaff
    from app.models.people.Student import Student

    # 1. Determine effective role and identity identifiers
    effective_role = (
        role
        or (user.get("role") if user else None)
        or ""
    ).strip().lower()

    raw_user_id = user_id or (user.get("sub") or user.get("user_id") if user else None)
    parsed_user_id: UUID | None = None
    if raw_user_id:
        try:
            parsed_user_id = UUID(str(raw_user_id)) if not isinstance(raw_user_id, UUID) else raw_user_id
        except (ValueError, TypeError):
            parsed_user_id = None

    if not effective_role:
        if staff_id:
            effective_role = "teacher"
        elif student_id:
            effective_role = "student"

    # 2. Admin: Full visibility across historical, active, and prepared future years
    if effective_role == "admin":
        return (
            db.query(AcademicYear)
            .order_by(
                AcademicYear.start_date.desc().nullslast(),
                func.lower(AcademicYear.year_label).desc(),
                AcademicYear.academic_year_id.desc(),
            )
            .all()
        )

    # 3. Active academic year resolution
    active_year = resolve_active_academic_year(db, required=False)
    candidate_year_ids: set[int] = set()
    if active_year and active_year.academic_year_id is not None:
        candidate_year_ids.add(active_year.academic_year_id)

    # 4. Teacher: Active year + historical years with legitimate teaching/advisory records
    if effective_role == "teacher":
        resolved_staff_id = staff_id
        if not resolved_staff_id and parsed_user_id:
            staff_row = (
                db.query(AcademicStaff.staff_id)
                .filter(AcademicStaff.user_id == parsed_user_id)
                .first()
            )
            if staff_row:
                resolved_staff_id = staff_row[0]

        if resolved_staff_id:
            # a. Legitimate primary teaching loads (published/active versions)
            teaching_loads = (
                db.query(AcademicPeriod.academic_year_id)
                .join(SubjectLoad, SubjectLoad.academic_period_id == AcademicPeriod.academic_period_id)
                .filter(
                    SubjectLoad.staff_id == resolved_staff_id,
                    SubjectLoad.is_active_version.is_(True),
                    SubjectLoad.status.in_(["active", "published"]),
                )
                .distinct()
                .all()
            )
            for r in teaching_loads:
                if r[0] is not None:
                    candidate_year_ids.add(r[0])

            # Also check class-linked loads defensively
            class_loads = (
                db.query(Class.academic_year_id)
                .join(SubjectLoad, SubjectLoad.class_id == Class.class_id)
                .filter(
                    SubjectLoad.staff_id == resolved_staff_id,
                    SubjectLoad.is_active_version.is_(True),
                    SubjectLoad.status.in_(["active", "published"]),
                )
                .distinct()
                .all()
            )
            for r in class_loads:
                if r[0] is not None:
                    candidate_year_ids.add(r[0])

            # b. Legitimate substitution loads (active or completed)
            sub_loads = (
                db.query(AcademicPeriod.academic_year_id)
                .join(SubjectLoad, SubjectLoad.academic_period_id == AcademicPeriod.academic_period_id)
                .join(TeacherSubstitution, TeacherSubstitution.subject_load_id == SubjectLoad.subject_load_id)
                .filter(
                    TeacherSubstitution.substitute_staff_id == resolved_staff_id,
                    TeacherSubstitution.status.in_(["active", "completed"]),
                )
                .distinct()
                .all()
            )
            for r in sub_loads:
                if r[0] is not None:
                    candidate_year_ids.add(r[0])

            # c. Legitimate class advisory records
            advisory_classes = (
                db.query(Class.academic_year_id)
                .filter(Class.adviser_staff_id == resolved_staff_id)
                .distinct()
                .all()
            )
            for r in advisory_classes:
                if r[0] is not None:
                    candidate_year_ids.add(r[0])

    # 5. Student: Active year + historical years with valid enrollment or academic records
    elif effective_role == "student":
        resolved_student_id = student_id
        if not resolved_student_id and parsed_user_id:
            st_row = (
                db.query(Student.student_id)
                .filter(Student.user_id == parsed_user_id)
                .first()
            )
            if st_row:
                resolved_student_id = st_row[0]

        if resolved_student_id:
            parsed_st_id = (
                UUID(str(resolved_student_id))
                if not isinstance(resolved_student_id, UUID)
                else resolved_student_id
            )

            # a. Valid enrollment records
            enrollment_years = (
                db.query(StudentClass.academic_year_id)
                .filter(
                    StudentClass.student_id == parsed_st_id,
                    func.lower(func.coalesce(StudentClass.enrollment_status, "enrolled")).in_(
                        ["enrolled", "completed", "promoted", "graduated", "transferred"]
                    ),
                )
                .distinct()
                .all()
            )
            for r in enrollment_years:
                if r[0] is not None:
                    candidate_year_ids.add(r[0])

            # b. Academic grade records
            grade_years = (
                db.query(AcademicPeriod.academic_year_id)
                .join(StudentPeriodGrade, StudentPeriodGrade.academic_period_id == AcademicPeriod.academic_period_id)
                .filter(StudentPeriodGrade.student_id == parsed_st_id)
                .distinct()
                .all()
            )
            for r in grade_years:
                if r[0] is not None:
                    candidate_year_ids.add(r[0])

    if not candidate_year_ids:
        return []

    # 6. Fetch candidate years ordered chronologically desc
    candidates = (
        db.query(AcademicYear)
        .filter(AcademicYear.academic_year_id.in_(candidate_year_ids))
        .order_by(
            AcademicYear.start_date.desc().nullslast(),
            func.lower(AcademicYear.year_label).desc(),
            AcademicYear.academic_year_id.desc(),
        )
        .all()
    )

    # 7. Strictly exclude all future years for Teacher, Student, and unauthenticated callers
    authorized: list[AcademicYear] = []
    for ay in candidates:
        state = SubjectLoadAuthorizationService.classify_academic_year(db, ay, as_of=as_of)
        if state != AcademicContextState.FUTURE:
            authorized.append(ay)

    return authorized


def is_academic_year_authorized(
    db: Session,
    academic_year_id: int,
    user: dict[str, Any] | None = None,
    *,
    role: str | None = None,
    user_id: UUID | str | None = None,
    staff_id: str | None = None,
    student_id: UUID | str | None = None,
    as_of: date | None = None,
) -> bool:
    """Checks whether a specific academic_year_id is authorized for the given user."""
    authorized_years = get_authorized_academic_years(
        db,
        user=user,
        role=role,
        user_id=user_id,
        staff_id=staff_id,
        student_id=student_id,
        as_of=as_of,
    )
    return any(ay.academic_year_id == academic_year_id for ay in authorized_years)
