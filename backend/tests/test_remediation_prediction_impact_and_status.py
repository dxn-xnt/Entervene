"""Focused backend tests for remediation status wording and AI prediction impact."""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention.InterventionRemediationService import (
    PlanUpdate,
    get_workspace,
    save_plan,
)
from app.services.prediction import DevelopmentCurrentTermScoringService as current_term_scorer
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_intervention_support_materials import _activate
from tests.test_subject_grade_projection_api import _focused_targets
from tests.test_teacher_intervention_review import candidate_context, _id, _staff


def _attach_linked_remediation(ctx, target: ClassworkAssignment, *, cap: float = 85.0, published: bool = False):
    db = ctx["db"]
    component = target.classwork.classwork_category or "WRITTEN_WORK"
    save_plan(db, _staff(ctx), _id(ctx), PlanUpdate(
        teacher_choice="QUIZ",
        grade_treatment=component,
        target_assignment_ids=[target.classwork_assignment_id],
        score_adjustment_cap=cap,
    ))
    rem_cw = Classwork(
        title="Targeted Remediation Quiz",
        classwork_type="QUIZ",
        classwork_category=component,
        is_graded=True,
        total_points=target.classwork.total_points,
        is_published=published,
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
        is_published=published,
        recipient_student_id=ctx["student"].student_id,
        source_intervention_id=_id(ctx),
        remediation_request_id=uuid4(),
    )
    db.add(rem_as)
    db.flush()
    link = RemediationAssignmentLink(
        original_assignment_id=target.classwork_assignment_id,
        remediation_assignment_id=rem_as.classwork_assignment_id,
        student_id=ctx["student"].student_id,
        source_intervention_id=_id(ctx),
        component=component,
        score_adjustment_cap=Decimal(str(cap)),
        created_by_staff_id=_staff(ctx),
    )
    db.add(link)
    db.commit()
    return rem_cw, rem_as, link


