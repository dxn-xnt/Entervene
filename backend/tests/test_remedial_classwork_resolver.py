"""Unit and integration regression tests for Task 4.7B.2: RemedialClassworkResolver.

Verifies:
1. Original 10/40, remediation 36/40, cap 75% -> effective 30/40 (capped).
2. Remediation lower than original -> no decrease.
3. Remediation below cap -> actual remediation score used when higher than original.
4. Custom cap snapshot (e.g., 85% cap).
5. Incomplete / ungraded remediation -> retains original score.
6. No remediation link -> raw score retained directly.
7. Multi-student isolation: Student A has remediation, Student B does not.
8. Mismatched maximum points -> retained as unadjusted, no guessing.
9. Corrupt or conflicting linkage -> retained as unadjusted, no guessing.
10. Historical Examination compatibility -> effective_exam_scores unaffected.
11. Original and remediation raw evidence unchanged in DB.
12. Link service authoritative plan cap enforcement and snapshot idempotency.
13. Change detection helpers (effective_classwork_score_for_change & effective_classwork_grade_changed).
14. Database helpers (resolve_remediation_for_student_period & resolve_class_remediation_scores).
"""

from __future__ import annotations

import asyncio
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.intervention.Intervention import Intervention
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.classwork.ClassworkService import create_classwork_wizard_record
from app.services.grading.RemedialClassworkResolver import (
    RemedialClassworkAudit,
    ResolvedClassworkScores,
    effective_classwork_grade_changed,
    effective_classwork_score_for_change,
    resolve_class_remediation_scores,
    resolve_remediation_for_student_period,
    resolve_student_classwork_scores,
)
from app.services.grading.RemedialExamination import effective_exam_scores
from app.services.intervention.InterventionRemediationService import PlanUpdate, save_plan
from app.services.intervention.RemediationAssignmentLinkService import create_remediation_assignment_link
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_intervention_support_materials import _activate
from tests.test_remediation_target_persistence import _make_classwork_target
from tests.test_targeted_remedial_classwork import _linked_classwork_kwargs
from tests.test_teacher_intervention_review import candidate_context, _id, _staff


class DummyAssignment:
    def __init__(self, classwork_assignment_id: int, total_points: float | int | Decimal = 40.0, original_exam_assignment_id: int | None = None, recipient_student_id: UUID | None = None):
        self.classwork_assignment_id = classwork_assignment_id
        self.total_points = Decimal(str(total_points))
        self.original_exam_assignment_id = original_exam_assignment_id
        self.recipient_student_id = recipient_student_id


class DummyLink:
    def __init__(self, remediation_link_id: int, original_id: int, remediation_id: int, student_id: UUID, cap: float | str | Decimal = 75.0, component: str = "WRITTEN_WORK", source_intervention_id: int = 1):
        self.remediation_link_id = remediation_link_id
        self.original_assignment_id = original_id
        self.remediation_assignment_id = remediation_id
        self.student_id = student_id
        self.score_adjustment_cap = Decimal(str(cap))
        self.component = component
        self.source_intervention_id = source_intervention_id


# ---------------------------------------------------------------------------
# Pure Calculation / Unit Tests
# ---------------------------------------------------------------------------

def test_pure_capped_adjustment_scenario_1():
    """Requirement: Original 10/40, remediation 36/40, cap 75% -> effective 30/40."""
    student_id = uuid4()
    orig = DummyAssignment(101, total_points=40)
    rem = DummyAssignment(201, total_points=40, recipient_student_id=student_id)
    link = DummyLink(1, 101, 201, student_id, cap=75.0)

    res = resolve_student_classwork_scores(
        student_id=student_id,
        assignments=[orig, rem],
        submissions={101: 10.0, 201: 36.0},
        links=[link],
    )

    assert res.effective_scores[101] == Decimal("30.00")
    assert res.effective_scores_float[101] == 30.0
    # Remediation activity must NOT become an additional official graded entry
    assert 201 not in res.effective_scores
    assert res.remedial_assignment_ids == frozenset({201})

    audit = res.audits_by_original_id[101]
    assert audit.was_adjusted is True
    assert audit.was_capped is True
    assert audit.status == "CAPPED"
    assert audit.original_raw_score == Decimal("10.0")
    assert audit.remediation_raw_score == Decimal("36.0")
    assert audit.effective_score == Decimal("30.00")
    assert audit.cap_score == Decimal("30.00")
    assert audit.max_points == Decimal("40")


