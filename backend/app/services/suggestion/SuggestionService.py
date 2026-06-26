from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
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


ACTIVE_STATUS = "ACTIVE"
DRAFT_STATUS = "DRAFT"
COMPLETED_STATUS = "COMPLETED"
DISMISSED_STATUS = "DISMISSED"
ARCHIVED_STATUS = "ARCHIVED"


def _student_class_ids_for_teacher_subject(db: Session, staff_id: str, student_id: UUID, subject_id: int) -> list[int]:
    rows = (
        db.query(StudentClass.class_id)
        .join(
            SubjectLoad,
            SubjectLoad.class_id == StudentClass.class_id,
        )
        .filter(
            StudentClass.student_id == student_id,
            StudentClass.enrollment_status == "enrolled",
            SubjectLoad.staff_id == staff_id,
            SubjectLoad.subject_id == subject_id,
            SubjectLoad.status == "active",
        )
        .all()
    )
    return [row[0] for row in rows]


def _ensure_teacher_student_scope(db: Session, staff_id: str, student_id: UUID, subject_id: int) -> list[int]:
    student = db.query(Student).filter(Student.student_id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    class_ids = _student_class_ids_for_teacher_subject(db, staff_id, student_id, subject_id)
    if not class_ids:
        raise HTTPException(status_code=403, detail="Student is not in your active class/subject scope")
    return class_ids


def _get_suggestion_for_teacher(db: Session, suggestion_id: int, staff_id: str) -> StudentSuggestion:
    suggestion = _suggestion_query(db).filter(StudentSuggestion.student_suggestion_id == suggestion_id).first()
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    _ensure_teacher_student_scope(db, staff_id, suggestion.student_id, suggestion.subject_id)
    return suggestion


def _get_suggestion_for_student(db: Session, suggestion_id: int, student_id: UUID) -> StudentSuggestion:
    suggestion = _suggestion_query(db).filter(
        StudentSuggestion.student_suggestion_id == suggestion_id,
        StudentSuggestion.student_id == student_id,
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
        SubjectLoad.status == "active",
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


def create_manual_suggestion(db: Session, staff_id: str, body: ManualSuggestionCreate) -> SuggestionResponse:
    scoped_class_ids = _ensure_teacher_student_scope(db, staff_id, body.student_id, body.subject_id)
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Suggestion title is required")

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
    else:
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

    db.add(suggestion)
    db.commit()
    db.refresh(suggestion)
    return build_suggestion_response(db, suggestion)


def list_teacher_suggestions(
    db: Session,
    staff_id: str,
    class_id: Optional[int] = None,
    subject_id: Optional[int] = None,
    student_id: Optional[UUID] = None,
    status: Optional[str] = None,
) -> SuggestionListResponse:
    load_query = db.query(SubjectLoad.class_id, SubjectLoad.subject_id).filter(
        SubjectLoad.staff_id == staff_id,
        SubjectLoad.status == "active",
    )
    if class_id is not None:
        load_query = load_query.filter(SubjectLoad.class_id == class_id)
    if subject_id is not None:
        load_query = load_query.filter(SubjectLoad.subject_id == subject_id)
    loads = load_query.all()
    if not loads:
        return SuggestionListResponse()

    scoped_pairs = {(row.class_id, row.subject_id) for row in loads}
    scoped_subjects = {pair[1] for pair in scoped_pairs}
    scoped_class_ids = {pair[0] for pair in scoped_pairs}
    scoped_students = {
        row[0]
        for row in db.query(StudentClass.student_id)
        .filter(
            StudentClass.class_id.in_(scoped_class_ids),
            StudentClass.enrollment_status == "enrolled",
        )
        .all()
    }
    query = _suggestion_query(db).filter(
        StudentSuggestion.subject_id.in_(scoped_subjects),
        StudentSuggestion.student_id.in_(scoped_students),
    )
    if student_id is not None:
        query = query.filter(StudentSuggestion.student_id == student_id)
    if status is not None:
        query = query.filter(StudentSuggestion.status == status)
    suggestions = query.order_by(StudentSuggestion.created_at.desc()).all()
    return SuggestionListResponse(
        suggestions=[build_suggestion_response(db, suggestion) for suggestion in suggestions]
    )


def dismiss_teacher_suggestion(db: Session, staff_id: str, suggestion_id: int) -> SuggestionResponse:
    suggestion = _get_suggestion_for_teacher(db, suggestion_id, staff_id)
    if suggestion.status != ACTIVE_STATUS:
        raise HTTPException(status_code=400, detail="Only active suggestions can be dismissed")
    suggestion.status = DISMISSED_STATUS
    db.commit()
    db.refresh(suggestion)
    return build_suggestion_response(db, suggestion)


def archive_teacher_suggestion(db: Session, staff_id: str, suggestion_id: int) -> SuggestionResponse:
    suggestion = _get_suggestion_for_teacher(db, suggestion_id, staff_id)
    if suggestion.status not in {COMPLETED_STATUS, DISMISSED_STATUS}:
        raise HTTPException(status_code=400, detail="Only completed or dismissed suggestions can be archived")
    suggestion.status = ARCHIVED_STATUS
    db.commit()
    db.refresh(suggestion)
    return build_suggestion_response(db, suggestion)


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
    return build_suggestion_response(db, suggestion)


def list_student_suggestions(db: Session, student: Student, status: Optional[str] = None) -> SuggestionListResponse:
    query = _suggestion_query(db).filter(
        StudentSuggestion.student_id == student.student_id,
        StudentSuggestion.status != DRAFT_STATUS,
    )
    if status is not None:
        query = query.filter(StudentSuggestion.status == status)
    suggestions = query.order_by(StudentSuggestion.created_at.desc()).all()
    return SuggestionListResponse(
        suggestions=[build_suggestion_response(db, suggestion, student=student) for suggestion in suggestions]
    )


def get_student_suggestion(db: Session, student: Student, suggestion_id: int) -> SuggestionResponse:
    suggestion = _get_suggestion_for_student(db, suggestion_id, student.student_id)
    return build_suggestion_response(db, suggestion, student=student)


def mark_student_suggestion_viewed(db: Session, student: Student, suggestion_id: int) -> SuggestionResponse:
    suggestion = _get_suggestion_for_student(db, suggestion_id, student.student_id)
    if not suggestion.is_viewed:
        suggestion.is_viewed = True
        suggestion.viewed_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(suggestion)
    return build_suggestion_response(db, suggestion, student=student)


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
    return build_suggestion_response(db, suggestion, student=student)


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
    if suggestion.resource_type == "LESSON":
        lesson = suggestion.lesson or db.query(Lesson).filter(Lesson.lesson_id == suggestion.lesson_id).first()
        if not lesson:
            return _resource_unavailable("Lesson resource is no longer available", suggestion)
        available = not lesson.is_archived
        reason = None if available else "Lesson resource is archived"
        if student:
            enrolled_class_ids = _student_enrolled_class_ids(db, student)
            assignment = db.query(LessonAssignment).filter(
                LessonAssignment.lesson_id == lesson.lesson_id,
                LessonAssignment.class_id.in_(enrolled_class_ids),
                LessonAssignment.is_published == True,
            ).first()
            available = available and bool(lesson.is_published and assignment)
            reason = None if available else "Lesson resource is not available to this student"
        return SuggestionResourceSummary(
            resource_type="LESSON",
            title=lesson.title,
            subject_id=lesson.subject_id,
            lesson_id=lesson.lesson_id,
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
        resource=build_resource_summary(db, suggestion, student=student),
        classwork_link=classwork_link,
        source_metrics=(suggestion.resource_links or {}).get("source_metrics") if suggestion.resource_links else None,
    )
