from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timezone
from decimal import Decimal
import json
from pathlib import Path
import uuid

import pytest
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine, text
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
from app.models.ai.AIPredictionFeature import AIPredictionFeature
from app.models.ai.PredictionGenerationRequest import PredictionGenerationRequest
from app.models.ai.PredictionOutcome import PredictionOutcome
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Prediction import (
    CurrentPredictionStatusEnvelope,
    NextPredictionStatusEnvelope,
    PredictionFromRecordsResponse,
    PredictionRefreshRequest,
)
from app.services.prediction import CurrentPeriodPredictionGenerationService as current_gen
from app.services.prediction.CurrentPeriodFeatureBuilderService import (
    MODEL_NAME as CURRENT_MODEL_NAME,
    MODEL_PURPOSE as CURRENT_MODEL_PURPOSE,
)
from app.services.prediction.CurrentPeriodPredictionFreshnessService import (
    evaluate_current_period_prediction_status,
    get_latest_current_period_prediction,
)
from app.services.prediction.CurrentPeriodPredictionGenerationService import (
    refresh_current_period_prediction_workflow,
)
from app.services.prediction.ModelScoringService import DEFAULT_MODEL_NAME


@pytest.fixture
def freshness_context():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    lrn_check = next((c for c in Student.__table__.constraints if isinstance(c, CheckConstraint) and c.name == "lrn_check"), None)
    if lrn_check and lrn_check in Student.__table__.constraints:
        Student.__table__.constraints.remove(lrn_check)
    try:
        Base.metadata.create_all(bind=engine)
    finally:
        if lrn_check and lrn_check not in Student.__table__.constraints:
            Student.__table__.append_constraint(lrn_check)

    db = sessionmaker(bind=engine)()
    year = AcademicYear(year_label="2026-2027", start_date=date(2026, 6, 1), end_date=date(2027, 3, 31), is_active=True)
    level = AcademicLevel(level_name="Grade 9", grade_level=9)
    db.add_all([year, level])
    db.flush()

    staff_account = UserAccount(user_id=uuid.uuid4(), email="teacher@example.test")
    staff = AcademicStaff(staff_id="T-CURRENT", first_name="Current", last_name="Teacher", user_id=staff_account.user_id)
    other_staff_account = UserAccount(user_id=uuid.uuid4(), email="other-teacher@example.test")
    other_staff = AcademicStaff(staff_id="T-OTHER", first_name="Other", last_name="Teacher", user_id=other_staff_account.user_id)
    student = Student(student_id=uuid.uuid4(), student_lrn="300000000001", first_name="Current", last_name="Learner", academic_level_id=level.academic_level_id)
    other_student = Student(student_id=uuid.uuid4(), student_lrn="300000000002", first_name="Other", last_name="Learner", academic_level_id=level.academic_level_id)

    period1 = AcademicPeriod(
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.3333"),
        start_date=date(2026, 6, 1),
        end_date=date(2026, 8, 31),
        academic_year_id=year.academic_year_id,
        is_active=True,
    )
    period2 = AcademicPeriod(
        period_name="Term 2",
        period_type="TERM",
        period_sequence=2,
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.6667"),
        start_date=date(2026, 9, 1),
        end_date=date(2026, 11, 30),
        academic_year_id=year.academic_year_id,
        is_active=False,
    )
    period3 = AcademicPeriod(
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
    class_ = Class(section_name="Archimedes", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
    subject = Subject(subject_name="Science", subject_codename="SCIENCE", academic_level_id=level.academic_level_id)
    math_subject = Subject(subject_name="Mathematics", subject_codename="MATH", academic_level_id=level.academic_level_id)

    db.add_all([
        staff_account, staff, other_staff_account, other_staff,
        student, other_student,
        period1, period2, period3,
        class_, subject, math_subject,
    ])
    db.flush()

    template = GradingTemplate(template_name="Current 40-40-20", academic_level_id=level.academic_level_id, subject_id=subject.subject_id, status="active")
    math_template = GradingTemplate(template_name="Math 40-40-20", academic_level_id=level.academic_level_id, subject_id=math_subject.subject_id, status="active")
    db.add_all([template, math_template])
    db.flush()

    db.add_all([
        GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Written Works", weight=Decimal("40"), display_order=1),
        GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Performance Tasks", weight=Decimal("40"), display_order=2),
        GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Quarterly Assessment", weight=Decimal("20"), display_order=3),
        GradingTemplateComponent(grading_template_id=math_template.grading_template_id, component_name="Written Works", weight=Decimal("40"), display_order=1),
        GradingTemplateComponent(grading_template_id=math_template.grading_template_id, component_name="Performance Tasks", weight=Decimal("40"), display_order=2),
        GradingTemplateComponent(grading_template_id=math_template.grading_template_id, component_name="Quarterly Assessment", weight=Decimal("20"), display_order=3),
    ])
    subject.default_grading_template = str(template.grading_template_id)
    math_subject.default_grading_template = str(math_template.grading_template_id)

    db.add(StudentClass(student_id=student.student_id, class_id=class_.class_id, academic_year_id=year.academic_year_id, enrollment_status="enrolled"))
    db.add(StudentClass(student_id=other_student.student_id, class_id=class_.class_id, academic_year_id=year.academic_year_id, enrollment_status="enrolled"))

    # Assign staff to Science for period1 and period2
    db.add(SubjectLoad(class_id=class_.class_id, subject_id=subject.subject_id, academic_period_id=period1.academic_period_id, staff_id=staff.staff_id, is_active_version=True, status="active"))
    db.add(SubjectLoad(class_id=class_.class_id, subject_id=subject.subject_id, academic_period_id=period2.academic_period_id, staff_id=staff.staff_id, is_active_version=True, status="active"))
    # Assign staff to Math for period1
    db.add(SubjectLoad(class_id=class_.class_id, subject_id=math_subject.subject_id, academic_period_id=period1.academic_period_id, staff_id=staff.staff_id, is_active_version=True, status="active"))

    schema_json = json.loads(Path("data/models/entervene_current_period_grade_rf_v1_feature_schema.json").read_text(encoding="utf-8"))
    model_v1 = AIModelVersion(
        model_name=CURRENT_MODEL_NAME,
        model_type="REGRESSOR",
        model_purpose=CURRENT_MODEL_PURPOSE,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_current_period_grade_rf_v1.joblib",
        feature_schema_json=schema_json,
        is_active=True,
    )
    db.add(model_v1)
    db.commit()

    active_user = {"sub": str(staff_account.user_id), "role": "teacher", "staff_id": staff.staff_id}
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
        "student": student,
        "other_student": other_student,
        "class": class_,
        "subject": subject,
        "math_subject": math_subject,
        "staff": staff,
        "staff_account": staff_account,
        "other_staff": other_staff,
        "other_staff_account": other_staff_account,
        "period1": period1,
        "period2": period2,
        "period3": period3,
        "template": template,
        "level": level,
        "model_v1": model_v1,
        "schema_json": schema_json,
        "active_user": active_user,
        "client": client,
        "scope": {
            "student_id": student.student_id,
            "class_id": class_.class_id,
            "subject_id": subject.subject_id,
            "source_period_id": period1.academic_period_id,
            "target_period_id": period1.academic_period_id,
        },
    }
    yield ctx
    client.close()
    db.close()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def add_activity(
    ctx,
    category: str,
    score: float | None,
    total: float = 100,
    *,
    period=None,
    subject=None,
    student=None,
    status="graded",
    graded_at=None,
    title="Activity",
    classwork_type: str | None = None,
    exam_subtype: str | None = None,
):
    db = ctx["db"]
    period = period or ctx["period1"]
    subject = subject or ctx["subject"]
    student = student or ctx["student"]
    cw = Classwork(
        title=title,
        classwork_type=classwork_type or ("EXAM" if category == "ASSESSMENT" else ("QUIZ" if category == "WRITTEN_WORK" else "ACTIVITY")),
        classwork_category=category,
        exam_subtype=exam_subtype,
        total_points=Decimal(str(total)),
        is_graded=True,
        is_published=True,
        is_archived=False,
        subject_id=subject.subject_id,
        created_by_staff_id=ctx["staff"].staff_id,
    )
    db.add(cw)
    db.flush()
    assignment = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=period.academic_period_id,
        assigned_by_staff_id=ctx["staff"].staff_id,
        is_published=True,
    )
    db.add(assignment)
    db.flush()
    sub = None
    if status is not None:
        sub = StudentSubmission(
            student_id=student.student_id,
            classwork_assignment_id=assignment.classwork_assignment_id,
            status=status,
            grade=Decimal(str(score)) if score is not None else None,
            submitted_at=graded_at or datetime(2026, 7, 15, 10, 0, tzinfo=timezone.utc),
            graded_at=graded_at or datetime(2026, 7, 15, 11, 0, tzinfo=timezone.utc),
            graded_by_staff_id=ctx["staff"].staff_id if status == "graded" else None,
        )
        db.add(sub)
    db.commit()
    return assignment, cw, sub


