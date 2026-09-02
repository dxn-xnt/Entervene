from __future__ import annotations

import uuid
from datetime import date
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.Base import Base
from app.models.attendance.Attendance import AttendanceRecord
from app.services.attendance.AttendanceService import get_risk_adjusted_attendance_rate


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine, tables=[AttendanceRecord.__table__])
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine, tables=[AttendanceRecord.__table__])
        engine.dispose()


def test_risk_adjusted_attendance_all_present(db):
    student_id = uuid.uuid4()
    for i in range(1, 6):
        db.add(AttendanceRecord(
            student_id=student_id,
            class_id=1,
            subject_id=10,
            date=date(2026, 9, i),
            status="present",
        ))
    db.commit()

    result = get_risk_adjusted_attendance_rate(db, student_id, class_id=1, subject_id=10)
    assert result["total_days"] == 5
    assert result["present_count"] == 5
    assert result["risk_adjusted_rate"] == 100.0


def test_risk_adjusted_attendance_all_late(db):
    student_id = uuid.uuid4()
    for i in range(1, 5):
        db.add(AttendanceRecord(
            student_id=student_id,
            class_id=1,
            subject_id=10,
            date=date(2026, 9, i),
            status="late",
        ))
    db.commit()

    result = get_risk_adjusted_attendance_rate(db, student_id, class_id=1, subject_id=10)
    assert result["total_days"] == 4
    assert result["late_count"] == 4
    assert result["risk_adjusted_rate"] == 50.0


def test_risk_adjusted_attendance_all_excused(db):
    student_id = uuid.uuid4()
    for i in range(1, 6):
        db.add(AttendanceRecord(
            student_id=student_id,
            class_id=1,
            subject_id=10,
            date=date(2026, 9, i),
            status="excused",
        ))
    db.commit()

    result = get_risk_adjusted_attendance_rate(db, student_id, class_id=1, subject_id=10)
    assert result["total_days"] == 5
    assert result["excused_count"] == 5
    assert result["risk_adjusted_rate"] == 80.0


def test_risk_adjusted_attendance_all_absent(db):
    student_id = uuid.uuid4()
    for i in range(1, 4):
        db.add(AttendanceRecord(
            student_id=student_id,
            class_id=1,
            subject_id=10,
            date=date(2026, 9, i),
            status="absent",
        ))
    db.commit()

    result = get_risk_adjusted_attendance_rate(db, student_id, class_id=1, subject_id=10)
    assert result["total_days"] == 3
    assert result["absent_count"] == 3
    assert result["risk_adjusted_rate"] == 0.0


def test_risk_adjusted_attendance_mixed_status(db):
    student_id = uuid.uuid4()
    # 2 present, 1 late, 1 excused, 1 absent -> (2*1.0 + 1*0.5 + 1*0.8 + 0.0) / 5 = 3.3 / 5 * 100 = 66.0%
    statuses = ["present", "present", "late", "excused", "absent"]
    for i, st in enumerate(statuses, start=1):
        db.add(AttendanceRecord(
            student_id=student_id,
            class_id=1,
            subject_id=10,
            date=date(2026, 9, i),
            status=st,
        ))
    db.commit()

    result = get_risk_adjusted_attendance_rate(db, student_id, class_id=1, subject_id=10)
    assert result["total_days"] == 5
    assert result["present_count"] == 2
    assert result["late_count"] == 1
    assert result["excused_count"] == 1
    assert result["absent_count"] == 1
    assert result["risk_adjusted_rate"] == 66.0


def test_risk_adjusted_attendance_zero_days(db):
    student_id = uuid.uuid4()
    result = get_risk_adjusted_attendance_rate(db, student_id, class_id=1, subject_id=10)
    assert result["total_days"] == 0
    assert result["risk_adjusted_rate"] is None
