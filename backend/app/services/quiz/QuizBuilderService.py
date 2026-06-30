from decimal import Decimal
from typing import Iterable

from fastapi import HTTPException
from sqlalchemy.orm import Session, selectinload

from app.models.academic.Lesson import Lesson
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizSetting import QuizSetting
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Quiz import (
    QuizBuilderResponse,
    QuizBuilderUpsert,
    QuizOptionOut,
    QuizQuestionOut,
    QuizReadinessResponse,
    QuizSettingOut,
)
from app.services.classwork.ClassworkShared import is_quiz_type


QUESTION_MULTIPLE_CHOICE = "MULTIPLE_CHOICE"
QUESTION_SHORT_ANSWER = "SHORT_ANSWER"
QUIZ_STATUSES = {"DRAFT", "READY", "PUBLISHED", "ARCHIVED"}
SUMMARY_RELEASE_MODES = {"IMMEDIATE", "SCHEDULED", "AFTER_DUE_DATE", "NEVER"}


def get_teacher_quiz_classwork(db: Session, staff_id: str, classwork_id: int) -> Classwork:
    """Return a teacher-owned quiz classwork or fail with route-safe errors."""
    classwork = db.query(Classwork).filter(
        Classwork.classwork_id == classwork_id,
        Classwork.created_by_staff_id == staff_id,
    ).first()
    if not classwork:
        raise HTTPException(status_code=404, detail="Classwork not found or not yours")
    if classwork.is_archived:
        raise HTTPException(status_code=400, detail="Cannot edit archived classwork")
    if not is_quiz_type(classwork.classwork_type):
        raise HTTPException(status_code=400, detail="Classwork is not a quiz")
    return classwork


def get_quiz_for_classwork(db: Session, classwork_id: int) -> Quiz | None:
    return (
        db.query(Quiz)
        .options(
            selectinload(Quiz.questions)
            .selectinload(QuizQuestion.question)
            .selectinload(Question.options)
        )
        .filter(Quiz.classwork_id == classwork_id)
        .first()
    )


def classwork_has_quiz_attempts(db: Session, classwork_id: int) -> bool:
    """Builder edits are frozen after a student starts/submits an attempt."""
    return (
        db.query(StudentSubmission)
        .join(
            ClassworkAssignment,
            ClassworkAssignment.classwork_assignment_id == StudentSubmission.classwork_assignment_id,
        )
        .filter(ClassworkAssignment.classwork_id == classwork_id)
        .first()
        is not None
    )


def validate_quiz_payload(db: Session, classwork: Classwork, payload: QuizBuilderUpsert) -> None:
    errors = _builder_errors(db, classwork, payload)
    if errors:
        raise HTTPException(status_code=400, detail=errors)


def quiz_readiness(db: Session, classwork: Classwork, quiz: Quiz | None = None) -> QuizReadinessResponse:
    quiz = quiz or get_quiz_for_classwork(db, classwork.classwork_id)
    errors = _readiness_errors(classwork, quiz)
    return QuizReadinessResponse(
        classwork_id=classwork.classwork_id,
        quiz_id=quiz.quiz_id if quiz else None,
        is_publish_ready=not errors,
        readiness_errors=errors,
    )


def upsert_quiz_builder(
    db: Session,
    classwork: Classwork,
    payload: QuizBuilderUpsert,
) -> QuizBuilderResponse:
    if classwork_has_quiz_attempts(db, classwork.classwork_id):
        raise HTTPException(status_code=409, detail="Cannot edit quiz after attempts exist")
    validate_quiz_payload(db, classwork, payload)

    quiz = get_quiz_for_classwork(db, classwork.classwork_id)
    if not quiz:
        quiz = Quiz(classwork_id=classwork.classwork_id)
        db.add(quiz)
        db.flush()

    quiz.duration_minutes = payload.duration_minutes
    quiz.accessible_at = payload.accessible_at
    quiz.status = payload.status.strip().upper()
    quiz.total_items = len(payload.questions)

    setting = db.query(QuizSetting).filter(QuizSetting.classwork_id == classwork.classwork_id).first()
    if not setting:
        setting = QuizSetting(classwork_id=classwork.classwork_id)
        db.add(setting)
    setting.is_shuffle_questions = payload.settings.is_shuffle_questions
    setting.enable_per_question_scoring = payload.settings.enable_per_question_scoring
    setting.enable_per_question_time_limits = payload.settings.enable_per_question_time_limits
    setting.max_attempts = payload.settings.max_attempts
    setting.show_correct_answers = payload.settings.show_correct_answers
    setting.summary_release_mode = payload.settings.summary_release_mode.strip().upper()
    setting.summary_release_at = payload.settings.summary_release_at

    _replace_questions(db, quiz, payload.questions)
    db.flush()
    db.expire(quiz, ["questions"])
    return build_quiz_response(db, classwork, quiz)


