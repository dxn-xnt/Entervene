from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.suggestion.StudentSuggestion import StudentSuggestion
from app.models.suggestion.SuggestionClasswork import SuggestionClasswork
from app.schemas.Suggestion import RecommendationDraftRequest, SuggestionListResponse
from app.services.suggestion.SuggestionService import build_suggestion_response


ACTIVE_DRAFT_STATUSES = {"DRAFT", "ACTIVE"}


def generate_recommendation_drafts(
    db: Session,
    staff_id: str,
    body: RecommendationDraftRequest,
) -> SuggestionListResponse:
    _ensure_teacher_load(db, staff_id, body.class_id, body.subject_id)

    created: list[StudentSuggestion] = []
    weak_rows = _weak_submissions(db, body.class_id, body.subject_id, Decimal(str(body.low_score_threshold)))
    for submission, assignment, classwork, score_percent in weak_rows:
        if len(created) >= body.limit:
            break

        resource = _best_resource_for_weak_work(db, body.class_id, body.subject_id, classwork.classwork_id)
        if resource is None:
            continue
        resource_type, resource_obj = resource
        if _has_open_or_draft_duplicate(db, submission.student_id, body.subject_id, resource_type, resource_obj):
            continue

        suggestion = _build_draft_suggestion(
            staff_id=staff_id,
            submission=submission,
            source_assignment=assignment,
            source_classwork=classwork,
            score_percent=score_percent,
            threshold=body.low_score_threshold,
            resource_type=resource_type,
            resource_obj=resource_obj,
            subject_id=body.subject_id,
        )
        db.add(suggestion)
        created.append(suggestion)

    db.commit()
    for suggestion in created:
        db.refresh(suggestion)

    return SuggestionListResponse(
        suggestions=[build_suggestion_response(db, suggestion) for suggestion in created]
    )


def _ensure_teacher_load(db: Session, staff_id: str, class_id: int, subject_id: int) -> None:
    load = db.query(SubjectLoad).filter(
        SubjectLoad.staff_id == staff_id,
        SubjectLoad.class_id == class_id,
        SubjectLoad.subject_id == subject_id,
        SubjectLoad.status == "active",
    ).first()
    if not load:
        raise HTTPException(status_code=403, detail="Class/subject is not in your active teaching scope")


def _weak_submissions(
    db: Session,
    class_id: int,
    subject_id: int,
    threshold: Decimal,
) -> list[tuple[StudentSubmission, ClassworkAssignment, Classwork, Decimal]]:
    rows = (
        db.query(StudentSubmission, ClassworkAssignment, Classwork)
        .join(ClassworkAssignment, ClassworkAssignment.classwork_assignment_id == StudentSubmission.classwork_assignment_id)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .join(
            StudentClass,
            (StudentClass.student_id == StudentSubmission.student_id)
            & (StudentClass.class_id == ClassworkAssignment.class_id),
        )
        .filter(
            ClassworkAssignment.class_id == class_id,
            Classwork.subject_id == subject_id,
            Classwork.is_archived == False,
            Classwork.total_points.isnot(None),
            Classwork.total_points > 0,
            StudentSubmission.grade.isnot(None),
            StudentClass.enrollment_status == "enrolled",
        )
        .order_by(StudentSubmission.grade.asc(), StudentSubmission.submission_id.asc())
        .all()
    )

    weak = []
    for submission, assignment, classwork in rows:
        score_percent = _score_percent(Decimal(submission.grade), Decimal(classwork.total_points))
        if score_percent < threshold:
            weak.append((submission, assignment, classwork, score_percent))
    return weak


