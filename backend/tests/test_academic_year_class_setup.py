import uuid
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Classes import router as classes_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicLevelPathwayScope import AcademicLevelPathwayScope
from app.models.academic.AcademicPathway import AcademicPathway
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.DepedCluster import DepedCluster
from app.models.academic.OfficialSection import OfficialSection
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.SubjectOffering import SubjectOffering
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.classes.ClassShared import ClassManagementError, class_management_error_handler


@pytest.fixture
def db():
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
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture
def client(db):
    test_app = FastAPI()
    test_app.add_exception_handler(ClassManagementError, class_management_error_handler)
    test_app.include_router(classes_router, prefix="/api/v1/classes")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "admin",
    }
    with TestClient(test_app) as test_client:
        yield test_client
    test_app.dependency_overrides.clear()


def make_years(db):
    active_year = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 8, 1),
        end_date=date(2026, 5, 31),
        is_active=True,
    )
    future_year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 8, 1),
        end_date=date(2027, 5, 31),
        is_active=False,
    )
    db.add_all([active_year, future_year])
    db.flush()
    return active_year, future_year


def make_teacher(db, staff_id: str, email: str, is_active: bool = True, role_name: str = "Teacher"):
    role = db.query(Role).filter(Role.role_name == role_name).first()
    if not role:
        max_id = db.query(Role.role_id).order_by(Role.role_id.desc()).first()
        next_id = (max_id[0] + 1) if max_id else 1
        role = Role(role_id=next_id, role_name=role_name)
        db.add(role)
        db.flush()

    user = UserAccount(
        user_id=uuid.uuid4(),
        email=email,
        account_status="active" if is_active else "inactive",
    )
    db.add(user)
    db.flush()

    db.add(UserRoles(user_id=user.user_id, role_id=role.role_id))
    staff = AcademicStaff(
        staff_id=staff_id,
        user_id=user.user_id,
        first_name="First",
        last_name="Last",
    )
    db.add(staff)
    db.flush()
    return staff


def test_mode_sections_only_copies_sections_without_classes(client, db):
    source_year, target_year = make_years(db)
    level_7 = AcademicLevel(level_name="Grade 7", grade_level=7)
    level_8 = AcademicLevel(level_name="Grade 8", grade_level=8)
    db.add_all([level_7, level_8])
    db.flush()

    # Section with a class
    teacher = make_teacher(db, "STAFF-01", "t1@test.com")
    sec_with_class = OfficialSection(
        academic_year_id=source_year.academic_year_id,
        academic_level_id=level_7.academic_level_id,
        section_name="Galileo",
        normalized_name="galileo",
    )
    # Section without a class
    sec_without_class = OfficialSection(
        academic_year_id=source_year.academic_year_id,
        academic_level_id=level_8.academic_level_id,
        section_name="Einstein",
        normalized_name="einstein",
    )
    db.add_all([sec_with_class, sec_without_class])
    db.flush()

    c1 = Class(
        section_name="Galileo",
        class_status="active",
        adviser_staff_id=teacher.staff_id,
        academic_year_id=source_year.academic_year_id,
        academic_level_id=level_7.academic_level_id,
    )
    db.add(c1)
    db.commit()

    resp = client.post("/api/v1/classes/setup-academic-year", json={
        "source_academic_year_id": source_year.academic_year_id,
        "target_academic_year_id": target_year.academic_year_id,
        "mode": "sections_only",
    })

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["sections_created"] == 2
    assert data["sections_reused"] == 0
    assert data["classes_created"] == 0
    assert data["classes_reused"] == 0

    target_sections = db.query(OfficialSection).filter(
        OfficialSection.academic_year_id == target_year.academic_year_id
    ).all()
    assert len(target_sections) == 2
    names = {s.section_name for s in target_sections}
    assert "Galileo" in names
    assert "Einstein" in names

    target_classes = db.query(Class).filter(
        Class.academic_year_id == target_year.academic_year_id
    ).all()
    assert len(target_classes) == 0


