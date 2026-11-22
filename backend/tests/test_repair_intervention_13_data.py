"""Regression tests for Task 1B safe data repair of leaked reading & spurious lesson link.

Verifies:
1. Dry-run makes zero mutations and reports exact affected rows.
2. Transactional repair removes the leaked THIS_STUDENT recipient, prerequisite (re-sequencing
   remaining display_order contiguously), selected_resource entry, and spurious Lesson 1 link
   while preserving Lesson 2, ordinary shared readings, scores, submissions, and resolved origin
   intervention #12 byte-for-byte.
3. Post-repair student access (`assignment_allows_student`, `resolve_required_readings`,
   `evaluate_remediation_prerequisite`) and teacher workspace (`get_workspace`) work cleanly.
4. Second apply is idempotent (`ALREADY_REPAIRED`).
5. Rollback restores exact pre-repair state and can be re-applied cleanly.
6. Safety guardrails abort if target student already has a submission/review on the leaked reading
   or if any remediation quiz question maps to the lesson slated for removal.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkAssignmentRecipient import ClassworkAssignmentRecipient
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.classwork.RemediationReadingPrerequisite import RemediationReadingPrerequisite
from app.models.intervention.InterventionReadingReview import InterventionReadingReview
from app.models.quiz.Question import Question
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.classwork.ClassworkAccessService import assignment_allows_student
from app.services.intervention.InterventionRemediationService import get_workspace
from app.services.intervention.RemediationPrerequisiteService import (
    evaluate_remediation_prerequisite,
)
from app.services.intervention.StudentPersistentInterventionService import (
    resolve_required_readings,
)
from scripts.repair_intervention_13_data import (
    apply_repair,
    inspect_repair_plan,
    rollback_repair,
    snapshot_origin_intervention_fingerprint,
)
from tests.test_classwork_submission_authorization import authz_context
from tests.test_intervention_lesson_scoping_and_isolation import _setup_two_lesson_math_scenario


def _seed_corrupted_intervention_pair(authz_context):
    """Replicate the exact Intervention #12 (RESOLVED) + Intervention #13 (ACTIVE) anomaly."""
    ctx = _setup_two_lesson_math_scenario(authz_context)
    db = ctx["db"]
    staff_id = ctx["owner"].staff_id
    class_a = ctx["class_a"]
    period = ctx["period"]
    subject = ctx["subject"]
    roy = ctx["student_a"]
    jayson = ctx["student_b"]

    # Ordinary classwide readings for Lesson 1 & Lesson 2
    reading_l1_shared = ctx["create_reading"](
        "Basic Geometric Figures",
        lessons=[ctx["lesson_1"]],
        class_ids=[class_a.class_id],
    )
    reading_l2_shared = ctx["create_reading"](
        "Parallel and Perpendicular Lines",
        lessons=[ctx["lesson_2"]],
        class_ids=[class_a.class_id],
    )
    asgn_r1 = db.query(ClassworkAssignment).filter_by(classwork_id=reading_l1_shared.classwork_id).one()
    asgn_r2 = db.query(ClassworkAssignment).filter_by(classwork_id=reading_l2_shared.classwork_id).one()

    # Original quizzes
    quiz_l1 = ctx["create_quiz"](
        "Lesson 1: Basic Geometric Figures",
        class_row=class_a,
        lesson_items=[(ctx["lesson_1"], Decimal("10"), Decimal("3"))],
        student_row=roy,
    )
    quiz_l2 = ctx["create_quiz"](
        "Parallel and Perpendicular Lines Quiz",
        class_row=class_a,
        lesson_items=[(ctx["lesson_2"], Decimal("10"), Decimal("1"))],
        student_row=jayson,
    )

    # Resolved origin Intervention (analogous to #12)
    origin_int = ctx["create_intervention"](
        roy,
        class_a,
        activities=[quiz_l1["activity"]],
        supporting_scores=quiz_l1["supporting_scores"],
    )
    origin_int.status = "RESOLVED"
    origin_int.resolution_reason = "IMPROVED_PREDICTION"
    origin_int.resolved_at = datetime.now(timezone.utc)

    # Active target Intervention (analogous to #13)
    target_int = ctx["create_intervention"](
        jayson,
        class_a,
        activities=[quiz_l2["activity"]],
        supporting_scores=quiz_l2["supporting_scores"],
    )

    # Private THIS_STUDENT reading created for Roy's origin intervention, leaked to Jayson
    leaked_reading = ctx["create_reading"](
        "Geometric figures",
        lessons=[ctx["lesson_1"]],
        class_ids=[class_a.class_id],
        origin_id=origin_int.intervention_id,
        recipient_scope="THIS_STUDENT",
        recipient_student_ids=[roy.student_id, jayson.student_id],
    )
    asgn_leaked = db.query(ClassworkAssignment).filter_by(classwork_id=leaked_reading.classwork_id).one()

    origin_int.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_ids": [quiz_l1["assignment"].classwork_assignment_id],
        "score_adjustment_cap": 85.0,
        "selected_resources": [
            {"kind": "CLASSWORK", "id": reading_l1_shared.classwork_id},
            {"kind": "CLASSWORK", "id": reading_l2_shared.classwork_id},
            {"kind": "CLASSWORK", "id": leaked_reading.classwork_id},
        ],
    }
    target_int.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_ids": [quiz_l2["assignment"].classwork_assignment_id],
        "score_adjustment_cap": 65.0,
        "selected_resources": [
            {"kind": "CLASSWORK", "id": reading_l1_shared.classwork_id},
            {"kind": "CLASSWORK", "id": leaked_reading.classwork_id},
            {"kind": "CLASSWORK", "id": reading_l2_shared.classwork_id},
        ],
    }

    # Remediation quiz for Jayson (analogous to classwork_id=73): questions map ONLY to Lesson 2,
    # but classwork_lesson erroneously contains BOTH Lesson 1 and Lesson 2.
    rem_quiz_cw = Classwork(
        title="Enhanced Mathematics 9 focused practice",
        classwork_type="QUIZ",
        classwork_category="WRITTEN_WORK",
        subject_id=subject.subject_id,
        created_by_staff_id=staff_id,
        total_points=Decimal("10"),
        is_graded=True,
        is_published=True,
        is_archived=False,
    )
    rem_quiz_cw.lessons = [ctx["lesson_1"], ctx["lesson_2"]]
    db.add(rem_quiz_cw)
    db.flush()

    rem_quiz_asgn = ClassworkAssignment(
        classwork_id=rem_quiz_cw.classwork_id,
        class_id=class_a.class_id,
        academic_period_id=period.academic_period_id,
        recipient_student_id=jayson.student_id,
        source_intervention_id=target_int.intervention_id,
        remediation_request_id=uuid4(),
        assigned_by_staff_id=staff_id,
        is_published=True,
    )
    db.add(rem_quiz_asgn)
    db.flush()

    rem_quiz = Quiz(classwork_id=rem_quiz_cw.classwork_id, total_items=2, status="PUBLISHED")
    db.add(rem_quiz)
    db.flush()
    for order in (1, 2):
        q = Question(
            question_text=f"Parallel lines question {order}",
            question_type="SHORT_ANSWER",
            points=Decimal("5"),
            lesson_id=ctx["lesson_2"].lesson_id,
        )
        db.add(q)
        db.flush()
        db.add(QuizQuestion(quiz_id=rem_quiz.quiz_id, question_id=q.question_id, display_order=order))

    db.add(
        RemediationAssignmentLink(
            source_intervention_id=target_int.intervention_id,
            remediation_assignment_id=rem_quiz_asgn.classwork_assignment_id,
            original_assignment_id=quiz_l2["assignment"].classwork_assignment_id,
            student_id=jayson.student_id,
            component="WRITTEN_WORK",
            score_adjustment_cap=Decimal("65.00"),
            created_by_staff_id=staff_id,
        )
    )
    db.add_all(
        [
            RemediationReadingPrerequisite(
                remediation_assignment_id=rem_quiz_asgn.classwork_assignment_id,
                reading_classwork_id=reading_l1_shared.classwork_id,
                reading_assignment_id=asgn_r1.classwork_assignment_id,
                display_order=1,
            ),
            RemediationReadingPrerequisite(
                remediation_assignment_id=rem_quiz_asgn.classwork_assignment_id,
                reading_classwork_id=leaked_reading.classwork_id,
                reading_assignment_id=asgn_leaked.classwork_assignment_id,
                display_order=2,
            ),
            RemediationReadingPrerequisite(
                remediation_assignment_id=rem_quiz_asgn.classwork_assignment_id,
                reading_classwork_id=reading_l2_shared.classwork_id,
                reading_assignment_id=asgn_r2.classwork_assignment_id,
                display_order=3,
            ),
        ]
    )
    db.commit()

    return {
        **ctx,
        "roy": roy,
        "jayson": jayson,
        "origin_int": origin_int,
        "target_int": target_int,
        "reading_l1_shared": reading_l1_shared,
        "reading_l2_shared": reading_l2_shared,
        "leaked_reading": leaked_reading,
        "asgn_leaked": asgn_leaked,
        "rem_quiz_cw": rem_quiz_cw,
        "rem_quiz_asgn": rem_quiz_asgn,
        "repair_kwargs": {
            "target_intervention_id": target_int.intervention_id,
            "origin_intervention_id": origin_int.intervention_id,
            "leaked_reading_classwork_id": leaked_reading.classwork_id,
            "remediation_classwork_id": rem_quiz_cw.classwork_id,
            "spurious_lesson_id": ctx["lesson_1"].lesson_id,
            "expected_lesson_id": ctx["lesson_2"].lesson_id,
        },
    }


