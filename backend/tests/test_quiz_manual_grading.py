import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.quiz.Question import Question
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.quiz.QuizAnalysisService import (
    get_teacher_quiz_submission_detail,
    grade_teacher_quiz_submission,
)
from app.schemas.Quiz import TeacherGradeQuizSubmissionRequest, TeacherQuizAnswerGradeItem


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    from sqlalchemy import CheckConstraint
    for c in list(Student.__table__.constraints):
        if isinstance(c, CheckConstraint):
            Student.__table__.constraints.remove(c)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def test_quiz_manual_grading_essay_questions(db_session):
    # 1. Setup staff, student, class, subject
    from app.models.academic.AcademicYear import AcademicYear
    from datetime import date

    year = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db_session.add_all([year, level])
    db_session.flush()

    import uuid
    staff = AcademicStaff(staff_id="STF101", first_name="Jane", last_name="Teacher", email="jane@school.edu")
    student = Student(student_id=uuid.uuid4(), student_lrn="123456789012", first_name="John", last_name="Student", email="john@student.edu")
    period = AcademicPeriod(
        period_name="1st Qtr",
        start_date=date(2025, 6, 1),
        end_date=date(2025, 8, 31),
        academic_year_id=year.academic_year_id,
        is_active=True,
    )
    subject = Subject(subject_name="Intro to CS", academic_level_id=level.academic_level_id)

    db_session.add_all([staff, student, period, subject])
    db_session.flush()

    cls = Class(
        section_name="Section A",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
        academic_period_id=period.academic_period_id,
    )
    db_session.add(cls)
    db_session.flush()

    load = SubjectLoad(
        staff_id=staff.staff_id,
        class_id=cls.class_id,
        subject_id=subject.subject_id,
        academic_period_id=period.academic_period_id,
    )
    db_session.add(load)
    db_session.flush()

    # 2. Create quiz classwork and questions
    classwork = Classwork(
        title="Essay & Coding Quiz",
        classwork_type="QUIZ",
        classwork_category="PERFORMANCE_TASK",
        total_points=20.0,
        created_by_staff_id=staff.staff_id,
        subject_id=subject.subject_id,
    )
    db_session.add(classwork)
    db_session.flush()

    assignment = ClassworkAssignment(
        classwork_id=classwork.classwork_id,
        class_id=cls.class_id,
        assigned_by_staff_id=staff.staff_id,
        is_published=True,
    )
    db_session.add(assignment)
    db_session.flush()

    quiz = Quiz(classwork_id=classwork.classwork_id)
    q1 = Question(
        question_text="Explain recursion in programming.",
        question_type="SHORT_ANSWER",
        points=15.0,
    )
    q2 = Question(
        question_text="What keyword defines a function in Python?",
        question_type="SHORT_ANSWER",
        points=5.0,
    )
    db_session.add_all([quiz, q1, q2])
    db_session.flush()

    link1 = QuizQuestion(quiz_id=quiz.quiz_id, question_id=q1.question_id, display_order=1)
    link2 = QuizQuestion(quiz_id=quiz.quiz_id, question_id=q2.question_id, display_order=2)
    db_session.add_all([link1, link2])
    db_session.flush()

    # 3. Create student submission with essay response
    submission = StudentSubmission(
        student_id=student.student_id,
        classwork_assignment_id=assignment.classwork_assignment_id,
        status="submitted",
        attempt_count=1,
    )
    db_session.add(submission)
    db_session.flush()

    ans1 = QuizAnswer(
        quiz_question_id=link1.quiz_question_id,
        submission_id=submission.submission_id,
        answer_text="Recursion is a technique where a function calls itself until a base condition is met.",
        points_awarded=None,
    )
    ans2 = QuizAnswer(
        quiz_question_id=link2.quiz_question_id,
        submission_id=submission.submission_id,
        answer_text="def",
        points_awarded=None,
    )
    db_session.add_all([ans1, ans2])
    db_session.commit()

    # 4. Fetch detail for teacher
    detail = get_teacher_quiz_submission_detail(db_session, staff.staff_id, submission.submission_id)
    assert detail.student_name == "John Student"
    assert detail.needs_grading is True
    assert len(detail.answers) == 2

    # 5. Teacher manually grades the essay answers
    grade_req = TeacherGradeQuizSubmissionRequest(
        answers=[
            TeacherQuizAnswerGradeItem(quiz_question_id=link1.quiz_question_id, points_awarded=14.0),
            TeacherQuizAnswerGradeItem(quiz_question_id=link2.quiz_question_id, points_awarded=5.0),
        ],
        feedback="Great explanation of base conditions!",
    )
    graded_detail = grade_teacher_quiz_submission(db_session, staff.staff_id, submission.submission_id, grade_req)

    assert graded_detail.status == "graded"
    assert graded_detail.grade == 19.0
    assert graded_detail.feedback == "Great explanation of base conditions!"
    assert graded_detail.needs_grading is False
