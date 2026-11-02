from __future__ import annotations

import json
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("SECRET_KEY", "test-secret-key-with-at-least-32-characters")

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Attendance import router as attendance_router
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Classworks import router as classworks_router
from app.api.v1.routes.LessonDeliveries import router as lesson_deliveries_router
from app.api.v1.routes.LessonGoals import router as lesson_goals_router
from app.api.v1.routes.Lessons import router as lessons_router
from app.api.v1.routes.StudentRecords import router as student_records_router
from app.api.v1.routes.Submissions import router as submissions_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.LessonDelivery import LessonDelivery
from app.models.academic.LessonGoal import LessonGoal
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.attendance.Attendance import AttendanceRecord
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.academic.SubjectLoadAuthorizationService import (
    AcademicContextState,
    SubjectAccessLevel,
    SubjectLoadAuthorizationService,
)


@pytest.fixture
def historical_access_context():
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

    # 1. Academic Years: Historical (2024-2025), Current (2025-2026), Future (2026-2027)
    hist_year = AcademicYear(
        year_label="2024-2025",
        start_date=date(2024, 6, 1),
        end_date=date(2025, 3, 31),
        is_active=False,
    )
    curr_year = AcademicYear(
        year_label="2025-2026",
        start_date=date.today() - timedelta(days=120),
        end_date=date.today() + timedelta(days=120),
        is_active=True,
    )
    future_year = AcademicYear(
        year_label="2026-2027",
        start_date=date.today() + timedelta(days=180),
        end_date=date.today() + timedelta(days=500),
        is_active=False,
    )
    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    template = GradingTemplate(
        grading_template_id=1,
        template_name="DepEd Standard",
        passing_threshold=Decimal("75.0"),
        status="active",
    )
    template.components = [
        GradingTemplateComponent(component_name="Written Work", weight=Decimal("30.0"), display_order=1),
        GradingTemplateComponent(component_name="Performance Tasks", weight=Decimal("50.0"), display_order=2),
        GradingTemplateComponent(component_name="Exams", weight=Decimal("20.0"), display_order=3),
    ]
    db.add_all([hist_year, curr_year, future_year, level, template])
    db.flush()

    # 2. Academic Periods
    hist_period_t1 = AcademicPeriod(
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.3333"),
        start_date=date(2024, 6, 1),
        end_date=date(2024, 8, 31),
        academic_year_id=hist_year.academic_year_id,
        is_active=False,
    )
    curr_closed_t1 = AcademicPeriod(
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.3333"),
        start_date=date.today() - timedelta(days=120),
        end_date=date.today() - timedelta(days=30),
        academic_year_id=curr_year.academic_year_id,
        is_active=False,
    )
    curr_active_t2 = AcademicPeriod(
        period_name="Term 2",
        period_type="TERM",
        period_sequence=2,
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.6667"),
        start_date=date.today() - timedelta(days=29),
        end_date=date.today() + timedelta(days=2),
        academic_year_id=curr_year.academic_year_id,
        is_active=True,
    )
    curr_future_t3 = AcademicPeriod(
        period_name="Term 3",
        period_type="TERM",
        period_sequence=3,
        total_periods_in_year=3,
        period_progress_ratio=Decimal("1.0000"),
        start_date=date.today() + timedelta(days=3),
        end_date=date.today() + timedelta(days=90),
        academic_year_id=curr_year.academic_year_id,
        is_active=False,
    )
    future_year_t1 = AcademicPeriod(
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.3333"),
        start_date=date.today() + timedelta(days=180),
        end_date=date.today() + timedelta(days=270),
        academic_year_id=future_year.academic_year_id,
        is_active=False,
    )
    subject = Subject(
        subject_name="Mathematics",
        academic_level_id=level.academic_level_id,
        grading_template_id=template.grading_template_id,
        status="active",
    )
    db.add_all([hist_period_t1, curr_closed_t1, curr_active_t2, curr_future_t3, future_year_t1, subject])
    db.flush()

    # 3. Accounts, Teachers, and Student
    owner_acc = UserAccount(user_id=uuid.uuid4(), email="owner@entervene.test", password_hash="x")
    other_acc = UserAccount(user_id=uuid.uuid4(), email="other@entervene.test", password_hash="x")
    student_acc = UserAccount(user_id=uuid.uuid4(), email="student@entervene.test", password_hash="x")
    db.add_all([owner_acc, other_acc, student_acc])
    db.flush()

    owner = AcademicStaff(
        staff_id="T-HIST-OWNER",
        first_name="Elena",
        last_name="Reyes",
        user_id=owner_acc.user_id,
        employment_status="active",
    )
    other = AcademicStaff(
        staff_id="T-HIST-OTHER",
        first_name="Marco",
        last_name="Diaz",
        user_id=other_acc.user_id,
        employment_status="active",
    )
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000123",
        first_name="Lara",
        last_name="Mendoza",
        gender="Female",
        academic_level_id=level.academic_level_id,
        user_id=student_acc.user_id,
    )
    student_alt = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000124",
        first_name="Mateo",
        last_name="Ramos",
        gender="Male",
        academic_level_id=level.academic_level_id,
    )
    db.add_all([owner, other, student, student_alt])
    db.flush()

    # 4. Classes:
    # - hist_archived_class: AY 2024-2025, class_status="archived"
    # - hist_active_status_class: AY 2024-2025, class_status="active" (retained historical class)
    # - curr_class: AY 2025-2026, class_status="active"
    # - curr_archived_class: AY 2025-2026, class_status="archived"
    hist_archived_class = Class(
        section_name="Rizal-2024",
        academic_year_id=hist_year.academic_year_id,
        academic_level_id=level.academic_level_id,
        adviser_staff_id=owner.staff_id,
        class_status="archived",
    )
    hist_active_status_class = Class(
        section_name="Bonifacio-2024",
        academic_year_id=hist_year.academic_year_id,
        academic_level_id=level.academic_level_id,
        adviser_staff_id=None,
        class_status="active",
    )
    curr_class = Class(
        section_name="Rizal-2025",
        academic_year_id=curr_year.academic_year_id,
        academic_level_id=level.academic_level_id,
        adviser_staff_id=owner.staff_id,
        class_status="active",
    )
    curr_archived_class = Class(
        section_name="Mabini-Archived",
        academic_year_id=curr_year.academic_year_id,
        academic_level_id=level.academic_level_id,
        adviser_staff_id=None,
        class_status="archived",
    )
    db.add_all([hist_archived_class, hist_active_status_class, curr_class, curr_archived_class])
    db.flush()

    # 5. Enrollments & Subject Loads
    for stu_obj, cls_obj, yr_obj in [
        (student, hist_archived_class, hist_year),
        (student_alt, hist_active_status_class, hist_year),
        (student, curr_class, curr_year),
        (student_alt, curr_archived_class, curr_year),
    ]:
        db.add(
            StudentClass(
                student_id=stu_obj.student_id,
                class_id=cls_obj.class_id,
                academic_year_id=yr_obj.academic_year_id,
                enrollment_status="enrolled",
            )
        )

    loads = [
        SubjectLoad(
            staff_id=owner.staff_id,
            class_id=hist_archived_class.class_id,
            subject_id=subject.subject_id,
            academic_period_id=hist_period_t1.academic_period_id,
            status="published",
            is_active_version=True,
        ),
        SubjectLoad(
            staff_id=owner.staff_id,
            class_id=hist_active_status_class.class_id,
            subject_id=subject.subject_id,
            academic_period_id=hist_period_t1.academic_period_id,
            status="published",
            is_active_version=True,
        ),
        SubjectLoad(
            staff_id=owner.staff_id,
            class_id=curr_class.class_id,
            subject_id=subject.subject_id,
            academic_period_id=curr_closed_t1.academic_period_id,
            status="published",
            is_active_version=True,
        ),
        SubjectLoad(
            staff_id=owner.staff_id,
            class_id=curr_class.class_id,
            subject_id=subject.subject_id,
            academic_period_id=curr_active_t2.academic_period_id,
            status="published",
            is_active_version=True,
        ),
        SubjectLoad(
            staff_id=owner.staff_id,
            class_id=curr_class.class_id,
            subject_id=subject.subject_id,
            academic_period_id=curr_future_t3.academic_period_id,
            status="published",
            is_active_version=True,
        ),
        SubjectLoad(
            staff_id=owner.staff_id,
            class_id=curr_archived_class.class_id,
            subject_id=subject.subject_id,
            academic_period_id=curr_active_t2.academic_period_id,
            status="published",
            is_active_version=True,
        ),
    ]
    db.add_all(loads)
    db.flush()

    # 6. Historical Records in hist_archived_class (AY 2024-2025 Term 1)
    hist_cw = Classwork(
        title="2024 Diagnostic Quiz",
        classwork_type="ASSIGNMENT",
        classwork_category="WRITTEN_WORK",
        total_points=Decimal("100.0"),
        subject_id=subject.subject_id,
        created_by_staff_id=owner.staff_id,
        is_published=True,
        is_graded=True,
    )
    curr_t1_cw = Classwork(
        title="2025 Term 1 Seatwork",
        classwork_type="ASSIGNMENT",
        classwork_category="WRITTEN_WORK",
        total_points=Decimal("100.0"),
        subject_id=subject.subject_id,
        created_by_staff_id=owner.staff_id,
        is_published=True,
        is_graded=True,
    )
    curr_t2_cw = Classwork(
        title="2025 Term 2 Active Task",
        classwork_type="ASSIGNMENT",
        classwork_category="WRITTEN_WORK",
        total_points=Decimal("100.0"),
        subject_id=subject.subject_id,
        created_by_staff_id=owner.staff_id,
        is_published=True,
        is_graded=True,
    )
    db.add_all([hist_cw, curr_t1_cw, curr_t2_cw])
    db.flush()

    hist_asgn = ClassworkAssignment(
        classwork_id=hist_cw.classwork_id,
        class_id=hist_archived_class.class_id,
        academic_period_id=hist_period_t1.academic_period_id,
        assigned_by_staff_id=owner.staff_id,
        due_date=datetime(2024, 7, 15, 12, 0, tzinfo=timezone.utc),
        is_published=True,
    )
    curr_t1_asgn = ClassworkAssignment(
        classwork_id=curr_t1_cw.classwork_id,
        class_id=curr_class.class_id,
        academic_period_id=curr_closed_t1.academic_period_id,
        assigned_by_staff_id=owner.staff_id,
        due_date=datetime(2025, 7, 15, 12, 0, tzinfo=timezone.utc),
        is_published=True,
    )
    curr_t2_asgn = ClassworkAssignment(
        classwork_id=curr_t2_cw.classwork_id,
        class_id=curr_class.class_id,
        academic_period_id=curr_active_t2.academic_period_id,
        assigned_by_staff_id=owner.staff_id,
        due_date=datetime.now(timezone.utc) + timedelta(days=5),
        is_published=True,
    )
    db.add_all([hist_asgn, curr_t1_asgn, curr_t2_asgn])
    db.flush()

    hist_sub = StudentSubmission(
        student_id=student.student_id,
        classwork_assignment_id=hist_asgn.classwork_assignment_id,
        status="graded",
        grade=Decimal("92.0"),
        submitted_at=datetime(2024, 7, 14, 10, 0, tzinfo=timezone.utc),
        graded_at=datetime(2024, 7, 16, 10, 0, tzinfo=timezone.utc),
        graded_by_staff_id=owner.staff_id,
        attempt_count=1,
    )
    curr_t1_sub = StudentSubmission(
        student_id=student.student_id,
        classwork_assignment_id=curr_t1_asgn.classwork_assignment_id,
        status="graded",
        grade=Decimal("88.0"),
        submitted_at=datetime(2025, 7, 14, 10, 0, tzinfo=timezone.utc),
        graded_at=datetime(2025, 7, 16, 10, 0, tzinfo=timezone.utc),
        graded_by_staff_id=owner.staff_id,
        attempt_count=1,
    )
    curr_t2_sub = StudentSubmission(
        student_id=student.student_id,
        classwork_assignment_id=curr_t2_asgn.classwork_assignment_id,
        status="submitted",
        grade=None,
        submitted_at=datetime.now(timezone.utc) - timedelta(hours=2),
        attempt_count=1,
    )
    db.add_all([hist_sub, curr_t1_sub, curr_t2_sub])
    db.flush()

    hist_pg = StudentPeriodGrade(
        student_id=student.student_id,
        class_id=hist_archived_class.class_id,
        subject_id=subject.subject_id,
        academic_period_id=hist_period_t1.academic_period_id,
        initial_grade=Decimal("92.0"),
        transmuted_grade=Decimal("94.0"),
        final_period_grade=Decimal("94.0"),
        is_finalized=True,
        finalized_at=datetime(2024, 8, 30, 12, 0, tzinfo=timezone.utc),
        finalized_by_staff_id=owner.staff_id,
        entered_by_staff_id=owner.staff_id,
    )
    curr_t1_pg = StudentPeriodGrade(
        student_id=student.student_id,
        class_id=curr_class.class_id,
        subject_id=subject.subject_id,
        academic_period_id=curr_closed_t1.academic_period_id,
        initial_grade=Decimal("88.0"),
        transmuted_grade=Decimal("92.0"),
        final_period_grade=Decimal("92.0"),
        is_finalized=True,
        finalized_at=datetime(2025, 8, 30, 12, 0, tzinfo=timezone.utc),
        finalized_by_staff_id=owner.staff_id,
        entered_by_staff_id=owner.staff_id,
    )
    curr_t2_pg = StudentPeriodGrade(
        student_id=student.student_id,
        class_id=curr_class.class_id,
        subject_id=subject.subject_id,
        academic_period_id=curr_active_t2.academic_period_id,
        initial_grade=Decimal("85.0"),
        transmuted_grade=Decimal("90.0"),
        final_period_grade=Decimal("90.0"),
        is_finalized=False,
        entered_by_staff_id=owner.staff_id,
    )
    db.add_all([hist_pg, curr_t1_pg, curr_t2_pg])

    # Historical Lesson, LessonAssignment, LessonDelivery, LessonGoal, and Attendance
    hist_lesson = Lesson(
        title="2024 Linear Equations",
        subject_id=subject.subject_id,
        created_by_staff_id=owner.staff_id,
        is_published=True,
        is_draft=False,
    )
    curr_lesson = Lesson(
        title="2025 Quadratic Equations",
        subject_id=subject.subject_id,
        created_by_staff_id=owner.staff_id,
        is_published=True,
        is_draft=False,
    )
    db.add_all([hist_lesson, curr_lesson])
    db.flush()

    db.add_all([
        LessonAssignment(
            lesson_id=hist_lesson.lesson_id,
            class_id=hist_archived_class.class_id,
            assigned_by_staff_id=owner.staff_id,
            is_published=True,
        ),
        LessonAssignment(
            lesson_id=curr_lesson.lesson_id,
            class_id=curr_class.class_id,
            assigned_by_staff_id=owner.staff_id,
            is_published=True,
        ),
        LessonDelivery(
            lesson_id=hist_lesson.lesson_id,
            class_id=hist_archived_class.class_id,
            subject_id=subject.subject_id,
            academic_period_id=hist_period_t1.academic_period_id,
            delivered_by_staff_id=owner.staff_id,
            delivered_at=datetime(2024, 7, 10, 9, 0, tzinfo=timezone.utc),
        ),
        LessonGoal(
            class_id=hist_archived_class.class_id,
            subject_id=subject.subject_id,
            academic_period_id=hist_period_t1.academic_period_id,
            created_by_staff_id=owner.staff_id,
        ),
        AttendanceRecord(
            student_id=student.student_id,
            class_id=hist_archived_class.class_id,
            subject_id=subject.subject_id,
            date=date(2024, 7, 10),
            status="present",
            recorded_by_staff_id=owner.staff_id,
        ),
    ])
    db.commit()

    identity = {"sub": str(owner_acc.user_id), "user_id": str(owner_acc.user_id), "role": "teacher"}
    app = FastAPI()
    app.include_router(student_records_router, prefix="/api/v1/student-records")
    app.include_router(submissions_router, prefix="/api/v1/submissions")
    app.include_router(attendance_router, prefix="/api/v1/attendance")
    app.include_router(classworks_router, prefix="/api/v1/classwork-assignments")
    app.include_router(lessons_router, prefix="/api/v1/lessons")
    app.include_router(lesson_deliveries_router, prefix="/api/v1/lesson-deliveries")
    app.include_router(lesson_goals_router, prefix="/api/v1/lesson-goals")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: identity

    with TestClient(app, raise_server_exceptions=False) as client:
        yield {
            "client": client,
            "db": db,
            "identity": identity,
            "owner": owner,
            "other": other,
            "owner_acc": owner_acc,
            "other_acc": other_acc,
            "student_acc": student_acc,
            "student": student,
            "student_alt": student_alt,
            "subject": subject,
            "hist_year": hist_year,
            "curr_year": curr_year,
            "future_year": future_year,
            "hist_period_t1": hist_period_t1,
            "curr_closed_t1": curr_closed_t1,
            "curr_active_t2": curr_active_t2,
            "curr_future_t3": curr_future_t3,
            "future_year_t1": future_year_t1,
            "hist_archived_class": hist_archived_class,
            "hist_active_status_class": hist_active_status_class,
            "curr_class": curr_class,
            "curr_archived_class": curr_archived_class,
            "hist_cw": hist_cw,
            "curr_t1_cw": curr_t1_cw,
            "curr_t2_cw": curr_t2_cw,
            "hist_asgn": hist_asgn,
            "curr_t1_asgn": curr_t1_asgn,
            "curr_t2_asgn": curr_t2_asgn,
            "hist_sub": hist_sub,
            "curr_t1_sub": curr_t1_sub,
            "curr_t2_sub": curr_t2_sub,
            "hist_pg": hist_pg,
            "curr_t1_pg": curr_t1_pg,
            "curr_t2_pg": curr_t2_pg,
            "hist_lesson": hist_lesson,
            "curr_lesson": curr_lesson,
        }

    db.close()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def _act_as(ctx, account, role: str = "teacher") -> None:
    ctx["identity"].update({
        "sub": str(account.user_id),
        "user_id": str(account.user_id),
        "role": role,
    })


