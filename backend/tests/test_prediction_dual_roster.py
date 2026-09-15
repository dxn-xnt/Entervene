from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timezone
from decimal import Decimal
import json
from pathlib import Path
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Predictions import router as predictions_router
from app.core.Dependencies import get_optional_staff_id, get_staff_id
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.AIPrediction import (
    AIPrediction,
    RISK_ASSESSMENT_EVALUATED,
    RISK_ASSESSMENT_NOT_EVALUATED_CURRENT,
)
from app.models.ai.PredictionGenerationRequest import PredictionGenerationRequest
from app.models.ai.PredictionOutcome import PredictionOutcome
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.prediction.CurrentPeriodFeatureBuilderService import (
    MODEL_NAME as CURRENT_MODEL_NAME,
    MODEL_PURPOSE as CURRENT_MODEL_PURPOSE,
)
from app.services.prediction.ModelScoringService import DEFAULT_MODEL_NAME
from app.services.prediction.PredictionStatusService import (
    get_dual_purpose_roster_status,
    get_roster_prediction_status,
)


@pytest.fixture
def roster_context():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    lrn_check = next((c for c in Student.__table__.constraints if isinstance(c, CheckConstraint) and c.name == "lrn_check"), None)
    if lrn_check and lrn_check in Student.__table__.constraints:
        Student.__table__.constraints.remove(lrn_check)
    risk_check = next((c for c in AIPrediction.__table__.constraints if isinstance(c, CheckConstraint) and c.name == "ck_ai_prediction_risk_assessment_status"), None)
    if risk_check and risk_check in AIPrediction.__table__.constraints:
        AIPrediction.__table__.constraints.remove(risk_check)
    col = AIPrediction.__table__.c.risk_assessment_status
    prev_nullable = col.nullable
    col.nullable = True
    try:
        Base.metadata.create_all(bind=engine)
    finally:
        if lrn_check and lrn_check not in Student.__table__.constraints:
            Student.__table__.append_constraint(lrn_check)
        if risk_check and risk_check not in AIPrediction.__table__.constraints:
            AIPrediction.__table__.append_constraint(risk_check)
        col.nullable = prev_nullable

    db = sessionmaker(bind=engine)()

    # Academic Year & Level
    year = AcademicYear(year_label="2026-2027", start_date=date(2026, 6, 1), end_date=date(2027, 3, 31), is_active=True)
    level = AcademicLevel(level_name="Grade 9", grade_level=9)
    db.add_all([year, level])
    db.flush()

    # Staff:
    # Teacher 1 (assigned to Term 2 focal period)
    staff1_user = UserAccount(user_id=uuid.uuid4(), email="teacher_term2@example.test")
    staff1 = AcademicStaff(staff_id="STAFF-T2", first_name="TermTwo", last_name="Teacher", user_id=staff1_user.user_id)
    # Teacher 2 (assigned to Term 1 only)
    staff2_user = UserAccount(user_id=uuid.uuid4(), email="teacher_term1@example.test")
    staff2 = AcademicStaff(staff_id="STAFF-T1", first_name="TermOne", last_name="Teacher", user_id=staff2_user.user_id)
    # Teacher 3 (unassigned)
    staff3_user = UserAccount(user_id=uuid.uuid4(), email="teacher_unassigned@example.test")
    staff3 = AcademicStaff(staff_id="STAFF-NONE", first_name="Unassigned", last_name="Teacher", user_id=staff3_user.user_id)

    # Academic Periods: 3 Terms
    p1 = AcademicPeriod(
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.3333"),
        start_date=date(2026, 6, 1),
        end_date=date(2026, 8, 31),
        academic_year_id=year.academic_year_id,
        is_active=False,
    )
    p2 = AcademicPeriod(
        period_name="Term 2",
        period_type="TERM",
        period_sequence=2,
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.6667"),
        start_date=date(2026, 9, 1),
        end_date=date(2026, 11, 30),
        academic_year_id=year.academic_year_id,
        is_active=True,
    )
    p3 = AcademicPeriod(
        period_name="Term 3",
        period_type="TERM",
        period_sequence=3,
        total_periods_in_year=3,
        period_progress_ratio=Decimal("1.0000"),
        start_date=date(2026, 12, 1),
        end_date=date(2027, 3, 31),
        academic_year_id=year.academic_year_id,
        is_active=False,
    )

    class_ = Class(section_name="Emerald", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
    subject = Subject(subject_name="Science", subject_codename="SCIENCE", academic_level_id=level.academic_level_id)

    db.add_all([staff1_user, staff1, staff2_user, staff2, staff3_user, staff3, p1, p2, p3, class_, subject])
    db.flush()

    # Grading Template: WW 40, PT 40, QA 20
    template = GradingTemplate(template_name="Science 40-40-20", academic_level_id=level.academic_level_id, subject_id=subject.subject_id, status="active")
    db.add(template)
    db.flush()
    db.add_all([
        GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Written Works", weight=Decimal("40"), display_order=1),
        GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Performance Tasks", weight=Decimal("40"), display_order=2),
        GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Quarterly Assessment", weight=Decimal("20"), display_order=3),
    ])
    subject.default_grading_template = str(template.grading_template_id)

    # Subject Loads:
    # Teacher 2 assigned to Term 1 only
    db.add(SubjectLoad(class_id=class_.class_id, subject_id=subject.subject_id, academic_period_id=p1.academic_period_id, staff_id=staff2.staff_id, is_active_version=True, status="active"))
    # Teacher 1 assigned to Term 2 and Term 3 (focal period assignment)
    db.add(SubjectLoad(class_id=class_.class_id, subject_id=subject.subject_id, academic_period_id=p2.academic_period_id, staff_id=staff1.staff_id, is_active_version=True, status="active"))
    db.add(SubjectLoad(class_id=class_.class_id, subject_id=subject.subject_id, academic_period_id=p3.academic_period_id, staff_id=staff1.staff_id, is_active_version=True, status="active"))

    # Initial Students (A, B, C)
    students = []
    for i, name in enumerate(["Alice", "Bob", "Charlie"], start=1):
        s = Student(student_id=uuid.uuid4(), student_lrn=f"40000000000{i}", first_name=name, last_name="Student", academic_level_id=level.academic_level_id)
        db.add(s)
        db.flush()
        db.add(StudentClass(student_id=s.student_id, class_id=class_.class_id, academic_year_id=year.academic_year_id, enrollment_status="enrolled"))
        students.append(s)

    # AI Models
    # NEXT Model v1
    next_schema_path = Path("data/models/entervene_next_period_grade_rf_feature_schema.json")
    next_schema = json.loads(next_schema_path.read_text(encoding="utf-8")) if next_schema_path.exists() else {"feature_columns": []}
    next_v1 = AIModelVersion(
        model_name=DEFAULT_MODEL_NAME,
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_next_period_grade_rf.joblib",
        feature_schema_json=next_schema,
        is_active=True,
    )

    # CURRENT Model v1
    curr_schema_path = Path("data/models/entervene_current_period_grade_rf_v1_feature_schema.json")
    curr_schema = json.loads(curr_schema_path.read_text(encoding="utf-8")) if curr_schema_path.exists() else {"feature_columns": []}
    curr_v1 = AIModelVersion(
        model_name=CURRENT_MODEL_NAME,
        model_type="REGRESSOR",
        model_purpose=CURRENT_MODEL_PURPOSE,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_current_period_grade_rf_v1.joblib",
        feature_schema_json=curr_schema,
        is_active=True,
    )
    db.add_all([next_v1, curr_v1])
    db.commit()

    active_user = {"sub": str(staff1_user.user_id), "role": "teacher", "staff_id": staff1.staff_id}
    app = FastAPI()
    app.include_router(predictions_router, prefix="/api/v1/predictions")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: active_user
    app.dependency_overrides[get_optional_staff_id] = lambda: active_user.get("staff_id")
    app.dependency_overrides[get_staff_id] = lambda: active_user.get("staff_id")

    client = TestClient(app, raise_server_exceptions=False)

    ctx = {
        "db": db,
        "engine": engine,
        "year": year,
        "level": level,
        "period1": p1,
        "period2": p2,
        "period3": p3,
        "class": class_,
        "subject": subject,
        "staff1": staff1,
        "staff2": staff2,
        "staff3": staff3,
        "students": students,
        "student_a": students[0],
        "student_b": students[1],
        "student_c": students[2],
        "next_v1": next_v1,
        "curr_v1": curr_v1,
        "curr_schema": curr_schema,
        "next_schema": next_schema,
        "client": client,
        "active_user": active_user,
    }
    yield ctx
    client.close()
    db.close()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def _add_activity_with_submission(ctx, *, category: str, score: float, period, student, total: float = 100):
    db = ctx["db"]
    cw = Classwork(
        title=f"{category} Quiz",
        classwork_type="QUIZ" if category == "WRITTEN_WORK" else ("EXAM" if category == "ASSESSMENT" else "ACTIVITY"),
        classwork_category=category,
        total_points=Decimal(str(total)),
        is_graded=True,
        is_published=True,
        is_archived=False,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=ctx["staff1"].staff_id,
    )
    db.add(cw)
    db.flush()
    assignment = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=period.academic_period_id,
        assigned_by_staff_id=ctx["staff1"].staff_id,
        is_published=True,
    )
    db.add(assignment)
    db.flush()
    sub = StudentSubmission(
        student_id=student.student_id,
        classwork_assignment_id=assignment.classwork_assignment_id,
        status="graded",
        grade=Decimal(str(score)),
        submitted_at=datetime(2026, 10, 1, 10, 0, tzinfo=timezone.utc),
        graded_at=datetime(2026, 10, 1, 11, 0, tzinfo=timezone.utc),
        graded_by_staff_id=ctx["staff1"].staff_id,
    )
    db.add(sub)
    db.commit()
    return assignment, cw, sub


