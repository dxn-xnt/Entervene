from __future__ import annotations

import math
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from hashlib import sha256
import json

import pytest
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.Config import settings
from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPathway import AcademicPathway
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.DepedCluster import DepedCluster
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.prediction import DevelopmentCurrentTermPredictionPersistenceService as persistence_service
from app.services.prediction import DevelopmentCurrentTermPredictionReadService as read_service
from app.services.prediction import DevelopmentCurrentTermPredictionService as prediction_service
from app.services.prediction import DevelopmentCurrentTermScoringService as scorer
from app.services.prediction.DevelopmentCurrentTermModelSelection import (
    CORRECTED_MODEL_NAME,
    artifact_path,
)
from app.services.prediction.DevelopmentGradeRefreshService import (
    refresh_after_committed_grade_change,
)


@pytest.fixture
def shs_workflow_context(monkeypatch):
    """Sets up an isolated SQLite database fixture for end-to-end Grade 7-12 verification."""
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

    # Academic Year & Periods
    year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    db.add(year)
    db.flush()

    period_active = AcademicPeriod(
        period_name="1st Semester - Midterm",
        period_type="SEMESTER",
        period_sequence=1,
        total_periods_in_year=2,
        period_progress_ratio=Decimal("0.5000"),
        start_date=date(2026, 6, 1),
        end_date=date(2026, 10, 31),
        academic_year_id=year.academic_year_id,
        is_active=True,
    )
    period_inactive = AcademicPeriod(
        period_name="1st Semester - Final",
        period_type="SEMESTER",
        period_sequence=2,
        total_periods_in_year=2,
        period_progress_ratio=Decimal("1.0000"),
        start_date=date(2026, 11, 1),
        end_date=date(2027, 3, 31),
        academic_year_id=year.academic_year_id,
        is_active=False,
    )
    db.add_all([period_active, period_inactive])
    db.flush()

    # DepEd Cluster & SHS Pathways
    stem_cluster = DepedCluster(
        code="STEM",
        name="Science, Technology, Engineering, and Mathematics",
        category="ACADEMIC",
        sort_order=1,
    )
    db.add(stem_cluster)
    db.flush()

    pathway_med = AcademicPathway(
        code="STEM_MED",
        name="STEM - Medical Health Allied",
        deped_cluster_id=stem_cluster.id,
        is_enabled=True,
    )
    pathway_eng = AcademicPathway(
        code="STEM_ENG",
        name="STEM - Engineering / Physical Sciences",
        deped_cluster_id=stem_cluster.id,
        is_enabled=True,
    )
    db.add_all([pathway_med, pathway_eng])
    db.flush()

    # Academic Levels (Grades 9, 11, 12)
    level_9 = AcademicLevel(level_name="Grade 9", grade_level=9)
    level_11 = AcademicLevel(level_name="Grade 11", grade_level=11)
    level_12 = AcademicLevel(level_name="Grade 12", grade_level=12)
    db.add_all([level_9, level_11, level_12])
    db.flush()

    # Staff & Teacher Account
    teacher_account = UserAccount(user_id=uuid.uuid4(), email="stem.teacher@school.test")
    staff = AcademicStaff(
        staff_id="T-STEM-001",
        first_name="STEM",
        last_name="Faculty",
        user_id=teacher_account.user_id,
    )
    db.add_all([teacher_account, staff])
    db.flush()

    # Classes
    class_g11_med = Class(
        section_name="Grade 11 - Fleming (STEM Medical)",
        academic_year_id=year.academic_year_id,
        academic_level_id=level_11.academic_level_id,
        pathway_id=pathway_med.id,
    )
    class_g12_eng = Class(
        section_name="Grade 12 - Tesla (STEM Engineering)",
        academic_year_id=year.academic_year_id,
        academic_level_id=level_12.academic_level_id,
        pathway_id=pathway_eng.id,
    )
    class_g9_jhs = Class(
        section_name="Grade 9 - Newton",
        academic_year_id=year.academic_year_id,
        academic_level_id=level_9.academic_level_id,
    )
    db.add_all([class_g11_med, class_g12_eng, class_g9_jhs])
    db.flush()

    # Grading Templates
    # 1. SHS Specialized: 20 Written Work, 50 Performance Tasks, 30 Quarterly Assessment
    template_specialized = GradingTemplate(
        template_name="SHS Specialized (20/50/30)",
        passing_threshold=84.0,
        status="active",
    )
    # 2. SHS Applied: 20 Written Work, 60 Performance Tasks, 20 Quarterly Assessment
    template_applied = GradingTemplate(
        template_name="SHS Applied (20/60/20)",
        passing_threshold=75.0,
        status="active",
    )
    # 3. JHS Core: 40 Written Work, 40 Performance Tasks, 20 Quarterly Assessment
    template_jhs = GradingTemplate(
        template_name="JHS Core (40/40/20)",
        passing_threshold=75.0,
        status="active",
    )
    # 4. Invalid Template: 20/40/40 (Unsupported weight pattern)
    template_invalid = GradingTemplate(
        template_name="Invalid Weights (20/40/40)",
        passing_threshold=75.0,
        status="active",
    )
    db.add_all([template_specialized, template_applied, template_jhs, template_invalid])
    db.flush()

    # Template Components
    db.add_all([
        GradingTemplateComponent(grading_template_id=template_specialized.grading_template_id, component_name="Written Work", weight=Decimal("20"), display_order=1),
        GradingTemplateComponent(grading_template_id=template_specialized.grading_template_id, component_name="Performance Tasks", weight=Decimal("50"), display_order=2),
        GradingTemplateComponent(grading_template_id=template_specialized.grading_template_id, component_name="Quarterly Assessment", weight=Decimal("30"), display_order=3),

        GradingTemplateComponent(grading_template_id=template_applied.grading_template_id, component_name="Written Work", weight=Decimal("20"), display_order=1),
        GradingTemplateComponent(grading_template_id=template_applied.grading_template_id, component_name="Performance Tasks", weight=Decimal("60"), display_order=2),
        GradingTemplateComponent(grading_template_id=template_applied.grading_template_id, component_name="Quarterly Assessment", weight=Decimal("20"), display_order=3),

        GradingTemplateComponent(grading_template_id=template_jhs.grading_template_id, component_name="Written Work", weight=Decimal("40"), display_order=1),
        GradingTemplateComponent(grading_template_id=template_jhs.grading_template_id, component_name="Performance Tasks", weight=Decimal("40"), display_order=2),
        GradingTemplateComponent(grading_template_id=template_jhs.grading_template_id, component_name="Quarterly Assessment", weight=Decimal("20"), display_order=3),

        GradingTemplateComponent(grading_template_id=template_invalid.grading_template_id, component_name="Written Work", weight=Decimal("20"), display_order=1),
        GradingTemplateComponent(grading_template_id=template_invalid.grading_template_id, component_name="Performance Tasks", weight=Decimal("40"), display_order=2),
        GradingTemplateComponent(grading_template_id=template_invalid.grading_template_id, component_name="Quarterly Assessment", weight=Decimal("40"), display_order=3),
    ])
    db.flush()

    # Subjects
    # G11 STEM Medical: General Biology 1
    subject_bio1 = Subject(
        subject_name="General Biology 1",
        subject_codename="BIO1",
        academic_level_id=level_11.academic_level_id,
        grading_template_id=template_specialized.grading_template_id,
        status="active",
    )
    # G12 STEM Engineering: Precalculus
    subject_precal = Subject(
        subject_name="Precalculus",
        subject_codename="PRECAL11",
        academic_level_id=level_12.academic_level_id,
        grading_template_id=template_specialized.grading_template_id,
        status="active",
    )
    # G12 STEM Engineering: Empowerment Technologies (Applied)
    subject_empotech = Subject(
        subject_name="Empowerment Technologies",
        subject_codename="EMPOTECH",
        academic_level_id=level_12.academic_level_id,
        grading_template_id=template_applied.grading_template_id,
        status="active",
    )
    # G11 Invalid Subject (Unsupported weights)
    subject_invalid_weights = Subject(
        subject_name="Invalid Weight Subject",
        subject_codename="INVAL11",
        academic_level_id=level_11.academic_level_id,
        grading_template_id=template_invalid.grading_template_id,
        status="active",
    )
    # G9 JHS Verified Subject: English 9
    subject_eng9 = Subject(
        subject_name="English 9",
        subject_codename="ENG9",
        academic_level_id=level_9.academic_level_id,
        grading_template_id=template_specialized.grading_template_id,  # 20/50/30 is supported
        status="active",
    )
    # G9 JHS Unverified Subject: TLE 9
    subject_tle9 = Subject(
        subject_name="TLE 9",
        subject_codename="TLE9",
        academic_level_id=level_9.academic_level_id,
        grading_template_id=template_specialized.grading_template_id,
        status="active",
    )
    db.add_all([
        subject_bio1,
        subject_precal,
        subject_empotech,
        subject_invalid_weights,
        subject_eng9,
        subject_tle9,
    ])
    db.flush()

    # Students
    student_g11_med = Student(
        student_id=uuid.uuid4(),
        student_lrn="110000000001",
        first_name="Maria",
        last_name="Santos",
        academic_level_id=level_11.academic_level_id,
    )
    student_g12_eng = Student(
        student_id=uuid.uuid4(),
        student_lrn="120000000002",
        first_name="Juan",
        last_name="Dela Cruz",
        academic_level_id=level_12.academic_level_id,
    )
    student_g9_jhs = Student(
        student_id=uuid.uuid4(),
        student_lrn="090000000003",
        first_name="Carlo",
        last_name="Reyes",
        academic_level_id=level_9.academic_level_id,
    )
    db.add_all([student_g11_med, student_g12_eng, student_g9_jhs])
    db.flush()

    # Enrollments
    db.add_all([
        StudentClass(student_id=student_g11_med.student_id, class_id=class_g11_med.class_id, academic_year_id=year.academic_year_id, enrollment_status="enrolled"),
        StudentClass(student_id=student_g12_eng.student_id, class_id=class_g12_eng.class_id, academic_year_id=year.academic_year_id, enrollment_status="enrolled"),
        StudentClass(student_id=student_g9_jhs.student_id, class_id=class_g9_jhs.class_id, academic_year_id=year.academic_year_id, enrollment_status="enrolled"),
    ])

    # Subject Loads
    for s_id, c_id in [
        (subject_bio1.subject_id, class_g11_med.class_id),
        (subject_invalid_weights.subject_id, class_g11_med.class_id),
        (subject_precal.subject_id, class_g12_eng.class_id),
        (subject_empotech.subject_id, class_g12_eng.class_id),
        (subject_eng9.subject_id, class_g9_jhs.class_id),
        (subject_tle9.subject_id, class_g9_jhs.class_id),
    ]:
        db.add(SubjectLoad(
            staff_id=staff.staff_id,
            subject_id=s_id,
            class_id=c_id,
            academic_period_id=period_active.academic_period_id,
            status="active",
            is_active_version=True,
        ))
    db.commit()

    # Register Corrected RF Model in AIModelVersion registry
    schema = scorer.load_development_current_term_schema(CORRECTED_MODEL_NAME)
    digest = sha256(json.dumps(schema, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    model_art_path = artifact_path(CORRECTED_MODEL_NAME)
    art_hash = sha256(model_art_path.read_bytes()).hexdigest()

    model_version = AIModelVersion(
        model_name=CORRECTED_MODEL_NAME,
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value,
        algorithm="RandomForestRegressor",
        target_column="target_final_period_grade",
        lifecycle_status="DEVELOPMENT",
        production_validated=False,
        independent_three_term_validation=False,
        is_active=False,
        artifact_path=f"data/models/{model_art_path.name}",
        feature_schema_json=schema,
        registry_metadata_json={
            "supported_subjects": sorted(prediction_service.SUPPORTED_SUBJECTS),
            "supported_weight_patterns": sorted(prediction_service.SUPPORTED_WEIGHT_PATTERNS),
            "period_semantics": "SOURCE_EQUALS_TARGET_SAME_TERM",
            "feature_schema_sha256": digest,
            "feature_schema_version": f"sha256:{digest}",
            "artifact_sha256": art_hash,
            "training_dataset_version": "candidate-eval-v1",
        },
    )
    db.add(model_version)
    db.commit()

    # Configure application settings for development prediction testing
    monkeypatch.setattr(settings, "app_environment", "development")
    monkeypatch.setattr(settings, "development_prediction_api_enabled", True)
    monkeypatch.setattr(settings, "development_current_term_model_name", CORRECTED_MODEL_NAME)

    context = {
        "db": db,
        "engine": engine,
        "year": year,
        "period_active": period_active,
        "period_inactive": period_inactive,
        "level_11": level_11,
        "level_12": level_12,
        "level_9": level_9,
        "staff": staff,
        "class_g11_med": class_g11_med,
        "class_g12_eng": class_g12_eng,
        "class_g9_jhs": class_g9_jhs,
        "subject_bio1": subject_bio1,
        "subject_precal": subject_precal,
        "subject_empotech": subject_empotech,
        "subject_invalid_weights": subject_invalid_weights,
        "subject_eng9": subject_eng9,
        "subject_tle9": subject_tle9,
        "student_g11_med": student_g11_med,
        "student_g12_eng": student_g12_eng,
        "student_g9_jhs": student_g9_jhs,
        "model_version_id": model_version.model_version_id,
        "model_version": model_version,
    }

    yield context

    db.close()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def add_classwork_activity(
    ctx: dict,
    *,
    student_id: uuid.UUID,
    class_id: int,
    subject_id: int,
    period_id: int,
    category: str,
    score: float,
    max_score: float = 100.0,
) -> tuple[ClassworkAssignment, StudentSubmission]:
    """Helper to record graded classwork activity and submission in the isolated DB."""
    db = ctx["db"]
    classwork = Classwork(
        title=f"{category} Activity {uuid.uuid4().hex[:6]}",
        subject_id=subject_id,
        created_by_staff_id=ctx["staff"].staff_id,
        classwork_type="QUIZ" if category == "WRITTEN_WORK" else "ACTIVITY",
        classwork_category=category,
        total_points=Decimal(str(max_score)),
        is_graded=True,
        is_published=True,
        is_archived=False,
    )
    db.add(classwork)
    db.flush()

    assignment = ClassworkAssignment(
        classwork_id=classwork.classwork_id,
        class_id=class_id,
        academic_period_id=period_id,
        assigned_by_staff_id=ctx["staff"].staff_id,
        assigned_at=datetime.now(timezone.utc),
        publish_date=datetime.now(timezone.utc),
        due_date=datetime.now(timezone.utc),
        is_published=True,
    )
    db.add(assignment)
    db.flush()

    submission = StudentSubmission(
        classwork_assignment_id=assignment.classwork_assignment_id,
        student_id=student_id,
        submitted_at=datetime.now(timezone.utc),
        graded_at=datetime.now(timezone.utc),
        grade=Decimal(str(score)),
        status="graded",
        graded_by_staff_id=ctx["staff"].staff_id,
    )
    db.add(submission)
    db.commit()
    return assignment, submission


def populate_ready_evidence(
    ctx: dict,
    *,
    student_id: uuid.UUID,
    class_id: int,
    subject_id: int,
    period_id: int,
    ww_scores: tuple[float, float] = (85.0, 90.0),
    pt_scores: tuple[float, float] = (80.0, 85.0),
    qa_score: float | None = 82.0,
):
    """Populate minimum >= 4 activities (2 WW, 2 PT, and optional QA) to satisfy prediction readiness."""
    add_classwork_activity(ctx, student_id=student_id, class_id=class_id, subject_id=subject_id, period_id=period_id, category="WRITTEN_WORK", score=ww_scores[0])
    add_classwork_activity(ctx, student_id=student_id, class_id=class_id, subject_id=subject_id, period_id=period_id, category="WRITTEN_WORK", score=ww_scores[1])
    add_classwork_activity(ctx, student_id=student_id, class_id=class_id, subject_id=subject_id, period_id=period_id, category="PERFORMANCE_TASK", score=pt_scores[0])
    add_classwork_activity(ctx, student_id=student_id, class_id=class_id, subject_id=subject_id, period_id=period_id, category="PERFORMANCE_TASK", score=pt_scores[1])
    if qa_score is not None:
        add_classwork_activity(ctx, student_id=student_id, class_id=class_id, subject_id=subject_id, period_id=period_id, category="QUARTERLY_ASSESSMENT", score=qa_score)


# ==============================================================================
# 1. Test Eligible Grade 11 & 12 in STEM Medical and Engineering
# 2. Verify Full Prediction Pipeline (Classwork -> Features -> RF -> Risk -> Persistence -> Dashboard)
# 5. Confirm SHS Predictions Display Provisional Status
# ==============================================================================

def test_end_to_end_shs_grade_11_stem_medical_workflow(shs_workflow_context):
    ctx = shs_workflow_context
    student = ctx["student_g11_med"]
    class_ = ctx["class_g11_med"]
    subject = ctx["subject_bio1"]
    period = ctx["period_active"]

    # 1. Populate realistic classwork scores for STEM Medical (BIO1, 20/50/30)
    # 2 WW, 2 PT, 1 QA = 5 activities, observed weight sum = 100% (>= 70%)
    populate_ready_evidence(
        ctx,
        student_id=student.student_id,
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        period_id=period.academic_period_id,
        ww_scores=(88.0, 92.0),
        pt_scores=(84.0, 86.0),
        qa_score=80.0,
    )

    # 2. Generate and persist prediction
    result = persistence_service.generate_and_persist_development_current_term(
        student.student_id,
        class_.class_id,
        subject.subject_id,
        period.academic_period_id,
        model_version_id=ctx["model_version_id"],
        bind=ctx["engine"],
    )

    # Verify persistence response
    assert result["persisted"] is True
    assert result["prediction_status"] == prediction_service.STATUS_DEVELOPMENT_PREDICTION_AVAILABLE
    assert result["readiness_status"] == "READY"
    assert result["is_provisional"] is True
    assert result["validation_status"] == "PROVISIONAL_UNVALIDATED_SHS"
    assert result["projected_final_term_grade"] is not None
    assert result["intervention_level"] in ("HIGH_RISK", "MODERATE_RISK", "NEEDS_MONITORING", "LOW_RISK")

    # 3. Verify database row & snapshot immutability
    row = ctx["db"].query(DevelopmentCurrentTermPrediction).filter_by(prediction_id=result["prediction_id"]).one()
    snapshot = row.evidence_snapshot
    assert snapshot["normalized_subject"] == "SCIENCE"
    assert snapshot["grading_weight_pattern"] == "20/50/30"
    assert snapshot["is_provisional"] is True
    assert snapshot["validation_status"] == "PROVISIONAL_UNVALIDATED_SHS"
    assert len(snapshot["model_features"]) == 31

    # 4. Verify teacher dashboard read service
    dashboard_data = read_service.list_latest_development_current_term_predictions(
        ctx["db"],
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        academic_period_id=period.academic_period_id,
        model_version_id=ctx["model_version_id"],
    )
    assert dashboard_data["total"] == 1
    item = dashboard_data["items"][0]
    assert item["student_name"] == "Santos, Maria"
    assert item["class_name"] == "Grade 11 - Fleming (STEM Medical)"
    assert item["subject_codename"] == "BIO1"
    assert item["is_provisional"] is True
    assert item["validation_status"] == "PROVISIONAL_UNVALIDATED_SHS"
    assert item["projected_final_term_grade"] == pytest.approx(result["projected_final_term_grade"], abs=0.01)
    assert item["intervention_level"] == result["intervention_level"]


def test_end_to_end_shs_grade_12_stem_engineering_workflow(shs_workflow_context):
    ctx = shs_workflow_context
    student = ctx["student_g12_eng"]
    class_ = ctx["class_g12_eng"]
    subject = ctx["subject_precal"]
    period = ctx["period_active"]

    # 1. Populate classwork scores for STEM Engineering (Precalculus, 20/50/30)
    populate_ready_evidence(
        ctx,
        student_id=student.student_id,
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        period_id=period.academic_period_id,
        ww_scores=(90.0, 95.0),
        pt_scores=(92.0, 94.0),
        qa_score=90.0,
    )

    # 2. Persist prediction
    result = persistence_service.generate_and_persist_development_current_term(
        student.student_id,
        class_.class_id,
        subject.subject_id,
        period.academic_period_id,
        model_version_id=ctx["model_version_id"],
        bind=ctx["engine"],
    )

    assert result["persisted"] is True
    assert result["is_provisional"] is True
    assert result["validation_status"] == "PROVISIONAL_UNVALIDATED_SHS"

    row = ctx["db"].query(DevelopmentCurrentTermPrediction).filter_by(prediction_id=result["prediction_id"]).one()
    assert row.evidence_snapshot["normalized_subject"] == "MATHEMATICS"
    assert row.evidence_snapshot["grading_weight_pattern"] == "20/50/30"


def test_shs_grade_12_applied_subject_20_60_20_pattern(shs_workflow_context):
    ctx = shs_workflow_context
    student = ctx["student_g12_eng"]
    class_ = ctx["class_g12_eng"]
    subject = ctx["subject_empotech"]  # Applied subject: 20/60/20
    period = ctx["period_active"]

    # 1. Populate classwork scores for Applied subject
    populate_ready_evidence(
        ctx,
        student_id=student.student_id,
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        period_id=period.academic_period_id,
        ww_scores=(82.0, 88.0),
        pt_scores=(85.0, 90.0),
        qa_score=80.0,
    )

    # 2. Persist prediction
    result = persistence_service.generate_and_persist_development_current_term(
        student.student_id,
        class_.class_id,
        subject.subject_id,
        period.academic_period_id,
        model_version_id=ctx["model_version_id"],
        bind=ctx["engine"],
    )

    assert result["persisted"] is True
    assert result["is_provisional"] is True
    assert result["validation_status"] == "PROVISIONAL_UNVALIDATED_SHS"

    row = ctx["db"].query(DevelopmentCurrentTermPrediction).filter_by(prediction_id=result["prediction_id"]).one()
    assert row.evidence_snapshot["normalized_subject"] == "ICT"
    assert row.evidence_snapshot["grading_weight_pattern"] == "20/60/20"


# ==============================================================================
# 3. Confirm Predictions Automatically Refresh When Grades Change
# 4. Verify Intervention Candidates Are Correctly Generated and Updated
# ==============================================================================

def test_automatic_refresh_and_intervention_sync_on_grade_change(shs_workflow_context):
    ctx = shs_workflow_context
    student = ctx["student_g11_med"]
    class_ = ctx["class_g11_med"]
    subject = ctx["subject_bio1"]
    period = ctx["period_active"]

    # 1. Start with struggling scores (50% on WW, PT, and QA)
    populate_ready_evidence(
        ctx,
        student_id=student.student_id,
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        period_id=period.academic_period_id,
        ww_scores=(50.0, 50.0),
        pt_scores=(50.0, 50.0),
        qa_score=50.0,
    )

    # Initial prediction generation: revision 1
    result_1 = persistence_service.generate_and_persist_development_current_term(
        student.student_id,
        class_.class_id,
        subject.subject_id,
        period.academic_period_id,
        model_version_id=ctx["model_version_id"],
        bind=ctx["engine"],
    )
    assert result_1["persisted"] is True
    assert result_1["revision"] == 1
    assert result_1["projected_final_term_grade"] < 84.0
    assert result_1["intervention_level"] in ("HIGH_RISK", "MODERATE_RISK")

    # Confirmed: Intervention candidate was automatically generated!
    intervention = ctx["db"].query(Intervention).filter_by(
        student_id=student.student_id,
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        academic_period_id=period.academic_period_id,
    ).one()
    assert intervention.status == "CANDIDATE"
    assert intervention.source_prediction_id == result_1["prediction_id"]

    # 2. Student completes multiple makeup activities with excellent performance (100%)
    for i in range(4):
        add_classwork_activity(ctx, student_id=student.student_id, class_id=class_.class_id, subject_id=subject.subject_id, period_id=period.academic_period_id, category="PERFORMANCE_TASK", score=100.0, max_score=100.0)
    for i in range(2):
        add_classwork_activity(ctx, student_id=student.student_id, class_id=class_.class_id, subject_id=subject.subject_id, period_id=period.academic_period_id, category="WRITTEN_WORK", score=100.0, max_score=100.0)

    # 3. Grade commit triggers automatic refresh
    refresh_after_committed_grade_change(
        ctx["engine"],
        student_ids=[student.student_id],
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        period_id=period.academic_period_id,
    )

    # 4. Verify a new revision was automatically created in the database
    predictions = ctx["db"].query(DevelopmentCurrentTermPrediction).filter_by(
        student_id=student.student_id,
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        source_period_id=period.academic_period_id,
    ).order_by(DevelopmentCurrentTermPrediction.revision.asc()).all()

    assert len(predictions) == 2
    pred_2 = predictions[1]
    assert pred_2.revision == 2
    assert float(pred_2.predicted_period_grade) > float(predictions[0].predicted_period_grade)

    # 5. Verify intervention candidate status was updated upon improvement
    ctx["db"].refresh(intervention)
    assert float(pred_2.predicted_period_grade) >= 84.0
    assert intervention.status == "RESOLVED"
    assert intervention.resolution_reason == "IMPROVED_PREDICTION"
    assert intervention.resolved_at is not None


# ==============================================================================
# 6. Test Insufficient Data, Unsupported Weights, and Term Restrictions
# ==============================================================================

def test_shs_insufficient_evidence_blocks_prediction(shs_workflow_context):
    ctx = shs_workflow_context
    student = ctx["student_g11_med"]
    class_ = ctx["class_g11_med"]
    subject = ctx["subject_bio1"]
    period = ctx["period_active"]

    # Only 1 activity created (Written Work weight 20%, < 70% minimum threshold)
    add_classwork_activity(ctx, student_id=student.student_id, class_id=class_.class_id, subject_id=subject.subject_id, period_id=period.academic_period_id, category="WRITTEN_WORK", score=85.0, max_score=100.0)

    result = persistence_service.generate_and_persist_development_current_term(
        student.student_id,
        class_.class_id,
        subject.subject_id,
        period.academic_period_id,
        model_version_id=ctx["model_version_id"],
        bind=ctx["engine"],
    )

    assert result["persisted"] is False
    assert result["prediction_status"] == prediction_service.STATUS_INSUFFICIENT_EVIDENCE
    assert result["readiness_status"] == "NOT_READY"
    assert result["intervention_level"] == "INTERVENTION_NOT_ASSESSED"

    # Confirmed: no prediction row and no intervention candidate created
    assert ctx["db"].query(DevelopmentCurrentTermPrediction).count() == 0
    assert ctx["db"].query(Intervention).count() == 0


def test_shs_unsupported_weights_blocks_prediction(shs_workflow_context):
    ctx = shs_workflow_context
    student = ctx["student_g11_med"]
    class_ = ctx["class_g11_med"]
    subject = ctx["subject_invalid_weights"]  # 20/40/40 pattern
    period = ctx["period_active"]

    # Provide 4 activities so readiness criteria is satisfied but weights are invalid (20/40/40)
    populate_ready_evidence(
        ctx,
        student_id=student.student_id,
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        period_id=period.academic_period_id,
        ww_scores=(80.0, 85.0),
        pt_scores=(80.0, 85.0),
        qa_score=80.0,
    )

    result = persistence_service.generate_and_persist_development_current_term(
        student.student_id,
        class_.class_id,
        subject.subject_id,
        period.academic_period_id,
        model_version_id=ctx["model_version_id"],
        bind=ctx["engine"],
    )

    assert result["persisted"] is False
    assert result["prediction_status"] == prediction_service.STATUS_UNSUPPORTED_DEVELOPMENT_DOMAIN
    assert "UNSUPPORTED_WEIGHT_PATTERN" in result["reason_codes"]
    assert ctx["db"].query(DevelopmentCurrentTermPrediction).count() == 0


def test_inactive_academic_term_blocks_prediction(shs_workflow_context):
    ctx = shs_workflow_context
    student = ctx["student_g11_med"]
    class_ = ctx["class_g11_med"]
    subject = ctx["subject_bio1"]
    period = ctx["period_inactive"]  # is_active == False

    populate_ready_evidence(
        ctx,
        student_id=student.student_id,
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        period_id=period.academic_period_id,
    )

    result = persistence_service.generate_and_persist_development_current_term(
        student.student_id,
        class_.class_id,
        subject.subject_id,
        period.academic_period_id,
        model_version_id=ctx["model_version_id"],
        bind=ctx["engine"],
    )

    assert result["persisted"] is False
    assert result["prediction_status"] == prediction_service.STATUS_PERIOD_NOT_ACTIVE
    assert "PERIOD_NOT_ACTIVE" in result["reason_codes"]
    assert ctx["db"].query(DevelopmentCurrentTermPrediction).count() == 0


# ==============================================================================
# 7. Confirm Grade 7–10 Predictions Remain Completely Unchanged
# ==============================================================================

def test_grade_7_to_10_jhs_verified_subject_preserves_behavior(shs_workflow_context):
    ctx = shs_workflow_context
    student = ctx["student_g9_jhs"]
    class_ = ctx["class_g9_jhs"]
    subject = ctx["subject_eng9"]  # Verified JHS: ENG9 -> ENGLISH
    period = ctx["period_active"]

    # Provide ready evidence
    populate_ready_evidence(
        ctx,
        student_id=student.student_id,
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        period_id=period.academic_period_id,
        ww_scores=(88.0, 92.0),
        pt_scores=(85.0, 87.0),
        qa_score=84.0,
    )

    result = persistence_service.generate_and_persist_development_current_term(
        student.student_id,
        class_.class_id,
        subject.subject_id,
        period.academic_period_id,
        model_version_id=ctx["model_version_id"],
        bind=ctx["engine"],
    )

    assert result["persisted"] is True
    # For JHS, confirmed: is_provisional is False, validation_status is VALIDATED_JHS!
    assert result["is_provisional"] is False
    assert result["validation_status"] == "VALIDATED_JHS"

    row = ctx["db"].query(DevelopmentCurrentTermPrediction).filter_by(prediction_id=result["prediction_id"]).one()
    assert row.evidence_snapshot["is_provisional"] is False
    assert row.evidence_snapshot["validation_status"] == "VALIDATED_JHS"
    assert row.evidence_snapshot["normalized_subject"] == "ENGLISH"

    dashboard = read_service.list_latest_development_current_term_predictions(
        ctx["db"],
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        academic_period_id=period.academic_period_id,
        model_version_id=ctx["model_version_id"],
    )
    assert dashboard["total"] == 1
    assert dashboard["items"][0]["is_provisional"] is False
    assert dashboard["items"][0]["validation_status"] == "VALIDATED_JHS"


def test_grade_7_to_10_jhs_unmapped_subject_scores_provisional(shs_workflow_context):
    ctx = shs_workflow_context
    student = ctx["student_g9_jhs"]
    class_ = ctx["class_g9_jhs"]
    subject = ctx["subject_tle9"]  # TLE 9 -> uses RF unknown-category handling, PROVISIONAL
    period = ctx["period_active"]

    populate_ready_evidence(
        ctx,
        student_id=student.student_id,
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        period_id=period.academic_period_id,
        ww_scores=(85.0, 88.0),
        pt_scores=(80.0, 85.0),
        qa_score=80.0,
    )

    result = persistence_service.generate_and_persist_development_current_term(
        student.student_id,
        class_.class_id,
        subject.subject_id,
        period.academic_period_id,
        model_version_id=ctx["model_version_id"],
        bind=ctx["engine"],
    )

    assert result["persisted"] is True
    assert result["prediction_status"] == prediction_service.STATUS_DEVELOPMENT_PREDICTION_AVAILABLE
    assert result["is_provisional"] is True
    assert result["validation_status"] == "PROVISIONAL"
    assert result["projected_final_term_grade"] is not None