def test_academic_context_classification_distinguishes_historical_current_and_future(historical_access_context):
    ctx = historical_access_context
    db = ctx["db"]

    # 1. Academic Year classification
    assert SubjectLoadAuthorizationService.classify_academic_year(db, ctx["hist_year"]) == AcademicContextState.HISTORICAL
    assert SubjectLoadAuthorizationService.classify_academic_year(db, ctx["curr_year"]) == AcademicContextState.CURRENT
    assert SubjectLoadAuthorizationService.classify_academic_year(db, ctx["future_year"]) == AcademicContextState.FUTURE

    # 2. Academic Period classification
    assert SubjectLoadAuthorizationService.classify_academic_period(db, ctx["hist_period_t1"]) == AcademicContextState.HISTORICAL
    assert SubjectLoadAuthorizationService.classify_academic_period(db, ctx["curr_closed_t1"]) == AcademicContextState.HISTORICAL
    assert SubjectLoadAuthorizationService.classify_academic_period(db, ctx["curr_active_t2"]) == AcademicContextState.CURRENT
    # Inactive Term 3 in current year is FUTURE, not HISTORICAL
    assert SubjectLoadAuthorizationService.classify_academic_period(db, ctx["curr_future_t3"]) == AcademicContextState.FUTURE
    assert SubjectLoadAuthorizationService.classify_academic_period(db, ctx["future_year_t1"]) == AcademicContextState.FUTURE

    # 3. Access levels for owner teacher
    owner_id = ctx["owner"].staff_id
    subj_id = ctx["subject"].subject_id
    assert SubjectLoadAuthorizationService.get_teacher_access_level(
        db, owner_id, ctx["hist_archived_class"].class_id, subj_id, ctx["hist_period_t1"].academic_period_id
    ) == SubjectAccessLevel.VIEW_ONLY
    assert SubjectLoadAuthorizationService.get_teacher_access_level(
        db, owner_id, ctx["hist_active_status_class"].class_id, subj_id, ctx["hist_period_t1"].academic_period_id
    ) == SubjectAccessLevel.VIEW_ONLY
    assert SubjectLoadAuthorizationService.get_teacher_access_level(
        db, owner_id, ctx["curr_class"].class_id, subj_id, ctx["curr_closed_t1"].academic_period_id
    ) == SubjectAccessLevel.VIEW_ONLY
    assert SubjectLoadAuthorizationService.get_teacher_access_level(
        db, owner_id, ctx["curr_archived_class"].class_id, subj_id, ctx["curr_active_t2"].academic_period_id
    ) == SubjectAccessLevel.VIEW_ONLY
    assert SubjectLoadAuthorizationService.get_teacher_access_level(
        db, owner_id, ctx["curr_class"].class_id, subj_id, ctx["curr_active_t2"].academic_period_id
    ) == SubjectAccessLevel.WRITE
    assert SubjectLoadAuthorizationService.get_teacher_access_level(
        db, owner_id, ctx["curr_class"].class_id, subj_id, ctx["curr_future_t3"].academic_period_id
    ) == SubjectAccessLevel.WRITE

    # Cross-year mismatch between class and period is DENIED
    assert SubjectLoadAuthorizationService.get_teacher_access_level(
        db, owner_id, ctx["curr_class"].class_id, subj_id, ctx["hist_period_t1"].academic_period_id
    ) == SubjectAccessLevel.DENIED


