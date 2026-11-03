from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.StudentCLass import StudentClass
from app.models.people.Student import Student
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.services.academic.ContentAuthorizationService import (
    authorize_teacher_content,
    resolve_content_staff_id,
)

# SHARED LESSON RULES
# Keep common lesson ownership and enrollment checks out of HTTP route handlers.


def ensure_teacher_subject(db: Session, staff_id: str, subject_id: int) -> None:
    from app.services.academic.SubjectLoadAuthorizationService import (
        SubjectLoadAuthorizationService,
        AcademicContextState,
    )
    loads = db.query(SubjectLoad).filter(
        SubjectLoad.staff_id == staff_id,
        SubjectLoad.subject_id == subject_id,
        SubjectLoad.is_active_version.is_(True),
        SubjectLoad.status.in_(["active", "published"]),
    ).all()
    if not loads:
        raise HTTPException(status_code=403, detail="You are not assigned to this subject")

    has_active_load = False
    for load in loads:
        period = db.get(AcademicPeriod, load.academic_period_id) if load.academic_period_id else None
        class_obj = db.get(Class, load.class_id) if load.class_id else None
        year_id = (
            period.academic_year_id
            if period is not None and period.academic_year_id is not None
            else (class_obj.academic_year_id if class_obj is not None else None)
        )
        year_obj = db.get(AcademicYear, year_id) if year_id is not None else None
        if year_obj is not None:
            state = SubjectLoadAuthorizationService.classify_academic_year(db, year_obj)
            if state == AcademicContextState.CURRENT:
                has_active_load = True
                break
        else:
            has_active_load = True
            break

    if not has_active_load:
        all_historical = all(
            SubjectLoadAuthorizationService.classify_academic_year(
                db,
                db.get(
                    AcademicYear,
                    (db.get(AcademicPeriod, l.academic_period_id).academic_year_id
                     if l.academic_period_id and db.get(AcademicPeriod, l.academic_period_id)
                     else (db.get(Class, l.class_id).academic_year_id if l.class_id and db.get(Class, l.class_id) else None)),
                ),
            ) == AcademicContextState.HISTORICAL
            for l in loads
        )
        if all_historical:
            raise HTTPException(
                status_code=403,
                detail="Academic year is closed. Historical records are read-only.",
            )
        raise HTTPException(
            status_code=403,
            detail="Academic year is not currently active. Records are read-only.",
        )


def ensure_teacher_class_subject(
    db: Session,
    staff_id: str,
    class_id: int,
    subject_id: int,
    *,
    read_only: bool = False,
    academic_period_id: int | None = None,
) -> None:
    """Require active class/subject authority, retaining substitute/view-only reads."""
    from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService
    from app.services.academic.AcademicYearService import is_academic_year_authorized

    class_obj = db.get(Class, class_id)
    if not class_obj:
        raise HTTPException(status_code=404, detail="Class not found")

    if class_obj.academic_year_id is not None:
        if not is_academic_year_authorized(db, class_obj.academic_year_id, role="teacher", staff_id=staff_id):
            raise HTTPException(
                status_code=403,
                detail="Not authorized to access this academic year",
            )

    if not read_only:
        SubjectLoadAuthorizationService.assert_context_writable(
            db,
            class_id=class_id,
            academic_period_id=academic_period_id,
        )

    if read_only:
        if academic_period_id is not None:
            read_scopes = ((class_id, subject_id, academic_period_id),)
        else:
            periods = (
                db.query(AcademicPeriod.academic_period_id)
                .join(Class, Class.academic_year_id == AcademicPeriod.academic_year_id)
                .filter(Class.class_id == class_id)
                .all()
            )
            read_scopes = ((class_id, subject_id, period_id) for (period_id,) in periods)

        authorize_teacher_content(
            db,
            staff_id=staff_id,
            owner_staff_id=None,
            detail="Lesson not found",
            read_scopes=read_scopes,
        )
        return
    load = db.query(SubjectLoad).filter(
        SubjectLoad.class_id == class_id,
        SubjectLoad.subject_id == subject_id,
        SubjectLoad.is_active_version.is_(True),
        SubjectLoad.status.in_(["active", "published"]),
    ).first()
    if not load:
        raise HTTPException(status_code=403, detail="Not assigned to this class/subject")
    loads = db.query(SubjectLoad).filter(
        SubjectLoad.class_id == class_id,
        SubjectLoad.subject_id == subject_id,
        SubjectLoad.is_active_version.is_(True),
        SubjectLoad.status.in_(["active", "published"]),
    ).all()
    if any(
        SubjectLoadAuthorizationService.can_write(
            db, staff_id, l.class_id, l.subject_id, l.academic_period_id
        )
        for l in loads
    ):
        return
    load = next((l for l in loads if l.staff_id == staff_id), load)
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