def test_pure_remediation_lower_than_original_no_decrease():
    """Requirement: Remediation lower than original -> no decrease."""
    student_id = uuid4()
    orig = DummyAssignment(101, total_points=40)
    rem = DummyAssignment(201, total_points=40, recipient_student_id=student_id)
    link = DummyLink(1, 101, 201, student_id, cap=75.0)

    res = resolve_student_classwork_scores(
        student_id=student_id,
        assignments=[orig, rem],
        submissions={101: 25.0, 201: 15.0},
        links=[link],
    )

    # Never decrease original score
    assert res.effective_scores[101] == Decimal("25.0")
    assert res.effective_scores_float[101] == 25.0
    assert res.remedial_assignment_ids == frozenset({201})

    audit = res.audits_by_original_id[101]
    assert audit.was_adjusted is False
    assert audit.was_capped is False
    assert audit.status == "NO_INCREASE"
    assert audit.effective_score == Decimal("25.0")


def test_pure_remediation_below_cap_used_directly():
    """Requirement: Remediation below cap -> actual remediation score used when higher than original."""
    student_id = uuid4()
    orig = DummyAssignment(101, total_points=40)
    rem = DummyAssignment(201, total_points=40, recipient_student_id=student_id)
    link = DummyLink(1, 101, 201, student_id, cap=75.0)  # cap_score = 30.0

    res = resolve_student_classwork_scores(
        student_id=student_id,
        assignments=[orig, rem],
        submissions={101: 10.0, 201: 25.0},
        links=[link],
    )

    assert res.effective_scores[101] == Decimal("25.0")
    assert res.effective_scores_float[101] == 25.0
    audit = res.audits_by_original_id[101]
    assert audit.was_adjusted is True
    assert audit.was_capped is False
    assert audit.status == "ADJUSTED"
    assert audit.effective_score == Decimal("25.0")


def test_pure_custom_cap_snapshot():
    """Requirement: Custom cap snapshot (e.g., 85% cap)."""
    student_id = uuid4()
    orig = DummyAssignment(101, total_points=40)
    rem = DummyAssignment(201, total_points=40, recipient_student_id=student_id)
    # 40 * 85 / 100 = 34.0
    link = DummyLink(1, 101, 201, student_id, cap=85.0)

    res = resolve_student_classwork_scores(
        student_id=student_id,
        assignments=[orig, rem],
        submissions={101: 10.0, 201: 38.0},
        links=[link],
    )

    assert res.effective_scores[101] == Decimal("34.00")
    audit = res.audits_by_original_id[101]
    assert audit.was_adjusted is True
    assert audit.was_capped is True
    assert audit.cap_score == Decimal("34.00")
    assert audit.score_adjustment_cap == Decimal("85.0")


def test_pure_incomplete_or_ungraded_remediation():
    """Requirement: Incomplete/ungraded remediation retains original effective score."""
    student_id = uuid4()
    orig = DummyAssignment(101, total_points=40)
    rem = DummyAssignment(201, total_points=40, recipient_student_id=student_id)
    link = DummyLink(1, 101, 201, student_id, cap=75.0)

    # Case A: Remediation submission missing
    res_missing = resolve_student_classwork_scores(
        student_id=student_id,
        assignments=[orig, rem],
        submissions={101: 10.0},
        links=[link],
    )
    assert res_missing.effective_scores[101] == Decimal("10.0")
    audit_a = res_missing.audits_by_original_id[101]
    assert audit_a.is_completed is False
    assert audit_a.was_adjusted is False
    assert audit_a.status == "UNGRADED_REMEDIATION"
    assert audit_a.effective_score == Decimal("10.0")

    # Case B: Remediation submission has None grade
    res_none = resolve_student_classwork_scores(
        student_id=student_id,
        assignments=[orig, rem],
        submissions={101: 10.0, 201: None},
        links=[link],
    )
    assert res_none.effective_scores[101] == Decimal("10.0")
    audit_b = res_none.audits_by_original_id[101]
    assert audit_b.is_completed is False
    assert audit_b.was_adjusted is False
    assert audit_b.status == "UNGRADED_REMEDIATION"


def test_pure_no_remediation_link():
    """Requirement: Ordinary WW/PT assignments without remediation retain raw score."""
    student_id = uuid4()
    orig1 = DummyAssignment(101, total_points=40)
    orig2 = DummyAssignment(102, total_points=50)

    res = resolve_student_classwork_scores(
        student_id=student_id,
        assignments=[orig1, orig2],
        submissions={101: 28.0, 102: 45.0},
        links=[],
    )

    assert res.effective_scores == {101: Decimal("28.0"), 102: Decimal("45.0")}
    assert res.remedial_assignment_ids == frozenset()
    assert res.audits_by_original_id == {}
    assert res.audit_records == []


