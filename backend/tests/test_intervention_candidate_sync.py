"""Corrected prediction to Intervention candidate transaction contract."""

from decimal import Decimal
from datetime import datetime, timezone

import pytest

from app.core.Config import settings
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.Subject import Subject
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention.InterventionCandidateService import sync_intervention_for_persisted_prediction
from app.services.intervention.InterventionReconciliationService import (
    reconcile_open_interventions_for_template_threshold_change,
)
from app.services.grading.PassingPolicyAdminService import edit_template_threshold
from app.services.prediction import DevelopmentCurrentTermScoringService as scorer
from app.services.prediction import DevelopmentCurrentTermPredictionPersistenceService as persistence
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME
from tests.test_current_period_live_feature_builder import add_activity, current_period_context
from tests.test_development_current_term_model_4l import _register_corrected
from tests.test_development_current_term_prediction_persistence import _run
from tests.test_development_current_term_prediction_service import _make_ready, _set_weights


def _enable(monkeypatch, environment="test"):
    monkeypatch.setattr(settings, "app_environment", environment)
    monkeypatch.setattr(settings, "development_prediction_api_enabled", True)
    monkeypatch.setattr(settings, "development_current_term_model_name", CORRECTED_MODEL_NAME)


def _setup(ctx, monkeypatch, grades):
    _enable(monkeypatch)
    _set_weights(ctx)
    _make_ready(ctx)
    model = _register_corrected(ctx)
    values = iter(grades)
    monkeypatch.setattr(scorer, "score_development_current_term", lambda _features, model_name=None: next(values))
    return model.model_version_id


def _interventions(ctx):
    ctx["db"].expire_all()
    return ctx["db"].query(Intervention).order_by(Intervention.intervention_id).all()


@pytest.mark.parametrize(
    "grade,expected",
    [(74.0, 1), (84.65, 1), (85.44, 0), (86.999, 0), (87.0, 0), (88.84, 0), (92.0, 0)],
)
def test_candidate_requires_high_or_moderate_risk_below_passing_threshold(current_period_context, monkeypatch, grade, expected):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [grade])
    result = _run(ctx, model_id)
    rows = _interventions(ctx)
    assert result["persisted"] is True
    assert len(rows) == expected
    if expected:
        assert rows[0].status == "CANDIDATE"
        assert rows[0].source_prediction_id == result["prediction_id"]
        assert (rows[0].student_id, rows[0].class_id, rows[0].subject_id, rows[0].academic_period_id) == (
            ctx["student"].student_id, ctx["class"].class_id,
            ctx["subject"].subject_id, ctx["period"].academic_period_id,
        )


def test_fully_approved_production_prediction_creates_same_candidate(current_period_context, monkeypatch):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84.0])
    model = ctx["db"].get(AIModelVersion, model_id)
    model.lifecycle_status = "PRODUCTION"
    model.is_active = True
    model.production_validated = True
    model.independent_three_term_validation = True
    ctx["db"].commit()
    monkeypatch.setattr(settings, "app_environment", "production")

    result = _run(ctx, model_id)

    rows = _interventions(ctx)
    assert result["lifecycle_status"] == "PRODUCTION"
    assert len(rows) == 1
    assert rows[0].source_prediction_id == result["prediction_id"]


@pytest.mark.parametrize("grade,expected", [(84.999, 1), (85.0, 0)])
def test_unrounded_grade_controls_exact_passing_threshold_boundary(
    current_period_context, monkeypatch, grade, expected,
):
    ctx = current_period_context
    ctx["template"].passing_threshold = Decimal("85.00")
    ctx["db"].commit()
    model_id = _setup(ctx, monkeypatch, [grade])

    result = _run(ctx, model_id)
    rows = _interventions(ctx)

    assert len(rows) == expected
    if expected:
        prediction = ctx["db"].get(DevelopmentCurrentTermPrediction, result["prediction_id"])
        assert float(prediction.predicted_period_grade) == 85.0
        assert prediction.evidence_snapshot["projected_final_term_grade_raw"] == grade


