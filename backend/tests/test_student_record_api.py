import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.StudentRecords import router as student_records_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    Subject.__table__,
    AcademicPeriod.__table__,
    Class.__table__,
    StudentClass.__table__,
    SubjectLoad.__table__,
    Classwork.__table__,
    ClassworkAssignment.__table__,
    StudentSubmission.__table__,
    StudentPeriodGrade.__table__,
]


@pytest.fixture
def student_record_context():
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
    period = AcademicPeriod(
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        period_progress_ratio=0.3333,
        start_date=date(2025, 6, 1),
        end_date=date(2025, 8, 31),
        academic_year_id=year.academic_year_id,
        is_active=True,
    )
    old_period = AcademicPeriod(
        period_name="Term 2",
        period_type="TERM",
        period_sequence=2,
        total_periods_in_year=3,
        period_progress_ratio=0.6667,
        start_date=date(2025, 9, 1),
        end_date=date(2025, 11, 30),
        academic_year_id=year.academic_year_id,
        is_active=False,
    )
    subject = Subject(subject_name="Computer Programming", academic_level_id=level.academic_level_id)
    db.add_all([period, old_period, subject])
    db.flush()

    owner_account = UserAccount(user_id=uuid.uuid4(), email="owner@example.test", password_hash="hash")
    other_account = UserAccount(user_id=uuid.uuid4(), email="other@example.test", password_hash="hash")
    db.add_all([owner_account, other_account])
    db.flush()
    owner = AcademicStaff(
        staff_id="T-OWNER",
        first_name="Maria",
        last_name="Cruz",
        user_id=owner_account.user_id,
    )
    other_teacher = AcademicStaff(
        staff_id="T-OTHER",
        first_name="Other",
        last_name="Teacher",
        user_id=other_account.user_id,
    )
    class_ = Class(
        section_name="Sapphire",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    other_class = Class(
        section_name="Ruby",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add_all([owner, other_teacher, class_, other_class])
    db.flush()

    students = [
        Student(
            student_id=uuid.uuid4(),
            student_lrn=f"10000000000{index}",
            first_name=first,
            last_name=last,
            email=f"{first.lower()}@student.test",
            academic_level_id=level.academic_level_id,
        )
        for index, (first, last) in enumerate(
            [("Ana", "Gonzales"), ("Ben", "Santos"), ("Out", "Scope")],
            start=1,
        )
    ]
    db.add_all(students)
    db.flush()
    db.add_all(
        [
            StudentClass(
                student_id=students[0].student_id,
                class_id=class_.class_id,
                academic_year_id=year.academic_year_id,
                enrollment_status="enrolled",
            ),
            StudentClass(
                student_id=students[1].student_id,
                class_id=class_.class_id,
                academic_year_id=year.academic_year_id,
                enrollment_status="enrolled",
            ),
            StudentClass(
                student_id=students[2].student_id,
                class_id=other_class.class_id,
                academic_year_id=year.academic_year_id,
                enrollment_status="enrolled",
            ),
            SubjectLoad(
                staff_id=owner.staff_id,
                subject_id=subject.subject_id,
                class_id=class_.class_id,
                academic_period_id=period.academic_period_id,
                status="active",
            ),
        ]
    )
    db.flush()

    due_base = datetime(2025, 7, 15, 12, 0, tzinfo=timezone.utc)
    classworks = [
        Classwork(
            title="Assignment 1",
            classwork_type="ASSIGNMENT",
            classwork_category="WRITTEN_WORK",
            total_points=100,
            subject_id=subject.subject_id,
            created_by_staff_id=owner.staff_id,
            is_published=True,
        ),
        Classwork(
            title="Activity 1",
            classwork_type="ACTIVITY",
            classwork_category="PERFORMANCE_TASK",
            total_points=50,
            subject_id=subject.subject_id,
            created_by_staff_id=owner.staff_id,
            is_published=True,
        ),
        Classwork(
            title="Assignment 2",
            classwork_type="ASSIGNMENT",
            classwork_category="WRITTEN_WORK",
            total_points=20,
            subject_id=subject.subject_id,
            created_by_staff_id=owner.staff_id,
            is_published=True,
        ),
        Classwork(
            title="Reading Only",
            classwork_type="READING",
            total_points=None,
            subject_id=subject.subject_id,
            created_by_staff_id=owner.staff_id,
            is_published=True,
        ),
    ]
    db.add_all(classworks)
    db.flush()
    assignments = [
        ClassworkAssignment(
            classwork_id=classwork.classwork_id,
            class_id=class_.class_id,
            assigned_by_staff_id=owner.staff_id,
            due_date=due_base + timedelta(days=offset),
            is_published=True,
        )
        for offset, classwork in enumerate(classworks)
    ]
    db.add_all(assignments)
    db.flush()
    db.add_all(
        [
            StudentSubmission(
                student_id=students[0].student_id,
                classwork_assignment_id=assignments[0].classwork_assignment_id,
                status="graded",
                submitted_at=due_base - timedelta(days=1),
                graded_at=due_base,
                grade=80,
                attempt_count=1,
            ),
            StudentSubmission(
                student_id=students[0].student_id,
                classwork_assignment_id=assignments[1].classwork_assignment_id,
                status="submitted",
                submitted_at=due_base + timedelta(days=2),
                attempt_count=1,
            ),
            StudentPeriodGrade(
                student_id=students[0].student_id,
                class_id=class_.class_id,
                subject_id=subject.subject_id,
                academic_period_id=period.academic_period_id,
                final_period_grade=88.5,
            ),
        ]
    )
    db.commit()

    identity = {"sub": owner_account.user_id, "role": "teacher"}
    test_app = FastAPI()
    test_app.include_router(student_records_router, prefix="/api/v1/student-records")

    def override_db():
        try:
            yield db
        finally:
            pass

    def override_user():
        return identity

    test_app.dependency_overrides[get_db] = override_db
    test_app.dependency_overrides[get_current_user] = override_user

    from fastapi.testclient import TestClient

    return {
        "client": TestClient(test_app),
        "db": db,
        "identity": identity,
        "owner": owner,
        "owner_account": owner_account,
        "other_account": other_account,
        "class": class_,
        "other_class": other_class,
        "subject": subject,
        "period": period,
        "old_period": old_period,
        "students": students,
    }


def test_teacher_roster_returns_scoped_metrics(student_record_context):
    ctx = student_record_context
    response = ctx["client"].get(
        f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}"
        f"/subjects/{ctx['subject'].subject_id}/roster",
        params={"academic_period_id": ctx["period"].academic_period_id},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["scope"]["section_name"] == "Sapphire"
    assert [row["full_name"] for row in body["students"]] == ["Ana Gonzales", "Ben Santos"]
    ana = body["students"][0]
    assert ana["official_period_grade"] == 88.5
    assert ana["running_classwork_percentage"] == 80
    assert ana["completion_rate"] == pytest.approx(66.67)
    assert ana["submitted_count"] == 2
    assert ana["missing_count"] == 1
    assert ana["late_count"] == 1
    assert ana["ungraded_count"] == 1


def test_teacher_detail_returns_classwork_history(student_record_context):
    ctx = student_record_context
    student = ctx["students"][0]
    response = ctx["client"].get(
        f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}"
        f"/subjects/{ctx['subject'].subject_id}/students/{student.student_id}",
        params={"academic_period_id": ctx["period"].academic_period_id},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["student"]["full_name"] == "Ana Gonzales"
    assert body["summary"]["assigned_count"] == 3
    assert [item["title"] for item in body["classwork_results"]] == [
        "Assignment 1",
        "Activity 1",
        "Assignment 2",
    ]
    assert body["classwork_results"][0]["percentage"] == 80
    assert body["classwork_results"][1]["status"] == "late"
    assert body["classwork_results"][2]["status"] == "missing"


def test_other_teacher_cannot_read_roster(student_record_context):
    ctx = student_record_context
    ctx["identity"].update({"sub": ctx["other_account"].user_id, "role": "teacher"})

    response = ctx["client"].get(
        f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}"
        f"/subjects/{ctx['subject'].subject_id}/roster",
        params={"academic_period_id": ctx["period"].academic_period_id},
    )

    assert response.status_code == 403


def test_teacher_cannot_read_student_outside_class_scope(student_record_context):
    ctx = student_record_context
    outside_student = ctx["students"][2]

    response = ctx["client"].get(
        f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}"
        f"/subjects/{ctx['subject'].subject_id}/students/{outside_student.student_id}",
        params={"academic_period_id": ctx["period"].academic_period_id},
    )

    assert response.status_code == 404