def test_repair_dry_run_apply_idempotency_and_rollback(authz_context, tmp_path):
    s = _seed_corrupted_intervention_pair(authz_context)
    db = s["db"]
    kwargs = s["repair_kwargs"]
    backup_path = tmp_path / "repair_backup.json"

    origin_fp_initial = snapshot_origin_intervention_fingerprint(
        db,
        origin_intervention_id=s["origin_int"].intervention_id,
        leaked_reading_classwork_id=s["leaked_reading"].classwork_id,
    )["sha256"]

    # 1. Dry-run reports all 4 changes and makes zero mutations.
    dry = apply_repair(db, **kwargs, dry_run=True)
    assert dry["status"] == "DRY_RUN"
    assert len(dry["plan"]["changes"]["delete_recipients"]) == 1
    assert len(dry["plan"]["changes"]["delete_prerequisites"]) == 1
    assert len(dry["plan"]["changes"]["reorder_prerequisites"]) == 1
    assert dry["plan"]["changes"]["update_remediation_plan"]["needed"] is True
    assert dry["plan"]["changes"]["delete_classwork_lesson"]["lesson_id"] == s["lesson_1"].lesson_id
    assert assignment_allows_student(s["asgn_leaked"], s["jayson"].student_id) is True

    # 2. Apply repair transactionally.
    applied = apply_repair(db, **kwargs, dry_run=False, backup_file=backup_path)
    assert applied["status"] == "REPAIRED"
    assert backup_path.exists()
    assert applied["origin_fingerprint_after"] == origin_fp_initial

    db.expire_all()

    # Student access: Jayson loses access to Roy's private reading; Roy keeps access.
    asgn_leaked = db.get(ClassworkAssignment, s["asgn_leaked"].classwork_assignment_id)
    assert assignment_allows_student(asgn_leaked, s["jayson"].student_id) is False
    assert assignment_allows_student(asgn_leaked, s["roy"].student_id) is True

    # Required readings & prerequisite evaluation for Jayson have zero inaccessible issues.
    target_int = db.get(type(s["target_int"]), s["target_int"].intervention_id)
    readings, issues, prep = resolve_required_readings(db, target_int, s["jayson"].student_id)
    assert issues == []
    assert [r.classwork_id for r in readings] == [
        s["reading_l1_shared"].classwork_id,
        s["reading_l2_shared"].classwork_id,
    ]
    assert prep.required_count == 2
    assert prep.unavailable_count == 0

    rem_asgn = db.get(ClassworkAssignment, s["rem_quiz_asgn"].classwork_assignment_id)
    decision = evaluate_remediation_prerequisite(db, rem_asgn, s["jayson"])
    assert decision.code == "PREPARATION_REQUIRED"
    assert decision.resource_issues == ()
    assert [r.classwork_id for r in decision.readings] == [
        s["reading_l1_shared"].classwork_id,
        s["reading_l2_shared"].classwork_id,
    ]

    # Remediation quiz classwork_lesson retains ONLY Lesson 2.
    rem_cw = db.get(Classwork, s["rem_quiz_cw"].classwork_id)
    assert [l.lesson_id for l in rem_cw.lessons] == [s["lesson_2"].lesson_id]

    # Teacher workspace reflects Task 1 scoping & isolation cleanly.
    ws = get_workspace(db, s["owner"].staff_id, target_int.intervention_id)
    assert ws["focus"]["lesson_ids"] == [s["lesson_2"].lesson_id]
    ws_res_ids = {r["id"] for r in ws["resources"]}
    assert s["leaked_reading"].classwork_id not in ws_res_ids
    assert {r["id"] for r in ws["resources"] if r["recommended"]} == {s["reading_l2_shared"].classwork_id}

    # 3. Idempotent re-run makes no writes.
    second = apply_repair(db, **kwargs, dry_run=False)
    assert second["status"] == "ALREADY_REPAIRED"

    # 4. Rollback restores exact pre-repair state without touching origin intervention #12.
    rolled = rollback_repair(db, applied["backup"])
    assert rolled["status"] == "ROLLED_BACK"
    assert rolled["origin_fingerprint"] == origin_fp_initial

    db.expire_all()
    post_rb = inspect_repair_plan(db, **kwargs)
    assert post_rb["needs_repair"] is True
    assert len(post_rb["changes"]["delete_recipients"]) == 1
    assert len(post_rb["changes"]["delete_prerequisites"]) == 1
    assert post_rb["changes"]["delete_classwork_lesson"]["lesson_id"] == s["lesson_1"].lesson_id

    # 5. Re-applying after rollback succeeds cleanly.
    reapplied = apply_repair(db, **kwargs, dry_run=False)
    assert reapplied["status"] == "REPAIRED"