def delete_quiz_builder(db: Session, classwork: Classwork) -> None:
    if classwork_has_quiz_attempts(db, classwork.classwork_id):
        raise HTTPException(status_code=409, detail="Cannot delete quiz after attempts exist")

    quiz = get_quiz_for_classwork(db, classwork.classwork_id)
    setting = db.query(QuizSetting).filter(QuizSetting.classwork_id == classwork.classwork_id).first()
    if setting:
        db.delete(setting)
    if quiz:
        linked_questions = [link.question for link in quiz.questions]
        db.delete(quiz)
        db.flush()
        for question in linked_questions:
            db.delete(question)


def build_quiz_response(db: Session, classwork: Classwork, quiz: Quiz) -> QuizBuilderResponse:
    quiz = get_quiz_for_classwork(db, classwork.classwork_id) or quiz
    setting = db.query(QuizSetting).filter(QuizSetting.classwork_id == classwork.classwork_id).first()
    readiness = quiz_readiness(db, classwork, quiz)

    return QuizBuilderResponse(
        quiz_id=quiz.quiz_id,
        classwork_id=classwork.classwork_id,
        title=classwork.title,
        total_points=float(classwork.total_points) if classwork.total_points is not None else None,
        total_items=quiz.total_items,
        duration_minutes=quiz.duration_minutes,
        accessible_at=quiz.accessible_at,
        status=quiz.status,
        settings=_setting_out(setting) if setting else None,
        questions=[
            _question_out(link)
            for link in sorted(quiz.questions, key=lambda item: item.display_order)
        ],
        is_publish_ready=readiness.is_publish_ready,
        readiness_errors=readiness.readiness_errors,
        created_at=quiz.created_at,
    )


def _replace_questions(db: Session, quiz: Quiz, questions) -> None:
    for link in list(quiz.questions):
        db.delete(link.question)
    db.flush()

    for item in questions:
        question_type = item.question_type.strip().upper()
        question = Question(
            question_text=item.question_text.strip(),
            question_type=question_type,
            difficulty_level=item.difficulty_level.strip().upper() if item.difficulty_level else None,
            points=Decimal(str(item.points)),
            explanation=item.explanation,
            lesson_id=item.lesson_id,
            is_ai_generated=False,
        )
        db.add(question)
        db.flush()
        for option in item.options:
            db.add(QuestionOption(
                question_id=question.question_id,
                option_text=option.option_text.strip(),
                is_correct=option.is_correct,
                option_order=option.option_order,
            ))
        db.add(QuizQuestion(
            quiz_id=quiz.quiz_id,
            question_id=question.question_id,
            display_order=item.display_order,
        ))


def _builder_errors(db: Session, classwork: Classwork, payload: QuizBuilderUpsert) -> list[str]:
    errors: list[str] = []
    status = payload.status.strip().upper()
    if status not in QUIZ_STATUSES:
        errors.append("Quiz status must be DRAFT, READY, PUBLISHED, or ARCHIVED")
    if payload.duration_minutes is not None and payload.duration_minutes <= 0:
        errors.append("Duration minutes must be greater than zero")
    if payload.settings.max_attempts is not None and payload.settings.max_attempts <= 0:
        errors.append("Max attempts must be greater than zero")
    release_mode = payload.settings.summary_release_mode.strip().upper()
    if release_mode not in SUMMARY_RELEASE_MODES:
        errors.append("Quiz summary availability must be immediate, scheduled, after due date, or never")
    if release_mode == "SCHEDULED" and payload.settings.summary_release_at is None:
        errors.append("Quiz summary release date and time is required")
    if release_mode != "SCHEDULED" and payload.settings.summary_release_at is not None:
        errors.append("Quiz summary release date is only allowed for scheduled release")
    if release_mode == "AFTER_DUE_DATE" and not _classwork_has_due_date(db, classwork.classwork_id):
        errors.append("Set a quiz due date before releasing the summary after the due date")

    display_orders = [question.display_order for question in payload.questions]
    if len(display_orders) != len(set(display_orders)):
        errors.append("Question display order must be unique")
    if any(order <= 0 for order in display_orders):
        errors.append("Question display order must be greater than zero")

    for index, question in enumerate(payload.questions, start=1):
        question_type = question.question_type.strip().upper()
        if question_type not in {QUESTION_MULTIPLE_CHOICE, QUESTION_SHORT_ANSWER}:
            errors.append(f"Question {index} type must be MULTIPLE_CHOICE or SHORT_ANSWER")
        if not question.question_text.strip():
            errors.append(f"Question {index} text is required")
        if question.points <= 0:
            errors.append(f"Question {index} points must be greater than zero")
        if question.difficulty_level and question.difficulty_level.strip().upper() not in {"EASY", "MEDIUM", "HARD"}:
            errors.append(f"Question {index} difficulty must be EASY, MEDIUM, or HARD")
        if question.lesson_id is not None and not _lesson_belongs_to_classwork(db, classwork, question.lesson_id):
            errors.append(f"Question {index} lesson must belong to the same teacher and subject")
        errors.extend(_option_errors(index, question_type, question.options))
    return errors


