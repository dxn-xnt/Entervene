import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.db.Session import get_db
from app.api.v1.routes.Auth import get_current_user
from app.models.people.Student import Student
from app.models.people.AcademicStaff import AcademicStaff
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Class_ import Class
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.Subject import Subject
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear

router = APIRouter()


def _require_student(current_user: dict) -> None:
    if current_user.get("role") != "student":
        raise HTTPException(status_code=403, detail="Only students can access this resource")


def _student_full_name(student: Student) -> str:
    first_name = (student.first_name or "").strip()
    middle_name = (student.middle_name or "").strip()
    last_name = (student.last_name or "").strip()
    suffix = (student.suffix or "").strip()
    middle_initial = f"{middle_name[:1].upper()}." if middle_name else ""
    given_name = " ".join(part for part in [first_name, middle_initial] if part)
    family_name = " ".join(part for part in [last_name, suffix] if part)
    if family_name and given_name:
        return f"{family_name}, {given_name}"
    return family_name or given_name or "Student"


def _staff_full_name(staff: AcademicStaff | None) -> str:
    if staff is None:
        return "Not assigned"
    return " ".join(
        part
        for part in [
            (staff.first_name or "").strip(),
            (staff.middle_name or "").strip(),
            (staff.last_name or "").strip(),
            (staff.suffix or "").strip(),
        ]
        if part
    ) or "Not assigned"