# ---------------------------------------------------------------------------
# Requirement 1: Two-Phase Deterministic NEXT Selection Across Model Versions
# ---------------------------------------------------------------------------

def test_active_next_v2_rev1_preferred_over_historical_v1_rev5(roster_context):
    """
    Revision numbers are scoped by model_version_id, so never use global revision DESC across versions.
    Dual roster must select active v2 revision 1 over historical v1 revision 5.
    """
    c = roster_context
    db = c["db"]
    student = c["student_a"]
    p1 = c["period1"]
    p2 = c["period2"]

    # Historical NEXT v1 has revision 5
    hist_v1_pred = AIPrediction(
        student_id=student.student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=p1.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=c["next_v1"].model_version_id,
        revision=5,
        predicted_period_grade=Decimal("78.00"),
        risk_score=Decimal("45.0000"),
        risk_level="NEEDS_MONITORING",
        data_status="SUFFICIENT",
        risk_assessment_status=RISK_ASSESSMENT_EVALUATED,
        evidence_snapshot={"fingerprint": "hist_v1_hash"},
        generated_at=datetime(2026, 9, 1, 8, 0, tzinfo=timezone.utc),
    )
    db.add(hist_v1_pred)

    # NEXT v2 becomes active
    c["next_v1"].is_active = False
    next_v2 = AIModelVersion(
        model_name=DEFAULT_MODEL_NAME,
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_next_period_grade_rf_v2.joblib",
        feature_schema_json=c["next_schema"],
        is_active=True,
    )
    db.add(next_v2)
    db.flush()

    # NEXT v2 has revision 1
    active_v2_pred = AIPrediction(
        student_id=student.student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=p1.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=next_v2.model_version_id,
        revision=1,
        predicted_period_grade=Decimal("89.50"),
        risk_score=Decimal("15.0000"),
        risk_level="LOW_RISK",
        data_status="SUFFICIENT",
        risk_assessment_status=RISK_ASSESSMENT_EVALUATED,
        evidence_snapshot={"fingerprint": "active_v2_hash"},
        generated_at=datetime(2026, 9, 2, 8, 0, tzinfo=timezone.utc),
    )
    db.add(active_v2_pred)
    db.commit()

    # Query dual roster for Term 2
    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p2.academic_period_id,
        staff_id=c["staff1"].staff_id,
        is_admin=False,
    )

    item = next(it for it in res["students"] if str(it["student"]["student_id"]) == str(student.student_id))
    bf = item["baseline_forecast"]

    # Must select v2 rev 1, NOT v1 rev 5
    assert bf["latest_prediction_id"] == active_v2_pred.prediction_id
    assert bf["revision"] == 1
    assert bf["predicted_grade"] == 89.5
    assert bf["model_version"]["model_version_id"] == next_v2.model_version_id


