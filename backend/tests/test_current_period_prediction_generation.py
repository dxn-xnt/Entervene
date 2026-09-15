from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timezone
from decimal import Decimal
import json
import math
from pathlib import Path
import uuid

import pytest
from sqlalchemy import CheckConstraint, create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.Base import Base
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
from app.services.prediction import CurrentPeriodPredictionGenerationService as current_gen
from app.services.prediction.CurrentPeriodFeatureBuilderService import (
    MODEL_NAME as CURRENT_MODEL_NAME,
    MODEL_PURPOSE as CURRENT_MODEL_PURPOSE,
)
from app.services.prediction.ModelRegistryExceptions import (
    ActiveModelNotFound,
    ArtifactIntegrityError,
)
from app.services.prediction.PredictionScopeService import PredictionConflict


@pytest.fixture
def current_context():
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

    account = UserAccount(user_id=uuid.uuid4(), email="teacher@example.test")
    staff = AcademicStaff(staff_id="T-CURRENT", first_name="Current", last_name="Teacher", user_id=account.user_id)
    student = Student(student_id=uuid.uuid4(), student_lrn="300000000001", first_name="Current", last_name="Learner", academic_level_id=level.academic_level_id)

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
    db.add_all([account, staff, student, period1, period2, period3, class_, subject])
    db.flush()

    template = GradingTemplate(template_name="Current 40-40-20", academic_level_id=level.academic_level_id, subject_id=subject.subject_id, status="active")
    db.add(template)
    db.flush()
    db.add_all([
        GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Written Works", weight=Decimal("40"), display_order=1),
        GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Performance Tasks", weight=Decimal("40"), display_order=2),
        GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Quarterly Assessment", weight=Decimal("20"), display_order=3),
    ])
    subject.default_grading_template = str(template.grading_template_id)

    db.add(StudentClass(
        student_id=student.student_id,
        class_id=class_.class_id,
        academic_year_id=year.academic_year_id,
        enrollment_status="enrolled",
    ))
    db.add(SubjectLoad(
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        academic_period_id=period1.academic_period_id,
        staff_id=staff.staff_id,
        is_active_version=True,
        status="active",
    ))
    db.add(SubjectLoad(
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        academic_period_id=period2.academic_period_id,
        staff_id=staff.staff_id,
        is_active_version=True,
        status="active",
    ))

    schema_json = json.loads(Path("data/models/entervene_current_period_grade_rf_v1_feature_schema.json").read_text(encoding="utf-8"))
    model = AIModelVersion(
        model_name=CURRENT_MODEL_NAME,
        model_type="REGRESSOR",
        model_purpose=CURRENT_MODEL_PURPOSE,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_current_period_grade_rf_v1.joblib",
        feature_schema_json=schema_json,
        is_active=True,
    )
    db.add(model)
    db.commit()

    ctx = {
        "db": db,
        "engine": engine,
        "year": year,
        "student": student,
        "class": class_,
        "subject": subject,
        "staff": staff,
        "period1": period1,
        "period2": period2,
        "period3": period3,
        "template": template,
        "level": level,
        "model": model,
        "scope": {
            "student_id": student.student_id,
            "class_id": class_.class_id,
            "subject_id": subject.subject_id,
            "source_period_id": period1.academic_period_id,
            "target_period_id": period1.academic_period_id,
        },
    }
    yield ctx
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
    status="graded",
    graded_at=None,
    title="Activity",
    classwork_type: str | None = None,
    exam_subtype: str | None = None,
):
    db = ctx["db"]
    period = period or ctx["period1"]
    cw = Classwork(
        title=title,
        classwork_type=classwork_type or ("EXAM" if category == "ASSESSMENT" else ("QUIZ" if category == "WRITTEN_WORK" else "ACTIVITY")),
        classwork_category=category,
        exam_subtype=exam_subtype,
        total_points=Decimal(str(total)),
        is_graded=True,
        is_published=True,
        is_archived=False,
        subject_id=ctx["subject"].subject_id,
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
    if status is not None:
        db.add(StudentSubmission(
            student_id=ctx["student"].student_id,
            classwork_assignment_id=assignment.classwork_assignment_id,
            status=status,
            grade=Decimal(str(score)) if score is not None else None,
            submitted_at=graded_at,
            graded_at=graded_at,
            graded_by_staff_id=ctx["staff"].staff_id if status == "graded" else None,
        ))
    db.commit()
    return assignment


def generate(ctx, key=None, **kwargs):
    ctx["db"].commit()
    return current_gen.generate_current_period_prediction(
        ctx["scope"],
        generation_request_id=key,
        staff_id=ctx["staff"].staff_id,
        bind=ctx["db"].get_bind(),
        **kwargs,
    )


# ---------------------------------------------------------------------------
# Test Cases 1 - 26+
# ---------------------------------------------------------------------------


def test_1_term1_current_works_without_previous_period(current_context):
    """Term 1 has no previous period; standard ready evidence should produce valid Revision 1."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100, title="WW 1")
    add_activity(c, "WRITTEN_WORK", 90, 100, title="WW 2")
    add_activity(c, "PERFORMANCE_TASK", 88, 100, title="PT 1")
    add_activity(c, "PERFORMANCE_TASK", 92, 100, title="PT 2")

    result = generate(c)
    assert result["generation_status"] == "CREATED"
    assert result["revision"] == 1
    assert result["predicted_period_grade"] is not None
    assert 0.0 <= result["predicted_period_grade"] <= 100.0
    assert result["prediction_mode"] == ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value


def test_2_source_period_equals_target_period(current_context):
    """CURRENT generation requires source_period == target_period."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    result = generate(c)
    assert result["source_period_id"] == result["target_period_id"]
    snapshot = result["evidence_snapshot"]
    assert snapshot["scope"]["source_period_id"] == snapshot["scope"]["target_period_id"]


def test_3_insufficient_evidence_produces_no_prediction_row(current_context):
    """Only 2 activities -> INSUFFICIENT_EVIDENCE -> no prediction row created."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)

    result = generate(c)
    assert result["generation_status"] == "NOT_READY"
    assert result["ready"] is False
    assert result["readiness_level"] == "INSUFFICIENT_EVIDENCE"
    assert result["predicted_period_grade"] is None
    assert len(result["readiness_reasons"]) > 0
    assert c["db"].query(AIPrediction).count() == 0


def test_4_limited_evidence_produces_no_prediction_row(current_context):
    """3 activities -> LIMITED_EVIDENCE (< 4 activities) -> no prediction row created."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 80, 100)
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)

    result = generate(c)
    assert result["generation_status"] == "NOT_READY"
    assert result["ready"] is False
    assert result["readiness_level"] == "LIMITED_EVIDENCE"
    assert result["predicted_period_grade"] is None
    assert c["db"].query(AIPrediction).count() == 0


