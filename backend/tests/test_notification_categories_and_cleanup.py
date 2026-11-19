"""Focused backend tests for announcement feed exclusion and classwork notification phrasing."""

from datetime import datetime, timezone
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.Base import Base
from app.models.academic.Lesson import Lesson
from app.models.academic.Subject import Subject
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.notifications.Notification import Notification
from app.models.people.AcademicStaff import AcademicStaff
from app.services.NotificationService import (
    get_notifications_for_user,
    mark_all_notifications_read,
    mark_notification_read,
)
from app.services.classwork.ClassworkService import build_classwork_notification_details


TABLES = [
    Role.__table__,
    UserAccount.__table__,
    UserRoles.__table__,
    AcademicStaff.__table__,
    Subject.__table__,
    Lesson.__table__,
    Notification.__table__,
]


def _make_db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine, tables=TABLES)
    Session = sessionmaker(bind=engine)
    return Session()


def test_historical_announcements_excluded_from_feed_and_unread_without_deletion():
    db = _make_db()
    user_id = uuid.uuid4()
    db.add(UserAccount(user_id=user_id, email="student@school.edu", password_hash="hash", account_status="active"))

    announcement = Notification(
        notification_id=uuid.uuid4(),
        user_id=user_id,
        notification_type="announcement",
        title="School Announcement",
        body="Historical announcement",
        is_read=False,
    )
    classwork_notice = Notification(
        notification_id=uuid.uuid4(),
        user_id=user_id,
        notification_type="assignment_due",
        title="Math 9: Quiz 1",
        body="New classwork posted by Teacher.",
        is_read=False,
    )
    db.add_all([announcement, classwork_notice])
    db.commit()

    feed = get_notifications_for_user(db, user_id)
    assert feed.unread_count == 1
    assert [n.notification_type for n in feed.notifications] == ["assignment_due"]

    with pytest.raises(HTTPException) as exc:
        mark_notification_read(db, str(announcement.notification_id), user_id)
    assert exc.value.status_code == 404

    result = mark_all_notifications_read(db, user_id)
    assert result == {"marked_read": 1}

    # Historical announcement record remains intact in the database
    stored_announcement = db.get(Notification, announcement.notification_id)
    assert stored_announcement is not None
    assert stored_announcement.is_read is False

    refreshed = get_notifications_for_user(db, user_id)
    assert refreshed.unread_count == 0


def test_classwork_notification_details_prevent_duplicate_subject_and_redundant_phrasing():
    db = _make_db()
    staff_user_id = uuid.uuid4()
    db.add(UserAccount(user_id=staff_user_id, email="teacher@school.edu", password_hash="hash", account_status="active"))
    db.add(AcademicStaff(staff_id="STAFF-1", user_id=staff_user_id, first_name="Angel", last_name="Alcantara"))
    db.add(Subject(subject_id=1, subject_name="Enhanced Mathematics 9", subject_codename="EM9"))
    db.add(Lesson(lesson_id=10, title="Parallel Lines", subject_id=1, created_by_staff_id="STAFF-1"))
    db.commit()

    title, body = build_classwork_notification_details(
        db=db,
        classwork_title="Enhanced Mathematics 9: Parallel Lines Quiz",
        staff_id="STAFF-1",
        subject_id=1,
        lesson_ids=None,
        due_date=datetime(2026, 11, 25, tzinfo=timezone.utc),
        action_type="Assigned",
    )
    assert title == "Enhanced Mathematics 9: Parallel Lines Quiz"
    assert "Assigned classwork assigned by" not in body
    assert "attached to" not in body
    assert body == "Classwork assigned by Angel Alcantara • Due: Nov 25, 2026."

    title2, body2 = build_classwork_notification_details(
        db=db,
        classwork_title="Seatwork 1",
        staff_id="STAFF-1",
        subject_id=1,
        lesson_ids=[10],
        due_date=None,
        action_type="New",
    )
    assert title2 == "Enhanced Mathematics 9: Seatwork 1"
    assert body2 == "New classwork posted by Angel Alcantara • Lesson: Parallel Lines."
