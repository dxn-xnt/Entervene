from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.classes.ClassShared import (
    ClassManagementError,
    available_advisers_query,
    normalized_text,
    readable_text,
    resolve_active_academic_year,
    student_sort_key,
)

# READ SIDE OF CLASS MANAGEMENT
# Functions in this module assemble data for admin pages without changing class
# records. Routes call these functions after access control has already passed.


def _academic_year_option(academic_year) -> dict:
    return {
        "academic_year_id": academic_year.academic_year_id,
        "year_label": academic_year.year_label,
    }


def _academic_level_option(academic_level) -> dict:
    return {
        "academic_level_id": academic_level.academic_level_id,
        "level_name": academic_level.level_name,
        "grade_level": academic_level.grade_level,
    }


def _adviser_option(adviser) -> dict | None:
    if adviser is None:
        return None
    return {
        "staff_id": adviser.staff_id,
        "first_name": adviser.first_name,
        "middle_name": adviser.middle_name,
        "last_name": adviser.last_name,
        "suffix": adviser.suffix,
    }


def _student_full_name(student: Student) -> str:
    first_name = readable_text(student.first_name)
    middle_name = readable_text(student.middle_name)
    last_name = readable_text(student.last_name)
    suffix = readable_text(student.suffix)
    middle_initial = f"{middle_name[:1].upper()}." if middle_name else ""
    given_name = " ".join(part for part in [first_name, middle_initial] if part)
    family_name = " ".join(part for part in [last_name, suffix] if part)
    if family_name and given_name:
        return f"{family_name}, {given_name}"
    return family_name or given_name


def _student_gender_group(value) -> str:
    gender = normalized_text(value)
    if gender in {"female", "f", "girl"}:
        return "Female"
    if gender in {"male", "m", "boy"}:
        return "Male"
    if gender:
        return "Other"
    return "Unspecified"


def _gender_count_key(group: str) -> str:
    if group == "Female":
        return "female"
    if group == "Male":
        return "male"
    if group == "Other":
        return "other"
    return "unspecified"


def _student_list_item(student: Student) -> dict:
    full_name = _student_full_name(student)
    return {
        "student_id": student.student_id,
        "full_name": full_name,
        "gender": _student_gender_group(student.gender),
        "avatar_initial": (readable_text(student.first_name)[:1] or "?").upper(),
    }


def _teacher_advisory_student_item(student: Student, account: UserAccount | None) -> dict:
    return {
        **_student_list_item(student),
        "student_lrn": student.student_lrn,
        "email": student.email or (account.email if account else None),
        "account_status": account.account_status if account else None,
    }


def _staff_full_name(staff: AcademicStaff | None) -> str:
    if staff is None:
        return "Unassigned teacher"
    return " ".join(
        part
        for part in [
            readable_text(staff.first_name),
            readable_text(staff.middle_name),
            readable_text(staff.last_name),
            readable_text(staff.suffix),
        ]
        if part
    )


def _format_display_date(value) -> str | None:
    if value is None:
        return None
    return f"{value.strftime('%B')} {value.day}, {value.year}"


def _is_archived_status(status: str | None) -> bool:
    return normalized_text(status or "active") == "archived"


