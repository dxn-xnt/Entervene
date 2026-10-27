"""Secure Teacher Intervention API coverage for Task 4.8C."""

from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
from uuid import uuid4

from app.models.academic.Class_ import Class
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.intervention.Intervention import Intervention
from app.models.people.Student import Student
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.grading.ComponentMapper import CanonicalGradingComponent, classify_classwork_component
from app.services.intervention.InterventionRemediationFocusService import build_remediation_focus
from app.services.intervention.TeacherInterventionService import _source
from app.services.prediction import DevelopmentCurrentTermScoringService as current_term_scorer
from app.services.prediction.DevelopmentCurrentTermPredictionService import predict_development_current_term
from tests.test_current_period_live_feature_builder import add_activity, current_period_context
from tests.test_intervention_support_materials import _activate, _http
from tests.test_teacher_intervention_review import candidate_context, _id, _other_staff


def _path(ctx):
    return f"/{_id(ctx)}/remediation/subject-grade-projection"


def _complete_exams(ctx):
    add_activity(ctx, "EXAMS", 27, 30, title="Summative 1", classwork_type="EXAM", exam_subtype="SUMMATIVE_1")
    add_activity(ctx, "EXAMS", 21, 30, title="Summative 2", classwork_type="EXAM", exam_subtype="SUMMATIVE_2")
    add_activity(ctx, "EXAMS", 32, 40, title="Term Exam", classwork_type="EXAM", exam_subtype="TERM_EXAM")


def _focused_targets(ctx):
    focus = build_remediation_focus(ctx["candidate"])["component"]
    expected = {
        "WRITTEN_WORK": CanonicalGradingComponent.WRITTEN_WORK,
        "PERFORMANCE_TASK": CanonicalGradingComponent.PERFORMANCE_TASK,
    }[focus]
    assignments = ctx["db"].query(ClassworkAssignment).join(Classwork).filter(
        ClassworkAssignment.class_id == ctx["class"].class_id,
        ClassworkAssignment.academic_period_id == ctx["period"].academic_period_id,
        Classwork.subject_id == ctx["subject"].subject_id,
    ).order_by(ClassworkAssignment.classwork_assignment_id).all()
    return [
        assignment for assignment in assignments
        if classify_classwork_component(
            assignment.classwork.classwork_type,
            assignment.classwork.classwork_category,
            assignment.classwork.exam_subtype,
        ) == expected
    ]


def _save_cap(ctx, cap=90):
    row = ctx["db"].get(Intervention, _id(ctx))
    focus = build_remediation_focus(row)["component"]
    row.remediation_plan = {
        "teacher_choice": "CLASSWORK",
        "grade_treatment": focus,
        "target_assignment_ids": [],
        "score_adjustment_cap": cap,
        "selected_resources": [],
    }
    ctx["db"].commit()


def _foreign_assignment(ctx, *, title, class_id=None, subject_id=None, period_id=None):
    work = Classwork(
        title=title,
        classwork_type="QUIZ",
        classwork_category="WRITTEN_WORK",
        total_points=Decimal("10"),
        is_graded=True,
        is_published=True,
        is_archived=False,
        subject_id=subject_id or ctx["subject"].subject_id,
        created_by_staff_id=ctx["staff"].staff_id,
    )
    ctx["db"].add(work)
    ctx["db"].flush()
    assignment = ClassworkAssignment(
        classwork_id=work.classwork_id,
        class_id=class_id or ctx["class"].class_id,
        academic_period_id=period_id or ctx["period"].academic_period_id,
        assigned_by_staff_id=ctx["staff"].staff_id,
        is_published=True,
    )
    ctx["db"].add(assignment)
    ctx["db"].flush()
    ctx["db"].add(StudentSubmission(
        student_id=ctx["student"].student_id,
        classwork_assignment_id=assignment.classwork_assignment_id,
        status="graded",
        grade=Decimal("2"),
    ))
    ctx["db"].commit()
    return assignment


def test_authorized_teacher_can_request_projection_and_roles_are_rejected(candidate_context):
    ctx = candidate_context
    _activate(ctx)

    response = _http(ctx).post(_path(ctx), json={"target_assignment_ids": []})

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "UNAVAILABLE"
    for role in ("admin", "student"):
        assert _http(ctx, role=role).post(_path(ctx), json={"target_assignment_ids": []}).status_code == 403
    other = _other_staff(ctx)
    assert _http(ctx, user_id=other.user_id).post(_path(ctx), json={"target_assignment_ids": []}).status_code == 404