def _assert_operational_write_conflict(ctx, expected_detail: str) -> None:
    db = ctx["db"]
    with pytest.raises(HTTPException) as context_exc:
        SubjectLoadAuthorizationService.assert_context_writable(
            db,
            class_id=ctx["curr_class"].class_id,
            academic_period_id=ctx["curr_active_t2"].academic_period_id,
        )
    assert context_exc.value.status_code == 409
    assert context_exc.value.detail == expected_detail

    with pytest.raises(HTTPException) as teacher_exc:
        SubjectLoadAuthorizationService.assert_can_write(
            db,
            ctx["owner"].staff_id,
            ctx["curr_class"].class_id,
            ctx["subject"].subject_id,
            ctx["curr_active_t2"].academic_period_id,
        )
    assert teacher_exc.value.status_code == 409
    assert teacher_exc.value.detail == expected_detail

    SubjectLoadAuthorizationService.assert_can_view(
        db,
        ctx["owner"].staff_id,
        ctx["curr_class"].class_id,
        ctx["subject"].subject_id,
        ctx["curr_active_t2"].academic_period_id,
    )


def test_operational_writes_require_one_active_academic_year(historical_access_context):
    ctx = historical_access_context
    ctx["hist_year"].is_active = True
    ctx["db"].commit()

    _assert_operational_write_conflict(
        ctx,
        "Academic lifecycle is inconsistent: multiple academic years are active.",
    )


