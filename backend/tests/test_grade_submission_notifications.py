from datetime import date, timedelta
import uuid
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.routes.Notifications import router as notifications_router
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
from app.models.notifications.Notification import Notification
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.student_record.GradeSubmissionNotificationService import (
    GRADE_SUBMISSION_CLOSING_SOON_TYPE,
    GRADE_SUBMISSION_WINDOW_OPENED_TYPE,
    check_and_generate_grade_submission_notifications,
)


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    AcademicPeriod.__table__,
    Class.__table__,
    Subject.__table__,
    SubjectLoad.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    StudentClass.__table__,
    StudentPeriodGrade.__table__,
    Notification.__table__,
]


def setup_test_db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine, tables=TABLES)
    Session = sessionmaker(bind=engine)
    db = Session()

    # Academic Structure
    year = AcademicYear(
        academic_year_id=1,
        year_label="2026-2027",
        start_date=date(2026, 8, 1),
        end_date=date(2027, 5, 31),
        is_active=True,
    )
    level = AcademicLevel(academic_level_id=1, level_name="Grade 8", grade_level=8)
    period = AcademicPeriod(
        academic_period_id=1,
        academic_year_id=1,
        period_name="Quarter 1",
        period_type="QUARTER",
        period_sequence=1,
        total_periods_in_year=4,
        period_progress_ratio=0.25,
        start_date=date(2026, 8, 1),
        end_date=date(2026, 10, 15),
        is_active=True,
    )

    # Teacher A
    user_a_id = uuid.uuid4()
    user_a = UserAccount(user_id=user_a_id, email="teacher_a@school.edu", password_hash="hash", account_status="ACTIVE")
    staff_a = AcademicStaff(staff_id="STAFF_A", user_id=user_a_id, first_name="Maria", last_name="Santos")

    # Teacher B
    user_b_id = uuid.uuid4()
    user_b = UserAccount(user_id=user_b_id, email="teacher_b@school.edu", password_hash="hash", account_status="ACTIVE")
    staff_b = AcademicStaff(staff_id="STAFF_B", user_id=user_b_id, first_name="Juan", last_name="Dela Cruz")

    # Subject & Class
    subject = Subject(subject_id=101, subject_name="Mathematics 8", subject_codename="MATH8")
    class_8a = Class(class_id=1, section_name="Grade 8 - Diamond", academic_year_id=1, academic_level_id=1)

    # Subject Loads
    load_a = SubjectLoad(subject_load_id=1, staff_id="STAFF_A", subject_id=101, class_id=1, academic_period_id=1)
    load_b = SubjectLoad(subject_load_id=2, staff_id="STAFF_B", subject_id=101, class_id=1, academic_period_id=1)

    # Students (3 students)
    s1_id, s2_id, s3_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    student1 = Student(student_id=s1_id, student_lrn="100000000001", first_name="Ana", last_name="Reyes")
    student2 = Student(student_id=s2_id, student_lrn="100000000002", first_name="Ben", last_name="Garcia")
    student3 = Student(student_id=s3_id, student_lrn="100000000003", first_name="Clara", last_name="Lopez")

    sc1 = StudentClass(student_id=s1_id, class_id=1, academic_year_id=1, enrollment_status="enrolled")
    sc2 = StudentClass(student_id=s2_id, class_id=1, academic_year_id=1, enrollment_status="enrolled")
    sc3 = StudentClass(student_id=s3_id, class_id=1, academic_year_id=1, enrollment_status="enrolled")

    db.add_all([
        year, level, period, user_a, staff_a, user_b, staff_b,
        subject, class_8a, load_a, load_b,
        student1, student2, student3, sc1, sc2, sc3,
    ])
    db.commit()

    return db, {
        "user_a_id": user_a_id,
        "staff_a_id": "STAFF_A",
        "user_b_id": user_b_id,
        "staff_b_id": "STAFF_B",
        "period_id": 1,
        "period_end_date": date(2026, 10, 15),
        "student_ids": [s1_id, s2_id, s3_id],
        "class_id": 1,
        "subject_id": 101,
    }


def test_window_open_fires_exactly_once_when_today_ge_open_date():
    db, ctx = setup_test_db()
    user_a_id = ctx["user_a_id"]
    period_end = ctx["period_end_date"]

    # Open date is period_end - 7 days (2026-10-08)
    open_date = period_end - timedelta(days=7)
    before_open = open_date - timedelta(days=1)

    # 1. Before open date -> No notification
    notifs = check_and_generate_grade_submission_notifications(db, user_a_id, as_of_date=before_open)
    assert len(notifs) == 0

    # 2. On open date -> 1 Window Opened notification
    notifs = check_and_generate_grade_submission_notifications(db, user_a_id, as_of_date=open_date)
    assert len(notifs) == 1
    assert notifs[0].notification_type == GRADE_SUBMISSION_WINDOW_OPENED_TYPE
    assert "Quarter 1" in notifs[0].title
    assert notifs[0].action_url == "/teacher/grades?academic_period_id=1"

    # 3. Repeated check -> Idempotent, 0 new notifications
    notifs_repeat = check_and_generate_grade_submission_notifications(db, user_a_id, as_of_date=open_date)
    assert len(notifs_repeat) == 0

    # Total in DB is still 1
    total_db = db.query(Notification).filter(Notification.user_id == user_a_id).count()
    assert total_db == 1


