from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, joinedload

from app.core.ExternalUrl import validate_external_link_title, validate_external_url
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.Student import Student
from app.models.suggestion.StudentSuggestion import StudentSuggestion
from app.models.suggestion.SuggestionClasswork import SuggestionClasswork
from app.schemas.Suggestion import (
    ManualSuggestionCreate,
    SuggestionClassworkResponse,
    SuggestionListResponse,
    SuggestionResourceSummary,
    SuggestionResponse,
)
from app.services.classwork.ClassworkShared import assignment_is_available, assignment_is_locked
from app.services.academic.AcademicLifecycleService import resolve_active_academic_period


ACTIVE_STATUS = "ACTIVE"
DRAFT_STATUS = "DRAFT"
COMPLETED_STATUS = "COMPLETED"
DISMISSED_STATUS = "DISMISSED"
ARCHIVED_STATUS = "ARCHIVED"


def _student_class_ids_for_teacher_subject(
    db: Session, staff_id: str, student_id: UUID, subject_id: int, period: AcademicPeriod,
) -> list[int]:
    rows = (
        db.query(StudentClass.class_id)
        .join(Class, Class.class_id == StudentClass.class_id)
        .join(
            SubjectLoad,
            SubjectLoad.class_id == StudentClass.class_id,
        )
        .filter(
            StudentClass.student_id == student_id,
            StudentClass.enrollment_status == "enrolled",
            StudentClass.academic_year_id == period.academic_year_id,
            Class.academic_year_id == period.academic_year_id,
            SubjectLoad.staff_id == staff_id,
            SubjectLoad.subject_id == subject_id,
            SubjectLoad.academic_period_id == period.academic_period_id,
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(["active", "published"]),
        )
        .all()
    )
    return sorted({row[0] for row in rows})


