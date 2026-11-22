import uuid
from datetime import datetime, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.Subject import Subject
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.notifications.Notification import Notification
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.submission.TeacherSubmissionNotificationService import (
    check_and_generate_teacher_submission_notifications,
    is_allowed_submission_classwork,
    sync_teacher_submission_notifications_for_assignment,
)

TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    GradingTemplate.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    Subject.__table__,
    AcademicPeriod.__table__,
    Class.__table__,
    Classwork.__table__,
    ClassworkAssignment.__table__,
    StudentSubmission.__table__,
    Notification.__table__,
]


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=TABLES)
    Session = sessionmaker(bind=engine)
    session = Session()

    # Seed required reference records
    user_id = uuid.uuid4()
    teacher_user = UserAccount(user_id=user_id, email="teacher@school.ph", account_status="active")
    staff = AcademicStaff(staff_id="T-001", user_id=user_id, first_name="Maria", last_name="Cruz", email="teacher@school.ph")
    gt = GradingTemplate(grading_template_id=1, template_name="Standard", passing_threshold=75.0)
    level = AcademicLevel(academic_level_id=7, level_name="Grade 7", grade_level=7)
    subject = Subject(subject_id=1, subject_name="Mathematics 7", subject_codename="MTH7", grading_template_id=1, academic_level_id=7)
    year = AcademicYear(academic_year_id=1, year_label="2026-2027", start_date=datetime(2026, 6, 1).date(), end_date=datetime(2027, 4, 30).date(), is_active=True)
    period = AcademicPeriod(
        academic_period_id=1,
        academic_year_id=1,
        period_name="Term 1",
        start_date=datetime(2026, 6, 1).date(),
        end_date=datetime(2026, 10, 31).date(),
        is_active=True,
    )
    cls = Class(class_id=1, section_name="Galileo", academic_year_id=1, academic_level_id=7)

    student1 = Student(student_id=uuid.uuid4(), first_name="Juan", last_name="Dela Cruz", student_lrn="100000000001")
    student2 = Student(student_id=uuid.uuid4(), first_name="Ana", last_name="Santos", student_lrn="100000000002")

    session.add_all([teacher_user, staff, gt, level, subject, year, period, cls, student1, student2])
    session.commit()

    yield session, staff, subject, cls, student1, student2
    session.close()


def test_submission_notifications_dynamic_lifecycle(db_session):
    session, staff, subject, cls, student1, student2 = db_session

    # 1. Create an assignment
    cw_assignment = Classwork(
        classwork_id=101,
        title="Linear Equations Worksheet",
        classwork_type="ASSIGNMENT",
        subject_id=subject.subject_id,
        created_by_staff_id=staff.staff_id,
        is_published=True,
    )
    # 2. Create a quiz (which should be excluded)
    cw_quiz = Classwork(
        classwork_id=102,
        title="Algebra Quiz 1",
        classwork_type="QUIZ",
        subject_id=subject.subject_id,
        created_by_staff_id=staff.staff_id,
        is_published=True,
    )
    session.add_all([cw_assignment, cw_quiz])
    session.flush()

    assert is_allowed_submission_classwork(cw_assignment) is True
    assert is_allowed_submission_classwork(cw_quiz) is False

    # Assign both
    assign1 = ClassworkAssignment(
        classwork_assignment_id=201,
        classwork_id=cw_assignment.classwork_id,
        class_id=cls.class_id,
        assigned_by_staff_id=staff.staff_id,
        academic_period_id=1,
    )
    assign2 = ClassworkAssignment(
        classwork_assignment_id=202,
        classwork_id=cw_quiz.classwork_id,
        class_id=cls.class_id,
        assigned_by_staff_id=staff.staff_id,
        academic_period_id=1,
    )
    session.add_all([assign1, assign2])
    session.commit()

    # No submissions yet -> 0 notifications
    notifs = check_and_generate_teacher_submission_notifications(session, staff.user_id)
    assert len(notifs) == 0

    # Student 1 submits quiz -> must NOT generate notification because quiz is excluded
    sub_quiz = StudentSubmission(
        classwork_assignment_id=assign2.classwork_assignment_id,
        student_id=student1.student_id,
        status="submitted",
        submitted_at=datetime.now(timezone.utc),
    )
    session.add(sub_quiz)
    session.commit()
    notifs = check_and_generate_teacher_submission_notifications(session, staff.user_id)
    assert len(notifs) == 0

    # Student 1 submits assignment -> 1 submission (singular template)
    sub1 = StudentSubmission(
        classwork_assignment_id=assign1.classwork_assignment_id,
        student_id=student1.student_id,
        status="submitted",
        submitted_at=datetime(2026, 11, 23, 10, 0, 0, tzinfo=timezone.utc),
    )
    session.add(sub1)
    session.commit()

    notifs = check_and_generate_teacher_submission_notifications(session, staff.user_id)
    assert len(notifs) == 1
    assert notifs[0].title == "Mathematics 7: Linear Equations Worksheet - 1 new submission"
    assert "1 new student classwork submission needs to be graded as of Nov 23, 2026" in notifs[0].body
    assert notifs[0].action_url == "/teacher/classworks/101"
    assert notifs[0].is_read is False

    # Teacher marks it as read
    notifs[0].is_read = True
    notifs[0].read_at = datetime(2026, 11, 23, 11, 0, 0, tzinfo=timezone.utc)
    session.commit()

    # Student 2 submits assignment -> updates existing notification, increments to 2 (plural), marks unread again!
    sub2 = StudentSubmission(
        classwork_assignment_id=assign1.classwork_assignment_id,
        student_id=student2.student_id,
        status="submitted",
        submitted_at=datetime(2026, 11, 23, 12, 0, 0, tzinfo=timezone.utc),
    )
    session.add(sub2)
    session.commit()

    sync_teacher_submission_notifications_for_assignment(session, assign1.classwork_assignment_id)
    all_notifs = session.query(Notification).filter_by(user_id=staff.user_id).all()
    # Exactly one notification for this classwork (NO DUPLICATE)
    assert len(all_notifs) == 1
    assert all_notifs[0].title == "Mathematics 7: Linear Equations Worksheet - 2 new submissions"
    assert "2 new student classwork submissions needs to be graded as of Nov 23, 2026" in all_notifs[0].body
    assert all_notifs[0].is_read is False  # Marked unread again!

    # Grade student 1
    sub1.status = "graded"
    sub1.grade = 95
    session.commit()
    sync_teacher_submission_notifications_for_assignment(session, assign1.classwork_assignment_id)

    all_notifs = session.query(Notification).filter_by(user_id=staff.user_id).all()
    assert len(all_notifs) == 1
    assert all_notifs[0].title == "Mathematics 7: Linear Equations Worksheet - 1 new submission"

    # Grade student 2 -> 0 remaining to grade
    sub2.status = "graded"
    sub2.grade = 88
    session.commit()
    sync_teacher_submission_notifications_for_assignment(session, assign1.classwork_assignment_id)

    # When no submissions remain to be graded, removed!
    all_notifs = session.query(Notification).filter_by(user_id=staff.user_id).all()
    assert len(all_notifs) == 0