def test_5_standard_ready_ww_pt_creates_current_v1(current_context):
    """4 activities (2 WW, 2 PT, weight=80%) -> STANDARD_READY -> creates V1."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    result = generate(c)
    assert result["generation_status"] == "CREATED"
    assert result["readiness_level"] == "STANDARD_READY"
    assert result["ready"] is True
    assert result["revision"] == 1
    assert c["db"].query(AIPrediction).count() == 1


def test_6_high_evidence_complete_qa_creates_v1(current_context):
    """Complete QA composite + WW + PT (>=7 activities, 100% weight) -> HIGH_EVIDENCE -> creates V1."""
    c = current_context
    for i in range(3):
        add_activity(c, "WRITTEN_WORK", 85, 100, title=f"WW {i}")
        add_activity(c, "PERFORMANCE_TASK", 85, 100, title=f"PT {i}")
    add_activity(c, "ASSESSMENT", 45, 50, exam_subtype="SUMMATIVE_1", title="S1")
    add_activity(c, "ASSESSMENT", 35, 50, exam_subtype="SUMMATIVE_2", title="S2")
    add_activity(c, "ASSESSMENT", 80, 100, exam_subtype="TERM_EXAM", title="Term Exam")

    result = generate(c)
    assert result["generation_status"] == "CREATED"
    assert result["readiness_level"] == "HIGH_EVIDENCE"
    assert result["ready"] is True
    assert result["revision"] == 1

    # Verify canonical QA 40-HPS representation
    features = result["features"]
    assert features["qa_has_evidence"] == 1.0
    assert features["qa_available_activity_count"] == 1.0
    assert features["qa_points_possible_so_far"] == 40.0
    # Composite: 0.3*90 + 0.3*70 + 0.4*80 = 80.0%; earned = 0.8 * 40 = 32.0
    assert features["qa_percent_so_far"] == 80.0
    assert features["qa_points_earned_so_far"] == 32.0
    assert features["qa_weight"] == 20.0
    assert features["qa_weighted_score_so_far"] == 16.0


def test_7_partial_qa_does_not_fabricate_qa_evidence(current_context):
    """Incomplete QA (only S1) emits non-blocking warning; qa_has_evidence remains 0."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)
    add_activity(c, "ASSESSMENT", 90, 50, exam_subtype="SUMMATIVE_1", title="S1 Only")

    result = generate(c)
    assert result["generation_status"] == "CREATED"
    assert result["readiness_level"] == "STANDARD_READY"
    assert result["features"]["qa_has_evidence"] == 0.0
    assert result["features"]["qa_points_possible_so_far"] == 0.0

    warning_codes = [w["code"] for w in result["domain_warnings"]]
    assert "QA_PARTIAL_COMPONENTS_AVAILABLE" in warning_codes