def test_later_improvement_resolves_without_rewriting_trigger(current_period_context, monkeypatch):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84, 88])
    first = _run(ctx, model_id)
    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)
    second = _run(ctx, model_id)
    print("DEBUG_SECOND_RUN:", second)
    rows = _interventions(ctx)
    assert second["revision"] == 2
    assert len(rows) == 1
    assert rows[0].status == "RESOLVED"
    assert rows[0].source_prediction_id == first["prediction_id"]
    assert rows[0].resolution_reason == "IMPROVED_PREDICTION"
    assert rows[0].resolved_at is not None


@pytest.mark.parametrize("starting_status", ["CANDIDATE", "ACTIVE"])
def test_template_threshold_change_reconciles_open_intervention_and_preserves_trigger(
    current_period_context, monkeypatch, starting_status,
):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [82.69, 85.32850036075038])
    first = _run(ctx, model_id)
    intervention = _interventions(ctx)[0]
    activated_at = None
    if starting_status == "ACTIVE":
        staff_id = ctx["staff"].staff_id
        activated_at = datetime.now(timezone.utc)
        intervention.status = "ACTIVE"
        intervention.activated_at = activated_at
        intervention.activated_by_staff_id = staff_id
        ctx["db"].commit()
    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)
    latest = _run(ctx, model_id)
    assert latest["revision"] == 2
    assert _interventions(ctx)[0].status == starting_status

    edit_template_threshold(
        ctx["db"],
        template_id=ctx["template"].grading_template_id,
        year_id=ctx["period"].academic_year_id,
        raw_threshold="85",
        expected_updated_at=ctx["template"].updated_at,
        reason="Align intervention passing policy",
        actor=ctx["staff"].user_id,
    )

    result = _interventions(ctx)[0]
    if starting_status == "CANDIDATE":
        assert result.status == "RESOLVED"
        assert result.resolution_reason == "IMPROVED_PREDICTION"
        assert result.resolved_at is not None
        assert result.activated_at is None
    else:
        # Task 4: ACTIVE interventions require teacher confirmation before resolving.
        assert result.status == "ACTIVE"
        assert result.resolution_reason is None
        assert result.resolved_at is None
        assert result.activated_at.replace(tzinfo=timezone.utc) == activated_at
    assert result.source_prediction_id == first["prediction_id"]
    source = ctx["db"].get(DevelopmentCurrentTermPrediction, first["prediction_id"])
    assert float(source.predicted_period_grade) == 82.69
    assert source.intervention_level == "MODERATE_RISK"


@pytest.mark.parametrize(
    "raw_grade,expected_status",
    [(84.999, "CANDIDATE"), (85.0, "RESOLVED")],
)
def test_threshold_change_uses_latest_raw_grade_at_boundary(
    current_period_context, monkeypatch, raw_grade, expected_status,
):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84.0, raw_grade])
    _run(ctx, model_id)
    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)
    latest = _run(ctx, model_id)
    persisted = ctx["db"].get(DevelopmentCurrentTermPrediction, latest["prediction_id"])
    assert float(persisted.predicted_period_grade) == 85.0

    edit_template_threshold(
        ctx["db"], template_id=ctx["template"].grading_template_id,
        year_id=ctx["period"].academic_year_id, raw_threshold="85",
        expected_updated_at=ctx["template"].updated_at,
        reason="Apply exact passing boundary", actor=ctx["staff"].user_id,
    )

    assert _interventions(ctx)[0].status == expected_status


