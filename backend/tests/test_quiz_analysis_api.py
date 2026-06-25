import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Quizzes import router as quizzes_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizSetting import QuizSetting
from app.models.submissions.StudentSubmission import StudentSubmission


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    Subject.__table__,
    Class.__table__,
    StudentClass.__table__,
    Classwork.__table__,
    ClassworkAssignment.__table__,
    StudentSubmission.__table__,
    Quiz.__table__,
    QuizSetting.__table__,
    Question.__table__,
    QuestionOption.__table__,
    QuizQuestion.__table__,
    QuizAnswer.__table__,
]


@pytest.fixture
def quiz_analysis_context():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    lrn_check = next(
        constraint
        for constraint in Student.__table__.constraints
        if isinstance(constraint, CheckConstraint) and constraint.name == "lrn_check"
    )
    Student.__table__.constraints.remove(lrn_check)
    Base.metadata.create_all(bind=engine, tables=TABLES)
    Student.__table__.append_constraint(lrn_check)
    db = sessionmaker(bind=engine)()

    year = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add_all([year, level])
    db.flush()

    accounts = {
        name: UserAccount(user_id=uuid.uuid4(), email=f"{name}@example.test", password_hash="x")
        for name in ("owner", "other_teacher")
    }
    db.add_all(accounts.values())
    db.flush()
    owner = AcademicStaff(
        staff_id="T-OWNER",
        first_name="Owner",
        last_name="Teacher",
        user_id=accounts["owner"].user_id,
    )
    other_teacher = AcademicStaff(
        staff_id="T-OTHER",
        first_name="Other",
        last_name="Teacher",
        user_id=accounts["other_teacher"].user_id,
    )
    subject = Subject(subject_name="Programming", academic_level_id=level.academic_level_id)
    class_ = Class(
        section_name="Sapphire",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add_all([owner, other_teacher, subject, class_])
    db.flush()

    students = []
    for index, first_name in enumerate(("Ana", "Ben", "Cara"), start=1):
        student = Student(
            student_id=uuid.uuid4(),
            student_lrn=f"12345678901{index}",
            first_name=first_name,
            last_name="Learner",
            academic_level_id=level.academic_level_id,
        )
        students.append(student)
        db.add(student)
    db.flush()
    db.add_all([
        StudentClass(
            student_id=student.student_id,
            class_id=class_.class_id,
            academic_year_id=year.academic_year_id,
            enrollment_status="enrolled",
        )
        for student in students
    ])

    classwork = Classwork(
        title="Quiz Analysis",
        classwork_type="QUIZ",
        total_points=Decimal("10.00"),
        subject_id=subject.subject_id,
        created_by_staff_id=owner.staff_id,
        is_published=True,
    )
    db.add(classwork)
    db.flush()
    assignment = ClassworkAssignment(
        classwork_id=classwork.classwork_id,
        class_id=class_.class_id,
        assigned_by_staff_id=owner.staff_id,
        is_published=True,
        max_attempts=2,
    )
    quiz = Quiz(classwork_id=classwork.classwork_id, total_items=2, status="READY")
    setting = QuizSetting(classwork_id=classwork.classwork_id, max_attempts=2)
    db.add_all([assignment, quiz, setting])
    db.flush()

    mc = Question(
        question_text="What stores a value?",
        question_type="MULTIPLE_CHOICE",
        points=Decimal("6.00"),
        is_ai_generated=False,
    )
    short = Question(
        question_text="Explain variables.",
        question_type="SHORT_ANSWER",
        points=Decimal("4.00"),
        is_ai_generated=False,
    )
    db.add_all([mc, short])
    db.flush()
    correct = QuestionOption(question_id=mc.question_id, option_text="Variable", is_correct=True, option_order=1)
    wrong = QuestionOption(question_id=mc.question_id, option_text="Paintbrush", is_correct=False, option_order=2)
    mc_link = QuizQuestion(quiz_id=quiz.quiz_id, question_id=mc.question_id, display_order=1)
    short_link = QuizQuestion(quiz_id=quiz.quiz_id, question_id=short.question_id, display_order=2)
    db.add_all([correct, wrong, mc_link, short_link])
    db.flush()

    graded_submission = StudentSubmission(
        student_id=students[0].student_id,
        classwork_assignment_id=assignment.classwork_assignment_id,
        status="graded",
        grade=Decimal("10.00"),
        attempt_count=1,
    )
    manual_submission = StudentSubmission(
        student_id=students[1].student_id,
        classwork_assignment_id=assignment.classwork_assignment_id,
        status="submitted",
        grade=Decimal("6.00"),
        attempt_count=1,
    )
    db.add_all([graded_submission, manual_submission])
    db.flush()
    db.add_all([
        QuizAnswer(
            quiz_question_id=mc_link.quiz_question_id,
            submission_id=graded_submission.submission_id,
            answer_text=correct.option_text,
            is_correct=True,
            points_awarded=Decimal("6.00"),
        ),
        QuizAnswer(
            quiz_question_id=short_link.quiz_question_id,
            submission_id=graded_submission.submission_id,
            answer_text="Good explanation",
            is_correct=True,
            points_awarded=Decimal("4.00"),
        ),
        QuizAnswer(
            quiz_question_id=mc_link.quiz_question_id,
            submission_id=manual_submission.submission_id,
            answer_text=wrong.option_text,
            is_correct=False,
            points_awarded=Decimal("0.00"),
        ),
        QuizAnswer(
            quiz_question_id=short_link.quiz_question_id,
            submission_id=manual_submission.submission_id,
            answer_text="Needs review",
            is_correct=None,
            points_awarded=None,
        ),
    ])
    db.commit()

    identity = {"sub": accounts["owner"].user_id, "role": "teacher"}
    app = FastAPI()
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: identity
    with TestClient(app, raise_server_exceptions=False) as client:
        yield {
            "client": client,
            "identity": identity,
            "accounts": accounts,
            "classwork": classwork,
        }
    db.close()
    Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
    engine.dispose()


def test_teacher_quiz_analysis_returns_participation_scores_and_question_metrics(quiz_analysis_context):
    c = quiz_analysis_context

    response = c["client"].get(
        f"/api/v1/quizzes/classwork/{c['classwork'].classwork_id}/analysis"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total_students"] == 3
    assert body["submitted_count"] == 2
    assert body["missing_count"] == 1
    assert body["graded_count"] == 1
    assert body["needs_grading_count"] == 1
    assert body["average_score"] == 8.0
    assert body["class_accuracy_percent"] == 80.0
    assert len(body["students"]) == 3

    multiple_choice = body["questions"][0]
    assert multiple_choice["answered_count"] == 2
    assert multiple_choice["correct_count"] == 1
    assert multiple_choice["accuracy_percent"] == 50.0
    assert multiple_choice["option_distribution"][0]["selected_count"] == 1
    assert multiple_choice["option_distribution"][1]["selected_count"] == 1

    short_answer = body["questions"][1]
    assert short_answer["needs_grading_count"] == 1


def test_quiz_analysis_requires_teacher_ownership(quiz_analysis_context):
    c = quiz_analysis_context
    c["identity"].update(sub=c["accounts"]["other_teacher"].user_id, role="teacher")

    response = c["client"].get(
        f"/api/v1/quizzes/classwork/{c['classwork'].classwork_id}/analysis"
    )

    assert response.status_code == 404