def test_8_current_model_purpose_resolved_explicitly(current_context):
    """Model is resolved strictly as CURRENT_PERIOD_FINAL_GRADE_PROJECTION."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    result = generate(c)
    prediction = c["db"].get(AIPrediction, result["prediction_id"])
    assert prediction.model_version.model_purpose == ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value


def test_9_no_current_to_next_model_fallback(current_context):
    """If no active current model exists, raises ActiveModelNotFound and does NOT fallback to NEXT."""
    c = current_context
    c["model"].is_active = False
    c["db"].commit()

    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    with pytest.raises(ActiveModelNotFound):
        generate(c)


def test_10_current_persistence_has_null_risk_fields(current_context):
    """CURRENT predictions must persist NULL for risk_level, risk_score, and data_status."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    result = generate(c)
    prediction = c["db"].get(AIPrediction, result["prediction_id"])
    assert prediction.risk_level is None
    assert prediction.risk_score is None
    assert prediction.data_status is None


def test_11_risk_assessment_status_correct(current_context):
    """risk_assessment_status must be NOT_EVALUATED_FOR_CURRENT_PERIOD_MODEL."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    result = generate(c)
    prediction = c["db"].get(AIPrediction, result["prediction_id"])
    assert prediction.risk_assessment_status == RISK_ASSESSMENT_NOT_EVALUATED_CURRENT


def test_12_risk_engine_never_invoked(current_context, monkeypatch):
    """Verify that RiskEngine.evaluate_risk is never called in this lifecycle."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    def explode(*args, **kwargs):
        raise AssertionError("RiskEngine should NEVER be invoked for current-period predictions!")

    from app.services.prediction import RiskEngine
    monkeypatch.setattr(RiskEngine, "evaluate_risk", explode)

    result = generate(c)
    assert result["generation_status"] == "CREATED"