def _ensure_teacher_student_scope(
    db: Session, staff_id: str, student_id: UUID, subject_id: int,
) -> tuple[AcademicPeriod, list[int]]:
    student = db.query(Student).filter(Student.student_id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    period = resolve_active_academic_period(db)
    class_ids = _student_class_ids_for_teacher_subject(db, staff_id, student_id, subject_id, period)
    if not class_ids:
        raise HTTPException(status_code=403, detail="Student is not in your active class/subject scope")
    return period, class_ids


def _get_suggestion_for_teacher(db: Session, suggestion_id: int, staff_id: str) -> StudentSuggestion:
    suggestion = _suggestion_query(db).filter(StudentSuggestion.student_suggestion_id == suggestion_id).first()
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    period, class_ids = _ensure_teacher_student_scope(db, staff_id, suggestion.student_id, suggestion.subject_id)
    if (
        suggestion.created_by_staff_id != staff_id
        or suggestion.origin_academic_period_id != period.academic_period_id
        or suggestion.origin_class_id not in class_ids
    ):
        raise HTTPException(status_code=403, detail="Only the current suggestion creator may manage it")
    return suggestion


def _get_suggestion_for_student(db: Session, suggestion_id: int, student_id: UUID) -> StudentSuggestion:
    suggestion = _suggestion_query(db).filter(
        StudentSuggestion.student_suggestion_id == suggestion_id,
        StudentSuggestion.student_id == student_id,
        StudentSuggestion.status != DRAFT_STATUS,
    ).first()
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    return suggestion


def _suggestion_query(db: Session):
    return db.query(StudentSuggestion).options(
        joinedload(StudentSuggestion.classwork_link).joinedload(SuggestionClasswork.classwork_assignment).joinedload(
            ClassworkAssignment.classwork
        ),
        joinedload(StudentSuggestion.lesson),
        joinedload(StudentSuggestion.origin_period).joinedload(AcademicPeriod.academic_year),
    )


def _validate_lesson_resource(
    db: Session,
    staff_id: str,
    body: ManualSuggestionCreate,
    scoped_class_ids: list[int],
) -> Lesson:
    if body.lesson_id is None or body.classwork_assignment_id is not None:
        raise HTTPException(status_code=400, detail="Lesson suggestions require lesson_id only")
    lesson = db.query(Lesson).filter(
        Lesson.lesson_id == body.lesson_id,
        Lesson.subject_id == body.subject_id,
        Lesson.is_archived == False,
    ).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson resource not found")
    assigned = db.query(LessonAssignment).filter(
        LessonAssignment.lesson_id == lesson.lesson_id,
        LessonAssignment.class_id.in_(scoped_class_ids),
    ).first()
    if not assigned:
        raise HTTPException(status_code=403, detail="Lesson is not assigned to this student class")
    if lesson.created_by_staff_id != staff_id and not db.query(SubjectLoad).filter(
        SubjectLoad.staff_id == staff_id,
        SubjectLoad.subject_id == lesson.subject_id,
        SubjectLoad.class_id.in_(scoped_class_ids),
        SubjectLoad.is_active_version.is_(True),
        SubjectLoad.status.in_(["active", "published"]),
    ).first():
        raise HTTPException(status_code=403, detail="You cannot suggest this lesson")
    return lesson


def _validate_classwork_resource(
    db: Session,
    body: ManualSuggestionCreate,
    scoped_class_ids: list[int],
) -> ClassworkAssignment:
    if body.classwork_assignment_id is None or body.lesson_id is not None:
        raise HTTPException(status_code=400, detail="Classwork suggestions require classwork_assignment_id only")
    assignment = (
        db.query(ClassworkAssignment)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .filter(
            ClassworkAssignment.classwork_assignment_id == body.classwork_assignment_id,
            ClassworkAssignment.class_id.in_(scoped_class_ids),
            Classwork.subject_id == body.subject_id,
            Classwork.is_archived == False,
        )
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="Classwork resource not found")
    return assignment


def _ensure_no_duplicate_lesson(db: Session, student_id: UUID, subject_id: int, lesson_id: int) -> None:
    duplicate = db.query(StudentSuggestion).filter(
        StudentSuggestion.student_id == student_id,
        StudentSuggestion.subject_id == subject_id,
        StudentSuggestion.resource_type == "LESSON",
        StudentSuggestion.lesson_id == lesson_id,
        StudentSuggestion.status == ACTIVE_STATUS,
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="This lesson is already actively suggested to the student")


def _ensure_no_duplicate_classwork(db: Session, student_id: UUID, subject_id: int, assignment_id: int) -> None:
    duplicate = (
        db.query(StudentSuggestion)
        .join(SuggestionClasswork, SuggestionClasswork.student_suggestion_id == StudentSuggestion.student_suggestion_id)
        .filter(
            StudentSuggestion.student_id == student_id,
            StudentSuggestion.subject_id == subject_id,
            StudentSuggestion.resource_type == "CLASSWORK",
            StudentSuggestion.status == ACTIVE_STATUS,
            SuggestionClasswork.classwork_assignment_id == assignment_id,
        )
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="This classwork is already actively suggested to the student")


def _ensure_no_duplicate_link(db: Session, student_id: UUID, subject_id: int, url: str) -> None:
    duplicate = db.query(StudentSuggestion.student_suggestion_id).filter(
        StudentSuggestion.student_id == student_id,
        StudentSuggestion.subject_id == subject_id,
        StudentSuggestion.resource_type == "LINK",
        StudentSuggestion.external_url == url,
        StudentSuggestion.status == ACTIVE_STATUS,
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="This link is already actively suggested to the student")


def create_manual_suggestion(db: Session, staff_id: str, body: ManualSuggestionCreate) -> SuggestionResponse:
    period, scoped_class_ids = _ensure_teacher_student_scope(db, staff_id, body.student_id, body.subject_id)
    if len(scoped_class_ids) != 1:
        raise HTTPException(status_code=409, detail="Suggestion origin is ambiguous across current classes")
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Suggestion title is required")
    if body.resource_type != "LINK" and body.external_url is not None:
        raise HTTPException(status_code=400, detail="Only link suggestions may include external_url")

    suggestion = StudentSuggestion(
        suggestion_type="MANUAL",
        resource_type=body.resource_type,
        title=title,
        description=(body.description or "").strip() or None,
        priority=body.priority,
        status=ACTIVE_STATUS,
        student_id=body.student_id,
        subject_id=body.subject_id,
        created_by_staff_id=staff_id,
        origin_class_id=scoped_class_ids[0],
        origin_academic_period_id=period.academic_period_id,
    )

    if body.resource_type == "LESSON":
        lesson = _validate_lesson_resource(db, staff_id, body, scoped_class_ids)
        _ensure_no_duplicate_lesson(db, body.student_id, body.subject_id, lesson.lesson_id)
        suggestion.lesson_id = lesson.lesson_id
        suggestion.resource_links = {
            "resource_type": "LESSON",
            "lesson_id": lesson.lesson_id,
            "title": lesson.title,
        }
    elif body.resource_type == "CLASSWORK":
        assignment = _validate_classwork_resource(db, body, scoped_class_ids)
        _ensure_no_duplicate_classwork(db, body.student_id, body.subject_id, assignment.classwork_assignment_id)
        suggestion.resource_links = {
            "resource_type": "CLASSWORK",
            "classwork_assignment_id": assignment.classwork_assignment_id,
            "classwork_id": assignment.classwork_id,
            "title": assignment.classwork.title,
        }
        suggestion.classwork_link = SuggestionClasswork(
            classwork_assignment_id=assignment.classwork_assignment_id,
        )
    else:
        if body.lesson_id is not None or body.classwork_assignment_id is not None:
            raise HTTPException(status_code=400, detail="Link suggestions cannot reference a lesson or classwork")
        try:
            suggestion.external_url = validate_external_url(body.external_url)
            suggestion.title = validate_external_link_title(title) or title
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None
        _ensure_no_duplicate_link(db, body.student_id, body.subject_id, suggestion.external_url)

    db.add(suggestion)
    db.commit()
    db.refresh(suggestion)
    return build_suggestion_response(db, suggestion, current_period_id=period.academic_period_id, can_manage=True)


def list_teacher_suggestions(
    db: Session,
    staff_id: str | None,
    class_id: Optional[int] = None,
    subject_id: Optional[int] = None,
    student_id: Optional[UUID] = None,
    status: Optional[str] = None,
    is_admin: bool = False,
) -> SuggestionListResponse:
    query = _suggestion_query(db)
    current_period = None
    manageable: set[tuple[UUID, int, int]] = set()

    if not is_admin:
        if not staff_id:
            return SuggestionListResponse()
        current_period = resolve_active_academic_period(db)
        scope = db.query(StudentClass.student_id).join(
            Class, Class.class_id == StudentClass.class_id,
        ).join(
            SubjectLoad, SubjectLoad.class_id == StudentClass.class_id,
        ).filter(
            StudentClass.student_id == StudentSuggestion.student_id,
            StudentClass.enrollment_status == "enrolled",
            StudentClass.academic_year_id == current_period.academic_year_id,
            Class.academic_year_id == current_period.academic_year_id,
            SubjectLoad.staff_id == staff_id,
            SubjectLoad.subject_id == StudentSuggestion.subject_id,
            SubjectLoad.academic_period_id == current_period.academic_period_id,
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(["active", "published"]),
        )
        if class_id is not None:
            scope = scope.filter(SubjectLoad.class_id == class_id)
        if subject_id is not None:
            scope = scope.filter(SubjectLoad.subject_id == subject_id)
        query = query.join(
            AcademicPeriod,
            AcademicPeriod.academic_period_id == StudentSuggestion.origin_academic_period_id,
        ).join(AcademicYear, AcademicYear.academic_year_id == AcademicPeriod.academic_year_id)
        query = query.filter(
            scope.exists(),
            StudentSuggestion.origin_class_id.isnot(None),
            or_(
                AcademicPeriod.academic_period_id == current_period.academic_period_id,
                AcademicYear.end_date < current_period.academic_year.start_date,
                and_(
                    AcademicPeriod.academic_year_id == current_period.academic_year_id,
                    AcademicPeriod.period_sequence < current_period.period_sequence,
                    AcademicPeriod.end_date < current_period.start_date,
                ),
            ),
            or_(
                StudentSuggestion.status != DRAFT_STATUS,
                and_(
                    AcademicPeriod.academic_period_id == current_period.academic_period_id,
                    StudentSuggestion.created_by_staff_id == staff_id,
                ),
            ),
        )
        manageable = {
            (row.student_id, row.subject_id, row.class_id)
            for row in db.query(
                StudentClass.student_id, SubjectLoad.subject_id, StudentClass.class_id,
            ).join(Class, Class.class_id == StudentClass.class_id).join(
                SubjectLoad, SubjectLoad.class_id == StudentClass.class_id,
            ).filter(
                StudentClass.enrollment_status == "enrolled",
                StudentClass.academic_year_id == current_period.academic_year_id,
                Class.academic_year_id == current_period.academic_year_id,
                SubjectLoad.staff_id == staff_id,
                SubjectLoad.academic_period_id == current_period.academic_period_id,
                SubjectLoad.is_active_version.is_(True),
                SubjectLoad.status.in_(["active", "published"]),
            ).all()
        }
    else:
        if subject_id is not None:
            query = query.filter(StudentSuggestion.subject_id == subject_id)
        if class_id is not None:
            scoped_students = {
                row[0]
                for row in db.query(StudentClass.student_id)
                .filter(
                    StudentClass.class_id == class_id,
                    StudentClass.enrollment_status == "enrolled",
                )
                .all()
            }
            query = query.filter(StudentSuggestion.student_id.in_(scoped_students))

    if student_id is not None:
        query = query.filter(StudentSuggestion.student_id == student_id)
    if status is not None:
        query = query.filter(StudentSuggestion.status == status)

    suggestions = query.order_by(StudentSuggestion.created_at.desc()).all()
    lesson_destinations: dict[int, int] = {}
    if staff_id and current_period and not is_admin:
        # The subject page shows only lessons authorized for its class and
        # selected period. Reuse that reader, caching per class/subject rather
        # than assuming the suggestion's historical class remains accessible.
        from app.services.lesson.LessonService import teacher_lessons_for_class_subject

        lesson_suggestions = [item for item in suggestions if item.resource_type == "LESSON" and item.lesson_id]
        candidate_scopes = {
            (scoped_class_id, item.subject_id)
            for item in lesson_suggestions
            for scoped_student_id, scoped_subject_id, scoped_class_id in manageable
            if scoped_student_id == item.student_id and scoped_subject_id == item.subject_id
            and (class_id is None or scoped_class_id == class_id)
        }
        visible_lessons: dict[tuple[int, int], set[int]] = {}
        for scoped_class_id, scoped_subject_id in candidate_scopes:
            try:
                visible_lessons[(scoped_class_id, scoped_subject_id)] = {
                    lesson.lesson_id for lesson in teacher_lessons_for_class_subject(
                        scoped_class_id, scoped_subject_id, staff_id, db,
                        academic_period_id=current_period.academic_period_id,
                        academic_year_id=current_period.academic_year_id,
                    )
                }
            except HTTPException:
                visible_lessons[(scoped_class_id, scoped_subject_id)] = set()
        for item in lesson_suggestions:
            matches = [
                scoped_class_id
                for (scoped_class_id, scoped_subject_id), lesson_ids in visible_lessons.items()
                if scoped_subject_id == item.subject_id and item.lesson_id in lesson_ids
                and (item.student_id, item.subject_id, scoped_class_id) in manageable
            ]
            if len(matches) == 1:
                lesson_destinations[item.student_suggestion_id] = matches[0]

    responses = []
    for suggestion in suggestions:
        response = build_suggestion_response(
            db, suggestion,
            current_period_id=current_period.academic_period_id if current_period else None,
            can_manage=bool(
                staff_id and current_period
                and suggestion.created_by_staff_id == staff_id
                and suggestion.origin_academic_period_id == current_period.academic_period_id
                and (suggestion.student_id, suggestion.subject_id, suggestion.origin_class_id) in manageable
            ),
        )
        if not is_admin and suggestion.resource_type == "LESSON":
            destination = lesson_destinations.get(suggestion.student_suggestion_id)
            response.resource.class_id = destination
            if destination is None:
                response.resource.is_available = False
                response.resource.unavailable_reason = (
                    response.resource.unavailable_reason
                    or "Lesson is not available in an authorized current class"
                )
        responses.append(response)
    return SuggestionListResponse(suggestions=responses)


def dismiss_teacher_suggestion(db: Session, staff_id: str, suggestion_id: int) -> SuggestionResponse:
    suggestion = _get_suggestion_for_teacher(db, suggestion_id, staff_id)
    if suggestion.status != ACTIVE_STATUS:
        raise HTTPException(status_code=400, detail="Only active suggestions can be dismissed")
    suggestion.status = DISMISSED_STATUS
    db.commit()
    db.refresh(suggestion)
    return build_suggestion_response(db, suggestion, current_period_id=suggestion.origin_academic_period_id, can_manage=True)


def archive_teacher_suggestion(db: Session, staff_id: str, suggestion_id: int) -> SuggestionResponse:
    suggestion = _get_suggestion_for_teacher(db, suggestion_id, staff_id)
    if suggestion.status not in {COMPLETED_STATUS, DISMISSED_STATUS}:
        raise HTTPException(status_code=400, detail="Only completed or dismissed suggestions can be archived")
    suggestion.status = ARCHIVED_STATUS
    db.commit()
    db.refresh(suggestion)
    return build_suggestion_response(db, suggestion, current_period_id=suggestion.origin_academic_period_id, can_manage=True)


def approve_teacher_suggestion(db: Session, staff_id: str, suggestion_id: int) -> SuggestionResponse:
    suggestion = _get_suggestion_for_teacher(db, suggestion_id, staff_id)
    if suggestion.status != DRAFT_STATUS:
        raise HTTPException(status_code=400, detail="Only draft suggestions can be approved")
    if suggestion.resource_type == "LESSON" and suggestion.lesson_id is not None:
        _ensure_no_duplicate_lesson(db, suggestion.student_id, suggestion.subject_id, suggestion.lesson_id)
    if suggestion.resource_type == "CLASSWORK" and suggestion.classwork_link is not None:
        _ensure_no_duplicate_classwork(
            db,
            suggestion.student_id,
            suggestion.subject_id,
            suggestion.classwork_link.classwork_assignment_id,
        )
    suggestion.status = ACTIVE_STATUS
    db.commit()
    db.refresh(suggestion)
    return build_suggestion_response(db, suggestion, current_period_id=suggestion.origin_academic_period_id, can_manage=True)


def list_student_suggestions(db: Session, student: Student, status: Optional[str] = None) -> SuggestionListResponse:
    query = _suggestion_query(db).filter(
        StudentSuggestion.student_id == student.student_id,
        StudentSuggestion.status != DRAFT_STATUS,
    )
    if status is not None:
        query = query.filter(StudentSuggestion.status == status)
    suggestions = query.order_by(StudentSuggestion.created_at.desc()).all()
    current_period_id = _student_current_period_id(db)
    return SuggestionListResponse(
        suggestions=[build_suggestion_response(db, suggestion, student=student,
            current_period_id=current_period_id) for suggestion in suggestions]
    )


def get_student_suggestion(db: Session, student: Student, suggestion_id: int) -> SuggestionResponse:
    suggestion = _get_suggestion_for_student(db, suggestion_id, student.student_id)
    return _student_response(db, student, suggestion)


def mark_student_suggestion_viewed(db: Session, student: Student, suggestion_id: int) -> SuggestionResponse:
    suggestion = _get_suggestion_for_student(db, suggestion_id, student.student_id)
    if not suggestion.is_viewed:
        suggestion.is_viewed = True
        suggestion.viewed_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(suggestion)
    return _student_response(db, student, suggestion)


def complete_student_suggestion(db: Session, student: Student, suggestion_id: int) -> SuggestionResponse:
    suggestion = _get_suggestion_for_student(db, suggestion_id, student.student_id)
    if suggestion.status != ACTIVE_STATUS:
        raise HTTPException(status_code=400, detail="Only active suggestions can be completed")
    resource = build_resource_summary(db, suggestion, student=student)
    if not resource.is_available:
        raise HTTPException(status_code=403, detail=resource.unavailable_reason or "Suggested resource is unavailable")

    suggestion.status = COMPLETED_STATUS
    suggestion.is_viewed = True
    suggestion.viewed_at = suggestion.viewed_at or datetime.now(timezone.utc)
    if suggestion.classwork_link:
        suggestion.classwork_link.is_completed = True
        suggestion.classwork_link.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(suggestion)
    return _student_response(db, student, suggestion)


def _student_response(db: Session, student: Student, suggestion: StudentSuggestion) -> SuggestionResponse:
    current_period_id = _student_current_period_id(db)
    return build_suggestion_response(db, suggestion, student=student,
        current_period_id=current_period_id)


def _student_current_period_id(db: Session) -> int | None:
    # Student-owned history remains readable while the school has no active
    # period or is correcting an inconsistent lifecycle configuration.
    try:
        current = resolve_active_academic_period(db, required=False)
    except HTTPException:
        return None
    return current.academic_period_id if current else None


def _student_enrolled_class_ids(db: Session, student: Student) -> set[int]:
    return {
        row[0]
        for row in db.query(StudentClass.class_id).filter(
            StudentClass.student_id == student.student_id,
            StudentClass.enrollment_status == "enrolled",
        ).all()
    }


def _resource_unavailable(reason: str, suggestion: StudentSuggestion) -> SuggestionResourceSummary:
    return SuggestionResourceSummary(
        resource_type=suggestion.resource_type,
        title=suggestion.title,
        subject_id=suggestion.subject_id,
        is_available=False,
        unavailable_reason=reason,
        lesson_id=suggestion.lesson_id,
    )


def build_resource_summary(
    db: Session,
    suggestion: StudentSuggestion,
    student: Optional[Student] = None,
) -> SuggestionResourceSummary:
    if suggestion.resource_type == "LINK":
        try:
            url = validate_external_url(suggestion.external_url)
        except ValueError:
            return _resource_unavailable("External resource link is invalid", suggestion)
        return SuggestionResourceSummary(
            resource_type="LINK",
            title=suggestion.title,
            subject_id=suggestion.subject_id,
            is_available=True,
            external_url=url,
        )
    if suggestion.resource_type == "LESSON":
        lesson = suggestion.lesson or db.query(Lesson).filter(Lesson.lesson_id == suggestion.lesson_id).first()
        if not lesson:
            return _resource_unavailable("Lesson resource is no longer available", suggestion)
        available = not lesson.is_archived
        reason = None if available else "Lesson resource is archived"
        assigned_class_id = None
        if student:
            enrolled_class_ids = _student_enrolled_class_ids(db, student)
            assignment = db.query(LessonAssignment).filter(
                LessonAssignment.lesson_id == lesson.lesson_id,
                LessonAssignment.class_id.in_(enrolled_class_ids),
                LessonAssignment.is_published == True,
            ).first()
            available = available and bool(lesson.is_published and assignment)
            reason = None if available else "Lesson resource is not available to this student"
            assigned_class_id = assignment.class_id if assignment else None
        return SuggestionResourceSummary(
            resource_type="LESSON",
            title=lesson.title,
            subject_id=lesson.subject_id,
            lesson_id=lesson.lesson_id,
            class_id=assigned_class_id,
            is_available=available,
            unavailable_reason=reason,
        )

    link = suggestion.classwork_link
    assignment = link.classwork_assignment if link else None
    if not assignment:
        return _resource_unavailable("Classwork resource is no longer available", suggestion)
    classwork = assignment.classwork
    available = bool(classwork and not classwork.is_archived)
    reason = None if available else "Classwork resource is archived"
    if student:
        enrolled_class_ids = _student_enrolled_class_ids(db, student)
        available = available and assignment.class_id in enrolled_class_ids and assignment_is_available(assignment)
        if available and assignment_is_locked(assignment):
            available = False
            reason = "Classwork resource is locked"
        elif not available:
            reason = "Classwork resource is not available to this student"
    return SuggestionResourceSummary(
        resource_type="CLASSWORK",
        title=classwork.title if classwork else suggestion.title,
        subject_id=classwork.subject_id if classwork else suggestion.subject_id,
        is_available=available,
        unavailable_reason=reason,
        classwork_id=assignment.classwork_id,
        classwork_assignment_id=assignment.classwork_assignment_id,
        classwork_type=classwork.classwork_type if classwork else None,
        class_id=assignment.class_id,
    )


def _float_or_none(value: Decimal | None) -> float | None:
    return float(value) if value is not None else None


def build_suggestion_response(
    db: Session,
    suggestion: StudentSuggestion,
    student: Optional[Student] = None,
    current_period_id: int | None = None,
    can_manage: bool = False,
) -> SuggestionResponse:
    classwork_link = None
    if suggestion.classwork_link:
        link = suggestion.classwork_link
        classwork_link = SuggestionClassworkResponse(
            suggestion_classwork_id=link.suggestion_classwork_id,
            classwork_assignment_id=link.classwork_assignment_id,
            is_completed=link.is_completed,
            completed_at=link.completed_at,
            score_before=_float_or_none(link.score_before),
            score_after=_float_or_none(link.score_after),
        )
    return SuggestionResponse(
        student_suggestion_id=suggestion.student_suggestion_id,
        suggestion_type=suggestion.suggestion_type,
        resource_type=suggestion.resource_type,
        title=suggestion.title,
        description=suggestion.description,
        priority=suggestion.priority,
        status=suggestion.status,
        is_viewed=suggestion.is_viewed,
        viewed_at=suggestion.viewed_at,
        created_at=suggestion.created_at,
        student_id=suggestion.student_id,
        subject_id=suggestion.subject_id,
        lesson_id=suggestion.lesson_id,
        created_by_staff_id=suggestion.created_by_staff_id,
        origin_class_id=suggestion.origin_class_id,
        origin_academic_period_id=suggestion.origin_academic_period_id,
        origin_period_label=(
            f"{suggestion.origin_period.academic_year.year_label} · {suggestion.origin_period.period_name}"
            if suggestion.origin_period is not None else "Unknown period"
        ),
        is_historical=(
            suggestion.origin_academic_period_id is not None
            and suggestion.origin_academic_period_id != current_period_id
        ),
        can_manage=can_manage,
        resource=build_resource_summary(db, suggestion, student=student),
        classwork_link=classwork_link,
        source_metrics=(suggestion.resource_links or {}).get("source_metrics") if suggestion.resource_links else None,
    )
