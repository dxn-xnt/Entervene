import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, Table, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.LessonGoals import router as lesson_goals_router
from app.core.Dependencies import get_optional_staff_id, get_staff_id
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.LessonGoal import LessonGoal, LessonGoalItem
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission


@pytest.fixture
def goal_context():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    student_table = cast(Table, Student.__table__)
    lrn_check = next(
        (c for c in student_table.constraints if isinstance(c, CheckConstraint) and c.name == "lrn_check"),
        None,
    )
    if lrn_check and lrn_check in student_table.constraints:
        student_table.constraints.remove(lrn_check)
    try:
        Base.metadata.create_all(bind=engine)
    finally:
        if lrn_check and lrn_check not in student_table.constraints:
            student_table.append_constraint(lrn_check)

    db = sessionmaker(bind=engine)()

    # Academic Structure
    year = AcademicYear(year_label="AY2025-2026", start_date=date(2025, 6, 1), end_date=date(2026, 3, 31), is_active=True)
    level = AcademicLevel(level_name="Grade 8", grade_level=8)
    db.add_all([year, level])
    db.flush()

    period1 = AcademicPeriod(
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        academic_year_id=year.academic_year_id,
        is_active=True,
        start_date=date(2025, 6, 1),
        end_date=date(2025, 8, 31),
    )
    period2 = AcademicPeriod(
        period_name="Term 2",
        period_type="TERM",
        period_sequence=2,
        academic_year_id=year.academic_year_id,
        is_active=False,
        start_date=date(2025, 9, 1),
        end_date=date(2025, 11, 30),
    )
    db.add_all([period1, period2])
    db.flush()

    # Users
    u_teacher = UserAccount(user_id=uuid.uuid4(), email="teacher@entervene.edu", password_hash="hash")
    u_student = UserAccount(user_id=uuid.uuid4(), email="student@entervene.edu", password_hash="hash")
    db.add_all([u_teacher, u_student])
    db.flush()

    teacher = AcademicStaff(
        staff_id="STF-001",
        first_name="Maria",
        last_name="Santos",
        email=u_teacher.email,
        user_id=u_teacher.user_id,
    )
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="123456789012",
        first_name="Juan",
        last_name="Dela Cruz",
        gender="Male",
        email=u_student.email,
        user_id=u_student.user_id,
        academic_level_id=level.academic_level_id,
    )
    db.add_all([teacher, student])
    db.flush()

    # Class & Subject
    cls = Class(
        section_name="Grade 8 – Rizal",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
        academic_period_id=period1.academic_period_id,
        class_status="active",
    )
    subj = Subject(
        subject_name="English",
        subject_codename="ENG8",
        status="active",
        academic_level_id=level.academic_level_id,
    )
    db.add_all([cls, subj])
    db.flush()

    db.add(StudentClass(student_id=student.student_id, class_id=cls.class_id, academic_year_id=year.academic_year_id, enrollment_status="enrolled"))
    db.flush()

    # Lessons
    lesson1 = Lesson(title="Meaning and Purpose of Literature", subject_id=subj.subject_id, is_published=True, created_by_staff_id=teacher.staff_id)
    lesson2 = Lesson(title="Elements of Short Story", subject_id=subj.subject_id, is_published=True, created_by_staff_id=teacher.staff_id)
    db.add_all([lesson1, lesson2])
    db.flush()

    # Classwork (1 linked to lesson1, 1 standalone exam)
    cw1 = Classwork(
        title="Assignment 1 - Short Reflection",
        classwork_type="ASSIGNMENT",
        classwork_category="WRITTEN_WORK",
        is_graded=True,
        total_points=Decimal("20.00"),
        subject_id=subj.subject_id,
        created_by_staff_id=teacher.staff_id,
    )
    cw_exam = Classwork(
        title="Term 1 Periodic Exam",
        classwork_type="EXAM",
        classwork_category="QUARTERLY_ASSESSMENT",
        is_graded=True,
        total_points=Decimal("50.00"),
        subject_id=subj.subject_id,
        created_by_staff_id=teacher.staff_id,
    )
    db.add_all([cw1, cw_exam])
    db.flush()

    db.add(ClassworkLesson(classwork_id=cw1.classwork_id, lesson_id=lesson1.lesson_id))
    db.flush()

    # Assignments to class
    asgn1 = ClassworkAssignment(classwork_id=cw1.classwork_id, class_id=cls.class_id, assigned_by_staff_id=teacher.staff_id, is_published=True, due_date=datetime(2025, 7, 1, 12, 0, tzinfo=timezone.utc))
    asgn_exam = ClassworkAssignment(classwork_id=cw_exam.classwork_id, class_id=cls.class_id, assigned_by_staff_id=teacher.staff_id, is_published=True, due_date=datetime(2025, 8, 20, 12, 0, tzinfo=timezone.utc))
    db.add_all([asgn1, asgn_exam])
    db.flush()

    # Student submission for asgn1
    sub1 = StudentSubmission(classwork_assignment_id=asgn1.classwork_assignment_id, student_id=student.student_id, grade=Decimal("19.00"), status="GRADED")
    db.add(sub1)
    db.commit()

    return {
        "db": db,
        "class_id": cls.class_id,
        "subject_id": subj.subject_id,
        "period1_id": period1.academic_period_id,
        "period2_id": period2.academic_period_id,
        "teacher": teacher,
        "student": student,
        "user_teacher": u_teacher,
        "user_student": u_student,
        "lesson1": lesson1,
        "lesson2": lesson2,
        "cw1": cw1,
        "cw_exam": cw_exam,
    }