def test_active_next_v2_with_no_prediction_falls_back_to_historical_v1(roster_context):
    """
    If active NEXT model has no prediction for the scope, deterministically falls back to
    the most recent historical prediction using (generated_at DESC, prediction_id DESC).
    """
    c = roster_context
    db = c["db"]
    student = c["student_a"]
    p1 = c["period1"]
    p2 = c["period2"]

    # Historical NEXT v1 prediction
    hist_pred = AIPrediction(
        student_id=student.student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=p1.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=c["next_v1"].model_version_id,
        revision=3,
        predicted_period_grade=Decimal("82.00"),
        risk_score=Decimal("25.0000"),
        risk_level="LOW_RISK",
        data_status="SUFFICIENT",
        risk_assessment_status=RISK_ASSESSMENT_EVALUATED,
        evidence_snapshot={"fingerprint": "hist_hash"},
        generated_at=datetime(2026, 9, 1, 8, 0, tzinfo=timezone.utc),
    )
    db.add(hist_pred)

    # Active NEXT v2 exists, but NO prediction was generated for student under v2
    c["next_v1"].is_active = False
    next_v2 = AIModelVersion(
        model_name=DEFAULT_MODEL_NAME,
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_next_period_grade_rf_v2.joblib",
        feature_schema_json=c["next_schema"],
        is_active=True,
    )
    db.add(next_v2)
    db.commit()

    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p2.academic_period_id,
        staff_id=c["staff1"].staff_id,
        is_admin=False,
    )

    item = next(it for it in res["students"] if str(it["student"]["student_id"]) == str(student.student_id))
    bf = item["baseline_forecast"]

    # Must fall back deterministically to historical v1
    assert bf["latest_prediction_id"] == hist_pred.prediction_id
    assert bf["revision"] == 3
    assert bf["predicted_grade"] == 82.0
    assert bf["model_version"]["model_version_id"] == c["next_v1"].model_version_id


def test_current_predictions_never_enter_next_selection(roster_context):
    """
    CURRENT predictions (source == target == Term 2, risk_assessment_status == NOT_EVALUATED)
    must NEVER be selected as NEXT baseline forecast.
    """
    c = roster_context
    db = c["db"]
    student = c["student_a"]
    p2 = c["period2"]

    # Only a CURRENT prediction exists for student in Term 2
    curr_pred = AIPrediction(
        student_id=student.student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=p2.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=c["curr_v1"].model_version_id,
        revision=1,
        predicted_period_grade=Decimal("75.00"),
        risk_score=None,
        risk_level=None,
        data_status=None,
        risk_assessment_status=RISK_ASSESSMENT_NOT_EVALUATED_CURRENT,
        evidence_snapshot={"fingerprint": "curr_hash"},
        generated_at=datetime(2026, 10, 1, 8, 0, tzinfo=timezone.utc),
    )
    db.add(curr_pred)
    db.commit()

    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p2.academic_period_id,
        staff_id=c["staff1"].staff_id,
        is_admin=False,
    )

    item = next(it for it in res["students"] if str(it["student"]["student_id"]) == str(student.student_id))
    bf = item["baseline_forecast"]

    # Baseline forecast must NOT have picked up curr_pred
    assert bf["latest_prediction_id"] is None
    assert bf["predicted_grade"] is None
    assert bf["status"] in {"AWAITING_OFFICIAL_SOURCE_GRADE", "READY_FOR_FORECAST"}


# ---------------------------------------------------------------------------
# Requirement 2: Preserving Persisted-Model Context During CURRENT Freshness
# ---------------------------------------------------------------------------

def test_batched_current_freshness_preserves_persisted_model_context(roster_context):
    """
    If selected prediction belongs to historical v1 while v2 is active, freshness must be evaluated
    in v1 context, never falsely comparing against a differing v2 schema.
    """
    c = roster_context
    db = c["db"]
    student = c["student_a"]
    p2 = c["period2"]

    # Add evidence for student
    _add_activity_with_submission(c, category="WRITTEN_WORK", score=85, period=p2, student=student)

    # Persist a prediction under CURRENT v1 with its snapshot
    v1_pred = AIPrediction(
        student_id=student.student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=p2.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=c["curr_v1"].model_version_id,
        revision=1,
        predicted_period_grade=Decimal("84.00"),
        risk_score=None,
        risk_level=None,
        data_status=None,
        risk_assessment_status=RISK_ASSESSMENT_NOT_EVALUATED_CURRENT,
        evidence_snapshot={
            "evidence_fingerprint": "persisted_v1_fingerprint",
            "feature_row": {"written_work_percent": 85.0},
        },
        generated_at=datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc),
    )
    db.add(v1_pred)

    # Now make CURRENT v2 active with a new distinct model name/version
    c["curr_v1"].is_active = False
    curr_v2 = AIModelVersion(
        model_name="entervene_current_period_grade_rf_v2",
        model_type="REGRESSOR",
        model_purpose=CURRENT_MODEL_PURPOSE,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_current_period_grade_rf_v2.joblib",
        feature_schema_json=c["curr_schema"],
        is_active=True,
    )
    db.add(curr_v2)
    db.commit()

    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p2.academic_period_id,
        staff_id=c["staff1"].staff_id,
        is_admin=False,
    )

    item = next(it for it in res["students"] if str(it["student"]["student_id"]) == str(student.student_id))
    cp = item["current_projection"]

    # Prediction selected is historical v1
    assert cp["latest_prediction_id"] == v1_pred.prediction_id
    assert cp["model_version"]["model_version_id"] == c["curr_v1"].model_version_id
    # Model currency correctly reports that an update (v2) is available
    assert cp["model_currency"]["status"] == "MODEL_UPDATE_AVAILABLE"
    assert cp["model_currency"]["persisted_model_version_id"] == c["curr_v1"].model_version_id
    assert cp["model_currency"]["active_model_version_id"] == curr_v2.model_version_id
    # Freshness evaluation succeeded without crash, comparing v1 context
    assert cp["projection_freshness"]["status"] in {"CURRENT", "SOURCE_EVIDENCE_CHANGED"}