def test_threshold_reconciliation_is_scoped_and_never_reopens_resolved(
    current_period_context, monkeypatch,
):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84.0])
    _run(ctx, model_id)

    other_template = GradingTemplate(
        template_name="Unrelated", passing_threshold=Decimal("70"), status="active",
    )
    ctx["db"].add(other_template)
    ctx["db"].flush()
    other_subject = Subject(
        subject_name="Unrelated Subject", subject_codename="OTHER",
        academic_level_id=ctx["level"].academic_level_id,
        grading_template_id=other_template.grading_template_id,
    )
    ctx["db"].add(other_subject)
    ctx["db"].flush()
    unrelated_prediction = DevelopmentCurrentTermPrediction(
        student_id=ctx["student"].student_id, class_id=ctx["class"].class_id,
        subject_id=other_subject.subject_id,
        source_period_id=ctx["period"].academic_period_id,
        target_period_id=ctx["period"].academic_period_id,
        model_version_id=model_id, revision=1, predicted_period_grade=Decimal("99"),
        intervention_level="LOW_RISK", intervention_basis="TEST",
        evidence_snapshot={
            "readiness": {"status": "READY"},
            "projected_final_term_grade_raw": 99.0,
        },
    )
    ctx["db"].add(unrelated_prediction)
    ctx["db"].flush()
    unrelated = Intervention(
        student_id=ctx["student"].student_id, class_id=ctx["class"].class_id,
        subject_id=other_subject.subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        source_prediction_id=unrelated_prediction.prediction_id,
        status="CANDIDATE", diagnosis_snapshot={},
    )
    ctx["db"].add(unrelated)
    resolved_prediction = DevelopmentCurrentTermPrediction(
        student_id=ctx["student"].student_id, class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        source_period_id=ctx["next_period"].academic_period_id,
        target_period_id=ctx["next_period"].academic_period_id,
        model_version_id=model_id, revision=1, predicted_period_grade=Decimal("70"),
        intervention_level="HIGH_RISK", intervention_basis="TEST",
        evidence_snapshot={
            "readiness": {"status": "READY"},
            "projected_final_term_grade_raw": 70.0,
        },
    )
    ctx["db"].add(resolved_prediction)
    ctx["db"].flush()
    historical = Intervention(
        student_id=ctx["student"].student_id, class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["next_period"].academic_period_id,
        source_prediction_id=resolved_prediction.prediction_id,
        status="RESOLVED", resolution_reason="IMPROVED_PREDICTION",
        resolved_at=datetime.now(timezone.utc), diagnosis_snapshot={},
    )
    ctx["db"].add(historical)
    ctx["db"].commit()

    ctx["template"].passing_threshold = Decimal("83")
    ctx["db"].flush()
    result = reconcile_open_interventions_for_template_threshold_change(
        ctx["db"], academic_year_id=ctx["period"].academic_year_id,
        grading_template_id=ctx["template"].grading_template_id,
    )

    assert result == {"affected": 1, "resolved": 1}
    assert unrelated.status == "CANDIDATE"
    assert historical.status == "RESOLVED"
    assert historical.resolution_reason == "IMPROVED_PREDICTION"


def test_threshold_reconciliation_is_idempotent_and_notifies_once(
    current_period_context, monkeypatch,
):
    from app.services.intervention import InterventionCandidateService as candidate_service

    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84.0, 85.5])
    _run(ctx, model_id)
    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)
    _run(ctx, model_id)
    events = []
    monkeypatch.setattr(
        candidate_service,
        "stage_intervention_notification",
        lambda _db, intervention, *, event, predicted_grade: events.append(
            (intervention.intervention_id, event, predicted_grade)
        ),
    )
    ctx["template"].passing_threshold = Decimal("85")
    ctx["db"].flush()

    first = reconcile_open_interventions_for_template_threshold_change(
        ctx["db"], academic_year_id=ctx["period"].academic_year_id,
        grading_template_id=ctx["template"].grading_template_id,
    )
    second = reconcile_open_interventions_for_template_threshold_change(
        ctx["db"], academic_year_id=ctx["period"].academic_year_id,
        grading_template_id=ctx["template"].grading_template_id,
    )

    assert first == {"affected": 1, "resolved": 1}
    assert second == {"affected": 0, "resolved": 0}
    assert [(event, grade) for _, event, grade in events] == [
        ("IMPROVED_PREDICTION", 85.5),
    ]


