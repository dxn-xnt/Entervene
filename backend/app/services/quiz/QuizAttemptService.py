from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session, selectinload

from app.models.academic.StudentCLass import StudentClass
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


def get_student_quiz_attempt(
    db: Session,
    student: Student,
    assignment_id: int,
) -> QuizAttemptResponse:
    assignment, classwork, quiz = _student_quiz_scope(db, student, assignment_id)
    submission = _submission_for(db, student, assignment_id)
    return _attempt_response(db, assignment, classwork, quiz, submission)


def start_student_quiz_attempt(
    db: Session,
    student: Student,
    assignment_id: int,
) -> QuizAttemptResponse:
    assignment, classwork, quiz = _student_quiz_scope(db, student, assignment_id)
    _ensure_before_due(assignment)

    submission = _submission_for(db, student, assignment_id)
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
        submission.status = "pending"
        submission.submitted_at = None
        submission.grade = None
        submission.feedback = None
        submission.graded_at = None
        submission.graded_by_staff_id = None
    db.commit()
    db.refresh(submission)
    return _attempt_response(db, assignment, classwork, quiz, submission)


def submit_student_quiz_attempt(
    db: Session,
    student: Student,
    assignment_id: int,
    payload: QuizSubmitRequest,
) -> QuizAttemptResponse:
    assignment, classwork, quiz = _student_quiz_scope(db, student, assignment_id)
    submission = _submission_for(db, student, assignment_id)
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
        else:
            # Blank short answers are also valid for autosubmit and receive zero points.
            if not answer.answer_text or not answer.answer_text.strip():
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
                answer_text=answer.answer_text.strip(),
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
    db.commit()
    db.refresh(submission)
    return _attempt_response(db, assignment, classwork, quiz, submission, reveal_answers=True)


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


def _submission_for(db: Session, student: Student, assignment_id: int) -> StudentSubmission | None:
    return db.query(StudentSubmission).filter(
        StudentSubmission.classwork_assignment_id == assignment_id,
        StudentSubmission.student_id == student.student_id,
    ).first()


def _max_attempts(db: Session, assignment: ClassworkAssignment, classwork: Classwork) -> int:
    setting = db.query(QuizSetting).filter(QuizSetting.classwork_id == classwork.classwork_id).first()
    return assignment.max_attempts or setting.max_attempts or 1


def _ordered_quiz_questions(quiz: Quiz) -> list[QuizQuestion]:
    return sorted(quiz.questions, key=lambda link: link.display_order)


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
) -> QuizAttemptResponse:
    setting = db.query(QuizSetting).filter(QuizSetting.classwork_id == classwork.classwork_id).first()
    should_reveal = reveal_answers or bool(
        setting and setting.show_correct_answers and submission and submission.status in {"submitted", "late", "graded"}
    )
    answers = {
        answer.quiz_question_id: answer
        for answer in (getattr(submission, "quiz_answers", []) if submission else [])
    }
    return QuizAttemptResponse(
        quiz_id=quiz.quiz_id,
        classwork_assignment_id=assignment.classwork_assignment_id,
        classwork_id=classwork.classwork_id,
        title=classwork.title,
        instructions=classwork.instructions,
        total_points=float(classwork.total_points) if classwork.total_points is not None else None,
        duration_minutes=quiz.duration_minutes,
        max_attempts=_max_attempts(db, assignment, classwork),
        attempt_count=submission.attempt_count if submission else 0,
        status=submission.status if submission else "not_started",
        started_at=submission.created_at if submission else None,
        server_time=datetime.now(timezone.utc),
        submitted_at=submission.submitted_at if submission else None,
        grade=float(submission.grade) if submission and submission.grade is not None else None,
        can_submit=_can_submit(db, assignment, classwork, submission),
        questions=[
            _attempt_question_out(link, answers.get(link.quiz_question_id), should_reveal)
            for link in _ordered_quiz_questions(quiz)
        ],
    )


def _can_submit(
    db: Session,
    assignment: ClassworkAssignment,
    classwork: Classwork,
    submission: StudentSubmission | None,
) -> bool:
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
    reveal_answers: bool,
) -> QuizAttemptQuestionOut:
    question = link.question
    selected_option_id = None
    if answer and question.question_type == "MULTIPLE_CHOICE":
        selected = next(
            (option.option_id for option in question.options if option.option_text == answer.answer_text),
            None,
        )
        selected_option_id = selected
    return QuizAttemptQuestionOut(
        quiz_question_id=link.quiz_question_id,
        question_text=question.question_text,
        question_type=question.question_type,
        points=float(question.points),
        display_order=link.display_order,
        options=[
            QuizAttemptOptionOut(
                option_id=option.option_id,
                option_text=option.option_text,
                option_order=option.option_order,
                is_correct=option.is_correct if reveal_answers else None,
            )
            for option in sorted(question.options, key=lambda item: item.option_order)
        ],
        answer_text=answer.answer_text if answer else None,
        selected_option_id=selected_option_id,
        points_awarded=float(answer.points_awarded) if answer and answer.points_awarded is not None else None,
        is_correct=answer.is_correct if answer else None,
    )
