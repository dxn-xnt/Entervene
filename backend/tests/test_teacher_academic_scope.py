"""
test_teacher_academic_scope.py
==============================
Isolated tests for Teacher Academic Scope endpoint and legacy filter decoupling:
  GET /api/v1/subject-loads/teacher/scope
  GET /api/v1/predictions/dashboard/filters (legacy preservation)
"""

from __future__ import annotations

import uuid
from datetime import date
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.Dependencies import get_current_user, get_optional_staff_id, get_staff_id
from app.api.v1.routes.SubjectLoads import router as subject_loads_router
from app.api.v1.routes.Predictions import router as predictions_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.PeriodTemplateSlot import PeriodTemplateSlot
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.AIPrediction import AIPrediction
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff

TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    AcademicPeriod.__table__,
    Class.__table__,
    Subject.__table__,
    PeriodTemplateSlot.__table__,
    SubjectLoad.__table__,
    TeacherSubstitution.__table__,
    AIModelVersion.__table__,
    AIPrediction.__table__,
]


@pytest.fixture
def scope_context():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine, tables=TABLES)
    db = sessionmaker(bind=engine)()

    # Seed Academic Year & Periods
    year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    db.add(year)
    db.flush()

    period1 = AcademicPeriod(
        academic_year_id=year.academic_year_id,
        period_name="Quarter 1",
        period_sequence=1,
        start_date=date(2026, 6, 1),
        end_date=date(2026, 8, 31),
        is_active=True,
    )
    period2 = AcademicPeriod(
        academic_year_id=year.academic_year_id,
        period_name="Quarter 2",
        period_sequence=2,
        start_date=date(2026, 9, 1),
        end_date=date(2026, 11, 30),
        is_active=False,
    )
    db.add_all([period1, period2])

    # Seed Academic Levels
    level9 = AcademicLevel(grade_level=9, level_name="Grade 9")
    level10 = AcademicLevel(grade_level=10, level_name="Grade 10")
    db.add_all([level9, level10])
    db.flush()

    # Seed Classes
    class_archimedes = Class(
        academic_year_id=year.academic_year_id,
        academic_level_id=level9.academic_level_id,
        section_name="Archimedes",
    )
    class_aristotle = Class(
        academic_year_id=year.academic_year_id,
        academic_level_id=level9.academic_level_id,
        section_name="Aristotle",
    )
    class_einstein = Class(
        academic_year_id=year.academic_year_id,
        academic_level_id=level10.academic_level_id,
        section_name="Einstein",
    )
    db.add_all([class_archimedes, class_aristotle, class_einstein])

    # Seed Subjects
    subj_math9 = Subject(
        subject_name="Mathematics 9",
        subject_codename="MATH9",
        academic_level_id=level9.academic_level_id,
    )
    subj_sci9 = Subject(
        subject_name="Science 9",
        subject_codename="SCI9",
        academic_level_id=level9.academic_level_id,
    )
    subj_math10 = Subject(
        subject_name="Mathematics 10",
        subject_codename="MATH10",
        academic_level_id=level10.academic_level_id,
    )
    db.add_all([subj_math9, subj_sci9, subj_math10])
    db.flush()

    # Seed Period Template Slots
    slot1 = PeriodTemplateSlot(
        template_group="JHS_45MIN",
        slot_name="Period 1",
        slot_type="CLASS",
        start_time="08:00",
        end_time="08:45",
        is_locked_break=False,
        display_order=1,
    )
    db.add(slot1)
    db.flush()

    # Seed Users & Staff
    user_assigned = UserAccount(
        user_id=uuid.uuid4(),
        email="teacher.assigned@example.com",
        password_hash="hash",
    )
    user_substitute = UserAccount(
        user_id=uuid.uuid4(),
        email="teacher.sub@example.com",
        password_hash="hash",
    )
    user_unassigned = UserAccount(
        user_id=uuid.uuid4(),
        email="teacher.unassigned@example.com",
        password_hash="hash",
    )
    user_admin = UserAccount(
        user_id=uuid.uuid4(),
        email="admin@example.com",
        password_hash="hash",
    )
    user_student = UserAccount(
        user_id=uuid.uuid4(),
        email="student@example.com",
        password_hash="hash",
    )
    db.add_all([user_assigned, user_substitute, user_unassigned, user_admin, user_student])
    db.flush()

    staff_assigned = AcademicStaff(
        staff_id="TCH-001",
        user_id=user_assigned.user_id,
        first_name="Assigned",
        last_name="Teacher",
        email=user_assigned.email,
        employment_status="active",
    )
    staff_substitute = AcademicStaff(
        staff_id="TCH-002",
        user_id=user_substitute.user_id,
        first_name="Substitute",
        last_name="Teacher",
        email=user_substitute.email,
        employment_status="active",
    )
    staff_unassigned = AcademicStaff(
        staff_id="TCH-003",
        user_id=user_unassigned.user_id,
        first_name="Unassigned",
        last_name="Teacher",
        email=user_unassigned.email,
        employment_status="active",
    )
    staff_original = AcademicStaff(
        staff_id="TCH-999",
        user_id=uuid.uuid4(),
        first_name="Original",
        last_name="Teacher",
        email="orig@example.com",
        employment_status="active",
    )
    db.add_all([staff_assigned, staff_substitute, staff_unassigned, staff_original])

    # Assign SubjectLoads:
    # Assigned teacher has Math 9 in Archimedes (published, slot1) and Sci 9 in Aristotle (published)
    load1 = SubjectLoad(
        class_id=class_archimedes.class_id,
        subject_id=subj_math9.subject_id,
        staff_id=staff_assigned.staff_id,
        academic_period_id=period1.academic_period_id,
        slot_id=slot1.slot_id,
        start_time="08:00",
        end_time="08:45",
        status="published",
        is_active_version=True,
    )
    load2 = SubjectLoad(
        class_id=class_aristotle.class_id,
        subject_id=subj_sci9.subject_id,
        staff_id=staff_assigned.staff_id,
        academic_period_id=period1.academic_period_id,
        status="published",
        is_active_version=True,
    )
    # Another load in Einstein taught by another teacher
    load3 = SubjectLoad(
        class_id=class_einstein.class_id,
        subject_id=subj_math10.subject_id,
        staff_id=staff_original.staff_id,
        academic_period_id=period1.academic_period_id,
        status="published",
        is_active_version=True,
    )
    db.add_all([load1, load2, load3])
    db.commit()

    # Create FastAPI Test App
    app = FastAPI()
    app.include_router(subject_loads_router, prefix="/api/v1/subject-loads")
    app.include_router(predictions_router, prefix="/api/v1/predictions")

    current_identity = {"sub": str(user_assigned.user_id), "role": "teacher"}

    def override_current_user():
        return current_identity

    def override_optional_staff():
        role = current_identity.get("role")
        sub = current_identity.get("sub")
        if not sub:
            return None
        staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == uuid.UUID(sub)).first()
        return staff.staff_id if staff else None

    def override_get_staff_id():
        sub = current_identity.get("sub")
        if not sub:
            return None
        staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == uuid.UUID(sub)).first()
        return staff.staff_id if staff else None

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = override_current_user
    app.dependency_overrides[get_optional_staff_id] = override_optional_staff
    app.dependency_overrides[get_staff_id] = override_get_staff_id

    client = TestClient(app)

    yield {
        "client": client,
        "db": db,
        "identity": current_identity,
        "users": {
            "assigned": user_assigned,
            "substitute": user_substitute,
            "unassigned": user_unassigned,
            "admin": user_admin,
            "student": user_student,
        },
        "staff": {
            "assigned": staff_assigned,
            "substitute": staff_substitute,
            "unassigned": staff_unassigned,
            "original": staff_original,
        },
        "classes": {
            "archimedes": class_archimedes,
            "aristotle": class_aristotle,
            "einstein": class_einstein,
        },
        "subjects": {
            "math9": subj_math9,
            "sci9": subj_sci9,
            "math10": subj_math10,
        },
        "periods": {
            "p1": period1,
            "p2": period2,
        },
        "loads": {
            "load1": load1,
            "load2": load2,
            "load3": load3,
        },
    }

    db.close()
    Base.metadata.drop_all(bind=engine, tables=list(reversed(TABLES)))
    engine.dispose()


