"""Focused tests for 24-hour Classwork deadline reminders and the independent runner."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import threading
import uuid
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.notifications.Notification import Notification
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services import ReminderRunner
from app.services.classwork.ClassworkDeadlineReminderService import (
    _assignment_window_state,
    classwork_deadline_action_url,
    scan_classwork_deadline_reminders,
)


MANILA = ZoneInfo("Asia/Manila")
NOW = datetime(2026, 11, 19, 12, 0, tzinfo=timezone.utc)  # 2026-11-19 20:00 Asia/Manila

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
    StudentPeriodGrade.__table__,
    Classwork.__table__,
    ClassworkAssignment.__table__,
    StudentSubmission.__table__,
    QuizQuestion.__table__,
    QuizAnswer.__table__,
    Notification.__table__,
]


def _make_session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine, tables=TABLES)
    return sessionmaker(bind=engine)


def _seed_class(Session):
    db = Session()
    teacher_uid = uuid.uuid4()
    db.add(UserAccount(user_id=teacher_uid, email="teacher@school.edu", password_hash="h", account_status="active"))
    db.add(AcademicStaff(staff_id="STAFF-1", user_id=teacher_uid, first_name="Angel", last_name="Alcantara"))
    db.add(AcademicYear(academic_year_id=1, year_label="2026-2027", start_date=NOW.date(), end_date=(NOW + timedelta(days=180)).date()))
    db.add(AcademicLevel(academic_level_id=1, grade_level=9, level_name="Grade 9"))
    db.add(AcademicPeriod(academic_period_id=1, academic_year_id=1, period_name="Q1", period_sequence=1, start_date=NOW.date(), end_date=(NOW + timedelta(days=90)).date()))
    db.add(Class(class_id=10, section_name="Archimedes", academic_year_id=1, academic_level_id=1))
    db.add(Subject(subject_id=20, subject_name="Enhanced Mathematics 9", subject_codename="EM9"))

    def add_student(email: str, first: str, last: str, *, lrn: str, enrollment_status: str = "enrolled", account_status: str = "active"):
        uid = uuid.uuid4()
        sid = uuid.uuid4()
        db.add(UserAccount(user_id=uid, email=email, password_hash="h", account_status=account_status))
        db.add(Student(student_id=sid, student_lrn=lrn, user_id=uid, first_name=first, last_name=last))
        db.add(StudentClass(student_id=sid, class_id=10, academic_year_id=1, enrollment_status=enrollment_status))
        return sid, uid

    s1_id, s1_uid = add_student("s1@school.edu", "Juan", "Dela Cruz", lrn="100000000001")
    s2_id, s2_uid = add_student("s2@school.edu", "Maria", "Santos", lrn="100000000002")
    dropped_id, dropped_uid = add_student("dropped@school.edu", "Dropped", "Student", lrn="100000000003", enrollment_status="dropped")
    inactive_id, inactive_uid = add_student("inactive@school.edu", "Inactive", "Student", lrn="100000000004", account_status="inactive")
    db.commit()
    return db, {
        "s1": (s1_id, s1_uid),
        "s2": (s2_id, s2_uid),
        "dropped": (dropped_id, dropped_uid),
        "inactive": (inactive_id, inactive_uid),
    }


def _add_classwork(
    db,
    *,
    classwork_id: int,
    assignment_id: int,
    title: str,
    classwork_type: str = "ASSIGNMENT",
    activity_mode: str = "ONLINE",
    due_date: datetime | None = None,
    lock_date: datetime | None = None,
    is_published: bool = True,
    assignment_published: bool = True,
    is_archived: bool = False,
    is_locked: bool = False,
    assignment_locked: bool = False,
):
    cw = Classwork(
        classwork_id=classwork_id,
        title=title,
        classwork_type=classwork_type,
        activity_mode=activity_mode,
        subject_id=20,
        created_by_staff_id="STAFF-1",
        is_published=is_published,
        is_archived=is_archived,
        is_locked=is_locked,
    )
    assignment = ClassworkAssignment(
        classwork_assignment_id=assignment_id,
        classwork_id=classwork_id,
        class_id=10,
        academic_period_id=1,
        assigned_by_staff_id="STAFF-1",
        due_date=due_date,
        lock_date=lock_date,
        is_published=assignment_published,
        is_locked=assignment_locked,
    )
    db.add_all([cw, assignment])
    db.commit()
    return cw, assignment


def test_eligibility_filtering_timezone_window_and_notification_payload():
    Session = _make_session_factory()
    db, people = _seed_class(Session)

    # Due in 18 hours (stored in UTC as PostgreSQL TIMESTAMPTZ normalizes); scanned with Manila-offset `now`
    due_utc = NOW + timedelta(hours=18)
    due_manila = due_utc.astimezone(MANILA)
    _cw, eligible_assignment = _add_classwork(
        db,
        classwork_id=1,
        assignment_id=101,
        title="Enhanced Mathematics 9: Parallel Lines Quiz",
        classwork_type="QUIZ",
        due_date=due_utc,
    )

    # Direct timezone-aware window check with non-UTC offset due_date vs UTC now
    ephemeral = ClassworkAssignment(
        classwork_assignment_id=999,
        classwork_id=1,
        class_id=10,
        academic_period_id=1,
        assigned_by_staff_id="STAFF-1",
        due_date=due_manila,
        is_published=True,
        is_locked=False,
    )
    ephemeral.classwork = _cw
    state, resolved_due = _assignment_window_state(ephemeral, NOW)
    assert state == "eligible"
    assert resolved_due == due_utc

    # Ineligible items: >24h away, expired, unpublished, archived, locked, future lock_date, manual activity, reading
    _add_classwork(db, classwork_id=2, assignment_id=102, title="Too Far", due_date=NOW + timedelta(hours=24, minutes=1))
    _add_classwork(db, classwork_id=3, assignment_id=103, title="Expired", due_date=NOW - timedelta(minutes=1))
    _add_classwork(db, classwork_id=4, assignment_id=104, title="Draft", due_date=NOW + timedelta(hours=5), is_published=False)
    _add_classwork(db, classwork_id=5, assignment_id=105, title="Archived", due_date=NOW + timedelta(hours=5), is_archived=True)
    _add_classwork(db, classwork_id=6, assignment_id=106, title="Locked", due_date=NOW + timedelta(hours=5), assignment_locked=True)
    _add_classwork(
        db,
        classwork_id=7,
        assignment_id=107,
        title="Future Lock",
        due_date=NOW + timedelta(hours=5),
        lock_date=NOW + timedelta(hours=1),
    )
    _add_classwork(
        db,
        classwork_id=8,
        assignment_id=108,
        title="Offline Recitation",
        classwork_type="ACTIVITY",
        activity_mode="MANUAL",
        due_date=NOW + timedelta(hours=5),
    )
    _add_classwork(
        db,
        classwork_id=9,
        assignment_id=109,
        title="Reading Notes",
        classwork_type="READING",
        due_date=NOW + timedelta(hours=5),
    )

    result = scan_classwork_deadline_reminders(db, now=NOW.astimezone(MANILA))
    assert result["sent"] == 2
    assert result["failed"] == 0

    notifications = db.query(Notification).all()
    assert len(notifications) == 2
    recipient_uids = {n.user_id for n in notifications}
    assert recipient_uids == {people["s1"][1], people["s2"][1]}
    assert people["dropped"][1] not in recipient_uids
    assert people["inactive"][1] not in recipient_uids

    sample = notifications[0]
    assert sample.notification_type == "classwork_due_soon"
    assert sample.title == "Classwork Due Soon"
    assert "Enhanced Mathematics 9: Parallel Lines Quiz" in (sample.body or "")
    assert "Enhanced Mathematics 9: Enhanced Mathematics 9" not in (sample.body or "")
    assert "Nov 20, 2026 at 2:00 PM" in (sample.body or "")
    assert sample.action_url == classwork_deadline_action_url(101, due_manila)


def test_submission_detection_across_assignment_activity_and_quiz():
    Session = _make_session_factory()
    db, people = _seed_class(Session)
    due = NOW + timedelta(hours=10)

    _add_classwork(db, classwork_id=1, assignment_id=201, title="Essay 1", classwork_type="ASSIGNMENT", due_date=due)
    _add_classwork(db, classwork_id=2, assignment_id=202, title="Lab 1", classwork_type="ACTIVITY", activity_mode="ONLINE", due_date=due)
    _add_classwork(db, classwork_id=3, assignment_id=203, title="Quiz 1", classwork_type="QUIZ", due_date=due)

    s1_id, s1_uid = people["s1"]
    s2_id, s2_uid = people["s2"]

    # s1 submitted Assignment, Activity (graded), and Quiz (attempt 1 submitted with QuizAnswer then retake started!)
    quiz_retake_sub = StudentSubmission(
        student_id=s1_id,
        classwork_assignment_id=203,
        status="pending",
        submitted_at=None,
        attempt_count=1,
    )
    # s2 has a pending quiz row with attempt_count > 0 but NO QuizAnswer rows -> NOT a completed submission!
    quiz_pending_unsubmitted = StudentSubmission(
        student_id=s2_id,
        classwork_assignment_id=203,
        status="pending",
        submitted_at=None,
        attempt_count=1,
    )
    db.add_all([
        StudentSubmission(student_id=s1_id, classwork_assignment_id=201, status="submitted", submitted_at=NOW - timedelta(hours=1), attempt_count=1),
        StudentSubmission(student_id=s1_id, classwork_assignment_id=202, status="graded", submitted_at=NOW - timedelta(hours=1), attempt_count=1),
        quiz_retake_sub,
        quiz_pending_unsubmitted,
    ])
    db.flush()
    db.add(
        QuizAnswer(
            quiz_question_id=9001,
            submission_id=quiz_retake_sub.submission_id,
            answer_text="A",
            is_correct=True,
        )
    )
    db.commit()

    result = scan_classwork_deadline_reminders(db, now=NOW)
    assert result["sent"] == 3
    assert result["already_submitted"] == 3

    rows = db.query(Notification).all()
    assert len(rows) == 3
    assert all(row.user_id == s2_uid for row in rows)
    assert all(row.user_id != s1_uid for row in rows)


def test_deduplication_and_edited_deadlines():
    Session = _make_session_factory()
    db, people = _seed_class(Session)
    initial_due = NOW + timedelta(hours=12)
    _cw, assignment = _add_classwork(
        db,
        classwork_id=1,
        assignment_id=301,
        title="Seatwork 1",
        classwork_type="ASSIGNMENT",
        due_date=initial_due,
    )

    first = scan_classwork_deadline_reminders(db, now=NOW)
    assert first["sent"] == 2

    # Repeat scan for same deadline -> 0 new sends
    second = scan_classwork_deadline_reminders(db, now=NOW + timedelta(hours=2))
    assert second["sent"] == 0
    assert second["duplicate"] == 2

    # Equivalent instant expressed in Manila offset produces the exact same dedup action_url
    assert classwork_deadline_action_url(301, initial_due) == classwork_deadline_action_url(
        301, initial_due.astimezone(MANILA)
    )
    same_instant = scan_classwork_deadline_reminders(db, now=(NOW + timedelta(hours=3)).astimezone(MANILA))
    assert same_instant["sent"] == 0
    assert same_instant["duplicate"] == 2

    # Teacher extends deadline by 5 days -> outside 24h window -> not sent yet
    new_due = NOW + timedelta(days=5)
    assignment.due_date = new_due
    db.commit()
    extended_early = scan_classwork_deadline_reminders(db, now=NOW + timedelta(hours=4))
    assert extended_early["sent"] == 0
    assert extended_early["not_due"] == 1

    # 12 hours before the NEW edited deadline -> sends one fresh reminder per unsubmitted student
    new_window = scan_classwork_deadline_reminders(db, now=new_due - timedelta(hours=12))
    assert new_window["sent"] == 2

    # Subsequent scan in the new window -> deduplicated again
    new_window_repeat = scan_classwork_deadline_reminders(db, now=new_due - timedelta(hours=6))
    assert new_window_repeat["sent"] == 0
    assert new_window_repeat["duplicate"] == 2
    assert db.query(Notification).count() == 4
    assert {n.user_id for n in db.query(Notification).all()} == {people["s1"][1], people["s2"][1]}


def test_concurrent_scans_never_create_duplicate_reminders():
    Session = _make_session_factory()
    db, _people = _seed_class(Session)
    _add_classwork(
        db,
        classwork_id=1,
        assignment_id=401,
        title="Concurrent Quiz",
        classwork_type="QUIZ",
        due_date=NOW + timedelta(hours=6),
    )
    db.close()

    barrier = threading.Barrier(2)
    results: list[dict[str, int]] = []
    errors: list[BaseException] = []

    def worker():
        session = Session()
        try:
            barrier.wait(timeout=5)
            results.append(scan_classwork_deadline_reminders(session, now=NOW))
        except BaseException as exc:  # pragma: no cover
            errors.append(exc)
        finally:
            session.close()

    threads = [threading.Thread(target=worker), threading.Thread(target=worker)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert not errors
    assert len(results) == 2
    assert sum(r["sent"] for r in results) == 2
    assert sum(r["duplicate"] for r in results) == 2

    check_db = Session()
    try:
        assert check_db.query(Notification).count() == 2
    finally:
        check_db.close()


def test_independent_reminder_runner_invokes_both_scanners(monkeypatch):
    calls: list[tuple[str, int]] = []

    def fake_classwork(*, now=None, limit=100):
        calls.append(("classwork", limit))
        return {"scanned_assignments": 1, "sent": 2, "failed": 0}

    def fake_study_support(*, now=None, limit=100):
        calls.append(("study_support", limit))
        return {"scanned": 1, "sent": 1, "failed": 0}

    monkeypatch.setattr(ReminderRunner, "run_classwork_deadline_reminder_scan", fake_classwork)
    monkeypatch.setattr(ReminderRunner, "run_study_support_reminder_scan", fake_study_support)

    summary = ReminderRunner.run_all_reminder_scans(now=NOW, limit=50)
    assert calls == [("classwork", 50), ("study_support", 50)]
    assert summary["classwork_deadlines"]["sent"] == 2
    assert summary["study_support"]["sent"] == 1
