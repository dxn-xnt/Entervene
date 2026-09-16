"""Unit tests verifying the Task 6E Outcome-Evaluation Revision Policy."""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from decimal import Decimal
import uuid

import pytest
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.AIPrediction import AIPrediction
from app.models.people.Student import Student
from tests.outcome_evaluation_helper import evaluate_dual_purpose_outcomes, compute_error_metrics


@pytest.fixture
def eval_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    lrn_check = next((c for c in Student.__table__.constraints if isinstance(c, CheckConstraint) and c.name == "lrn_check"), None)
    if lrn_check and lrn_check in Student.__table__.constraints:
        Student.__table__.constraints.remove(lrn_check)
    try:
        Base.metadata.create_all(bind=engine)
    finally:
        if lrn_check and lrn_check not in Student.__table__.constraints:
            Student.__table__.append_constraint(lrn_check)

    Session = sessionmaker(bind=engine)
    session = Session()

    from datetime import date
    year = AcademicYear(year_label="2026-2027", start_date=date(2026, 6, 1), end_date=date(2027, 3, 31), is_active=True)
    level = AcademicLevel(level_name="Grade 9", grade_level=9)
    session.add_all([year, level])
    session.flush()

    p1 = AcademicPeriod(
        academic_year_id=year.academic_year_id,
        period_name="Term 1",
        period_sequence=1,
        period_type="TERM",
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.3333"),
        start_date=date(2026, 6, 1),
        end_date=date(2026, 8, 31),
        is_active=False,
    )
    p2 = AcademicPeriod(
        academic_year_id=year.academic_year_id,
        period_name="Term 2",
        period_sequence=2,
        period_type="TERM",
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.6667"),
        start_date=date(2026, 9, 1),
        end_date=date(2026, 11, 30),
        is_active=True,
    )
    session.add_all([p1, p2])
    session.flush()

    cls = Class(section_name="Emerald", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
    subj = Subject(subject_name="Science 9", subject_codename="SCI9", academic_level_id=level.academic_level_id)
    session.add_all([cls, subj])
    session.flush()

    # Models
    next_model = AIModelVersion(
        model_name="entervene_next_period_grade_rf",
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value,
        algorithm="RandomForestRegressor",
        is_active=True,
    )
    current_model = AIModelVersion(
        model_name="entervene_current_period_grade_rf_v1",
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value,
        algorithm="RandomForestRegressor",
        is_active=True,
    )
    session.add_all([next_model, current_model])
    session.flush()

    yield {
        "db": session,
        "year": year,
        "p1": p1,
        "p2": p2,
        "cls": cls,
        "subj": subj,
        "next_model": next_model,
        "current_model": current_model,
    }
    session.close()


def test_primary_evaluation_selects_latest_before_finalization_not_smallest_error(eval_db):
    """Verify primary runtime evaluation does NOT cherry pick smallest error revision."""
    db = eval_db["db"]
    p2 = eval_db["p2"]
    cls = eval_db["cls"]
    subj = eval_db["subj"]
    current_model = eval_db["current_model"]

    student = Student(student_id=uuid.uuid4(), student_lrn="111111111111", first_name="Golden", last_name="Student")
    db.add(student)
    db.flush()

    # Actual grade is 88.0, finalized at T_final
    t_base = datetime(2026, 9, 10, 10, 0, 0, tzinfo=timezone.utc)
    t_rev1 = t_base
    t_rev2 = t_base + timedelta(hours=2)
    t_final = t_base + timedelta(hours=4)

    # Revision 1 predicted 88.0 (error = 0.0)
    pred_v1 = AIPrediction(
        student_id=student.student_id,
        class_id=cls.class_id,
        subject_id=subj.subject_id,
        source_period_id=p2.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=current_model.model_version_id,
        predicted_period_grade=Decimal("88.00"),
        revision=1,
        generated_at=t_rev1,
    )
    # Revision 2 predicted 85.0 (error = +3.0) - created later, before finalization
    pred_v2 = AIPrediction(
        student_id=student.student_id,
        class_id=cls.class_id,
        subject_id=subj.subject_id,
        source_period_id=p2.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=current_model.model_version_id,
        predicted_period_grade=Decimal("85.00"),
        revision=2,
        generated_at=t_rev2,
    )
    db.add_all([pred_v1, pred_v2])
    db.flush()

    # Finalized grade
    spg = StudentPeriodGrade(
        student_id=student.student_id,
        class_id=cls.class_id,
        subject_id=subj.subject_id,
        academic_period_id=p2.academic_period_id,
        final_period_grade=Decimal("88.00"),
        is_finalized=True,
        finalized_at=t_final,
    )
    db.add(spg)
    db.commit()

    results = evaluate_dual_purpose_outcomes(db, academic_period_id=p2.academic_period_id)
    primary = results["current_period_projections"]["primary_runtime_evaluation"]

    # Must select Revision 2 (error = 3.0, MAE = 3.0), NOT cherry-pick Revision 1 (error = 0.0)
    assert primary["count"] == 1
    assert primary["samples"][0]["prediction_id"] == pred_v2.prediction_id
    assert primary["samples"][0]["revision"] == 2
    assert primary["mae"] == 3.0
    assert primary["median_absolute_error"] == 3.0

    # Historical breakdown still reports Revision 1 and Revision 2 separately
    revs = results["current_period_projections"]["historical_revisions_breakdown"]
    assert revs["revision_1"]["count"] == 1
    assert revs["revision_1"]["mae"] == 0.0
    assert revs["revision_2"]["count"] == 1
    assert revs["revision_2"]["mae"] == 3.0


def test_predictions_after_finalization_are_excluded_from_primary_evaluation(eval_db):
    """Verify that predictions generated AFTER finalization timestamp are excluded."""
    db = eval_db["db"]
    p2 = eval_db["p2"]
    cls = eval_db["cls"]
    subj = eval_db["subj"]
    current_model = eval_db["current_model"]

    student = Student(student_id=uuid.uuid4(), student_lrn="222222222222", first_name="Test", last_name="Student")
    db.add(student)
    db.flush()

    t_base = datetime(2026, 9, 10, 10, 0, 0, tzinfo=timezone.utc)
    t_final = t_base + timedelta(hours=2)
    t_post = t_base + timedelta(hours=5)

    # Valid pre-finalization prediction (rev 1)
    pred_pre = AIPrediction(
        student_id=student.student_id,
        class_id=cls.class_id,
        subject_id=subj.subject_id,
        source_period_id=p2.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=current_model.model_version_id,
        predicted_period_grade=Decimal("84.00"),
        revision=1,
        generated_at=t_base,
    )
    # Post-finalization prediction (rev 2)
    pred_post = AIPrediction(
        student_id=student.student_id,
        class_id=cls.class_id,
        subject_id=subj.subject_id,
        source_period_id=p2.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=current_model.model_version_id,
        predicted_period_grade=Decimal("90.00"),
        revision=2,
        generated_at=t_post,
    )
    db.add_all([pred_pre, pred_post])
    db.flush()

    spg = StudentPeriodGrade(
        student_id=student.student_id,
        class_id=cls.class_id,
        subject_id=subj.subject_id,
        academic_period_id=p2.academic_period_id,
        final_period_grade=Decimal("85.00"),
        is_finalized=True,
        finalized_at=t_final,
    )
    db.add(spg)
    db.commit()

    results = evaluate_dual_purpose_outcomes(db, academic_period_id=p2.academic_period_id)
    primary = results["current_period_projections"]["primary_runtime_evaluation"]

    # Primary must select pred_pre, ignoring pred_post
    assert primary["count"] == 1
    assert primary["samples"][0]["prediction_id"] == pred_pre.prediction_id
    assert primary["samples"][0]["revision"] == 1
    assert primary["mae"] == 1.0


def test_next_baseline_evaluated_strictly_against_target_period_grade(eval_db):
    """Verify NEXT baseline evaluates incoming Term 1 -> Term 2 forecast against Term 2 grade."""
    db = eval_db["db"]
    p1 = eval_db["p1"]
    p2 = eval_db["p2"]
    cls = eval_db["cls"]
    subj = eval_db["subj"]
    next_model = eval_db["next_model"]

    student = Student(student_id=uuid.uuid4(), student_lrn="333333333333", first_name="Baseline", last_name="Student")
    db.add(student)
    db.flush()

    # NEXT forecast: Term 1 -> Term 2
    next_pred = AIPrediction(
        student_id=student.student_id,
        class_id=cls.class_id,
        subject_id=subj.subject_id,
        source_period_id=p1.academic_period_id,
        target_period_id=p2.academic_period_id,
        model_version_id=next_model.model_version_id,
        predicted_period_grade=Decimal("86.00"),
        risk_level="LOW_RISK",
        revision=1,
        generated_at=datetime(2026, 9, 1, 12, 0, 0, tzinfo=timezone.utc),
    )
    db.add(next_pred)

    # Finalized grade for Term 2
    spg = StudentPeriodGrade(
        student_id=student.student_id,
        class_id=cls.class_id,
        subject_id=subj.subject_id,
        academic_period_id=p2.academic_period_id,
        final_period_grade=Decimal("87.50"),
        is_finalized=True,
    )
    db.add(spg)
    db.commit()

    results = evaluate_dual_purpose_outcomes(db, academic_period_id=p2.academic_period_id)
    next_metrics = results["next_period_baseline_forecasts"]["baseline_evaluation"]
    current_metrics = results["current_period_projections"]["primary_runtime_evaluation"]

    assert next_metrics["count"] == 1
    assert next_metrics["mae"] == 1.5
    assert next_metrics["within_pm_2"]["count"] == 1
    # Current metrics must remain 0 - zero cross-purpose blending!
    assert current_metrics["count"] == 0