def test_operational_writes_require_one_active_academic_period(historical_access_context):
    ctx = historical_access_context
    ctx["curr_future_t3"].is_active = True
    ctx["db"].commit()

    _assert_operational_write_conflict(
        ctx,
        "Academic lifecycle is inconsistent: multiple grading periods are active.",
    )


def test_operational_writes_reject_cross_year_active_period(historical_access_context):
    ctx = historical_access_context
    ctx["curr_active_t2"].is_active = False
    ctx["hist_period_t1"].is_active = True
    ctx["db"].commit()

    _assert_operational_write_conflict(
        ctx,
        "Academic lifecycle is inconsistent: the active grading period is not in the active academic year.",
    )


@pytest.mark.parametrize("missing", ["year", "period"])
def test_operational_writes_reject_missing_active_lifecycle(historical_access_context, missing):
    ctx = historical_access_context
    if missing == "year":
        ctx["curr_year"].is_active = False
        expected = "No active academic year is configured."
    else:
        expected = "No active grading period is configured."
    ctx["curr_active_t2"].is_active = False
    ctx["db"].commit()

    _assert_operational_write_conflict(ctx, expected)


def test_context_write_guard_rejects_class_period_year_mismatch(historical_access_context):
    ctx = historical_access_context

    with pytest.raises(HTTPException) as exc_info:
        SubjectLoadAuthorizationService.assert_context_writable(
            ctx["db"],
            class_id=ctx["curr_class"].class_id,
            academic_period_id=ctx["hist_period_t1"].academic_period_id,
        )

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Academic class and period must belong to the same academic year."


