"""Focused integration tests for Task 6: backend remediation predicted-grade ceiling workflow."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.intervention.Intervention import Intervention
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.grading import MidtermRemediationProjectionService as midterm_service
from app.services.intervention.InterventionRemediationService import (
    PlanUpdate,
    get_workspace,
    project_subject_grade,
    save_plan,
)
from app.services.prediction import DevelopmentCurrentTermScoringService as current_term_scorer
from app.services.prediction.DevelopmentCurrentTermPredictionService import (
    STATUS_INSUFFICIENT_EVIDENCE,
)
from tests.test_current_period_live_feature_builder import add_activity, current_period_context
from tests.test_intervention_support_materials import _activate, _http
from tests.test_remediation_prediction_impact_and_status import _attach_linked_remediation
from tests.test_subject_grade_projection_api import _focused_targets, _path
from tests.test_teacher_intervention_review import candidate_context, _id, _staff


def test_save_plan_defaults_validates_separates_caps_and_locks_after_activity(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    _activate(ctx)
    target = _focused_targets(ctx)[0]
    component = target.classwork.classwork_category or "WRITTEN_WORK"

    # 1. Invalid predicted_grade_ceiling (> 85 or < 0) rejected with 422
    for bad_ceiling in (85.01, 90.0, 100.0, -1.0):
        with pytest.raises(HTTPException) as exc:
            save_plan(db, _staff(ctx), _id(ctx), PlanUpdate(
                teacher_choice="QUIZ",
                grade_treatment=component,
                target_assignment_ids=[target.classwork_assignment_id],
                score_adjustment_cap=80.0,
                predicted_grade_ceiling=bad_ceiling,
            ))
        assert exc.value.status_code == 422

    # 2. New graded plan defaults predicted_grade_ceiling to 85 while keeping score_adjustment_cap independent
    ws_default = save_plan(db, _staff(ctx), _id(ctx), PlanUpdate(
        teacher_choice="QUIZ",
        grade_treatment=component,
        target_assignment_ids=[target.classwork_assignment_id],
        score_adjustment_cap=90.0,
    ))
    assert ws_default["plan"]["predicted_grade_ceiling"] == 85.0
    assert ws_default["plan"]["score_adjustment_cap"] == 90.0

    # 3. Teacher can select a lower valid ceiling (e.g. 80.0) before activity creation
    ws_custom = save_plan(db, _staff(ctx), _id(ctx), PlanUpdate(
        teacher_choice="QUIZ",
        grade_treatment=component,
        target_assignment_ids=[target.classwork_assignment_id],
        score_adjustment_cap=75.0,
        predicted_grade_ceiling=80.0,
    ))
    assert ws_custom["plan"]["predicted_grade_ceiling"] == 80.0
    assert ws_custom["plan"]["score_adjustment_cap"] == 75.0

    # 4. PRACTICE_ONLY clears predicted_grade_ceiling to None
    ws_practice = save_plan(db, _staff(ctx), _id(ctx), PlanUpdate(
        teacher_choice="QUIZ",
        grade_treatment="PRACTICE_ONLY",
    ))
    assert ws_practice["plan"]["predicted_grade_ceiling"] is None

    # 5. Re-save graded plan at 82.5 and attach a remediation activity -> ceiling is locked (409)
    save_plan(db, _staff(ctx), _id(ctx), PlanUpdate(
        teacher_choice="QUIZ",
        grade_treatment=component,
        target_assignment_ids=[target.classwork_assignment_id],
        score_adjustment_cap=85.0,
        predicted_grade_ceiling=82.5,
    ))
    rem_cw = Classwork(
        title="Locked Remediation Quiz",
        classwork_type="QUIZ",
        classwork_category=component,
        is_graded=True,
        total_points=target.classwork.total_points,
        is_published=True,
        is_archived=False,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=_staff(ctx),
    )
    db.add(rem_cw)
    db.flush()
    rem_as = ClassworkAssignment(
        classwork_id=rem_cw.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=_staff(ctx),
        is_published=True,
        recipient_student_id=ctx["student"].student_id,
        source_intervention_id=_id(ctx),
        remediation_request_id=uuid4(),
    )
    db.add(rem_as)
    db.flush()
    db.add(RemediationAssignmentLink(
        original_assignment_id=target.classwork_assignment_id,
        remediation_assignment_id=rem_as.classwork_assignment_id,
        student_id=ctx["student"].student_id,
        source_intervention_id=_id(ctx),
        component=component,
        score_adjustment_cap=Decimal("85.00"),
        created_by_staff_id=_staff(ctx),
    ))
    db.commit()

    # Attempting to change predicted_grade_ceiling after activity creation fails with 409
    with pytest.raises(HTTPException) as lock_exc:
        save_plan(db, _staff(ctx), _id(ctx), PlanUpdate(
            teacher_choice="QUIZ",
            grade_treatment=component,
            target_assignment_ids=[target.classwork_assignment_id],
            score_adjustment_cap=85.0,
            predicted_grade_ceiling=80.0,
        ))
    assert lock_exc.value.status_code == 409

    # Re-saving unchanged ceiling (or omitting it) succeeds and preserves 82.5
    ws_unchanged = save_plan(db, _staff(ctx), _id(ctx), PlanUpdate(
        teacher_choice="QUIZ",
        grade_treatment=component,
        target_assignment_ids=[target.classwork_assignment_id],
    ))
    assert ws_unchanged["plan"]["predicted_grade_ceiling"] == 82.5


def test_legacy_plan_without_predicted_grade_ceiling_is_preserved_without_mutation(candidate_context, monkeypatch):
    ctx = candidate_context
    db = ctx["db"]
    _activate(ctx)
    target = _focused_targets(ctx)[0]
    component = target.classwork.classwork_category or "WRITTEN_WORK"

    # Seed a legacy plan directly in DB without predicted_grade_ceiling + an existing remediation activity
    row = db.get(Intervention, _id(ctx))
    row.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": component,
        "target_assignment_ids": [target.classwork_assignment_id],
        "score_adjustment_cap": 80.0,
        "selected_resources": [],
    }
    rem_cw = Classwork(
        title="Legacy Remediation",
        classwork_type="QUIZ",
        classwork_category=component,
        is_graded=True,
        total_points=target.classwork.total_points,
        is_published=True,
        is_archived=False,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=_staff(ctx),
    )
    db.add(rem_cw)
    db.flush()
    rem_as = ClassworkAssignment(
        classwork_id=rem_cw.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=_staff(ctx),
        is_published=True,
        recipient_student_id=ctx["student"].student_id,
        source_intervention_id=_id(ctx),
        remediation_request_id=uuid4(),
    )
    db.add(rem_as)
    db.flush()
    db.add(RemediationAssignmentLink(
        original_assignment_id=target.classwork_assignment_id,
        remediation_assignment_id=rem_as.classwork_assignment_id,
        student_id=ctx["student"].student_id,
        source_intervention_id=_id(ctx),
        component=component,
        score_adjustment_cap=Decimal("80.00"),
        created_by_staff_id=_staff(ctx),
    ))
    db.commit()

    outputs = iter((84.0, 89.0))
    monkeypatch.setattr(
        current_term_scorer,
        "score_development_current_term",
        lambda _features, model_name=None: next(outputs),
    )

    ws = get_workspace(db, _staff(ctx), _id(ctx))
    assert ws["plan"]["predicted_grade_ceiling"] is None
    assert "predicted_grade_ceiling" not in (db.get(Intervention, _id(ctx)).remediation_plan or {})
    impact = ws["prediction_impact"]
    assert impact["status"] == "AVAILABLE"
    assert impact["predicted_grade_ceiling"] is None
    assert impact["remediation_adjusted_max_predicted_grade"] is None
    assert impact["max_remediation_predicted_grade"] == 89.0
    assert impact["was_ceiling_applied"] is False

    # Re-saving legacy plan without predicted_grade_ceiling does not retroactively inject it
    save_plan(db, _staff(ctx), _id(ctx), PlanUpdate(
        teacher_choice="QUIZ",
        grade_treatment=component,
        target_assignment_ids=[target.classwork_assignment_id],
    ))
    db.refresh(row)
    assert "predicted_grade_ceiling" not in (row.remediation_plan or {})

    # Attempting to retroactively set a ceiling on a locked legacy plan returns 409
    with pytest.raises(HTTPException) as exc:
        save_plan(db, _staff(ctx), _id(ctx), PlanUpdate(
            teacher_choice="QUIZ",
            grade_treatment=component,
            target_assignment_ids=[target.classwork_assignment_id],
            predicted_grade_ceiling=85.0,
        ))
    assert exc.value.status_code == 409


def test_projection_api_and_workspace_impact_enforce_85_ceiling_and_preserve_regular_gains(
    candidate_context,
    monkeypatch,
):
    ctx = candidate_context
    db = ctx["db"]
    _activate(ctx)
    targets = _focused_targets(ctx)
    target_1, target_2 = targets[0], targets[1]
    component = target_1.classwork.classwork_category or "WRITTEN_WORK"

    # Lower target_1 and target_2 scores so remediation yields clear positive gain
    for t in (target_1, target_2):
        sub = db.query(StudentSubmission).filter_by(
            classwork_assignment_id=t.classwork_assignment_id,
            student_id=ctx["student"].student_id,
        ).one()
        sub.grade = Decimal("4")
    db.commit()

    # Save plan with predicted_grade_ceiling=85 and per-classwork cap=85
    save_plan(db, _staff(ctx), _id(ctx), PlanUpdate(
        teacher_choice="QUIZ",
        grade_treatment=component,
        target_assignment_ids=[target_1.classwork_assignment_id],
        score_adjustment_cap=85.0,
        predicted_grade_ceiling=85.0,
    ))

    # 1. API rejects predicted_grade_ceiling > 85 with 422
    bad_resp = _http(ctx).post(_path(ctx), json={
        "target_assignment_ids": [target_1.classwork_assignment_id],
        "predicted_grade_ceiling": 86,
    })
    assert bad_resp.status_code == 422

    # 2. API enforces saved 85 ceiling on 84 -> 89 what-if while returning raw 89 separately
    outputs = iter((84.0, 89.0))
    monkeypatch.setattr(
        current_term_scorer,
        "score_development_current_term",
        lambda _features, model_name=None: next(outputs),
    )
    resp = _http(ctx).post(_path(ctx), json={
        "target_assignment_ids": [target_1.classwork_assignment_id],
    })
    assert resp.status_code == 200, resp.text
    what_if = resp.json()["ai_midterm_what_if"]
    assert what_if["status"] == "AVAILABLE"
    assert what_if["baseline_predicted_term_grade"] == 84.0
    assert what_if["unremediated_baseline_predicted_term_grade"] == 84.0
    assert what_if["selected_grade_ceiling"] == 85.0
    assert what_if["effective_grade_ceiling"] == 85.0
    est = what_if["target_estimates"][0]
    assert est["hypothetical_predicted_term_grade"] == 89.0
    assert est["raw_hypothetical_predicted_term_grade"] == 89.0
    assert est["remediation_adjusted_predicted_term_grade"] == 85.0
    assert est["applied_grade_ceiling"] == 85.0
    assert est["was_ceiling_applied"] is True
    assert est["capped_estimated_difference_from_baseline"] == 1.0

    # 3. Attach and grade remediation on target_1, then add strong NEW regular coursework pushing
    # unremediated baseline > 85 -> legitimate regular gains above 85 are preserved!
    _rem_cw, rem_as, _link = _attach_linked_remediation(ctx, target_1, cap=85.0, published=True)
    db.add(StudentSubmission(
        student_id=ctx["student"].student_id,
        classwork_assignment_id=rem_as.classwork_assignment_id,
        status="graded",
        grade=Decimal("10"),
        attempt_count=1,
        submitted_at=datetime.now(timezone.utc),
        graded_at=datetime.now(timezone.utc),
    ))
    add_activity(ctx, component, 50, 50, title="New Regular High Score Activity")
    db.commit()

    def feature_scorer(features, model_name=None):
        return round(30.0 + float(features["overall_partial_percent"]) * 0.72, 4)

    monkeypatch.setattr(current_term_scorer, "score_development_current_term", feature_scorer)

    ws = get_workspace(db, _staff(ctx), _id(ctx))
    impact = ws["prediction_impact"]
    assert impact["status"] == "AVAILABLE"
    assert impact["predicted_grade_ceiling"] == 85.0
    assert impact["unremediated_baseline_predicted_grade"] > 85.0
    assert impact["effective_grade_ceiling"] == impact["unremediated_baseline_predicted_grade"]
    assert impact["current_predicted_grade"] > impact["unremediated_baseline_predicted_grade"]
    assert impact["remediation_adjusted_current_predicted_grade"] == impact["unremediated_baseline_predicted_grade"]
    assert impact["remediation_adjusted_max_predicted_grade"] == impact["unremediated_baseline_predicted_grade"]
    assert impact["remediation_adjusted_max_predicted_grade"] > 85.0
    assert impact["was_ceiling_applied"] is True


def test_examination_remediation_supports_predicted_grade_ceiling_consistently(candidate_context, monkeypatch):
    ctx = candidate_context
    db = ctx["db"]
    _activate(ctx)

    # Create a scored original Examination and align intervention diagnosis to EXAMINATION focus
    exam_asgn = add_activity(
        ctx,
        "EXAMS",
        10,
        30,
        title="Summative 1 Low",
        classwork_type="EXAM",
        exam_subtype="SUMMATIVE_1",
    )
    row = db.get(Intervention, _id(ctx))
    row.diagnosis_snapshot = {
        **(row.diagnosis_snapshot or {}),
        "weakest_supported_components": ["EXAMINATION"],
        "weakest_exam_subtype": "SUMMATIVE_1",
        "supporting_activities": [
            {
                "classwork_assignment_id": exam_asgn.classwork_assignment_id,
                "classwork_id": exam_asgn.classwork_id,
                "title": exam_asgn.classwork.title,
                "component": "EXAMINATION",
                "exam_subtype": "SUMMATIVE_1",
                "score": 10.0,
                "possible_score": 30.0,
            }
        ],
    }
    db.commit()

    # Save EXAMINATION plan -> defaults predicted_grade_ceiling to 85.0
    ws_saved = save_plan(db, _staff(ctx), _id(ctx), PlanUpdate(
        teacher_choice="QUIZ",
        grade_treatment="EXAMINATION",
        original_exam_assignment_id=exam_asgn.classwork_assignment_id,
    ))
    assert ws_saved["plan"]["predicted_grade_ceiling"] == 85.0

    # Projection API supports EXAMINATION target consistently with 85 ceiling
    outputs = iter((83.5, 88.8))
    monkeypatch.setattr(
        current_term_scorer,
        "score_development_current_term",
        lambda _features, model_name=None: next(outputs),
    )
    resp = _http(ctx).post(_path(ctx), json={
        "target_assignment_ids": [exam_asgn.classwork_assignment_id],
    })
    assert resp.status_code == 200, resp.text
    what_if = resp.json()["ai_midterm_what_if"]
    assert what_if["status"] == "AVAILABLE"
    assert what_if["selected_grade_ceiling"] == 85.0
    est = what_if["target_estimates"][0]
    assert est["assignment_id"] == exam_asgn.classwork_assignment_id
    assert est["hypothetical_predicted_term_grade"] == 88.8
    assert est["remediation_adjusted_predicted_term_grade"] == 85.0
    assert est["was_ceiling_applied"] is True

    # Workspace prediction_impact also applies the saved 85 ceiling to EXAMINATION
    outputs_ws = iter((83.5, 88.8))
    monkeypatch.setattr(
        current_term_scorer,
        "score_development_current_term",
        lambda _features, model_name=None: next(outputs_ws),
    )
    ws = get_workspace(db, _staff(ctx), _id(ctx))
    impact = ws["prediction_impact"]
    assert impact["status"] == "AVAILABLE"
    assert impact["predicted_grade_ceiling"] == 85.0
    assert impact["max_remediation_predicted_grade"] == 88.8
    assert impact["remediation_adjusted_max_predicted_grade"] == 85.0
    assert impact["was_ceiling_applied"] is True


def test_unavailable_unremediated_baseline_returns_explicit_unavailable_in_workspace_and_projection(
    candidate_context,
    monkeypatch,
):
    ctx = candidate_context
    db = ctx["db"]
    _activate(ctx)
    target = _focused_targets(ctx)[0]
    component = target.classwork.classwork_category or "WRITTEN_WORK"

    save_plan(db, _staff(ctx), _id(ctx), PlanUpdate(
        teacher_choice="QUIZ",
        grade_treatment=component,
        target_assignment_ids=[target.classwork_assignment_id],
        predicted_grade_ceiling=85.0,
    ))

    orig_prepare = midterm_service.prepare_development_current_term

    def broken_unremediated(*args, **kwargs):
        if kwargs.get("exclude_intervention_id") is not None:
            return (
                {
                    "status": STATUS_INSUFFICIENT_EVIDENCE,
                    "projected_final_term_grade": None,
                    "readiness_reason_codes": ["INSUFFICIENT_AVAILABLE_ACTIVITIES"],
                    "readiness_result": {"ready": False, "readiness_level": "INSUFFICIENT_EVIDENCE"},
                },
                None,
            )
        return orig_prepare(*args, **kwargs)

    monkeypatch.setattr(midterm_service, "prepare_development_current_term", broken_unremediated)
    monkeypatch.setattr(
        current_term_scorer,
        "score_development_current_term",
        lambda _features, model_name=None: 84.0,
    )

    ws = get_workspace(db, _staff(ctx), _id(ctx))
    assert ws["prediction_impact"]["status"] == "UNAVAILABLE"
    assert ws["prediction_impact"]["remediation_adjusted_max_predicted_grade"] is None
    assert any(
        r["code"] == "UNREMEDIATED_BASELINE_UNAVAILABLE"
        for r in ws["prediction_impact"]["unavailable_reasons"]
    )

    proj = project_subject_grade(
        db,
        _staff(ctx),
        _id(ctx),
        target_assignment_ids=[target.classwork_assignment_id],
    )
    assert proj["ai_midterm_what_if"]["status"] == "UNAVAILABLE"
    assert any(
        r["code"] == "UNREMEDIATED_BASELINE_UNAVAILABLE"
        for r in proj["ai_midterm_what_if"]["unavailable_reasons"]
    )