def test_mode_retain_classes_and_advisers(client, db):
    source_year, target_year = make_years(db)
    level_7 = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add(level_7)
    db.flush()

    t1 = make_teacher(db, "STAFF-01", "t1@test.com")
    t2 = make_teacher(db, "STAFF-02", "t2@test.com")

    s1 = OfficialSection(
        academic_year_id=source_year.academic_year_id,
        academic_level_id=level_7.academic_level_id,
        section_name="Aristotle",
        normalized_name="aristotle",
    )
    s2 = OfficialSection(
        academic_year_id=source_year.academic_year_id,
        academic_level_id=level_7.academic_level_id,
        section_name="Galileo",
        normalized_name="galileo",
    )
    db.add_all([s1, s2])
    db.flush()

    c1 = Class(
        section_name="Aristotle",
        class_status="active",
        adviser_staff_id=t1.staff_id,
        academic_year_id=source_year.academic_year_id,
        academic_level_id=level_7.academic_level_id,
        period_template_group="JHS_45MIN",
    )
    c2 = Class(
        section_name="Galileo",
        class_status="active",
        adviser_staff_id=t2.staff_id,
        academic_year_id=source_year.academic_year_id,
        academic_level_id=level_7.academic_level_id,
        period_template_group="JHS_45MIN",
    )
    db.add_all([c1, c2])
    db.flush()

    # Add a student and enrollment in source class to ensure it's NEVER copied
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="123456789012",
        first_name="Juan",
        last_name="Cruz",
        academic_level_id=level_7.academic_level_id,
    )
    db.add(student)
    db.flush()
    db.add(StudentClass(
        student_id=student.student_id,
        class_id=c1.class_id,
        academic_year_id=source_year.academic_year_id,
    ))
    db.commit()

    resp = client.post("/api/v1/classes/setup-academic-year", json={
        "source_academic_year_id": source_year.academic_year_id,
        "target_academic_year_id": target_year.academic_year_id,
        "mode": "retain_classes_and_advisers",
    })

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["sections_created"] == 2
    assert data["classes_created"] == 2

    target_classes = db.query(Class).filter(
        Class.academic_year_id == target_year.academic_year_id
    ).order_by(Class.section_name).all()

    assert len(target_classes) == 2
    assert target_classes[0].section_name == "Aristotle"
    assert target_classes[0].adviser_staff_id == "STAFF-01"
    assert target_classes[0].period_template_group == "JHS_45MIN"
    assert target_classes[1].section_name == "Galileo"
    assert target_classes[1].adviser_staff_id == "STAFF-02"

    # Verify zero enrollments or loads in target classes
    for tc in target_classes:
        assert tc.class_id != c1.class_id and tc.class_id != c2.class_id
        student_count = db.query(StudentClass).filter(StudentClass.class_id == tc.class_id).count()
        assert student_count == 0

    # Source class enrollment remains intact
    assert db.query(StudentClass).filter(StudentClass.class_id == c1.class_id).count() == 1


def test_mode_retain_classes_without_advisers(client, db):
    source_year, target_year = make_years(db)
    level_7 = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add(level_7)
    db.flush()

    t1 = make_teacher(db, "STAFF-01", "t1@test.com")
    s1 = OfficialSection(
        academic_year_id=source_year.academic_year_id,
        academic_level_id=level_7.academic_level_id,
        section_name="Aristotle",
        normalized_name="aristotle",
    )
    db.add(s1)
    db.flush()

    c1 = Class(
        section_name="Aristotle",
        class_status="active",
        adviser_staff_id=t1.staff_id,
        academic_year_id=source_year.academic_year_id,
        academic_level_id=level_7.academic_level_id,
    )
    db.add(c1)
    db.commit()

    resp = client.post("/api/v1/classes/setup-academic-year", json={
        "source_academic_year_id": source_year.academic_year_id,
        "target_academic_year_id": target_year.academic_year_id,
        "mode": "retain_classes_without_advisers",
    })

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["classes_created"] == 1

    target_class = db.query(Class).filter(
        Class.academic_year_id == target_year.academic_year_id
    ).first()
    assert target_class.section_name == "Aristotle"
    assert target_class.adviser_staff_id is None


def test_setup_is_idempotent_on_repeated_runs(client, db):
    source_year, target_year = make_years(db)
    level_7 = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add(level_7)
    db.flush()

    t1 = make_teacher(db, "STAFF-01", "t1@test.com")
    s1 = OfficialSection(
        academic_year_id=source_year.academic_year_id,
        academic_level_id=level_7.academic_level_id,
        section_name="Aristotle",
        normalized_name="aristotle",
    )
    db.add(s1)
    db.flush()

    c1 = Class(
        section_name="Aristotle",
        class_status="active",
        adviser_staff_id=t1.staff_id,
        academic_year_id=source_year.academic_year_id,
        academic_level_id=level_7.academic_level_id,
    )
    db.add(c1)
    db.commit()

    payload = {
        "source_academic_year_id": source_year.academic_year_id,
        "target_academic_year_id": target_year.academic_year_id,
        "mode": "retain_classes_and_advisers",
    }

    # First run
    resp1 = client.post("/api/v1/classes/setup-academic-year", json=payload)
    assert resp1.status_code == 200
    assert resp1.json()["sections_created"] == 1
    assert resp1.json()["sections_reused"] == 0
    assert resp1.json()["classes_created"] == 1
    assert resp1.json()["classes_reused"] == 0

    # Second run (exact same parameters)
    resp2 = client.post("/api/v1/classes/setup-academic-year", json=payload)
    assert resp2.status_code == 200
    assert resp2.json()["sections_created"] == 0
    assert resp2.json()["sections_reused"] == 1
    assert resp2.json()["classes_created"] == 0
    assert resp2.json()["classes_reused"] == 1

    # Database still has exactly 1 section and 1 class in target year
    assert db.query(OfficialSection).filter(OfficialSection.academic_year_id == target_year.academic_year_id).count() == 1
    assert db.query(Class).filter(Class.academic_year_id == target_year.academic_year_id).count() == 1


