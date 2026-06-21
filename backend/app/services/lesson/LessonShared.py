from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.StudentCLass import StudentClass
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student

# SHARED LESSON RULES
# Keep common lesson ownership and enrollment checks out of HTTP route handlers.


def ensure_teacher_subject(db: Session, staff_id: str, subject_id: int) -> None:
    load = db.query(SubjectLoad).filter(
        SubjectLoad.staff_id == staff_id,
        SubjectLoad.subject_id == subject_id,
        SubjectLoad.status == "active",
    ).first()
    if not load:
        raise HTTPException(status_code=403, detail="You are not assigned to this subject")


def ensure_teacher_class_subject(db: Session, staff_id: str, class_id: int, subject_id: int) -> None:
    """Teachers can only manage lessons for active class/subject loads."""
    load = db.query(SubjectLoad).filter(
        SubjectLoad.staff_id == staff_id,
        SubjectLoad.class_id == class_id,
        SubjectLoad.subject_id == subject_id,
        SubjectLoad.status == "active",
    ).first()
    if not load:
        raise HTTPException(status_code=403, detail="Not assigned to this class/subject")


def ensure_student_enrolled(db: Session, student_id: str, class_id: int) -> None:
    enrollment = db.query(StudentClass).filter(
        StudentClass.student_id == student_id,
        StudentClass.class_id == class_id,
        StudentClass.enrollment_status == "enrolled",
    ).first()
    if not enrollment:
        raise HTTPException(status_code=403, detail="Not enrolled in this class")


def get_owned_lesson(db: Session, staff_id: str, lesson_id: int) -> Lesson:
    """Return a teacher-owned lesson or fail with the route's existing message."""
    lesson = db.query(Lesson).filter(
        Lesson.lesson_id == lesson_id,
        Lesson.created_by_staff_id == staff_id,
    ).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found or not yours")
    return lesson


def authorize_lesson_access(db: Session, lesson: Lesson, current_user: dict) -> None:
    """Allow admins, owning teachers, or enrolled students with published lessons."""
    role = current_user.get("role")
    user_id = current_user.get("sub")
    if role == "admin":
        return
    if role == "teacher":
        staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == user_id).first()
        if staff and lesson.created_by_staff_id == staff.staff_id:
            return
    if lesson.is_archived:
        raise HTTPException(status_code=404, detail="Lesson not found")
    if role == "student" and lesson.is_published:
        student = db.query(Student).filter(Student.user_id == user_id).first()
        if student and db.query(LessonAssignment).join(
            StudentClass,
            StudentClass.class_id == LessonAssignment.class_id,
        ).filter(
            LessonAssignment.lesson_id == lesson.lesson_id,
            LessonAssignment.is_published == True,
            StudentClass.student_id == student.student_id,
            StudentClass.enrollment_status == "enrolled",
        ).first():
            return
    raise HTTPException(status_code=403, detail="Access denied")