def test_teacher_scope_requires_teacher_authorization(scope_context):
    client = scope_context["client"]
    ctx = scope_context

    # 1. Non-teacher role (student) is rejected with 403 Forbidden
    ctx["identity"]["role"] = "student"
    ctx["identity"]["sub"] = str(ctx["users"]["student"].user_id)
    resp = client.get("/api/v1/subject-loads/teacher/scope")
    assert resp.status_code == 403

    # 2. Admin role accessing teacher scope is rejected with 403 Forbidden
    ctx["identity"]["role"] = "admin"
    ctx["identity"]["sub"] = str(ctx["users"]["admin"].user_id)
    resp = client.get("/api/v1/subject-loads/teacher/scope")
    assert resp.status_code == 403


def test_teacher_scope_assigned_teacher_sees_authorized_options(scope_context):
    client = scope_context["client"]
    ctx = scope_context

    ctx["identity"]["role"] = "teacher"
    ctx["identity"]["sub"] = str(ctx["users"]["assigned"].user_id)

    resp = client.get("/api/v1/subject-loads/teacher/scope")
    assert resp.status_code == 200
    data = resp.json()

    # Grades: Assigned teacher only has Grade 9
    assert len(data["grades"]) == 1
    assert data["grades"][0]["grade_level"] == 9

    # Classes: Archimedes & Aristotle
    class_ids = {c["class_id"] for c in data["classes"]}
    assert class_ids == {ctx["classes"]["archimedes"].class_id, ctx["classes"]["aristotle"].class_id}
    assert ctx["classes"]["einstein"].class_id not in class_ids

    # Subjects: Math 9 & Sci 9
    subj_ids = {s["subject_id"] for s in data["subjects"]}
    assert subj_ids == {ctx["subjects"]["math9"].subject_id, ctx["subjects"]["sci9"].subject_id}
    assert ctx["subjects"]["math10"].subject_id not in subj_ids

    # Terms: Active periods
    term_ids = {t["academic_period_id"] for t in data["terms"]}
    assert ctx["periods"]["p1"].academic_period_id in term_ids