def test_draft_cap_recalculates_projection_without_persisting_plan(candidate_context):
    ctx = candidate_context
    _activate(ctx)
    _save_cap(ctx, 90)
    target = _focused_targets(ctx)[0]

    before_plan = deepcopy(ctx["candidate"].remediation_plan)
    response = _http(ctx).post(_path(ctx), json={
        "target_assignment_ids": [target.classwork_assignment_id],
        "score_adjustment_cap": 80,
    })

    assert response.status_code == 200, response.text
    projected = response.json()["target_projections"][0]
    assert projected["cap_percentage"] == 80.0
    assert projected["maximum_hypothetical_effective_score"] == 8.0
    assert ctx["candidate"].remediation_plan == before_plan
    assert _http(ctx).post(_path(ctx), json={
        "target_assignment_ids": [target.classwork_assignment_id],
        "score_adjustment_cap": 100,
    }).status_code == 422
    assert _http(ctx).post(_path(ctx), json={
        "target_assignment_ids": [target.classwork_assignment_id],
        "passing_threshold": 1,
    }).status_code == 422


def test_unsaved_candidates_support_single_and_cumulative_projection_without_persistence(candidate_context):
    ctx = candidate_context
    _activate(ctx)
    _complete_exams(ctx)
    _save_cap(ctx, 90)
    targets = _focused_targets(ctx)
    ids = [target.classwork_assignment_id for target in targets]
    before_plan = deepcopy(ctx["candidate"].remediation_plan)
    before_interventions = ctx["db"].query(Intervention).count()
    before_assignments = ctx["db"].query(ClassworkAssignment).count()
    before_submissions = {
        row.submission_id: row.grade for row in ctx["db"].query(StudentSubmission).all()
    }

    single = _http(ctx).post(_path(ctx), json={"target_assignment_ids": [ids[0]]})
    cumulative = _http(ctx).post(_path(ctx), json={"target_assignment_ids": ids})

    assert single.status_code == cumulative.status_code == 200
    single_body = single.json()
    cumulative_body = cumulative.json()
    assert single_body["status"] == "AVAILABLE"
    assert single_body["target_projections"][0]["projected_subject_grade"] is not None
    assert [item["assignment_id"] for item in cumulative_body["target_projections"]] == ids
    assert cumulative_body["target_projections"][1]["projected_subject_grade"] >= cumulative_body["target_projections"][0]["projected_subject_grade"]
    assert ctx["candidate"].remediation_plan == before_plan
    assert ctx["candidate"].remediation_plan["target_assignment_ids"] == []
    assert ctx["db"].query(Intervention).count() == before_interventions
    assert ctx["db"].query(ClassworkAssignment).count() == before_assignments
    assert {row.submission_id: row.grade for row in ctx["db"].query(StudentSubmission).all()} == before_submissions
    assert not ctx["db"].new and not ctx["db"].dirty and not ctx["db"].deleted


def test_invalid_duplicate_and_component_mismatch_targets_are_rejected(candidate_context):
    ctx = candidate_context
    _activate(ctx)
    targets = _focused_targets(ctx)
    target_id = targets[0].classwork_assignment_id
    assignments = ctx["db"].query(ClassworkAssignment).join(Classwork).filter(
        ClassworkAssignment.class_id == ctx["class"].class_id,
        ClassworkAssignment.academic_period_id == ctx["period"].academic_period_id,
        Classwork.subject_id == ctx["subject"].subject_id,
    ).all()
    other_component = next(
        assignment for assignment in assignments
        if assignment.classwork_assignment_id not in {item.classwork_assignment_id for item in targets}
    )

    duplicate = _http(ctx).post(_path(ctx), json={"target_assignment_ids": [target_id, target_id]})
    missing = _http(ctx).post(_path(ctx), json={"target_assignment_ids": [999999]})
    mismatch = _http(ctx).post(_path(ctx), json={"target_assignment_ids": [other_component.classwork_assignment_id]})
    boolean_id = _http(ctx).post(_path(ctx), json={"target_assignment_ids": [True]})

    assert duplicate.status_code == 422
    assert duplicate.json()["detail"]["code"] == "DUPLICATE_PROJECTION_TARGETS"
    assert missing.status_code == 422
    assert missing.json()["detail"]["reasons"][0]["code"] == "TARGET_NOT_FOUND"
    assert mismatch.status_code == 422
    assert mismatch.json()["detail"]["reasons"][0]["code"] == "TARGET_COMPONENT_MISMATCH"
    assert boolean_id.status_code == 422


