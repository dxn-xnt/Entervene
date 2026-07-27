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

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Predictions import router as predictions_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
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
    Student.__table__.append_constraint(lrn_check)
    db = sessionmaker(bind=engine)()

    # ---- seed data ----
    year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    level = AcademicLevel(level_name="Grade 11", grade_level=11)
    db.add_all([year, level])
    db.flush()

    term1 = AcademicPeriod(
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        period_progress_ratio=round(1 / 3, 4),
        start_date=date(2026, 6, 1),
        end_date=date(2026, 9, 30),
        academic_year_id=year.academic_year_id,
    )
    term2 = AcademicPeriod(
        period_name="Term 2",
        period_type="TERM",
        period_sequence=2,
        total_periods_in_year=3,
        period_progress_ratio=round(2 / 3, 4),
        start_date=date(2026, 10, 1),
        end_date=date(2027, 1, 31),
        academic_year_id=year.academic_year_id,
    )
    class_a = Class(
        section_name="Rizal",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    class_b = Class(
        section_name="Mabini",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    subject_math = Subject(subject_name="Mathematics (Generic)", academic_level_id=level.academic_level_id)
    subject_sci = Subject(subject_name="Science (Generic)", academic_level_id=level.academic_level_id)
    model = AIModelVersion(
        model_version_id=1,
        model_name="entervene_next_period_grade_rf",
        model_type="REGRESSOR",
        algorithm="RandomForestRegressor",
        artifact_path="data/models/model.joblib",
        is_active=True,
    )

    student_a = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000001",
        first_name="Maria",
        last_name="Cruz",
        academic_level_id=level.academic_level_id,
    )
    student_b = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000002",
        first_name="Juan",
        last_name="Santos",
        academic_level_id=level.academic_level_id,
    )
    student_c = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000003",
        first_name="Ana",
        last_name="Reyes",
        academic_level_id=level.academic_level_id,
    )

    db.add_all([
        term1, term2,
        class_a, class_b,
        subject_math, subject_sci,
        model,
        student_a, student_b, student_c,
    ])
    db.commit()

    # ---- seed predictions ----
    predictions = [
        # Student A, Class Rizal, Math, Term 1 → NEEDS_MONITORING
        AIPrediction(
            student_id=student_a.student_id,
            class_id=class_a.class_id,
            subject_id=subject_math.subject_id,
            source_period_id=term1.academic_period_id,
            target_period_id=term1.academic_period_id,
            predicted_period_grade=Decimal("84.50"),
            risk_score=Decimal("38.0000"),
            risk_level="NEEDS_MONITORING",
            data_status="SUFFICIENT",
            model_version_id=1,
        ),
        # Student B, Class Rizal, Math, Term 1 → LOW_RISK
        AIPrediction(
            student_id=student_b.student_id,
            class_id=class_a.class_id,
            subject_id=subject_math.subject_id,
            source_period_id=term1.academic_period_id,
            target_period_id=term1.academic_period_id,
            predicted_period_grade=Decimal("92.10"),
            risk_score=Decimal("12.0000"),
            risk_level="LOW_RISK",
            data_status="SUFFICIENT",
            model_version_id=1,
        ),
        # Student C, Class Mabini, Science, Term 2 → NEEDS_MONITORING
        AIPrediction(
            student_id=student_c.student_id,
            class_id=class_b.class_id,
            subject_id=subject_sci.subject_id,
            source_period_id=term2.academic_period_id,
            target_period_id=term2.academic_period_id,
            predicted_period_grade=Decimal("85.00"),
            risk_score=Decimal("35.5000"),
            risk_level="NEEDS_MONITORING",
            data_status="SUFFICIENT",
            model_version_id=1,
        ),
        # Student A, Class Rizal, Science, Term 1 → LOW_RISK
        AIPrediction(
            student_id=student_a.student_id,
            class_id=class_a.class_id,
            subject_id=subject_sci.subject_id,
            source_period_id=term1.academic_period_id,
            target_period_id=term1.academic_period_id,
            predicted_period_grade=Decimal("93.20"),
            risk_score=Decimal("8.0000"),
            risk_level="LOW_RISK",
            data_status="SUFFICIENT",
            model_version_id=1,
        ),
    ]
    db.add_all(predictions)
    db.commit()

    identity = {"sub": str(uuid.uuid4()), "role": "admin"}
    app = FastAPI()
    app.include_router(predictions_router, prefix="/api/v1/predictions")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: identity
    with TestClient(app, raise_server_exceptions=False) as client:
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
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 4
        assert len(data["items"]) == 4
        assert "risk_summary" in data

    def test_risk_summary_counts(self, dashboard_context):
        client = dashboard_context["client"]
        r = client.get("/api/v1/predictions/dashboard/at-risk")
        data = r.json()
        summary = data["risk_summary"]
        assert summary["NEEDS_MONITORING"] == 2
        assert summary["LOW_RISK"] == 2
        assert summary["HIGH_RISK"] == 0
        assert summary["MODERATE_RISK"] == 0
        assert summary["INSUFFICIENT_DATA"] == 0
        assert summary["total"] == 4

    def test_filter_by_class(self, dashboard_context):
        client = dashboard_context["client"]
        class_id = dashboard_context["classes"]["rizal"].class_id
        r = client.get(f"/api/v1/predictions/dashboard/at-risk?class_id={class_id}")
        data = r.json()
        assert data["total"] == 3
        for item in data["items"]:
            assert item["class_name"] == "Rizal"

    def test_filter_by_subject(self, dashboard_context):
        client = dashboard_context["client"]
        subj_id = dashboard_context["subjects"]["math"].subject_id
        r = client.get(f"/api/v1/predictions/dashboard/at-risk?subject_id={subj_id}")
        data = r.json()
        assert data["total"] == 2
        for item in data["items"]:
            assert item["subject_name"] == "Mathematics (Generic)"

    def test_filter_by_term(self, dashboard_context):
        client = dashboard_context["client"]
        r = client.get("/api/v1/predictions/dashboard/at-risk?term=1")
        data = r.json()
        assert data["total"] == 3
        for item in data["items"]:
            assert item["term_number"] == 1
            assert item["term_label"] == "Term 1"

    def test_filter_by_risk_level(self, dashboard_context):
        client = dashboard_context["client"]
        r = client.get("/api/v1/predictions/dashboard/at-risk?risk_level=LOW_RISK")
        data = r.json()
        assert data["total"] == 2
        for item in data["items"]:
            assert item["risk_level"] == "LOW_RISK"
        # Risk summary should reflect the filter
        assert data["risk_summary"]["LOW_RISK"] == 2
        assert data["risk_summary"]["NEEDS_MONITORING"] == 0

    def test_search_by_name(self, dashboard_context):
        client = dashboard_context["client"]
        r = client.get("/api/v1/predictions/dashboard/at-risk?search=Cruz")
        data = r.json()
        assert data["total"] == 2  # Student A has 2 predictions
        for item in data["items"]:
            assert "Cruz" in item["student_name"]

    def test_search_by_lrn(self, dashboard_context):
        client = dashboard_context["client"]
        r = client.get("/api/v1/predictions/dashboard/at-risk?search=100000000003")
        data = r.json()
        assert data["total"] == 1
        assert data["items"][0]["student_lrn"] == "100000000003"

    def test_pagination(self, dashboard_context):
        client = dashboard_context["client"]
        r = client.get("/api/v1/predictions/dashboard/at-risk?limit=2&offset=0")
        data = r.json()
        assert data["total"] == 4
        assert len(data["items"]) == 2
        assert data["limit"] == 2
        assert data["offset"] == 0

        r2 = client.get("/api/v1/predictions/dashboard/at-risk?limit=2&offset=2")
        data2 = r2.json()
        assert len(data2["items"]) == 2
        # Should not overlap with page 1
        ids_page1 = {item["prediction_id"] for item in data["items"]}
        ids_page2 = {item["prediction_id"] for item in data2["items"]}
        assert ids_page1.isdisjoint(ids_page2)

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
        expected_keys = {
            "prediction_id", "student_id", "student_name", "student_lrn",
            "class_name", "subject_name", "term_label", "term_number",
            "predicted_period_grade", "risk_level", "risk_score",
            "data_status", "generated_at",
        }
        assert expected_keys.issubset(set(item.keys()))


