"""Teacher-requested, non-persistent AI feedback suggestions for graded work."""

from __future__ import annotations

import asyncio
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation
import hashlib
import hmac
import json
import re
import unicodedata
import uuid

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy.orm import Session, selectinload

from app.core.Config import settings
from app.db.Session import SessionLocal
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Lesson import Lesson
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.people.Student import Student
from app.models.quiz.Question import Question
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizSetting import QuizSetting
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.submissions.SubmissionFeedbackDraft import SubmissionFeedbackDraft
from app.schemas.Submission import (
    FeedbackDraftResponse,
    FeedbackEligibilityResponse,
    FeedbackPublicationRequest,
    FeedbackPublicationResponse,
    FeedbackSuggestionResponse,
)
from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService
from app.services.ai import Provider
from app.services.ai.UsageGuard import ai_configured
from app.services.classwork.ClassworkAccessService import assignment_allows_student
from app.services.classwork.ClassworkShared import aware_utc, is_quiz_type, is_reading_type
from app.services.quiz.QuizAttemptService import (
    COMPLETED_ATTEMPT_STATUSES,
    _attempt_feedback_visibility,
    _can_submit,
    _summary_release_state,
)
from app.services.submission.SubmissionService import feedback_fingerprint, teacher_owns_assignment


MAX_FEEDBACK_LENGTH = 1200
MAX_PROMPT_BYTES = 12000
MAX_ITEMS = 20
SUPPORTED_QUESTION_TYPES = frozenset({"MULTIPLE_CHOICE", "IDENTIFICATION", "SHORT_ANSWER"})
_ELIGIBILITY_STATE_CODES = frozenset({
    "FEEDBACK_QUIZ_NOT_FULLY_GRADED",
    "FEEDBACK_RETAKE_AVAILABLE",
    "FEEDBACK_UNSUPPORTED_SUBMISSION",
    "FEEDBACK_UNSUPPORTED_ASSIGNMENT",
    "FEEDBACK_UNSUPPORTED_QUESTION_TYPE",
    "FEEDBACK_INSUFFICIENT_EVIDENCE",
    "FEEDBACK_INVALID_GRADING_EVIDENCE",
    "FEEDBACK_PERIOD_GRADE_FINALIZED",
    "FEEDBACK_CLASSWORK_NOT_FULLY_GRADED",
    "FEEDBACK_CLASSWORK_NOT_PUBLISHED",
    "FEEDBACK_SCORES_HIDDEN",
})

_SCORE_FEEDBACK_SENTENCES = {
    "full_credit": (
        "The overall score shows full credit for this work.",
        "Keep using the approaches that helped you complete this work.",
    ),
    "partial_credit": (
        "The overall score shows that some points were earned, with room to strengthen future work.",
        "Review your work alongside your teacher's guidance to identify useful next steps.",
    ),
    "no_credit": (
        "The overall score shows no credit for this work.",
        "Review your work with your teacher to identify a helpful starting point.",
    ),
}
_SHARED_SCORE_FEEDBACK_SENTENCES = (
    "Ask your teacher for specific guidance about this work.",
    "Use your teacher's feedback to guide your next attempt.",
)


