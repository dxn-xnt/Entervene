"""Targeted tests for Task 3: Early Intervention Candidate Eligibility."""

from __future__ import annotations

from copy import deepcopy
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.models.academic.StudentCLass import StudentClass
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.intervention.Intervention import Intervention
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention.TeacherInterventionService import (
    activate_teacher_candidate,
    get_teacher_candidate,
    list_teacher_candidates,
)
from app.services.prediction import DevelopmentCurrentTermScoringService as scorer
from tests.test_current_period_live_feature_builder import add_activity, current_period_context  # noqa: F401
from tests.test_development_current_term_prediction_persistence import _run
from tests.test_intervention_candidate_sync import _interventions, _setup


def _ensure_teacher_scope(ctx):
    db = ctx["db"]
    if not db.query(StudentClass).filter_by(
        student_id=ctx["student"].student_id,
        academic_year_id=ctx["class"].academic_year_id,
    ).first():
        db.add(StudentClass(
            student_id=ctx["student"].student_id,
            class_id=ctx["class"].class_id,
            academic_year_id=ctx["class"].academic_year_id,
            enrollment_status="enrolled",
        ))
    if not db.query(SubjectLoad).filter_by(
        staff_id=ctx["staff"].staff_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
    ).first():
        db.add(SubjectLoad(
            staff_id=ctx["staff"].staff_id,
            class_id=ctx["class"].class_id,
            subject_id=ctx["subject"].subject_id,
            academic_period_id=ctx["period"].academic_period_id,
            status="published",
            is_active_version=True,
        ))
    db.commit()


@pytest.mark.parametrize(
    "grade,expected_level",
    [
        (72.0, "HIGH_RISK"),
        (82.0, "MODERATE_RISK"),
    ],
)
def test_high_risk_and_moderate_risk_below_target_create_and_activate(
    current_period_context, monkeypatch, grade, expected_level,
):
    ctx = current_period_context
    _ensure_teacher_scope(ctx)
    model_id = _setup(ctx, monkeypatch, [grade, grade])

    first = _run(ctx, model_id)
    rows = _interventions(ctx)
    assert len(rows) == 1
    assert rows[0].status == "CANDIDATE"
    assert rows[0].source_prediction_id == first["prediction_id"]

    listed = list_teacher_candidates(ctx["db"], ctx["staff"].staff_id)
    assert listed.total == 1
    summary = listed.items[0]
    assert summary.triggering_intervention_level == expected_level
    assert summary.current_intervention_level == expected_level
    assert summary.candidate_activation_eligible is True
    assert summary.candidate_activation_reason is None

    activated = activate_teacher_candidate(ctx["db"], ctx["staff"].staff_id, rows[0].intervention_id)
    assert activated.status == "ACTIVE"
    assert activated.source_prediction_id == first["prediction_id"]


def test_high_risk_at_or_above_configured_target_does_not_create_candidate(
    current_period_context, monkeypatch,
):
    ctx = current_period_context
    _ensure_teacher_scope(ctx)
    ctx["template"].passing_threshold = Decimal("70.00")
    ctx["db"].commit()
    model_id = _setup(ctx, monkeypatch, [74.0])

    result = _run(ctx, model_id)
    assert result["persisted"] is True
    assert result["intervention_level"] == "HIGH_RISK"
    assert _interventions(ctx) == []


@pytest.mark.parametrize("grade", [85.44, 87.0, 91.5])
def test_needs_monitoring_and_low_risk_on_empty_scope_do_not_create_candidate(
    current_period_context, monkeypatch, grade,
):
    ctx = current_period_context
    _ensure_teacher_scope(ctx)
    assert float(ctx["template"].passing_threshold) == 87.0
    model_id = _setup(ctx, monkeypatch, [grade])

    result = _run(ctx, model_id)
    assert result["persisted"] is True
    assert _interventions(ctx) == []