def test_workspace_status_reflects_draft_assigned_submitted_and_graded_accurately(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    _activate(ctx)
    target = _focused_targets(ctx)[0]

    # 1. No remediation activity yet
    ws_empty = get_workspace(db, _staff(ctx), _id(ctx))
    assert ws_empty["progress"]["remediation_status"] == "NOT_ASSIGNED"
    assert "No remediation activity" in ws_empty["progress"]["status_reason"]

    # 2. Draft created (not published)
    rem_cw, rem_as, _link = _attach_linked_remediation(ctx, target, cap=85.0, published=False)
    ws_draft = get_workspace(db, _staff(ctx), _id(ctx))
    assert ws_draft["progress"]["remediation_status"] == "DRAFT"
    assert "not yet published" in ws_draft["progress"]["status_reason"].lower()
    assert "remains below" not in ws_draft["progress"]["status_reason"].lower()

    # 3. Published / assigned, awaiting student submission
    rem_cw.is_published = True
    rem_as.is_published = True
    db.commit()
    ws_assigned = get_workspace(db, _staff(ctx), _id(ctx))
    assert ws_assigned["progress"]["remediation_status"] == "ASSIGNED"
    assert "awaiting student submission" in ws_assigned["progress"]["status_reason"].lower()
    assert "remains below" not in ws_assigned["progress"]["status_reason"].lower()

    # 4. Student submitted, awaiting teacher grading
    sub = StudentSubmission(
        student_id=ctx["student"].student_id,
        classwork_assignment_id=rem_as.classwork_assignment_id,
        status="submitted",
        grade=None,
        attempt_count=1,
        submitted_at=datetime.now(timezone.utc),
    )
    db.add(sub)
    db.commit()
    ws_submitted = get_workspace(db, _staff(ctx), _id(ctx))
    assert ws_submitted["progress"]["remediation_status"] == "SUBMITTED"
    assert "grade the submission" in ws_submitted["progress"]["status_reason"].lower()
    assert "remains below" not in ws_submitted["progress"]["status_reason"].lower()

    # 5. Graded submission (still below threshold)
    sub.status = "graded"
    sub.grade = Decimal("6")
    sub.graded_at = datetime.now(timezone.utc)
    db.commit()
    ws_graded = get_workspace(db, _staff(ctx), _id(ctx))
    assert ws_graded["progress"]["remediation_status"] == "GRADED"
    assert "graded remediation has been applied" in ws_graded["progress"]["status_reason"].lower()
    assert "remains below" in ws_graded["progress"]["status_reason"].lower()


def test_workspace_prediction_impact_uses_locked_85_ceiling_real_ml_and_recalculates_on_reopen(
    candidate_context,
    monkeypatch,
):
    ctx = candidate_context
    db = ctx["db"]
    _activate(ctx)
    target = _focused_targets(ctx)[0]

    # Set original score to 5 / 10 so 85% ceiling yields effective max 8.5 / 10.
    orig_sub = (
        db.query(StudentSubmission)
        .filter_by(
            classwork_assignment_id=target.classwork_assignment_id,
            student_id=ctx["student"].student_id,
        )
        .one()
    )
    orig_sub.grade = Decimal("5")
    db.commit()

    rem_cw, rem_as, _link = _attach_linked_remediation(ctx, target, cap=85.0, published=True)

    # Deterministic real-feature scorer: reflects actual feature vector without assuming 85% cap => 85 grade.
    scored_inputs = []

    def feature_based_scorer(features, model_name=None):
        scored_inputs.append(dict(features))
        return round(58.0 + float(features["overall_partial_percent"]) * 0.35, 2)

    monkeypatch.setattr(current_term_scorer, "score_development_current_term", feature_based_scorer)

    before_grades = {
        row.submission_id: row.grade for row in db.query(StudentSubmission).all()
    }

    ws = get_workspace(db, _staff(ctx), _id(ctx))
    impact = ws["prediction_impact"]
    assert impact["status"] == "AVAILABLE"
    assert impact["is_official_grade"] is False
    assert impact["is_guaranteed"] is False
    assert impact["score_adjustment_cap"] == 85.0
    assert len(impact["targets"]) == 1

    target_info = impact["targets"][0]
    assert target_info["assignment_id"] == target.classwork_assignment_id
    assert target_info["original_score"] == 5.0
    assert target_info["current_effective_score"] == 5.0
    assert target_info["max_points"] == 10.0
    assert target_info["cap_percentage"] == 85.0
    assert target_info["effective_max_score"] == 8.5
    assert target_info["possible_score_gain"] == 3.5

    # Baseline and max-score hypothetical come from actual ML feature vector scoring (and != 85.0).
    assert len(scored_inputs) == 2
    assert impact["current_predicted_grade"] is not None
    assert impact["max_remediation_predicted_grade"] is not None
    assert impact["max_remediation_predicted_grade"] > impact["current_predicted_grade"]
    assert impact["max_remediation_predicted_grade"] != 85.0
    assert impact["predicted_gain"] == round(
        impact["max_remediation_predicted_grade"] - impact["current_predicted_grade"], 6
    )

    # Verify read-only: no database writes occurred.
    assert {row.submission_id: row.grade for row in db.query(StudentSubmission).all()} == before_grades
    assert not db.new and not db.dirty and not db.deleted

    # Now student completes remediation with 7 / 10 -> reopening recalculates live current prediction!
    db.add(StudentSubmission(
        student_id=ctx["student"].student_id,
        classwork_assignment_id=rem_as.classwork_assignment_id,
        status="graded",
        grade=Decimal("7"),
        attempt_count=1,
        submitted_at=datetime.now(timezone.utc),
        graded_at=datetime.now(timezone.utc),
    ))
    db.commit()

    ws_reopened = get_workspace(db, _staff(ctx), _id(ctx))
    impact_after = ws_reopened["prediction_impact"]
    assert impact_after["status"] == "AVAILABLE"
    assert impact_after["targets"][0]["current_effective_score"] == 7.0
    assert impact_after["targets"][0]["effective_max_score"] == 8.5
    assert impact_after["current_predicted_grade"] > impact["current_predicted_grade"]
    assert impact_after["max_remediation_predicted_grade"] == impact["max_remediation_predicted_grade"]


def test_workspace_prediction_impact_reports_unavailable_when_ml_inference_fails(
    candidate_context,
    monkeypatch,
):
    ctx = candidate_context
    db = ctx["db"]
    _activate(ctx)
    target = _focused_targets(ctx)[0]
    _attach_linked_remediation(ctx, target, cap=85.0, published=True)

    def broken_scorer(features, model_name=None):
        raise RuntimeError("Model artifact missing")

    monkeypatch.setattr(current_term_scorer, "score_development_current_term", broken_scorer)

    ws = get_workspace(db, _staff(ctx), _id(ctx))
    impact = ws["prediction_impact"]
    assert impact["status"] == "UNAVAILABLE"
    assert impact["current_predicted_grade"] is None
    assert impact["max_remediation_predicted_grade"] is None
    assert impact["predicted_gain"] is None
    assert impact["unavailable_reasons"]
    # Locked ceiling and effective max score remain visible without fabricating a prediction.
    assert impact["targets"][0]["cap_percentage"] == 85.0
    assert impact["targets"][0]["effective_max_score"] == 8.5
