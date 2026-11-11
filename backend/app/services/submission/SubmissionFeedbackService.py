"""Teacher-requested, non-persistent AI feedback suggestions for graded quizzes."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import hmac
import json
import re
import unicodedata

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy.orm import Session, selectinload

from app.core.Config import settings
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
from app.schemas.Submission import (
    FeedbackEligibilityResponse,
    FeedbackPublicationRequest,
    FeedbackPublicationResponse,
    FeedbackSuggestionResponse,
)
from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService
from app.services.ai import Provider
from app.services.ai.UsageGuard import ai_configured
from app.services.classwork.ClassworkAccessService import assignment_allows_student
from app.services.classwork.ClassworkShared import is_quiz_type
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
})


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
        _SYSTEM_PROMPT,
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
        detail_level="DETAILED" if context.answer_release_authorized else "GENERAL",
        answer_release_authorized=context.answer_release_authorized,
        attempt_count=context.attempt_count,
        evidence_item_count=len(context.questions),
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
                "Quiz evidence changed; generate and review a new suggestion",
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
