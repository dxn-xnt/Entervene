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
        SubjectLoad.is_active_version.is_(True),
        SubjectLoad.status.in_(["active", "published"]),
    ).first()
    if not load:
        raise HTTPException(status_code=403, detail="You are not assigned to this subject")


def ensure_teacher_class_subject(
    db: Session, staff_id: str, class_id: int, subject_id: int, *, read_only: bool = False
) -> None:
    """Require active class/subject authority, retaining substitute/view-only reads."""
    from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService
    load = db.query(SubjectLoad).filter(
        SubjectLoad.class_id == class_id,
        SubjectLoad.subject_id == subject_id,
        SubjectLoad.is_active_version.is_(True),
        SubjectLoad.status.in_(["active", "published"]),
    ).first()
    if not load:
        raise HTTPException(status_code=403, detail="Not assigned to this class/subject")
    authorize = (
        SubjectLoadAuthorizationService.assert_can_view
        if read_only else SubjectLoadAuthorizationService.assert_can_write
    )
    authorize(
        db, staff_id, load.class_id, load.subject_id, load.academic_period_id
    )


def ensure_student_enrolled(db: Session, student_id: str, class_id: int) -> None:
    enrollment = db.query(StudentClass).filter(
        StudentClass.student_id == student_id,
        StudentClass.class_id == class_id,
        StudentClass.enrollment_status == "enrolled",
    ).first()
    if not enrollment:
        raise HTTPException(status_code=403, detail="Not enrolled in this class")


def get_owned_lesson(db: Session, staff_id: str, lesson_id: int) -> Lesson:
    """Use the shared lesson policy in owner-only mutation mode."""
    lesson = db.query(Lesson).filter(
        Lesson.lesson_id == lesson_id,
    ).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    authorize_lesson_access(db, lesson, staff_id=staff_id, owner_only=True)
    return lesson


def authorize_lesson_access(
    db: Session,
    lesson: Lesson,
    current_user: dict | None = None,
    *,
    staff_id: str | None = None,
    owner_only: bool = False,
    class_id: int | None = None,
) -> None:
    """Central lesson policy for detail, linked-work reads and mutations.

    ``staff_id`` is a staff identity resolved by the route dependency, never a
    client-supplied identifier. Read grants require ownership or an explicit
    lesson assignment with existing load/substitution authority; sharing a
    subject alone is not a grant, including for ownerless legacy lessons.
    Mutation grants remain owner-only (including for admin staff accounts).
    Student and administrator detail-read behavior is unchanged.
    """
    if owner_only:
        if staff_id and lesson.created_by_staff_id == staff_id:
            return
        raise HTTPException(status_code=404, detail="Lesson not found")

    current_user = current_user or {}
    role = current_user.get("role", "teacher" if staff_id is not None else None)
    user_id = current_user.get("sub")
    try:
        from uuid import UUID
        user_uuid = UUID(user_id) if isinstance(user_id, str) else user_id
    except ValueError:
        user_uuid = user_id

    if role == "admin":
        return
    if role == "teacher":
        if staff_id is None:
            staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == user_uuid).first()
            staff_id = staff.staff_id if staff else None
        if staff_id:
            # 1. Creator teacher
            if lesson.created_by_staff_id == staff_id:
                return

            # 2. Explicit class assignment: retain authorized teacher/substitute reads.
            from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService
            assignments_query = db.query(LessonAssignment).filter(LessonAssignment.lesson_id == lesson.lesson_id)
            if class_id is not None:
                assignments_query = assignments_query.filter(LessonAssignment.class_id == class_id)
            assignments = assignments_query.all()
            for asgn in assignments:
                load = db.query(SubjectLoad).filter(
                    SubjectLoad.class_id == asgn.class_id,
                    SubjectLoad.subject_id == lesson.subject_id,
                    SubjectLoad.is_active_version.is_(True),
                    SubjectLoad.status.in_(["active", "published"]),
                ).first()
                if load and SubjectLoadAuthorizationService.can_view(
                    db, staff_id, load.class_id, load.subject_id, load.academic_period_id
                ):
                    return

            # TODO (Future Clone Grant): Hook in here when approved clone grants exist for lessons
        # An unauthorized teacher cannot distinguish an existing ID from a missing one.
        raise HTTPException(status_code=404, detail="Lesson not found")
    if lesson.is_archived:
        raise HTTPException(status_code=404, detail="Lesson not found")
    if role == "student" and lesson.is_published:
        student = db.query(Student).filter(Student.user_id == user_uuid).first()
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
