from datetime import date
import uuid
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.routes.Attendance import router as attendance_router
from app.api.v1.routes.Auth import get_current_user
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.attendance.Attendance import AttendanceRecord, LeaveRequest
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    AcademicPeriod.__table__,
    Class.__table__,
    Subject.__table__,
    SubjectLoad.__table__,
    TeacherSubstitution.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    StudentClass.__table__,
    AttendanceRecord.__table__,
    LeaveRequest.__table__,
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

    year = AcademicYear(academic_year_id=1, year_label="2026-2027", start_date=date(2026, 8, 1), end_date=date(2027, 5, 31), is_active=True)
    level = AcademicLevel(academic_level_id=2, level_name="Grade 8", grade_level=8)
    period = AcademicPeriod(
        academic_period_id=1,
        academic_year_id=1,
        period_name="Q1",
        period_type="quarter",
        start_date=date(2026, 8, 1),
        end_date=date(2026, 10, 31),
        is_active=True,
    )
    db.add_all([year, level, period])
    db.flush()

    # Teacher
    teacher_user_id = uuid.uuid4()
    teacher_user = UserAccount(user_id=teacher_user_id, email="teacher@school.edu", account_status="active")
    staff = AcademicStaff(staff_id="STF-001", user_id=teacher_user_id, first_name="Juan", last_name="Teacher")
    db.add_all([teacher_user, staff])
    db.flush()

    # Classes
    class1 = Class(class_id=1, section_name="Grade 8 - Alpha", academic_level_id=2, academic_year_id=1, adviser_staff_id="STF-001")
    class2 = Class(class_id=2, section_name="Grade 8 - Beta", academic_level_id=2, academic_year_id=1)
    db.add_all([class1, class2])
    db.flush()

    # Subjects
    subj_math = Subject(subject_id=1, subject_name="Mathematics 8", subject_codename="MTH-8", academic_level_id=2)
    subj_sci = Subject(subject_id=2, subject_name="Science 8", subject_codename="SCI-8", academic_level_id=2)
    db.add_all([subj_math, subj_sci])
    db.flush()

    # Loads
    load1 = SubjectLoad(
        subject_load_id=1,
        staff_id="STF-001",
        class_id=1,
        subject_id=1,
        academic_period_id=1,
        status="active",
        is_active_version=True,
    )
    load2 = SubjectLoad(
        subject_load_id=2,
        staff_id="STF-001",
        class_id=1,
        subject_id=2,
        academic_period_id=1,
        status="active",
        is_active_version=True,
    )
    db.add_all([load1, load2])
    db.flush()

    # Students
    student1_id = uuid.uuid4()
    student1 = Student(
        student_id=student1_id,
        student_lrn="123456789012",
        first_name="Juan",
        last_name="Dela Cruz",
        academic_level_id=2,
    )
    sc1 = StudentClass(
        student_id=student1_id,
        class_id=1,
        academic_year_id=1,
        enrollment_status="enrolled",
    )

    student2_id = uuid.uuid4()
    student2 = Student(
        student_id=student2_id,
        student_lrn="987654321098",
        first_name="Maria",
        last_name="Clara",
        academic_level_id=2,
    )
    sc2 = StudentClass(
        student_id=student2_id,
        class_id=2,
        academic_year_id=1,
        enrollment_status="enrolled",
    )

    db.add_all([student1, sc1, student2, sc2])
    db.commit()

    return db, teacher_user_id, student1_id, student2_id


def create_test_client(db, teacher_user_id):
    test_app = FastAPI()
    test_app.include_router(attendance_router, prefix="/api/v1/attendance")

    def override_get_db():
        try:
            yield db
        finally:
            pass

    def override_get_current_user():
        return {
            "sub": str(teacher_user_id),
            "role": "teacher",
            "email": "teacher@school.edu",
        }

    test_app.dependency_overrides[get_db] = override_get_db
    test_app.dependency_overrides[get_current_user] = override_get_current_user
    return TestClient(test_app)