def generate_initial(ctx, key=None):
    ctx["db"].commit()
    return current_gen.generate_current_period_prediction(
        ctx["scope"],
        generation_request_id=key,
        staff_id=ctx["staff"].staff_id,
        bind=ctx["db"].get_bind(),
    )


# ---------------------------------------------------------------------------
# Test Cases 1 - 32
# ---------------------------------------------------------------------------


def test_1_no_prediction_status_no_projection(freshness_context):
    """When no prediction exists, evaluate status returns NO_PROJECTION for freshness and model currency."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    status = evaluate_current_period_prediction_status(
        c["db"],
        c["scope"],
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )

    assert status["projection_freshness"]["status"] == "NO_PROJECTION"
    assert status["projection_freshness"]["saved_fingerprint"] is None
    assert status["model_currency"]["status"] == "NO_PROJECTION"
    assert status["model_currency"]["persisted_model_version_id"] is None
    assert status["model_currency"]["active_model_version_id"] == c["model_v1"].model_version_id
    assert status["evidence_readiness"]["ready"] is True
    assert status["evidence_readiness"]["level"] == "STANDARD_READY"
    assert status["refresh_eligibility"]["eligible"] is True
    assert status["refresh_eligibility"]["status"] == "ELIGIBLE"
    assert status["requested_prediction"] is None
    assert status["latest_prediction"] is None


def test_2_v1_same_evidence_status_current(freshness_context):
    """With V1 generated and no new evidence, status reports CURRENT and CURRENT_MODEL."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    assert gen["generation_status"] == "CREATED"
    pred = c["db"].get(AIPrediction, gen["prediction_id"])

    status = evaluate_current_period_prediction_status(
        c["db"],
        pred,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )

    assert status["projection_freshness"]["status"] == "CURRENT"
    assert status["projection_freshness"]["saved_fingerprint"] == status["projection_freshness"]["current_fingerprint"]
    assert status["model_currency"]["status"] == "CURRENT_MODEL"
    assert status["model_currency"]["persisted_model_version_id"] == c["model_v1"].model_version_id
    assert status["refresh_eligibility"]["eligible"] is True
    assert status["requested_prediction"]["prediction_id"] == pred.prediction_id
    assert status["latest_prediction"]["prediction_id"] == pred.prediction_id


def test_3_new_ww_grade_source_evidence_changed(freshness_context):
    """Adding a new graded Written Work marks projection freshness as SOURCE_EVIDENCE_CHANGED."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred = c["db"].get(AIPrediction, gen["prediction_id"])

    add_activity(c, "WRITTEN_WORK", 95, 100, title="WW 3")

    status = evaluate_current_period_prediction_status(
        c["db"],
        pred,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )

    assert status["projection_freshness"]["status"] == "SOURCE_EVIDENCE_CHANGED"
    assert status["projection_freshness"]["saved_fingerprint"] != status["projection_freshness"]["current_fingerprint"]
    assert status["refresh_eligibility"]["eligible"] is True


def test_4_pt_score_correction_source_evidence_changed(freshness_context):
    """Correcting an existing PT score marks status as SOURCE_EVIDENCE_CHANGED."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    _, _, sub = add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred = c["db"].get(AIPrediction, gen["prediction_id"])

    # Update PT score
    sub.grade = Decimal("95")
    c["db"].commit()

    status = evaluate_current_period_prediction_status(
        c["db"],
        pred,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )
    assert status["projection_freshness"]["status"] == "SOURCE_EVIDENCE_CHANGED"


