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
from app.models.academic.Lesson import Lesson
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
    Lesson.__table__,
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
def quiz_api_context():
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
        for name in ("owner", "other_teacher", "student")
    }
    db.add_all(accounts.values())
    db.flush()
    owner = AcademicStaff(
        staff_id="T-QUIZ",
        first_name="Quiz",
        last_name="Teacher",
        user_id=accounts["owner"].user_id,
    )
    other_teacher = AcademicStaff(
        staff_id="T-OTHER",
        first_name="Other",
        last_name="Teacher",
        user_id=accounts["other_teacher"].user_id,
    )
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="123456789012",
        first_name="Quiz",
        last_name="Student",
        academic_level_id=level.academic_level_id,
        user_id=accounts["student"].user_id,
    )
    subject = Subject(subject_name="Programming", academic_level_id=level.academic_level_id)
    class_ = Class(
        section_name="Sapphire",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add_all([owner, other_teacher, student, subject, class_])
    db.flush()

    lesson = Lesson(
        title="Variables",
        subject_id=subject.subject_id,
        created_by_staff_id=owner.staff_id,
    )
    quiz_classwork = Classwork(
        title="Quiz 1",
        classwork_type="QUIZ",
        total_points=Decimal("10.00"),
        subject_id=subject.subject_id,
        created_by_staff_id=owner.staff_id,
    )
    non_quiz_classwork = Classwork(
        title="Assignment 1",
        classwork_type="ASSIGNMENT",
        total_points=Decimal("10.00"),
        subject_id=subject.subject_id,
        created_by_staff_id=owner.staff_id,
    )
    foreign_quiz = Classwork(
        title="Foreign Quiz",
        classwork_type="QUIZ",
        total_points=Decimal("10.00"),
        subject_id=subject.subject_id,
        created_by_staff_id=other_teacher.staff_id,
    )
    db.add_all([lesson, quiz_classwork, non_quiz_classwork, foreign_quiz])
    db.flush()

    assignment = ClassworkAssignment(
        classwork_id=quiz_classwork.classwork_id,
        class_id=class_.class_id,
        assigned_by_staff_id=owner.staff_id,
        is_published=True,
        max_attempts=1,
    )
    db.add(assignment)
    db.commit()

    identity = {"sub": accounts["owner"].user_id, "role": "teacher"}
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
            "owner": owner,
            "student": student,
            "lesson": lesson,
            "quiz_classwork": quiz_classwork,
            "non_quiz_classwork": non_quiz_classwork,
            "foreign_quiz": foreign_quiz,
            "assignment": assignment,
        }
    db.close()
    Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
    engine.dispose()


def _valid_payload(lesson_id: int):
    return {
        "duration_minutes": 30,
        "status": "READY",
        "settings": {
            "is_shuffle_questions": True,
            "enable_per_question_scoring": True,
            "enable_per_question_time_limits": False,
            "max_attempts": 1,
            "show_correct_answers": False,
        },
        "questions": [
            {
                "question_text": "What does a variable store?",
                "question_type": "MULTIPLE_CHOICE",
                "points": 6,
                "display_order": 1,
                "difficulty_level": "EASY",
                "lesson_id": lesson_id,
                "options": [
                    {"option_text": "A value", "is_correct": True, "option_order": 1},
                    {"option_text": "Only images", "is_correct": False, "option_order": 2},
                ],
            },
            {
                "question_text": "Explain why variables are useful.",
                "question_type": "SHORT_ANSWER",
                "points": 4,
                "display_order": 2,
                "options": [],
            },
        ],
    }


def test_teacher_can_upsert_read_and_validate_quiz_builder(quiz_api_context):
    c = quiz_api_context
    classwork_id = c["quiz_classwork"].classwork_id

    response = c["client"].put(
        f"/api/v1/quizzes/classwork/{classwork_id}",
        json=_valid_payload(c["lesson"].lesson_id),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["classwork_id"] == classwork_id
    assert body["total_items"] == 2
    assert body["is_publish_ready"] is True
    assert body["questions"][0]["options"][0]["is_correct"] is True

    get_response = c["client"].get(f"/api/v1/quizzes/classwork/{classwork_id}")
    assert get_response.status_code == 200
    assert get_response.json()["questions"][1]["question_type"] == "SHORT_ANSWER"

    readiness = c["client"].get(f"/api/v1/quizzes/classwork/{classwork_id}/readiness")
    assert readiness.status_code == 200
    assert readiness.json()["is_publish_ready"] is True


def test_quiz_builder_rejects_invalid_manual_questions(quiz_api_context):
    c = quiz_api_context
    payload = _valid_payload(c["lesson"].lesson_id)
    payload["questions"][0]["options"][1]["is_correct"] = True
    payload["questions"][1]["options"] = [
        {"option_text": "Not allowed", "is_correct": False, "option_order": 1}
    ]

    response = c["client"].put(
        f"/api/v1/quizzes/classwork/{c['quiz_classwork'].classwork_id}",
        json=payload,
    )

    assert response.status_code == 400
    assert "exactly one correct option" in " ".join(response.json()["detail"])
    assert "short answer questions cannot have options" in " ".join(response.json()["detail"])


def test_quiz_builder_uses_teacher_owned_quiz_classwork_scope(quiz_api_context):
    c = quiz_api_context

    non_quiz = c["client"].put(
        f"/api/v1/quizzes/classwork/{c['non_quiz_classwork'].classwork_id}",
        json=_valid_payload(c["lesson"].lesson_id),
    )
    assert non_quiz.status_code == 400
    assert non_quiz.json()["detail"] == "Classwork is not a quiz"

    foreign = c["client"].put(
        f"/api/v1/quizzes/classwork/{c['foreign_quiz'].classwork_id}",
        json=_valid_payload(c["lesson"].lesson_id),
    )
    assert foreign.status_code == 404


def test_quiz_builder_blocks_edits_and_delete_after_attempt_exists(quiz_api_context):
    c = quiz_api_context
    classwork_id = c["quiz_classwork"].classwork_id
    assert c["client"].put(
        f"/api/v1/quizzes/classwork/{classwork_id}",
        json=_valid_payload(c["lesson"].lesson_id),
    ).status_code == 200

    c["db"].add(StudentSubmission(
        student_id=c["student"].student_id,
        classwork_assignment_id=c["assignment"].classwork_assignment_id,
        status="pending",
    ))
    c["db"].commit()

    edit_response = c["client"].put(
        f"/api/v1/quizzes/classwork/{classwork_id}",
        json=_valid_payload(c["lesson"].lesson_id),
    )
    assert edit_response.status_code == 409

    delete_response = c["client"].delete(f"/api/v1/quizzes/classwork/{classwork_id}")
    assert delete_response.status_code == 409


def test_teacher_can_reset_builder_before_attempts_exist(quiz_api_context):
    c = quiz_api_context
    classwork_id = c["quiz_classwork"].classwork_id
    assert c["client"].put(
        f"/api/v1/quizzes/classwork/{classwork_id}",
        json=_valid_payload(c["lesson"].lesson_id),
    ).status_code == 200

    delete_response = c["client"].delete(f"/api/v1/quizzes/classwork/{classwork_id}")
    assert delete_response.status_code == 200
    assert c["client"].get(f"/api/v1/quizzes/classwork/{classwork_id}").status_code == 404