def test_active_intervention_stays_active_on_improvement_until_teacher_confirms_then_later_high_risk_creates_new_candidate(current_period_context, monkeypatch):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84, 88, 74])
    first = _run(ctx, model_id)
    staff_id = ctx["staff"].staff_id
    active = _interventions(ctx)[0]
    active.status = "ACTIVE"
    active.activated_at = datetime.now(timezone.utc)
    active.activated_by_staff_id = staff_id
    ctx["db"].commit()
    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)
    _run(ctx, model_id)
    # Task 4: ACTIVE intervention does NOT auto-resolve on improved prediction.
    still_active = _interventions(ctx)[0]
    assert still_active.status == "ACTIVE"
    assert still_active.resolved_at is None

    # After explicit resolution, a later HIGH_RISK revision creates a new CANDIDATE preserving history.
    still_active.status = "RESOLVED"
    still_active.resolution_reason = "IMPROVED_PREDICTION"
    still_active.resolved_at = datetime.now(timezone.utc)
    ctx["db"].commit()
    add_activity(ctx, "WRITTEN_WORK", 6, 10)
    third = _run(ctx, model_id)
    rows = _interventions(ctx)
    assert [row.status for row in rows] == ["RESOLVED", "CANDIDATE"]
    assert rows[0].source_prediction_id == first["prediction_id"]
    assert rows[1].source_prediction_id == third["prediction_id"]


def test_low_revision_and_unchanged_evidence_do_not_duplicate(current_period_context, monkeypatch):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84, 84, 74])
    first = _run(ctx, model_id)
    same = _run(ctx, model_id)
    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)
    second = _run(ctx, model_id)
    print("DEBUG_SECOND_RUN:", second)
    rows = _interventions(ctx)
    assert same["unchanged"] is True and second["revision"] == 2
    assert len(rows) == 1
    assert rows[0].status == "CANDIDATE"
    assert rows[0].source_prediction_id == first["prediction_id"]


def test_separate_subjects_have_separate_candidates(current_period_context, monkeypatch):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84, 83])
    first_subject_id = ctx["subject"].subject_id
    first = _run(ctx, model_id)
    second_subject = Subject(
        subject_name="English", subject_codename="ENGLISH", academic_level_id=ctx["level"].academic_level_id,
    )
    ctx["db"].add(second_subject)
    ctx["db"].flush()
    template = GradingTemplate(
        template_name="English 20-50-30", passing_threshold=87.0, status="active",
    )
    ctx["db"].add(template)
    ctx["db"].flush()
    ctx["db"].add_all([
        GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name=name, weight=Decimal(weight), display_order=order)
        for order, (name, weight) in enumerate((
            ("Written Works", "20"), ("Performance Tasks", "50"), ("Quarterly Assessment", "30"),
        ), start=1)
    ])
    second_subject.grading_template_id = template.grading_template_id
    from app.models.academic.SubjectLoad import SubjectLoad
    ctx["db"].add(
        SubjectLoad(
            staff_id=ctx["staff"].staff_id,
            subject_id=second_subject.subject_id,
            class_id=ctx["class"].class_id,
            academic_period_id=ctx["period"].academic_period_id,
            status="active",
            is_active_version=True,
        )
    )
    ctx["db"].commit()
    ctx["subject"] = second_subject
    _make_ready(ctx)
    second = _run(ctx, model_id)
    print("DEBUG_SECOND_RUN:", second)
    rows = _interventions(ctx)
    assert {row.source_prediction_id for row in rows} == {first["prediction_id"], second["prediction_id"]}
    assert {row.subject_id for row in rows} == {first_subject_id, second_subject.subject_id}


def test_stale_revision_and_scope_mismatch_are_rejected(current_period_context, monkeypatch):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84, 88])
    first = _run(ctx, model_id)
    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)
    _run(ctx, model_id)
    source = ctx["db"].get(DevelopmentCurrentTermPrediction, first["prediction_id"])
    scope = dict(
        student_id=ctx["student"].student_id, class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id, academic_period_id=ctx["period"].academic_period_id,
    )
    with pytest.raises(ValueError, match="not the latest"):
        sync_intervention_for_persisted_prediction(ctx["db"], source, **scope)
    with pytest.raises(ValueError, match="scope mismatch"):
        sync_intervention_for_persisted_prediction(ctx["db"], source, **{**scope, "subject_id": 999})
    assert _interventions(ctx)[0].status == "RESOLVED"