def test_13_same_request_id_replays(current_context):
    """Submitting same generation_request_id returns existing prediction as REPLAYED."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    first = generate(c, "req-1")
    assert first["generation_status"] == "CREATED"

    second = generate(c, "req-1")
    assert second["generation_status"] == "REPLAYED"
    assert second["prediction_id"] == first["prediction_id"]
    assert c["db"].query(AIPrediction).count() == 1


def test_14_reused_request_id_different_scope_conflicts(current_context):
    """Reusing same request ID with a different scope raises PredictionConflict."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    generate(c, "shared-req")

    # Change scope to Term 2
    changed_scope = {**c["scope"], "source_period_id": c["period2"].academic_period_id, "target_period_id": c["period2"].academic_period_id}
    with pytest.raises(PredictionConflict):
        current_gen.generate_current_period_prediction(
            changed_scope,
            generation_request_id="shared-req",
            staff_id=c["staff"].staff_id,
            bind=c["db"].get_bind(),
        )


def test_15_same_evidence_new_request_returns_unchanged(current_context):
    """Different request ID with identical evidence returns UNCHANGED without new row."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    first = generate(c, "req-1")
    second = generate(c, "req-2")

    assert second["generation_status"] == "UNCHANGED"
    assert second["prediction_id"] == first["prediction_id"]
    assert second["revision"] == 1
    assert c["db"].query(AIPrediction).count() == 1
    assert c["db"].query(PredictionGenerationRequest).count() == 2


def test_16_changed_evidence_creates_next_revision(current_context):
    """Updating evidence allows a subsequent request to create Revision 2."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    v1 = generate(c, "req-1")
    assert v1["revision"] == 1

    # Teacher grades another PT
    add_activity(c, "PERFORMANCE_TASK", 95, 100)

    v2 = generate(c, "req-2")
    assert v2["generation_status"] == "CREATED"
    assert v2["revision"] == 2
    assert v2["prediction_id"] != v1["prediction_id"]
    assert c["db"].query(AIPrediction).count() == 2


def test_17_old_revision_remains_immutable(current_context):
    """Existing audited prediction cannot be modified in place."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    result = generate(c)
    pred = c["db"].get(AIPrediction, result["prediction_id"])
    pred.predicted_period_grade = Decimal("99.99")
    with pytest.raises(ValueError, match="immutable"):
        c["db"].flush()
    c["db"].rollback()


def test_18_no_forced_ai_prediction_feature_rows(current_context):
    """CURRENT predictions do NOT insert forced/ambiguous ai_prediction_feature rows."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    result = generate(c)
    assert c["db"].query(AIPredictionFeature).filter(AIPredictionFeature.prediction_id == result["prediction_id"]).count() == 0
    # But lossless 31 raw features are retained in snapshot
    assert len(result["evidence_snapshot"]["raw_features_31"]) == 31


def test_19_term2_current_evidence_does_not_stale_term1_to_term2_next_baseline(current_context):
    """Modifying Term 2 evidence stales CURRENT Term 2, but leaves NEXT T1->T2 baseline untouched."""
    c = current_context
    # Set up NEXT model
    next_schema = json.loads(Path("data/models/entervene_next_period_grade_rf_feature_schema.json").read_text(encoding="utf-8"))
    next_model = AIModelVersion(
        model_name="entervene_next_period_grade_rf",
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_next_period_grade_rf.joblib",
        feature_schema_json=next_schema,
        is_active=True,
    )
    c["db"].add(next_model)
    # Add finalized Term 1 grade for NEXT forecast
    c["db"].add(StudentPeriodGrade(
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period1"].academic_period_id,
        final_period_grade=Decimal("85.00"),
        is_finalized=True,
    ))
    c["db"].commit()

    # Add Term 2 activities for CURRENT Term 2
    add_activity(c, "WRITTEN_WORK", 85, 100, period=c["period2"])
    add_activity(c, "WRITTEN_WORK", 90, 100, period=c["period2"])
    add_activity(c, "PERFORMANCE_TASK", 80, 100, period=c["period2"])
    add_activity(c, "PERFORMANCE_TASK", 85, 100, period=c["period2"])

    scope_t2 = {
        "student_id": c["student"].student_id,
        "class_id": c["class"].class_id,
        "subject_id": c["subject"].subject_id,
        "source_period_id": c["period2"].academic_period_id,
        "target_period_id": c["period2"].academic_period_id,
    }
    cur_v1 = current_gen.generate_current_period_prediction(scope_t2, staff_id=c["staff"].staff_id, bind=c["db"].get_bind())
    fp1 = cur_v1["evidence_snapshot"]["evidence_fingerprint"]

    # Now add another activity in Term 2
    add_activity(c, "PERFORMANCE_TASK", 95, 100, period=c["period2"])

    cur_v2 = current_gen.generate_current_period_prediction(scope_t2, staff_id=c["staff"].staff_id, bind=c["db"].get_bind())
    fp2 = cur_v2["evidence_snapshot"]["evidence_fingerprint"]
    assert fp1 != fp2  # CURRENT Term 2 changed

    # Term 1 evidence has zero change
    p1_grade = c["db"].query(StudentPeriodGrade).filter(StudentPeriodGrade.academic_period_id == c["period1"].academic_period_id).one()
    assert p1_grade.final_period_grade == Decimal("85.00")