def test_current_writes_historical_reads_and_future_preparation_remain_available(historical_access_context):
    ctx = historical_access_context
    db = ctx["db"]
    owner_id = ctx["owner"].staff_id
    subject_id = ctx["subject"].subject_id

    SubjectLoadAuthorizationService.assert_context_writable(
        db,
        class_id=ctx["curr_class"].class_id,
        academic_period_id=ctx["curr_active_t2"].academic_period_id,
    )
    SubjectLoadAuthorizationService.assert_can_write(
        db,
        owner_id,
        ctx["curr_class"].class_id,
        subject_id,
        ctx["curr_active_t2"].academic_period_id,
    )
    SubjectLoadAuthorizationService.assert_can_view(
        db,
        owner_id,
        ctx["hist_archived_class"].class_id,
        subject_id,
        ctx["hist_period_t1"].academic_period_id,
    )
    SubjectLoadAuthorizationService.assert_context_configurable(
        db,
        academic_year_id=ctx["future_year"].academic_year_id,
    )
    SubjectLoadAuthorizationService.assert_can_write(
        db,
        owner_id,
        ctx["curr_class"].class_id,
        subject_id,
        ctx["curr_future_t3"].academic_period_id,
    )

    with pytest.raises(HTTPException) as historical_exc:
        SubjectLoadAuthorizationService.assert_context_writable(
            db,
            class_id=ctx["hist_archived_class"].class_id,
            academic_period_id=ctx["hist_period_t1"].academic_period_id,
        )
    assert historical_exc.value.status_code == 403


