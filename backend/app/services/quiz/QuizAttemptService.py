from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
import random

from fastapi import HTTPException
from sqlalchemy.orm import Session, selectinload

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.Student import Student
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizSetting import QuizSetting
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Quiz import (
    QuizAnswerIn,
    QuizAttemptOptionOut,
    QuizAttemptQuestionOut,
    QuizAttemptResponse,
    QuizSubmitRequest,
)
from app.services.classwork.ClassworkShared import (
    assignment_is_available,
    assignment_is_locked,
    aware_utc,
    is_quiz_type,
)
from app.services.classwork.ClassworkAccessService import assignment_allows_student
from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService
from app.services.prediction.DevelopmentGradeRefreshService import refresh_after_committed_grade_change
from app.services.grading.PassingThresholdReader import read_passing_threshold_context
from app.services.grading.PassingThresholdResolver import (
    PassingThresholdConfigurationError,
    resolve_passing_threshold,
)
from app.services.grading.RemedialExamination import effective_grade_changed, ensure_remedial_period_open
from app.services.intervention.RemediationPrerequisiteService import require_remediation_prerequisite
from app.services.quiz.quiz_normalization import is_identification_correct
from app.services.quiz.QuizResultsReleasePolicy import (
    quiz_results_are_visible,
)


COMPLETED_ATTEMPT_STATUSES = frozenset({"submitted", "late", "graded"})
STUDY_SUPPORT_QUIZ_PASSED_MESSAGE = (
    "You've successfully completed this Study Support assessment. No further attempts are needed."
)
INVALID_SUMMARY_RELEASE_MESSAGE = (
    "Your quiz has been submitted successfully. "
    "Your quiz summary is currently unavailable."
)


@dataclass(frozen=True)
class _AttemptFeedbackVisibility:
    """Independent student-facing visibility decisions for attempt feedback.

    Keeping each decision separate prevents summary availability from being
    treated as permission to expose every feedback type.
    """

    student_response: bool
    evaluation: bool
    correct_answers: bool
    explanation: bool
    teacher_comment: bool


def get_student_quiz_attempt(
    db: Session,
    student: Student,
    assignment_id: int,
) -> QuizAttemptResponse:
    assignment, classwork, quiz = _student_quiz_scope(db, student, assignment_id)
    require_remediation_prerequisite(
        db, assignment, student, allow_completed_resolved_review=True,
    )
    submission = _submission_for(db, student, assignment_id)
    return _attempt_response(
        db,
        assignment,
        classwork,
        quiz,
        submission,
        student_id=student.student_id,
    )


def start_student_quiz_attempt(
    db: Session,
    student: Student,
    assignment_id: int,
) -> QuizAttemptResponse:
    assignment, classwork, quiz = _student_quiz_scope(db, student, assignment_id)
    _assert_student_quiz_write_scope(db, student, assignment, classwork)
    require_remediation_prerequisite(db, assignment, student)
    _ensure_before_due(assignment)
    ensure_remedial_period_open(db, assignment, student.student_id)
    _lock_assignment_row(db, assignment_id)
    submission = _submission_for(db, student, assignment_id, lock_for_update=True)
    previous_grade = submission.grade if submission else None
    has_passed, _threshold = evaluate_intervention_quiz_pass(
        db, assignment, classwork, submission, quiz=quiz,
    )
    if has_passed:
        raise HTTPException(status_code=403, detail=STUDY_SUPPORT_QUIZ_PASSED_MESSAGE)
    max_attempts = _max_attempts(db, assignment, classwork)
    if submission and submission.status != "pending" and submission.attempt_count >= max_attempts:
        raise HTTPException(status_code=403, detail="Maximum attempts reached")

    if not submission:
        submission = StudentSubmission(
            student_id=student.student_id,
            classwork_assignment_id=assignment_id,
            status="pending",
            attempt_count=0,
        )
        db.add(submission)
    elif submission.status != "pending":
        if assignment.source_intervention_id is not None:
            # Intervention retakes are independent attempts. Keep the completed
            # submission and its answers intact, and give the new attempt its
            # own identity and start time.
            submission = StudentSubmission(
                student_id=student.student_id,
                classwork_assignment_id=assignment_id,
                status="pending",
                attempt_count=submission.attempt_count,
            )
            db.add(submission)
        else:
            # Preserve the existing single-row behavior for regular quizzes.
            submission.status = "pending"
            submission.submitted_at = None
            submission.grade = None
            submission.feedback = None
            submission.graded_at = None
            submission.graded_by_staff_id = None
    refresh_needed = classwork.is_graded and effective_grade_changed(db, assignment, student.student_id, previous_grade, submission.grade)
    db.commit()
    db.refresh(submission)
    if refresh_needed:
        refresh_after_committed_grade_change(
            db.get_bind(),
            student_ids=[student.student_id],
            class_id=assignment.class_id,
            subject_id=classwork.subject_id,
            period_id=assignment.academic_period_id,
        )
    return _attempt_response(
        db,
        assignment,
        classwork,
        quiz,
        submission,
        student_id=student.student_id,
    )