def _option_errors(index: int, question_type: str, options: Iterable) -> list[str]:
    errors: list[str] = []
    if question_type == QUESTION_MULTIPLE_CHOICE:
        options = list(options)
        if len(options) < 2:
            errors.append(f"Question {index} must have at least two options")
        if sum(1 for option in options if option.is_correct) != 1:
            errors.append(f"Question {index} must have exactly one correct option")
        option_orders = [option.option_order for option in options]
        if len(option_orders) != len(set(option_orders)):
            errors.append(f"Question {index} option order must be unique")
        if any(order <= 0 for order in option_orders):
            errors.append(f"Question {index} option order must be greater than zero")
        if any(not option.option_text.strip() for option in options):
            errors.append(f"Question {index} option text is required")
    elif question_type == QUESTION_SHORT_ANSWER and options:
        errors.append(f"Question {index} short answer questions cannot have options")
    return errors


def _readiness_errors(classwork: Classwork, quiz: Quiz | None) -> list[str]:
    errors: list[str] = []
    if not quiz:
        return ["Quiz has not been created"]
    if not classwork.total_points or classwork.total_points <= 0:
        errors.append("Quiz classwork must have total points greater than zero")
    if not quiz.questions:
        errors.append("Quiz must have at least one question")

    question_points = sum(
        Decimal(str(link.question.points))
        for link in quiz.questions
        if link.question and link.question.points is not None
    )
    if classwork.total_points is not None and question_points != Decimal(str(classwork.total_points)):
        errors.append("Sum of question points must match classwork total points")
    return errors


def _lesson_belongs_to_classwork(db: Session, classwork: Classwork, lesson_id: int) -> bool:
    return db.query(Lesson).filter(
        Lesson.lesson_id == lesson_id,
        Lesson.subject_id == classwork.subject_id,
        Lesson.created_by_staff_id == classwork.created_by_staff_id,
    ).first() is not None


def _classwork_has_due_date(db: Session, classwork_id: int) -> bool:
    return db.query(ClassworkAssignment).filter(
        ClassworkAssignment.classwork_id == classwork_id,
        ClassworkAssignment.due_date.isnot(None),
    ).first() is not None


def _setting_out(setting: QuizSetting) -> QuizSettingOut:
    return QuizSettingOut(
        quiz_setting_id=setting.quiz_setting_id,
        is_shuffle_questions=setting.is_shuffle_questions,
        enable_per_question_scoring=setting.enable_per_question_scoring,
        enable_per_question_time_limits=setting.enable_per_question_time_limits,
        max_attempts=setting.max_attempts,
        show_correct_answers=setting.show_correct_answers,
        summary_release_mode=setting.summary_release_mode,
        summary_release_at=setting.summary_release_at,
    )


def _question_out(link: QuizQuestion) -> QuizQuestionOut:
    question = link.question
    return QuizQuestionOut(
        quiz_question_id=link.quiz_question_id,
        question_id=question.question_id,
        question_text=question.question_text,
        question_type=question.question_type,
        points=float(question.points),
        display_order=link.display_order,
        difficulty_level=question.difficulty_level,
        explanation=question.explanation,
        lesson_id=question.lesson_id,
        options=[
            QuizOptionOut(
                option_id=option.option_id,
                option_text=option.option_text,
                is_correct=option.is_correct,
                option_order=option.option_order,
            )
            for option in sorted(question.options, key=lambda item: item.option_order)
        ],
    )
