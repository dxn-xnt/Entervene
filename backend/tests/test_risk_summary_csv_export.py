"""
test_risk_summary_csv_export.py
===============================
Unit and integration tests for Student Risk Summary CSV Export:
- Admin school-wide export
- Teacher scoped export to assigned triplets
- Teacher out-of-scope access rejected (403)
- Student role forbidden (403)
- Formula injection sanitization
- Risk level, class, and search filtering
"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.Dependencies import get_current_user, get_optional_staff_id, require_role
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
from app.models.ai.AIPredictionFeature import AIPredictionFeature
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student


@pytest.fixture
def risk_export_env():
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

    # Academic Structure
    year = AcademicYear(academic_year_id=1, year_label="2026-2027", start_date=date(2026, 6, 1), end_date=date(2027, 3, 31), is_active=True)
    level = AcademicLevel(academic_level_id=1, grade_level=10, level_name="Grade 10")
    db.add_all([year, level])
    db.flush()

    period = AcademicPeriod(
        academic_period_id=1,
        academic_year_id=1,
        period_name="Quarter 1",
        period_type="QUARTER",
        period_sequence=1,
        total_periods_in_year=4,
        start_date=date(2026, 6, 1),
        end_date=date(2026, 8, 31),
        is_active=True,
    )
    db.add(period)
    db.flush()

    # Users & Staff
    user_teacher_id = uuid.uuid4()
    user_other_id = uuid.uuid4()
    user_admin_id = uuid.uuid4()
    user_student_id = uuid.uuid4()

    db.add_all([
        UserAccount(user_id=user_teacher_id, email="teacher@test.local", password_hash="x"),
        UserAccount(user_id=user_other_id, email="other@test.local", password_hash="x"),
        UserAccount(user_id=user_admin_id, email="admin@test.local", password_hash="x"),
        UserAccount(user_id=user_student_id, email="student@test.local", password_hash="x"),
    ])
    db.flush()

    staff_teacher = AcademicStaff(staff_id="ST-101", user_id=user_teacher_id, first_name="Maria", last_name="Santos", email="maria@test.local")
    staff_other = AcademicStaff(staff_id="ST-999", user_id=user_other_id, first_name="Juan", last_name="Other", email="other@test.local")
    staff_admin = AcademicStaff(staff_id="ST-ADM", user_id=user_admin_id, first_name="Admin", last_name="User", email="admin@test.local")
    db.add_all([staff_teacher, staff_other, staff_admin])
    db.flush()

    # Classes & Subjects
    cls_assigned = Class(
        class_id=10,
        section_name="Emerald",
        academic_year_id=1,
        academic_level_id=1,
        adviser_staff_id="ST-101",
    )
    cls_other = Class(
        class_id=20,
        section_name="Diamond",
        academic_year_id=1,
        academic_level_id=1,
        adviser_staff_id="ST-999",
    )
    db.add_all([cls_assigned, cls_other])
    db.flush()

    subj_math = Subject(subject_id=1, subject_name="Mathematics 10", subject_codename="MATH10", academic_level_id=1)
    subj_sci = Subject(subject_id=2, subject_name="Science 10", subject_codename="SCI10", academic_level_id=1)
    db.add_all([subj_math, subj_sci])
    db.flush()

    # Teaching Loads (Teacher ST-101 teaches Math in class 10)
    load = SubjectLoad(
        subject_load_id=1,
        class_id=10,
        subject_id=1,
        staff_id="ST-101",
        academic_period_id=1,
        is_active_version=True,
        status="published",
    )
    load_other = SubjectLoad(
        subject_load_id=2,
        class_id=20,
        subject_id=2,
        staff_id="ST-999",
        academic_period_id=1,
        is_active_version=True,
        status="published",
    )
    db.add_all([load, load_other])
    db.flush()

    # Students & Enrollments
    s1_id = uuid.uuid4()
    s2_id = uuid.uuid4()
    s3_id = uuid.uuid4()

    s1 = Student(student_id=s1_id, student_lrn="100000000001", first_name="Ana", last_name="Reyes", gender="FEMALE")
    s2 = Student(student_id=s2_id, student_lrn="100000000002", first_name="Student", last_name="=FormulaLast", gender="MALE")
    s3 = Student(student_id=s3_id, student_lrn="100000000003", first_name="Carlos", last_name="Mendoza", gender="MALE")
    db.add_all([s1, s2, s3])
    db.flush()

    db.add_all([
        StudentClass(student_id=s1_id, class_id=10, academic_year_id=1, enrollment_status="enrolled"),
        StudentClass(student_id=s2_id, class_id=10, academic_year_id=1, enrollment_status="enrolled"),
        StudentClass(student_id=s3_id, class_id=20, academic_year_id=1, enrollment_status="enrolled"),
    ])
    db.flush()

    # Model Version
    model_ver = AIModelVersion(
        model_version_id=1,
        model_name="risk_classifier_v1",
        model_type="CLASSIFIER",
        model_purpose="NEXT_PERIOD_BASELINE_FORECAST",
        algorithm="RandomForest",
        is_active=True,
    )
    db.add(model_ver)
    db.flush()

    # Predictions
    # Pred 1: Ana Reyes, Class 10, Math, High Risk
    pred1 = AIPrediction(
        prediction_id=1,
        student_id=s1_id,
        class_id=10,
        subject_id=1,
        source_period_id=1,
        target_period_id=1,
        predicted_period_grade=Decimal("72.50"),
        risk_score=Decimal("0.85"),
        risk_level="HIGH_RISK",
        data_status="SUFFICIENT",
        model_version_id=1,
        evidence_snapshot={"attendance_rate": 82.5, "completion_rate": 70.0},
    )
    # Pred 2: =FormulaStudent, Class 10, Math, Moderate Risk
    pred2 = AIPrediction(
        prediction_id=2,
        student_id=s2_id,
        class_id=10,
        subject_id=1,
        source_period_id=1,
        target_period_id=1,
        predicted_period_grade=Decimal("78.00"),
        risk_score=Decimal("0.60"),
        risk_level="MODERATE_RISK",
        data_status="SUFFICIENT",
        model_version_id=1,
        evidence_snapshot={"attendance_rate": 90.0, "completion_rate": 85.0},
    )
    # Pred 3: Carlos Mendoza, Class 20, Science, Low Risk (other teacher's class)
    pred3 = AIPrediction(
        prediction_id=3,
        student_id=s3_id,
        class_id=20,
        subject_id=2,
        source_period_id=1,
        target_period_id=1,
        predicted_period_grade=Decimal("91.00"),
        risk_score=Decimal("0.15"),
        risk_level="LOW_RISK",
        data_status="SUFFICIENT",
        model_version_id=1,
        evidence_snapshot={"attendance_rate": 98.0, "completion_rate": 95.0},
    )
    db.add_all([pred1, pred2, pred3])
    db.flush()

    # Features
    feat1 = AIPredictionFeature(
        prediction_id=1,
        feature_name="low_quiz_scores",
        feature_value=Decimal("65.0"),
        feature_contribution=Decimal("0.35"),
        direction="INCREASES_RISK",
        feature_rank=1,
        explanation_method="SHAP",
    )
    feat2 = AIPredictionFeature(
        prediction_id=2,
        feature_name="=formula_feature",
        feature_value=Decimal("70.0"),
        feature_contribution=Decimal("0.25"),
        direction="INCREASES_RISK",
        feature_rank=1,
        explanation_method="SHAP",
    )
    db.add_all([feat1, feat2])
    db.commit()

    current_identity = {"sub": str(user_admin_id), "role": "admin"}
    current_staff_id = "ST-ADM"

    app = FastAPI()
    app.include_router(predictions_router, prefix="/api/v1/predictions")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: current_identity
    app.dependency_overrides[get_optional_staff_id] = lambda: current_staff_id

    client = TestClient(app)

    yield {
        "client": client,
        "db": db,
        "set_user": lambda user_dict, staff: (
            current_identity.clear(),
            current_identity.update(user_dict),
            app.dependency_overrides.update({get_optional_staff_id: lambda: staff}),
        ),
        "user_teacher_id": user_teacher_id,
        "user_admin_id": user_admin_id,
        "user_student_id": user_student_id,
    }

    db.close()
    engine.dispose()


def test_risk_summary_csv_admin_school_wide(risk_export_env):
    """Admin exports all predictions school-wide with complete headers and rows."""
    client = risk_export_env["client"]
    res = client.get("/api/v1/predictions/export-csv")
    assert res.status_code == 200
    assert "text/csv" in res.headers["content-type"]
    assert "Risk_Summary" in res.headers["content-disposition"]

    content = res.content.decode("utf-8-sig")
    reader = list(csv.reader(io.StringIO(content)))
    assert len(reader) >= 4  # Header + 3 student predictions
    headers = reader[0]
    assert headers == [
        "Student LRN",
        "Student Name",
        "Grade Level",
        "Class / Section",
        "Subject",
        "Academic Term",
        "Risk Level",
        "Risk Score",
        "Projected Grade",
        "Attendance Rate",
        "Submission Rate",
        "Primary Risk Indicator",
        "Projection Date",
    ]

    # Verify predictions are included
    names = [row[1] for row in reader[1:]]
    assert any("Reyes, Ana" in n for n in names)
    assert any("Mendoza, Carlos" in n for n in names)


def test_risk_summary_csv_teacher_assigned_only(risk_export_env):
    """Teacher exports CSV and receives only students in their assigned classes/subjects."""
    set_user = risk_export_env["set_user"]
    set_user({"sub": str(risk_export_env["user_teacher_id"]), "role": "teacher"}, "ST-101")

    client = risk_export_env["client"]
    res = client.get("/api/v1/predictions/export-csv")
    assert res.status_code == 200

    content = res.content.decode("utf-8-sig")
    reader = list(csv.reader(io.StringIO(content)))
    assert len(reader) == 3  # Header + 2 students in class 10 (Ana, FormulaStudent)

    names = [row[1] for row in reader[1:]]
    assert any("Reyes, Ana" in n for n in names)
    # Mendoza is in class 20 (taught by ST-999), must NOT be present
    assert not any("Mendoza, Carlos" in n for n in names)


def test_risk_summary_csv_teacher_unassigned_scope_forbidden(risk_export_env):
    """Teacher cannot request export for an unassigned class."""
    set_user = risk_export_env["set_user"]
    set_user({"sub": str(risk_export_env["user_teacher_id"]), "role": "teacher"}, "ST-101")

    client = risk_export_env["client"]
    # Request class 20 (Diamond) which is taught by ST-999, not ST-101
    res = client.get("/api/v1/predictions/export-csv?class_id=20")
    assert res.status_code == 403
    assert "not assigned" in res.json()["detail"].lower()


def test_risk_summary_csv_student_role_forbidden(risk_export_env):
    """Student cannot access the risk summary CSV export endpoint."""
    set_user = risk_export_env["set_user"]
    set_user({"sub": str(risk_export_env["user_student_id"]), "role": "student"}, None)

    client = risk_export_env["client"]
    res = client.get("/api/v1/predictions/export-csv")
    assert res.status_code == 403


def test_risk_summary_csv_formula_injection_sanitization(risk_export_env):
    """Values starting with =, +, -, @ are prefixed with an apostrophe."""
    client = risk_export_env["client"]
    res = client.get("/api/v1/predictions/export-csv")
    assert res.status_code == 200

    content = res.content.decode("utf-8-sig")
    reader = list(csv.reader(io.StringIO(content)))

    formula_student_row = next((r for r in reader if "FormulaLast" in r[1]), None)
    assert formula_student_row is not None
    # Check that name starting with = was prefixed with '
    assert formula_student_row[1].startswith("'")
    # Check that primary indicator starting with = was sanitized
    assert formula_student_row[11].startswith("'")


def test_risk_summary_csv_filter_by_risk_level(risk_export_env):
    """Filtering by risk level returns only predictions with that risk level."""
    client = risk_export_env["client"]
    res = client.get("/api/v1/predictions/export-csv?risk_level=HIGH_RISK")
    assert res.status_code == 200

    content = res.content.decode("utf-8-sig")
    reader = list(csv.reader(io.StringIO(content)))
    assert len(reader) == 2  # Header + 1 HIGH_RISK student (Ana Reyes)
    assert reader[1][6] == "High Risk"
    assert "Reyes, Ana" in reader[1][1]