def test_adviser_conflict_in_target_year_aborts_and_rolls_back(client, db):
    source_year, target_year = make_years(db)
    level_7 = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add(level_7)
    db.flush()

    t1 = make_teacher(db, "STAFF-01", "t1@test.com")
    s1 = OfficialSection(
        academic_year_id=source_year.academic_year_id,
        academic_level_id=level_7.academic_level_id,
        section_name="Aristotle",
        normalized_name="aristotle",
    )
    db.add(s1)
    db.flush()

    c1 = Class(
        section_name="Aristotle",
        class_status="active",
        adviser_staff_id=t1.staff_id,
        academic_year_id=source_year.academic_year_id,
        academic_level_id=level_7.academic_level_id,
    )
    db.add(c1)

    # In target year, T1 is ALREADY assigned to another class "Archimedes"
    s_archimedes = OfficialSection(
        academic_year_id=target_year.academic_year_id,
        academic_level_id=level_7.academic_level_id,
        section_name="Archimedes",
        normalized_name="archimedes",
    )
    db.add(s_archimedes)
    db.flush()
    existing_c = Class(
        section_name="Archimedes",
        class_status="active",
        adviser_staff_id=t1.staff_id,
        academic_year_id=target_year.academic_year_id,
        academic_level_id=level_7.academic_level_id,
    )
    db.add(existing_c)
    db.commit()

    resp = client.post("/api/v1/classes/setup-academic-year", json={
        "source_academic_year_id": source_year.academic_year_id,
        "target_academic_year_id": target_year.academic_year_id,
        "mode": "retain_classes_and_advisers",
    })

    assert resp.status_code == 409
    assert "already assigned to a class" in resp.json()["detail"]

    # Rollback verification: Aristotle was NOT created in target year
    assert db.query(Class).filter(
        Class.academic_year_id == target_year.academic_year_id,
        Class.section_name == "Aristotle",
    ).first() is None


def test_ineligible_adviser_aborts_and_rolls_back(client, db):
    source_year, target_year = make_years(db)
    level_7 = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add(level_7)
    db.flush()

    # Inactive teacher account
    t_inactive = make_teacher(db, "STAFF-INACTIVE", "inactive@test.com", is_active=False)
    s1 = OfficialSection(
        academic_year_id=source_year.academic_year_id,
        academic_level_id=level_7.academic_level_id,
        section_name="Aristotle",
        normalized_name="aristotle",
    )
    db.add(s1)
    db.flush()
    c1 = Class(
        section_name="Aristotle",
        class_status="active",
        adviser_staff_id=t_inactive.staff_id,
        academic_year_id=source_year.academic_year_id,
        academic_level_id=level_7.academic_level_id,
    )
    db.add(c1)
    db.commit()

    resp = client.post("/api/v1/classes/setup-academic-year", json={
        "source_academic_year_id": source_year.academic_year_id,
        "target_academic_year_id": target_year.academic_year_id,
        "mode": "retain_classes_and_advisers",
    })

    assert resp.status_code == 409
    assert "not an active eligible teacher" in resp.json()["detail"]
    assert db.query(Class).filter(Class.academic_year_id == target_year.academic_year_id).count() == 0


def test_same_source_and_target_year_rejected(client, db):
    source_year, _ = make_years(db)
    resp = client.post("/api/v1/classes/setup-academic-year", json={
        "source_academic_year_id": source_year.academic_year_id,
        "target_academic_year_id": source_year.academic_year_id,
        "mode": "sections_only",
    })
    assert resp.status_code == 409
    assert "must be different" in resp.json()["detail"]


def test_historical_target_year_rejected(client, db):
    active_year, future_year = make_years(db)
    past_year = AcademicYear(
        year_label="2024-2025",
        start_date=date(2024, 8, 1),
        end_date=date(2025, 5, 31),
        is_active=False,
    )
    db.add(past_year)
    db.commit()

    # Attempting setup where target year is historical
    resp = client.post("/api/v1/classes/setup-academic-year", json={
        "source_academic_year_id": active_year.academic_year_id,
        "target_academic_year_id": past_year.academic_year_id,
        "mode": "sections_only",
    })
    assert resp.status_code == 403
    assert "Historical configuration is read-only" in resp.json()["detail"]


def test_non_admin_role_is_rejected(db):
    test_app = FastAPI()
    test_app.include_router(classes_router, prefix="/api/v1/classes")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "teacher",
    }
    with TestClient(test_app) as teacher_client:
        resp = teacher_client.post("/api/v1/classes/setup-academic-year", json={
            "source_academic_year_id": 1,
            "target_academic_year_id": 2,
            "mode": "sections_only",
        })
        assert resp.status_code == 403