def test_already_remediated_original_is_not_offered_again(candidate_context):
    ctx = candidate_context
    _activate(ctx)
    original = _focused_targets(ctx)[0]
    work = Classwork(
        title="Existing remediation activity",
        classwork_type=original.classwork.classwork_type,
        classwork_category=original.classwork.classwork_category,
        total_points=original.classwork.total_points,
        is_graded=True,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=ctx["staff"].staff_id,
    )
    ctx["db"].add(work)
    ctx["db"].flush()
    source = _source(ctx["db"], ctx["candidate"])
    pred = DevelopmentCurrentTermPrediction(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        source_period_id=ctx["next_period"].academic_period_id,
        target_period_id=ctx["next_period"].academic_period_id,
        model_version_id=source.model_version_id,
        revision=2,
        predicted_period_grade=Decimal("80"),
        intervention_level="NEEDS_MONITORING",
        intervention_basis="fixture-only",
        evidence_snapshot={},
    )
    ctx["db"].add(pred)
    ctx["db"].flush()
    prior = Intervention(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["next_period"].academic_period_id,
        source_prediction_id=pred.prediction_id,
        status="CANDIDATE",
        diagnosis_snapshot=ctx["candidate"].diagnosis_snapshot,
    )
    ctx["db"].add(prior)
    ctx["db"].flush()
    remediation = ClassworkAssignment(
        classwork_id=work.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=ctx["staff"].staff_id,
        recipient_student_id=ctx["student"].student_id,
        source_intervention_id=prior.intervention_id,
        remediation_request_id=uuid4(),
    )
    ctx["db"].add(remediation)
    ctx["db"].flush()
    ctx["db"].add(RemediationAssignmentLink(
        source_intervention_id=prior.intervention_id,
        remediation_assignment_id=remediation.classwork_assignment_id,
        original_assignment_id=original.classwork_assignment_id,
        student_id=ctx["student"].student_id,
        component=build_remediation_focus(ctx["candidate"])["component"],
        score_adjustment_cap=Decimal("75"),
        created_by_staff_id=ctx["staff"].staff_id,
    ))
    ctx["db"].commit()

    response = _http(ctx).post(_path(ctx), json={
        "target_assignment_ids": [original.classwork_assignment_id],
    })

    assert response.status_code == 422
    assert response.json()["detail"]["reasons"][0]["code"] == "TARGET_ALREADY_REMEDIATED"


def test_intervention_can_project_its_own_linked_targets(candidate_context):
    ctx = candidate_context
    _activate(ctx)
    original = _focused_targets(ctx)[0]
    work = Classwork(
        title="Own remediation activity",
        classwork_type=original.classwork.classwork_type,
        classwork_category=original.classwork.classwork_category,
        total_points=original.classwork.total_points,
        is_graded=True,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=ctx["staff"].staff_id,
    )
    ctx["db"].add(work)
    ctx["db"].flush()
    remediation = ClassworkAssignment(
        classwork_id=work.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=ctx["staff"].staff_id,
        recipient_student_id=ctx["student"].student_id,
        source_intervention_id=_id(ctx),
        remediation_request_id=uuid4(),
    )
    ctx["db"].add(remediation)
    ctx["db"].flush()
    ctx["db"].add(RemediationAssignmentLink(
        source_intervention_id=_id(ctx),
        remediation_assignment_id=remediation.classwork_assignment_id,
        original_assignment_id=original.classwork_assignment_id,
        student_id=ctx["student"].student_id,
        component=build_remediation_focus(ctx["candidate"])["component"],
        score_adjustment_cap=Decimal("75"),
        created_by_staff_id=ctx["staff"].staff_id,
    ))
    ctx["db"].commit()

    response = _http(ctx).post(_path(ctx), json={
        "target_assignment_ids": [original.classwork_assignment_id],
    })

    assert response.status_code == 200, response.text
    assert response.json()["target_projections"][0]["applied"] is True