def test_teacher_period_options_defaults_to_active_period(student_record_context):
    response = student_record_context["client"].get("/api/v1/student-records/teacher/periods")

    assert response.status_code == 200
    body = response.json()
    assert body["default_academic_period_id"] == student_record_context["period"].academic_period_id
    assert [item["period_name"] for item in body["periods"]] == ["Term 1"]


def test_teacher_period_options_can_be_scoped_to_class_subject(student_record_context):
    ctx = student_record_context
    ctx["db"].add(
        SubjectLoad(
            staff_id=ctx["owner"].staff_id,
            subject_id=ctx["subject"].subject_id,
            class_id=ctx["other_class"].class_id,
            academic_period_id=ctx["old_period"].academic_period_id,
            status="active",
        )
    )
    ctx["db"].commit()

    unscoped = ctx["client"].get("/api/v1/student-records/teacher/periods")
    scoped = ctx["client"].get(
        "/api/v1/student-records/teacher/periods",
        params={
            "class_id": ctx["class"].class_id,
            "subject_id": ctx["subject"].subject_id,
        },
    )

    assert unscoped.status_code == 200
    assert scoped.status_code == 200
    assert [item["period_name"] for item in unscoped.json()["periods"]] == ["Term 1", "Term 2"]
    assert [item["period_name"] for item in scoped.json()["periods"]] == ["Term 1"]