@pytest.mark.parametrize(
    "initial_grade,revised_grade,expected_initial_level,expected_revised_level",
    [
        (84.0, 72.0, "MODERATE_RISK", "HIGH_RISK"),
        (84.0, 85.5, "MODERATE_RISK", "NEEDS_MONITORING"),
        (72.0, 82.0, "HIGH_RISK", "MODERATE_RISK"),
        (72.0, 85.5, "HIGH_RISK", "NEEDS_MONITORING"),
    ],
)
def test_candidate_retains_activation_eligibility_when_risk_classification_changes_below_target(
    current_period_context,
    monkeypatch,
    initial_grade,
    revised_grade,
    expected_initial_level,
    expected_revised_level,
):
    ctx = current_period_context
    _ensure_teacher_scope(ctx)
    assert float(ctx["template"].passing_threshold) == 87.0
    model_id = _setup(ctx, monkeypatch, [initial_grade])

    first = _run(ctx, model_id)
    candidate = _interventions(ctx)[0]
    frozen_snapshot = deepcopy(candidate.diagnosis_snapshot)
    assert candidate.status == "CANDIDATE"
    assert candidate.source_prediction_id == first["prediction_id"]

    # Revise evidence so a new prediction revision changes risk band while staying below 87.0
    add_activity(ctx, "PERFORMANCE_TASK", 14, 20)
    monkeypatch.setattr(scorer, "score_development_current_term", lambda _features, model_name=None: revised_grade)
    second = _run(ctx, model_id)
    assert second["revision"] == 2

    rows = _interventions(ctx)
    assert len(rows) == 1
    assert rows[0].status == "CANDIDATE"
    assert rows[0].source_prediction_id == first["prediction_id"]

    detail = get_teacher_candidate(ctx["db"], ctx["staff"].staff_id, candidate.intervention_id)
    assert detail.triggering_intervention_level == expected_initial_level
    assert detail.current_intervention_level == expected_revised_level
    assert detail.current_predicted_grade == revised_grade
    assert detail.candidate_activation_eligible is True
    assert detail.candidate_activation_reason is None

    # Activation revalidates the latest prediction and succeeds, preserving trigger & snapshot
    activated = activate_teacher_candidate(ctx["db"], ctx["staff"].staff_id, candidate.intervention_id)
    assert activated.status == "ACTIVE"
    assert activated.source_prediction_id == first["prediction_id"]
    assert activated.diagnosis_snapshot == frozen_snapshot


def test_candidate_revalidation_before_activation_auto_resolves_when_target_reached(
    current_period_context, monkeypatch,
):
    ctx = current_period_context
    _ensure_teacher_scope(ctx)
    assert float(ctx["template"].passing_threshold) == 87.0
    model_id = _setup(ctx, monkeypatch, [72.0])

    first = _run(ctx, model_id)
    candidate = _interventions(ctx)[0]
    assert candidate.status == "CANDIDATE"

    # New graded evidence changes live features; teacher tries to activate before manual refresh
    submission = ctx["db"].query(StudentSubmission).first()
    submission.grade = Decimal("20")
    ctx["db"].commit()
    monkeypatch.setattr(scorer, "score_development_current_term", lambda _features, model_name=None: 87.5)

    with pytest.raises(HTTPException) as exc:
        activate_teacher_candidate(ctx["db"], ctx["staff"].staff_id, candidate.intervention_id)
    assert exc.value.status_code == 409

    rows = _interventions(ctx)
    assert len(rows) == 1
    assert rows[0].status == "RESOLVED"
    assert rows[0].resolution_reason == "IMPROVED_PREDICTION"
    assert rows[0].activated_at is None
    assert rows[0].source_prediction_id == first["prediction_id"]


def test_duplicate_protection_and_history_preservation_for_high_and_moderate_risk(
    current_period_context, monkeypatch,
):
    ctx = current_period_context
    _ensure_teacher_scope(ctx)
    model_id = _setup(ctx, monkeypatch, [72.0])

    # Rev 1: HIGH_RISK -> creates first CANDIDATE
    rev1 = _run(ctx, model_id)
    rows = _interventions(ctx)
    assert len(rows) == 1
    first_id = rows[0].intervention_id
    first_snapshot = deepcopy(rows[0].diagnosis_snapshot)

    # Rev 2: still HIGH_RISK -> no duplicate, preserves original trigger & snapshot
    add_activity(ctx, "WRITTEN_WORK", 5, 10)
    monkeypatch.setattr(scorer, "score_development_current_term", lambda _features, model_name=None: 70.0)
    _run(ctx, model_id)
    rows = _interventions(ctx)
    assert len(rows) == 1
    assert rows[0].intervention_id == first_id
    assert rows[0].source_prediction_id == rev1["prediction_id"]
    assert rows[0].diagnosis_snapshot == first_snapshot

    # Rev 3: improves to >= 87.0 -> auto-resolves CANDIDATE
    add_activity(ctx, "PERFORMANCE_TASK", 20, 20)
    monkeypatch.setattr(scorer, "score_development_current_term", lambda _features, model_name=None: 88.0)
    _run(ctx, model_id)
    rows = _interventions(ctx)
    assert len(rows) == 1
    assert rows[0].status == "RESOLVED"
    assert rows[0].resolution_reason == "IMPROVED_PREDICTION"

    # Rev 4: drops back to HIGH_RISK -> preserves RESOLVED history row and creates one new CANDIDATE
    add_activity(ctx, "WRITTEN_WORK", 2, 10)
    monkeypatch.setattr(scorer, "score_development_current_term", lambda _features, model_name=None: 71.0)
    rev4 = _run(ctx, model_id)
    rows = _interventions(ctx)
    assert len(rows) == 2
    assert [r.status for r in rows] == ["RESOLVED", "CANDIDATE"]
    assert rows[0].intervention_id == first_id
    assert rows[0].source_prediction_id == rev1["prediction_id"]
    assert rows[1].source_prediction_id == rev4["prediction_id"]