def test_future_configuration_remains_available_without_active_lifecycle(historical_access_context):
    ctx = historical_access_context
    ctx["curr_year"].is_active = False
    ctx["curr_active_t2"].is_active = False
    ctx["db"].commit()

    SubjectLoadAuthorizationService.assert_context_configurable(
        ctx["db"],
        academic_year_id=ctx["future_year"].academic_year_id,
    )


def test_authorized_teacher_can_read_historical_and_archived_records(historical_access_context):
    ctx = historical_access_context
    client = ctx["client"]
    hist_cid = ctx["hist_archived_class"].class_id
    subj_id = ctx["subject"].subject_id
    hist_pid = ctx["hist_period_t1"].academic_period_id
    st_id = ctx["student"].student_id

    # 1. Roster read on archived historical class
    roster_resp = client.get(
        f"/api/v1/student-records/teacher/classes/{hist_cid}/subjects/{subj_id}/roster",
        params={"academic_period_id": hist_pid},
    )
    assert roster_resp.status_code == 200
    roster_body = roster_resp.json()
    assert roster_body["scope"]["year_label"] == "2024-2025"
    assert roster_body["scope"]["is_view_only"] is True
    assert len(roster_body["students"]) == 1
    assert roster_body["students"][0]["official_period_grade"] == 94.0

    # 2. Student detail read on archived historical class
    detail_resp = client.get(
        f"/api/v1/student-records/teacher/classes/{hist_cid}/subjects/{subj_id}/students/{st_id}",
        params={"academic_period_id": hist_pid},
    )
    assert detail_resp.status_code == 200
    assert detail_resp.json()["scope"]["is_view_only"] is True
    assert detail_resp.json()["classwork_results"][0]["title"] == "2024 Diagnostic Quiz"

    # 3. Gradebook read on archived historical class and closed current-year Term 1
    gb_hist = client.get(
        f"/api/v1/student-records/teacher/classes/{hist_cid}/subjects/{subj_id}/gradebook",
        params={"academic_period_id": hist_pid},
    )
    assert gb_hist.status_code == 200
    assert gb_hist.json()["scope"]["is_view_only"] is True
    assert gb_hist.json()["studentGrades"][0]["total"] == "94.0"

    gb_closed_t1 = client.get(
        f"/api/v1/student-records/teacher/classes/{ctx['curr_class'].class_id}/subjects/{subj_id}/gradebook",
        params={"academic_period_id": ctx["curr_closed_t1"].academic_period_id},
    )
    assert gb_closed_t1.status_code == 200
    assert gb_closed_t1.json()["scope"]["is_view_only"] is True

    # 4. Term summary & ECR export on archived historical class
    term_summary = client.get(
        f"/api/v1/student-records/teacher/classes/{hist_cid}/subjects/{subj_id}/term-summary",
        params={"academic_year_id": ctx["hist_year"].academic_year_id},
    )
    assert term_summary.status_code == 200
    assert term_summary.json()["scope"]["year_label"] == "2024-2025"

    export_resp = client.get(
        f"/api/v1/student-records/teacher/classes/{hist_cid}/subjects/{subj_id}/export-class-record",
        params={"academic_period_id": hist_pid},
    )
    assert export_resp.status_code == 200

    # 5. Historical classwork, lesson, lesson delivery, lesson goal, and attendance reads
    assert client.get(f"/api/v1/classwork-assignments/classwork/{ctx['hist_cw'].classwork_id}").status_code == 200
    assert client.get(f"/api/v1/lessons/{ctx['hist_lesson'].lesson_id}").status_code == 200
    assert client.get(
        f"/api/v1/lesson-deliveries/class/{hist_cid}/subject/{subj_id}",
        params={"academic_period_id": hist_pid},
    ).status_code == 200
    assert client.get(
        f"/api/v1/lesson-goals/class/{hist_cid}/subject/{subj_id}",
        params={"academic_period_id": hist_pid},
    ).status_code == 200
    att_resp = client.get(f"/api/v1/attendance/class/{hist_cid}")
    assert att_resp.status_code == 200
    assert len(att_resp.json()) == 1