def _best_resource_for_weak_work(
    db: Session,
    class_id: int,
    subject_id: int,
    source_classwork_id: int,
) -> tuple[str, Lesson | ClassworkAssignment] | None:
    linked_lesson_ids = [
        row.lesson_id
        for row in db.query(ClassworkLesson.lesson_id)
        .filter(ClassworkLesson.classwork_id == source_classwork_id)
        .order_by(ClassworkLesson.lesson_id.asc())
        .all()
    ]
    if linked_lesson_ids:
        lesson = (
            db.query(Lesson)
            .join(LessonAssignment, LessonAssignment.lesson_id == Lesson.lesson_id)
            .filter(
                Lesson.lesson_id.in_(linked_lesson_ids),
                Lesson.subject_id == subject_id,
                Lesson.is_archived == False,
                Lesson.is_published == True,
                LessonAssignment.class_id == class_id,
                LessonAssignment.is_published == True,
            )
            .order_by(Lesson.order_index.asc(), Lesson.lesson_id.asc())
            .first()
        )
        if lesson:
            return ("LESSON", lesson)

    reading_query = (
        db.query(ClassworkAssignment)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .filter(
            ClassworkAssignment.class_id == class_id,
            ClassworkAssignment.is_published == True,
            Classwork.subject_id == subject_id,
            Classwork.classwork_type == "READING",
            Classwork.is_archived == False,
        )
    )
    if linked_lesson_ids:
        reading_query = reading_query.join(
            ClassworkLesson,
            ClassworkLesson.classwork_id == Classwork.classwork_id,
        ).filter(ClassworkLesson.lesson_id.in_(linked_lesson_ids))

    reading_assignment = reading_query.order_by(ClassworkAssignment.classwork_assignment_id.asc()).first()
    if reading_assignment:
        return ("CLASSWORK", reading_assignment)
    return None


def _has_open_or_draft_duplicate(
    db: Session,
    student_id,
    subject_id: int,
    resource_type: str,
    resource_obj: Lesson | ClassworkAssignment,
) -> bool:
    query = db.query(StudentSuggestion).filter(
        StudentSuggestion.student_id == student_id,
        StudentSuggestion.subject_id == subject_id,
        StudentSuggestion.resource_type == resource_type,
        StudentSuggestion.status.in_(ACTIVE_DRAFT_STATUSES),
    )
    if resource_type == "LESSON":
        return query.filter(StudentSuggestion.lesson_id == resource_obj.lesson_id).first() is not None
    return (
        query.join(SuggestionClasswork, SuggestionClasswork.student_suggestion_id == StudentSuggestion.student_suggestion_id)
        .filter(SuggestionClasswork.classwork_assignment_id == resource_obj.classwork_assignment_id)
        .first()
        is not None
    )


def _build_draft_suggestion(
    staff_id: str,
    submission: StudentSubmission,
    source_assignment: ClassworkAssignment,
    source_classwork: Classwork,
    score_percent: Decimal,
    threshold: float,
    resource_type: str,
    resource_obj: Lesson | ClassworkAssignment,
    subject_id: int,
) -> StudentSuggestion:
    priority = _priority_for_score(score_percent)
    resource_title = resource_obj.title if resource_type == "LESSON" else resource_obj.classwork.title
    suggestion = StudentSuggestion(
        suggestion_type="AUTOMATED",
        resource_type=resource_type,
        title=f"Review {resource_title}",
        description=(
            f"Generated because {source_classwork.title} scored "
            f"{_decimal_to_float(score_percent)}%, below the {threshold}% review threshold."
        ),
        priority=priority,
        status="DRAFT",
        student_id=submission.student_id,
        subject_id=subject_id,
        created_by_staff_id=staff_id,
    )
    source_metrics = {
        "source": "LOW_CLASSWORK_SCORE",
        "source_classwork_assignment_id": source_assignment.classwork_assignment_id,
        "source_classwork_id": source_classwork.classwork_id,
        "source_title": source_classwork.title,
        "source_type": source_classwork.classwork_type,
        "grade": _decimal_to_float(Decimal(submission.grade)),
        "total_points": _decimal_to_float(Decimal(source_classwork.total_points)),
        "score_percent": _decimal_to_float(score_percent),
        "threshold_percent": threshold,
    }

    if resource_type == "LESSON":
        suggestion.lesson_id = resource_obj.lesson_id
        suggestion.resource_links = {
            "resource_type": "LESSON",
            "lesson_id": resource_obj.lesson_id,
            "title": resource_obj.title,
            "source_metrics": source_metrics,
        }
    else:
        suggestion.resource_links = {
            "resource_type": "CLASSWORK",
            "classwork_assignment_id": resource_obj.classwork_assignment_id,
            "classwork_id": resource_obj.classwork_id,
            "title": resource_obj.classwork.title,
            "source_metrics": source_metrics,
        }
        suggestion.classwork_link = SuggestionClasswork(
            classwork_assignment_id=resource_obj.classwork_assignment_id,
            score_before=submission.grade,
        )
    return suggestion


def _score_percent(grade: Decimal, total_points: Decimal) -> Decimal:
    return ((grade / total_points) * Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _priority_for_score(score_percent: Decimal) -> str:
    if score_percent < Decimal("50"):
        return "URGENT"
    if score_percent < Decimal("65"):
        return "HIGH"
    return "NORMAL"


def _decimal_to_float(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