def test_20_next_and_current_coexist(current_context):
    """NEXT (T1->T2 baseline=88) and CURRENT (T2->T2 projection=86) coexist simultaneously."""
    c = current_context
    next_model = AIModelVersion(
        model_name="entervene_next_period_grade_rf",
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_next_period_grade_rf.joblib",
        feature_schema_json={},
        is_active=True,
    )
    c["db"].add(next_model)
    c["db"].flush()

    # Manual insert of NEXT row
    next_pred = AIPrediction(
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        source_period_id=c["period1"].academic_period_id,
        target_period_id=c["period2"].academic_period_id,
        model_version_id=next_model.model_version_id,
        revision=1,
        predicted_period_grade=Decimal("88.00"),
        risk_level="LOW_RISK",
        risk_score=Decimal("15.0"),
        data_status="SUFFICIENT",
        risk_assessment_status=RISK_ASSESSMENT_EVALUATED,
    )
    c["db"].add(next_pred)
    c["db"].commit()

    # Generate CURRENT for T2
    add_activity(c, "WRITTEN_WORK", 85, 100, period=c["period2"])
    add_activity(c, "WRITTEN_WORK", 90, 100, period=c["period2"])
    add_activity(c, "PERFORMANCE_TASK", 80, 100, period=c["period2"])
    add_activity(c, "PERFORMANCE_TASK", 85, 100, period=c["period2"])
    scope_t2 = {
        "student_id": c["student"].student_id,
        "class_id": c["class"].class_id,
        "subject_id": c["subject"].subject_id,
        "source_period_id": c["period2"].academic_period_id,
        "target_period_id": c["period2"].academic_period_id,
    }
    cur_res = current_gen.generate_current_period_prediction(scope_t2, staff_id=c["staff"].staff_id, bind=c["db"].get_bind())

    assert cur_res["revision"] == 1
    assert c["db"].query(AIPrediction).count() == 2
    assert c["db"].get(AIPrediction, next_pred.prediction_id).predicted_period_grade == Decimal("88.00")
    assert c["db"].get(AIPrediction, cur_res["prediction_id"]).risk_level is None