def submit_student_quiz_attempt(
    db: Session,
    student: Student,
    assignment_id: int,
    payload: QuizSubmitRequest,
) -> QuizAttemptResponse:
    assignment, classwork, quiz = _student_quiz_scope(db, student, assignment_id)
    _assert_student_quiz_write_scope(db, student, assignment, classwork)
    require_remediation_prerequisite(db, assignment, student)
    ensure_remedial_period_open(db, assignment, student.student_id)
    _lock_assignment_row(db, assignment_id)
    submission = _submission_for(db, student, assignment_id, lock_for_update=True)
    previous_grade = submission.grade if submission else None
    has_passed, _threshold = evaluate_intervention_quiz_pass(
        db, assignment, classwork, submission, quiz=quiz,
    )
    if has_passed:
        raise HTTPException(status_code=403, detail=STUDY_SUPPORT_QUIZ_PASSED_MESSAGE)
    if not submission:
        _ensure_before_due(assignment)
        submission = StudentSubmission(
            student_id=student.student_id,
            classwork_assignment_id=assignment_id,
            status="pending",
            attempt_count=0,
        )
        db.add(submission)
        db.flush()

    max_attempts = _max_attempts(db, assignment, classwork)
    if submission.status != "pending" and submission.attempt_count >= max_attempts:
        raise HTTPException(status_code=403, detail="Maximum attempts reached")
    if submission.status == "pending" and submission.attempt_count >= max_attempts:
        raise HTTPException(status_code=403, detail="Maximum attempts reached")

    if assignment.source_intervention_id is not None and submission.status != "pending":
        # A client may submit a permitted retake without calling /start first.
        # Never overwrite the completed Intervention attempt in that path.
        submission = StudentSubmission(
            student_id=student.student_id,
            classwork_assignment_id=assignment_id,
            status="pending",
            attempt_count=submission.attempt_count,
        )
        db.add(submission)
        db.flush()

    now = datetime.now(timezone.utc)
    due_date = aware_utc(assignment.due_date)
    if due_date and now > due_date and not _pending_started_before_due(submission, due_date):
        raise HTTPException(status_code=403, detail="Quiz is closed")

    links = _ordered_quiz_questions(quiz)
    answers_by_question = {answer.quiz_question_id: answer for answer in payload.answers}
    if set(answers_by_question) != {link.quiz_question_id for link in links}:
        raise HTTPException(status_code=400, detail="Answer every quiz question before submitting")

    for existing in list(getattr(submission, "quiz_answers", [])):
        db.delete(existing)
    db.flush()

    total_score = Decimal("0")
    has_manual = False
    for link in links:
        answer = answers_by_question[link.quiz_question_id]
        question = link.question
        is_ident = (question.question_type == "IDENTIFICATION")
        has_correct_options = any(
            bool(opt.is_correct) and bool(opt.option_text and opt.option_text.strip())
            for opt in (getattr(question, "options", None) or [])
        )
        if question.question_type == "MULTIPLE_CHOICE":
            selected = _option_for_answer(question, answer.selected_option_id)
            # Timed autosubmit can include unanswered items; store them as zero.
            if not selected:
                db.add(QuizAnswer(
                    quiz_question_id=link.quiz_question_id,
                    submission_id=submission.submission_id,
                    answer_text=None,
                    is_correct=False,
                    points_awarded=Decimal("0"),
                ))
                continue
            is_correct = selected.is_correct
            points_awarded = Decimal(str(question.points)) if is_correct else Decimal("0")
            total_score += points_awarded
            db.add(QuizAnswer(
                quiz_question_id=link.quiz_question_id,
                submission_id=submission.submission_id,
                answer_text=selected.option_text,
                is_correct=is_correct,
                points_awarded=points_awarded,
            ))
        elif is_ident or (question.question_type == "SHORT_ANSWER" and has_correct_options):
            # IDENTIFICATION (and legacy keyed SHORT_ANSWER before migration): auto-graded using normalized comparison
            accepted_keys = [
                opt.option_text
                for opt in (getattr(question, "options", None) or [])
                if opt.option_text and opt.option_text.strip() and (opt.is_correct is None or opt.is_correct is True)
            ]
            student_ans = (answer.answer_text or "").strip()
            if not accepted_keys:
                # Zero non-blank keys -> route to manual grading, never auto-fail students
                has_manual = True
                db.add(QuizAnswer(
                    quiz_question_id=link.quiz_question_id,
                    submission_id=submission.submission_id,
                    answer_text=student_ans,
                    is_correct=None,
                    points_awarded=None,
                ))
                continue

            if not student_ans:
                db.add(QuizAnswer(
                    quiz_question_id=link.quiz_question_id,
                    submission_id=submission.submission_id,
                    answer_text="",
                    is_correct=False,
                    points_awarded=Decimal("0"),
                ))
                continue

            is_match = is_identification_correct(student_ans, accepted_keys)
            points_awarded = Decimal(str(question.points)) if is_match else Decimal("0")
            total_score += points_awarded
            db.add(QuizAnswer(
                quiz_question_id=link.quiz_question_id,
                submission_id=submission.submission_id,
                answer_text=student_ans,
                is_correct=is_match,
                points_awarded=points_awarded,
            ))

        else:
            # Unkeyed SHORT_ANSWER: manual grading
            student_ans = (answer.answer_text or "").strip()
            if not student_ans:
                db.add(QuizAnswer(
                    quiz_question_id=link.quiz_question_id,
                    submission_id=submission.submission_id,
                    answer_text="",
                    is_correct=False,
                    points_awarded=Decimal("0"),
                ))
                continue
            has_manual = True
            db.add(QuizAnswer(
                quiz_question_id=link.quiz_question_id,
                submission_id=submission.submission_id,
                answer_text=student_ans,
                is_correct=None,
                points_awarded=None,
            ))

    submission.attempt_count += 1
    submission.submitted_at = now
    submission.grade = total_score
    if has_manual:
        submission.status = "late" if due_date and now > due_date else "submitted"
        submission.graded_at = None
    else:
        submission.status = "graded"
        submission.graded_at = now
        from app.services.submission.SubmissionFeedbackService import (
            enqueue_automatic_feedback_draft,
            dispatch_background_draft_processing,
        )
        enqueue_automatic_feedback_draft(db, submission.submission_id, None)

    if assignment.source_intervention_id is not None and classwork.is_graded:
        from app.services.intervention.InterventionNotificationService import (
            stage_intervention_assessment_result_or_submission,
            stage_intervention_assessment_submitted,
        )
        db.flush()
        if has_manual:
            stage_intervention_assessment_submitted(db, assignment, submission)
        else:
            stage_intervention_assessment_result_or_submission(db, assignment, submission)

    refresh_needed = classwork.is_graded and effective_grade_changed(db, assignment, student.student_id, previous_grade, submission.grade)
    db.commit()
    db.refresh(submission)
    if not has_manual:
        dispatch_background_draft_processing()
    if refresh_needed:
        refresh_after_committed_grade_change(
            db.get_bind(),
            student_ids=[student.student_id],
            class_id=assignment.class_id,
            subject_id=classwork.subject_id,
            period_id=assignment.academic_period_id,
        )
    return _attempt_response(
        db,
        assignment,
        classwork,
        quiz,
        submission,
        student_id=student.student_id,
    )