def test_pure_multi_student_isolation():
    """Requirement: Different students sharing a classwork; never apply Student A's remediation to Student B."""
    student_a = uuid4()
    student_b = uuid4()

    shared_orig = DummyAssignment(101, total_points=40)
    rem_a = DummyAssignment(201, total_points=40, recipient_student_id=student_a)
    link_a = DummyLink(1, 101, 201, student_a, cap=75.0)

    # Resolution for Student A
    res_a = resolve_student_classwork_scores(
        student_id=student_a,
        assignments=[shared_orig, rem_a],
        submissions={101: 10.0, 201: 36.0},
        links=[link_a],
    )
    assert res_a.effective_scores[101] == Decimal("30.00")
    assert res_a.remedial_assignment_ids == frozenset({201})

    # Resolution for Student B (Student A's link is present in links list)
    res_b = resolve_student_classwork_scores(
        student_id=student_b,
        assignments=[shared_orig, rem_a],
        submissions={101: 12.0, 201: 36.0},
        links=[link_a],
    )
    # Student B's score must remain their raw 12.0, untouched by Student A's link
    assert res_b.effective_scores[101] == Decimal("12.0")
    assert res_b.remedial_assignment_ids == frozenset()
    assert 101 not in res_b.audits_by_original_id


def test_pure_mismatched_maximum_points_rejected():
    """Requirement: Mismatched maximum points -> retained as unadjusted, no guessing."""
    student_id = uuid4()
    orig = DummyAssignment(101, total_points=40)
    rem = DummyAssignment(201, total_points=20, recipient_student_id=student_id)  # Mismatch: 40 vs 20
    link = DummyLink(1, 101, 201, student_id, cap=75.0)

    res = resolve_student_classwork_scores(
        student_id=student_id,
        assignments=[orig, rem],
        submissions={101: 10.0, 201: 18.0},
        links=[link],
    )

    # Must retain original score without guessing
    assert res.effective_scores[101] == Decimal("10.0")
    audit = res.audits_by_original_id[101]
    assert audit.was_adjusted is False
    assert audit.status == "REJECTED_MISMATCHED_MAX_POINTS"
    assert "Mismatched maximum points" in audit.rejection_reason


def test_pure_corrupt_or_conflicting_link():
    """Requirement: Corrupt or conflicting linkage -> retained as unadjusted, no guessing."""
    student_id = uuid4()
    orig = DummyAssignment(101, total_points=40)
    rem_missing = 999  # Not in assignment list
    link_corrupt = DummyLink(1, 101, rem_missing, student_id, cap=75.0)

    res = resolve_student_classwork_scores(
        student_id=student_id,
        assignments=[orig],
        submissions={101: 10.0},
        links=[link_corrupt],
    )
    assert res.effective_scores[101] == Decimal("10.0")
    audit = res.audits_by_original_id[101]
    assert audit.was_adjusted is False
    assert audit.status == "CORRUPT_MISSING_ASSIGNMENT"

    # Conflicting duplicate links targeting same original
    rem1 = DummyAssignment(201, total_points=40)
    rem2 = DummyAssignment(202, total_points=40)
    link1 = DummyLink(1, 101, 201, student_id)
    link2 = DummyLink(2, 101, 202, student_id)

    res_conflict = resolve_student_classwork_scores(
        student_id=student_id,
        assignments=[orig, rem1, rem2],
        submissions={101: 10.0, 201: 30.0, 202: 32.0},
        links=[link1, link2],
    )
    assert res_conflict.effective_scores[101] == Decimal("10.0")
    assert res_conflict.audits_by_original_id[101].status == "CORRUPT_CONFLICTING_LINK"


def test_historical_examination_compatibility():
    """Requirement: Existing Examination remediation must remain unchanged."""
    # Examination assignments are unaffected by WW/PT resolver
    class ExamAssignment:
        def __init__(self, aid, orig_exam_id=None, total_points=100.0):
            self.classwork_assignment_id = aid
            self.original_exam_assignment_id = orig_exam_id
            self.classwork = DummyAssignment(aid, total_points=total_points)

    orig_exam = ExamAssignment(10, None, 100.0)
    rem_exam = ExamAssignment(20, 10, 100.0)

    # Verify effective_exam_scores behavior directly
    exam_scores = effective_exam_scores([orig_exam, rem_exam], {10: 60.0, 20: 85.0})
    assert exam_scores == {10: 85.0}

    # Verify WW/PT resolver ignores Examination assignments if passed
    student_id = uuid4()
    res = resolve_student_classwork_scores(
        student_id=student_id,
        assignments=[orig_exam, rem_exam],
        submissions={10: 60.0, 20: 85.0},
        links=[],
    )
    # Remedial exam assignment is excluded from WW/PT official table
    assert 20 not in res.effective_scores
    assert res.effective_scores[10] == Decimal("60.0")