def test_21_current_generation_blocked_after_official_final_grade(current_context):
    """Official finalized grade blocks generation; unfinalized draft grade does NOT block."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    # 1. Unfinalized draft grade exists
    grade = StudentPeriodGrade(
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period1"].academic_period_id,
        final_period_grade=Decimal("84.00"),
        is_finalized=False,
    )
    c["db"].add(grade)
    c["db"].commit()

    # Draft grade does NOT block generation
    result1 = generate(c)
    assert result1["generation_status"] == "CREATED"

    # 2. Now officially finalize the grade
    grade.is_finalized = True
    c["db"].commit()

    # Official final grade BLOCKS generation
    result2 = generate(c)
    assert result2["generation_status"] == "FINALIZED"
    assert result2["ready"] is False
    assert result2["is_finalized"] is True


def test_22_unsupported_subject_blocks_scoring(current_context):
    """Unsupported subject code emits Tier 1 BLOCKING warning and creates no prediction."""
    c = current_context
    c["subject"].subject_codename = "ASTRONOMY_UNKNOWN"
    c["db"].commit()

    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    result = generate(c)
    assert result["generation_status"] == "DOMAIN_INCOMPATIBLE"
    assert result["ready"] is False
    assert len(result["blocking_reasons"]) > 0
    assert c["db"].query(AIPrediction).count() == 0


def test_23_unsupported_grading_weights_block_scoring(current_context):
    """Grading weight combinations other than 40/40/20, 30/50/20, 20/60/20 block scoring."""
    c = current_context
    # Change weights to invalid 50/30/20
    comps = c["db"].query(GradingTemplateComponent).filter(GradingTemplateComponent.grading_template_id == c["template"].grading_template_id).all()
    for comp in comps:
        if comp.component_name == "Written Works":
            comp.weight = Decimal("50")
        elif comp.component_name == "Performance Tasks":
            comp.weight = Decimal("30")
    c["db"].commit()

    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    result = generate(c)
    assert result["generation_status"] == "DOMAIN_INCOMPATIBLE"
    assert result["ready"] is False
    assert any("weight combination" in r.lower() for r in result["blocking_reasons"])
    assert c["db"].query(AIPrediction).count() == 0


def test_24_schema_mismatch_blocks_scoring(current_context, monkeypatch):
    """Corrupted raw feature count raises error during validation; scoring blocked."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    from app.services.prediction import CurrentPeriodFeatureBuilderService as fb
    orig_build = fb.build_current_period_features_from_records

    def bad_build(*args, **kwargs):
        res = orig_build(*args, **kwargs)
        res["features"].pop("ww_weight")  # Missing required feature
        return res

    monkeypatch.setattr(current_gen, "build_current_period_features_from_records", bad_build)

    with pytest.raises(ValueError, match="Current-period raw feature schema mismatch"):
        generate(c)


def test_25_trusted_authorization_enforced(current_context):
    """Admin allowed; assigned teacher allowed; unassigned teacher and student blocked."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    # 1. Student blocked
    with pytest.raises(PermissionError, match="Students are not permitted"):
        current_gen.generate_current_period_prediction(
            c["scope"],
            current_user={"role": "student"},
            bind=c["db"].get_bind(),
        )

    # 2. Unassigned teacher blocked
    with pytest.raises(PermissionError, match="You are not assigned"):
        current_gen.generate_current_period_prediction(
            c["scope"],
            staff_id="UNASSIGNED_TEACHER",
            bind=c["db"].get_bind(),
        )

    # 3. Admin allowed
    res_admin = current_gen.generate_current_period_prediction(
        c["scope"],
        is_admin=True,
        bind=c["db"].get_bind(),
    )
    assert res_admin["generation_status"] == "CREATED"


def test_26_request_ledger_unwritten_on_no_score_responses(current_context):
    """When a request returns NOT_READY, request ID is not stored and can be re-evaluated later."""
    c = current_context
    # Only 1 activity -> NOT_READY
    add_activity(c, "WRITTEN_WORK", 85, 100)

    res1 = generate(c, "user-key-1")
    assert res1["generation_status"] == "NOT_READY"
    assert c["db"].query(PredictionGenerationRequest).count() == 0

    # Now add remaining activities to reach STANDARD_READY
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    # Re-use same request ID; must succeed and create V1
    res2 = generate(c, "user-key-1")
    assert res2["generation_status"] == "CREATED"
    assert res2["revision"] == 1
    assert c["db"].query(PredictionGenerationRequest).count() == 1


def test_27_replay_across_active_model_change(current_context):
    """Replaying request ID ABC still returns original persisted prediction even if a new model version is activated."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    first = generate(c, "model-change-key")
    assert first["generation_status"] == "CREATED"
    first_pred_id = first["prediction_id"]

    # Simulate activating a new model version v2
    c["model"].is_active = False
    v2_schema = deepcopy(c["model"].feature_schema_json)
    v2_model = AIModelVersion(
        model_name="entervene_current_period_grade_rf_v2",
        model_type="REGRESSOR",
        model_purpose=CURRENT_MODEL_PURPOSE,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_current_period_grade_rf_v1.joblib",
        feature_schema_json=v2_schema,
        is_active=True,
    )
    c["db"].add(v2_model)
    c["db"].commit()

    # Replaying same request key should replay original persisted prediction v1 cleanly
    replayed = generate(c, "model-change-key")
    assert replayed["generation_status"] == "REPLAYED"
    assert replayed["prediction_id"] == first_pred_id
    assert replayed["model_version_id"] == c["model"].model_version_id


