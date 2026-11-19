"""Task 5: End-to-end verification of Entervene's complete progressive remediation workflow.

Verifies in one isolated SQLite scenario (zero mutations to live DB):
1. AI and manual remediation inherit the linked original classwork's exact rubric,
   score ranges, grading component, and maximum points (including across target switches).
2. Teacher rubric grading awards scores within full rubric ranges while the remediation
   ceiling applies strictly to the effective adjusted original score.
3. Two sequential remediation activities targeting different original classworks preserve
   independent grading, capped adjustments, and historical records.
4. Reloading workspace exposes consistent data for Steps 1, 4, and 5.
5. Grading each remediation activity updates gradebook effective scores and triggers a
   fresh prediction refresh using updated effective evidence.
6. Resolved intervention cycles retain their historical resolution prediction while
   newer active cycles show current risk.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.classwork.ActivityRubricLevel import ActivityRubricLevel
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.RemediationDraft import RemediationDraftGenerationRequest
from app.schemas.Submission import GradeRequest
from app.services.classwork.ClassworkService import create_classwork_wizard_record
from app.services.intervention.InterventionRemediationAssessmentCreationService import (
    create_remediation_assessment,
)
from app.services.intervention.InterventionRemediationDraftGenerationService import (
    generate_remediation_draft,
)
from app.services.intervention.InterventionRemediationService import (
    PlanUpdate,
    get_workspace,
    save_plan,
)
from app.services.intervention.TeacherInterventionService import (
    get_teacher_active,
    get_teacher_resolved,
    list_teacher_active,
    list_teacher_resolved,
)
from app.services.prediction.CurrentPeriodFeatureBuilderService import (
    build_current_period_features_from_records,
)
from app.services.student_record.StudentRecordService import teacher_student_gradebook
from app.services.submission import SubmissionFeedbackService, SubmissionService
from app.services.submission.SubmissionService import grade_student_submission
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_remediation_draft_preflight import _setup_intervention_with_targets
from tests.test_remediation_rubric_alignment import (
    RUBRIC_A,
    RUBRIC_B,
    _ai_classwork_payload,
    _attach_rubric,
)
from tests.test_remediation_target_persistence import _make_classwork_target
from tests.test_teacher_intervention_review import _staff, candidate_context


@pytest.mark.anyio
async def test_complete_progressive_remediation_end_to_end(candidate_context, monkeypatch):
    ctx = candidate_context
    db = ctx["db"]
    staff_id = _staff(ctx)
    ctx["template"].passing_threshold = Decimal("85.00")

    monkeypatch.setattr(
        SubmissionFeedbackService,
        "dispatch_background_draft_processing",
        lambda *_args, **_kwargs: None,
    )

    # Track post-grade prediction refresh triggers and simulate persisting a fresh revision
    refresh_calls: list[dict] = []

    def _fake_refresh(_bind, *, student_ids, class_id, subject_id, period_id):
        refresh_calls.append({
            "student_ids": list(student_ids),
            "class_id": class_id,
            "subject_id": subject_id,
            "period_id": period_id,
        })
        # Persist a fresh prediction revision on the same test session reflecting updated evidence
        latest = (
            db.query(DevelopmentCurrentTermPrediction)
            .filter_by(
                student_id=ctx["student"].student_id,
                class_id=class_id,
                subject_id=subject_id,
                source_period_id=period_id,
                target_period_id=period_id,
                model_version_id=ctx["model_id"],
            )
            .order_by(DevelopmentCurrentTermPrediction.revision.desc())
            .first()
        )
        next_rev = (latest.revision if latest else 0) + 1
        # Keep cycle 2 below 85 so progression to Activity 2 remains realistic
        grade_val = 82.75 if len(refresh_calls) >= 2 else 82.60
        db.add(
            DevelopmentCurrentTermPrediction(
                student_id=ctx["student"].student_id,
                class_id=class_id,
                subject_id=subject_id,
                source_period_id=period_id,
                target_period_id=period_id,
                model_version_id=ctx["model_id"],
                revision=next_rev,
                predicted_period_grade=Decimal(f"{grade_val:.2f}"),
                intervention_level="MODERATE_RISK",
                intervention_basis="DEVELOPMENT_CURRENT_TERM_PROJECTION",
                evidence_snapshot={
                    "readiness": {"status": "READY"},
                    "projected_final_term_grade_raw": grade_val,
                },
                generated_at=datetime(2026, 11, 19, 12, 0, len(refresh_calls), tzinfo=timezone.utc),
            )
        )
        db.commit()

    monkeypatch.setattr(
        SubmissionService,
        "refresh_after_committed_grade_change",
        _fake_refresh,
    )

    # ── Set up Cycle 1 (RESOLVED at 85.36 / NEEDS_MONITORING) and Cycle 2 (ACTIVE at 82.89) ──
    base_time = datetime(2026, 11, 19, 1, 0, 0, tzinfo=timezone.utc)
    competency, lesson, target_a, reading = _setup_intervention_with_targets(
        ctx, "PERFORMANCE_TASK", 50.0,
    )
    _attach_rubric(db, target_a.classwork, RUBRIC_A)
    orig_sub_a = db.query(StudentSubmission).filter_by(
        classwork_assignment_id=target_a.classwork_assignment_id,
        student_id=ctx["student"].student_id,
    ).one()
    orig_sub_a.grade = Decimal("20.0")
    orig_sub_a.status = "graded"

    target_b = _make_classwork_target(
        ctx,
        "PT 2 - Ratio Modeling",
        category="PERFORMANCE_TASK",
        classwork_type="ACTIVITY",
        score=12.0,
        points=30.0,
    )
    _attach_rubric(db, target_b.classwork, RUBRIC_B)

    cycle1 = ctx["candidate"]
    source1 = db.get(DevelopmentCurrentTermPrediction, cycle1.source_prediction_id)
    source1.predicted_period_grade = Decimal("82.55")
    source1.evidence_snapshot = {
        "readiness": {"status": "READY"},
        "projected_final_term_grade_raw": 82.55,
    }
    source1.intervention_level = "MODERATE_RISK"
    source1.generated_at = base_time

    rev3_resolved = DevelopmentCurrentTermPrediction(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        source_period_id=ctx["period"].academic_period_id,
        target_period_id=ctx["period"].academic_period_id,
        model_version_id=ctx["model_id"],
        revision=3,
        predicted_period_grade=Decimal("85.36"),
        intervention_level="NEEDS_MONITORING",
        intervention_basis="DEVELOPMENT_CURRENT_TERM_PROJECTION",
        evidence_snapshot={
            "readiness": {"status": "READY"},
            "projected_final_term_grade_raw": 85.35548749398748,
        },
        generated_at=base_time + timedelta(minutes=34),
    )
    rev4_cycle2 = DevelopmentCurrentTermPrediction(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        source_period_id=ctx["period"].academic_period_id,
        target_period_id=ctx["period"].academic_period_id,
        model_version_id=ctx["model_id"],
        revision=4,
        predicted_period_grade=Decimal("82.89"),
        intervention_level="MODERATE_RISK",
        intervention_basis="DEVELOPMENT_CURRENT_TERM_PROJECTION",
        evidence_snapshot={
            "readiness": {"status": "READY"},
            "projected_final_term_grade_raw": 82.89,
            "generation_cutoff_at": cycle1.diagnosis_snapshot["evidence_cutoff_at"],
        },
        generated_at=base_time + timedelta(minutes=44),
    )
    db.add_all([rev3_resolved, rev4_cycle2])
    db.flush()

    cycle1.status = "RESOLVED"
    cycle1.resolution_reason = "IMPROVED_PREDICTION"
    cycle1.resolved_at = base_time + timedelta(minutes=34, seconds=1)

    cycle2_diagnosis = {
        **cycle1.diagnosis_snapshot,
        "source_prediction_id": rev4_cycle2.prediction_id,
        "source_prediction_revision": rev4_cycle2.revision,
    }
    cycle2 = Intervention(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        source_prediction_id=rev4_cycle2.prediction_id,
        status="ACTIVE",
        diagnosis_snapshot=cycle2_diagnosis,
        activated_at=base_time + timedelta(minutes=45),
        activated_by_staff_id=staff_id,
        remediation_plan={
            "teacher_choice": "CLASSWORK",
            "grade_treatment": "PERFORMANCE_TASK",
            "target_assignment_ids": [target_a.classwork_assignment_id],
            "score_adjustment_cap": 75.0,
            "selected_resources": [{"kind": "CLASSWORK", "id": reading.classwork_id}],
            "ai_suggestion": None,
        },
    )
    db.add(cycle2)
    db.commit()

    # ── Remediation 1 (AI Path -> Target A, 50 pts, RUBRIC_A) ──
    ai_payload_a = _ai_classwork_payload(
        competency.competency_id,
        lesson.lesson_id,
        title="Remediation 1 - Geometric Proofs",
    )
    with patch("app.services.ai.Provider.generate_text", AsyncMock(return_value=json.dumps(ai_payload_a))):
        draft_1 = await generate_remediation_draft(
            db,
            staff_id,
            cycle2.intervention_id,
            RemediationDraftGenerationRequest(
                draft_format="CLASSWORK",
                target_component="PERFORMANCE_TASK",
                grade_treatment="PERFORMANCE_TASK",
                target_assignment_id=target_a.classwork_assignment_id,
                item_count=1,
                total_points=50.0,
            ),
        )
    assert draft_1.total_points == 50.0
    assert [r.model_dump() for r in draft_1.rubric_levels] == RUBRIC_A

    rem1_res = create_remediation_assessment(
        db,
        staff_id=staff_id,
        intervention_id=cycle2.intervention_id,
        remediation_request_id=uuid4(),
        target_assignment_id=target_a.classwork_assignment_id,
        draft_input=draft_1,
    )
    rem1_asgn = db.get(ClassworkAssignment, rem1_res.classwork_assignment_id)
    rem1_cw = db.get(Classwork, rem1_res.classwork_id)
    rem1_cw.is_published = True
    rem1_asgn.is_published = True
    rem1_sub = StudentSubmission(
        classwork_assignment_id=rem1_asgn.classwork_assignment_id,
        student_id=ctx["student"].student_id,
        status="submitted",
    )
    db.add(rem1_sub)
    db.commit()

    # Teacher awards 45/50 (within Mastery 50–39 range, above 75% ceiling of 37.5)
    graded_1 = grade_student_submission(
        rem1_sub.submission_id,
        GradeRequest(grade=45.0, feedback="Mastery level demonstrated."),
        staff_id,
        db,
    )
    assert float(graded_1.grade) == 45.0
    assert len(refresh_calls) == 1

    # ── Progressive Step: Select Target B -> Remediation 2 (Manual Path -> Target B, 30 pts, RUBRIC_B) ──
    save_plan(
        db,
        staff_id,
        cycle2.intervention_id,
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="PERFORMANCE_TASK",
            target_assignment_ids=[target_a.classwork_assignment_id, target_b.classwork_assignment_id],
            score_adjustment_cap=75.0,
            selected_resources=[{"kind": "CLASSWORK", "id": reading.classwork_id}],
        ),
    )

    teacher_user = {"role": "teacher", "sub": str(ctx["staff"].user_id)}
    rem2_created = await create_classwork_wizard_record(
        title="Remediation 2 - Ratio Modeling",
        description="Targeted manual remediation for ratios",
        instructions="Complete the ratio diagram and show proportions.",
        classwork_type="ASSIGNMENT",
        classwork_category="PERFORMANCE_TASK",
        exam_subtype=None,
        total_points=30.0,
        subject_id=ctx["subject"].subject_id,
        is_published=True,
        show_scores=True,
        class_ids=json.dumps([ctx["class"].class_id]),
        academic_period_id=ctx["period"].academic_period_id,
        lesson_ids=None,
        due_date=None,
        lock_date=None,
        allow_late_submissions=False,
        max_attempts=None,
        quiz_payload=None,
        rubric_payload=json.dumps(RUBRIC_B),
        files=None,
        intervention_id=cycle2.intervention_id,
        remediation_request_id=uuid4(),
        original_classwork_assignment_id=target_b.classwork_assignment_id,
        current_user=teacher_user,
        staff_id=staff_id,
        db=db,
    )
    assert [(r.level_name, float(r.points)) for r in rem2_created.rubric_levels] == [
        (r["level_name"], r["points"]) for r in RUBRIC_B
    ]

    rem2_asgn = db.query(ClassworkAssignment).filter_by(classwork_id=rem2_created.classwork_id).one()
    rem2_sub = StudentSubmission(
        classwork_assignment_id=rem2_asgn.classwork_assignment_id,
        student_id=ctx["student"].student_id,
        status="submitted",
    )
    db.add(rem2_sub)
    db.commit()

    # Teacher awards 21/30 (within Outstanding 30–21 range, below 75% ceiling of 22.5 -> effective 21.0)
    graded_2 = grade_student_submission(
        rem2_sub.submission_id,
        GradeRequest(grade=21.0, feedback="Clear ratio diagram."),
        staff_id,
        db,
    )
    assert float(graded_2.grade) == 21.0
    assert len(refresh_calls) == 2

    # ── Verify Reloaded Workspace Consistency (Steps 1, 4, 5) ──
    reloaded = get_workspace(db, staff_id, cycle2.intervention_id)
    assigned_list = reloaded["progress"]["assigned_remediation"]
    assert len(assigned_list) == 2

    by_asgn = {item["assignment_id"]: item for item in assigned_list}
    item1 = by_asgn[rem1_asgn.classwork_assignment_id]
    item2 = by_asgn[rem2_asgn.classwork_assignment_id]

    # Remediation 1 preserved independently
    assert item1["original_assignment_id"] == target_a.classwork_assignment_id
    assert item1["original_grade"] == 20.0
    assert item1["grade"] == 45.0
    assert item1["total_points"] == 50.0
    assert item1["effective_grade"] == 37.5
    assert item1["submission_status"] == "graded"

    # Remediation 2 persisted independently
    assert item2["original_assignment_id"] == target_b.classwork_assignment_id
    assert item2["original_grade"] == 12.0
    assert item2["grade"] == 21.0
    assert item2["total_points"] == 30.0
    assert item2["effective_grade"] == 21.0
    assert item2["submission_status"] == "graded"

    # ── Verify Gradebook & Live ML Features Use Effective Adjusted Scores (37.5/50 and 21/30) Without Double-Counting ──
    gradebook = teacher_student_gradebook(
        db,
        staff_id=staff_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
    )
    student_row = next(
        row for row in gradebook.studentGrades
        if str(row.student_id) == str(ctx["student"].student_id)
    )
    pt_columns = gradebook.classwork[0].performanceTask
    pt_by_id = {
        col.id: student_row.performanceTask[idx]
        for idx, col in enumerate(pt_columns)
    }
    assert target_a.classwork_assignment_id in pt_by_id
    assert target_b.classwork_assignment_id in pt_by_id
    assert rem1_asgn.classwork_assignment_id not in pt_by_id
    assert rem2_asgn.classwork_assignment_id not in pt_by_id
    assert pt_by_id[target_a.classwork_assignment_id] == pytest.approx(37.5)
    assert pt_by_id[target_b.classwork_assignment_id] == pytest.approx(21.0)

    # Confirm live ML feature builder reflects the exact same effective PT percentage
    live_features = build_current_period_features_from_records(
        db,
        ctx["student"].student_id,
        ctx["class"].class_id,
        ctx["subject"].subject_id,
        ctx["period"].academic_period_id,
    )
    assert live_features["features"]["pt_percent_so_far"] == pytest.approx(
        float(student_row.ps_performance),
        rel=1e-4,
    )

    # ── Verify Multi-Cycle Prediction Isolation (Resolved vs Active) ──
    resolved_list = list_teacher_resolved(db, staff_id)
    assert resolved_list.total == 1
    assert resolved_list.items[0].intervention_id == cycle1.intervention_id
    assert round(resolved_list.items[0].current_predicted_grade, 2) == 85.36
    assert resolved_list.items[0].current_intervention_level == "NEEDS_MONITORING"
    resolved_detail = get_teacher_resolved(db, staff_id, cycle1.intervention_id)
    assert round(resolved_detail.resolution_projection, 2) == 85.36
    assert resolved_detail.current_prediction_revision == 3

    active_list = list_teacher_active(db, staff_id)
    assert active_list.total == 1
    assert active_list.items[0].intervention_id == cycle2.intervention_id
    assert round(active_list.items[0].current_predicted_grade, 2) == 82.75
    assert active_list.items[0].current_intervention_level == "MODERATE_RISK"
    active_detail = get_teacher_active(db, staff_id, cycle2.intervention_id)
    assert active_detail.current_prediction_revision == 6
    assert round(active_detail.current_predicted_grade, 2) == 82.75