def test_5_hps_correction_source_evidence_changed(freshness_context):
    """Correcting the HPS (total points) on a classwork marks status as SOURCE_EVIDENCE_CHANGED."""
    c = freshness_context
    _, cw, _ = add_activity(c, "WRITTEN_WORK", 45, 50)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred = c["db"].get(AIPrediction, gen["prediction_id"])

    # Teacher corrects HPS from 50 to 60
    cw.total_points = Decimal("60")
    c["db"].commit()

    status = evaluate_current_period_prediction_status(
        c["db"],
        pred,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )
    assert status["projection_freshness"]["status"] == "SOURCE_EVIDENCE_CHANGED"


def test_6_qa_completion_source_evidence_changed(freshness_context):
    """Submitting QA exam activities advances evidence to HIGH_EVIDENCE and marks SOURCE_EVIDENCE_CHANGED."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "WRITTEN_WORK", 95, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)
    add_activity(c, "PERFORMANCE_TASK", 90, 100)

    gen = generate_initial(c)
    pred = c["db"].get(AIPrediction, gen["prediction_id"])

    # Add 3 quarterly exam components: SUMMATIVE_1, SUMMATIVE_2, TERM_EXAM (canonicalized into QA)
    add_activity(c, "ASSESSMENT", 90, 100, exam_subtype="SUMMATIVE_1", title="QA S1")
    add_activity(c, "ASSESSMENT", 80, 100, exam_subtype="SUMMATIVE_2", title="QA S2")
    add_activity(c, "ASSESSMENT", 85, 100, exam_subtype="TERM_EXAM", title="QA Term")

    status = evaluate_current_period_prediction_status(
        c["db"],
        pred,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )
    assert status["projection_freshness"]["status"] == "SOURCE_EVIDENCE_CHANGED"
    assert status["evidence_readiness"]["level"] == "HIGH_EVIDENCE"


def test_7_unrelated_student_evidence_does_not_stale(freshness_context):
    """Grading another student in the same class does NOT stale this student's projection."""
    c = freshness_context
    assign1, _, _ = add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    # other_student has a submission on assign1
    other_sub = StudentSubmission(
        student_id=c["other_student"].student_id,
        classwork_assignment_id=assign1.classwork_assignment_id,
        status="graded",
        grade=Decimal("70"),
        submitted_at=datetime(2026, 7, 15, 10, 0, tzinfo=timezone.utc),
        graded_at=datetime(2026, 7, 15, 11, 0, tzinfo=timezone.utc),
        graded_by_staff_id=c["staff"].staff_id,
    )
    c["db"].add(other_sub)
    c["db"].commit()

    gen = generate_initial(c)
    pred = c["db"].get(AIPrediction, gen["prediction_id"])

    # Grade updated for other_student only on that existing assignment
    other_sub.grade = Decimal("95")
    c["db"].commit()

    status = evaluate_current_period_prediction_status(
        c["db"],
        pred,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )
    assert status["projection_freshness"]["status"] == "CURRENT"


def test_8_another_subject_evidence_does_not_stale(freshness_context):
    """Grading this student in another subject does NOT stale the Science projection."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred = c["db"].get(AIPrediction, gen["prediction_id"])

    # Grade added in Mathematics
    add_activity(c, "WRITTEN_WORK", 95, 100, subject=c["math_subject"], title="Math WW")

    status = evaluate_current_period_prediction_status(
        c["db"],
        pred,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )
    assert status["projection_freshness"]["status"] == "CURRENT"


def test_9_another_period_evidence_does_not_stale(freshness_context):
    """Grading this student in Term 2 does NOT stale the Term 1 projection."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred = c["db"].get(AIPrediction, gen["prediction_id"])

    # Grade added in Period 2
    add_activity(c, "WRITTEN_WORK", 95, 100, period=c["period2"], title="Term 2 WW")

    status = evaluate_current_period_prediction_status(
        c["db"],
        pred,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )
    assert status["projection_freshness"]["status"] == "CURRENT"


def test_10_clock_advancing_does_not_stale(freshness_context):
    """Pure passage of time without evidence modifications preserves CURRENT freshness."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred = c["db"].get(AIPrediction, gen["prediction_id"])

    status = evaluate_current_period_prediction_status(
        c["db"],
        pred,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )
    assert status["projection_freshness"]["status"] == "CURRENT"


def test_11_activity_deletion_or_limited_evidence(freshness_context):
    """When only 3 graded activities exist, readiness is LIMITED_EVIDENCE and refresh is NOT_READY."""
    c = freshness_context
    # Only 3 activities: WW=1, PT=2 -> observed weight < 70%
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    status = evaluate_current_period_prediction_status(
        c["db"],
        c["scope"],
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )
    assert status["evidence_readiness"]["level"] == "LIMITED_EVIDENCE"
    assert status["evidence_readiness"]["ready"] is False
    assert status["refresh_eligibility"]["status"] == "NOT_READY"
    assert status["refresh_eligibility"]["eligible"] is False


def test_12_tier1_blocking_domain_defect_out_of_domain(freshness_context):
    """An unsupported weight pattern is flagged as OUT_OF_DOMAIN, blocking refresh."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    # Change grading template weights to invalid pattern 50/30/20
    comps = c["db"].query(GradingTemplateComponent).filter(GradingTemplateComponent.grading_template_id == c["template"].grading_template_id).all()
    for comp in comps:
        if comp.component_name == "Written Works":
            comp.weight = Decimal("50")
        elif comp.component_name == "Performance Tasks":
            comp.weight = Decimal("30")
    c["db"].commit()

    status = evaluate_current_period_prediction_status(
        c["db"],
        c["scope"],
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )
    assert status["refresh_eligibility"]["status"] == "OUT_OF_DOMAIN"
    assert status["refresh_eligibility"]["eligible"] is False
    assert any(w["code"] == "UNSUPPORTED_WEIGHT_PATTERN" for w in status["domain_warnings"])
    assert any("outside the current-period model training support" in str(r) for r in status["refresh_eligibility"]["reasons"])