def test_batched_current_freshness_returns_unavailable_when_historical_model_unresolvable(roster_context):
    """
    If the historical model/schema cannot be safely reconstructed, projection_freshness = FRESHNESS_UNAVAILABLE.
    """
    c = roster_context
    db = c["db"]
    student = c["student_a"]
    p2 = c["period2"]

    # Create unresolvable historical model
    unresolvable_model = AIModelVersion(
        model_name="nonexistent_historical_model",
        model_type="REGRESSOR",
        model_purpose=CURRENT_MODEL_PURPOSE,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/does_not_exist_xyz.joblib",
        feature_schema_json={"invalid": True},
        is_active=False,
    )
    db.add(unresolvable_model)
    db.flush()

    v_pred = AIPrediction(
        student_id=student.student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=p2.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=unresolvable_model.model_version_id,
        revision=1,
        predicted_period_grade=Decimal("80.00"),
        risk_score=None,
        risk_level=None,
        data_status=None,
        risk_assessment_status=RISK_ASSESSMENT_NOT_EVALUATED_CURRENT,
        evidence_snapshot={"fingerprint": "abc"},
        generated_at=datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc),
    )
    db.add(v_pred)
    db.commit()

    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p2.academic_period_id,
        staff_id=c["staff1"].staff_id,
        is_admin=False,
    )

    item = next(it for it in res["students"] if str(it["student"]["student_id"]) == str(student.student_id))
    cp = item["current_projection"]

    assert cp["projection_freshness"]["status"] == "FRESHNESS_UNAVAILABLE"


# ---------------------------------------------------------------------------
# Requirement 4: Focal-Period Teacher Authorization
# ---------------------------------------------------------------------------

def test_focal_period_teacher_authorization_can_view_incoming_baseline(roster_context):
    """
    Teacher assigned to Term 2 (focal period) can view incoming Term 1 -> Term 2 baseline
    without needing to have personally taught Term 1.
    """
    c = roster_context
    db = c["db"]
    student = c["student_a"]
    p1 = c["period1"]
    p2 = c["period2"]

    # Baseline Term 1 -> Term 2 created
    pred = AIPrediction(
        student_id=student.student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=p1.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=c["next_v1"].model_version_id,
        revision=1,
        predicted_period_grade=Decimal("88.00"),
        risk_score=Decimal("20.0000"),
        risk_level="LOW_RISK",
        data_status="SUFFICIENT",
        risk_assessment_status=RISK_ASSESSMENT_EVALUATED,
        evidence_snapshot={"fingerprint": "p1_to_p2"},
        generated_at=datetime(2026, 9, 1, 8, 0, tzinfo=timezone.utc),
    )
    db.add(pred)
    db.commit()

    # Teacher 1 (staff1) is assigned to Term 2, NOT Term 1!
    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p2.academic_period_id,
        staff_id=c["staff1"].staff_id,
        is_admin=False,
    )

    # Authorization succeeds and shows incoming baseline
    item = next(it for it in res["students"] if str(it["student"]["student_id"]) == str(student.student_id))
    assert item["baseline_forecast"]["predicted_grade"] == 88.0
    assert item["baseline_forecast"]["source_period_label"] == "Term 1"
    assert item["baseline_forecast"]["target_period_label"] == "Term 2"


def test_focal_period_teacher_authorization_rejects_unassigned_teacher(roster_context):
    """
    Unassigned teacher receives 403 / PermissionError on the new dual roster.
    """
    c = roster_context
    db = c["db"]
    p2 = c["period2"]

    # Teacher 3 (staff3) has no assignments
    with pytest.raises(PermissionError):
        get_dual_purpose_roster_status(
            db,
            class_id=c["class"].class_id,
            subject_id=c["subject"].subject_id,
            academic_period_id=p2.academic_period_id,
            staff_id=c["staff3"].staff_id,
            is_admin=False,
        )


# ---------------------------------------------------------------------------
# Requirement 3: HTTP Route Serialization & Dual Query Contracts
# ---------------------------------------------------------------------------

