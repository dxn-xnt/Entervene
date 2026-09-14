import uuid
from datetime import date, datetime
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
from app.models.attendance.Attendance import AttendanceRecord
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.submission.SubmissionService import student_has_excused_exemption

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
    AttendanceRecord.__table__,
]


def setup_test_environment():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine, tables=TABLES)
    Session = sessionmaker(bind=engine)
    db = Session()

    # Teacher user
    teacher_user_id = uuid.uuid4()
    teacher_account = UserAccount(
        user_id=teacher_user_id,
        email="teacher@school.edu",
        account_status="active",
    )
    staff = AcademicStaff(
        staff_id="STF-001",
        user_id=teacher_user_id,
        first_name="John",
        last_name="Doe",
    )

    # Student user
    student_user_id = uuid.uuid4()
    student_account = UserAccount(
        user_id=student_user_id,
        email="student@school.edu",
        account_status="active",
    )
    student_id = uuid.uuid4()
    student = Student(
        student_id=student_id,
        user_id=student_user_id,
        student_lrn="123456789012",
        first_name="Juan",
        last_name="Dela Cruz",
        academic_level_id=1,
    )

    # Class & Enrollment
    ay = AcademicYear(academic_year_id=1, year_label="2026-2027", start_date=date(2026, 8, 1), end_date=date(2027, 5, 31), is_active=True)
    al = AcademicLevel(academic_level_id=1, level_name="Grade 7", grade_level=7)
    cls = Class(class_id=1, section_name="Newton", academic_level_id=1, academic_year_id=1)
    sc = StudentClass(student_id=student_id, class_id=1, academic_year_id=1, enrollment_status="enrolled")

    db.add_all([teacher_account, staff, student_account, student, ay, al, cls, sc])
    db.commit()

    return db, teacher_user_id, student_user_id, student_id


def create_client(db, user_payload: dict | None = None):
    app = FastAPI()
    app.include_router(attendance_router, prefix="/api/v1/attendance")

    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    if user_payload:
        app.dependency_overrides[get_current_user] = lambda: user_payload

    return TestClient(app)


def test_unauthenticated_requests_denied():
    db, _, _, _ = setup_test_environment()
    client = create_client(db, user_payload=None)

    # Calling any attendance route without auth returns 401
    assert client.get("/api/v1/attendance/class/1").status_code == 401
    assert client.post("/api/v1/attendance", json={"class_id": 1, "date": "2026-09-11", "records": []}).status_code == 401
    assert client.get("/api/v1/attendance/student/my-summary").status_code == 401
    assert client.post("/api/v1/attendance/leave-request", json={}).status_code == 401


def test_student_role_denied_all_attendance_and_leave_endpoints():
    db, _, student_user_id, student_id = setup_test_environment()
    client = create_client(db, user_payload={"sub": str(student_user_id), "role": "student"})

    # Student cannot access class logs
    res = client.get("/api/v1/attendance/class/1")
    assert res.status_code == 403

    # Student cannot batch record attendance
    res = client.post("/api/v1/attendance", json={
        "class_id": 1,
        "date": "2026-09-11",
        "records": [{"student_id": str(student_id), "status": "present"}]
    })
    assert res.status_code == 403

    # Student cannot scan QR
    res = client.post("/api/v1/attendance/scan", json={"student_id": str(student_id), "class_id": 1})
    assert res.status_code == 403

    # Student cannot view student summary by ID
    res = client.get(f"/api/v1/attendance/student/{student_id}/summary")
    assert res.status_code == 403

    # Discontinued student endpoints return 403 Forbidden
    res = client.get("/api/v1/attendance/student/my-summary")
    assert res.status_code == 403

    res = client.get("/api/v1/attendance/student/my-logs")
    assert res.status_code == 403

    res = client.get("/api/v1/attendance/student/my-leave-requests")
    assert res.status_code == 403

    res = client.post("/api/v1/attendance/leave-request", json={
        "class_id": 1,
        "start_date": "2026-09-11",
        "end_date": "2026-09-12",
        "reason": "Sick"
    })
    assert res.status_code == 403

    res = client.get("/api/v1/attendance/class/1/leave-requests")
    assert res.status_code == 403

    res = client.patch("/api/v1/attendance/leave-request/1", json={"status": "approved"})
    assert res.status_code == 403


def test_teacher_marks_excused_with_remarks_and_views_logs():
    db, teacher_user_id, _, student_id = setup_test_environment()
    client = create_client(db, user_payload={"sub": str(teacher_user_id), "role": "teacher"})

    # Teacher manually marks student as 'excused' with physical letter verification remark
    remark_text = "Physical excuse letter received and verified."
    res = client.post("/api/v1/attendance", json={
        "class_id": 1,
        "date": "2026-09-11",
        "records": [{
            "student_id": str(student_id),
            "status": "excused",
            "remarks": remark_text
        }]
    })
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 1
    assert data[0]["status"] == "excused"
    assert data[0]["remarks"] == remark_text

    # Teacher views class logs
    logs_res = client.get("/api/v1/attendance/class/1?date=2026-09-11")
    assert logs_res.status_code == 200
    logs_data = logs_res.json()
    assert len(logs_data) == 1
    assert logs_data[0]["status"] == "excused"
    assert logs_data[0]["remarks"] == remark_text

    # Teacher views student summary
    summary_res = client.get(f"/api/v1/attendance/student/{student_id}/summary")
    assert summary_res.status_code == 200
    summary_data = summary_res.json()
    assert summary_data["excused_count"] == 1
    assert summary_data["total_days"] == 1


def test_student_has_excused_exemption_helper():
    db, _, _, student_id = setup_test_environment()

    # Before attendance record: no exemption
    check_dt = datetime(2026, 9, 11, 10, 0, 0)
    assert not student_has_excused_exemption(db, student_id, 1, check_dt)

    # Add AttendanceRecord with status='excused'
    rec = AttendanceRecord(
        student_id=student_id,
        class_id=1,
        date=date(2026, 9, 11),
        status="excused",
        remarks="Physical excuse letter verified",
    )
    db.add(rec)
    db.commit()

    # Now has exemption
    assert student_has_excused_exemption(db, student_id, 1, check_dt)

    # Different date has no exemption
    diff_dt = datetime(2026, 9, 12, 10, 0, 0)
    assert not student_has_excused_exemption(db, student_id, 1, diff_dt)
