from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.StudentCLass import StudentClass
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.classwork.ClassworkShared import assignment_is_available, assignment_is_locked


def user_id_from_claims(current_user: dict):
    value = current_user.get("sub")
    try:
        return UUID(value) if isinstance(value, str) else value
    except ValueError:
        return value


def authorize_classwork_access(
    cw: Classwork,
    current_user: dict,
    db: Session,
    class_id: Optional[int] = None,
) -> None:
    role = current_user.get("role")
    user_id = user_id_from_claims(current_user)
    if role == "admin":
        return
    if role == "teacher":
        staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == user_id).first()
        if staff and cw.created_by_staff_id == staff.staff_id:
            return
    if cw.is_archived:
        raise HTTPException(status_code=404, detail="Classwork not found")
    if role == "student":
        student = db.query(Student).filter(Student.user_id == user_id).first()
        if student:
            query = (
                db.query(ClassworkAssignment)
                .join(StudentClass, StudentClass.class_id == ClassworkAssignment.class_id)
                .filter(
                    ClassworkAssignment.classwork_id == cw.classwork_id,
                    StudentClass.student_id == student.student_id,
                    StudentClass.enrollment_status == "enrolled",
                )
            )
            if class_id is not None:
                query = query.filter(ClassworkAssignment.class_id == class_id)
            if any(
                assignment_is_available(assignment)
                and not assignment_is_locked(assignment)
                for assignment in query.all()
            ):
                return
    raise HTTPException(status_code=403, detail="Access denied")


def authorize_assignment_access(
    assignment: ClassworkAssignment,
    cw: Classwork,
    current_user: dict,
    db: Session,
) -> None:
    role = current_user.get("role")
    user_id = user_id_from_claims(current_user)
    if role == "teacher":
        staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == user_id).first()
        if staff and cw.created_by_staff_id == staff.staff_id:
            return
    if cw.is_archived:
        raise HTTPException(status_code=404, detail="Classwork not found")
    if role == "student" and assignment_is_available(assignment):
        student = db.query(Student).filter(Student.user_id == user_id).first()
        if student and db.query(StudentClass).filter(
            StudentClass.student_id == student.student_id,
            StudentClass.class_id == assignment.class_id,
            StudentClass.enrollment_status == "enrolled",
        ).first():
            if assignment_is_locked(assignment):
                raise HTTPException(status_code=403, detail="This assignment is locked")
            return
    raise HTTPException(status_code=403, detail="Access denied")


def classwork_has_submissions(db: Session, classwork_id: int) -> bool:
    """Classwork can only be archived while no student work is turned in."""
    return (
        db.query(StudentSubmission)
        .join(
            ClassworkAssignment,
            ClassworkAssignment.classwork_assignment_id == StudentSubmission.classwork_assignment_id,
        )
        .filter(
            ClassworkAssignment.classwork_id == classwork_id,
            StudentSubmission.status.in_(("submitted", "late", "graded")),
        )
        .first()
        is not None
    )