def test_http_route_serialization_legacy_and_dual_contracts(roster_context):
    """
    GET /predictions/status/roster accepts both contracts:
    - legacy request -> LegacyPredictionRosterResponse (roster_items)
    - academic_period_id request -> DualPurposeRosterResponse (roster, class_context, summary)
    - valid mixed-parameter new branch -> DualPurposeRosterResponse
    - conflicting mixed parameters -> 422
    - omitting both -> 422
    """
    c = roster_context
    client = c["client"]
    class_id = c["class"].class_id
    subject_id = c["subject"].subject_id
    p1_id = c["period1"].academic_period_id
    p2_id = c["period2"].academic_period_id
    p3_id = c["period3"].academic_period_id

    # 1. Legacy request: source_period_id and target_period_id
    # Note: staff2 was assigned to Term 1, or admin can query
    c["active_user"]["role"] = "admin"
    resp_legacy = client.get(
        "/api/v1/predictions/status/roster",
        params={"class_id": class_id, "subject_id": subject_id, "source_period_id": p1_id, "target_period_id": p2_id},
    )
    assert resp_legacy.status_code == 200, resp_legacy.text
    data_legacy = resp_legacy.json()
    assert "items" in data_legacy
    assert "total" in data_legacy

    # 2. Dual-purpose request: academic_period_id
    c["active_user"]["role"] = "teacher"
    c["active_user"]["staff_id"] = c["staff1"].staff_id
    resp_dual = client.get(
        "/api/v1/predictions/status/roster",
        params={"class_id": class_id, "subject_id": subject_id, "academic_period_id": p2_id},
    )
    assert resp_dual.status_code == 200, resp_dual.text
    data_dual = resp_dual.json()
    assert "class_context" in data_dual
    assert "students" in data_dual
    assert "roster" not in data_dual, "Response must not emit duplicate roster collection"
    assert "total" in data_dual
    assert isinstance(data_dual["students"], list)
    assert len(data_dual["students"]) == 3
    assert data_dual["class_context"]["academic_period_id"] == p2_id

    # 3. Valid mixed parameters: academic_period_id + target_period_id matching
    resp_mixed_target = client.get(
        "/api/v1/predictions/status/roster",
        params={
            "class_id": class_id,
            "subject_id": subject_id,
            "academic_period_id": p2_id,
            "target_period_id": p2_id,
        },
    )
    assert resp_mixed_target.status_code == 200
    assert "students" in resp_mixed_target.json()
    assert "roster" not in resp_mixed_target.json()

    # Valid mixed parameters: academic_period_id + source_period_id immediately preceding
    resp_mixed_source = client.get(
        "/api/v1/predictions/status/roster",
        params={
            "class_id": class_id,
            "subject_id": subject_id,
            "academic_period_id": p2_id,
            "source_period_id": p1_id,
        },
    )
    assert resp_mixed_source.status_code == 200
    assert "students" in resp_mixed_source.json()
    assert "roster" not in resp_mixed_source.json()

    # 4. Conflicting mixed parameters -> 422
    # target_period_id != academic_period_id
    resp_conflict_target = client.get(
        "/api/v1/predictions/status/roster",
        params={
            "class_id": class_id,
            "subject_id": subject_id,
            "academic_period_id": p2_id,
            "target_period_id": p3_id,
        },
    )
    assert resp_conflict_target.status_code == 422

    # source_period_id == academic_period_id (does not precede)
    resp_conflict_source = client.get(
        "/api/v1/predictions/status/roster",
        params={
            "class_id": class_id,
            "subject_id": subject_id,
            "academic_period_id": p2_id,
            "source_period_id": p2_id,
        },
    )
    assert resp_conflict_source.status_code == 422

    # 5. Omitting both academic_period_id and source_period_id -> 422
    resp_none = client.get(
        "/api/v1/predictions/status/roster",
        params={"class_id": class_id, "subject_id": subject_id},
    )
    assert resp_none.status_code == 422


# ---------------------------------------------------------------------------
# Requirement 5: Core Principles & Display Rules
# ---------------------------------------------------------------------------

def test_no_blending_independent_predictions(roster_context):
    """
    Predictions from different purposes are never mathematically blended or averaged.
    """
    c = roster_context
    db = c["db"]
    student = c["student_a"]
    p1 = c["period1"]
    p2 = c["period2"]

    # Incoming baseline = 88.00
    db.add(AIPrediction(
        student_id=student.student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=p1.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=c["next_v1"].model_version_id,
        revision=1,
        predicted_period_grade=Decimal("88.00"),
        risk_score=Decimal("20.0000"),
        risk_level="LOW_RISK",
        data_status="SUFFICIENT",
        risk_assessment_status=RISK_ASSESSMENT_EVALUATED,
        evidence_snapshot={"fingerprint": "base"},
        generated_at=datetime(2026, 9, 1, 8, 0, tzinfo=timezone.utc),
    ))

    # Current projection = 74.00
    db.add(AIPrediction(
        student_id=student.student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=p2.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=c["curr_v1"].model_version_id,
        revision=1,
        predicted_period_grade=Decimal("74.00"),
        risk_score=None,
        risk_level=None,
        data_status=None,
        risk_assessment_status=RISK_ASSESSMENT_NOT_EVALUATED_CURRENT,
        evidence_snapshot={"fingerprint": "curr"},
        generated_at=datetime(2026, 10, 1, 8, 0, tzinfo=timezone.utc),
    ))
    db.commit()

    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p2.academic_period_id,
        staff_id=c["staff1"].staff_id,
        is_admin=False,
    )

    item = next(it for it in res["students"] if str(it["student"]["student_id"]) == str(student.student_id))
    assert item["baseline_forecast"]["predicted_grade"] == 88.0
    assert item["current_projection"]["predicted_grade"] == 74.0
    # Primary display recommends CURRENT_PROJECTION per Rule A
    assert item["primary_display"] == "CURRENT_PROJECTION"


def test_primary_display_matrix(roster_context):
    """
    Verify all transitions of primary_display:
    - none -> NONE
    - baseline only -> BASELINE_FORECAST
    - current only -> CURRENT_PROJECTION
    - both -> CURRENT_PROJECTION
    - stale current -> CURRENT_PROJECTION
    """
    c = roster_context
    db = c["db"]
    s_none = c["student_a"]
    s_base = c["student_b"]
    s_curr = c["student_c"]
    p1 = c["period1"]
    p2 = c["period2"]

    # Baseline only for s_base
    db.add(AIPrediction(
        student_id=s_base.student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=p1.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=c["next_v1"].model_version_id,
        revision=1,
        predicted_period_grade=Decimal("80.00"),
        risk_score=Decimal("30.0000"),
        risk_level="NEEDS_MONITORING",
        data_status="SUFFICIENT",
        risk_assessment_status=RISK_ASSESSMENT_EVALUATED,
        evidence_snapshot={"fingerprint": "b"},
        generated_at=datetime(2026, 9, 1, 8, 0, tzinfo=timezone.utc),
    ))

    # Current only for s_curr
    db.add(AIPrediction(
        student_id=s_curr.student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=p2.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=c["curr_v1"].model_version_id,
        revision=1,
        predicted_period_grade=Decimal("85.00"),
        risk_score=None,
        risk_level=None,
        data_status=None,
        risk_assessment_status=RISK_ASSESSMENT_NOT_EVALUATED_CURRENT,
        evidence_snapshot={"fingerprint": "c"},
        generated_at=datetime(2026, 10, 1, 8, 0, tzinfo=timezone.utc),
    ))
    db.commit()

    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p2.academic_period_id,
        staff_id=c["staff1"].staff_id,
        is_admin=False,
    )

    items = {str(it["student"]["student_id"]): it for it in res["students"]}
    assert items[str(s_none.student_id)]["primary_display"] == "NONE"
    assert items[str(s_base.student_id)]["primary_display"] == "BASELINE_FORECAST"
    assert items[str(s_curr.student_id)]["primary_display"] == "CURRENT_PROJECTION"