def test_ungrading_to_insufficient_does_not_resolve_or_duplicate(current_period_context, monkeypatch):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84])
    first = _run(ctx, model_id)
    submissions = ctx["db"].query(StudentSubmission).all()
    for submission in submissions[1:]:
        submission.grade = None
    ctx["db"].commit()
    blocked = _run(ctx, model_id)
    rows = _interventions(ctx)
    assert blocked["persisted"] is False
    assert blocked["prediction_status"] == "INSUFFICIENT_EVIDENCE"
    assert len(rows) == 1 and rows[0].status == "CANDIDATE"
    assert rows[0].source_prediction_id == first["prediction_id"]


def test_initial_unassessed_prediction_does_not_create_candidate(current_period_context, monkeypatch):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84])
    for submission in ctx["db"].query(StudentSubmission).all()[1:]:
        submission.grade = None
    ctx["db"].commit()

    result = _run(ctx, model_id)

    assert result["persisted"] is False
    assert result["intervention_level"] == "INTERVENTION_NOT_ASSESSED"
    assert ctx["db"].query(DevelopmentCurrentTermPrediction).count() == 0
    assert _interventions(ctx) == []


def test_prediction_failure_and_sync_failure_leave_no_half_transaction(current_period_context, monkeypatch):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84])
    monkeypatch.setattr(scorer, "score_development_current_term", lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("scoring failed")))
    with pytest.raises(RuntimeError, match="scoring failed"):
        _run(ctx, model_id)
    assert ctx["db"].query(DevelopmentCurrentTermPrediction).count() == 0
    assert _interventions(ctx) == []
    monkeypatch.setattr(scorer, "score_development_current_term", lambda *_args, **_kwargs: 84)
    monkeypatch.setattr(persistence, "sync_intervention_for_persisted_prediction", lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("sync failed")))
    with pytest.raises(RuntimeError, match="sync failed"):
        _run(ctx, model_id)
    ctx["db"].expire_all()
    assert ctx["db"].query(DevelopmentCurrentTermPrediction).count() == 0
    assert _interventions(ctx) == []


def test_production_does_not_synchronize_interventions(current_period_context, monkeypatch):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84])
    _enable(monkeypatch, environment="production")
    result = _run(ctx, model_id)
    assert result["persisted"] is True
    assert _interventions(ctx) == []