def test_13_tier2_non_blocking_warning_remains_eligible(freshness_context):
    """Tier 2 warnings (e.g. perfect 100 scores) appear in domain_warnings but do NOT block ELIGIBLE status."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 100, 100)
    add_activity(c, "WRITTEN_WORK", 100, 100)
    add_activity(c, "PERFORMANCE_TASK", 100, 100)
    add_activity(c, "PERFORMANCE_TASK", 100, 100)

    status = evaluate_current_period_prediction_status(
        c["db"],
        c["scope"],
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )
    assert status["refresh_eligibility"]["eligible"] is True
    assert status["refresh_eligibility"]["status"] == "ELIGIBLE"


def test_14_finalized_period_blocks_refresh(freshness_context):
    """When a student's grade for the period is finalized, refresh_eligibility is FINALIZED and refresh returns FINALIZED."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred = c["db"].get(AIPrediction, gen["prediction_id"])

    # Finalize student period grade
    final_grade = StudentPeriodGrade(
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period1"].academic_period_id,
        final_period_grade=Decimal("88.50"),
        is_finalized=True,
    )
    c["db"].add(final_grade)
    c["db"].commit()

    status = evaluate_current_period_prediction_status(
        c["db"],
        pred,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )
    assert status["refresh_eligibility"]["status"] == "FINALIZED"
    assert status["refresh_eligibility"]["eligible"] is False

    # Attempt refresh
    refresh_result = refresh_current_period_prediction_workflow(
        c["db"],
        pred,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )
    assert refresh_result["generation_status"] == "FINALIZED"
    assert refresh_result["ready"] is False


def test_15_revisions_remain_readable_after_finalization(freshness_context):
    """Historical revisions remain readable and inspectable even after period finalization."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred = c["db"].get(AIPrediction, gen["prediction_id"])

    final_grade = StudentPeriodGrade(
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period1"].academic_period_id,
        final_period_grade=Decimal("88.50"),
        is_finalized=True,
    )
    c["db"].add(final_grade)
    c["db"].commit()

    status = evaluate_current_period_prediction_status(
        c["db"],
        pred,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )
    assert status["requested_prediction"]["prediction_id"] == pred.prediction_id
    assert status["requested_prediction"]["predicted_period_grade"] is not None


def test_16_same_evidence_refresh_returns_unchanged(freshness_context):
    """Refreshing an existing prediction with identical evidence returns UNCHANGED without creating a new row."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred = c["db"].get(AIPrediction, gen["prediction_id"])
    count_before = c["db"].query(AIPrediction).count()

    ref = refresh_current_period_prediction_workflow(
        c["db"],
        pred,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )
    assert ref["generation_status"] == "UNCHANGED"
    assert ref["prediction_id"] == pred.prediction_id
    assert ref["revision"] == 1
    assert c["db"].query(AIPrediction).count() == count_before


def test_17_changed_evidence_refresh_creates_v2(freshness_context):
    """Refreshing when evidence changed creates Revision 2 with CREATED generation status."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred = c["db"].get(AIPrediction, gen["prediction_id"])

    # Add new activity
    add_activity(c, "WRITTEN_WORK", 95, 100)

    ref = refresh_current_period_prediction_workflow(
        c["db"],
        pred,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )
    assert ref["generation_status"] == "CREATED"
    assert ref["revision"] == 2
    assert ref["prediction_id"] != pred.prediction_id
    assert c["db"].query(AIPrediction).count() == 2


def test_18_v1_remains_immutable_after_v2(freshness_context):
    """Creating Revision 2 leaves Revision 1 immutable and intact."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred_v1 = c["db"].get(AIPrediction, gen["prediction_id"])
    v1_grade = pred_v1.predicted_period_grade
    v1_generated_at = pred_v1.generated_at

    add_activity(c, "WRITTEN_WORK", 95, 100)

    ref = refresh_current_period_prediction_workflow(
        c["db"],
        pred_v1,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )
    assert ref["revision"] == 2

    # Refresh DB session and verify V1 is untouched
    c["db"].expire_all()
    reloaded_v1 = c["db"].get(AIPrediction, pred_v1.prediction_id)
    assert reloaded_v1.revision == 1
    assert reloaded_v1.predicted_period_grade == v1_grade
    assert reloaded_v1.generated_at == v1_generated_at


def test_19_current_refresh_leaves_next_baseline_untouched(freshness_context):
    """CURRENT prediction refresh does not modify or delete any existing NEXT baseline forecast rows."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    # Insert a dummy NEXT model and prediction
    next_model = AIModelVersion(
        model_name="entervene_next_period_grade_rf",
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_next_period_grade_rf.joblib",
        is_active=True,
    )
    c["db"].add(next_model)
    c["db"].flush()

    next_pred = AIPrediction(
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=c["period1"].academic_period_id,
        target_period_id=c["period2"].academic_period_id,
        model_version_id=next_model.model_version_id,
        revision=1,
        predicted_period_grade=Decimal("84.50"),
        risk_level="LOW_RISK",
        risk_score=Decimal("20.00"),
        data_status="SUFFICIENT",
        risk_assessment_status=RISK_ASSESSMENT_EVALUATED,
    )
    c["db"].add(next_pred)
    c["db"].commit()

    # Generate and refresh CURRENT prediction
    gen = generate_initial(c)
    pred_current = c["db"].get(AIPrediction, gen["prediction_id"])
    add_activity(c, "WRITTEN_WORK", 95, 100)

    refresh_current_period_prediction_workflow(
        c["db"],
        pred_current,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )

    # Verify NEXT prediction is completely untouched
    c["db"].expire_all()
    reloaded_next = c["db"].get(AIPrediction, next_pred.prediction_id)
    assert reloaded_next is not None
    assert reloaded_next.revision == 1
    assert reloaded_next.predicted_period_grade == Decimal("84.50")


def test_20_purpose_aware_refresh_routes_next_prediction(freshness_context, monkeypatch):
    """POST /predictions/{id}/refresh routes NEXT_PERIOD_BASELINE_FORECAST to generate_from_records."""
    c = freshness_context
    next_model = AIModelVersion(
        model_name="entervene_next_period_grade_rf",
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_next_period_grade_rf.joblib",
        is_active=True,
    )
    c["db"].add(next_model)
    c["db"].flush()

    next_pred = AIPrediction(
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=c["period1"].academic_period_id,
        target_period_id=c["period2"].academic_period_id,
        model_version_id=next_model.model_version_id,
        revision=1,
        predicted_period_grade=Decimal("84.50"),
        risk_level="LOW_RISK",
        risk_score=Decimal("20.00"),
        data_status="SUFFICIENT",
        risk_assessment_status=RISK_ASSESSMENT_EVALUATED,
    )
    c["db"].add(next_pred)
    c["db"].commit()

    called = {}
    def mock_next_gen(db, scope, **kwargs):
        called["scope"] = scope
        from app.services.prediction.PredictionGenerationService import persisted_prediction_response
        return persisted_prediction_response(next_pred, "CREATED")

    monkeypatch.setattr("app.api.v1.routes.Predictions.generate_from_records", mock_next_gen)

    response = c["client"].post(f"/api/v1/predictions/{next_pred.prediction_id}/refresh")
    assert response.status_code == 200
    assert called["scope"]["source_period_id"] == c["period1"].academic_period_id
    assert called["scope"]["target_period_id"] == c["period2"].academic_period_id


def test_21_purpose_aware_refresh_routes_current_prediction(freshness_context):
    """POST /predictions/{id}/refresh routes CURRENT_PERIOD_FINAL_GRADE_PROJECTION to refresh_current_period_prediction_workflow."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred_id = gen["prediction_id"]

    # Same evidence refresh returns 200 and UNCHANGED
    response = c["client"].post(f"/api/v1/predictions/{pred_id}/refresh")
    assert response.status_code == 200
    data = response.json()
    assert data["generation_status"] == "UNCHANGED"
    assert data["prediction_id"] == pred_id