def test_unauthorized_teacher_cannot_read_historical_or_archived_records(historical_access_context):
    ctx = historical_access_context
    client = ctx["client"]
    _act_as(ctx, ctx["other_acc"], "teacher")

    hist_cid = ctx["hist_archived_class"].class_id
    subj_id = ctx["subject"].subject_id
    hist_pid = ctx["hist_period_t1"].academic_period_id
    st_id = ctx["student"].student_id

    assert client.get(
        f"/api/v1/student-records/teacher/classes/{hist_cid}/subjects/{subj_id}/roster",
        params={"academic_period_id": hist_pid},
    ).status_code == 403
    assert client.get(
        f"/api/v1/student-records/teacher/classes/{hist_cid}/subjects/{subj_id}/gradebook",
        params={"academic_period_id": hist_pid},
    ).status_code == 403
    assert client.get(
        f"/api/v1/student-records/teacher/classes/{hist_cid}/subjects/{subj_id}/students/{st_id}",
        params={"academic_period_id": hist_pid},
    ).status_code == 403
    assert client.get(
        f"/api/v1/student-records/teacher/classes/{hist_cid}/subjects/{subj_id}/term-summary",
        params={"academic_year_id": ctx["hist_year"].academic_year_id},
    ).status_code == 403
    assert client.get(
        f"/api/v1/student-records/teacher/classes/{hist_cid}/subjects/{subj_id}/export-class-record",
        params={"academic_period_id": hist_pid},
    ).status_code == 403
    assert client.get(f"/api/v1/attendance/class/{hist_cid}").status_code == 403
    assert client.get(f"/api/v1/attendance/student/{st_id}/summary", params={"class_id": hist_cid}).status_code == 403
    assert client.get(f"/api/v1/classwork-assignments/classwork/{ctx['hist_cw'].classwork_id}").status_code == 404
    assert client.get(f"/api/v1/lessons/{ctx['hist_lesson'].lesson_id}").status_code == 404
    assert client.get(
        f"/api/v1/lesson-goals/class/{hist_cid}/subject/{subj_id}",
        params={"academic_period_id": hist_pid},
    ).status_code == 404


def test_historical_closed_period_and_archived_writes_are_blocked(historical_access_context):
    ctx = historical_access_context
    client = ctx["client"]
    hist_cid = ctx["hist_archived_class"].class_id
    curr_cid = ctx["curr_class"].class_id
    arch_curr_cid = ctx["curr_archived_class"].class_id
    subj_id = ctx["subject"].subject_id
    hist_pid = ctx["hist_period_t1"].academic_period_id
    closed_t1_pid = ctx["curr_closed_t1"].academic_period_id
    active_t2_pid = ctx["curr_active_t2"].academic_period_id
    st_id = ctx["student"].student_id

    # 1. Send grade to adviser (single & bulk) blocked on historical year, closed Term 1, and archived class
    for cid, pid in [(hist_cid, hist_pid), (curr_cid, closed_t1_pid), (arch_curr_cid, active_t2_pid)]:
        single_send = client.post(
            f"/api/v1/student-records/teacher/classes/{cid}/subjects/{subj_id}/students/{st_id}/send-to-adviser",
            json={"academic_period_id": pid, "final_period_grade": 90.0},
        )
        assert single_send.status_code == 403
        bulk_send = client.post(
            f"/api/v1/student-records/teacher/classes/{cid}/subjects/{subj_id}/periods/{pid}/send-to-adviser",
            json={"force_resend_all": True},
        )
        assert bulk_send.status_code == 403

    # 2. Period grade finalization blocked on historical year and closed Term 1
    assert client.post(
        f"/api/v1/student-records/period-grades/{ctx['hist_pg'].period_grade_id}/finalize",
        json={"final_period_grade": 95.0},
    ).status_code == 403
    assert client.post(
        f"/api/v1/student-records/period-grades/{ctx['curr_t1_pg'].period_grade_id}/finalize",
        json={"final_period_grade": 95.0},
    ).status_code == 403

    # 3. Submission grading blocked on historical year and closed Term 1
    assert client.put(
        f"/api/v1/submissions/{ctx['hist_sub'].submission_id}/grade",
        json={"grade": 95.0},
    ).status_code == 403
    assert client.put(
        f"/api/v1/submissions/{ctx['curr_t1_sub'].submission_id}/grade",
        json={"grade": 95.0},
    ).status_code == 403

    # 4. Attendance batch mark & QR scan blocked on historical class, closed Term 1 date, and archived class
    for cid, att_date in [
        (hist_cid, "2024-07-11"),
        (curr_cid, (date.today() - timedelta(days=60)).isoformat()),  # falls inside closed Term 1
        (arch_curr_cid, date.today().isoformat()),
    ]:
        att_write = client.post(
            "/api/v1/attendance",
            json={
                "class_id": cid,
                "subject_id": subj_id,
                "date": att_date,
                "records": [{"student_id": str(st_id), "status": "present"}],
            },
        )
        assert att_write.status_code == 403

    qr_write = client.post(
        "/api/v1/attendance/scan",
        json={"student_id": str(ctx["student_alt"].student_id), "class_id": arch_curr_cid, "subject_id": subj_id},
    )
    assert qr_write.status_code == 403

    # 5. Classwork mutations & assignments blocked in historical/closed/archived scopes
    for cid, pid in [(hist_cid, hist_pid), (curr_cid, closed_t1_pid), (arch_curr_cid, active_t2_pid)]:
        cw_assign = client.post(
            f"/api/v1/classwork-assignments/classwork/{ctx['curr_t2_cw'].classwork_id}/assign",
            json={"class_ids": [cid], "academic_period_id": pid},
        )
        assert cw_assign.status_code == 403

    assert client.put(
        f"/api/v1/classwork-assignments/classwork/{ctx['hist_cw'].classwork_id}",
        json={"title": "Mutated Historical Title"},
    ).status_code == 403
    assert client.put(
        f"/api/v1/classwork-assignments/classwork/{ctx['hist_cw'].classwork_id}/archive",
    ).status_code == 403
    assert client.put(
        f"/api/v1/classwork-assignments/classwork/{ctx['curr_t1_cw'].classwork_id}",
        json={"title": "Mutated Term 1 Title"},
    ).status_code == 403

    # 6. Lesson, LessonDelivery, and LessonGoal mutations blocked in historical/closed/archived scopes
    assert client.put(
        f"/api/v1/lessons/{ctx['hist_lesson'].lesson_id}",
        json={"title": "Mutated Historical Lesson"},
    ).status_code == 403
    assert client.delete(f"/api/v1/lessons/{ctx['hist_lesson'].lesson_id}").status_code == 403
    assert client.post(
        f"/api/v1/lessons/{ctx['curr_lesson'].lesson_id}/assign",
        json={"class_ids": [hist_cid]},
    ).status_code == 403
    assert client.post(
        f"/api/v1/lessons/{ctx['curr_lesson'].lesson_id}/assign",
        json={"class_ids": [arch_curr_cid]},
    ).status_code == 403
    assert client.post(
        "/api/v1/lesson-deliveries/confirm",
        json={
            "lesson_id": ctx["hist_lesson"].lesson_id,
            "class_id": hist_cid,
            "subject_id": subj_id,
            "academic_period_id": hist_pid,
        },
    ).status_code == 403
    assert client.put(
        f"/api/v1/lesson-goals/class/{hist_cid}/subject/{subj_id}",
        json={"academic_period_id": hist_pid, "items": []},
    ).status_code == 403
    assert client.delete(
        f"/api/v1/lesson-goals/class/{hist_cid}/subject/{subj_id}",
        params={"academic_period_id": hist_pid},
    ).status_code == 403