# ---------------------------------------------------------------------------
# Integration Tests with Database Models and Transactions
# ---------------------------------------------------------------------------

def test_db_end_to_end_resolution_and_raw_evidence_unchanged(candidate_context):
    """Requirement: End-to-end database resolution; raw evidence remains unchanged."""
    c = candidate_context
    db = c["db"]
    _activate(c)

    # 1. Original classwork: score 10/40
    original = _make_classwork_target(c, "Original WW 40 pts", score=10.0, points=40.0)
    orig_sub = db.query(StudentSubmission).filter_by(
        classwork_assignment_id=original.classwork_assignment_id,
        student_id=c["student"].student_id,
    ).one()
    orig_sub_id = orig_sub.submission_id
    assert float(orig_sub.grade) == 10.0

    # 2. Plan with 75% cap
    save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[original.classwork_assignment_id],
            score_adjustment_cap=75.0,
        ),
    )

    # 3. Create remediation activity (40 points)
    kwargs = _linked_classwork_kwargs(c, uuid4(), original.classwork_assignment_id)
    kwargs["total_points"] = 40
    created = asyncio.run(create_classwork_wizard_record(**kwargs))
    remediation = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()

    # 4. Student turns in remediation with score 36/40
    rem_sub = StudentSubmission(
        classwork_assignment_id=remediation.classwork_assignment_id,
        student_id=c["student"].student_id,
        grade=36.0,
        status="graded",
    )
    db.add(rem_sub)
    db.commit()

    # 5. Run DB-backed resolver for student period
    resolved = resolve_remediation_for_student_period(
        db,
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
    )

    # Effective score is capped at 75% of 40 = 30.0
    assert resolved.effective_scores[original.classwork_assignment_id] == Decimal("30.00")
    assert resolved.effective_scores_float[original.classwork_assignment_id] == 30.0
    # Remediation activity must NOT be in effective scores
    assert remediation.classwork_assignment_id not in resolved.effective_scores
    assert resolved.remedial_assignment_ids == frozenset({remediation.classwork_assignment_id})

    # Provenance audit verified
    audit = resolved.audits_by_original_id[original.classwork_assignment_id]
    assert audit.was_adjusted is True
    assert audit.was_capped is True
    assert audit.status == "CAPPED"
    assert audit.cap_score == Decimal("30.00")
    assert audit.original_raw_score == Decimal("10.00")
    assert audit.remediation_raw_score == Decimal("36.00")

    # 6. Verify RAW database records are 100% unchanged!
    db.expire_all()
    orig_sub_check = db.get(StudentSubmission, orig_sub_id)
    rem_sub_check = db.query(StudentSubmission).filter_by(
        classwork_assignment_id=remediation.classwork_assignment_id,
        student_id=c["student"].student_id,
    ).one()

    assert float(orig_sub_check.grade) == 10.0
    assert float(rem_sub_check.grade) == 36.0


def test_db_batch_class_resolution(candidate_context):
    """Test resolve_class_remediation_scores across roster."""
    c = candidate_context
    db = c["db"]
    _activate(c)

    original = _make_classwork_target(c, "Original WW 40 pts", score=10.0, points=40.0)
    save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[original.classwork_assignment_id],
            score_adjustment_cap=75.0,
        ),
    )

    kwargs = _linked_classwork_kwargs(c, uuid4(), original.classwork_assignment_id)
    kwargs["total_points"] = 40
    created = asyncio.run(create_classwork_wizard_record(**kwargs))
    remediation = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()

    db.add(StudentSubmission(
        classwork_assignment_id=remediation.classwork_assignment_id,
        student_id=c["student"].student_id,
        grade=24.0,  # Below cap (30.0) -> effective 24.0
        status="graded",
    ))
    db.commit()

    class_res = resolve_class_remediation_scores(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
    )

    assert c["student"].student_id in class_res
    student_res = class_res[c["student"].student_id]
    assert student_res.effective_scores[original.classwork_assignment_id] == Decimal("24.00")
    assert student_res.audits_by_original_id[original.classwork_assignment_id].status == "ADJUSTED"