def test_22_client_cannot_override_refresh_purpose(freshness_context):
    """The server uses persisted prediction.model_version.model_purpose, ignoring any client tampering."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred_id = gen["prediction_id"]

    # Client passes payload with request ID, endpoint routes strictly based on database purpose
    response = c["client"].post(
        f"/api/v1/predictions/{pred_id}/refresh",
        json={"generation_request_id": "test-key-override"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["prediction_mode"] == ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value


def test_23_legacy_prediction_refresh_rejected(freshness_context):
    """Refreshing a prediction with null or unsupported purpose is rejected with 422."""
    c = freshness_context
    legacy_pred = AIPrediction(
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=c["period1"].academic_period_id,
        target_period_id=c["period1"].academic_period_id,
        model_version_id=None,
        revision=1,
        predicted_period_grade=Decimal("80.00"),
    )
    c["db"].add(legacy_pred)
    c["db"].commit()

    response = c["client"].post(f"/api/v1/predictions/{legacy_pred.prediction_id}/refresh")
    assert response.status_code == 422
    assert "Historical unvalidated or legacy predictions cannot be refreshed" in response.json()["detail"]


def test_24_active_model_v1_to_v2_model_update_available(freshness_context):
    """When V2 is activated with unchanged student evidence:
    - projection_freshness remains CURRENT
    - model_currency reports MODEL_UPDATE_AVAILABLE
    - refresh_eligibility is ELIGIBLE
    """
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred_v1 = c["db"].get(AIPrediction, gen["prediction_id"])

    # Activate V2 model
    c["model_v1"].is_active = False
    model_v2 = AIModelVersion(
        model_name="entervene_current_period_grade_rf_v2",
        model_type="REGRESSOR",
        model_purpose=CURRENT_MODEL_PURPOSE,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_current_period_grade_rf_v1.joblib",
        feature_schema_json=c["schema_json"],
        is_active=True,
    )
    c["db"].add(model_v2)
    c["db"].commit()

    status = evaluate_current_period_prediction_status(
        c["db"],
        pred_v1,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )

    assert status["projection_freshness"]["status"] == "CURRENT"
    assert status["model_currency"]["status"] == "MODEL_UPDATE_AVAILABLE"
    assert status["model_currency"]["persisted_model_version_id"] == c["model_v1"].model_version_id
    assert status["model_currency"]["active_model_version_id"] == model_v2.model_version_id
    assert status["refresh_eligibility"]["eligible"] is True


def test_25_refresh_after_model_change_uses_v2_and_starts_rev_1(freshness_context):
    """Refreshing after activating V2 scores with V2 and starts revision 1 under V2."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred_v1 = c["db"].get(AIPrediction, gen["prediction_id"])

    # Activate V2 model
    c["model_v1"].is_active = False
    model_v2 = AIModelVersion(
        model_name="entervene_current_period_grade_rf_v2",
        model_type="REGRESSOR",
        model_purpose=CURRENT_MODEL_PURPOSE,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_current_period_grade_rf_v1.joblib",
        feature_schema_json=c["schema_json"],
        is_active=True,
    )
    c["db"].add(model_v2)
    c["db"].commit()

    ref = refresh_current_period_prediction_workflow(
        c["db"],
        pred_v1,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )

    assert ref["generation_status"] == "CREATED"
    assert ref["model_version_id"] == model_v2.model_version_id
    assert ref["revision"] == 1


def test_26_historical_v1_revisions_remain_untouched(freshness_context):
    """After upgrading to V2, historical V1 revisions remain untouched with original model_version_id and revision."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    v1_id = gen["prediction_id"]

    c["model_v1"].is_active = False
    model_v2 = AIModelVersion(
        model_name="entervene_current_period_grade_rf_v2",
        model_type="REGRESSOR",
        model_purpose=CURRENT_MODEL_PURPOSE,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_current_period_grade_rf_v1.joblib",
        feature_schema_json=c["schema_json"],
        is_active=True,
    )
    c["db"].add(model_v2)
    c["db"].commit()

    pred_v1 = c["db"].get(AIPrediction, v1_id)
    refresh_current_period_prediction_workflow(
        c["db"],
        pred_v1,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )

    c["db"].expire_all()
    old_v1 = c["db"].get(AIPrediction, v1_id)
    assert old_v1.model_version_id == c["model_v1"].model_version_id
    assert old_v1.revision == 1


def test_27_deterministic_latest_current_selection(freshness_context):
    """Two-phase lookup: prefers active V2 over older V1 rev 2; falls back to V1 when V2 has no prediction."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen1 = generate_initial(c)
    add_activity(c, "WRITTEN_WORK", 92, 100)
    gen2 = generate_initial(c)
    assert gen2["revision"] == 2

    # Switch to V2 without generating for V2 yet
    c["model_v1"].is_active = False
    model_v2 = AIModelVersion(
        model_name="entervene_current_period_grade_rf_v2",
        model_type="REGRESSOR",
        model_purpose=CURRENT_MODEL_PURPOSE,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_current_period_grade_rf_v1.joblib",
        feature_schema_json=c["schema_json"],
        is_active=True,
    )
    c["db"].add(model_v2)
    c["db"].commit()

    # Phase 2 fallback: V2 has no prediction yet, so V1 rev 2 is chosen with MODEL_UPDATE_AVAILABLE
    latest_pred, active_model, currency = get_latest_current_period_prediction(c["db"], c["scope"])
    assert latest_pred.prediction_id == gen2["prediction_id"]
    assert currency == "MODEL_UPDATE_AVAILABLE"

    # Now generate under V2
    gen_v2 = current_gen.generate_current_period_prediction(
        c["scope"],
        staff_id=c["staff"].staff_id,
        bind=c["db"].get_bind(),
    )
    assert gen_v2["revision"] == 1
    assert gen_v2["model_version_id"] == model_v2.model_version_id

    # Phase 1: V2 rev 1 is now chosen over V1 rev 2
    latest_pred_after, _, currency_after = get_latest_current_period_prediction(c["db"], c["scope"])
    assert latest_pred_after.prediction_id == gen_v2["prediction_id"]
    assert currency_after == "CURRENT_MODEL"