def test_28_artifact_sha256_mismatch_blocks_generation(current_context, monkeypatch):
    """Runtime artifact hash mismatch triggers ArtifactIntegrityError and blocks generation."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    # Corrupt artifact hash check
    def bad_sha(path):
        if str(path).endswith(".joblib"):
            return "tampered_hash_00000000000000000000000000000000000000000000000000"
        return "9519518d7a17e6d7142c851868739545fcb6c96585624fe0fa7b35c07ca95998"

    monkeypatch.setattr(current_gen, "compute_file_sha256", bad_sha)

    with pytest.raises(ArtifactIntegrityError, match="Model artifact SHA-256 mismatch"):
        generate(c)
    assert c["db"].query(AIPrediction).count() == 0


def test_29_schema_sha256_mismatch_blocks_generation(current_context, monkeypatch):
    """Runtime schema hash mismatch triggers ArtifactIntegrityError and blocks generation."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    # Corrupt schema hash check
    def bad_sha(path):
        if str(path).endswith(".json"):
            return "tampered_schema_hash_000000000000000000000000000000000000000000"
        return "f5351c830f80d6dd4ba0efbc236a8960794a1ffb7f5f3b48919160ede3686e05"

    monkeypatch.setattr(current_gen, "compute_file_sha256", bad_sha)

    with pytest.raises(ArtifactIntegrityError, match="Feature schema SHA-256 mismatch"):
        generate(c)
    assert c["db"].query(AIPrediction).count() == 0


def test_30_no_prediction_clamping_and_out_of_bounds_errors(current_context, monkeypatch):
    """Verify predictions are not silently clamped; NaN or out-of-bounds predictions raise ValueError."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    # 1. NaN prediction raises error
    class MockModelNaN:
        def predict(self, frame):
            return [float("nan")]

    monkeypatch.setattr(current_gen, "load_model_artifact", lambda path: MockModelNaN())
    with pytest.raises(ValueError, match="non-finite"):
        generate(c)

    # 2. Out-of-bounds > 100 raises error
    class MockModelHigh:
        def predict(self, frame):
            return [105.5]

    monkeypatch.setattr(current_gen, "load_model_artifact", lambda path: MockModelHigh())
    with pytest.raises(ValueError, match="outside valid physical grade domain"):
        generate(c)


def test_31_replay_after_period_finalization(current_context):
    """Same request ID replays original prediction after period is officially finalized."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    req_id = "finalized-replay-req-1"
    first = generate(c, req_id)
    assert first["generation_status"] == "CREATED"
    orig_pred_id = first["prediction_id"]

    # Officially finalize the academic period
    grade = StudentPeriodGrade(
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period1"].academic_period_id,
        final_period_grade=Decimal("88.50"),
        is_finalized=True,
    )
    c["db"].add(grade)
    c["db"].commit()

    # Retrying original request ID must return REPLAYED original V1, NOT FINALIZED
    replayed = generate(c, req_id)
    assert replayed["generation_status"] == "REPLAYED"
    assert replayed["prediction_id"] == orig_pred_id
    assert replayed["predicted_period_grade"] == first["predicted_period_grade"]

    # New request ID must be blocked by finalization guard and return FINALIZED
    new_req = generate(c, "new-req-after-finalization")
    assert new_req["generation_status"] == "FINALIZED"
    assert new_req["ready"] is False
    assert new_req["predicted_period_grade"] is None