def test_valid_qr_scan_marks_present():
    db, teacher_user_id, student1_id, _ = setup_test_db()
    client = create_test_client(db, teacher_user_id)

    payload = {
        "student_id": str(student1_id),
        "class_id": 1,
        "subject_id": 1,
    }

    response = client.post("/api/v1/attendance/scan", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["student_name"] == "Juan Dela Cruz"
    assert data["status"] == "present"
    assert data["is_duplicate"] is False
    assert data["date"] == str(date.today())

    # Verify in DB
    record = (
        db.query(AttendanceRecord)
        .filter(
            AttendanceRecord.student_id == student1_id,
            AttendanceRecord.class_id == 1,
            AttendanceRecord.subject_id == 1,
            AttendanceRecord.date == date.today(),
        )
        .first()
    )
    assert record is not None
    assert record.status == "present"


def test_invalid_qr_scan_not_enrolled_rejected():
    db, teacher_user_id, _, student2_id = setup_test_db()
    client = create_test_client(db, teacher_user_id)

    # student2 is only enrolled in class 2, scanning in class 1 must reject
    payload = {
        "student_id": str(student2_id),
        "class_id": 1,
        "subject_id": 1,
    }

    response = client.post("/api/v1/attendance/scan", json=payload)
    assert response.status_code == 400
    assert "not actively enrolled" in response.json()["detail"]

    # Verify no record created
    record = (
        db.query(AttendanceRecord)
        .filter(
            AttendanceRecord.student_id == student2_id,
            AttendanceRecord.class_id == 1,
        )
        .first()
    )
    assert record is None


def test_duplicate_qr_scan_handled_gracefully():
    db, teacher_user_id, student1_id, _ = setup_test_db()
    client = create_test_client(db, teacher_user_id)

    payload = {
        "student_id": str(student1_id),
        "class_id": 1,
        "subject_id": 1,
    }

    # First scan
    res1 = client.post("/api/v1/attendance/scan", json=payload)
    assert res1.status_code == 200
    assert res1.json()["is_duplicate"] is False

    # Second scan
    res2 = client.post("/api/v1/attendance/scan", json=payload)
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["is_duplicate"] is True
    assert "already marked present" in data2["message"]

    # Confirm only one DB record exists
    count = (
        db.query(AttendanceRecord)
        .filter(
            AttendanceRecord.student_id == student1_id,
            AttendanceRecord.class_id == 1,
            AttendanceRecord.subject_id == 1,
            AttendanceRecord.date == date.today(),
        )
        .count()
    )
    assert count == 1


def test_excused_absence_protected_from_overwrite():
    db, teacher_user_id, student1_id, _ = setup_test_db()
    client = create_test_client(db, teacher_user_id)

    # Pre-create an approved excused record
    excused_rec = AttendanceRecord(
        student_id=student1_id,
        class_id=1,
        subject_id=1,
        date=date.today(),
        status="excused",
        remarks="Medical excuse approved",
    )
    db.add(excused_rec)
    db.commit()

    payload = {
        "student_id": str(student1_id),
        "class_id": 1,
        "subject_id": 1,
    }

    response = client.post("/api/v1/attendance/scan", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["is_duplicate"] is True
    assert data["status"] == "excused"
    assert "excused absence" in data["message"].lower()

    # DB record remains excused
    db.refresh(excused_rec)
    assert excused_rec.status == "excused"
    assert excused_rec.remarks == "Medical excuse approved"


def test_per_subject_attendance_independence():
    db, teacher_user_id, student1_id, _ = setup_test_db()
    client = create_test_client(db, teacher_user_id)

    # Scan in Math (subject 1)
    payload_math = {
        "student_id": str(student1_id),
        "class_id": 1,
        "subject_id": 1,
    }
    res_math = client.post("/api/v1/attendance/scan", json=payload_math)
    assert res_math.status_code == 200
    assert res_math.json()["is_duplicate"] is False

    # Scan same student on same day in Science (subject 2)
    payload_sci = {
        "student_id": str(student1_id),
        "class_id": 1,
        "subject_id": 2,
    }
    res_sci = client.post("/api/v1/attendance/scan", json=payload_sci)
    assert res_sci.status_code == 200
    assert res_sci.json()["is_duplicate"] is False

    # Verify both exist independently in DB on the same date
    records = (
        db.query(AttendanceRecord)
        .filter(
            AttendanceRecord.student_id == student1_id,
            AttendanceRecord.class_id == 1,
            AttendanceRecord.date == date.today(),
        )
        .all()
    )
    assert len(records) == 2
    subj_ids = {r.subject_id for r in records}
    assert subj_ids == {1, 2}