def test_student_class_subject_and_period_isolation(candidate_context):
    ctx = candidate_context
    _activate(ctx)
    other_class = Class(
        section_name="Projection Other Class",
        academic_year_id=ctx["class"].academic_year_id,
        academic_level_id=ctx["class"].academic_level_id,
    )
    other_subject = Subject(
        subject_name="Projection Other Subject",
        subject_codename="PROJ-OTHER",
        academic_level_id=ctx["subject"].academic_level_id,
        grading_template_id=ctx["subject"].grading_template_id,
    )
    ctx["db"].add_all([other_class, other_subject])
    ctx["db"].flush()
    foreign = [
        _foreign_assignment(ctx, title="Other class", class_id=other_class.class_id),
        _foreign_assignment(ctx, title="Other subject", subject_id=other_subject.subject_id),
        _foreign_assignment(ctx, title="Other period", period_id=ctx["next_period"].academic_period_id),
    ]
    other_student = Student(
        student_id=uuid4(), student_lrn="399999999999", first_name="Other", last_name="Learner",
        academic_level_id=ctx["level"].academic_level_id,
    )
    ctx["db"].add(other_student)
    ctx["db"].flush()
    targeted_work = Classwork(
        title="Other student remediation", classwork_type="QUIZ", classwork_category="WRITTEN_WORK",
        total_points=Decimal("10"), is_graded=True, subject_id=ctx["subject"].subject_id,
        created_by_staff_id=ctx["staff"].staff_id,
    )
    ctx["db"].add(targeted_work)
    ctx["db"].flush()
    other_student_assignment = ClassworkAssignment(
        classwork_id=targeted_work.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=ctx["staff"].staff_id,
        recipient_student_id=other_student.student_id,
        source_intervention_id=_id(ctx),
        remediation_request_id=uuid4(),
    )
    ctx["db"].add(other_student_assignment)
    ctx["db"].commit()

    response = _http(ctx).post(_path(ctx), json={
        "target_assignment_ids": [
            *(item.classwork_assignment_id for item in foreign),
            other_student_assignment.classwork_assignment_id,
        ],
    })

    assert response.status_code == 422
    reasons = {item["code"] for item in response.json()["detail"]["reasons"]}
    assert reasons == {"TARGET_OUTSIDE_INTERVENTION_SCOPE", "TARGET_OUTSIDE_STUDENT_SCOPE"}
    assert _http(ctx).post(_path(ctx), json={
        "target_assignment_ids": [], "student_id": str(other_student.student_id),
    }).status_code == 422


def test_incomplete_midterm_projection_keeps_individual_gains(candidate_context):
    ctx = candidate_context
    _activate(ctx)
    _save_cap(ctx, 90)
    target = _focused_targets(ctx)[1]

    response = _http(ctx).post(_path(ctx), json={"target_assignment_ids": [target.classwork_assignment_id]})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "UNAVAILABLE"
    assert body["current_subject_grade"] is None
    assert body["target_projections"][0]["possible_score_gain"] > 0
    assert body["target_projections"][0]["projected_subject_grade"] is None
    assert body["target_projections"][0]["reaches_passing_threshold"] is None
    assert "INCOMPLETE_EXAMINATION_EVIDENCE" in {item["code"] for item in body["unavailable_reasons"]}


def test_ai_midterm_baseline_replays_existing_pipeline_with_same_model(candidate_context, monkeypatch):
    ctx = candidate_context
    _activate(ctx)
    source = _source(ctx["db"], ctx["candidate"])
    model_name = ctx["db"].get(AIModelVersion, source.model_version_id).model_name

    def deterministic(features, model_name=None):
        return round(55.0 + float(features["overall_partial_percent"]) * 0.3, 6)

    monkeypatch.setattr(current_term_scorer, "score_development_current_term", deterministic)
    expected = predict_development_current_term(
        ctx["db"],
        ctx["student"].student_id,
        ctx["class"].class_id,
        ctx["subject"].subject_id,
        ctx["period"].academic_period_id,
        model_name=model_name,
    )

    response = _http(ctx).post(_path(ctx), json={"target_assignment_ids": []})

    assert response.status_code == 200, response.text
    body = response.json()
    estimate = body["ai_midterm_what_if"]
    assert body["status"] == "UNAVAILABLE"  # No complete Examination evidence.
    assert estimate["status"] == "AVAILABLE"
    assert estimate["baseline_predicted_term_grade"] == expected["projected_final_term_grade"]
    assert estimate["model_version_id"] == source.model_version_id
    assert estimate["model_name"] == model_name
    assert estimate["is_official_grade"] is False
    assert estimate["is_guaranteed"] is False