def _student_quiz_scope(
    db: Session,
    student: Student,
    assignment_id: int,
) -> tuple[ClassworkAssignment, Classwork, Quiz]:
    assignment = db.query(ClassworkAssignment).filter(
        ClassworkAssignment.classwork_assignment_id == assignment_id
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if not assignment_allows_student(assignment, student.student_id):
        raise HTTPException(status_code=404, detail="Assignment not found")
    classwork = db.query(Classwork).filter(Classwork.classwork_id == assignment.classwork_id).first()
    if not classwork or classwork.is_archived:
        raise HTTPException(status_code=404, detail="Classwork not found")
    if not is_quiz_type(classwork.classwork_type):
        raise HTTPException(status_code=400, detail="Classwork is not a quiz")
    if not assignment_is_available(assignment):
        raise HTTPException(status_code=403, detail="This quiz is not available")
    if assignment_is_locked(assignment):
        raise HTTPException(status_code=403, detail="This quiz is locked")
    if not db.query(StudentClass).filter(
        StudentClass.student_id == student.student_id,
        StudentClass.class_id == assignment.class_id,
        StudentClass.enrollment_status == "enrolled",
    ).first():
        raise HTTPException(status_code=403, detail="Not enrolled in this class")

    quiz = (
        db.query(Quiz)
        .options(
            selectinload(Quiz.questions)
            .selectinload(QuizQuestion.question)
            .selectinload(Question.options)
        )
        .filter(Quiz.classwork_id == classwork.classwork_id)
        .first()
    )
    if not quiz or quiz.status not in {"READY", "PUBLISHED"}:
        raise HTTPException(status_code=404, detail="Quiz has not been published")
    if not quiz.questions:
        raise HTTPException(status_code=400, detail="Quiz has no questions")
    return assignment, classwork, quiz


def _assert_student_quiz_write_scope(
    db: Session,
    student: Student,
    assignment: ClassworkAssignment,
    classwork: Classwork,
) -> None:
    if assignment.academic_period_id is None:
        raise HTTPException(status_code=403, detail="Quiz has an unscoped academic period")

    class_ = db.get(Class, assignment.class_id)
    period = db.get(AcademicPeriod, assignment.academic_period_id)
    if class_ is None or period is None or class_.academic_year_id != period.academic_year_id:
        raise HTTPException(status_code=403, detail="Quiz academic context is invalid")

    SubjectLoadAuthorizationService.assert_context_writable(
        db,
        class_id=assignment.class_id,
        academic_period_id=assignment.academic_period_id,
        block_future_period_in_current_year=True,
    )

    enrollment = db.query(StudentClass.student_class_id).filter(
        StudentClass.student_id == student.student_id,
        StudentClass.class_id == assignment.class_id,
        StudentClass.academic_year_id == period.academic_year_id,
        StudentClass.enrollment_status == "enrolled",
    ).first()
    if enrollment is None:
        raise HTTPException(status_code=403, detail="Not enrolled in this class for this academic year")

    finalized = db.query(StudentPeriodGrade.period_grade_id).filter(
        StudentPeriodGrade.student_id == student.student_id,
        StudentPeriodGrade.class_id == assignment.class_id,
        StudentPeriodGrade.subject_id == classwork.subject_id,
        StudentPeriodGrade.academic_period_id == assignment.academic_period_id,
        StudentPeriodGrade.is_finalized.is_(True),
    ).first()
    if finalized is not None:
        raise HTTPException(status_code=409, detail="The period grade is finalized")


def _lock_assignment_row(db: Session, assignment_id: int) -> None:
    db.query(ClassworkAssignment.classwork_assignment_id).filter(
        ClassworkAssignment.classwork_assignment_id == assignment_id,
    ).with_for_update().first()


def _intervention_quiz_passing_threshold(
    db: Session,
    assignment: ClassworkAssignment,
    classwork: Classwork,
) -> Decimal | None:
    """Resolve the subject passing threshold for an Intervention/Study Support quiz."""
    if assignment.source_intervention_id is None or not is_quiz_type(classwork.classwork_type):
        return None
    academic_year_id: int | None = None
    if assignment.class_id is not None:
        class_row = db.get(Class, assignment.class_id)
        if class_row is not None:
            academic_year_id = class_row.academic_year_id
    if academic_year_id is None and assignment.academic_period_id is not None:
        period_row = db.get(AcademicPeriod, assignment.academic_period_id)
        if period_row is not None:
            academic_year_id = period_row.academic_year_id
    if academic_year_id is None or classwork.subject_id is None:
        return None
    try:
        context = read_passing_threshold_context(
            db,
            academic_year_id=academic_year_id,
            subject_ids=[classwork.subject_id],
            academic_period_id=assignment.academic_period_id,
        )
        resolution = resolve_passing_threshold(
            context,
            academic_year_id=academic_year_id,
            scope="subject",
            subject_id=classwork.subject_id,
        )
        return resolution.threshold
    except PassingThresholdConfigurationError:
        return None


def _quiz_max_points(classwork: Classwork, quiz: Quiz | None) -> Decimal:
    if classwork.total_points is not None:
        total = Decimal(str(classwork.total_points))
        if total > 0:
            return total
    if quiz is not None and quiz.questions:
        return sum(
            (Decimal(str(link.question.points)) for link in quiz.questions if link.question is not None),
            Decimal("0"),
        )
    return Decimal("0")


def evaluate_intervention_quiz_pass(
    db: Session,
    assignment: ClassworkAssignment,
    classwork: Classwork,
    submission: StudentSubmission | None,
    *,
    quiz: Quiz | None = None,
) -> tuple[bool, Decimal | None]:
    """Return (is_passed, passing_threshold) for an Intervention/Study Support quiz."""
    if assignment.source_intervention_id is None or not is_quiz_type(classwork.classwork_type):
        return False, None
    threshold = _intervention_quiz_passing_threshold(db, assignment, classwork)
    if threshold is None or submission is None or submission.status != "graded" or submission.grade is None:
        return False, threshold
    max_points = _quiz_max_points(classwork, quiz)
    if max_points <= 0:
        return False, threshold
    is_passed = Decimal(str(submission.grade)) * Decimal("100") >= threshold * max_points
    return is_passed, threshold


def _submission_for(
    db: Session,
    student: Student,
    assignment_id: int,
    *,
    lock_for_update: bool = False,
) -> StudentSubmission | None:
    query = db.query(StudentSubmission).filter(
        StudentSubmission.classwork_assignment_id == assignment_id,
        StudentSubmission.student_id == student.student_id,
    )
    if lock_for_update:
        query = query.with_for_update()
    return query.order_by(StudentSubmission.submission_id.desc()).first()


def _max_attempts(db: Session, assignment: ClassworkAssignment, classwork: Classwork) -> int:
    if assignment.original_exam_assignment_id is not None:
        return 1
    setting = db.query(QuizSetting).filter(QuizSetting.classwork_id == classwork.classwork_id).first()
    return assignment.max_attempts or (setting.max_attempts if setting else None) or 1


def _ordered_quiz_questions(quiz: Quiz) -> list[QuizQuestion]:
    return sorted(quiz.questions, key=lambda link: link.display_order)


def _deterministic_shuffle(items: list, seed_key: str) -> list:
    if len(items) <= 1:
        return list(items)
    shuffled = list(items)
    rng = random.Random(seed_key)
    rng.shuffle(shuffled)
    if shuffled == list(items):
        offset = 1 if len(items) == 2 else rng.randint(1, len(items) - 1)
        shuffled = shuffled[offset:] + shuffled[:offset]
    return shuffled


def _option_for_answer(question: Question, option_id: int | None) -> QuestionOption | None:
    if option_id is None:
        return None
    option = next((item for item in question.options if item.option_id == option_id), None)
    if not option:
        raise HTTPException(status_code=400, detail="Selected option does not belong to the question")
    return option


def _ensure_before_due(assignment: ClassworkAssignment) -> None:
    due_date = aware_utc(assignment.due_date)
    if due_date and datetime.now(timezone.utc) > due_date:
        raise HTTPException(status_code=403, detail="Quiz is closed")


def _pending_started_before_due(submission: StudentSubmission, due_date: datetime) -> bool:
    created_at = aware_utc(submission.created_at)
    return bool(created_at and created_at <= due_date)


def _attempt_response(
    db: Session,
    assignment: ClassworkAssignment,
    classwork: Classwork,
    quiz: Quiz,
    submission: StudentSubmission | None,
    reveal_answers: bool = False,
    *,
    student_id: str | None = None,
) -> QuizAttemptResponse:
    setting = db.query(QuizSetting).filter(QuizSetting.classwork_id == classwork.classwork_id).first()
    summary_available, release_at, summary_message = _summary_release_state(setting, assignment, submission)
    is_intervention_quiz = assignment.source_intervention_id is not None
    is_passed, passing_threshold = evaluate_intervention_quiz_pass(
        db, assignment, classwork, submission, quiz=quiz,
    )
    max_attempts = _max_attempts(db, assignment, classwork)
    attempt_count = submission.attempt_count if submission else 0
    can_submit = _can_submit(
        db, assignment, classwork, submission, is_passed=is_passed,
    )
    # A visible policy grants access only once its configured release condition
    # has actually been reached. This keeps grades out of early scheduled and
    # after-due-date responses while preserving submission status information.
    show_scores = quiz_results_are_visible(
        classwork,
        setting,
        assignment,
        submission_status=submission.status if submission else None,
    )
    visibility = _attempt_feedback_visibility(
        setting,
        submission,
        summary_available=summary_available,
        show_scores=show_scores,
        reveal_answers=reveal_answers,
        retake_available=can_submit,
    )
    answers = {
        answer.quiz_question_id: answer
        for answer in (getattr(submission, "quiz_answers", []) if submission else [])
    }
    resolved_student_id = (
        student_id
        or (submission.student_id if submission else None)
        or assignment.recipient_student_id
        or "student"
    )
    if submission is None:
        active_attempt_number = 1
    elif submission.status == "pending":
        active_attempt_number = (submission.attempt_count or 0) + 1
    else:
        active_attempt_number = max(1, submission.attempt_count or 1)
    attempt_seed_prefix = (
        f"{quiz.quiz_id}:{assignment.classwork_assignment_id}:{resolved_student_id}:{active_attempt_number}"
    )
    ordered_links = _ordered_quiz_questions(quiz)
    if setting and setting.is_shuffle_questions:
        ordered_links = _deterministic_shuffle(ordered_links, f"{attempt_seed_prefix}:questions")
    shuffle_options = bool(setting and getattr(setting, "is_shuffle_options", False))
    return QuizAttemptResponse(
        quiz_id=quiz.quiz_id,
        submission_id=submission.submission_id if submission else None,
        classwork_assignment_id=assignment.classwork_assignment_id,
        classwork_id=classwork.classwork_id,
        title=classwork.title,
        instructions=classwork.instructions,
        total_points=float(classwork.total_points) if classwork.total_points is not None else None,
        duration_minutes=quiz.duration_minutes,
        max_attempts=max_attempts,
        attempt_count=attempt_count,
        attempts_used=attempt_count,
        attempts_remaining=0 if is_passed else max(0, max_attempts - attempt_count),
        status=submission.status if submission else "not_started",
        started_at=submission.created_at if submission else None,
        server_time=datetime.now(timezone.utc),
        submitted_at=submission.submitted_at if submission else None,
        grade=(
            float(submission.grade)
            if submission and submission.grade is not None and show_scores
            else None
        ),
        can_submit=can_submit,
        is_intervention_quiz=is_intervention_quiz,
        is_passed=is_passed,
        passing_threshold=(
            float(passing_threshold)
            if passing_threshold is not None and show_scores
            else None
        ),
        show_scores=show_scores,
        summary_available=summary_available,
        summary_release_mode=setting.summary_release_mode if setting else "IMMEDIATE",
        summary_release_at=release_at,
        summary_message=summary_message,
        feedback=(
            submission.feedback
            if submission and visibility.teacher_comment
            else None
        ),
        questions=[
            _attempt_question_out(
                link,
                answers.get(link.quiz_question_id),
                visibility,
                display_order=idx,
                shuffle_options=shuffle_options,
                option_seed_key=f"{attempt_seed_prefix}:options:{link.quiz_question_id}",
            )
            for idx, link in enumerate(ordered_links, start=1)
        ],
    )


def _attempt_feedback_visibility(
    setting: QuizSetting | None,
    submission: StudentSubmission | None,
    *,
    summary_available: bool,
    show_scores: bool,
    reveal_answers: bool = False,
    retake_available: bool = False,
) -> _AttemptFeedbackVisibility:
    status = submission.status if submission else None
    is_completed = status in COMPLETED_ATTEMPT_STATUSES
    student_response = bool(submission and (
        status == "pending"
        or (is_completed and summary_available and show_scores)
    ))
    # While an eligible retake remains permitted, withhold evaluation,
    # correctness markers, correct answers, and explanations from student views.
    evaluation = bool(
        is_completed
        and summary_available
        and show_scores
        and not retake_available
    )
    correct_answers = bool(
        evaluation
        and (reveal_answers or (setting and setting.show_correct_answers))
    )
    return _AttemptFeedbackVisibility(
        student_response=student_response,
        evaluation=evaluation,
        correct_answers=correct_answers,
        explanation=correct_answers,
        # The generic submission-detail contract exposes an existing teacher
        # comment to the submission owner independently of answer-summary
        # timing. Preserve that behavior for completed quiz submissions while
        # keeping comments out of active and pending-retake responses.
        teacher_comment=evaluation,
    )


def _summary_release_state(
    setting: QuizSetting | None,
    assignment: ClassworkAssignment,
    submission: StudentSubmission | None,
) -> tuple[bool, datetime | None, str | None]:
    if not submission or submission.status not in COMPLETED_ATTEMPT_STATUSES:
        return False, None, None
    mode = (setting.summary_release_mode if setting else "IMMEDIATE").strip().upper()
    now = datetime.now(timezone.utc)
    if mode == "IMMEDIATE":
        return True, None, None
    if mode == "NEVER":
        return False, None, "Your quiz has been submitted successfully. Your quiz summary is not available."
    if mode == "AFTER_DUE_DATE":
        release_at = aware_utc(assignment.due_date)
        if not release_at:
            return False, None, INVALID_SUMMARY_RELEASE_MESSAGE
        if now >= release_at:
            return True, release_at, None
        return False, release_at, _summary_release_message(release_at)
    if mode == "SCHEDULED":
        release_at = aware_utc(setting.summary_release_at if setting else None)
        if not release_at:
            return False, None, INVALID_SUMMARY_RELEASE_MESSAGE
        if now < release_at:
            return False, release_at, _summary_release_message(release_at)
        return True, release_at, None
    return False, None, INVALID_SUMMARY_RELEASE_MESSAGE


def _summary_release_message(release_at: datetime) -> str:
    return (
        "Your quiz has been submitted successfully. "
        f"Your quiz summary will be available on {release_at.isoformat()}."
    )


def _can_submit(
    db: Session,
    assignment: ClassworkAssignment,
    classwork: Classwork,
    submission: StudentSubmission | None,
    *,
    is_passed: bool = False,
) -> bool:
    if is_passed:
        return False
    if assignment.source_intervention_id is not None:
        from app.models.intervention.Intervention import Intervention

        intervention_status = (
            db.query(Intervention.status)
            .filter(Intervention.intervention_id == assignment.source_intervention_id)
            .scalar()
        )
        if intervention_status != "ACTIVE":
            return False
    due_date = aware_utc(assignment.due_date)
    if due_date and datetime.now(timezone.utc) > due_date and not (
        submission and submission.status == "pending" and _pending_started_before_due(submission, due_date)
    ):
        return False
    max_attempts = _max_attempts(db, assignment, classwork)
    return not submission or submission.status == "pending" or submission.attempt_count < max_attempts


def _attempt_question_out(
    link: QuizQuestion,
    answer: QuizAnswer | None,
    visibility: _AttemptFeedbackVisibility,
    *,
    display_order: int | None = None,
    shuffle_options: bool = False,
    option_seed_key: str | None = None,
) -> QuizAttemptQuestionOut:
    question = link.question
    selected_option_id = None
    if answer and visibility.student_response and question.question_type == "MULTIPLE_CHOICE":
        selected = next(
            (option.option_id for option in question.options if option.option_text == answer.answer_text),
            None,
        )
        selected_option_id = selected
    effective_question_type = (
        "IDENTIFICATION"
        if (
            question.question_type == "SHORT_ANSWER"
            and any(
                bool(opt.is_correct) and bool(opt.option_text and opt.option_text.strip())
                for opt in (getattr(question, "options", None) or [])
            )
        )
        else question.question_type
    )
    explanation = None
    if (
        visibility.explanation
        and answer
        and answer.points_awarded is not None
        and question.explanation
        and question.explanation.strip()
    ):
        explanation = question.explanation
    ordered_options = (
        sorted(question.options, key=lambda item: item.option_order)
        if question.question_type == "MULTIPLE_CHOICE"
        else []
    )
    if shuffle_options and ordered_options:
        ordered_options = _deterministic_shuffle(
            ordered_options,
            option_seed_key or f"options:{link.quiz_question_id}",
        )
    return QuizAttemptQuestionOut(
        quiz_question_id=link.quiz_question_id,
        question_text=question.question_text,
        question_type=effective_question_type,
        points=float(question.points),
        display_order=display_order if display_order is not None else link.display_order,
        options=[
            QuizAttemptOptionOut(
                option_id=option.option_id,
                option_text=option.option_text,
                option_order=idx if shuffle_options else option.option_order,
                is_correct=option.is_correct if visibility.correct_answers else None,
            )
            for idx, option in enumerate(ordered_options, start=1)
        ],
        answer_text=answer.answer_text if answer and visibility.student_response else None,
        selected_option_id=selected_option_id,
        points_awarded=(
            float(answer.points_awarded)
            if answer and visibility.evaluation and answer.points_awarded is not None
            else None
        ),
        is_correct=answer.is_correct if answer and visibility.evaluation else None,
        explanation=explanation,
    )
