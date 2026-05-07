from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.db.Session import get_db
from app.api.v1.routes.Auth import get_current_user
from app.models.people.Student import Student
from app.models.people.AcademicStaff import AcademicStaff
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Class_ import Class
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.Subject import Subject
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear

router = APIRouter()


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
    """
    Returns the currently active academic period for the authenticated student's class.
    Falls back to the globally active period if no class-specific one is found.

    Reusable for both mobile and web clients.
    """
    user_id = current_user["sub"]

    student = (
        db.query(Student)
        .filter(Student.user_id == user_id)
        .first()
    )
    if not student:
        raise HTTPException(status_code=404, detail="Student profile not found")

    # Try to find the active period tied to the student's class's subject loads
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

    if not row:
        # Global fallback: any period marked active
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