def _advisory_class_access_row(db: Session, class_id: int):
    row = (
        db.query(Class, AcademicLevel, AcademicYear)
        .join(AcademicLevel, Class.academic_level_id == AcademicLevel.academic_level_id)
        .join(AcademicYear, Class.academic_year_id == AcademicYear.academic_year_id)
        .filter(Class.class_id == class_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Class not found.")
    return row


def _ensure_adviser_access(class_: Class, staff_id: str) -> None:
    if class_.adviser_staff_id != staff_id:
        raise HTTPException(status_code=403, detail="You do not have permission to view this advisory class.")


def _active_class_filter():
    return func.lower(func.coalesce(Class.class_status, "active")) != "archived"


def get_class_form_options_data(db: Session) -> dict:
    # This is the first request made by the class-creation page.
    academic_year = resolve_active_academic_year(db)
    academic_levels = (
        db.query(AcademicLevel)
        .order_by(AcademicLevel.grade_level, func.lower(AcademicLevel.level_name))
        .all()
    )
    eligible_advisers = (
        available_advisers_query(db, academic_year.academic_year_id)
        .order_by(
            func.lower(AcademicStaff.last_name),
            func.lower(AcademicStaff.first_name),
            func.lower(func.coalesce(AcademicStaff.middle_name, "")),
        )
        .all()
    )
    return {
        "academic_year": _academic_year_option(academic_year),
        "academic_levels": [_academic_level_option(level) for level in academic_levels],
        "eligible_advisers": [_adviser_option(adviser) for adviser in eligible_advisers],
    }


def list_classes_data(db: Session, status: str) -> dict:
    requested_status = normalized_text(status)
    # Load all statuses once because the summary describes the complete class
    # inventory while only the returned class list follows the status filter.
    class_rows = (
        db.query(
            Class,
            AcademicLevel,
            AcademicYear,
            AcademicStaff,
            func.count(StudentClass.student_class_id).label("student_count"),
        )
        .join(AcademicLevel, Class.academic_level_id == AcademicLevel.academic_level_id)
        .join(AcademicYear, Class.academic_year_id == AcademicYear.academic_year_id)
        .outerjoin(AcademicStaff, Class.adviser_staff_id == AcademicStaff.staff_id)
        .outerjoin(StudentClass, Class.class_id == StudentClass.class_id)
        .group_by(Class.class_id, AcademicLevel.academic_level_id, AcademicYear.academic_year_id, AcademicStaff.staff_id)
        .order_by(AcademicLevel.grade_level, func.lower(Class.section_name))
        .all()
    )

    classes = []
    total_students = 0
    active_classes = 0
    archived_classes = 0
    for class_, academic_level, academic_year, adviser, student_count in class_rows:
        count = int(student_count or 0)
        total_students += count
        class_status = readable_text(class_.class_status) or "active"
        normalized_status = normalized_text(class_status)
        if normalized_status == "active":
            active_classes += 1
        elif normalized_status == "archived":
            archived_classes += 1

        if normalized_status == requested_status:
            classes.append({
                "class_id": class_.class_id,
                "section_name": class_.section_name,
                "class_status": class_status,
                "academic_year": _academic_year_option(academic_year),
                "academic_level": _academic_level_option(academic_level),
                "adviser": _adviser_option(adviser),
                "student_count": count,
                "subject_count": 0,
            })

    return {
        "summary": {
            "total_classes": len(class_rows),
            "active_classes": active_classes,
            "archived_classes": archived_classes,
            "students_assigned": total_students,
        },
        "classes": classes,
    }


def list_teacher_advisory_classes_data(db: Session, staff_id: str) -> list[dict]:
    rows = (
        db.query(
            Class,
            AcademicLevel,
            AcademicYear,
            func.count(func.distinct(StudentClass.student_class_id)).label("student_count"),
            func.count(func.distinct(SubjectLoad.subject_load_id)).label("subject_count"),
        )
        .join(AcademicLevel, Class.academic_level_id == AcademicLevel.academic_level_id)
        .join(AcademicYear, Class.academic_year_id == AcademicYear.academic_year_id)
        .outerjoin(
            StudentClass,
            (Class.class_id == StudentClass.class_id)
            & (Class.academic_year_id == StudentClass.academic_year_id),
        )
        .outerjoin(SubjectLoad, Class.class_id == SubjectLoad.class_id)
        .filter(Class.adviser_staff_id == staff_id)
        .group_by(Class.class_id, AcademicLevel.academic_level_id, AcademicYear.academic_year_id)
        .order_by(AcademicLevel.grade_level, func.lower(Class.section_name))
        .all()
    )

    return [
        {
            "class_id": class_.class_id,
            "section_name": class_.section_name,
            "academic_level": academic_level.level_name,
            "academic_year": academic_year.year_label,
            "class_status": readable_text(class_.class_status) or "active",
            "is_archived": _is_archived_status(class_.class_status),
            "student_count": int(student_count or 0),
            "subject_count": int(subject_count or 0),
        }
        for class_, academic_level, academic_year, student_count, subject_count in rows
    ]


def get_teacher_advisory_class_detail_data(db: Session, class_id: int, staff_id: str) -> dict:
    class_, academic_level, academic_year = _advisory_class_access_row(db, class_id)
    _ensure_adviser_access(class_, staff_id)

    student_rows = (
        db.query(Student, UserAccount)
        .join(StudentClass, Student.student_id == StudentClass.student_id)
        .outerjoin(UserAccount, Student.user_id == UserAccount.user_id)
        .filter(StudentClass.class_id == class_.class_id)
        .filter(StudentClass.academic_year_id == class_.academic_year_id)
        .all()
    )
    students = [_teacher_advisory_student_item(student, account) for student, account in student_rows]
    students.sort(key=lambda item: item["full_name"].casefold())

    gender_counts = {"female": 0, "male": 0}
    for student in students:
        key = _gender_count_key(student["gender"])
        if key in gender_counts:
            gender_counts[key] += 1

    subject_rows = (
        db.query(SubjectLoad, Subject, AcademicStaff, AcademicPeriod)
        .join(Subject, Subject.subject_id == SubjectLoad.subject_id)
        .join(AcademicStaff, AcademicStaff.staff_id == SubjectLoad.staff_id)
        .outerjoin(AcademicPeriod, AcademicPeriod.academic_period_id == SubjectLoad.academic_period_id)
        .filter(SubjectLoad.class_id == class_.class_id)
        .order_by(func.lower(Subject.subject_name), func.lower(AcademicStaff.last_name), func.lower(AcademicStaff.first_name))
        .all()
    )
    subject_loads = [
        {
            "subject_load_id": load.subject_load_id,
            "subject_id": subject.subject_id,
            "subject_name": subject.subject_name,
            "teacher_id": staff.staff_id,
            "teacher_name": _staff_full_name(staff),
            "schedule": period.period_name if period else None,
            "status": load.status,
        }
        for load, subject, staff, period in subject_rows
    ]

    return {
        "class_id": class_.class_id,
        "section_name": class_.section_name,
        "academic_level": academic_level.level_name,
        "academic_year": academic_year.year_label,
        "class_status": readable_text(class_.class_status) or "active",
        "is_archived": _is_archived_status(class_.class_status),
        "created_at": class_.created_at,
        "active_since": _format_display_date(class_.created_at),
        "student_count": len(students),
        "male_count": gender_counts["male"],
        "female_count": gender_counts["female"],
        "subject_count": len(subject_loads),
        "students": students,
        "subject_loads": subject_loads,
    }


def get_unassigned_students_data(db: Session, academic_level_id: int) -> dict:
    academic_year = resolve_active_academic_year(db)
    academic_level = db.query(AcademicLevel).filter(AcademicLevel.academic_level_id == academic_level_id).first()
    if not academic_level:
        raise ClassManagementError(
            status_code=404,
            message="Request validation failed.",
            code="validation_failed",
            errors=[{
                "row": None,
                "field": "academic_level_id",
                "code": "academic_level_not_found",
                "message": f"Academic level {academic_level_id} does not exist.",
            }],
        )

    # "Unassigned" is year-specific: historical StudentClass rows must not hide
    # a student from the active-year class creation workflow.
    assigned_in_active_year = (
        db.query(StudentClass.student_class_id)
        .join(Class, StudentClass.class_id == Class.class_id)
        .filter(StudentClass.student_id == Student.student_id)
        .filter(Class.academic_year_id == academic_year.academic_year_id)
        .exists()
    )
    students = (
        db.query(Student)
        .filter(Student.academic_level_id == academic_level_id)
        .filter(~assigned_in_active_year)
        .all()
    )
    students.sort(key=student_sort_key)

    return {
        "academic_level": _academic_level_option(academic_level),
        "academic_year": _academic_year_option(academic_year),
        "students": [{
            "student_id": student.student_id,
            "student_lrn": student.student_lrn,
            "first_name": student.first_name,
            "middle_name": student.middle_name,
            "last_name": student.last_name,
            "gender": student.gender,
            "academic_level_id": student.academic_level_id,
        } for student in students],
    }


def get_class_students_data(
    db: Session,
    class_id: int,
    search: str = "",
    page: int = 1,
    page_size: int = 100,
) -> dict:
    class_row = (
        db.query(Class, AcademicLevel)
        .join(AcademicLevel, Class.academic_level_id == AcademicLevel.academic_level_id)
        .filter(Class.class_id == class_id)
        .first()
    )
    if class_row is None:
        raise HTTPException(status_code=404, detail="Class not found.")

    class_, academic_level = class_row
    # Restrict the roster to the class's academic year so historical enrollment
    # records do not leak into the current admin view.
    rows = (
        db.query(Student)
        .join(StudentClass, Student.student_id == StudentClass.student_id)
        .filter(StudentClass.class_id == class_.class_id)
        .filter(StudentClass.academic_year_id == class_.academic_year_id)
        .all()
    )
    items = [_student_list_item(student) for student in rows]
    search_term = normalized_text(search)
    if search_term:
        items = [item for item in items if search_term in normalized_text(item["full_name"])]

    items.sort(key=lambda item: item["full_name"].casefold())
    gender_counts = {"female": 0, "male": 0, "other": 0, "unspecified": 0}
    for item in items:
        gender_counts[_gender_count_key(item["gender"])] += 1

    total_items = len(items)
    total_pages = max((total_items + page_size - 1) // page_size, 1)
    start = (page - 1) * page_size
    return {
        "class_id": class_.class_id,
        "section_name": class_.section_name,
        "academic_level": {
            "academic_level_id": academic_level.academic_level_id,
            "level_name": academic_level.level_name,
        },
        "summary": {"total_students": total_items, "gender_counts": gender_counts},
        "students": items[start:start + page_size],
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_items": total_items,
            "total_pages": total_pages,
        },
    }


def get_class_transfer_options_data(db: Session, class_id: int) -> dict:
    class_row = (
        db.query(Class, AcademicLevel)
        .join(AcademicLevel, Class.academic_level_id == AcademicLevel.academic_level_id)
        .filter(Class.class_id == class_id)
        .first()
    )
    if class_row is None:
        raise HTTPException(status_code=404, detail="Class not found.")

    class_, academic_level = class_row
    # Transfers are limited to another active section in the same year and level.
    sections = (
        db.query(Class)
        .filter(Class.class_id != class_.class_id)
        .filter(Class.academic_level_id == class_.academic_level_id)
        .filter(Class.academic_year_id == class_.academic_year_id)
        .filter(_active_class_filter())
        .order_by(func.lower(Class.section_name))
        .all()
    )
    return {
        "current_class_id": class_.class_id,
        "academic_level": {
            "academic_level_id": academic_level.academic_level_id,
            "level_name": academic_level.level_name,
        },
        "available_sections": [
            {"class_id": section.class_id, "section_name": section.section_name}
            for section in sections
        ],
    }


def get_class_detail_data(db: Session, class_id: int) -> dict:
    class_row = (
        db.query(Class, AcademicLevel, AcademicYear, AcademicStaff)
        .join(AcademicLevel, Class.academic_level_id == AcademicLevel.academic_level_id)
        .join(AcademicYear, Class.academic_year_id == AcademicYear.academic_year_id)
        .outerjoin(AcademicStaff, Class.adviser_staff_id == AcademicStaff.staff_id)
        .filter(Class.class_id == class_id)
        .first()
    )
    if class_row is None:
        raise HTTPException(status_code=404, detail="Class not found.")

    class_, academic_level, academic_year, adviser = class_row
    student_count = db.query(func.count(StudentClass.student_class_id)).filter(StudentClass.class_id == class_.class_id).scalar()
    subject_count = db.query(func.count(SubjectLoad.subject_load_id)).filter(SubjectLoad.class_id == class_.class_id).scalar()
    return {
        "class_id": class_.class_id,
        "section_name": class_.section_name,
        "class_status": readable_text(class_.class_status) or "active",
        "created_at": class_.created_at,
        "academic_year": _academic_year_option(academic_year),
        "academic_level": _academic_level_option(academic_level),
        "adviser": _adviser_option(adviser),
        "statistics": {
            "student_count": int(student_count or 0),
            "subject_count": int(subject_count or 0),
            "schedule_count": 0,
        },
    }
