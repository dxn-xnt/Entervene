"""Tests preventing past or current deadlines on classwork/quiz creation and deadline updates."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import json
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.schemas.Classwork import ClassworkAssignRequest
from app.services.classwork.ClassworkService import (
    assign_classwork_to_classes,
    create_classwork_wizard_record,
)
from app.services.classwork.ClassworkShared import (
    DEADLINE_FUTURE_ERROR,
    same_instant,
    validate_future_deadline,
)


MANILA_TZ = timezone(timedelta(hours=8))


def test_validate_future_deadline_boundaries_with_frozen_now():
    # Current time: 2026-11-23 15:30:00+08:00 == 2026-11-23 07:30:00Z
    now = datetime(2026, 11, 23, 7, 30, 0, tzinfo=timezone.utc)

    # None is allowed (optional due date)
    validate_future_deadline(None, now=now)

    # Today 3:00 PM (+08:00) -> rejected
    with pytest.raises(HTTPException) as past_today:
        validate_future_deadline(datetime(2026, 11, 23, 15, 0, 0, tzinfo=MANILA_TZ), now=now)
    assert past_today.value.status_code == 400
    assert past_today.value.detail == DEADLINE_FUTURE_ERROR

    # Today 3:30 PM (+08:00) == now -> rejected
    with pytest.raises(HTTPException) as equal_now:
        validate_future_deadline(datetime(2026, 11, 23, 15, 30, 0, tzinfo=MANILA_TZ), now=now)
    assert equal_now.value.status_code == 400
    assert equal_now.value.detail == DEADLINE_FUTURE_ERROR

    # Yesterday any time -> rejected
    with pytest.raises(HTTPException) as yesterday:
        validate_future_deadline(datetime(2026, 11, 22, 23, 59, 0, tzinfo=MANILA_TZ), now=now)
    assert yesterday.value.status_code == 400
    assert yesterday.value.detail == DEADLINE_FUTURE_ERROR

    # Today 3:31 PM (+08:00) -> accepted
    validate_future_deadline(datetime(2026, 11, 23, 15, 31, 0, tzinfo=MANILA_TZ), now=now)

    # Tomorrow 8:00 AM (+08:00) -> accepted
    validate_future_deadline(datetime(2026, 11, 24, 8, 0, 0, tzinfo=MANILA_TZ), now=now)


def test_validate_future_deadline_timezone_date_boundary_consistency():
    # 2026-11-22 16:00:00Z == 2026-11-23 00:00:00+08:00 (midnight boundary)
    now_utc = datetime(2026, 11, 22, 16, 0, 0, tzinfo=timezone.utc)

    # Same instant expressed in +08:00 is rejected
    with pytest.raises(HTTPException) as midnight_equal:
        validate_future_deadline(datetime(2026, 11, 23, 0, 0, 0, tzinfo=MANILA_TZ), now=now_utc)
    assert midnight_equal.value.status_code == 400

    # One minute later in +08:00 is accepted
    validate_future_deadline(datetime(2026, 11, 23, 0, 1, 0, tzinfo=MANILA_TZ), now=now_utc)

    # same_instant treats equivalent instants in different zones (or naive UTC) as equal
    assert same_instant(
        datetime(2026, 11, 22, 16, 0, 0),
        datetime(2026, 11, 23, 0, 0, 0, tzinfo=MANILA_TZ),
    ) is True


@pytest.fixture
def teacher_classwork_env():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    lrn_check = next(
        (c for c in Student.__table__.constraints if isinstance(c, CheckConstraint) and c.name == "lrn_check"),
        None,
    )
    if lrn_check and lrn_check in Student.__table__.constraints:
        Student.__table__.constraints.remove(lrn_check)
    try:
        Base.metadata.create_all(bind=engine)
    finally:
        if lrn_check and lrn_check not in Student.__table__.constraints:
            Student.__table__.append_constraint(lrn_check)

    db = sessionmaker(bind=engine)()

    year = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 12, 31),
        is_active=True,
    )
    level = AcademicLevel(level_name="Grade 10", grade_level=10)
    db.add_all([year, level])
    db.flush()

    period = AcademicPeriod(
        period_name="First Quarter",
        academic_year_id=year.academic_year_id,
        period_sequence=1,
        start_date=date(2025, 6, 1),
        end_date=date(2026, 12, 31),
        is_active=True,
    )
    db.add(period)
    db.flush()

    teacher_user = UserAccount(
        user_id=uuid.uuid4(),
        email="teacher-deadline@example.test",
        password_hash="x",
        account_status="active",
    )
    db.add(teacher_user)
    db.flush()

    teacher = AcademicStaff(
        staff_id="T-DEADLINE",
        first_name="Deadline",
        last_name="Teacher",
        user_id=teacher_user.user_id,
    )
    template = GradingTemplate(
        template_name="Core",
        passing_threshold=Decimal("75.00"),
        status="active",
    )
    db.add_all([teacher, template])
    db.flush()

    subject = Subject(
        subject_codename="MATH10",
        subject_name="Math 10",
        academic_level_id=level.academic_level_id,
        grading_template_id=template.grading_template_id,
    )
    db.add(subject)
    db.flush()

    class_ = Class(
        section_name="10-Einstein",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add(class_)
    db.flush()

    db.add(SubjectLoad(
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        academic_period_id=period.academic_period_id,
        staff_id=teacher.staff_id,
        status="active",
        is_active_version=True,
    ))

    lesson = Lesson(
        title="Quadratic Equations",
        subject_id=subject.subject_id,
        created_by_staff_id=teacher.staff_id,
        is_published=True,
        is_draft=False,
    )
    db.add(lesson)
    db.commit()

    yield {
        "db": db,
        "teacher": teacher,
        "teacher_user": teacher_user,
        "subject": subject,
        "class_": class_,
        "period": period,
        "lesson": lesson,
    }
    db.close()


def _create_assignment(env, *, due_date: datetime | None, classwork_type: str = "ASSIGNMENT"):
    return asyncio.run(create_classwork_wizard_record(
        title="Deadline Test Work",
        classwork_type=classwork_type,
        subject_id=env["subject"].subject_id,
        description="Test description",
        instructions="Test instructions",
        classwork_category="WRITTEN_WORK",
        total_points=20.0,
        is_published=True,
        class_ids=json.dumps([env["class_"].class_id]),
        academic_period_id=env["period"].academic_period_id,
        lesson_ids=json.dumps([env["lesson"].lesson_id]),
        due_date=due_date,
        lock_date=None,
        allow_late_submissions=False,
        max_attempts=1,
        quiz_payload=None,
        rubric_payload=None,
        files=None,
        current_user={"sub": str(env["teacher_user"].user_id), "role": "teacher"},
        staff_id=env["teacher"].staff_id,
        db=env["db"],
    ))


def test_create_classwork_rejects_past_and_accepts_future_deadline(teacher_classwork_env):
    env = teacher_classwork_env

    # Past deadline rejected
    with pytest.raises(HTTPException) as err:
        _create_assignment(env, due_date=datetime.now(timezone.utc) - timedelta(minutes=1))
    assert err.value.status_code == 400
    assert err.value.detail == DEADLINE_FUTURE_ERROR

    # Future deadline accepted
    created = _create_assignment(env, due_date=datetime.now(timezone.utc) + timedelta(hours=2))
    assert created.classwork_id is not None


def test_historical_classwork_allows_unrelated_edits_but_rejects_modified_past_deadline(
    teacher_classwork_env,
):
    env = teacher_classwork_env
    db = env["db"]

    historical_due = datetime.now(timezone.utc) - timedelta(days=5)
    cw = Classwork(
        title="Historical Assignment",
        classwork_type="ASSIGNMENT",
        classwork_category="WRITTEN_WORK",
        is_graded=True,
        total_points=Decimal("20.00"),
        subject_id=env["subject"].subject_id,
        created_by_staff_id=env["teacher"].staff_id,
        is_published=True,
    )
    db.add(cw)
    db.flush()
    asgn = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=env["class_"].class_id,
        academic_period_id=env["period"].academic_period_id,
        assigned_by_staff_id=env["teacher"].staff_id,
        due_date=historical_due,
        allow_late_submissions=False,
        is_published=True,
    )
    db.add(asgn)
    db.commit()

    # 1. Updating unrelated settings while keeping the historical due_date unchanged succeeds
    res = assign_classwork_to_classes(
        cw.classwork_id,
        ClassworkAssignRequest(
            class_ids=[env["class_"].class_id],
            academic_period_id=env["period"].academic_period_id,
            due_date=historical_due,
            lock_date=None,
            allow_late_submissions=True,
            max_attempts=None,
            is_published=True,
        ),
        env["teacher"].staff_id,
        db,
        current_user={"sub": str(env["teacher_user"].user_id), "role": "teacher"},
    )
    assert res is not None
    db.refresh(asgn)
    assert asgn.allow_late_submissions is True
    assert same_instant(asgn.due_date, historical_due) is True

    # 2. Modifying the deadline to a different past instant is rejected
    with pytest.raises(HTTPException) as err:
        assign_classwork_to_classes(
            cw.classwork_id,
            ClassworkAssignRequest(
                class_ids=[env["class_"].class_id],
                academic_period_id=env["period"].academic_period_id,
                due_date=datetime.now(timezone.utc) - timedelta(days=1),
                lock_date=None,
                allow_late_submissions=True,
                max_attempts=None,
                is_published=True,
            ),
            env["teacher"].staff_id,
            db,
            current_user={"sub": str(env["teacher_user"].user_id), "role": "teacher"},
        )
    assert err.value.status_code == 400
    assert err.value.detail == DEADLINE_FUTURE_ERROR

    # 3. Modifying the deadline to a future instant succeeds
    new_future_due = datetime.now(timezone.utc) + timedelta(days=2)
    res_future = assign_classwork_to_classes(
        cw.classwork_id,
        ClassworkAssignRequest(
            class_ids=[env["class_"].class_id],
            academic_period_id=env["period"].academic_period_id,
            due_date=new_future_due,
            lock_date=None,
            allow_late_submissions=True,
            max_attempts=None,
            is_published=True,
        ),
        env["teacher"].staff_id,
        db,
        current_user={"sub": str(env["teacher_user"].user_id), "role": "teacher"},
    )
    assert res_future is not None
    db.refresh(asgn)
    assert same_instant(asgn.due_date, new_future_due) is True