def _resolve_student(db: Session, user_id: str) -> Student:
    try:
        parsed_user_id = uuid.UUID(str(user_id))
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid user session")

    student = db.query(Student).filter(Student.user_id == parsed_user_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student profile not found")
    return student


def _current_class_row(db: Session, student: Student):
    row = (
        db.query(StudentClass, Class, AcademicLevel, AcademicYear, AcademicStaff)
        .join(Class, Class.class_id == StudentClass.class_id)
        .join(AcademicLevel, AcademicLevel.academic_level_id == Class.academic_level_id)
        .join(AcademicYear, AcademicYear.academic_year_id == StudentClass.academic_year_id)
        .outerjoin(AcademicStaff, AcademicStaff.staff_id == Class.adviser_staff_id)
        .filter(
            StudentClass.student_id == student.student_id,
            StudentClass.enrollment_status == "enrolled",
            Class.class_status != "archived",
        )
        .order_by(AcademicYear.is_active.desc(), StudentClass.enrolled_at.desc())
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Student class not found")
    return row


def _classmate_count(db: Session, student: Student, class_: Class, assignment: StudentClass) -> int:
    return (
        db.query(func.count(StudentClass.student_class_id))
        .filter(
            StudentClass.class_id == class_.class_id,
            StudentClass.academic_year_id == assignment.academic_year_id,
            StudentClass.enrollment_status == "enrolled",
            StudentClass.student_id != student.student_id,
        )
        .scalar()
        or 0
    )


@router.get("/me/class")
def get_my_class(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_student(current_user)
    student = _resolve_student(db, current_user["sub"])
    assignment, class_, level, year, adviser = _current_class_row(db, student)

    return {
        "class_id": class_.class_id,
        "grade_level": level.level_name or f"Grade {level.grade_level}",
        "section_name": class_.section_name,
        "academic_year": year.year_label,
        "adviser_name": _staff_full_name(adviser),
        "classmate_count": _classmate_count(db, student, class_, assignment),
    }


@router.get("/me/classmates")
def get_my_classmates(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_student(current_user)
    student = _resolve_student(db, current_user["sub"])
    assignment, class_, _, _, _ = _current_class_row(db, student)

    rows = (
        db.query(Student)
        .join(StudentClass, StudentClass.student_id == Student.student_id)
        .filter(
            StudentClass.class_id == class_.class_id,
            StudentClass.academic_year_id == assignment.academic_year_id,
            StudentClass.enrollment_status == "enrolled",
            Student.student_id != student.student_id,
        )
        .all()
    )
    classmates = [
        {
            "student_id": str(classmate.student_id),
            "full_name": _student_full_name(classmate),
            "gender": classmate.gender,
            "avatar_initial": ((classmate.first_name or "").strip()[:1] or "?").upper(),
        }
        for classmate in rows
    ]
    classmates.sort(key=lambda item: item["full_name"].casefold())

    return {
        "class_id": class_.class_id,
        "section_name": class_.section_name,
        "classmates": classmates,
    }


@router.get("/me/subjects")
def get_my_subjects(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Returns all subjects enrolled by the currently authenticated student,
    including the assigned teacher and active quarter for each subject load.

    Reusable for both mobile and web clients.
    """
    user_id = current_user["sub"]

    # Resolve student from user account
    student = (
        db.query(Student)
        .filter(Student.user_id == user_id)
        .first()
    )
    if not student:
        raise HTTPException(status_code=404, detail="Student profile not found")

    # select_from(Student) makes the left-most table explicit so SQLAlchemy
    # doesn't get confused by the multiple column sources in db.query().
    rows = (
        db.query(
            SubjectLoad.subject_load_id,
            SubjectLoad.class_id,
            Subject.subject_id,
            Subject.subject_name,
            Subject.subject_codename,
            func.concat(AcademicStaff.first_name, " ", AcademicStaff.last_name).label("teacher_name"),
            AcademicPeriod.academic_period_id,
            AcademicPeriod.period_name,
            AcademicPeriod.is_active.label("is_current_quarter"),
            Class.section_name,
            AcademicYear.year_label,
        )
        .select_from(Student)
        .join(StudentClass, StudentClass.student_id == Student.student_id)
        .join(Class, Class.class_id == StudentClass.class_id)
        .join(SubjectLoad, SubjectLoad.class_id == Class.class_id)
        .join(Subject, Subject.subject_id == SubjectLoad.subject_id)
        .join(AcademicStaff, AcademicStaff.staff_id == SubjectLoad.staff_id)
        .join(AcademicPeriod, AcademicPeriod.academic_period_id == SubjectLoad.academic_period_id)
        .join(AcademicYear, AcademicYear.academic_year_id == AcademicPeriod.academic_year_id)
        .filter(
            Student.student_id == student.student_id,
            StudentClass.enrollment_status == "enrolled",
            SubjectLoad.status == "active",
        )
        .all()
    )

    return [
        {
            "subject_load_id":    row.subject_load_id,
            "class_id":           row.class_id,
            "subject_id":         row.subject_id,
            "subject_name":       row.subject_name,
            "subject_codename":   row.subject_codename,
            "teacher_name":       row.teacher_name,
            "period_id":          row.academic_period_id,
            "period_name":        row.period_name,
            "is_current_quarter": row.is_current_quarter,
            "section_name":       row.section_name,
            "year_label":         row.year_label,
        }
        for row in rows
    ]


@router.get("/me/active-quarter")
def get_active_quarter(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user["sub"]

    student = (
        db.query(Student)
        .filter(Student.user_id == user_id)
        .first()
    )

    row = None

    # Only attempt the class-specific lookup for students
    if student:
        row = (
            db.query(
                AcademicPeriod.academic_period_id,
                AcademicPeriod.period_name,
                AcademicYear.year_label,
            )
            .select_from(Student)
            .join(StudentClass, StudentClass.student_id == Student.student_id)
            .join(Class, Class.class_id == StudentClass.class_id)
            .join(SubjectLoad, SubjectLoad.class_id == Class.class_id)
            .join(AcademicPeriod, AcademicPeriod.academic_period_id == SubjectLoad.academic_period_id)
            .join(AcademicYear, AcademicYear.academic_year_id == AcademicPeriod.academic_year_id)
            .filter(
                Student.student_id == student.student_id,
                StudentClass.enrollment_status == "enrolled",
                AcademicPeriod.is_active == True,
            )
            .first()
        )

    # Global fallback — used for teachers, or students with no active class period
    if not row:
        row = (
            db.query(
                AcademicPeriod.academic_period_id,
                AcademicPeriod.period_name,
                AcademicYear.year_label,
            )
            .select_from(AcademicPeriod)
            .join(AcademicYear, AcademicYear.academic_year_id == AcademicPeriod.academic_year_id)
            .filter(AcademicPeriod.is_active == True)
            .first()
        )

    if not row:
        return {"period_id": None, "period_name": "No active quarter", "year_label": ""}

    return {
        "period_id":   row.academic_period_id,
        "period_name": row.period_name,
        "year_label":  row.year_label,
    }