def test_authoritative_plan_cap_and_idempotency(candidate_context):
    """Requirement: Authoritative cap must come from plan; idempotent calls preserve snapshot."""
    c = candidate_context
    db = c["db"]
    _activate(c)

    original = _make_classwork_target(c, "Original WW 40 pts", score=10.0, points=40.0)
    save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[original.classwork_assignment_id],
            score_adjustment_cap=80.0,  # Authoritative cap in plan: 80%
        ),
    )

    rem_cw = Classwork(
        title="Manual Remediation", classwork_category="WRITTEN_WORK",
        classwork_type="ASSIGNMENT", subject_id=c["subject"].subject_id,
        created_by_staff_id=_staff(c), total_points=40.0, is_graded=True,
    )
    db.add(rem_cw)
    db.flush()
    rem_asgn = ClassworkAssignment(
        classwork_id=rem_cw.classwork_id, class_id=c["class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=_staff(c), is_published=True,
        recipient_student_id=c["student"].student_id,
        source_intervention_id=_id(c),
        remediation_request_id=uuid4(),
    )
    db.add(rem_asgn)
    db.flush()
    intervention = db.get(Intervention, _id(c))

    # 1. Attempting to supply a cap override that does not match the plan is rejected with HTTP 400
    with pytest.raises(HTTPException) as exc_override:
        create_remediation_assignment_link(
            db,
            intervention=intervention,
            remediation_assignment=rem_asgn,
            original_assignment_id=original.classwork_assignment_id,
            component="WRITTEN_WORK",
            staff_id=_staff(c),
            score_adjustment_cap=50.0,  # Contradicts plan's 80.0
        )
    assert exc_override.value.status_code == 400
    assert "override" in exc_override.value.detail.lower()

    # 2. Link creation succeeds with authoritative cap from plan
    link = create_remediation_assignment_link(
        db,
        intervention=intervention,
        remediation_assignment=rem_asgn,
        original_assignment_id=original.classwork_assignment_id,
        component="WRITTEN_WORK",
        staff_id=_staff(c),
    )
    assert link.score_adjustment_cap == Decimal("80.00")

    # 3. Idempotent call returns existing link without modifying snapshot
    idempotent_link = create_remediation_assignment_link(
        db,
        intervention=intervention,
        remediation_assignment=rem_asgn,
        original_assignment_id=original.classwork_assignment_id,
        component="WRITTEN_WORK",
        staff_id=_staff(c),
    )
    assert idempotent_link.remediation_link_id == link.remediation_link_id
    assert idempotent_link.score_adjustment_cap == Decimal("80.00")


def test_change_detection_helpers(candidate_context):
    """Test effective_classwork_score_for_change and effective_classwork_grade_changed."""
    c = candidate_context
    db = c["db"]
    _activate(c)

    original = _make_classwork_target(c, "Original WW 40 pts", score=10.0, points=40.0)
    save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[original.classwork_assignment_id],
            score_adjustment_cap=75.0,  # Cap: 30.0
        ),
    )

    kwargs = _linked_classwork_kwargs(c, uuid4(), original.classwork_assignment_id)
    kwargs["total_points"] = 40
    created = asyncio.run(create_classwork_wizard_record(**kwargs))
    remediation = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()

    # Add remediation score = 36.0 (effective = 30.0)
    db.add(StudentSubmission(
        classwork_assignment_id=remediation.classwork_assignment_id,
        student_id=c["student"].student_id,
        grade=36.0,
        status="graded",
    ))
    db.commit()

    # Check effective score for change:
    # If remediation grade is changed to 35.0, cap is still 30.0, so effective remains 30.0
    eff_35 = effective_classwork_score_for_change(
        db, remediation, c["student"].student_id, replacement_score=35.0,
    )
    assert eff_35 == Decimal("30.00")

    # Changing remediation from 36.0 to 35.0 does NOT change effective grade
    has_changed_capped = effective_classwork_grade_changed(
        db, remediation, c["student"].student_id, previous=36.0, current=35.0,
    )
    assert has_changed_capped is False

    # Changing remediation from 36.0 to 20.0 DOES change effective grade (from 30.0 to 20.0)
    has_changed_uncapped = effective_classwork_grade_changed(
        db, remediation, c["student"].student_id, previous=36.0, current=20.0,
    )
    assert has_changed_uncapped is True

    # On an unlinked assignment, any score change is detected directly
    unlinked = _make_classwork_target(c, "Unlinked WW", score=20.0, points=40.0)
    assert effective_classwork_grade_changed(db, unlinked, c["student"].student_id, 20.0, 25.0) is True
    assert effective_classwork_grade_changed(db, unlinked, c["student"].student_id, 20.0, 20.0) is False
