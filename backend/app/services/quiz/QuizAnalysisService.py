from datetime import datetime, timezone
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
    QuizStudentQuestionAnswerOut,
    QuizStudentScoreOut,
    TeacherGradeQuizSubmissionRequest,
    TeacherQuizAnswerOut,
    TeacherQuizSubmissionDetailResponse,
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
        .options(selectinload(StudentSubmission.quiz_answers))
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
    
    answers_out = []
    if submission:
        for answer in getattr(submission, "quiz_answers", []):
            answers_out.append(
                QuizStudentQuestionAnswerOut(
                    quiz_question_id=answer.quiz_question_id,
                    is_correct=answer.is_correct,
                    points_awarded=float(answer.points_awarded) if answer.points_awarded is not None else None,
                )
            )
            
    needs_grading = bool(
        submission
        and submission.status in {"submitted", "late"}
        and any(answer.points_awarded is None for answer in getattr(submission, "quiz_answers", []))
    )
    return QuizStudentScoreOut(
        student_id=str(student.student_id),
        student_name=_student_name(student),
        submission_id=submission.submission_id if submission else None,
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
        answers=answers_out,
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
        str(part)
        for part in [
            student.first_name,
            student.middle_name,
            student.last_name,
            student.suffix,
        ]
        if part
    )


def get_teacher_quiz_submission_detail(
    db: Session,
    staff_id: str,
    submission_id: int,
) -> TeacherQuizSubmissionDetailResponse:
    submission = db.query(StudentSubmission).filter(StudentSubmission.submission_id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

    assignment = db.query(ClassworkAssignment).filter(
        ClassworkAssignment.classwork_assignment_id == submission.classwork_assignment_id
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    classwork = get_teacher_quiz_classwork(db, staff_id, assignment.classwork_id)
    quiz = _quiz_with_questions(db, classwork.classwork_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")

    student = db.query(Student).filter(Student.student_id == submission.student_id).first()
    student_name = _student_name(student) if student else "Student"

    existing_answers = {
        ans.quiz_question_id: ans
        for ans in db.query(QuizAnswer).filter(QuizAnswer.submission_id == submission.submission_id).all()
    }

    answers_out: list[TeacherQuizAnswerOut] = []
    links = sorted(quiz.questions, key=lambda q: q.display_order)
    for link in links:
        question = link.question
        ans = existing_answers.get(link.quiz_question_id)
        answers_out.append(
            TeacherQuizAnswerOut(
                answer_id=ans.answer_id if ans else None,
                quiz_question_id=link.quiz_question_id,
                question_text=question.question_text,
                question_type=question.question_type,
                max_points=float(question.points),
                answer_text=ans.answer_text if ans else None,
                is_correct=ans.is_correct if ans else None,
                points_awarded=float(ans.points_awarded) if ans and ans.points_awarded is not None else None,
            )
        )

    total_pts = float(classwork.total_points) if classwork.total_points is not None else 0.0
    grade_val = float(submission.grade) if submission.grade is not None else None
    needs_g = any(a.points_awarded is None for a in answers_out)

    return TeacherQuizSubmissionDetailResponse(
        submission_id=submission.submission_id,
        classwork_id=classwork.classwork_id,
        student_id=str(submission.student_id),
        student_name=student_name,
        status=submission.status,
        attempt_count=submission.attempt_count,
        total_points=total_pts,
        grade=grade_val,
        feedback=submission.feedback,
        submitted_at=submission.submitted_at,
        graded_at=submission.graded_at,
        needs_grading=needs_g,
        answers=answers_out,
    )


def grade_teacher_quiz_submission(
    db: Session,
    staff_id: str,
    submission_id: int,
    payload: TeacherGradeQuizSubmissionRequest,
) -> TeacherQuizSubmissionDetailResponse:
    submission = db.query(StudentSubmission).filter(StudentSubmission.submission_id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

    assignment = db.query(ClassworkAssignment).filter(
        ClassworkAssignment.classwork_assignment_id == submission.classwork_assignment_id
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    classwork = get_teacher_quiz_classwork(db, staff_id, assignment.classwork_id)
    quiz = _quiz_with_questions(db, classwork.classwork_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")

    question_map = {link.quiz_question_id: link.question for link in quiz.questions}
    existing_answers = {
        ans.quiz_question_id: ans
        for ans in db.query(QuizAnswer).filter(QuizAnswer.submission_id == submission.submission_id).all()
    }

    for grade_item in payload.answers:
        if grade_item.quiz_question_id not in question_map:
            continue
        question = question_map[grade_item.quiz_question_id]
        if grade_item.points_awarded < 0:
            raise HTTPException(status_code=400, detail="Points awarded cannot be negative")
        if grade_item.points_awarded > float(question.points):
            raise HTTPException(
                status_code=400,
                detail=f"Points awarded cannot exceed question maximum ({question.points})",
            )

        pts_decimal = Decimal(str(grade_item.points_awarded))
        is_corr = grade_item.is_correct
        if is_corr is None:
            if pts_decimal == Decimal(str(question.points)):
                is_corr = True
            elif pts_decimal == Decimal("0"):
                is_corr = False

        answer_obj = existing_answers.get(grade_item.quiz_question_id)
        if not answer_obj:
            answer_obj = QuizAnswer(
                quiz_question_id=grade_item.quiz_question_id,
                submission_id=submission.submission_id,
                answer_text=None,
            )
            db.add(answer_obj)

        answer_obj.points_awarded = pts_decimal
        answer_obj.is_correct = is_corr

    db.flush()

    if payload.override_total_grade is not None:
        if payload.override_total_grade < 0:
            raise HTTPException(status_code=400, detail="Grade cannot be negative")
        if classwork.total_points is not None and payload.override_total_grade > float(classwork.total_points):
            raise HTTPException(
                status_code=400,
                detail=f"Grade cannot be greater than total points ({classwork.total_points})",
            )
        submission.grade = Decimal(str(payload.override_total_grade))
    else:
        all_answers = db.query(QuizAnswer).filter(QuizAnswer.submission_id == submission.submission_id).all()
        total_awarded = sum(
            (ans.points_awarded for ans in all_answers if ans.points_awarded is not None),
            Decimal("0"),
        )
        submission.grade = total_awarded

    if payload.feedback is not None:
        submission.feedback = payload.feedback

    submission.status = "graded"
    submission.graded_at = datetime.now(timezone.utc)
    submission.graded_by_staff_id = staff_id

    db.commit()
    db.refresh(submission)
    return get_teacher_quiz_submission_detail(db, staff_id, submission_id)
