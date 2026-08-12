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

from app.core.Dependencies import get_current_user
from app.api.v1.routes.Predictions import router as predictions_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
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
    Subject.__table__,
    SubjectLoad.__table__,
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
        c for c in Student.__table__.constraints
        if isinstance(c, CheckConstraint) and c.name == "lrn_check"
    )
    Student.__table__.constraints.remove(lrn_check)
    Base.metadata.create_all(bind=engine, tables=TABLES)
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