def test_term_1_behavior_no_previous_period(roster_context):
    """
    Term 1 has no previous period baseline (status = NO_PREVIOUS_PERIOD).
    Current projection evaluates Term 1 evidence normally.
    """
    c = roster_context
    db = c["db"]
    p1 = c["period1"]

    # Assign staff2 to Term 1
    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p1.academic_period_id,
        staff_id=c["staff2"].staff_id,
        is_admin=False,
    )

    for item in res["students"]:
        assert item["baseline_forecast"]["status"] == "NO_PREVIOUS_PERIOD"
        assert item["baseline_forecast"]["message"] == "No previous period baseline is available for Term 1."
        assert item["baseline_forecast"]["predicted_grade"] is None


def test_final_term_preserves_incoming_baseline_and_no_next_period(roster_context):
    """
    Term 3 (final term): incoming baseline (Term 2 -> Term 3) is preserved intact.
    next_period_status = 'NO_NEXT_PERIOD'.
    """
    c = roster_context
    db = c["db"]
    student = c["student_a"]
    p2 = c["period2"]
    p3 = c["period3"]

    # Add incoming baseline Term 2 -> Term 3
    db.add(AIPrediction(
        student_id=student.student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=p2.academic_period_id,
        target_period_id=p3.academic_period_id,
        model_version_id=c["next_v1"].model_version_id,
        revision=1,
        predicted_period_grade=Decimal("91.00"),
        risk_score=Decimal("12.0000"),
        risk_level="LOW_RISK",
        data_status="SUFFICIENT",
        risk_assessment_status=RISK_ASSESSMENT_EVALUATED,
        evidence_snapshot={"fingerprint": "p2_to_p3"},
        generated_at=datetime(2026, 12, 1, 8, 0, tzinfo=timezone.utc),
    ))
    db.commit()

    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p3.academic_period_id,
        staff_id=c["staff1"].staff_id,
        is_admin=False,
    )

    assert res["class_context"]["next_period_status"] == "NO_NEXT_PERIOD"
    item = next(it for it in res["students"] if str(it["student"]["student_id"]) == str(student.student_id))
    assert item["baseline_forecast"]["predicted_grade"] == 91.0
    assert item["baseline_forecast"]["source_period_label"] == "Term 2"
    assert item["baseline_forecast"]["target_period_label"] == "Term 3"


def test_period_outcome_separate_and_finalized_behavior(roster_context):
    """
    Official finalization is reported in period_outcome without overwriting predictions.
    When finalized, refresh_eligibility.status = 'FINALIZED'.
    """
    c = roster_context
    db = c["db"]
    student = c["student_a"]
    p2 = c["period2"]

    # Student has a finalized grade in Term 2
    grade = StudentPeriodGrade(
        student_id=student.student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p2.academic_period_id,
        final_period_grade=Decimal("92.50"),
        is_finalized=True,
    )
    db.add(grade)

    # Student has a CURRENT prediction with predicted grade 86.00
    pred = AIPrediction(
        student_id=student.student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=p2.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=c["curr_v1"].model_version_id,
        revision=1,
        predicted_period_grade=Decimal("86.00"),
        risk_score=None,
        risk_level=None,
        data_status=None,
        risk_assessment_status=RISK_ASSESSMENT_NOT_EVALUATED_CURRENT,
        evidence_snapshot={"fingerprint": "p2"},
        generated_at=datetime(2026, 10, 1, 8, 0, tzinfo=timezone.utc),
    )
    db.add(pred)
    db.commit()

    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p2.academic_period_id,
        staff_id=c["staff1"].staff_id,
        is_admin=False,
    )

    item = next(it for it in res["students"] if str(it["student"]["student_id"]) == str(student.student_id))
    # Period outcome is finalized with actual grade 92.5
    assert item["period_outcome"]["status"] == "FINALIZED"
    assert item["period_outcome"]["actual_grade"] == 92.5
    # Prediction grade is NOT overwritten
    assert item["current_projection"]["predicted_grade"] == 86.0
    # Refresh eligibility reports FINALIZED
    assert item["current_projection"]["refresh_eligibility"]["status"] == "FINALIZED"


def test_no_active_current_model(roster_context):
    """
    When no active CURRENT model exists, historical prediction remains readable,
    and model_currency = MODEL_UNAVAILABLE.
    """
    c = roster_context
    db = c["db"]
    student = c["student_a"]
    p2 = c["period2"]

    # Deactivate current model
    c["curr_v1"].is_active = False
    pred = AIPrediction(
        student_id=student.student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=p2.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=c["curr_v1"].model_version_id,
        revision=1,
        predicted_period_grade=Decimal("80.00"),
        risk_score=None,
        risk_level=None,
        data_status=None,
        risk_assessment_status=RISK_ASSESSMENT_NOT_EVALUATED_CURRENT,
        evidence_snapshot={"fingerprint": "p2"},
        generated_at=datetime(2026, 10, 1, 8, 0, tzinfo=timezone.utc),
    )
    db.add(pred)
    db.commit()

    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p2.academic_period_id,
        staff_id=c["staff1"].staff_id,
        is_admin=False,
    )

    item = next(it for it in res["students"] if str(it["student"]["student_id"]) == str(student.student_id))
    assert item["current_projection"]["predicted_grade"] == 80.0
    assert item["current_projection"]["model_currency"]["status"] == "MODEL_UNAVAILABLE"


