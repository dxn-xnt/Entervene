import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.Base import Base
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
def quiz_db():
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
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
        engine.dispose()


def _base_quiz_graph(db):
    year = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add_all([year, level])
    db.flush()

    teacher_user = UserAccount(user_id=uuid.uuid4(), email="teacher@example.test", password_hash="x")
    student_user = UserAccount(user_id=uuid.uuid4(), email="student@example.test", password_hash="x")
    db.add_all([teacher_user, student_user])
    db.flush()

    staff = AcademicStaff(
        staff_id="T-QZ",
        first_name="Quiz",
        last_name="Teacher",
        user_id=teacher_user.user_id,
    )
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="123456789012",
        first_name="Quiz",
        last_name="Student",
        academic_level_id=level.academic_level_id,
        user_id=student_user.user_id,
    )
    subject = Subject(subject_name="Computer Programming", academic_level_id=level.academic_level_id)
    class_ = Class(
        section_name="Sapphire",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add_all([staff, student, subject, class_])
    db.flush()

    lesson = Lesson(
        title="Variables",
        subject_id=subject.subject_id,
        created_by_staff_id=staff.staff_id,
    )
    classwork = Classwork(
        title="Quiz 1",
        classwork_type="QUIZ",
        total_points=Decimal("10.00"),
        subject_id=subject.subject_id,
        created_by_staff_id=staff.staff_id,
    )
    db.add_all([lesson, classwork])
    db.flush()

    assignment = ClassworkAssignment(
        classwork_id=classwork.classwork_id,
        class_id=class_.class_id,
        assigned_by_staff_id=staff.staff_id,
        is_published=True,
        max_attempts=1,
    )
    db.add(assignment)
    db.flush()
    submission = StudentSubmission(
        student_id=student.student_id,
        classwork_assignment_id=assignment.classwork_assignment_id,
        status="pending",
    )
    db.add(submission)
    db.flush()

    quiz = Quiz(classwork_id=classwork.classwork_id, total_items=1, status="DRAFT")
    setting = QuizSetting(classwork_id=classwork.classwork_id, max_attempts=1)
    question = Question(
        question_text="What does a variable store?",
        question_type="MULTIPLE_CHOICE",
        points=Decimal("10.00"),
        lesson_id=lesson.lesson_id,
    )
    db.add_all([quiz, setting, question])
    db.flush()

    return {
        "classwork": classwork,
        "quiz": quiz,
        "setting": setting,
        "question": question,
        "submission": submission,
    }


def test_quiz_models_register_and_persist_relationships(quiz_db):
    data = _base_quiz_graph(quiz_db)
    option = QuestionOption(
        question_id=data["question"].question_id,
        option_text="A value",
        is_correct=True,
        option_order=1,
    )
    quiz_question = QuizQuestion(
        quiz_id=data["quiz"].quiz_id,
        question_id=data["question"].question_id,
        display_order=1,
    )
    quiz_db.add_all([option, quiz_question])
    quiz_db.flush()
    answer = QuizAnswer(
        quiz_question_id=quiz_question.quiz_question_id,
        submission_id=data["submission"].submission_id,
        answer_text=str(option.option_id),
        is_correct=True,
        points_awarded=Decimal("10.00"),
    )
    quiz_db.add(answer)
    quiz_db.commit()

    assert data["classwork"].quiz.quiz_id == data["quiz"].quiz_id
    assert data["classwork"].quiz_setting.quiz_setting_id == data["setting"].quiz_setting_id
    assert data["quiz"].questions[0].question.question_text == "What does a variable store?"
    assert data["submission"].quiz_answers[0].points_awarded == Decimal("10.00")


def test_quiz_integrity_constraints_prevent_duplicate_scope_rows(quiz_db):
    data = _base_quiz_graph(quiz_db)
    quiz_db.add(Quiz(classwork_id=data["classwork"].classwork_id, total_items=0, status="DRAFT"))

    with pytest.raises(IntegrityError):
        quiz_db.commit()


def test_question_and_order_constraints_are_enforced(quiz_db):
    data = _base_quiz_graph(quiz_db)
    quiz_db.add(Question(question_text="Bad", question_type="ESSAY", points=Decimal("1.00")))
    with pytest.raises(IntegrityError):
        quiz_db.commit()
    quiz_db.rollback()

    option_one = QuestionOption(
        question_id=data["question"].question_id,
        option_text="One",
        is_correct=False,
        option_order=1,
    )
    option_duplicate = QuestionOption(
        question_id=data["question"].question_id,
        option_text="Duplicate",
        is_correct=True,
        option_order=1,
    )
    quiz_db.add_all([option_one, option_duplicate])
    with pytest.raises(IntegrityError):
        quiz_db.commit()
    quiz_db.rollback()

    quiz_question = QuizQuestion(
        quiz_id=data["quiz"].quiz_id,
        question_id=data["question"].question_id,
        display_order=0,
    )
    quiz_db.add(quiz_question)
    with pytest.raises(IntegrityError):
        quiz_db.commit()


def test_quiz_answer_constraints_prevent_duplicate_answer_and_negative_points(quiz_db):
    data = _base_quiz_graph(quiz_db)
    quiz_question = QuizQuestion(
        quiz_id=data["quiz"].quiz_id,
        question_id=data["question"].question_id,
        display_order=1,
    )
    quiz_db.add(quiz_question)
    quiz_db.flush()

    quiz_db.add(QuizAnswer(
        quiz_question_id=quiz_question.quiz_question_id,
        submission_id=data["submission"].submission_id,
        answer_text="first",
        points_awarded=Decimal("1.00"),
    ))
    quiz_db.flush()
    quiz_db.add(QuizAnswer(
        quiz_question_id=quiz_question.quiz_question_id,
        submission_id=data["submission"].submission_id,
        answer_text="second",
        points_awarded=Decimal("1.00"),
    ))
    with pytest.raises(IntegrityError):
        quiz_db.commit()
    quiz_db.rollback()

    quiz_db.add(QuizAnswer(
        quiz_question_id=quiz_question.quiz_question_id,
        submission_id=data["submission"].submission_id,
        answer_text="negative",
        points_awarded=Decimal("-1.00"),
    ))
    with pytest.raises(IntegrityError):
        quiz_db.commit()