def test_repair_guardrails_abort_if_student_interacted_with_leaked_reading(authz_context):
    s = _seed_corrupted_intervention_pair(authz_context)
    db = s["db"]

    db.add(
        InterventionReadingReview(
            intervention_id=s["target_int"].intervention_id,
            reading_assignment_id=s["asgn_leaked"].classwork_assignment_id,
            student_id=s["jayson"].student_id,
            review_cycle=1,
        )
    )
    db.commit()

    with pytest.raises(ValueError, match="reading review"):
        inspect_repair_plan(db, **s["repair_kwargs"])


def test_repair_guardrails_abort_if_quiz_has_question_for_removed_lesson(authz_context):
    s = _seed_corrupted_intervention_pair(authz_context)
    db = s["db"]

    quiz = db.query(Quiz).filter_by(classwork_id=s["rem_quiz_cw"].classwork_id).one()
    extra_q = Question(
        question_text="Legitimate Lesson 1 item",
        question_type="SHORT_ANSWER",
        points=Decimal("5"),
        lesson_id=s["lesson_1"].lesson_id,
    )
    db.add(extra_q)
    db.flush()
    db.add(QuizQuestion(quiz_id=quiz.quiz_id, question_id=extra_q.question_id, display_order=3))
    db.commit()

    with pytest.raises(ValueError, match="question lessons"):
        inspect_repair_plan(db, **s["repair_kwargs"])