def student_has_subject_period(
    db: Session,
    *,
    student_id: str,
    class_id: int,
    subject_id: int,
    academic_period_id: int,
) -> bool:
    """Return whether a selected period is a published student subject scope.

    Enrollment remains the authorization boundary. A missing, wrong-year, or
    unpublished period is an empty subject context rather than a fallback to a
    different term.
    """
    ensure_student_enrolled(db, student_id, class_id)
    return db.query(SubjectLoad.subject_load_id).join(
        Class, Class.class_id == SubjectLoad.class_id
    ).join(
        AcademicPeriod,
        AcademicPeriod.academic_period_id == SubjectLoad.academic_period_id,
    ).join(
        StudentClass,
        (StudentClass.class_id == Class.class_id)
        & (StudentClass.academic_year_id == Class.academic_year_id),
    ).filter(
        StudentClass.student_id == student_id,
        StudentClass.enrollment_status == "enrolled",
        SubjectLoad.class_id == class_id,
        SubjectLoad.subject_id == subject_id,
        SubjectLoad.academic_period_id == academic_period_id,
        SubjectLoad.is_active_version.is_(True),
        SubjectLoad.status.in_(["active", "published"]),
        Class.academic_year_id == AcademicPeriod.academic_year_id,
    ).first() is not None


def get_owned_lesson(db: Session, staff_id: str, lesson_id: int) -> Lesson:
    """Use the shared lesson policy in owner-only mutation mode."""
    lesson = db.query(Lesson).filter(
        Lesson.lesson_id == lesson_id,
    ).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    authorize_lesson_access(db, lesson, staff_id=staff_id, owner_only=True)
    return lesson


def lesson_read_scopes(db: Session, lesson: Lesson, class_id: int | None = None):
    """Lesson assignments carry a class/year, not their own period column."""
    query = (
        db.query(LessonAssignment.class_id, AcademicPeriod.academic_period_id)
        .join(Class, Class.class_id == LessonAssignment.class_id)
        .join(AcademicPeriod, AcademicPeriod.academic_year_id == Class.academic_year_id)
        .filter(LessonAssignment.lesson_id == lesson.lesson_id)
    )
    if class_id is not None:
        query = query.filter(LessonAssignment.class_id == class_id)
    if lesson.competency and lesson.competency.academic_period_id is not None:
        query = query.filter(AcademicPeriod.academic_period_id == lesson.competency.academic_period_id)
    for assigned_class_id, period_id in query.all():
        yield assigned_class_id, lesson.subject_id, period_id


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
        authorize_teacher_content(
            db, staff_id=staff_id, owner_staff_id=lesson.created_by_staff_id,
            detail="Lesson not found", owner_only=True,
        )
        return

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

    if class_id is not None:
        class_obj = db.get(Class, class_id)
        if class_obj and class_obj.academic_year_id is not None:
            from app.services.academic.AcademicYearService import is_academic_year_authorized
            if not is_academic_year_authorized(db, class_obj.academic_year_id, role=role, staff_id=staff_id):
                raise HTTPException(
                    status_code=403,
                    detail="Not authorized to access this academic year",
                )

    if role == "teacher":
        if staff_id is None:
            staff_id = resolve_content_staff_id(db, current_user)
        authorize_teacher_content(
            db, staff_id=staff_id, owner_staff_id=lesson.created_by_staff_id,
            detail="Lesson not found", read_scopes=lesson_read_scopes(db, lesson, class_id),
        )
        return
    if lesson.is_archived:
        raise HTTPException(status_code=404, detail="Lesson not found")
    if role == "student" and lesson.is_published and not lesson.is_locked:
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