def test_closing_soon_fires_for_partial_finalization():
    """Closing Soon fires for teachers with ANY unfinalized student (2 of 3 finalized = 1 pending)."""
    db, ctx = setup_test_db()
    user_a_id = ctx["user_a_id"]
    period_end = ctx["period_end_date"]
    s_ids = ctx["student_ids"]

    # Finalize only 2 out of 3 students for Teacher A
    spg1 = StudentPeriodGrade(
        student_id=s_ids[0],
        class_id=ctx["class_id"],
        subject_id=ctx["subject_id"],
        academic_period_id=ctx["period_id"],
        final_period_grade=88.5,
        is_finalized=True,
    )
    spg2 = StudentPeriodGrade(
        student_id=s_ids[1],
        class_id=ctx["class_id"],
        subject_id=ctx["subject_id"],
        academic_period_id=ctx["period_id"],
        final_period_grade=92.0,
        is_finalized=True,
    )
    db.add_all([spg1, spg2])
    db.commit()

    # Closing warning date is period_end + 5 days (2026-10-20)
    closing_warning_date = period_end + timedelta(days=5)

    notifs = check_and_generate_grade_submission_notifications(db, user_a_id, as_of_date=closing_warning_date)
    # Generates both Window Opened (if not already created) and Closing Soon
    types = [n.notification_type for n in notifs]
    assert GRADE_SUBMISSION_CLOSING_SOON_TYPE in types

    closing_notif = next(n for n in notifs if n.notification_type == GRADE_SUBMISSION_CLOSING_SOON_TYPE)
    assert "1 student grade(s) pending finalization" in closing_notif.body


def test_closing_soon_skipped_when_100_percent_finalized():
    """Closing Soon is skipped when all students (3 of 3) are finalized."""
    db, ctx = setup_test_db()
    user_a_id = ctx["user_a_id"]
    period_end = ctx["period_end_date"]
    s_ids = ctx["student_ids"]

    # Finalize ALL 3 students for Teacher A
    for sid in s_ids:
        db.add(StudentPeriodGrade(
            student_id=sid,
            class_id=ctx["class_id"],
            subject_id=ctx["subject_id"],
            academic_period_id=ctx["period_id"],
            final_period_grade=90.0,
            is_finalized=True,
        ))
    db.commit()

    closing_warning_date = period_end + timedelta(days=5)
    notifs = check_and_generate_grade_submission_notifications(db, user_a_id, as_of_date=closing_warning_date)

    types = [n.notification_type for n in notifs]
    assert GRADE_SUBMISSION_WINDOW_OPENED_TYPE in types
    assert GRADE_SUBMISSION_CLOSING_SOON_TYPE not in types


def test_two_teachers_in_same_period_independent_dedup():
    """Two teachers sharing a period each get their own notification independently."""
    db, ctx = setup_test_db()
    user_a_id = ctx["user_a_id"]
    user_b_id = ctx["user_b_id"]
    open_date = ctx["period_end_date"] - timedelta(days=7)

    # Generate for Teacher A
    notifs_a = check_and_generate_grade_submission_notifications(db, user_a_id, as_of_date=open_date)
    assert len(notifs_a) == 1
    assert notifs_a[0].user_id == user_a_id

    # Generate for Teacher B (must not be blocked by Teacher A's notification)
    notifs_b = check_and_generate_grade_submission_notifications(db, user_b_id, as_of_date=open_date)
    assert len(notifs_b) == 1
    assert notifs_b[0].user_id == user_b_id

    # Confirm both records exist in DB
    notif_a_db = db.query(Notification).filter(Notification.user_id == user_a_id).all()
    notif_b_db = db.query(Notification).filter(Notification.user_id == user_b_id).all()
    assert len(notif_a_db) == 1
    assert len(notif_b_db) == 1


def test_lazy_evaluation_via_notifications_route():
    """GET /api/v1/notifications lazily triggers notification generation."""
    db, ctx = setup_test_db()
    user_a_id = ctx["user_a_id"]

    from app.api.v1.routes.Auth import get_current_user

    app = FastAPI()
    app.include_router(notifications_router, prefix="/api/v1/notifications")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(user_a_id),
        "user_id": str(user_a_id),
        "role": "teacher",
    }

    client = TestClient(app)

    # Set period end_date so today falls directly within the open window
    period = db.query(AcademicPeriod).first()
    period.end_date = date.today() + timedelta(days=2)
    db.commit()

    # Initial state: 0 notifications in DB
    assert db.query(Notification).filter(Notification.user_id == user_a_id).count() == 0

    # Call endpoint when today is within submission window
    resp = client.get("/api/v1/notifications")
    assert resp.status_code == 200
    data = resp.json()
    assert data["unread_count"] >= 1
    assert len(data["notifications"]) >= 1
    assert any(n["notification_type"] == GRADE_SUBMISSION_WINDOW_OPENED_TYPE for n in data["notifications"])