def create_client(db, user_payload, staff_id=None):
    app = FastAPI()
    app.include_router(lesson_goals_router, prefix="/api/v1/lesson-goals")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user_payload
    if staff_id:
        app.dependency_overrides[get_staff_id] = lambda: staff_id
        app.dependency_overrides[get_optional_staff_id] = lambda: staff_id
    return TestClient(app)


def test_lesson_goal_empty_state(goal_context):
    ctx = goal_context
    teacher_payload = {"sub": str(ctx["user_teacher"].user_id), "role": "teacher"}
    client = create_client(ctx["db"], teacher_payload, ctx["teacher"].staff_id)

    # Initial GET before any goal set
    res = client.get(f"/api/v1/lesson-goals/class/{ctx['class_id']}/subject/{ctx['subject_id']}")
    assert res.status_code == 200
    data = res.json()
    assert data["goal_id"] is None
    assert data["items"] == []
    assert data["academic_period_id"] == ctx["period1_id"]


def test_lesson_goal_teacher_curate_and_order(goal_context):
    ctx = goal_context
    teacher_payload = {"sub": str(ctx["user_teacher"].user_id), "role": "teacher"}
    client = create_client(ctx["db"], teacher_payload, ctx["teacher"].staff_id)

    # Teacher selects: Lesson 1 first, then Assignment 1, then Exam
    body = {
        "academic_period_id": ctx["period1_id"],
        "items": [
            {"item_type": "LESSON", "lesson_id": ctx["lesson1"].lesson_id, "order_index": 1},
            {"item_type": "CLASSWORK", "classwork_id": ctx["cw1"].classwork_id, "order_index": 2},
            {"item_type": "CLASSWORK", "classwork_id": ctx["cw_exam"].classwork_id, "order_index": 3},
        ],
    }
    put_res = client.put(f"/api/v1/lesson-goals/class/{ctx['class_id']}/subject/{ctx['subject_id']}", json=body)
    assert put_res.status_code == 200
    data = put_res.json()
    assert data["goal_id"] is not None
    assert len(data["items"]) == 3
    assert data["items"][0]["item_type"] == "LESSON"
    assert data["items"][0]["lesson"]["title"] == "Meaning and Purpose of Literature"
    assert data["items"][1]["item_type"] == "CLASSWORK"
    assert data["items"][1]["classwork"]["title"] == "Assignment 1 - Short Reflection"
    assert data["items"][2]["item_type"] == "CLASSWORK"
    assert data["items"][2]["classwork"]["title"] == "Term 1 Periodic Exam"


def test_lesson_goal_student_view_with_submission_status(goal_context):
    ctx = goal_context
    # Curate first
    teacher_payload = {"sub": str(ctx["user_teacher"].user_id), "role": "teacher"}
    t_client = create_client(ctx["db"], teacher_payload, ctx["teacher"].staff_id)
    t_client.put(
        f"/api/v1/lesson-goals/class/{ctx['class_id']}/subject/{ctx['subject_id']}",
        json={
            "academic_period_id": ctx["period1_id"],
            "items": [
                {"item_type": "CLASSWORK", "classwork_id": ctx["cw1"].classwork_id, "order_index": 1},
                {"item_type": "CLASSWORK", "classwork_id": ctx["cw_exam"].classwork_id, "order_index": 2},
            ],
        },
    )

    # Student views
    student_payload = {"sub": str(ctx["user_student"].user_id), "role": "student"}
    s_client = create_client(ctx["db"], student_payload)
    res = s_client.get(f"/api/v1/lesson-goals/class/{ctx['class_id']}/subject/{ctx['subject_id']}?academic_period_id={ctx['period1_id']}")
    assert res.status_code == 200
    data = res.json()
    assert len(data["items"]) == 2
    # cw1 was graded
    assert data["items"][0]["classwork"]["submission_status"] == "graded"
    # cw_exam has no submission
    assert data["items"][1]["classwork"]["submission_status"] is None


def test_lesson_goal_per_period_no_carryover(goal_context):
    ctx = goal_context
    teacher_payload = {"sub": str(ctx["user_teacher"].user_id), "role": "teacher"}
    client = create_client(ctx["db"], teacher_payload, ctx["teacher"].staff_id)

    # Curate for Term 1
    client.put(
        f"/api/v1/lesson-goals/class/{ctx['class_id']}/subject/{ctx['subject_id']}",
        json={
            "academic_period_id": ctx["period1_id"],
            "items": [{"item_type": "LESSON", "lesson_id": ctx["lesson1"].lesson_id, "order_index": 1}],
        },
    )

    # Query Term 2 explicitly -> MUST be completely empty (no carry-over)
    res_term2 = client.get(f"/api/v1/lesson-goals/class/{ctx['class_id']}/subject/{ctx['subject_id']}?academic_period_id={ctx['period2_id']}")
    assert res_term2.status_code == 200
    data_term2 = res_term2.json()
    assert data_term2["goal_id"] is None
    assert data_term2["items"] == []