# ============================================================
# Dashboard filters endpoint tests
# ============================================================


class TestDashboardFilters:
    def test_returns_filter_options(self, dashboard_context):
        client = dashboard_context["client"]
        r = client.get("/api/v1/predictions/dashboard/filters")
        assert r.status_code == 200
        data = r.json()
        assert "classes" in data
        assert "subjects" in data
        assert "terms" in data

    def test_classes_match_predictions(self, dashboard_context):
        client = dashboard_context["client"]
        r = client.get("/api/v1/predictions/dashboard/filters")
        data = r.json()
        class_names = {c["section_name"] for c in data["classes"]}
        assert "Rizal" in class_names
        assert "Mabini" in class_names

    def test_subjects_match_predictions(self, dashboard_context):
        client = dashboard_context["client"]
        r = client.get("/api/v1/predictions/dashboard/filters")
        data = r.json()
        subject_names = {s["subject_name"] for s in data["subjects"]}
        assert "Mathematics (Generic)" in subject_names
        assert "Science (Generic)" in subject_names

    def test_terms_use_term_label(self, dashboard_context):
        client = dashboard_context["client"]
        r = client.get("/api/v1/predictions/dashboard/filters")
        data = r.json()
        labels = {t["term_label"] for t in data["terms"]}
        assert "Term 1" in labels
        assert "Term 2" in labels
        # Ensure no Quarter/Semester language
        for t in data["terms"]:
            assert "Quarter" not in t["term_label"]
            assert "Semester" not in t["term_label"]