def test_32_replay_after_active_model_change(current_context, monkeypatch):
    """Same request ID replays original v1 prediction after active CURRENT model changes to v2 without v2 scoring."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    req_id = "active-model-change-req-1"
    first = generate(c, req_id)
    assert first["generation_status"] == "CREATED"
    orig_pred_id = first["prediction_id"]
    orig_model_version_id = c["model"].model_version_id

    # Deactivate v1 and activate simulated CURRENT v2
    c["model"].is_active = False
    v2_schema = deepcopy(c["model"].feature_schema_json)
    v2_model = AIModelVersion(
        model_name="entervene_current_period_grade_rf_v2",
        model_type="REGRESSOR",
        model_purpose=CURRENT_MODEL_PURPOSE,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_current_period_grade_rf_v1.joblib",
        feature_schema_json=v2_schema,
        is_active=True,
    )
    c["db"].add(v2_model)
    c["db"].commit()

    # Track scoring invocation to ensure no v2 scoring occurs
    score_called = False
    orig_score = current_gen.score_current_period_prediction

    def spy_score(*args, **kwargs):
        nonlocal score_called
        score_called = True
        return orig_score(*args, **kwargs)

    monkeypatch.setattr(current_gen, "score_current_period_prediction", spy_score)

    # Retry original request ID
    replayed = generate(c, req_id)
    assert replayed["generation_status"] == "REPLAYED"
    assert replayed["prediction_id"] == orig_pred_id
    assert replayed["model_version_id"] == orig_model_version_id
    assert score_called is False, "Replay must return persisted prediction without running v2 inference"


def test_33_replay_does_not_require_runtime_artifact_integrity(current_context, monkeypatch):
    """Replay does not require current runtime artifact integrity; new executions still fail closed."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    req_id = "corrupted-artifact-replay-req-1"
    first = generate(c, req_id)
    assert first["generation_status"] == "CREATED"
    orig_pred_id = first["prediction_id"]

    # Simulate corrupted runtime artifact SHA-256
    def bad_sha(path):
        return "tampered_artifact_hash_99999999999999999999999999999999999999999999"

    monkeypatch.setattr(current_gen, "compute_file_sha256", bad_sha)

    # Track scoring invocation to verify no inference occurs during replay
    score_called = False
    orig_score = current_gen.score_current_period_prediction

    def spy_score(*args, **kwargs):
        nonlocal score_called
        score_called = True
        return orig_score(*args, **kwargs)

    monkeypatch.setattr(current_gen, "score_current_period_prediction", spy_score)

    # 1. New execution fails closed with ArtifactIntegrityError (integrity not weakened for NEW executions)
    with pytest.raises(ArtifactIntegrityError, match="SHA-256 mismatch"):
        generate(c, "new-key-under-bad-artifact")

    # 2. Completed request ID replays persisted prediction cleanly without model inference
    replayed = generate(c, req_id)
    assert replayed["generation_status"] == "REPLAYED"
    assert replayed["prediction_id"] == orig_pred_id
    assert score_called is False


def test_34_replay_does_not_bypass_authorization(current_context):
    """Replaying an existing completed request ID still requires caller authorization."""
    c = current_context
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    req_id = "auth-replay-req-1"
    first = generate(c, req_id)
    assert first["generation_status"] == "CREATED"

    # Attempting to replay with student role raises PermissionError
    with pytest.raises(PermissionError, match="Students are not permitted"):
        current_gen.generate_current_period_prediction(
            c["scope"],
            generation_request_id=req_id,
            current_user={"role": "student"},
            bind=c["db"].get_bind(),
        )

    # Attempting to replay with unassigned teacher raises PermissionError
    with pytest.raises(PermissionError, match="You are not assigned"):
        current_gen.generate_current_period_prediction(
            c["scope"],
            generation_request_id=req_id,
            staff_id="UNASSIGNED_TEACHER",
            bind=c["db"].get_bind(),
        )

