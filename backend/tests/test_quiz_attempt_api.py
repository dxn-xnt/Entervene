import uuid
from datetime import date, datetime, timedelta, timezone
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
def quiz_attempt_context():
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
        for name in ("teacher", "student", "other_student")
    }
    db.add_all(accounts.values())
    db.flush()
    teacher = AcademicStaff(
        staff_id="T-QUIZ",
        first_name="Quiz",
        last_name="Teacher",
        user_id=accounts["teacher"].user_id,
    )
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="123456789012",
        first_name="Quiz",
        last_name="Student",
        academic_level_id=level.academic_level_id,
        user_id=accounts["student"].user_id,
    )
    other_student = Student(
        student_id=uuid.uuid4(),
        student_lrn="123456789013",
        first_name="Other",
        last_name="Student",
        academic_level_id=level.academic_level_id,
        user_id=accounts["other_student"].user_id,
    )
    subject = Subject(subject_name="Programming", academic_level_id=level.academic_level_id)
    class_ = Class(
        section_name="Sapphire",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add_all([teacher, student, other_student, subject, class_])
    db.flush()
    db.add(StudentClass(
        student_id=student.student_id,
        class_id=class_.class_id,
        academic_year_id=year.academic_year_id,
        enrollment_status="enrolled",
    ))

    classwork = Classwork(
        title="Variables Quiz",
        instructions="Answer every question.",
        classwork_type="QUIZ",
        total_points=Decimal("10.00"),
        subject_id=subject.subject_id,
        created_by_staff_id=teacher.staff_id,
        is_published=True,
    )
    db.add(classwork)
    db.flush()
    assignment = ClassworkAssignment(
        classwork_id=classwork.classwork_id,
        class_id=class_.class_id,
        assigned_by_staff_id=teacher.staff_id,
        is_published=True,
        max_attempts=2,
    )
    quiz = Quiz(classwork_id=classwork.classwork_id, total_items=2, status="READY")
    setting = QuizSetting(
        classwork_id=classwork.classwork_id,
        max_attempts=2,
        show_correct_answers=False,
    )
    db.add_all([assignment, quiz, setting])
    db.flush()

    mc = Question(
        question_text="What stores a value?",
        question_type="MULTIPLE_CHOICE",
        points=Decimal("6.00"),
        difficulty_level="EASY",
        is_ai_generated=False,
    )
    short = Question(
        question_text="Explain variables.",
        question_type="SHORT_ANSWER",
        points=Decimal("4.00"),
        difficulty_level="MEDIUM",
        is_ai_generated=False,
    )
    db.add_all([mc, short])
    db.flush()
    correct = QuestionOption(
        question_id=mc.question_id,
        option_text="Variable",
        is_correct=True,
        option_order=1,
    )
    wrong = QuestionOption(
        question_id=mc.question_id,
        option_text="Paintbrush",
        is_correct=False,
        option_order=2,
    )
    mc_link = QuizQuestion(quiz_id=quiz.quiz_id, question_id=mc.question_id, display_order=1)
    short_link = QuizQuestion(quiz_id=quiz.quiz_id, question_id=short.question_id, display_order=2)
    db.add_all([correct, wrong, mc_link, short_link])
    db.commit()

    identity = {"sub": accounts["student"].user_id, "role": "student"}
    app = FastAPI()
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: identity
    with TestClient(app, raise_server_exceptions=False) as client:
        yield {
            "client": client,
            "db": db,
            "identity": identity,
            "accounts": accounts,
            "student": student,
            "other_student": other_student,
            "assignment": assignment,
            "classwork": classwork,
            "setting": setting,
            "mc_link": mc_link,
            "short_link": short_link,
            "correct": correct,
            "wrong": wrong,
        }
    db.close()
    Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
    engine.dispose()


def _act_as(context, account_name: str, role: str) -> None:
    context["identity"].update(
        sub=context["accounts"][account_name].user_id,
        role=role,
    )


def test_student_can_start_resume_and_submit_quiz_with_server_scoring(quiz_attempt_context):
    c = quiz_attempt_context
    assignment_id = c["assignment"].classwork_assignment_id

    attempt = c["client"].get(f"/api/v1/quizzes/assignment/{assignment_id}/attempt")
    assert attempt.status_code == 200
    assert attempt.json()["questions"][0]["options"][0]["is_correct"] is None

    started = c["client"].post(f"/api/v1/quizzes/assignment/{assignment_id}/start")
    assert started.status_code == 200
    assert started.json()["status"] == "pending"
    assert started.json()["started_at"]
    assert started.json()["server_time"]

    submitted = c["client"].post(
        f"/api/v1/quizzes/assignment/{assignment_id}/submit",
        json={
            "answers": [
                {
                    "quiz_question_id": c["mc_link"].quiz_question_id,
                    "selected_option_id": c["correct"].option_id,
                },
                {
                    "quiz_question_id": c["short_link"].quiz_question_id,
                    "answer_text": "Variables store reusable values.",
                },
            ]
        },
    )

    assert submitted.status_code == 200
    body = submitted.json()
    assert body["status"] == "submitted"
    assert body["attempt_count"] == 1
    assert body["grade"] == 6.0
    assert c["db"].query(QuizAnswer).count() == 2


def test_multiple_choice_only_quiz_is_auto_graded(quiz_attempt_context):
    c = quiz_attempt_context
    c["db"].query(QuizQuestion).filter_by(quiz_question_id=c["short_link"].quiz_question_id).delete()
    c["classwork"].total_points = Decimal("6.00")
    c["db"].commit()

    response = c["client"].post(
        f"/api/v1/quizzes/assignment/{c['assignment'].classwork_assignment_id}/submit",
        json={
            "answers": [
                {
                    "quiz_question_id": c["mc_link"].quiz_question_id,
                    "selected_option_id": c["wrong"].option_id,
                }
            ]
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "graded"
    assert response.json()["grade"] == 0.0


def test_quiz_summary_is_hidden_until_scheduled_release(quiz_attempt_context):
    c = quiz_attempt_context
    c["setting"].show_correct_answers = True
    c["setting"].summary_release_mode = "SCHEDULED"
    c["setting"].summary_release_at = datetime.now(timezone.utc) + timedelta(days=1)
    c["db"].commit()

    response = c["client"].post(
        f"/api/v1/quizzes/assignment/{c['assignment'].classwork_assignment_id}/submit",
        json={
            "answers": [
                {
                    "quiz_question_id": c["mc_link"].quiz_question_id,
                    "selected_option_id": c["correct"].option_id,
                },
                {
                    "quiz_question_id": c["short_link"].quiz_question_id,
                    "answer_text": "Variables store values.",
                },
            ]
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["summary_available"] is False
    assert body["summary_release_at"] is not None
    assert "will be available" in body["summary_message"]
    assert body["questions"][0]["selected_option_id"] is None
    assert body["questions"][0]["options"][0]["is_correct"] is None
    assert body["questions"][0]["points_awarded"] is None

    c["setting"].summary_release_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    c["db"].commit()
    released = c["client"].get(
        f"/api/v1/quizzes/assignment/{c['assignment'].classwork_assignment_id}/attempt"
    )

    assert released.status_code == 200
    released_body = released.json()
    assert released_body["summary_available"] is True
    assert released_body["questions"][0]["selected_option_id"] == c["correct"].option_id
    assert released_body["questions"][0]["options"][0]["is_correct"] is True
    assert released_body["questions"][0]["points_awarded"] == 6.0


def test_quiz_submit_allows_unanswered_items_for_timed_autosubmit(quiz_attempt_context):
    c = quiz_attempt_context

    response = c["client"].post(
        f"/api/v1/quizzes/assignment/{c['assignment'].classwork_assignment_id}/submit",
        json={
            "answers": [
                {"quiz_question_id": c["mc_link"].quiz_question_id},
                {"quiz_question_id": c["short_link"].quiz_question_id, "answer_text": ""},
            ]
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "graded"
    assert body["grade"] == 0.0
    assert c["db"].query(QuizAnswer).count() == 2


def test_quiz_attempt_rejects_unenrolled_locked_closed_and_over_limit(quiz_attempt_context):
    c = quiz_attempt_context
    assignment_id = c["assignment"].classwork_assignment_id

    _act_as(c, "other_student", "student")
    assert c["client"].get(f"/api/v1/quizzes/assignment/{assignment_id}/attempt").status_code == 403

    _act_as(c, "student", "student")
    c["assignment"].lock_date = datetime.now(timezone.utc) + timedelta(days=1)
    c["db"].commit()
    assert c["client"].post(f"/api/v1/quizzes/assignment/{assignment_id}/start").status_code == 403

    c["assignment"].lock_date = None
    c["assignment"].due_date = datetime.now(timezone.utc) - timedelta(minutes=1)
    c["db"].commit()
    assert c["client"].post(f"/api/v1/quizzes/assignment/{assignment_id}/start").status_code == 403

    c["assignment"].due_date = None
    c["assignment"].max_attempts = 1
    c["db"].add(StudentSubmission(
        student_id=c["student"].student_id,
        classwork_assignment_id=assignment_id,
        status="graded",
        attempt_count=1,
    ))
    c["db"].commit()
    assert c["client"].post(f"/api/v1/quizzes/assignment/{assignment_id}/start").status_code == 403


def test_quiz_submit_validates_complete_and_scoped_answers(quiz_attempt_context):
    c = quiz_attempt_context
    assignment_id = c["assignment"].classwork_assignment_id

    incomplete = c["client"].post(
        f"/api/v1/quizzes/assignment/{assignment_id}/submit",
        json={
            "answers": [
                {
                    "quiz_question_id": c["mc_link"].quiz_question_id,
                    "selected_option_id": c["correct"].option_id,
                }
            ]
        },
    )
    assert incomplete.status_code == 400

    wrong_option = c["client"].post(
        f"/api/v1/quizzes/assignment/{assignment_id}/submit",
        json={
            "answers": [
                {
                    "quiz_question_id": c["mc_link"].quiz_question_id,
                    "selected_option_id": 999999,
                },
                {
                    "quiz_question_id": c["short_link"].quiz_question_id,
                    "answer_text": "Variables store values.",
                },
            ]
        },
    )
    assert wrong_option.status_code == 400