def test_read_only_guarantee(roster_context):
    """
    Roster read executes 0 writes: 0 predictions created, 0 ledger rows created.
    """
    c = roster_context
    db = c["db"]
    p2 = c["period2"]

    before_preds = db.query(AIPrediction).count()
    before_reqs = db.query(PredictionGenerationRequest).count()

    get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p2.academic_period_id,
        staff_id=c["staff1"].staff_id,
        is_admin=False,
    )

    assert db.query(AIPrediction).count() == before_preds
    assert db.query(PredictionGenerationRequest).count() == before_reqs


# ---------------------------------------------------------------------------
# Requirement 5: Query Count Scaling Tests (5, 20, 40 students)
# ---------------------------------------------------------------------------

def test_query_count_scaling_5_20_40_students(roster_context):
    """
    Verify database query counts remain bounded and do not grow linearly with student count (O(1) bulk queries).
    """
    c = roster_context
    db = c["db"]
    engine = c["engine"]
    p2 = c["period2"]
    class_id = c["class"].class_id
    subject_id = c["subject"].subject_id
    year_id = c["year"].academic_year_id
    level_id = c["level"].academic_level_id

    def measure_queries():
        query_statements = []
        def listener(conn, cursor, statement, parameters, context, executemany):
            # Ignore savepoints / transactions / pragma if any
            clean = statement.strip().upper()
            if not clean.startswith(("PRAGMA", "SAVEPOINT", "RELEASE")):
                query_statements.append(statement)

        event.listen(engine, "before_cursor_execute", listener)
        try:
            get_dual_purpose_roster_status(
                db,
                class_id=class_id,
                subject_id=subject_id,
                academic_period_id=p2.academic_period_id,
                staff_id=c["staff1"].staff_id,
                is_admin=False,
            )
        finally:
            event.remove(engine, "before_cursor_execute", listener)
        return len(query_statements)

    # 1. Measure for 5 students
    # Add 2 more to reach 5
    for i in range(4, 6):
        st = Student(student_id=uuid.uuid4(), student_lrn=f"5{i:011d}", first_name=f"S{i}", last_name="Student", academic_level_id=level_id)
        db.add(st)
        db.flush()
        db.add(StudentClass(student_id=st.student_id, class_id=class_id, academic_year_id=year_id, enrollment_status="enrolled"))
    db.commit()

    q_5 = measure_queries()

    # 2. Add 15 more to reach 20 students
    for i in range(6, 21):
        st = Student(student_id=uuid.uuid4(), student_lrn=f"5{i:011d}", first_name=f"S{i}", last_name="Student", academic_level_id=level_id)
        db.add(st)
        db.flush()
        db.add(StudentClass(student_id=st.student_id, class_id=class_id, academic_year_id=year_id, enrollment_status="enrolled"))
    db.commit()

    q_20 = measure_queries()

    # 3. Add 20 more to reach 40 students
    for i in range(21, 41):
        st = Student(student_id=uuid.uuid4(), student_lrn=f"5{i:011d}", first_name=f"S{i}", last_name="Student", academic_level_id=level_id)
        db.add(st)
        db.flush()
        db.add(StudentClass(student_id=st.student_id, class_id=class_id, academic_year_id=year_id, enrollment_status="enrolled"))
    db.commit()

    q_40 = measure_queries()

    # Print measured query counts for verification
    print(f"\nMeasured query counts: 5 students = {q_5}, 20 students = {q_20}, 40 students = {q_40}")

    # Scaling invariant: Query count must NOT scale linearly (e.g. 40 * queries per student).
    # It must be bounded bulk queries: difference between 5 and 40 students should be near 0 (same number of bulk round-trips).
    assert q_40 <= q_5 + 2, f"Queries scaled with student count: q_5={q_5}, q_40={q_40}"
    assert q_20 <= q_5 + 2, f"Queries scaled with student count: q_5={q_5}, q_20={q_20}"


# ---------------------------------------------------------------------------
# Correctness Checks (Task 6C Final Requirements)
# ---------------------------------------------------------------------------

def test_prebuilt_evidence_not_reused_when_same_model_name_but_different_version_identity(roster_context):
    """
    Requirement 1 Regression Test:
    - CURRENT v1 prediction exists;
    - CURRENT v2 is active;
    - v1 and v2 intentionally use the SAME model_name but DIFFERENT schema/version identity;
    - roster must not reuse v2 prebuilt evidence for v1 freshness.
    If v1 historical context cannot be safely reconstructed, freshness returns FRESHNESS_UNAVAILABLE.
    """
    c = roster_context
    db = c["db"]
    student = c["student_a"]
    p2 = c["period2"]

    # Student has an activity in Term 2
    _add_activity_with_submission(c, category="WRITTEN_WORK", score=85, period=p2, student=student)

    # v1 prediction persisted with specific snapshot and version id
    v1_pred = AIPrediction(
        student_id=student.student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=p2.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=c["curr_v1"].model_version_id,
        revision=1,
        predicted_period_grade=Decimal("84.00"),
        risk_score=None,
        risk_level=None,
        data_status=None,
        risk_assessment_status=RISK_ASSESSMENT_NOT_EVALUATED_CURRENT,
        evidence_snapshot={
            "snapshot_version": "prediction-evidence-v3-current-period",
            "evidence_contract_version": "stage6b-current-period-v1",
            "model": {
                "model_version_id": c["curr_v1"].model_version_id,
                "model_name": c["curr_v1"].model_name,
                "schema_sha256": "v1_specific_schema_sha256",
            },
            "evidence_fingerprint": "persisted_v1_fp",
        },
        generated_at=datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc),
    )
    db.add(v1_pred)

    # Now make CURRENT v2 active with the EXACT SAME model_name as v1,
    # but a DIFFERENT model_version_id and different schema/version identity.
    c["curr_v1"].is_active = False
    curr_v2 = AIModelVersion(
        model_name=c["curr_v1"].model_name,  # INTENTIONALLY THE SAME model_name!
        model_type="REGRESSOR",
        model_purpose=CURRENT_MODEL_PURPOSE,
        algorithm="RandomForestRegressor",
        artifact_path=c["curr_v1"].artifact_path,
        feature_schema_json=c["curr_schema"],
        is_active=True,
    )
    db.add(curr_v2)
    db.commit()

    assert curr_v2.model_name == c["curr_v1"].model_name
    assert curr_v2.model_version_id != c["curr_v1"].model_version_id

    # Make v1 historical schema unresolvable so that when roster attempts to rebuild using v1 context,
    # it safely fails closed to FRESHNESS_UNAVAILABLE.
    # If the roster had incorrectly reused v2 prebuilt evidence (due to matching model_name),
    # it would have computed freshness as CURRENT or SOURCE_EVIDENCE_CHANGED instead!
    c["curr_v1"].feature_schema_json = None
    c["curr_v1"].artifact_path = "nonexistent_v1_path.joblib"
    db.commit()

    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p2.academic_period_id,
        staff_id=c["staff1"].staff_id,
        is_admin=False,
    )

    item = next(it for it in res["students"] if str(it["student"]["student_id"]) == str(student.student_id))
    cp = item["current_projection"]

    # Evaluated target is historical v1
    assert cp["latest_prediction_id"] == v1_pred.prediction_id
    assert cp["model_currency"]["status"] == "MODEL_UPDATE_AVAILABLE"
    assert cp["model_currency"]["persisted_model_version_id"] == c["curr_v1"].model_version_id
    assert cp["model_currency"]["active_model_version_id"] == curr_v2.model_version_id

    # Proves v2 prebuilt evidence was NOT reused for v1:
    # Because v2 evidence contract did not match persisted v1 context, and v1 context
    # could not be reconstructed, projection_freshness MUST be FRESHNESS_UNAVAILABLE.
    assert cp["projection_freshness"]["status"] == "FRESHNESS_UNAVAILABLE"


