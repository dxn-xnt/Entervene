from datetime import date
import uuid
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.routes.Students import router as students_router
from app.api.v1.routes.Users import router as users_router
from app.api.v1.routes.StudentRecords import router as student_records_router
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
    UserAccount.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    StudentClass.__table__,
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
        period_sequence=1,
        start_date=date(2026, 8, 1),
        end_date=date(2026, 10, 31),
        is_active=True,
    )
    class_obj = Class(
        class_id=10,
        academic_year_id=1,
        academic_level_id=2,
        section_name="Emerald",
        class_status="active",
    )

    db.add_all([year, level, period, class_obj])
    db.commit()

    student_user_id = uuid.uuid4()
    student_id = uuid.uuid4()

    student_user = UserAccount(
        user_id=student_user_id,
        email="juan.delacruz@student.ph",
        ref_type="student",
        account_status="active",
        password_hash="fakehash",
    )
    student = Student(
        student_id=student_id,
        user_id=student_user_id,
        first_name="Juan",
        last_name="Dela Cruz",
        student_lrn="123456789012",
        gender="Male",
    )
    student_class = StudentClass(
        student_class_id=100,
        student_id=student_id,
        class_id=10,
        academic_year_id=1,
        enrollment_status="enrolled",
    )

    db.add_all([student_user, student, student_class])
    db.commit()

    return db, {
        "student_user_id": str(student_user_id),
        "student_id": str(student_id),
    }


def create_test_app(db, current_user_override):
    app = FastAPI()
    app.include_router(students_router, prefix="/api/v1/students")
    app.include_router(users_router, prefix="/api/v1")
    app.include_router(student_records_router, prefix="/api/v1/student-records")

    app.dependency_overrides[get_db] = lambda: db
    if current_user_override:
        app.dependency_overrides[get_current_user] = lambda: current_user_override

    return app


def test_student_can_fetch_own_profile_and_badge_info():
    db, data = setup_test_db()
    current_user = {
        "sub": data["student_user_id"],
        "email": "juan.delacruz@student.ph",
        "role": "student",
    }
    app = create_test_app(db, current_user)
    client = TestClient(app)

    response = client.get("/api/v1/students/me/profile")
    assert response.status_code == 200
    res = response.json()

    assert res["student_id"] == data["student_id"]
    assert res["user_id"] == data["student_user_id"]
    assert res["first_name"] == "Juan"
    assert res["last_name"] == "Dela Cruz"
    assert res["student_lrn"] == "123456789012"
    assert res["grade_level"] == "Grade 8"
    assert res["section_name"] == "Emerald"


def test_unauthenticated_or_wrong_role_cannot_access_student_profile():
    db, data = setup_test_db()
    # Teacher user
    teacher_user = {
        "sub": str(uuid.uuid4()),
        "email": "teacher@school.ph",
        "role": "teacher",
    }
    app = create_test_app(db, teacher_user)
    client = TestClient(app)

    # Teacher should get 403 Forbidden
    response = client.get("/api/v1/students/me/profile")
    assert response.status_code == 403
    assert "Only students can access this resource" in response.json()["detail"]


def test_student_cannot_access_admin_user_detail_by_id():
    db, data = setup_test_db()
    current_user = {
        "sub": data["student_user_id"],
        "email": "juan.delacruz@student.ph",
        "role": "student",
    }
    app = create_test_app(db, current_user)
    client = TestClient(app)

    # Student trying to access admin endpoint /api/v1/users/{user_id}
    other_user_id = str(uuid.uuid4())
    response = client.get(f"/api/v1/users/{other_user_id}")
    assert response.status_code == 403
    assert "Admin access required" in response.json()["detail"]


def test_student_cannot_access_teacher_student_record_by_id():
    db, data = setup_test_db()
    current_user = {
        "sub": data["student_user_id"],
        "email": "juan.delacruz@student.ph",
        "role": "student",
    }
    app = create_test_app(db, current_user)
    client = TestClient(app)

    # Student trying to access teacher student record endpoint
    response = client.get(f"/api/v1/student-records/teacher/classes/10/subjects/1/students/{data['student_id']}")
    assert response.status_code == 403