def test_student_record_falls_back_to_class_subject_work_when_period_dates_miss(student_record_context):
    ctx = student_record_context
    ctx["db"].add(
        SubjectLoad(
            staff_id=ctx["owner"].staff_id,
            subject_id=ctx["subject"].subject_id,
            class_id=ctx["class"].class_id,
            academic_period_id=ctx["old_period"].academic_period_id,
            status="active",
        )
    )
    ctx["db"].commit()

    response = ctx["client"].get(
        f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}"
        f"/subjects/{ctx['subject'].subject_id}/students/{ctx['students'][0].student_id}",
        params={"academic_period_id": ctx["old_period"].academic_period_id},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["scope"]["period_name"] == "Term 2"
    assert len(body["classwork_results"]) == 3
    assert body["summary"]["assigned_count"] == 3


def test_student_record_keeps_overdue_work_outside_period_date_window(student_record_context):
    ctx = student_record_context
    outside_period_work = Classwork(
        title="Late Project",
        classwork_type="ASSIGNMENT",
        classwork_category="PERFORMANCE_TASK",
        total_points=50,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=ctx["owner"].staff_id,
        is_published=True,
    )
    ctx["db"].add(outside_period_work)
    ctx["db"].flush()
    ctx["db"].add(
        ClassworkAssignment(
            classwork_id=outside_period_work.classwork_id,
            class_id=ctx["class"].class_id,
            assigned_by_staff_id=ctx["owner"].staff_id,
            due_date=datetime(2025, 10, 1, 12, 0, tzinfo=timezone.utc),
            is_published=True,
        )
    )
    ctx["db"].commit()

    response = ctx["client"].get(
        f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}"
        f"/subjects/{ctx['subject'].subject_id}/students/{ctx['students'][0].student_id}",
        params={"academic_period_id": ctx["period"].academic_period_id},
    )

    assert response.status_code == 200
    body = response.json()
    assert "Late Project" in [item["title"] for item in body["classwork_results"]]
    assert body["summary"]["assigned_count"] == 4
    assert body["summary"]["missing_count"] == 2


def test_roster_counts_scored_submissions_even_before_graded_status(student_record_context):
    ctx = student_record_context
    quiz_assignment = (
        ctx["db"]
        .query(ClassworkAssignment)
        .join(Classwork)
        .filter(Classwork.title == "Assignment 2")
        .one()
    )
    ctx["db"].add(
        StudentSubmission(
            student_id=ctx["students"][0].student_id,
            classwork_assignment_id=quiz_assignment.classwork_assignment_id,
            status="submitted",
            submitted_at=quiz_assignment.due_date - timedelta(hours=1),
            grade=18,
            attempt_count=1,
        )
    )
    ctx["db"].commit()

    response = ctx["client"].get(
        f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}"
        f"/subjects/{ctx['subject'].subject_id}/roster",
        params={"academic_period_id": ctx["period"].academic_period_id},
    )

    assert response.status_code == 200
    ana = response.json()["students"][0]
    assert ana["running_classwork_percentage"] == pytest.approx(81.67)
    assert ana["ungraded_count"] == 1