def test_ai_midterm_one_and_cumulative_targets_rebuild_only_score_features(candidate_context, monkeypatch):
    ctx = candidate_context
    _activate(ctx)
    _save_cap(ctx, 90)
    target_ids = [item.classwork_assignment_id for item in _focused_targets(ctx)[:2]]
    scored_features = []

    def deterministic(features, model_name=None):
        scored_features.append(dict(features))
        return round(50.0 + float(features["overall_partial_percent"]) * 0.4, 6)

    monkeypatch.setattr(current_term_scorer, "score_development_current_term", deterministic)
    before = {
        row.submission_id: row.grade for row in ctx["db"].query(StudentSubmission).all()
    }
    before_interventions = ctx["db"].query(Intervention).count()

    response = _http(ctx).post(_path(ctx), json={"target_assignment_ids": target_ids})

    assert response.status_code == 200, response.text
    estimate = response.json()["ai_midterm_what_if"]
    assert estimate["status"] == "AVAILABLE"
    assert [item["assignment_id"] for item in estimate["target_estimates"]] == target_ids
    assert all(item["maximum_hypothetical_effective_score"] == 9.0 for item in estimate["target_estimates"])
    assert len(scored_features) == 3  # baseline, first target, then both targets
    baseline, first, cumulative = scored_features
    for name in (
        "ww_available_activity_count", "pt_available_activity_count",
        "ww_points_possible_so_far", "pt_points_possible_so_far",
        "qa_points_earned_so_far", "qa_points_possible_so_far",
    ):
        assert first[name] == cumulative[name] == baseline[name]
    component_prefix = "ww" if _focused_targets(ctx)[0].classwork.classwork_category == "WRITTEN_WORK" else "pt"
    earned = f"{component_prefix}_points_earned_so_far"
    assert first[earned] > baseline[earned]
    assert cumulative[earned] > first[earned]
    assert estimate["target_estimates"][1]["estimated_difference_from_baseline"] > 0
    assert {row.submission_id: row.grade for row in ctx["db"].query(StudentSubmission).all()} == before
    assert ctx["db"].query(Intervention).count() == before_interventions
    assert not ctx["db"].new and not ctx["db"].dirty and not ctx["db"].deleted


def test_ai_midterm_is_unavailable_when_normal_prediction_readiness_fails(candidate_context, monkeypatch):
    ctx = candidate_context
    _activate(ctx)
    for submission in ctx["db"].query(StudentSubmission).all():
        submission.grade = None
    ctx["db"].commit()
    monkeypatch.setattr(
        current_term_scorer,
        "score_development_current_term",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("Scorer must not run")),
    )

    response = _http(ctx).post(_path(ctx), json={"target_assignment_ids": []})

    assert response.status_code == 200, response.text
    estimate = response.json()["ai_midterm_what_if"]
    assert estimate["status"] == "UNAVAILABLE"
    codes = {item["code"] for item in estimate["unavailable_reasons"]}
    assert "INSUFFICIENT_AVAILABLE_ACTIVITIES" in codes
    assert "MISSING_WRITTEN_WORK_EVIDENCE" in codes
    assert "MISSING_PERFORMANCE_TASK_EVIDENCE" in codes


def test_subject_threshold_and_finalized_period_contract(candidate_context):
    ctx = candidate_context
    _activate(ctx)
    _complete_exams(ctx)
    _save_cap(ctx, 90)
    target = _focused_targets(ctx)[0]
    available = _http(ctx).post(_path(ctx), json={"target_assignment_ids": []})
    assert available.status_code == 200
    assert available.json()["passing_threshold"] == 87.0
    assert available.json()["passing_threshold_policy"]["source"] == "live_grading_template"

    ctx["db"].add(StudentPeriodGrade(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        initial_grade=Decimal("86"),
        transmuted_grade=Decimal("89"),
        final_period_grade=Decimal("90"),
        is_finalized=True,
    ))
    ctx["db"].commit()

    finalized = _http(ctx).post(_path(ctx), json={"target_assignment_ids": [target.classwork_assignment_id]})

    assert finalized.status_code == 200, finalized.text
    body = finalized.json()
    assert body["status"] == "FINALIZED"
    assert body["grade_representation"] == "FINAL_PERIOD_GRADE"
    assert body["current_subject_grade"] == 90.0
    assert body["recommended_target_assignment_id"] is None
    assert body["additional_eligible_targets_have_positive_improvement"] is False