def test_teacher_scope_class_filtering_and_period_index(scope_context):
    client = scope_context["client"]
    ctx = scope_context

    ctx["identity"]["role"] = "teacher"
    ctx["identity"]["sub"] = str(ctx["users"]["assigned"].user_id)

    # Filter to Archimedes with academic period
    arch_id = ctx["classes"]["archimedes"].class_id
    p1_id = ctx["periods"]["p1"].academic_period_id
    resp = client.get(f"/api/v1/subject-loads/teacher/scope?class_id={arch_id}&academic_period_id={p1_id}")
    assert resp.status_code == 200
    data = resp.json()

    # Only Math 9 is taught in Archimedes by this teacher
    assert len(data["subjects"]) == 1
    subj = data["subjects"][0]
    assert subj["subject_id"] == ctx["subjects"]["math9"].subject_id
    # Enriched period_index from slot match (slot1 has display_order=1)
    assert subj.get("period_index") == 1


def test_teacher_scope_unassigned_class_rejected(scope_context):
    client = scope_context["client"]
    ctx = scope_context

    ctx["identity"]["role"] = "teacher"
    ctx["identity"]["sub"] = str(ctx["users"]["assigned"].user_id)

    # Request Einstein class, which this teacher is NOT assigned to
    einstein_id = ctx["classes"]["einstein"].class_id
    resp = client.get(f"/api/v1/subject-loads/teacher/scope?class_id={einstein_id}")
    assert resp.status_code == 403
    assert "access" in resp.json()["detail"].lower()