class GeneratedFeedback(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    feedback: str = Field(min_length=20, max_length=MAX_FEEDBACK_LENGTH)

    @field_validator("feedback")
    @classmethod
    def plain_text_only(cls, value: str) -> str:
        if "```" in value or re.search(r"<\s*/?\s*[a-z][^>]*>", value, re.IGNORECASE):
            raise ValueError("Feedback must be plain text")
        return value


@dataclass(frozen=True)
class _QuestionEvidence:
    display_order: int
    question_type: str
    question_text: str
    student_response: str
    points_awarded: Decimal
    max_points: Decimal
    is_correct: bool | None
    correct_answers: tuple[str, ...]
    explanation: str | None
    lesson_title: str | None


@dataclass(frozen=True)
class _FeedbackContext:
    submission_id: int
    attempt_count: int
    feedback: str | None
    status: str
    grade: Decimal
    submitted_at: datetime | None
    graded_at: datetime | None
    assignment: ClassworkAssignment
    classwork: Classwork
    subject_name: str
    lesson_titles: tuple[str, ...]
    setting: QuizSetting | None
    questions: tuple[_QuestionEvidence, ...]
    answer_release_authorized: bool
    retake_available: bool


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _decimal_text(value: Decimal | int | float | None) -> str | None:
    return None if value is None else str(Decimal(str(value)))


def _normalized(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return " ".join(re.sub(r"[^\w]+", " ", normalized, flags=re.UNICODE).split())


def _evidence_fingerprint(context: _FeedbackContext) -> str:
    payload = {
        "submission_id": context.submission_id,
        "attempt_count": context.attempt_count,
        "status": context.status,
        "grade": _decimal_text(context.grade),
        "submitted_at": context.submitted_at.isoformat() if context.submitted_at else None,
        "graded_at": context.graded_at.isoformat() if context.graded_at else None,
        "assignment": {
            "assignment_id": context.assignment.classwork_assignment_id,
            "class_id": context.assignment.class_id,
            "academic_period_id": context.assignment.academic_period_id,
            "due_date": context.assignment.due_date.isoformat() if context.assignment.due_date else None,
            "max_attempts": context.assignment.max_attempts,
        },
        "classwork": {
            "classwork_id": context.classwork.classwork_id,
            "title": context.classwork.title,
            "instructions": context.classwork.instructions,
            "subject_id": context.classwork.subject_id,
            "total_points": _decimal_text(context.classwork.total_points),
            "updated_at": context.classwork.updated_at.isoformat() if context.classwork.updated_at else None,
        },
        "setting": {
            "show_correct_answers": context.setting.show_correct_answers if context.setting else False,
            "summary_release_mode": context.setting.summary_release_mode if context.setting else "IMMEDIATE",
            "summary_release_at": (
                context.setting.summary_release_at.isoformat()
                if context.setting and context.setting.summary_release_at
                else None
            ),
            "max_attempts": context.setting.max_attempts if context.setting else None,
        },
        "answer_release_authorized": context.answer_release_authorized,
        "retake_available": context.retake_available,
        "lessons": list(context.lesson_titles),
        "questions": [
            {
                "display_order": item.display_order,
                "question_type": item.question_type,
                "question_text": item.question_text,
                "student_response": item.student_response,
                "points_awarded": _decimal_text(item.points_awarded),
                "max_points": _decimal_text(item.max_points),
                "is_correct": item.is_correct,
                "correct_answers": list(item.correct_answers),
                "explanation": item.explanation,
                "lesson_title": item.lesson_title,
            }
            for item in context.questions
        ],
    }
    if not is_quiz_type(context.classwork.classwork_type):
        # Keep quiz fingerprints unchanged. Non-quiz release and mode settings
        # are authoritative and must invalidate an outstanding suggestion.
        payload["non_quiz_policy"] = {
            "classwork_type": context.classwork.classwork_type,
            "activity_mode": context.classwork.activity_mode,
            "is_graded": context.classwork.is_graded,
            "is_published": context.classwork.is_published,
            "assignment_published": context.assignment.is_published,
            "show_scores": context.classwork.show_scores,
        }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _assert_authorized_scope(
    db: Session,
    staff_id: str,
    submission_id: int,
    *,
    lock_for_update: bool = False,
) -> tuple[StudentSubmission, ClassworkAssignment, Classwork]:
    submission_query = db.query(StudentSubmission).filter(
        StudentSubmission.submission_id == submission_id,
    ).populate_existing()
    if lock_for_update:
        submission_query = submission_query.with_for_update()
    submission = submission_query.one_or_none()
    if submission is None:
        raise _error(404, "FEEDBACK_SUBMISSION_NOT_FOUND", "Submission not found")

    assignment = teacher_owns_assignment(
        submission.classwork_assignment_id,
        staff_id,
        db,
        write_required=True,
    )
    if lock_for_update:
        assignment = db.query(ClassworkAssignment).filter(
            ClassworkAssignment.classwork_assignment_id == assignment.classwork_assignment_id,
        ).populate_existing().with_for_update().one()
        classwork = db.query(Classwork).filter(
            Classwork.classwork_id == assignment.classwork_id,
        ).populate_existing().with_for_update().one_or_none()
        if classwork is None:
            raise _error(404, "FEEDBACK_SUBMISSION_NOT_FOUND", "Submission not found")
        db.query(SubjectLoad).filter(
            SubjectLoad.class_id == assignment.class_id,
            SubjectLoad.subject_id == classwork.subject_id,
            SubjectLoad.academic_period_id == assignment.academic_period_id,
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(["active", "published"]),
        ).with_for_update().all()
        # Re-evaluate authority after the assignment, classwork, and matching
        # active-load rows are locked.
        teacher_owns_assignment(
            assignment.classwork_assignment_id,
            staff_id,
            db,
            write_required=True,
        )
    else:
        classwork = db.get(Classwork, assignment.classwork_id)
    if classwork is None:
        raise _error(404, "FEEDBACK_SUBMISSION_NOT_FOUND", "Submission not found")
    if assignment.academic_period_id is None:
        raise _error(403, "FEEDBACK_ACADEMIC_CONTEXT_INVALID", "Quiz has an unscoped academic period")

    if lock_for_update:
        class_ = db.query(Class).filter(
            Class.class_id == assignment.class_id,
        ).populate_existing().with_for_update().one_or_none()
        period = db.query(AcademicPeriod).filter(
            AcademicPeriod.academic_period_id == assignment.academic_period_id,
        ).populate_existing().with_for_update().one_or_none()
    else:
        class_ = db.get(Class, assignment.class_id)
        period = db.get(AcademicPeriod, assignment.academic_period_id)
    if class_ is None or period is None or class_.academic_year_id != period.academic_year_id:
        raise _error(403, "FEEDBACK_ACADEMIC_CONTEXT_INVALID", "Quiz academic context is invalid")

    if lock_for_update:
        year = db.query(AcademicYear).filter(
            AcademicYear.academic_year_id == period.academic_year_id,
        ).populate_existing().with_for_update().one_or_none()
        student = db.query(Student).filter(
            Student.student_id == submission.student_id,
        ).populate_existing().with_for_update().one_or_none()
        subject = db.query(Subject).filter(
            Subject.subject_id == classwork.subject_id,
        ).populate_existing().with_for_update().one_or_none()
        if year is None or student is None or subject is None:
            raise _error(403, "FEEDBACK_ACADEMIC_CONTEXT_INVALID", "Quiz academic context is invalid")

    SubjectLoadAuthorizationService.assert_context_writable(
        db,
        class_id=assignment.class_id,
        academic_period_id=assignment.academic_period_id,
        block_future_period_in_current_year=True,
    )
    if not assignment_allows_student(assignment, submission.student_id):
        raise _error(403, "FEEDBACK_STUDENT_NOT_ASSIGNED", "Student is not assigned to this quiz")

    enrollment_query = db.query(StudentClass.student_class_id).filter(
        StudentClass.student_id == submission.student_id,
        StudentClass.class_id == assignment.class_id,
        StudentClass.academic_year_id == period.academic_year_id,
        StudentClass.enrollment_status == "enrolled",
    )
    if lock_for_update:
        enrollment_query = enrollment_query.with_for_update()
    enrolled = enrollment_query.first()
    if enrolled is None:
        raise _error(403, "FEEDBACK_STUDENT_NOT_ENROLLED", "Student is not enrolled in this class for this academic year")

    finalized_query = db.query(StudentPeriodGrade.period_grade_id).filter(
        StudentPeriodGrade.student_id == submission.student_id,
        StudentPeriodGrade.class_id == assignment.class_id,
        StudentPeriodGrade.subject_id == classwork.subject_id,
        StudentPeriodGrade.academic_period_id == assignment.academic_period_id,
        StudentPeriodGrade.is_finalized.is_(True),
    )
    if lock_for_update:
        finalized_query = finalized_query.with_for_update()
    finalized = finalized_query.first()
    if finalized is not None:
        raise _error(409, "FEEDBACK_PERIOD_GRADE_FINALIZED", "The period grade is finalized")

    return submission, assignment, classwork


def _assert_ordinary_quiz(db: Session, assignment: ClassworkAssignment, classwork: Classwork) -> None:
    if not is_quiz_type(classwork.classwork_type):
        raise _error(422, "FEEDBACK_UNSUPPORTED_SUBMISSION", "AI feedback suggestions currently support graded quizzes only")
    _assert_ordinary_assignment(db, assignment)


def _assert_ordinary_assignment(db: Session, assignment: ClassworkAssignment) -> None:
    if (
        assignment.recipient_student_id is not None
        or assignment.source_intervention_id is not None
        or assignment.remediation_request_id is not None
        or assignment.original_exam_assignment_id is not None
    ):
        raise _error(422, "FEEDBACK_UNSUPPORTED_ASSIGNMENT", "Intervention and remediation assignments are not supported")
    linked_remediation = db.query(RemediationAssignmentLink.remediation_link_id).filter(
        RemediationAssignmentLink.remediation_assignment_id == assignment.classwork_assignment_id,
    ).first()
    if linked_remediation is not None:
        raise _error(422, "FEEDBACK_UNSUPPORTED_ASSIGNMENT", "Intervention and remediation assignments are not supported")


def _score_classification(awarded: Decimal, maximum: Decimal) -> str:
    if awarded == maximum:
        return "full_credit"
    if awarded == 0:
        return "no_credit"
    return "partial_credit"


def _load_scored_classwork_context(
    db: Session,
    submission: StudentSubmission,
    assignment: ClassworkAssignment,
    classwork: Classwork,
) -> _FeedbackContext:
    classwork_type = (classwork.classwork_type or "").strip().upper()
    if classwork_type not in {"ASSIGNMENT", "ACTIVITY"} or (
        (classwork.activity_mode or "").strip().upper() != "ONLINE"
    ):
        raise _error(422, "FEEDBACK_UNSUPPORTED_SUBMISSION", "AI feedback is unavailable for this classwork type")
    _assert_ordinary_assignment(db, assignment)
    if not classwork.is_published or not assignment.is_published:
        raise _error(409, "FEEDBACK_CLASSWORK_NOT_PUBLISHED", "Publish this classwork before generating AI feedback")
    if not classwork.show_scores:
        raise _error(409, "FEEDBACK_SCORES_HIDDEN", "Release scores before generating score-based AI feedback")
    if not classwork.is_graded or submission.status != "graded" or submission.grade is None or (
        submission.submitted_at is None or submission.graded_at is None
    ):
        raise _error(409, "FEEDBACK_CLASSWORK_NOT_FULLY_GRADED", "Complete grading for this submitted work before generating AI feedback")
    try:
        awarded = Decimal(str(submission.grade))
        maximum = Decimal(str(classwork.total_points))
    except (InvalidOperation, ValueError, TypeError):
        raise _error(409, "FEEDBACK_INVALID_GRADING_EVIDENCE", "Classwork scoring evidence is invalid") from None
    if not awarded.is_finite() or not maximum.is_finite() or maximum <= 0 or awarded < 0 or awarded > maximum:
        raise _error(409, "FEEDBACK_INVALID_GRADING_EVIDENCE", "Classwork scoring evidence is invalid")
    return _FeedbackContext(
        submission_id=submission.submission_id,
        attempt_count=submission.attempt_count,
        feedback=submission.feedback,
        status=submission.status,
        grade=awarded,
        submitted_at=submission.submitted_at,
        graded_at=submission.graded_at,
        assignment=assignment,
        classwork=classwork,
        subject_name="",
        lesson_titles=(),
        setting=None,
        questions=(),
        # The legacy response field means feedback release is authorized for
        # non-quizzes; there are no quiz answer keys to release here.
        answer_release_authorized=True,
        retake_available=False,
    )


def _load_feedback_context(
    db: Session,
    staff_id: str,
    submission_id: int,
    *,
    lock_for_publication: bool = False,
) -> _FeedbackContext:
    with db.no_autoflush:
        submission, assignment, classwork = _assert_authorized_scope(
            db,
            staff_id,
            submission_id,
            lock_for_update=lock_for_publication,
        )
        if not is_quiz_type(classwork.classwork_type):
            return _load_scored_classwork_context(db, submission, assignment, classwork)
        _assert_ordinary_quiz(db, assignment, classwork)

        if submission.status not in COMPLETED_ATTEMPT_STATUSES or submission.status != "graded":
            raise _error(409, "FEEDBACK_QUIZ_NOT_FULLY_GRADED", "Complete grading for every quiz question before generating feedback")
        if submission.grade is None:
            raise _error(409, "FEEDBACK_QUIZ_NOT_FULLY_GRADED", "The quiz has no authoritative final score")

        quiz_query = db.query(Quiz).options(
            selectinload(Quiz.questions).selectinload(QuizQuestion.question).selectinload(Question.options),
            selectinload(Quiz.questions).selectinload(QuizQuestion.question).selectinload(Question.lesson),
        ).filter(Quiz.classwork_id == classwork.classwork_id)
        if lock_for_publication:
            quiz_query = quiz_query.with_for_update()
        quiz = quiz_query.one_or_none()
        if quiz is None or not quiz.questions:
            raise _error(422, "FEEDBACK_INSUFFICIENT_EVIDENCE", "The quiz has no inspectable questions")

        setting_query = db.query(QuizSetting).filter(QuizSetting.classwork_id == classwork.classwork_id)
        if lock_for_publication:
            setting_query = setting_query.with_for_update()
        setting = setting_query.one_or_none()
        retake_available = _can_submit(db, assignment, classwork, submission)
        if retake_available:
            raise _error(409, "FEEDBACK_RETAKE_AVAILABLE", "Feedback can be generated after the final available quiz attempt")

        answer_query = db.query(QuizAnswer).filter(
            QuizAnswer.submission_id == submission.submission_id,
        )
        if lock_for_publication:
            answer_query = answer_query.with_for_update()
        answer_rows = answer_query.all()
        answers = {answer.quiz_question_id: answer for answer in answer_rows}

        question_rows: list[_QuestionEvidence] = []
        linked_lesson_titles: set[str] = set()
        for link in sorted(quiz.questions, key=lambda row: row.display_order):
            question = link.question
            question_type = (question.question_type or "").strip().upper()
            if question_type not in SUPPORTED_QUESTION_TYPES:
                raise _error(422, "FEEDBACK_UNSUPPORTED_QUESTION_TYPE", "The quiz contains an unsupported question type")
            answer = answers.get(link.quiz_question_id)
            if answer is None or answer.points_awarded is None:
                raise _error(409, "FEEDBACK_QUIZ_NOT_FULLY_GRADED", "Complete grading for every quiz question before generating feedback")
            points = Decimal(str(answer.points_awarded))
            maximum = Decimal(str(question.points))
            if points < 0 or points > maximum:
                raise _error(409, "FEEDBACK_INVALID_GRADING_EVIDENCE", "Quiz scoring evidence is invalid")
            correct_answers = tuple(
                option.option_text.strip()
                for option in sorted(question.options, key=lambda row: row.option_order)
                if option.is_correct and option.option_text and option.option_text.strip()
            )
            lesson_title = question.lesson.title.strip() if question.lesson and question.lesson.title else None
            if lesson_title:
                linked_lesson_titles.add(lesson_title)
            question_rows.append(_QuestionEvidence(
                display_order=link.display_order,
                question_type=question_type,
                question_text=question.question_text,
                student_response=answer.answer_text or "",
                points_awarded=points,
                max_points=maximum,
                is_correct=answer.is_correct,
                correct_answers=correct_answers,
                explanation=question.explanation,
                lesson_title=lesson_title,
            ))

        if len(answers) != len(question_rows):
            raise _error(409, "FEEDBACK_INVALID_GRADING_EVIDENCE", "Quiz answer evidence does not match the current quiz")

        classwork_lessons = db.query(Lesson.title).join(
            ClassworkLesson,
            ClassworkLesson.lesson_id == Lesson.lesson_id,
        ).filter(ClassworkLesson.classwork_id == classwork.classwork_id).all()
        linked_lesson_titles.update(title.strip() for (title,) in classwork_lessons if title and title.strip())

        subject = db.get(Subject, classwork.subject_id)
        if subject is None:
            raise _error(422, "FEEDBACK_INSUFFICIENT_EVIDENCE", "The quiz subject is unavailable")

        summary_available, _, _ = _summary_release_state(setting, assignment, submission)
        visibility = _attempt_feedback_visibility(
            setting,
            submission,
            summary_available=summary_available,
        )
        return _FeedbackContext(
            submission_id=submission.submission_id,
            attempt_count=submission.attempt_count,
            feedback=submission.feedback,
            status=submission.status,
            grade=Decimal(str(submission.grade)),
            submitted_at=submission.submitted_at,
            graded_at=submission.graded_at,
            assignment=assignment,
            classwork=classwork,
            subject_name=subject.subject_name,
            lesson_titles=tuple(sorted(linked_lesson_titles, key=str.casefold)),
            setting=setting,
            questions=tuple(question_rows),
            answer_release_authorized=visibility.correct_answers,
            retake_available=retake_available,
        )


def _outcome(item: _QuestionEvidence) -> str:
    if item.points_awarded == item.max_points:
        return "full_credit"
    if item.points_awarded == 0:
        return "no_credit"
    return "partial_credit"


def _base_prompt_evidence(context: _FeedbackContext) -> dict:
    outcomes = Counter(_outcome(item) for item in context.questions)
    question_types = Counter(item.question_type for item in context.questions)
    return {
        "verified_evaluation_summary": {
            "question_count": len(context.questions),
            "question_types": dict(sorted(question_types.items())),
            "outcomes": dict(sorted(outcomes.items())),
        },
    }


def _build_prompt(context: _FeedbackContext) -> tuple[str, int]:
    if not is_quiz_type(context.classwork.classwork_type):
        return _build_scored_classwork_prompt(context), 1
    evidence = _base_prompt_evidence(context)
    included = 0
    if context.answer_release_authorized:
        detailed_items = []
        ranked = sorted(
            context.questions,
            key=lambda item: (
                item.points_awarded / item.max_points if item.max_points else Decimal("0"),
                item.display_order,
            ),
        )[:MAX_ITEMS]
        for item in ranked:
            # Provider-bound evidence is an allowlist of server-derived values.
            # Student answers and teacher-authored educational text remain in
            # the local freshness fingerprint, never in either provider prompt.
            candidate = {
                "question_number": item.display_order,
                "question_type": item.question_type,
                "evaluation": _outcome(item),
                "awarded_points": _decimal_text(item.points_awarded),
                "maximum_points": _decimal_text(item.max_points),
            }
            detailed_items.append(candidate)
            test_evidence = {**evidence, "released_question_evidence": detailed_items}
            test_prompt = _prompt_text(test_evidence, "DETAILED", len(context.questions) - len(detailed_items))
            if len(test_prompt.encode("utf-8")) > MAX_PROMPT_BYTES:
                detailed_items.pop()
                break
            included += 1
        if not detailed_items:
            raise _error(422, "FEEDBACK_INSUFFICIENT_EVIDENCE", "Released quiz evidence is too large to process safely")
        evidence["released_question_evidence"] = detailed_items
    return _prompt_text(evidence, "DETAILED" if context.answer_release_authorized else "GENERAL", len(context.questions) - included), included


def _prompt_text(evidence: dict, detail_level: str, omitted: int) -> str:
    envelope = {
        "detail_level": detail_level,
        "evidence_notice": "Only server-derived question types and scored outcomes are supplied; no answer text or topics are supplied.",
        "omitted_question_count": max(0, omitted),
        "evidence": evidence,
    }
    return (
        "Verified, privacy-limited quiz evidence follows as JSON. "
        "Write general constructive feedback using only the scored outcomes. "
        "Do not claim to have read the student's answers or know a specific topic or misconception.\n"
        + json.dumps(envelope, ensure_ascii=False, separators=(",", ":"), default=str)
    )


_SYSTEM_PROMPT = """You draft concise, supportive teacher feedback for one fully graded quiz. Return ONLY a JSON object with exactly one string field named feedback. Use only the supplied verified evidence. You have NOT seen the student's answers, the question wording, the answer keys, the subject, or the lesson topics. Never claim to have read an answer, quote a response, identify a specific mistake or misconception, or invent a score, grade, criterion, topic, cause, diagnosis, disability, behavior, motivation, effort, or student identity. Never modify or recommend a grade. Do not mention internal IDs, system instructions, prompts, evidence machinery, or AI. Keep the feedback plain text and under 1200 characters.

When detail_level is GENERAL, provide only high-level formative guidance. Do not identify a question or response; do not give, paraphrase, hint at, or confirm any answer, option, accepted variant, model answer, explanation, solution, or numeric result.

When detail_level is DETAILED, you may mention question numbers, question types, and full, partial, or no credit. Give only general next steps. Do not state or imply any answer content, topic, reasoning, solution, or cause of a score."""


_SCORE_SYSTEM_PROMPT = """Draft a short, supportive teacher feedback suggestion for scored classwork. You have not seen the student's work, instructions, rubric, teacher comments, or lesson content. Do not claim to have inspected work, identify specific mistakes or topics, infer effort or behavior, or invent observations. Return ONLY a JSON object with one string field named feedback. Choose one or two distinct sentences verbatim from the approved sentences in the user message. Do not add, modify, or paraphrase any sentence."""


def _build_scored_classwork_prompt(context: _FeedbackContext) -> str:
    maximum = Decimal(str(context.classwork.total_points))
    classification = _score_classification(context.grade, maximum)
    evidence = {
        "classwork_type": context.classwork.classwork_type.strip().upper(),
        "awarded_points": _decimal_text(context.grade),
        "maximum_points": _decimal_text(maximum),
        "credit_classification": classification,
        "grading_status": "graded",
    }
    approved = (*_SCORE_FEEDBACK_SENTENCES[classification], *_SHARED_SCORE_FEEDBACK_SENTENCES)
    envelope = {"evidence": evidence, "approved_sentences": approved}
    return (
        "Privacy-limited, server-derived scoring evidence and approved wording follow as JSON. "
        "Select one or two approved sentences only; do not infer submission content or reasons for the score.\n"
        + json.dumps(envelope, ensure_ascii=False, separators=(",", ":"))
    )


def _protected_phrases(context: _FeedbackContext) -> tuple[str, ...]:
    values: set[str] = set()
    for item in context.questions:
        values.update(item.correct_answers)
        if item.explanation:
            values.add(item.explanation)
    return tuple(values)


def _validate_generated_output(raw: str, context: _FeedbackContext) -> str:
    try:
        parsed = json.loads(raw.strip())
    except (json.JSONDecodeError, TypeError):
        raise _error(502, "FEEDBACK_AI_OUTPUT_INVALID", "AI returned malformed feedback") from None
    try:
        generated = GeneratedFeedback.model_validate(parsed)
    except ValidationError:
        raise _error(502, "FEEDBACK_AI_OUTPUT_INVALID", "AI returned invalid feedback") from None

    text = generated.feedback
    if not is_quiz_type(context.classwork.classwork_type):
        classification = _score_classification(context.grade, Decimal(str(context.classwork.total_points)))
        approved = set((*_SCORE_FEEDBACK_SENTENCES[classification], *_SHARED_SCORE_FEEDBACK_SENTENCES))
        sentences = re.split(r"(?<=\.)\s+", " ".join(text.split()))
        if not 1 <= len(sentences) <= 2 or len(sentences) != len(set(sentences)) or any(
            sentence not in approved for sentence in sentences
        ):
            raise _error(502, "FEEDBACK_AI_OUTPUT_UNSAFE", "AI feedback was not supported by the available score evidence")
        return " ".join(sentences)
    normalized = _normalized(text)
    raw_lower = unicodedata.normalize("NFKC", text).casefold()
    unsafe_claims = (
        r"\b(?:dyslex\w*|adhd|autis\w*|learning disabil\w*|intellectual disabil\w*|low iq)\b",
        r"\b(?:lazy|unmotivated|lacks? motivation|does not try|lack(?:s|ing)? effort)\b",
        r"\b(?:student_id|submission_id|account_id|user_id|system prompt|ignore previous|as an ai)\b",
        r"\b(?:score|grade|points?)\s*(?:of|is|was|:|=)?\s*\d+(?:\.\d+)?\b",
        r"\b\d+(?:\.\d+)?\s*(?:%|/\s*\d+(?:\.\d+)?)",
        r"\b(?:your|the)\s+(?:answer|response|reasoning|explanation)\s+(?:said|says|shows?|means?|states?|indicates?|mentioned|was|is)\b",
        r"\byou\s+(?:wrote|said|mentioned|chose|selected|explained)\b",
    )
    if any(re.search(pattern, raw_lower, re.IGNORECASE) for pattern in unsafe_claims):
        raise _error(502, "FEEDBACK_AI_OUTPUT_UNSAFE", "AI feedback could not be returned safely")

    if not context.answer_release_authorized:
        restricted_patterns = (
            r"\b(?:correct answer|answer is|should have answered|model answer|accepted answer|solution is)\b",
            r"\b(?:question|item)\s*#?\s*\d+\b",
            r"\byou answered\b",
        )
        if any(re.search(pattern, normalized, re.IGNORECASE) for pattern in restricted_patterns):
            raise _error(502, "FEEDBACK_AI_OUTPUT_UNSAFE", "AI feedback could reveal protected quiz answers")
        for value in _protected_phrases(context):
            protected = _normalized(value)
            if len(protected) >= 2 and protected in normalized:
                raise _error(502, "FEEDBACK_AI_OUTPUT_UNSAFE", "AI feedback could reveal protected quiz answers")
    return text


def _validate_publication_feedback(text: str, context: _FeedbackContext) -> str:
    """Fail closed because arbitrary edited prose cannot be proven answer-safe."""
    _assert_answer_release_authorized(context)
    return text


def _answer_release_unavailable(context: _FeedbackContext) -> tuple[str, str]:
    setting = context.setting
    if setting is None or not setting.show_correct_answers:
        return (
            "FEEDBACK_CORRECT_ANSWERS_DISABLED",
            "AI feedback posting is unavailable because correct-answer display is disabled for this quiz.",
        )

    mode = (setting.summary_release_mode or "").strip().upper()
    if mode == "NEVER":
        return (
            "FEEDBACK_ANSWER_RELEASE_NEVER",
            "AI feedback posting is unavailable because quiz-summary release is set to Never.",
        )
    if mode not in {"IMMEDIATE", "SCHEDULED", "AFTER_DUE_DATE"}:
        return (
            "FEEDBACK_ANSWER_RELEASE_INVALID",
            "AI feedback is unavailable because the quiz answer-release settings are invalid.",
        )
    if mode == "SCHEDULED" and setting.summary_release_at is None:
        return (
            "FEEDBACK_ANSWER_RELEASE_INVALID",
            "AI feedback is unavailable because the scheduled answer-release date is missing.",
        )
    if mode == "AFTER_DUE_DATE" and context.assignment.due_date is None:
        return (
            "FEEDBACK_ANSWER_RELEASE_INVALID",
            "AI feedback is unavailable because this quiz has no due date for answer release.",
        )
    return (
        "FEEDBACK_ANSWER_RELEASE_PENDING",
        "AI feedback becomes available after correct answers are released to students.",
    )


def _assert_answer_release_authorized(context: _FeedbackContext) -> None:
    if context.answer_release_authorized:
        return
    code, message = _answer_release_unavailable(context)
    raise _error(409, code, message)


def _ai_unavailable() -> tuple[str, str] | None:
    if not settings.ai_enabled:
        return (
            "FEEDBACK_AI_DISABLED",
            "AI feedback is disabled by the administrator.",
        )
    if not ai_configured():
        return (
            "FEEDBACK_AI_NOT_CONFIGURED",
            "AI feedback is unavailable because no approved AI provider is configured.",
        )
    return None


def _assert_ai_available() -> None:
    unavailable = _ai_unavailable()
    if unavailable is not None:
        code, message = unavailable
        raise _error(503, code, message)


def get_submission_feedback_eligibility(
    db: Session,
    staff_id: str,
    submission_id: int,
) -> FeedbackEligibilityResponse:
    """Return server-derived availability without invoking an AI provider."""
    try:
        context = _load_feedback_context(db, staff_id, submission_id)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        code = detail.get("code")
        if code not in _ELIGIBILITY_STATE_CODES:
            raise
        return FeedbackEligibilityResponse(
            submission_id=submission_id,
            eligible=False,
            answer_release_authorized=False,
            code=code,
            message=detail.get("message") or "AI feedback is unavailable for this submission.",
        )

    unavailable = _ai_unavailable()
    if unavailable is not None:
        code, message = unavailable
        return FeedbackEligibilityResponse(
            submission_id=submission_id,
            eligible=False,
            answer_release_authorized=context.answer_release_authorized,
            code=code,
            message=message,
        )

    if not context.answer_release_authorized:
        code, message = _answer_release_unavailable(context)
        return FeedbackEligibilityResponse(
            submission_id=submission_id,
            eligible=False,
            answer_release_authorized=False,
            code=code,
            message=message,
        )
    return FeedbackEligibilityResponse(
        submission_id=submission_id,
        eligible=True,
        answer_release_authorized=True,
    )


async def generate_submission_feedback_suggestion(
    db: Session,
    staff_id: str,
    submission_id: int,
) -> FeedbackSuggestionResponse:
    """Generate a teacher-private draft without changing any academic record."""
    context = _load_feedback_context(db, staff_id, submission_id)
    _assert_ai_available()
    _assert_answer_release_authorized(context)
    evidence_fingerprint = _evidence_fingerprint(context)
    current_feedback_fingerprint = feedback_fingerprint(context.feedback)
    prompt, included_items = _build_prompt(context)

    raw = await Provider.generate_text(
        prompt,
        _SYSTEM_PROMPT if is_quiz_type(context.classwork.classwork_type) else _SCORE_SYSTEM_PROMPT,
        json_output=True,
        max_tokens=600,
        output_schema=GeneratedFeedback.model_json_schema(),
    )
    feedback = _validate_generated_output(raw, context)

    db.expire_all()
    refreshed = _load_feedback_context(db, staff_id, submission_id)
    if (
        _evidence_fingerprint(refreshed) != evidence_fingerprint
        or feedback_fingerprint(refreshed.feedback) != current_feedback_fingerprint
    ):
        raise _error(409, "FEEDBACK_SUBMISSION_CHANGED", "The submission changed while feedback was being generated")

    return FeedbackSuggestionResponse(
        submission_id=context.submission_id,
        feedback=feedback,
        detail_level=("DETAILED" if context.answer_release_authorized else "GENERAL") if is_quiz_type(context.classwork.classwork_type) else "GENERAL",
        answer_release_authorized=context.answer_release_authorized,
        attempt_count=context.attempt_count,
        evidence_item_count=len(context.questions) if is_quiz_type(context.classwork.classwork_type) else 1,
        included_item_count=included_items,
        evidence_fingerprint=evidence_fingerprint,
        feedback_fingerprint=current_feedback_fingerprint,
        generated_at=datetime.now(timezone.utc),
    )


def publish_submission_feedback(
    db: Session,
    staff_id: str,
    submission_id: int,
    payload: FeedbackPublicationRequest,
) -> FeedbackPublicationResponse:
    """Atomically publish one approved comment and no grading changes."""
    try:
        context = _load_feedback_context(
            db,
            staff_id,
            submission_id,
            lock_for_publication=True,
        )
        # Report release-policy restrictions distinctly from ordinary stale
        # evidence; both still fail before any write.
        _assert_answer_release_authorized(context)
        evidence_fingerprint = _evidence_fingerprint(context)
        current_feedback_fingerprint = feedback_fingerprint(context.feedback)
        if not hmac.compare_digest(
            payload.expected_evidence_fingerprint,
            evidence_fingerprint,
        ):
            raise _error(
                409,
                "FEEDBACK_EVIDENCE_STALE",
                "Quiz evidence changed; generate and review a new suggestion"
                if is_quiz_type(context.classwork.classwork_type)
                else "Grading evidence changed; generate and review a new suggestion",
            )
        if not hmac.compare_digest(
            payload.expected_feedback_fingerprint,
            current_feedback_fingerprint,
        ):
            raise _error(
                409,
                "FEEDBACK_COMMENT_STALE",
                "Existing feedback changed; reload before posting",
            )

        approved_feedback = _validate_publication_feedback(payload.feedback, context)
        submission = db.get(StudentSubmission, submission_id)
        if submission is None:
            raise _error(404, "FEEDBACK_SUBMISSION_NOT_FOUND", "Submission not found")
        submission.feedback = approved_feedback
        db.flush([submission])
        saved_feedback_fingerprint = feedback_fingerprint(approved_feedback)

        # Mark draft as APPROVED if one exists
        draft = db.query(SubmissionFeedbackDraft).filter_by(submission_id=submission_id).first()
        if draft is not None:
            draft.status = "APPROVED"
            draft.feedback_fingerprint = saved_feedback_fingerprint

        db.commit()
        return FeedbackPublicationResponse(
            submission_id=submission_id,
            feedback=approved_feedback,
            evidence_fingerprint=evidence_fingerprint,
            feedback_fingerprint=saved_feedback_fingerprint,
        )
    except Exception:
        db.rollback()
        raise


# Event loop holder for background execution across sync/async boundaries
_main_event_loop: asyncio.AbstractEventLoop | None = None


def set_main_event_loop(loop: asyncio.AbstractEventLoop | None) -> None:
    global _main_event_loop
    _main_event_loop = loop


def get_main_event_loop() -> asyncio.AbstractEventLoop | None:
    return _main_event_loop


def _build_draft_response(
    draft: SubmissionFeedbackDraft,
    auto_ai_feedback_enabled: bool = True,
    status_override: str | None = None,
) -> FeedbackDraftResponse:
    status = status_override or draft.status
    if status in {"QUEUED", "CLAIMED"}:
        status = "PENDING"
    return FeedbackDraftResponse(
        submission_id=draft.submission_id,
        status=status,  # type: ignore[arg-type]
        draft_feedback=draft.draft_feedback,
        evidence_fingerprint=draft.evidence_fingerprint,
        feedback_fingerprint=draft.feedback_fingerprint,
        detail_level=draft.detail_level,
        auto_ai_feedback_enabled=auto_ai_feedback_enabled,
        error_message=draft.error_message,
        created_at=draft.created_at,
        updated_at=draft.updated_at,
    )


def get_submission_feedback_draft_status(
    db: Session,
    staff_id: str,
    submission_id: int,
) -> FeedbackDraftResponse:
    """Strictly read-only retrieval of the current draft state.

    Never invokes an AI provider, never mutates database state, and never enqueues jobs.
    """
    submission, assignment, classwork = _assert_authorized_scope(
        db,
        staff_id,
        submission_id,
    )
    auto_enabled = bool(getattr(classwork, "auto_ai_feedback_enabled", False))
    draft = db.query(SubmissionFeedbackDraft).filter_by(submission_id=submission_id).first()

    if not auto_enabled:
        if draft:
            return _build_draft_response(draft, auto_ai_feedback_enabled=False)
        return FeedbackDraftResponse(
            submission_id=submission_id,
            status="NONE",
            auto_ai_feedback_enabled=False,
        )

    if draft:
        if draft.status in {"QUEUED", "CLAIMED"}:
            return _build_draft_response(draft, auto_ai_feedback_enabled=True, status_override="PENDING")
        if draft.status in {"READY", "UNDER_REVIEW"}:
            try:
                context = _load_feedback_context(db, staff_id, submission_id)
                current_fp = _evidence_fingerprint(context)
                if current_fp != draft.evidence_fingerprint:
                    return _build_draft_response(draft, auto_ai_feedback_enabled=True, status_override="STALE")
            except Exception:
                return _build_draft_response(draft, auto_ai_feedback_enabled=True, status_override="STALE")
        return _build_draft_response(draft, auto_ai_feedback_enabled=True)

    # No draft exists yet; check eligibility in a read-only way
    try:
        context = _load_feedback_context(db, staff_id, submission_id)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        code = detail.get("code") or (exc.detail if isinstance(exc.detail, str) else "NOT_ELIGIBLE")
        message = detail.get("message") if isinstance(detail, dict) else (exc.detail if isinstance(exc.detail, str) else "Not eligible for AI feedback")
        return FeedbackDraftResponse(
            submission_id=submission_id,
            status="NOT_ELIGIBLE",
            auto_ai_feedback_enabled=True,
            error_message=f"{code}: {message}",
        )

    return FeedbackDraftResponse(
        submission_id=submission_id,
        status="NONE",
        auto_ai_feedback_enabled=True,
    )


# Alias for backwards compatibility
get_or_create_submission_feedback_draft = get_submission_feedback_draft_status


def discard_submission_feedback_draft(
    db: Session,
    staff_id: str,
    submission_id: int,
) -> FeedbackDraftResponse:
    submission, assignment, classwork = _assert_authorized_scope(
        db,
        staff_id,
        submission_id,
    )
    auto_enabled = bool(getattr(classwork, "auto_ai_feedback_enabled", False))
    draft = db.query(SubmissionFeedbackDraft).filter_by(submission_id=submission_id).first()
    if draft is None:
        draft = SubmissionFeedbackDraft(
            submission_id=submission_id,
            status="DISCARDED",
            staff_id=staff_id,
        )
        db.add(draft)
    else:
        draft.status = "DISCARDED"
        draft.claim_token = None
        draft.locked_until = None
    db.commit()
    db.refresh(draft)
    return _build_draft_response(draft, auto_ai_feedback_enabled=auto_enabled)


def _determine_scheduled_release_time(
    db: Session,
    assignment: ClassworkAssignment,
    classwork: Classwork,
    submission: StudentSubmission,
) -> datetime | None:
    now = datetime.now(timezone.utc)
    if not is_quiz_type(classwork.classwork_type):
        if not getattr(classwork, "show_scores", True):
            return None
        return now

    setting = db.query(QuizSetting).filter_by(classwork_id=classwork.classwork_id).first()
    if not setting or not setting.show_correct_answers or not getattr(setting, "show_scores", True):
        return None

    retake_available = _can_submit(db, assignment, classwork, submission)
    due_date = aware_utc(assignment.due_date)
    mode = (setting.summary_release_mode or "IMMEDIATE").strip().upper()

    if retake_available:
        if due_date and due_date > now:
            sched = due_date
            if mode == "SCHEDULED" and setting.summary_release_at and aware_utc(setting.summary_release_at) > sched:
                sched = aware_utc(setting.summary_release_at)
            return sched
        return None

    if mode == "IMMEDIATE":
        return now
    elif mode == "SCHEDULED":
        return aware_utc(setting.summary_release_at) if setting.summary_release_at else None
    elif mode == "AFTER_DUE_DATE":
        return due_date
    return None


def enqueue_automatic_feedback_draft(
    db: Session,
    submission_id: int,
    staff_id: str | None = None,
) -> SubmissionFeedbackDraft | None:
    """Enqueues a feedback draft generation job in the current database transaction."""
    submission = db.query(StudentSubmission).filter_by(submission_id=submission_id).first()
    if not submission or submission.status != "graded" or submission.grade is None:
        return None

    assignment = db.query(ClassworkAssignment).filter_by(
        classwork_assignment_id=submission.classwork_assignment_id,
    ).first()
    if not assignment:
        return None

    classwork = db.query(Classwork).filter_by(classwork_id=assignment.classwork_id).first()
    if not classwork or not getattr(classwork, "auto_ai_feedback_enabled", False):
        return None

    # Exclude reading and remediation
    if (classwork.classwork_type or "").upper() == "READING" or not classwork.is_graded:
        return None
    if assignment.recipient_student_id is not None:
        return None

    # Resolve staff_id
    resolved_staff_id = staff_id or submission.graded_by_staff_id or classwork.created_by_staff_id
    if not resolved_staff_id:
        load = db.query(SubjectLoad).filter(
            SubjectLoad.class_id == assignment.class_id,
            SubjectLoad.subject_id == classwork.subject_id,
            SubjectLoad.is_active_version.is_(True),
        ).first()
        if load:
            resolved_staff_id = load.staff_id

    scheduled_for = _determine_scheduled_release_time(db, assignment, classwork, submission)

    draft = db.query(SubmissionFeedbackDraft).filter_by(submission_id=submission_id).first()
    if draft:
        if draft.status in {"APPROVED", "DISCARDED"}:
            return draft
        if draft.status == "READY":
            try:
                context = _load_feedback_context(db, resolved_staff_id, submission_id)
                if _evidence_fingerprint(context) == draft.evidence_fingerprint:
                    return draft
            except Exception:
                pass
        draft.status = "QUEUED"
        draft.staff_id = resolved_staff_id
        draft.scheduled_for = scheduled_for
        draft.retry_count = 0
        draft.claim_token = None
        draft.claimed_at = None
        draft.locked_until = None
        draft.error_message = None
    else:
        draft = SubmissionFeedbackDraft(
            submission_id=submission_id,
            status="QUEUED",
            staff_id=resolved_staff_id,
            scheduled_for=scheduled_for,
            retry_count=0,
        )
        db.add(draft)

    db.flush([draft])
    return draft


async def process_feedback_draft_job(db: Session, draft_id: int) -> bool:
    """Atomically claims and processes a single feedback draft job.

    Guarantees concurrency safety using lease-based atomic conditional update.
    """
    now = datetime.now(timezone.utc)
    claim_token = uuid.uuid4().hex
    lease_until = now + timedelta(seconds=60)

    # 1. Atomic claim conditional update
    claimed = (
        db.query(SubmissionFeedbackDraft)
        .filter(
            SubmissionFeedbackDraft.draft_id == draft_id,
            (
                SubmissionFeedbackDraft.status.in_(["QUEUED", "PENDING"])
                | (
                    (SubmissionFeedbackDraft.status == "CLAIMED")
                    & (SubmissionFeedbackDraft.locked_until < now)
                )
            ),
            SubmissionFeedbackDraft.scheduled_for.isnot(None),
            SubmissionFeedbackDraft.scheduled_for <= now,
        )
        .update(
            {
                SubmissionFeedbackDraft.status: "CLAIMED",
                SubmissionFeedbackDraft.claim_token: claim_token,
                SubmissionFeedbackDraft.claimed_at: now,
                SubmissionFeedbackDraft.locked_until: lease_until,
            },
            synchronize_session=False,
        )
    )
    db.commit()

    if not claimed:
        return False

    draft = db.get(SubmissionFeedbackDraft, draft_id)
    if draft is None or draft.claim_token != claim_token:
        return False

    # 2. Scope & toggle verification
    submission = db.get(StudentSubmission, draft.submission_id)
    if not submission:
        db.delete(draft)
        db.commit()
        return False

    assignment = db.get(ClassworkAssignment, submission.classwork_assignment_id)
    classwork = db.get(Classwork, assignment.classwork_id) if assignment else None
    if not classwork or not getattr(classwork, "auto_ai_feedback_enabled", False):
        draft.status = "NOT_ELIGIBLE"
        draft.claim_token = None
        draft.locked_until = None
        db.commit()
        return False

    staff_id = draft.staff_id or submission.graded_by_staff_id or classwork.created_by_staff_id
    if not staff_id:
        load = db.query(SubjectLoad).filter(
            SubjectLoad.class_id == assignment.class_id,
            SubjectLoad.subject_id == classwork.subject_id,
            SubjectLoad.is_active_version.is_(True),
        ).first()
        staff_id = load.staff_id if load else None

    if not staff_id:
        draft.status = "FAILED"
        draft.error_message = "No authorized staff to generate feedback"
        draft.claim_token = None
        draft.locked_until = None
        db.commit()
        return False

    # 3. Load feedback context & verify release eligibility
    try:
        context = _load_feedback_context(db, staff_id, draft.submission_id)
        if is_quiz_type(classwork.classwork_type):
            _assert_answer_release_authorized(context)
        _assert_ai_available()
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        code = detail.get("code") or (exc.detail if isinstance(exc.detail, str) else "NOT_ELIGIBLE")
        message = detail.get("message") if isinstance(detail, dict) else (exc.detail if isinstance(exc.detail, str) else str(exc.detail))

        # Check if delayed release can be scheduled
        new_sched = _determine_scheduled_release_time(db, assignment, classwork, submission)
        if new_sched and new_sched > now:
            draft.status = "QUEUED"
            draft.scheduled_for = new_sched
            draft.claim_token = None
            draft.locked_until = None
            draft.error_message = f"Scheduled for {new_sched.isoformat()}"
        else:
            draft.status = "NOT_ELIGIBLE"
            draft.error_message = f"{code}: {message}"
            draft.claim_token = None
            draft.locked_until = None
        db.commit()
        return False
    except Exception as exc:
        draft.retry_count += 1
        draft.error_message = str(exc)
        draft.claim_token = None
        draft.locked_until = None
        if draft.retry_count < draft.max_retries:
            delay = (2 ** draft.retry_count) * 5
            draft.scheduled_for = datetime.now(timezone.utc) + timedelta(seconds=delay)
            draft.status = "QUEUED"
        else:
            draft.status = "FAILED"
        db.commit()
        return False

    # 4. Generate AI feedback under UsageGuard
    evidence_fp = _evidence_fingerprint(context)
    prompt, _ = _build_prompt(context)
    detail_level = (
        ("DETAILED" if context.answer_release_authorized else "GENERAL")
        if is_quiz_type(context.classwork.classwork_type)
        else "GENERAL"
    )

    try:
        raw = await Provider.generate_text(
            prompt,
            _SYSTEM_PROMPT if is_quiz_type(context.classwork.classwork_type) else _SCORE_SYSTEM_PROMPT,
            json_output=True,
            max_tokens=600,
            output_schema=GeneratedFeedback.model_json_schema(),
        )
        feedback = _validate_generated_output(raw, context)
    except Exception as exc:
        current_draft = db.get(SubmissionFeedbackDraft, draft_id)
        if current_draft and current_draft.claim_token == claim_token:
            current_draft.retry_count += 1
            current_draft.error_message = str(exc)
            current_draft.claim_token = None
            current_draft.locked_until = None
            if current_draft.retry_count < current_draft.max_retries:
                delay = (2 ** current_draft.retry_count) * 5
                current_draft.scheduled_for = datetime.now(timezone.utc) + timedelta(seconds=delay)
                current_draft.status = "QUEUED"
            else:
                current_draft.status = "FAILED"
            db.commit()
        return False

    # 5. Optimistic concurrency / stale-state check
    fresh_context = _load_feedback_context(db, staff_id, draft.submission_id)
    fresh_fp = _evidence_fingerprint(fresh_context)
    if fresh_fp != evidence_fp:
        db.query(SubmissionFeedbackDraft).filter(
            SubmissionFeedbackDraft.draft_id == draft_id,
            SubmissionFeedbackDraft.claim_token == claim_token,
        ).update(
            {
                SubmissionFeedbackDraft.status: "STALE",
                SubmissionFeedbackDraft.claim_token: None,
                SubmissionFeedbackDraft.locked_until: None,
                SubmissionFeedbackDraft.error_message: "Grading evidence changed during generation",
            },
            synchronize_session=False,
        )
        db.commit()
        return False

    # 6. Save as READY only if this worker still holds the claim token
    rows_updated = (
        db.query(SubmissionFeedbackDraft)
        .filter(
            SubmissionFeedbackDraft.draft_id == draft_id,
            SubmissionFeedbackDraft.claim_token == claim_token,
        )
        .update(
            {
                SubmissionFeedbackDraft.draft_feedback: feedback,
                SubmissionFeedbackDraft.evidence_fingerprint: evidence_fp,
                SubmissionFeedbackDraft.feedback_fingerprint: feedback_fingerprint(context.feedback),
                SubmissionFeedbackDraft.detail_level: detail_level,
                SubmissionFeedbackDraft.attempt_count: context.attempt_count,
                SubmissionFeedbackDraft.status: "READY",
                SubmissionFeedbackDraft.claim_token: None,
                SubmissionFeedbackDraft.locked_until: None,
                SubmissionFeedbackDraft.error_message: None,
            },
            synchronize_session=False,
        )
    )
    db.commit()
    if rows_updated == 0:
        # Lease expired during generation; newer worker claimed this job
        return False
    return True


async def process_pending_feedback_draft_jobs(
    db: Session | None = None,
    limit: int = 10,
) -> int:
    """Processes ready queued feedback draft jobs up to limit."""
    owns_db = False
    if db is None:
        db = SessionLocal()
        owns_db = True

    try:
        now = datetime.now(timezone.utc)
        ready_draft_ids = (
            db.query(SubmissionFeedbackDraft.draft_id)
            .filter(
                (SubmissionFeedbackDraft.status.in_(["QUEUED", "PENDING"]))
                | (
                    (SubmissionFeedbackDraft.status == "CLAIMED")
                    & (SubmissionFeedbackDraft.locked_until < now)
                ),
                SubmissionFeedbackDraft.scheduled_for.isnot(None),
                SubmissionFeedbackDraft.scheduled_for <= now,
            )
            .order_by(
                SubmissionFeedbackDraft.scheduled_for.asc(),
                SubmissionFeedbackDraft.draft_id.asc(),
            )
            .limit(limit)
            .all()
        )

        processed_count = 0
        for (draft_id,) in ready_draft_ids:
            success = await process_feedback_draft_job(db, draft_id)
            if success:
                processed_count += 1
        return processed_count
    finally:
        if owns_db:
            db.close()


def dispatch_background_draft_processing() -> None:
    """Schedules background draft worker execution safely without blocking callers."""
    loop = get_main_event_loop()
    if loop is not None and loop.is_running():
        try:
            asyncio.run_coroutine_threadsafe(process_pending_feedback_draft_jobs(), loop)
            return
        except Exception:
            pass

    try:
        current_loop = asyncio.get_running_loop()
        current_loop.create_task(process_pending_feedback_draft_jobs())
    except RuntimeError:
        # No active event loop in thread; caller can drain explicitly if needed
        pass


def sync_and_dispatch_classwork_draft_jobs(
    db: Session,
    classwork_id: int,
    staff_id: str | None = None,
    auto_commit: bool = True,
) -> int:
    """Re-evaluates and enqueues draft jobs when classwork score/answer release settings change."""
    classwork = db.get(Classwork, classwork_id)
    if not classwork or not getattr(classwork, "auto_ai_feedback_enabled", False):
        return 0

    assignments = db.query(ClassworkAssignment).filter_by(classwork_id=classwork_id).all()
    assignment_ids = [a.classwork_assignment_id for a in assignments]
    if not assignment_ids:
        return 0

    graded_submissions = (
        db.query(StudentSubmission)
        .filter(
            StudentSubmission.classwork_assignment_id.in_(assignment_ids),
            StudentSubmission.status == "graded",
            StudentSubmission.grade.isnot(None),
        )
        .all()
    )

    enqueued_count = 0
    for submission in graded_submissions:
        draft = enqueue_automatic_feedback_draft(db, submission.submission_id, staff_id)
        if draft is not None:
            enqueued_count += 1

    if enqueued_count > 0 and auto_commit:
        db.commit()
        dispatch_background_draft_processing()

    return enqueued_count


async def run_feedback_draft_worker_loop(poll_interval_seconds: float = 30.0) -> None:
    """Periodic worker loop run during FastAPI lifespan to drain scheduled or recoverable draft jobs."""
    while True:
        try:
            await process_pending_feedback_draft_jobs()
        except asyncio.CancelledError:
            break
        except Exception:
            pass
        await asyncio.sleep(poll_interval_seconds)


async def trigger_automatic_feedback_generation(
    db: Session,
    staff_id: str,
    submission_id: int,
) -> FeedbackDraftResponse | None:
    """Backwards-compatible helper: enqueues and immediately processes draft for the submission."""
    draft = enqueue_automatic_feedback_draft(db, submission_id, staff_id)
    if draft is not None:
        db.commit()
        await process_feedback_draft_job(db, draft.draft_id)
        draft = db.get(SubmissionFeedbackDraft, draft.draft_id)
        if draft:
            return _build_draft_response(draft, auto_ai_feedback_enabled=True)
    return None