def test_finalized_period_grade_blocks_submission_regrading_in_active_period(historical_access_context):
    ctx = historical_access_context
    client = ctx["client"]
    db = ctx["db"]

    # In active Term 2, before finalization, teacher can grade the submission
    grade_ok = client.put(
        f"/api/v1/submissions/{ctx['curr_t2_sub'].submission_id}/grade",
        json={"grade": 91.0, "feedback": "Well done"},
    )
    assert grade_ok.status_code == 200
    assert grade_ok.json()["grade"] == 91.0

    # Finalize the student's Term 2 period grade
    fin_resp = client.post(
        f"/api/v1/student-records/period-grades/{ctx['curr_t2_pg'].period_grade_id}/finalize",
        json={"final_period_grade": 92.0},
    )
    assert fin_resp.status_code == 200
    db.refresh(ctx["curr_t2_pg"])
    assert ctx["curr_t2_pg"].is_finalized is True

    # Attempting to overwrite the submission score after the period grade is finalized returns 409
    regrade_blocked = client.put(
        f"/api/v1/submissions/{ctx['curr_t2_sub'].submission_id}/grade",
        json={"grade": 50.0},
    )
    assert regrade_blocked.status_code == 409
    assert regrade_blocked.json()["detail"] == "The period grade is finalized"


def test_current_year_active_and_future_period_writes_are_preserved(historical_access_context):
    ctx = historical_access_context
    client = ctx["client"]
    curr_cid = ctx["curr_class"].class_id
    subj_id = ctx["subject"].subject_id
    active_t2_pid = ctx["curr_active_t2"].academic_period_id
    future_t3_pid = ctx["curr_future_t3"].academic_period_id
    st_id = ctx["student"].student_id

    # 1. Active Term 2 attendance, lesson update, lesson delivery, and lesson goal writes succeed
    att_ok = client.post(
        "/api/v1/attendance",
        json={
            "class_id": curr_cid,
            "subject_id": subj_id,
            "date": date.today().isoformat(),
            "records": [{"student_id": str(st_id), "status": "present"}],
        },
    )
    assert att_ok.status_code == 200

    lesson_upd = client.put(
        f"/api/v1/lessons/{ctx['curr_lesson'].lesson_id}",
        json={"title": "2025 Quadratic Equations (Updated)"},
    )
    assert lesson_upd.status_code == 200

    delivery_ok = client.post(
        "/api/v1/lesson-deliveries/confirm",
        json={
            "lesson_id": ctx["curr_lesson"].lesson_id,
            "class_id": curr_cid,
            "subject_id": subj_id,
            "academic_period_id": active_t2_pid,
        },
    )
    assert delivery_ok.status_code == 200

    goal_ok = client.put(
        f"/api/v1/lesson-goals/class/{curr_cid}/subject/{subj_id}",
        json={
            "academic_period_id": active_t2_pid,
            "items": [{"item_type": "LESSON", "lesson_id": ctx["curr_lesson"].lesson_id, "order_index": 1}],
        },
    )
    assert goal_ok.status_code == 200

    # 2. Future Term 3 in current active year is NOT treated as a closed historical period:
    # Teacher with published Term 3 load can assign classwork to Term 3 for planning.
    assign_future_t3 = client.post(
        "/api/v1/classwork-assignments/with-assignments",
        data={
            "title": "Term 3 Advance Project",
            "classwork_type": "ASSIGNMENT",
            "subject_id": str(subj_id),
            "classwork_category": "PERFORMANCE_TASK",
            "total_points": "100",
            "is_published": "false",
            "class_ids": json.dumps([curr_cid]),
            "academic_period_id": str(future_t3_pid),
            "lesson_ids": json.dumps([]),
            "max_attempts": "1",
        },
    )
    assert assign_future_t3.status_code == 200