def test_task_4_8d_2_passing_policy_consistency_across_students_and_scenarios(current_period_context, monkeypatch):
    """Task 4.8D.2: Verify scenarios at 84.65, 85.44, 87.0, and 88.84.

    1. Subject with passing threshold 87.0 (Mathematics 9 policy):
       - 84.65: below 87.0 -> candidate created, fails passing
       - 85.44: below 87.0 but NEEDS_MONITORING -> no new candidate
       - 87.0: reaches 87.0 -> passing, no candidate created
       - 88.84: reaches 87.0 -> passing, no candidate created
    2. Multi-student consistency in the same subject/year:
       - Every student in Mathematics 9 is judged against threshold 87.0.
    3. Independent AI risk classifications:
       - 84.65 -> MODERATE_RISK (AI risk band < 85)
       - 85.44 -> NEEDS_MONITORING (AI risk band 85-<90)
       - 87.0 -> NEEDS_MONITORING (AI risk band 85-<90)
       - 88.84 -> NEEDS_MONITORING (AI risk band 85-<90)
       Risk bands remain preserved as pure ML features.
    """
    from uuid import uuid4
    from app.models.people.Student import Student
    from app.models.academic.StudentCLass import StudentClass
    from app.services.prediction.DevelopmentCurrentTermRiskService import assess_development_current_term_intervention
    from app.services.prediction.DevelopmentCurrentTermPredictionService import STATUS_DEVELOPMENT_PREDICTION_AVAILABLE

    ctx = current_period_context
    assert float(ctx["template"].passing_threshold) == 87.0

    def _risk(g):
        return assess_development_current_term_intervention(
            {"status": STATUS_DEVELOPMENT_PREDICTION_AVAILABLE, "projected_final_term_grade": g}
        )["intervention_level"]

    # 1. Verify AI risk bands are independent of subject threshold
    assert _risk(84.65) == "MODERATE_RISK"
    assert _risk(85.44) == "NEEDS_MONITORING"
    assert _risk(87.0) == "NEEDS_MONITORING"
    assert _risk(88.84) == "NEEDS_MONITORING"

    # 2. Verify student A at 84.65 -> creates candidate
    model_id = _setup(ctx, monkeypatch, [84.65])
    _run(ctx, model_id)
    rows = _interventions(ctx)
    assert len(rows) == 1
    assert rows[0].status == "CANDIDATE"

    # 3. A revised NEEDS_MONITORING prediction does not destroy the existing candidate.
    monkeypatch.setattr(scorer, "score_development_current_term", lambda *_args, **_kwargs: 85.44)
    add_activity(ctx, "PERFORMANCE_TASK", 18, 20)
    _run(ctx, model_id)
    rows = _interventions(ctx)
    assert len(rows) == 1
    assert rows[0].status == "CANDIDATE"  # Still below 87.0!

    # 4. If student A improves to 87.0, threshold is met -> intervention RESOLVES
    monkeypatch.setattr(scorer, "score_development_current_term", lambda *_args, **_kwargs: 87.0)
    add_activity(ctx, "WRITTEN_WORK", 9, 10)
    _run(ctx, model_id)
    rows = _interventions(ctx)
    assert len(rows) == 1
    assert rows[0].status == "RESOLVED"
    assert rows[0].resolution_reason == "IMPROVED_PREDICTION"

    # 5. Student B at 85.44 is below threshold but not MODERATE_RISK -> no candidate.
    student_b = Student(
        student_id=uuid4(), student_lrn="100000000099", first_name="Student", last_name="B",
        academic_level_id=ctx["level"].academic_level_id,
    )
    ctx["db"].add(student_b)
    ctx["db"].add(StudentClass(
        student_id=student_b.student_id, class_id=ctx["class"].class_id,
        academic_year_id=ctx["class"].academic_year_id, enrollment_status="enrolled",
    ))
    ctx["db"].flush()
    ctx["student"] = student_b
    for ca in ctx["db"].query(ClassworkAssignment).filter_by(class_id=ctx["class"].class_id).all():
        ctx["db"].add(StudentSubmission(
            student_id=student_b.student_id,
            classwork_assignment_id=ca.classwork_assignment_id,
            status="graded",
            grade=Decimal("15"),
        ))
    ctx["db"].commit()
    monkeypatch.setattr(scorer, "score_development_current_term", lambda *_args, **_kwargs: 85.44)
    res_b = _run(ctx, model_id)
    assert res_b["persisted"] is True, f"res_b failed: {res_b}"
    rows_b = ctx["db"].query(Intervention).filter_by(student_id=student_b.student_id).all()
    assert rows_b == []

    # 6. Student C at 88.84 -> reaches threshold 87.0, no candidate created
    student_c = Student(
        student_id=uuid4(), student_lrn="100000000098", first_name="Student", last_name="C",
        academic_level_id=ctx["level"].academic_level_id,
    )
    ctx["db"].add(student_c)
    ctx["db"].add(StudentClass(
        student_id=student_c.student_id, class_id=ctx["class"].class_id,
        academic_year_id=ctx["class"].academic_year_id, enrollment_status="enrolled",
    ))
    ctx["db"].flush()
    ctx["student"] = student_c
    for ca in ctx["db"].query(ClassworkAssignment).filter_by(class_id=ctx["class"].class_id).all():
        ctx["db"].add(StudentSubmission(
            student_id=student_c.student_id,
            classwork_assignment_id=ca.classwork_assignment_id,
            status="graded",
            grade=Decimal("15"),
        ))
    ctx["db"].commit()
    monkeypatch.setattr(scorer, "score_development_current_term", lambda *_args, **_kwargs: 88.84)
    res_c = _run(ctx, model_id)
    assert res_c["persisted"] is True, f"res_c failed: {res_c}"
    rows_c = ctx["db"].query(Intervention).filter_by(student_id=student_c.student_id).all()
    assert len(rows_c) == 0

