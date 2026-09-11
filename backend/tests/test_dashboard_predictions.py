"""
test_dashboard_predictions.py
=============================
Tests for the Prediction Dashboard endpoints:
  GET /api/v1/predictions/dashboard/at-risk
  GET /api/v1/predictions/dashboard/filters
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.Dependencies import get_current_user, get_optional_staff_id
from app.api.v1.routes.Predictions import router as predictions_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.PeriodTemplateSlot import PeriodTemplateSlot
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.AIPrediction import AIPrediction
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student

TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    AcademicPeriod.__table__,
    Class.__table__,
    StudentClass.__table__,
    Subject.__table__,
    PeriodTemplateSlot.__table__,
    SubjectLoad.__table__,
    TeacherSubstitution.__table__,
    AIModelVersion.__table__,
    AIPrediction.__table__,
]


@pytest.fixture
def dashboard_context():
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
    db = sessionmaker(bind=engine)()

    # ---- seed data ----
    year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
    )
    level = AcademicLevel(
        grade_level=10,
        level_name="Grade 10",
    )
    db.add_all([year, level])
    db.flush()

    class_a = Class(
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
        section_name="Rizal",
    )
    class_b = Class(
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
        section_name="Mabini",
    )
    subject_math = Subject(
        subject_name="Mathematics 10",
        subject_codename="MATH10",
        academic_level_id=level.academic_level_id,
    )
    subject_sci = Subject(
        subject_name="Science 10",
        subject_codename="SCI10",
        academic_level_id=level.academic_level_id,
    )
    db.add_all([class_a, class_b, subject_math, subject_sci])
    db.flush()

    term1 = AcademicPeriod(
        academic_year_id=year.academic_year_id,
        period_name="Quarter 1",
        period_sequence=1,
        start_date=date(2026, 6, 1),
        end_date=date(2026, 8, 31),
    )
    term2 = AcademicPeriod(
        academic_year_id=year.academic_year_id,
        period_name="Quarter 2",
        period_sequence=2,
        start_date=date(2026, 9, 1),
        end_date=date(2026, 11, 30),
    )
    db.add_all([term1, term2])
    db.flush()

    student_a = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000001",
        first_name="Juan",
        last_name="Dela Cruz",
        gender="MALE",
        dob=date(2010, 1, 1),
    )
    student_b = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000002",
        first_name="Maria",
        last_name="Santos",
        gender="FEMALE",
        dob=date(2010, 2, 2),
    )
    student_c = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000003",
        first_name="Pedro",
        last_name="Penduko",
        gender="MALE",
        dob=date(2010, 3, 3),
    )
    db.add_all([student_a, student_b, student_c])
    db.flush()

    sc_a = StudentClass(
        student_id=student_a.student_id,
        class_id=class_a.class_id,
        academic_year_id=year.academic_year_id,
        enrollment_status="enrolled",
    )
    sc_b = StudentClass(
        student_id=student_b.student_id,
        class_id=class_a.class_id,
        academic_year_id=year.academic_year_id,
        enrollment_status="enrolled",
    )
    sc_c = StudentClass(
        student_id=student_c.student_id,
        class_id=class_b.class_id,
        academic_year_id=year.academic_year_id,
        enrollment_status="enrolled",
    )
    db.add_all([sc_a, sc_b, sc_c])
    db.flush()

    model_ver = AIModelVersion(
        model_name="risk_classifier",
        model_type="CLASSIFIER",
        algorithm="RandomForest",
        is_active=True,
    )
    db.add(model_ver)
    db.flush()

    # 4 predictions:
    # 1: Juan, Rizal, Math, Term 1 → HIGH_RISK, score 0.85, predicted 72.5
    # 2: Maria, Rizal, Math, Term 1 → MODERATE_RISK, score 0.60, predicted 78.0
    # 3: Pedro, Mabini, Math, Term 1 → LOW_RISK, score 0.20, predicted 90.0
    # 4: Juan, Rizal, Science, Term 2 → NEEDS_MONITORING, score 0.45, predicted 82.0
    predictions = [
        AIPrediction(
            student_id=student_a.student_id,
            class_id=class_a.class_id,
            subject_id=subject_math.subject_id,
            source_period_id=term1.academic_period_id,
            target_period_id=term1.academic_period_id,
            predicted_period_grade=Decimal("72.50"),
            risk_score=Decimal("0.85"),
            risk_level="HIGH_RISK",
            data_status="SUFFICIENT",
            model_version_id=model_ver.model_version_id,
        ),
        AIPrediction(
            student_id=student_b.student_id,
            class_id=class_a.class_id,
            subject_id=subject_math.subject_id,
            source_period_id=term1.academic_period_id,
            target_period_id=term1.academic_period_id,
            predicted_period_grade=Decimal("78.00"),
            risk_score=Decimal("0.60"),
            risk_level="MODERATE_RISK",
            data_status="SUFFICIENT",
            model_version_id=model_ver.model_version_id,
        ),
        AIPrediction(
            student_id=student_c.student_id,
            class_id=class_b.class_id,
            subject_id=subject_math.subject_id,
            source_period_id=term1.academic_period_id,
            target_period_id=term1.academic_period_id,
            predicted_period_grade=Decimal("90.00"),
            risk_score=Decimal("0.20"),
            risk_level="LOW_RISK",
            data_status="SUFFICIENT",
            model_version_id=model_ver.model_version_id,
        ),
        AIPrediction(
            student_id=student_a.student_id,
            class_id=class_a.class_id,
            subject_id=subject_sci.subject_id,
            source_period_id=term1.academic_period_id,
            target_period_id=term2.academic_period_id,
            predicted_period_grade=Decimal("82.00"),
            risk_score=Decimal("0.45"),
            risk_level="NEEDS_MONITORING",
            data_status="SUFFICIENT",
            model_version_id=model_ver.model_version_id,
        ),
    ]
    db.add_all(predictions)
    db.commit()

    identity = {"sub": str(uuid.uuid4()), "role": "admin"}
    app = FastAPI()
    app.include_router(predictions_router, prefix="/api/v1/predictions")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: identity
    with TestClient(app, raise_server_exceptions=True) as client:
        yield {
            "client": client,
            "db": db,
            "students": {"a": student_a, "b": student_b, "c": student_c},
            "classes": {"rizal": class_a, "mabini": class_b},
            "subjects": {"math": subject_math, "sci": subject_sci},
            "terms": {"t1": term1, "t2": term2},
        }
    db.close()
    Base.metadata.drop_all(bind=engine, tables=list(reversed(TABLES)))
    engine.dispose()


# ============================================================
# Dashboard at-risk endpoint tests
# ============================================================


class TestDashboardAtRisk:
    def test_returns_all_predictions(self, dashboard_context):
        client = dashboard_context["client"]
        r = client.get("/api/v1/predictions/dashboard/at-risk")
        print("STATUS:", r.status_code, "BODY:", r.text)
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 4
        assert len(data["items"]) == 4
        assert "risk_summary" in data

    def test_defaults_to_alphabetical_student_roster_order(self, dashboard_context):
        client = dashboard_context["client"]
        data = client.get("/api/v1/predictions/dashboard/at-risk").json()

        assert [item["student_name"] for item in data["items"]] == [
            "Dela Cruz, Juan",
            "Dela Cruz, Juan",
            "Penduko, Pedro",
            "Santos, Maria",
        ]

    def test_risk_summary_counts(self, dashboard_context):
        client = dashboard_context["client"]
        r = client.get("/api/v1/predictions/dashboard/at-risk")
        summary = r.json()["risk_summary"]
        assert summary["HIGH_RISK"] == 1
        assert summary["MODERATE_RISK"] == 1
        assert summary["NEEDS_MONITORING"] == 1
        assert summary["LOW_RISK"] == 1
        assert summary["total"] == 4

    def test_filter_by_class(self, dashboard_context):
        client = dashboard_context["client"]
        class_id = dashboard_context["classes"]["rizal"].class_id
        r = client.get(f"/api/v1/predictions/dashboard/at-risk?class_id={class_id}")
        data = r.json()
        assert data["total"] == 3

    def test_filter_by_subject(self, dashboard_context):
        client = dashboard_context["client"]
        subj_id = dashboard_context["subjects"]["sci"].subject_id
        r = client.get(f"/api/v1/predictions/dashboard/at-risk?subject_id={subj_id}")
        data = r.json()
        assert data["total"] == 1
        assert data["items"][0]["student_name"] == "Dela Cruz, Juan"

    def test_filter_by_term(self, dashboard_context):
        client = dashboard_context["client"]
        r = client.get("/api/v1/predictions/dashboard/at-risk?term=2")
        data = r.json()
        assert data["total"] == 1

    def test_filter_by_risk_level(self, dashboard_context):
        client = dashboard_context["client"]
        r = client.get("/api/v1/predictions/dashboard/at-risk?risk_level=HIGH_RISK")
        data = r.json()
        assert data["total"] == 1
        assert data["items"][0]["risk_level"] == "HIGH_RISK"

    def test_search_by_name(self, dashboard_context):
        client = dashboard_context["client"]
        r = client.get("/api/v1/predictions/dashboard/at-risk?search=Maria")
        data = r.json()
        assert data["total"] == 1
        assert data["items"][0]["student_name"] == "Santos, Maria"

    def test_search_by_lrn(self, dashboard_context):
        client = dashboard_context["client"]
        r = client.get("/api/v1/predictions/dashboard/at-risk?search=100000000003")
        data = r.json()
        assert data["total"] == 1
        assert data["items"][0]["student_name"] == "Penduko, Pedro"

    def test_pagination(self, dashboard_context):
        client = dashboard_context["client"]
        r1 = client.get("/api/v1/predictions/dashboard/at-risk?limit=2&offset=0")
        data1 = r1.json()
        assert len(data1["items"]) == 2
        assert data1["total"] == 4

        r2 = client.get("/api/v1/predictions/dashboard/at-risk?limit=2&offset=2")
        data2 = r2.json()
        assert len(data2["items"]) == 2

    def test_sort_ascending(self, dashboard_context):
        client = dashboard_context["client"]
        r = client.get("/api/v1/predictions/dashboard/at-risk?sort_by=predicted_period_grade&sort_order=asc")
        data = r.json()
        grades = [item["predicted_period_grade"] for item in data["items"]]
        assert grades == sorted(grades)

    def test_combined_filters(self, dashboard_context):
        """Class Rizal + Term 1 + Math → should be 2 predictions."""
        client = dashboard_context["client"]
        class_id = dashboard_context["classes"]["rizal"].class_id
        subj_id = dashboard_context["subjects"]["math"].subject_id
        r = client.get(
            f"/api/v1/predictions/dashboard/at-risk?class_id={class_id}&subject_id={subj_id}&term=1"
        )
        data = r.json()
        assert data["total"] == 2

    def test_item_shape(self, dashboard_context):
        client = dashboard_context["client"]
        r = client.get("/api/v1/predictions/dashboard/at-risk?limit=1")
        data = r.json()
        item = data["items"][0]
        assert "prediction_id" in item
        assert "student_name" in item
        assert "student_lrn" in item
        assert "class_name" in item
        assert "subject_name" in item
        assert "term_label" in item
        assert "predicted_period_grade" in item
        assert "risk_score" in item
        assert "risk_level" in item

    def test_enrolled_only_isolation(self, dashboard_context):
        """Verify that standard /dashboard/at-risk strictly returns enrolled students,
        while /dashboard/at-risk/historical returns un-enrolled historical predictions."""
        db = dashboard_context["db"]
        client = dashboard_context["client"]

        # Create an un-enrolled 4th student with a prediction
        student_unrolled = Student(
            student_id=uuid.uuid4(),
            student_lrn="100000000099",
            first_name="Historical",
            last_name="Student",
            gender="FEMALE",
            dob=date(2010, 5, 5),
        )
        db.add(student_unrolled)
        db.flush()

        p_unrolled = AIPrediction(
            student_id=student_unrolled.student_id,
            class_id=dashboard_context["classes"]["rizal"].class_id,
            subject_id=dashboard_context["subjects"]["math"].subject_id,
            source_period_id=dashboard_context["terms"]["t1"].academic_period_id,
            target_period_id=dashboard_context["terms"]["t1"].academic_period_id,
            predicted_period_grade=Decimal("75.00"),
            risk_score=Decimal("0.70"),
            risk_level="MODERATE_RISK",
            data_status="SUFFICIENT",
            model_version_id=1,
        )
        db.add(p_unrolled)
        db.commit()

        # 1. Standard endpoint (/dashboard/at-risk) MUST exclude un-enrolled student
        r_enrolled = client.get("/api/v1/predictions/dashboard/at-risk")
        assert r_enrolled.status_code == 200
        data_enrolled = r_enrolled.json()
        assert data_enrolled["total"] == 4
        assert not any(item["student_lrn"] == "100000000099" for item in data_enrolled["items"])

        # 2. Historical endpoint (/dashboard/at-risk/historical) includes un-enrolled student
        r_hist = client.get("/api/v1/predictions/dashboard/at-risk/historical")
        assert r_hist.status_code == 200
        data_hist = r_hist.json()
        assert data_hist["total"] == 5
        assert any(item["student_lrn"] == "100000000099" for item in data_hist["items"])

    def test_historical_endpoint_teacher_forbidden(self, dashboard_context):
        """Assert that a teacher role receives HTTP 403 Forbidden on the historical endpoint."""
        db = dashboard_context["db"]
        teacher_identity = {"sub": str(uuid.uuid4()), "role": "teacher"}
        app = FastAPI()
        app.include_router(predictions_router, prefix="/api/v1/predictions")
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: teacher_identity

        with TestClient(app) as teacher_client:
            r = teacher_client.get("/api/v1/predictions/dashboard/at-risk/historical")
            assert r.status_code == 403

    def test_no_duplicate_prediction_rows_with_multiple_enrollments(self, dashboard_context):
        """Verify that multiple StudentClass records across academic years or section transfers
        do not cause prediction rows to duplicate or fan out in /dashboard/at-risk."""
        db = dashboard_context["db"]
        client = dashboard_context["client"]

        # 1. Create a prior academic year
        prior_year = AcademicYear(
            year_label="2025-2026",
            start_date=date(2025, 6, 1),
            end_date=date(2026, 3, 31),
        )
        db.add(prior_year)
        db.flush()

        # 2. Add an old/transferred enrollment record for student_a in prior_year
        # (simulating a student with multiple StudentClass records across their history)
        sc_old = StudentClass(
            student_id=dashboard_context["students"]["a"].student_id,
            class_id=dashboard_context["classes"]["mabini"].class_id,
            academic_year_id=prior_year.academic_year_id,
            enrollment_status="transferred",
        )
        db.add(sc_old)
        db.commit()

        # 3. Query /dashboard/at-risk
        r = client.get("/api/v1/predictions/dashboard/at-risk")
        assert r.status_code == 200
        data = r.json()

        # Ensure no duplicate prediction_ids exist
        prediction_ids = [item["prediction_id"] for item in data["items"]]
        assert len(prediction_ids) == len(set(prediction_ids)), "Duplicate prediction_id detected in results!"
        assert data["total"] == 4, f"Expected 4 predictions, got {data['total']}"
        assert data["risk_summary"]["total"] == 4, f"Expected risk_summary total 4, got {data['risk_summary']['total']}"


# ============================================================
# Dashboard filters endpoint test
# ============================================================


def test_dashboard_filters(dashboard_context):
    client = dashboard_context["client"]
    r = client.get("/api/v1/predictions/dashboard/filters")
    assert r.status_code == 200
    data = r.json()

    assert "classes" in data
    assert "subjects" in data
    assert "terms" in data

    assert len(data["classes"]) >= 2
    assert len(data["subjects"]) >= 2
    assert len(data["terms"]) >= 2

    c_names = [c.get("section_name") or c.get("label") for c in data["classes"]]
    assert "Rizal" in c_names
    assert "Mabini" in c_names

    s_names = [s.get("subject_name") or s.get("label") for s in data["subjects"]]
    assert "Mathematics 10" in s_names
    assert "Science 10" in s_names

    t_seqs = [t.get("term_number") for t in data["terms"]]
    assert 1 in t_seqs
    assert 2 in t_seqs


def test_dashboard_filters_with_class_id_admin(dashboard_context):
    db = dashboard_context["db"]
    client = dashboard_context["client"]
    rizal = dashboard_context["classes"]["rizal"]
    mabini = dashboard_context["classes"]["mabini"]
    math = dashboard_context["subjects"]["math"]
    sci = dashboard_context["subjects"]["sci"]
    t1 = dashboard_context["terms"]["t1"]

    # Seed loads: Math in Rizal, Sci in Mabini
    load_rizal = SubjectLoad(
        class_id=rizal.class_id,
        subject_id=math.subject_id,
        academic_period_id=t1.academic_period_id,
        status="published",
        is_active_version=True,
    )
    load_mabini = SubjectLoad(
        class_id=mabini.class_id,
        subject_id=sci.subject_id,
        academic_period_id=t1.academic_period_id,
        status="published",
        is_active_version=True,
    )
    db.add_all([load_rizal, load_mabini])
    db.commit()

    # Admin querying with class_id = rizal
    r = client.get(f"/api/v1/predictions/dashboard/filters?class_id={rizal.class_id}")
    assert r.status_code == 200
    data = r.json()
    subj_ids = [s["subject_id"] for s in data["subjects"]]
    assert math.subject_id in subj_ids
    assert sci.subject_id not in subj_ids


def test_dashboard_filters_with_class_id_teacher_scoped(dashboard_context):
    db = dashboard_context["db"]
    client = dashboard_context["client"]
    rizal = dashboard_context["classes"]["rizal"]
    math = dashboard_context["subjects"]["math"]
    sci = dashboard_context["subjects"]["sci"]
    t1 = dashboard_context["terms"]["t1"]

    teacher_staff = AcademicStaff(
        staff_id="T_SCOPED_01",
        first_name="Alice",
        last_name="Guin",
    )
    other_staff = AcademicStaff(
        staff_id="T_OTHER_01",
        first_name="Bob",
        last_name="Ong",
    )
    db.add_all([teacher_staff, other_staff])
    db.commit()

    load_math = SubjectLoad(
        class_id=rizal.class_id,
        subject_id=math.subject_id,
        academic_period_id=t1.academic_period_id,
        staff_id=teacher_staff.staff_id,
        status="published",
        is_active_version=True,
    )
    load_sci = SubjectLoad(
        class_id=rizal.class_id,
        subject_id=sci.subject_id,
        academic_period_id=t1.academic_period_id,
        staff_id=other_staff.staff_id,
        status="published",
        is_active_version=True,
    )
    db.add_all([load_math, load_sci])
    db.commit()

    # Act as teacher_staff
    client.app.dependency_overrides[get_current_user] = lambda: {"sub": str(uuid.uuid4()), "role": "teacher"}
    client.app.dependency_overrides[get_optional_staff_id] = lambda: teacher_staff.staff_id
    try:
        r = client.get(f"/api/v1/predictions/dashboard/filters?class_id={rizal.class_id}")
        assert r.status_code == 200
        data = r.json()
        subj_ids = [s["subject_id"] for s in data["subjects"]]
        assert math.subject_id in subj_ids
        assert sci.subject_id not in subj_ids
    finally:
        client.app.dependency_overrides[get_current_user] = lambda: {"sub": str(uuid.uuid4()), "role": "admin"}
        client.app.dependency_overrides[get_optional_staff_id] = lambda: None


def test_dashboard_filters_with_class_id_substitute_teacher(dashboard_context):
    db = dashboard_context["db"]
    client = dashboard_context["client"]
    rizal = dashboard_context["classes"]["rizal"]
    sci = dashboard_context["subjects"]["sci"]
    t1 = dashboard_context["terms"]["t1"]

    orig_staff = AcademicStaff(
        staff_id="T_ORIG_01",
        first_name="Original",
        last_name="Teacher",
    )
    sub_staff = AcademicStaff(
        staff_id="T_SUB_01",
        first_name="Substitute",
        last_name="Teacher",
    )
    db.add_all([orig_staff, sub_staff])
    db.commit()

    load_sci = SubjectLoad(
        class_id=rizal.class_id,
        subject_id=sci.subject_id,
        academic_period_id=t1.academic_period_id,
        staff_id=orig_staff.staff_id,
        status="published",
        is_active_version=True,
    )
    db.add(load_sci)
    db.commit()

    # Active substitution covering today
    sub = TeacherSubstitution(
        subject_load_id=load_sci.subject_load_id,
        original_staff_id=orig_staff.staff_id,
        substitute_staff_id=sub_staff.staff_id,
        start_date=date.today(),
        status="active",
    )
    db.add(sub)
    db.commit()

    # Act as substitute teacher
    client.app.dependency_overrides[get_current_user] = lambda: {"sub": str(uuid.uuid4()), "role": "teacher"}
    client.app.dependency_overrides[get_optional_staff_id] = lambda: sub_staff.staff_id
    try:
        r = client.get(f"/api/v1/predictions/dashboard/filters?class_id={rizal.class_id}")
        assert r.status_code == 200
        data = r.json()
        subj_ids = [s["subject_id"] for s in data["subjects"]]
        assert sci.subject_id in subj_ids
    finally:
        client.app.dependency_overrides[get_current_user] = lambda: {"sub": str(uuid.uuid4()), "role": "admin"}
        client.app.dependency_overrides[get_optional_staff_id] = lambda: None


def test_dashboard_filters_with_class_id_teacher_no_loads(dashboard_context):
    db = dashboard_context["db"]
    client = dashboard_context["client"]
    rizal = dashboard_context["classes"]["rizal"]

    empty_staff = AcademicStaff(
        staff_id="T_EMPTY_01",
        first_name="No",
        last_name="Loads",
    )
    db.add(empty_staff)
    db.commit()

    client.app.dependency_overrides[get_current_user] = lambda: {"sub": str(uuid.uuid4()), "role": "teacher"}
    client.app.dependency_overrides[get_optional_staff_id] = lambda: empty_staff.staff_id
    try:
        r = client.get(f"/api/v1/predictions/dashboard/filters?class_id={rizal.class_id}")
        assert r.status_code == 200
        data = r.json()
        assert data["subjects"] == []
    finally:
        client.app.dependency_overrides[get_current_user] = lambda: {"sub": str(uuid.uuid4()), "role": "admin"}
        client.app.dependency_overrides[get_optional_staff_id] = lambda: None


def test_dashboard_filters_with_class_id_and_period(dashboard_context):
    db = dashboard_context["db"]
    client = dashboard_context["client"]
    rizal = dashboard_context["classes"]["rizal"]
    math = dashboard_context["subjects"]["math"]
    sci = dashboard_context["subjects"]["sci"]
    t1 = dashboard_context["terms"]["t1"]
    t2 = dashboard_context["terms"]["t2"]

    load_t1 = SubjectLoad(
        class_id=rizal.class_id,
        subject_id=math.subject_id,
        academic_period_id=t1.academic_period_id,
        status="published",
        is_active_version=True,
    )
    load_t2 = SubjectLoad(
        class_id=rizal.class_id,
        subject_id=sci.subject_id,
        academic_period_id=t2.academic_period_id,
        status="published",
        is_active_version=True,
    )
    db.add_all([load_t1, load_t2])
    db.commit()

    # Query for t1 only
    r1 = client.get(f"/api/v1/predictions/dashboard/filters?class_id={rizal.class_id}&academic_period_id={t1.academic_period_id}")
    assert r1.status_code == 200
    data1 = r1.json()
    subj_ids1 = [s["subject_id"] for s in data1["subjects"]]
    assert math.subject_id in subj_ids1
    assert sci.subject_id not in subj_ids1

    # Query for t2 only
    r2 = client.get(f"/api/v1/predictions/dashboard/filters?class_id={rizal.class_id}&academic_period_id={t2.academic_period_id}")
    assert r2.status_code == 200
    data2 = r2.json()
    subj_ids2 = [s["subject_id"] for s in data2["subjects"]]
    assert sci.subject_id in subj_ids2
    assert math.subject_id not in subj_ids2


def test_dashboard_filters_all_terms_alphabetical_fallback(dashboard_context):
    db = dashboard_context["db"]
    client = dashboard_context["client"]
    rizal = dashboard_context["classes"]["rizal"]
    level = db.query(AcademicLevel).first()
    t1 = dashboard_context["terms"]["t1"]
    t2 = dashboard_context["terms"]["t2"]

    subj_z = Subject(subject_name="Zoology", subject_codename="ZOO", academic_level_id=level.academic_level_id)
    subj_a = Subject(subject_name="Algebra", subject_codename="ALG", academic_level_id=level.academic_level_id)
    subj_m = Subject(subject_name="Music", subject_codename="MUS", academic_level_id=level.academic_level_id)
    db.add_all([subj_z, subj_a, subj_m])
    db.commit()

    slot1 = PeriodTemplateSlot(template_group="TEST", slot_name="P1", start_time="08:00", end_time="09:00", display_order=1)
    slot2 = PeriodTemplateSlot(template_group="TEST", slot_name="P2", start_time="09:00", end_time="10:00", display_order=2)
    db.add_all([slot1, slot2])
    db.commit()

    db.add_all([
        SubjectLoad(class_id=rizal.class_id, subject_id=subj_z.subject_id, academic_period_id=t1.academic_period_id, slot_id=slot1.slot_id, status="published", is_active_version=True),
        SubjectLoad(class_id=rizal.class_id, subject_id=subj_a.subject_id, academic_period_id=t1.academic_period_id, slot_id=slot2.slot_id, status="published", is_active_version=True),
        SubjectLoad(class_id=rizal.class_id, subject_id=subj_m.subject_id, academic_period_id=t2.academic_period_id, status="published", is_active_version=True),
    ])
    db.commit()

    # "All Terms": academic_period_id omitted -> alphabetical
    r = client.get(f"/api/v1/predictions/dashboard/filters?class_id={rizal.class_id}")
    assert r.status_code == 200
    data = r.json()
    names = [s["subject_name"] for s in data["subjects"]]
    filtered_names = [n for n in names if n in ["Algebra", "Music", "Zoology"]]
    assert filtered_names == ["Algebra", "Music", "Zoology"]
    for s in data["subjects"]:
        assert s["period_index"] is None


def test_dashboard_filters_subject_period_index_ordering(dashboard_context):
    db = dashboard_context["db"]
    client = dashboard_context["client"]
    rizal = dashboard_context["classes"]["rizal"]
    level = db.query(AcademicLevel).first()
    t1 = dashboard_context["terms"]["t1"]

    subj_early = Subject(subject_name="Early Subject", subject_codename="EARLY", academic_level_id=level.academic_level_id)
    subj_late = Subject(subject_name="Late Subject", subject_codename="LATE", academic_level_id=level.academic_level_id)
    subj_unscheduled = Subject(subject_name="Alpha Unscheduled", subject_codename="UNSCHED", academic_level_id=level.academic_level_id)
    db.add_all([subj_early, subj_late, subj_unscheduled])
    db.commit()

    slot_late = PeriodTemplateSlot(template_group="TEST", slot_name="P5", start_time="13:00", end_time="14:00", display_order=5)
    slot_early = PeriodTemplateSlot(template_group="TEST", slot_name="P2", start_time="09:00", end_time="10:00", display_order=2)
    db.add_all([slot_late, slot_early])
    db.commit()

    db.add_all([
        SubjectLoad(class_id=rizal.class_id, subject_id=subj_early.subject_id, academic_period_id=t1.academic_period_id, slot_id=slot_early.slot_id, status="published", is_active_version=True),
        SubjectLoad(class_id=rizal.class_id, subject_id=subj_late.subject_id, academic_period_id=t1.academic_period_id, slot_id=slot_late.slot_id, status="published", is_active_version=True),
        SubjectLoad(class_id=rizal.class_id, subject_id=subj_unscheduled.subject_id, academic_period_id=t1.academic_period_id, status="published", is_active_version=True),
    ])
    db.commit()

    r = client.get(f"/api/v1/predictions/dashboard/filters?class_id={rizal.class_id}&academic_period_id={t1.academic_period_id}")
    assert r.status_code == 200
    data = r.json()
    relevant = [s for s in data["subjects"] if s["subject_name"] in ["Early Subject", "Late Subject", "Alpha Unscheduled"]]
    assert relevant[0]["subject_name"] == "Early Subject"
    assert relevant[0]["period_index"] == 2
    assert relevant[1]["subject_name"] == "Late Subject"
    assert relevant[1]["period_index"] == 5
    assert relevant[2]["subject_name"] == "Alpha Unscheduled"
    assert relevant[2]["period_index"] is None


def test_dashboard_filters_without_class_id_unchanged(dashboard_context):
    client = dashboard_context["client"]
    r = client.get("/api/v1/predictions/dashboard/filters")
    assert r.status_code == 200
    data = r.json()
    for s in data["subjects"]:
        assert s["period_index"] is None
