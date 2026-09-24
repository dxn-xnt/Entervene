from datetime import datetime, timezone, timedelta
import uuid
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.notifications.Notification import Notification
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.classwork.ClassworkService import check_and_notify_post_deadline_summaries

TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    AcademicPeriod.__table__,
    Class.__table__,
    Subject.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    StudentClass.__table__,
    Classwork.__table__,
    ClassworkAssignment.__table__,
    StudentSubmission.__table__,
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

    # User & Staff
    user_id = uuid.uuid4()
    user = UserAccount(user_id=user_id, email="teacher@school.edu", password_hash="hash", account_status="ACTIVE")
    staff = AcademicStaff(staff_id="STAFF_TEST", user_id=user_id, first_name="Juan", last_name="Teacher")

    # Subject & Class
    subject = Subject(subject_id=1, subject_name="Science 8", subject_codename="SCI8")
    section = Class(class_id=1, section_name="Grade 8 - Gold", academic_year_id=1, academic_level_id=1)

    # Classwork
    classwork = Classwork(
        classwork_id=42,
        title="Cell Structure Lab",
        classwork_type="ASSIGNMENT",
        subject_id=1,
        created_by_staff_id="STAFF_TEST",
        total_points=100,
    )

    db.add_all([user, staff, subject, section, classwork])
    db.commit()

    return db, {
        "user_id": user_id,
        "staff_id": "STAFF_TEST",
        "classwork_id": 42,
        "class_id": 1,
    }


def test_deadline_summary_action_url_includes_focus_param():
    db, ctx = setup_test_db()
    now = datetime.now(timezone.utc)

    # Past due assignment
    assignment = ClassworkAssignment(
        classwork_assignment_id=101,
        classwork_id=ctx["classwork_id"],
        class_id=ctx["class_id"],
        assigned_by_staff_id=ctx["staff_id"],
        is_published=True,
        due_date=now - timedelta(days=1),
    )
    db.add(assignment)
    db.commit()

    check_and_notify_post_deadline_summaries(db, ctx["staff_id"])

    notifs = db.query(Notification).filter(Notification.user_id == ctx["user_id"]).all()
    assert len(notifs) == 1
    assert notifs[0].notification_type == "assignment_due"
    assert notifs[0].title == "Deadline Summary: Cell Structure Lab"
    assert notifs[0].action_url == f"/teacher/classworks/{ctx['classwork_id']}?focus=deadline_summary"

    # Should not duplicate on subsequent runs
    check_and_notify_post_deadline_summaries(db, ctx["staff_id"])
    notifs_after = db.query(Notification).filter(Notification.user_id == ctx["user_id"]).all()
    assert len(notifs_after) == 1


def test_deadline_summary_does_not_fire_for_future_due_date():
    db, ctx = setup_test_db()
    now = datetime.now(timezone.utc)

    # Future due assignment
    assignment = ClassworkAssignment(
        classwork_assignment_id=102,
        classwork_id=ctx["classwork_id"],
        class_id=ctx["class_id"],
        assigned_by_staff_id=ctx["staff_id"],
        is_published=True,
        due_date=now + timedelta(days=2),
    )
    db.add(assignment)
    db.commit()

    check_and_notify_post_deadline_summaries(db, ctx["staff_id"])

    notifs = db.query(Notification).filter(Notification.user_id == ctx["user_id"]).all()
    assert len(notifs) == 0