def test_prediction_family_filtering_uses_model_purpose_not_risk_status(roster_context):
    """
    Requirement 2 Regression Test:
    NEXT/CURRENT classification must never depend on risk_assessment_status as the authoritative discriminator.
    - CURRENT prediction with risk_assessment_status changed to EVALUATED still cannot enter NEXT selection;
    - NEXT prediction with unusual/null risk metadata remains NEXT based on model purpose.
    """
    c = roster_context
    db = c["db"]
    student_a = c["student_a"]
    student_b = c["student_b"]
    p1 = c["period1"]
    p2 = c["period2"]

    # Student A: CURRENT prediction with risk_assessment_status changed to EVALUATED
    curr_tampered = AIPrediction(
        student_id=student_a.student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=p1.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=c["curr_v1"].model_version_id,
        revision=1,
        predicted_period_grade=Decimal("79.00"),
        risk_score=Decimal("45.0000"),
        risk_level="HIGH_RISK",
        data_status="SUFFICIENT",
        risk_assessment_status=RISK_ASSESSMENT_EVALUATED,  # Intentionally EVALUATED!
        evidence_snapshot={"fingerprint": "curr_tampered"},
        generated_at=datetime(2026, 9, 15, 8, 0, tzinfo=timezone.utc),
    )
    db.add(curr_tampered)

    # Student B: NEXT prediction with null / unusual risk metadata
    # Student B: NEXT prediction with unusual risk metadata
    next_unusual = AIPrediction(
        student_id=student_b.student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=p1.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=c["next_v1"].model_version_id,
        revision=1,
        predicted_period_grade=Decimal("88.00"),
        risk_score=None,
        risk_level=None,
        data_status=None,
        risk_assessment_status="UNUSUAL_CUSTOM_STATUS",  # Unusual status!
        evidence_snapshot={"fingerprint": "next_unusual"},
        generated_at=datetime(2026, 9, 15, 8, 0, tzinfo=timezone.utc),
    )
    db.add(next_unusual)

    # Student C: NEXT prediction with null risk metadata
    student_c = c["student_c"]
    next_null_risk = AIPrediction(
        student_id=student_c.student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=p1.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=c["next_v1"].model_version_id,
        revision=1,
        predicted_period_grade=Decimal("92.00"),
        risk_score=None,
        risk_level=None,
        data_status=None,
        risk_assessment_status=None,  # Null status!
        evidence_snapshot={"fingerprint": "next_null"},
        generated_at=datetime(2026, 9, 15, 8, 0, tzinfo=timezone.utc),
    )
    db.add(next_null_risk)
    db.commit()

    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p2.academic_period_id,
        staff_id=c["staff1"].staff_id,
        is_admin=False,
    )

    items = {str(it["student"]["student_id"]): it for it in res["students"]}

    # Student A: Despite risk_assessment_status == EVALUATED, purpose is CURRENT,
    # so it CANNOT enter NEXT baseline_forecast!
    assert items[str(student_a.student_id)]["baseline_forecast"]["latest_prediction_id"] is None
    assert items[str(student_a.student_id)]["baseline_forecast"]["predicted_grade"] is None

    # Student B: Despite unusual risk status, purpose is NEXT_PERIOD_BASELINE_FORECAST,
    # so it correctly enters NEXT baseline_forecast!
    assert items[str(student_b.student_id)]["baseline_forecast"]["latest_prediction_id"] == next_unusual.prediction_id
    assert items[str(student_b.student_id)]["baseline_forecast"]["predicted_grade"] == 88.0
    assert items[str(student_b.student_id)]["baseline_forecast"]["risk_assessment_status"] == "UNUSUAL_CUSTOM_STATUS"

    # Student C: Despite null risk status, purpose is NEXT_PERIOD_BASELINE_FORECAST,
    # so it correctly enters NEXT baseline_forecast!
    assert items[str(student_c.student_id)]["baseline_forecast"]["latest_prediction_id"] == next_null_risk.prediction_id
    assert items[str(student_c.student_id)]["baseline_forecast"]["predicted_grade"] == 92.0
    assert items[str(student_c.student_id)]["baseline_forecast"]["risk_assessment_status"] is None
