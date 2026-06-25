from decimal import Decimal
from typing import Iterable

from fastapi import HTTPException
from sqlalchemy.orm import Session, selectinload

from app.models.academic.StudentCLass import StudentClass
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.Student import Student
from app.models.quiz.Question import Question
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Quiz import (
    QuizAnalysisResponse,
    QuizOptionDistributionOut,
    QuizQuestionAnalysisOut,
    QuizStudentScoreOut,
)
from app.services.quiz.QuizBuilderService import get_teacher_quiz_classwork


TURNED_IN_STATUSES = {"submitted", "late", "graded"}


def build_teacher_quiz_analysis(
    db: Session,
    staff_id: str,
    classwork_id: int,
) -> QuizAnalysisResponse:
    """Summarize student participation, scores, and question-level outcomes."""
    classwork = get_teacher_quiz_classwork(db, staff_id, classwork_id)
    quiz = _quiz_with_questions(db, classwork.classwork_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz has not been created")

    assignments = db.query(ClassworkAssignment).filter(
        ClassworkAssignment.classwork_id == classwork.classwork_id
    ).all()
    assignment_ids = [assignment.classwork_assignment_id for assignment in assignments]
    class_ids = [assignment.class_id for assignment in assignments]
    roster = _roster(db, class_ids)
    submissions = _submissions(db, assignment_ids)
    submissions_by_student = {str(submission.student_id): submission for submission in submissions}

    total_points = Decimal(str(classwork.total_points)) if classwork.total_points is not None else None
    student_rows = [
        _student_score_out(student, submissions_by_student.get(str(student.student_id)), total_points)
        for student in roster
    ]
    submitted = [
        row for row in student_rows
        if row.status in TURNED_IN_STATUSES or row.attempt_count > 0
    ]
    graded = [row for row in student_rows if row.status == "graded"]
    needs_grading_count = sum(1 for row in student_rows if row.needs_grading)
    average_score = _average([row.grade for row in submitted if row.grade is not None])
    class_accuracy = (
        round((average_score / float(total_points)) * 100, 2)
        if average_score is not None and total_points and total_points > 0
        else None
    )

    answers = _answers_for_submissions(db, [submission.submission_id for submission in submissions])
    questions = [
        _question_analysis(link, answers.get(link.quiz_question_id, []))
        for link in sorted(quiz.questions, key=lambda item: item.display_order)
    ]

    return QuizAnalysisResponse(
        quiz_id=quiz.quiz_id,
        classwork_id=classwork.classwork_id,
        title=classwork.title,
        total_points=float(total_points) if total_points is not None else None,
        total_students=len(roster),
        submitted_count=len(submitted),
        missing_count=max(len(roster) - len(submitted), 0),
        graded_count=len(graded),
        needs_grading_count=needs_grading_count,
        average_score=average_score,
        class_accuracy_percent=class_accuracy,
        questions=questions,
        students=student_rows,
    )


def _quiz_with_questions(db: Session, classwork_id: int) -> Quiz | None:
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


def _roster(db: Session, class_ids: list[int]) -> list[Student]:
    if not class_ids:
        return []
    return (
        db.query(Student)
        .join(StudentClass, StudentClass.student_id == Student.student_id)
        .filter(
            StudentClass.class_id.in_(class_ids),
            StudentClass.enrollment_status == "enrolled",
        )
        .order_by(Student.last_name.asc(), Student.first_name.asc())
        .all()
    )


def _submissions(db: Session, assignment_ids: list[int]) -> list[StudentSubmission]:
    if not assignment_ids:
        return []
    return (
        db.query(StudentSubmission)
        .filter(StudentSubmission.classwork_assignment_id.in_(assignment_ids))
        .all()
    )


def _answers_for_submissions(
    db: Session,
    submission_ids: list[int],
) -> dict[int, list[QuizAnswer]]:
    if not submission_ids:
        return {}
    answers = db.query(QuizAnswer).filter(QuizAnswer.submission_id.in_(submission_ids)).all()
    grouped: dict[int, list[QuizAnswer]] = {}
    for answer in answers:
        grouped.setdefault(answer.quiz_question_id, []).append(answer)
    return grouped


def _student_score_out(
    student: Student,
    submission: StudentSubmission | None,
    total_points: Decimal | None,
) -> QuizStudentScoreOut:
    grade = float(submission.grade) if submission and submission.grade is not None else None
    needs_grading = bool(
        submission
        and submission.status in {"submitted", "late"}
        and any(answer.points_awarded is None for answer in getattr(submission, "quiz_answers", []))
    )
    return QuizStudentScoreOut(
        student_id=str(student.student_id),
        student_name=_student_name(student),
        status=submission.status if submission else "not_submitted",
        attempt_count=submission.attempt_count if submission else 0,
        grade=grade,
        score_percent=(
            round((grade / float(total_points)) * 100, 2)
            if grade is not None and total_points and total_points > 0
            else None
        ),
        submitted_at=submission.submitted_at if submission else None,
        needs_grading=needs_grading,
    )


def _question_analysis(
    link: QuizQuestion,
    answers: list[QuizAnswer],
) -> QuizQuestionAnalysisOut:
    question = link.question
    answered_count = len(answers)
    correct_count = sum(1 for answer in answers if answer.is_correct is True)
    accuracy = (
        round((correct_count / answered_count) * 100, 2)
        if answered_count and question.question_type == "MULTIPLE_CHOICE"
        else None
    )
    needs_grading_count = sum(1 for answer in answers if answer.points_awarded is None)
    return QuizQuestionAnalysisOut(
        quiz_question_id=link.quiz_question_id,
        question_text=question.question_text,
        question_type=question.question_type,
        points=float(question.points),
        answered_count=answered_count,
        correct_count=correct_count,
        accuracy_percent=accuracy,
        needs_grading_count=needs_grading_count,
        option_distribution=[
            QuizOptionDistributionOut(
                option_id=option.option_id,
                option_text=option.option_text,
                is_correct=option.is_correct,
                selected_count=sum(1 for answer in answers if answer.answer_text == option.option_text),
            )
            for option in sorted(question.options, key=lambda item: item.option_order)
        ],
    )


def _average(values: Iterable[float]) -> float | None:
    values = list(values)
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def _student_name(student: Student) -> str:
    return " ".join(
        part
        for part in [
            student.first_name,
            student.middle_name,
            student.last_name,
            student.suffix,
        ]
        if part
    )