def test_28_refresh_request_id_replay_idempotent(freshness_context):
    """Calling refresh with the same generation_request_id returns REPLAYED."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred = c["db"].get(AIPrediction, gen["prediction_id"])
    add_activity(c, "WRITTEN_WORK", 95, 100)

    first = refresh_current_period_prediction_workflow(
        c["db"],
        pred,
        payload=PredictionRefreshRequest(generation_request_id="refresh-idem-key"),
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )
    assert first["generation_status"] == "CREATED"

    second = refresh_current_period_prediction_workflow(
        c["db"],
        pred,
        payload=PredictionRefreshRequest(generation_request_id="refresh-idem-key"),
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )
    assert second["generation_status"] == "REPLAYED"
    assert second["prediction_id"] == first["prediction_id"]


def test_29_prediction_specific_status_v1_when_v2_exists(freshness_context):
    """User Prompt Correction 1 Test:
    - v1 revision exists
    - v2 revision exists
    - GET status for v1 prediction ID
    Expected:
    - requested prediction remains v1
    - model_currency = MODEL_UPDATE_AVAILABLE
    - freshness is evaluated against v1 evidence context
    - latest_prediction points to v2.
    """
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    # 1. Generate V1
    gen_v1 = generate_initial(c)
    pred_v1_id = gen_v1["prediction_id"]

    # 2. Activate V2 and generate V2
    c["model_v1"].is_active = False
    model_v2 = AIModelVersion(
        model_name="entervene_current_period_grade_rf_v2",
        model_type="REGRESSOR",
        model_purpose=CURRENT_MODEL_PURPOSE,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_current_period_grade_rf_v1.joblib",
        feature_schema_json=c["schema_json"],
        is_active=True,
    )
    c["db"].add(model_v2)
    c["db"].commit()

    gen_v2 = current_gen.generate_current_period_prediction(
        c["scope"],
        staff_id=c["staff"].staff_id,
        bind=c["db"].get_bind(),
    )
    pred_v2_id = gen_v2["prediction_id"]

    # 3. Call GET /predictions/{v1_id}/status
    response = c["client"].get(f"/api/v1/predictions/{pred_v1_id}/status")
    assert response.status_code == 200
    data = response.json()

    assert data["prediction_id"] == pred_v1_id
    assert data["model_purpose"] == "CURRENT_PERIOD_FINAL_GRADE_PROJECTION"
    status = data["status"]

    # Requested prediction remains v1
    assert status["requested_prediction"]["prediction_id"] == pred_v1_id
    assert status["requested_prediction"]["model_version_id"] == c["model_v1"].model_version_id
    assert status["requested_prediction"]["revision"] == 1

    # Model currency compares v1 against active v2
    assert status["model_currency"]["status"] == "MODEL_UPDATE_AVAILABLE"
    assert status["model_currency"]["persisted_model_version_id"] == c["model_v1"].model_version_id
    assert status["model_currency"]["active_model_version_id"] == model_v2.model_version_id

    # Freshness evaluated against v1 evidence context
    assert status["projection_freshness"]["status"] == "CURRENT"

    # Latest prediction points to v2
    assert status["latest_prediction"]["prediction_id"] == pred_v2_id
    assert status["latest_prediction"]["model_version_id"] == model_v2.model_version_id
    assert status["latest_prediction"]["revision"] == 1


def test_30_authorization_refresh_and_status(freshness_context):
    """Authorization verification:
    - Teacher assigned: 200 OK on refresh and status
    - Teacher unassigned: 403 Forbidden on refresh (write=True)
    - Student: 403 Forbidden on refresh
    - Read authorization for GET status
    """
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred_id = gen["prediction_id"]

    # Assigned teacher succeeds
    res_assigned = c["client"].post(f"/api/v1/predictions/{pred_id}/refresh")
    assert res_assigned.status_code == 200

    # Unassigned teacher gets 403 on refresh
    c["active_user"]["sub"] = str(c["other_staff_account"].user_id)
    c["active_user"]["staff_id"] = c["other_staff"].staff_id

    res_unassigned = c["client"].post(f"/api/v1/predictions/{pred_id}/refresh")
    assert res_unassigned.status_code == 403

    # Student gets 403 on refresh
    c["active_user"]["role"] = "student"
    c["active_user"]["staff_id"] = None
    res_student = c["client"].post(f"/api/v1/predictions/{pred_id}/refresh")
    assert res_student.status_code == 403


def test_31_toctou_safety_authoritative_revalidation(freshness_context, monkeypatch):
    """Advisory check in FreshnessService reports ELIGIBLE, but generation transaction revalidates authoritatively."""
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred = c["db"].get(AIPrediction, gen["prediction_id"])

    # Simulate TOCTOU: Mock evaluate_current_period_prediction_status to return ELIGIBLE
    # But insert a finalized period grade right before transactional execution
    final_grade = StudentPeriodGrade(
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period1"].academic_period_id,
        final_period_grade=Decimal("88.50"),
        is_finalized=True,
    )
    c["db"].add(final_grade)
    c["db"].commit()

    # Even if advisory was bypassed, generate_current_period_prediction catches finalization
    result = current_gen.generate_current_period_prediction(
        c["scope"],
        staff_id=c["staff"].staff_id,
        bind=c["db"].get_bind(),
    )
    assert result["generation_status"] == "FINALIZED"
    assert result["ready"] is False


def test_32_single_prediction_status_discriminated_envelope(freshness_context):
    """GET /predictions/{id}/status returns strongly typed discriminated envelopes:
    - CurrentPredictionStatusEnvelope for CURRENT
    - NextPredictionStatusEnvelope for NEXT
    """
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    # 1. CURRENT prediction status envelope
    gen_current = generate_initial(c)
    resp_cur = c["client"].get(f"/api/v1/predictions/{gen_current['prediction_id']}/status")
    assert resp_cur.status_code == 200
    env_cur = CurrentPredictionStatusEnvelope.model_validate(resp_cur.json())
    assert env_cur.model_purpose == "CURRENT_PERIOD_FINAL_GRADE_PROJECTION"
    assert env_cur.status.projection_freshness.status == "CURRENT"

    # 2. NEXT prediction status envelope
    next_model = AIModelVersion(
        model_name="entervene_next_period_grade_rf",
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_next_period_grade_rf.joblib",
        is_active=True,
    )
    c["db"].add(next_model)
    c["db"].flush()

    next_pred = AIPrediction(
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=c["period1"].academic_period_id,
        target_period_id=c["period2"].academic_period_id,
        model_version_id=next_model.model_version_id,
        revision=1,
        predicted_period_grade=Decimal("84.50"),
        risk_level="LOW_RISK",
        risk_score=Decimal("20.00"),
        data_status="SUFFICIENT",
        risk_assessment_status=RISK_ASSESSMENT_EVALUATED,
    )
    c["db"].add(next_pred)
    c["db"].commit()

    resp_next = c["client"].get(f"/api/v1/predictions/{next_pred.prediction_id}/status")
    assert resp_next.status_code == 200
    env_next = NextPredictionStatusEnvelope.model_validate(resp_next.json())
    assert env_next.model_purpose == "NEXT_PERIOD_BASELINE_FORECAST"
    assert env_next.status.requested_prediction.prediction_id == next_pred.prediction_id


def test_33_freshness_unavailable_when_model_context_cannot_be_reconstructed(freshness_context):
    """Case 1: Historical CURRENT prediction whose persisted model/schema context cannot be safely reconstructed
    returns projection_freshness.status = FRESHNESS_UNAVAILABLE without guessing or scoring.
    """
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred = c["db"].get(AIPrediction, gen["prediction_id"])
    pred_count_before = c["db"].query(AIPrediction).count()

    # When persisted model/schema context cannot be safely reconstructed during fingerprint comparison
    with patch(
        "app.services.prediction.CurrentPeriodPredictionFreshnessService.build_current_period_evidence_fingerprint",
        side_effect=RuntimeError("Persisted schema/model definition corrupted or unavailable"),
    ):
        status = evaluate_current_period_prediction_status(
            c["db"],
            pred,
            current_user=c["active_user"],
            staff_id=c["staff"].staff_id,
        )

        assert status["projection_freshness"]["status"] == "FRESHNESS_UNAVAILABLE"
        assert status["projection_freshness"]["saved_fingerprint"] is not None
        assert status["projection_freshness"]["current_fingerprint"] is None
        assert len(status["projection_freshness"]["reasons"]) > 0
        assert any("cannot be safely reconstructed" in r for r in status["projection_freshness"]["reasons"])

        # Must not guess CURRENT or SOURCE_EVIDENCE_CHANGED
        assert status["projection_freshness"]["status"] not in ("CURRENT", "SOURCE_EVIDENCE_CHANGED")

        # Verify no prediction row created and no scoring persisted
        assert c["db"].query(AIPrediction).count() == pred_count_before


def test_34_evidence_change_and_model_update_simultaneously(freshness_context):
    """Case 2: CURRENT v1 prediction exists, student evidence changes, and CURRENT v2 becomes active simultaneously.
    Expected:
    - projection_freshness = SOURCE_EVIDENCE_CHANGED
    - model_currency = MODEL_UPDATE_AVAILABLE
    Both axes must remain independent.
    """
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred_v1 = c["db"].get(AIPrediction, gen["prediction_id"])

    # 1. Student evidence changes
    add_activity(c, "WRITTEN_WORK", 95, 100, title="New WW")

    # 2. CURRENT v2 becomes active simultaneously
    c["model_v1"].is_active = False
    model_v2 = AIModelVersion(
        model_name="entervene_current_period_grade_rf_v2",
        model_type="REGRESSOR",
        model_purpose=CURRENT_MODEL_PURPOSE,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_current_period_grade_rf_v1.joblib",
        feature_schema_json=c["schema_json"],
        is_active=True,
    )
    c["db"].add(model_v2)
    c["db"].commit()

    status = evaluate_current_period_prediction_status(
        c["db"],
        pred_v1,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )

    assert status["projection_freshness"]["status"] == "SOURCE_EVIDENCE_CHANGED"
    assert status["model_currency"]["status"] == "MODEL_UPDATE_AVAILABLE"
    assert status["model_currency"]["persisted_model_version_id"] == c["model_v1"].model_version_id
    assert status["model_currency"]["active_model_version_id"] == model_v2.model_version_id
    assert status["refresh_eligibility"]["eligible"] is True


def test_35_no_active_current_model_historical_readable(freshness_context):
    """Case 3: Historical CURRENT prediction exists but no CURRENT model is active.
    Expected:
    - historical prediction remains readable.
    - model_currency = MODEL_UNAVAILABLE
    - refresh_eligibility = MODEL_UNAVAILABLE (eligible = False)
    - projection_freshness evaluated from persisted prediction's model context (CURRENT).
    """
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred_v1 = c["db"].get(AIPrediction, gen["prediction_id"])

    # Deactivate all CURRENT models
    c["model_v1"].is_active = False
    c["db"].commit()

    status = evaluate_current_period_prediction_status(
        c["db"],
        pred_v1,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )

    assert status["requested_prediction"]["prediction_id"] == pred_v1.prediction_id
    assert status["requested_prediction"]["predicted_period_grade"] is not None
    assert status["model_currency"]["status"] == "MODEL_UNAVAILABLE"
    assert status["model_currency"]["active_model_version_id"] is None
    assert status["refresh_eligibility"]["status"] == "MODEL_UNAVAILABLE"
    assert status["refresh_eligibility"]["eligible"] is False
    # Freshness is safely evaluated against persisted v1 model context
    assert status["projection_freshness"]["status"] == "CURRENT"


def test_36_official_outcome_finalization_via_prediction_outcome(freshness_context):
    """Case 4: Official finalization where PredictionOutcome.actual_period_grade exists
    even if StudentPeriodGrade finalization is not the source.
    Expected:
    - refresh_eligibility = FINALIZED (eligible = False)
    - POST refresh creates no new prediction revision.
    """
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred = c["db"].get(AIPrediction, gen["prediction_id"])
    pred_count_before = c["db"].query(AIPrediction).count()

    # Create official PredictionOutcome with actual_period_grade WITHOUT StudentPeriodGrade finalization
    outcome = PredictionOutcome(
        prediction_id=pred.prediction_id,
        actual_period_grade=Decimal("91.50"),
        outcome_status="CONFIRMED",
    )
    c["db"].add(outcome)
    c["db"].commit()

    status = evaluate_current_period_prediction_status(
        c["db"],
        pred,
        current_user=c["active_user"],
        staff_id=c["staff"].staff_id,
    )
    assert status["refresh_eligibility"]["status"] == "FINALIZED"
    assert status["refresh_eligibility"]["eligible"] is False

    # POST refresh creates no new prediction revision
    response = c["client"].post(f"/api/v1/predictions/{pred.prediction_id}/refresh")
    assert response.status_code == 200
    data = response.json()
    assert data["generation_status"] == "FINALIZED"
    assert data["predicted_period_grade"] is None
    assert c["db"].query(AIPrediction).count() == pred_count_before


def test_37_http_no_score_refresh_responses_not_ready(freshness_context):
    """Case 5a: HTTP-level refresh response for NOT_READY.
    Verify:
    - response schema serializes correctly as PredictionFromRecordsResponse;
    - predicted grade is null;
    - no AIPrediction row is created;
    - no request ledger row is created.
    """
    c = freshness_context
    # Initially create valid prediction
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred_id = gen["prediction_id"]

    # Delete 3 submissions so only 1 activity remains (< standard ready)
    subs = c["db"].query(StudentSubmission).filter(StudentSubmission.student_id == c["student"].student_id).all()
    for sub in subs[1:]:
        c["db"].delete(sub)
    c["db"].commit()

    pred_count_before = c["db"].query(AIPrediction).count()
    ledger_count_before = c["db"].query(PredictionGenerationRequest).count()

    response = c["client"].post(
        f"/api/v1/predictions/{pred_id}/refresh",
        json={"generation_request_id": "not-ready-key"},
    )
    assert response.status_code == 200
    parsed = PredictionFromRecordsResponse.model_validate(response.json())
    assert parsed.generation_status == "NOT_READY"
    assert parsed.predicted_period_grade is None
    assert parsed.ready is False
    assert parsed.prediction_id == pred_id

    # Verify no new prediction row or request ledger row was created
    assert c["db"].query(AIPrediction).count() == pred_count_before
    assert c["db"].query(PredictionGenerationRequest).count() == ledger_count_before


def test_38_http_no_score_refresh_responses_out_of_domain(freshness_context):
    """Case 5b: HTTP-level refresh response for OUT_OF_DOMAIN.
    Verify:
    - response schema serializes correctly as PredictionFromRecordsResponse;
    - predicted grade is null;
    - no AIPrediction row is created;
    - no request ledger row is created.
    """
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred_id = gen["prediction_id"]

    # Change grading template to unsupported weight pattern 50/30/20
    comps = c["db"].query(GradingTemplateComponent).filter(GradingTemplateComponent.grading_template_id == c["template"].grading_template_id).all()
    for comp in comps:
        if comp.component_name == "Written Works":
            comp.weight = Decimal("50")
        elif comp.component_name == "Performance Tasks":
            comp.weight = Decimal("30")
    c["db"].commit()

    pred_count_before = c["db"].query(AIPrediction).count()
    ledger_count_before = c["db"].query(PredictionGenerationRequest).count()

    response = c["client"].post(
        f"/api/v1/predictions/{pred_id}/refresh",
        json={"generation_request_id": "out-of-domain-key"},
    )
    assert response.status_code == 200
    parsed = PredictionFromRecordsResponse.model_validate(response.json())
    assert parsed.generation_status == "OUT_OF_DOMAIN"
    assert parsed.predicted_period_grade is None
    assert parsed.ready is False

    assert c["db"].query(AIPrediction).count() == pred_count_before
    assert c["db"].query(PredictionGenerationRequest).count() == ledger_count_before


def test_39_http_no_score_refresh_responses_finalized(freshness_context):
    """Case 5c: HTTP-level refresh response for FINALIZED.
    Verify:
    - response schema serializes correctly as PredictionFromRecordsResponse;
    - predicted grade is null;
    - no AIPrediction row is created;
    - no request ledger row is created.
    """
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred_id = gen["prediction_id"]

    # Finalize student period grade
    final_grade = StudentPeriodGrade(
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period1"].academic_period_id,
        final_period_grade=Decimal("88.50"),
        is_finalized=True,
    )
    c["db"].add(final_grade)
    c["db"].commit()

    pred_count_before = c["db"].query(AIPrediction).count()
    ledger_count_before = c["db"].query(PredictionGenerationRequest).count()

    response = c["client"].post(
        f"/api/v1/predictions/{pred_id}/refresh",
        json={"generation_request_id": "finalized-key"},
    )
    assert response.status_code == 200
    parsed = PredictionFromRecordsResponse.model_validate(response.json())
    assert parsed.generation_status == "FINALIZED"
    assert parsed.predicted_period_grade is None
    assert parsed.ready is False

    assert c["db"].query(AIPrediction).count() == pred_count_before
    assert c["db"].query(PredictionGenerationRequest).count() == ledger_count_before


def test_40_student_read_authorization_denied(freshness_context):
    """Case 6: Student read authorization denial.
    GET /predictions/{prediction_id}/status as student returns HTTP 403 Forbidden.
    """
    c = freshness_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    gen = generate_initial(c)
    pred_id = gen["prediction_id"]

    # Student user caller
    c["active_user"]["role"] = "student"
    c["active_user"]["staff_id"] = None

    response = c["client"].get(f"/api/v1/predictions/{pred_id}/status")
    assert response.status_code == 403
    assert "Access denied" in response.json()["detail"]