def test_teacher_scope_unassigned_teacher_receives_empty_options(scope_context):
    client = scope_context["client"]
    ctx = scope_context

    ctx["identity"]["role"] = "teacher"
    ctx["identity"]["sub"] = str(ctx["users"]["unassigned"].user_id)

    resp = client.get("/api/v1/subject-loads/teacher/scope")
    assert resp.status_code == 200
    data = resp.json()
    assert data["grades"] == []
    assert data["classes"] == []
    assert data["subjects"] == []
    assert data["terms"] == []


def test_teacher_scope_active_substitution_included(scope_context):
    client = scope_context["client"]
    ctx = scope_context
    db = scope_context["db"]

    # Add an active substitution: substitute teacher covers load3 (Einstein, Math 10)
    sub = TeacherSubstitution(
        subject_load_id=ctx["loads"]["load3"].subject_load_id,
        original_staff_id=ctx["staff"]["original"].staff_id,
        substitute_staff_id=ctx["staff"]["substitute"].staff_id,
        start_date=date(2026, 6, 1),
        end_date=date(2026, 12, 31),
        status="active",
    )
    db.add(sub)
    db.commit()

    ctx["identity"]["role"] = "teacher"
    ctx["identity"]["sub"] = str(ctx["users"]["substitute"].user_id)

    resp = client.get("/api/v1/subject-loads/teacher/scope")
    assert resp.status_code == 200
    data = resp.json()

    # Substitute should see Einstein class and Math 10
    assert any(c["class_id"] == ctx["classes"]["einstein"].class_id for c in data["classes"])
    assert any(s["subject_id"] == ctx["subjects"]["math10"].subject_id for s in data["subjects"])
    assert any(g["grade_level"] == 10 for g in data["grades"])


def test_teacher_scope_inactive_or_expired_substitution_excluded(scope_context):
    client = scope_context["client"]
    ctx = scope_context
    db = scope_context["db"]

    # Inactive/completed substitution
    sub_inactive = TeacherSubstitution(
        subject_load_id=ctx["loads"]["load3"].subject_load_id,
        original_staff_id=ctx["staff"]["original"].staff_id,
        substitute_staff_id=ctx["staff"]["substitute"].staff_id,
        start_date=date(2026, 1, 1),
        end_date=date(2026, 3, 1),
        status="completed",
    )
    db.add(sub_inactive)
    db.commit()

    ctx["identity"]["role"] = "teacher"
    ctx["identity"]["sub"] = str(ctx["users"]["substitute"].user_id)

    resp = client.get("/api/v1/subject-loads/teacher/scope")
    assert resp.status_code == 200
    data = resp.json()
    assert data["classes"] == []
    assert data["subjects"] == []


def test_legacy_prediction_dashboard_filters_preservation(scope_context):
    client = scope_context["client"]
    ctx = scope_context

    # 1. Admin gets all options from legacy dashboard filters
    ctx["identity"]["role"] = "admin"
    ctx["identity"]["sub"] = str(ctx["users"]["admin"].user_id)
    resp = client.get("/api/v1/predictions/dashboard/filters")
    assert resp.status_code == 200
    admin_data = resp.json()
    assert len(admin_data["classes"]) == 3  # All classes

    # 2. Teacher gets scoped options from legacy endpoint without 403 on unassigned class
    ctx["identity"]["role"] = "teacher"
    ctx["identity"]["sub"] = str(ctx["users"]["assigned"].user_id)
    resp = client.get("/api/v1/predictions/dashboard/filters")
    assert resp.status_code == 200
    teacher_data = resp.json()
    assert len(teacher_data["classes"]) == 2
