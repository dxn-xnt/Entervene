"""Standalone prerequisite policy tests; endpoint enforcement is intentionally deferred."""

from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.academic.StudentCLass import StudentClass
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.Student import Student
from app.services.intervention.RemediationPrerequisiteService import (
    evaluate_remediation_prerequisite,
    require_remediation_prerequisite,
)
from app.services.intervention.InterventionReadingReviewService import (
    acknowledge_intervention_reading_review,
)
from app.services.intervention.RemediationReadingPrerequisiteService import (
    ReadingPrerequisiteSnapshotItem,
    stage_remediation_reading_prerequisites,
)
from app.services.intervention.TeacherInterventionService import activate_teacher_candidate
from app.services.submission.SubmissionService import (
    complete_reading_assignment,
    record_reading_focus,
)
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_teacher_intervention_review import candidate_context, _id, _staff


def _reading(ctx, title: str, *, published: bool = True, locked: bool = False):
    db = ctx["db"]
    work = Classwork(
        title=title,
        classwork_type="READING",
        is_graded=False,
        total_points=None,
        is_published=published,
        is_archived=False,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=_staff(ctx),
    )
    db.add(work)
    db.flush()
    assignment = ClassworkAssignment(
        classwork_id=work.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=_staff(ctx),
        is_published=published,
        is_locked=locked,
    )
    db.add(assignment)
    db.flush()
    return work, assignment


def _remediation(ctx, title: str = "Targeted remediation assessment"):
    db = ctx["db"]
    work = Classwork(
        title=title,
        classwork_type="QUIZ",
        is_graded=True,
        total_points=Decimal("10"),
        is_published=True,
        is_archived=False,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=_staff(ctx),
    )
    db.add(work)
    db.flush()
    assignment = ClassworkAssignment(
        classwork_id=work.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=_staff(ctx),
        recipient_student_id=ctx["student"].student_id,
        source_intervention_id=_id(ctx),
        remediation_request_id=uuid4(),
        is_published=True,
    )
    db.add(assignment)
    db.flush()
    return assignment


def _complete(ctx, assignment, *, review: bool = True):
    complete_reading_assignment(
        assignment.classwork_assignment_id,
        ctx["student"],
        ctx["db"],
    )
    if review:
        acknowledge_intervention_reading_review(
            ctx["db"],
            intervention_id=_id(ctx),
            reading_assignment_id=assignment.classwork_assignment_id,
            student=ctx["student"],
        )


def _guided_context(ctx):
    activate_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    readings = [_reading(ctx, f"Jordan required reading {number}") for number in range(1, 4)]
    remediation = _remediation(ctx)
    ctx["candidate"].remediation_plan = {
        "teacher_choice": "QUIZ",
        "selected_resources": [
            {"kind": "CLASSWORK", "id": work.classwork_id}
            for work, _ in readings
        ],
    }
    stage_remediation_reading_prerequisites(
        ctx["db"],
        remediation_assignment_id=remediation.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(
                reading_classwork_id=work.classwork_id,
                reading_assignment_id=assignment.classwork_assignment_id,
                display_order=idx + 1,
            )
            for idx, (work, assignment) in enumerate(readings)
        ],
    )
    ctx["db"].commit()
    return readings, remediation


def test_jordan_requires_all_three_persisted_reading_completions(candidate_context):
    ctx = candidate_context
    readings, remediation = _guided_context(ctx)

    none = evaluate_remediation_prerequisite(ctx["db"], remediation, ctx["student"])
    assert (none.allowed, none.code) == (False, "PREPARATION_REQUIRED")
    assert none.preparation.summary == "0 of 3 completed"

    # Ordinary classwork completion without review keeps preparation at 0 of 3 completed
    _complete(ctx, readings[0][1], review=False)
    unreviewed = evaluate_remediation_prerequisite(ctx["db"], remediation, ctx["student"])
    assert (unreviewed.allowed, unreviewed.code) == (False, "PREPARATION_REQUIRED")
    assert unreviewed.preparation.summary == "0 of 3 completed"

    # Reviewing readings increments preparation
    acknowledge_intervention_reading_review(
        ctx["db"],
        intervention_id=_id(ctx),
        reading_assignment_id=readings[0][1].classwork_assignment_id,
        student=ctx["student"],
    )
    _complete(ctx, readings[1][1], review=True)
    partial = evaluate_remediation_prerequisite(ctx["db"], remediation, ctx["student"])
    assert (partial.allowed, partial.code) == (False, "PREPARATION_REQUIRED")
    assert partial.preparation.summary == "2 of 3 completed"

    # Focus telemetry is deliberately irrelevant; only persisted completion counts.
    record_reading_focus(
        readings[2][1].classwork_assignment_id,
        300,
        ctx["student"],
        ctx["db"],
    )
    focused_only = evaluate_remediation_prerequisite(ctx["db"], remediation, ctx["student"])
    assert focused_only.preparation.summary == "2 of 3 completed"
    assert focused_only.allowed is False

    _complete(ctx, readings[2][1])
    complete = require_remediation_prerequisite(ctx["db"], remediation, ctx["student"])
    assert (complete.allowed, complete.code) == (True, "PREPARATION_COMPLETE")
    assert complete.preparation.summary == "3 of 3 completed"


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ("missing", "MISSING_RESOURCE"),
        ("locked", "LOCKED"),
        ("unpublished", "UNPUBLISHED"),
        ("planning", "PLANNING_ONLY"),
        ("archived", "INACCESSIBLE"),
    ],
)
def test_unavailable_selected_reading_blocks_with_explicit_reason(candidate_context, change, reason):
    ctx = candidate_context
    readings, remediation = _guided_context(ctx)
    for _, assignment in readings:
        _complete(ctx, assignment)

    if change == "missing":
        ctx["db"].delete(readings[1][0])
    elif change == "locked":
        readings[1][1].is_locked = True
    elif change == "unpublished":
        readings[1][0].is_published = False
    elif change == "planning":
        ctx["db"].delete(readings[1][1])
    else:
        readings[1][0].is_archived = True
    ctx["db"].commit()

    decision = evaluate_remediation_prerequisite(ctx["db"], remediation, ctx["student"])
    assert (decision.allowed, decision.code) == (False, "PREPARATION_REQUIRED")
    assert reason in [issue.reason for issue in decision.resource_issues]
    with pytest.raises(HTTPException) as denied:
        require_remediation_prerequisite(ctx["db"], remediation, ctx["student"])
    assert denied.value.status_code == 403
    assert reason in [item["reason"] for item in denied.value.detail["resource_issues"]]


def test_legacy_activity_without_snapshot_is_explicitly_blocked(candidate_context):
    ctx = candidate_context
    activate_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    remediation = _remediation(ctx, "Historical remediation without snapshot")
    ctx["db"].commit()

    decision = evaluate_remediation_prerequisite(ctx["db"], remediation, ctx["student"])
    assert (decision.allowed, decision.code) == (False, "PREREQUISITE_SNAPSHOT_MISSING")
    assert "missing an immutable Reading prerequisite snapshot" in decision.message

    with pytest.raises(HTTPException) as denied:
        require_remediation_prerequisite(ctx["db"], remediation, ctx["student"])
    assert denied.value.status_code == 403
    assert denied.value.detail["code"] == "PREREQUISITE_SNAPSHOT_MISSING"


def test_teacher_changing_current_reading_selections_leaves_old_activity_snapshot_unchanged(candidate_context):
    ctx = candidate_context
    readings, remediation = _guided_context(ctx)
    for _, assignment in readings:
        _complete(ctx, assignment)

    complete_before = evaluate_remediation_prerequisite(ctx["db"], remediation, ctx["student"])
    assert (complete_before.allowed, complete_before.code) == (True, "PREPARATION_COMPLETE")
    assert complete_before.preparation.summary == "3 of 3 completed"

    # Teacher changes the live intervention plan's selected resources to an uncompleted reading
    uncompleted_reading = _reading(ctx, "Newly added reading")
    ctx["candidate"].remediation_plan = {
        "teacher_choice": "QUIZ",
        "selected_resources": [
            {"kind": "CLASSWORK", "id": uncompleted_reading[0].classwork_id}
        ],
    }
    ctx["db"].commit()

    # The existing activity was published with its own snapshot; modifying the plan must NOT affect it
    complete_after = evaluate_remediation_prerequisite(ctx["db"], remediation, ctx["student"])
    assert (complete_after.allowed, complete_after.code) == (True, "PREPARATION_COMPLETE")
    assert complete_after.preparation.summary == "3 of 3 completed"


def test_different_activities_under_one_intervention_have_independent_requirements(candidate_context):
    ctx = candidate_context
    activate_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    reading_a = _reading(ctx, "Reading A")
    reading_b = _reading(ctx, "Reading B")

    activity_1 = _remediation(ctx, "Activity 1")
    stage_remediation_reading_prerequisites(
        ctx["db"],
        remediation_assignment_id=activity_1.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(
                reading_classwork_id=reading_a[0].classwork_id,
                reading_assignment_id=reading_a[1].classwork_assignment_id,
                display_order=1,
            ),
        ],
    )

    activity_2 = _remediation(ctx, "Activity 2")
    stage_remediation_reading_prerequisites(
        ctx["db"],
        remediation_assignment_id=activity_2.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(
                reading_classwork_id=reading_a[0].classwork_id,
                reading_assignment_id=reading_a[1].classwork_assignment_id,
                display_order=1,
            ),
            ReadingPrerequisiteSnapshotItem(
                reading_classwork_id=reading_b[0].classwork_id,
                reading_assignment_id=reading_b[1].classwork_assignment_id,
                display_order=2,
            ),
        ],
    )
    ctx["db"].commit()

    # Before completion: both blocked
    assert evaluate_remediation_prerequisite(ctx["db"], activity_1, ctx["student"]).allowed is False
    assert evaluate_remediation_prerequisite(ctx["db"], activity_2, ctx["student"]).allowed is False

    # Complete Reading A: Activity 1 satisfied, Activity 2 still requires Reading B
    _complete(ctx, reading_a[1])
    dec_1 = evaluate_remediation_prerequisite(ctx["db"], activity_1, ctx["student"])
    dec_2 = evaluate_remediation_prerequisite(ctx["db"], activity_2, ctx["student"])
    assert (dec_1.allowed, dec_1.code) == (True, "PREPARATION_COMPLETE")
    assert dec_1.preparation.summary == "1 of 1 completed"
    assert (dec_2.allowed, dec_2.code) == (False, "PREPARATION_REQUIRED")
    assert dec_2.preparation.summary == "1 of 2 completed"

    # Complete Reading B: Activity 2 now satisfied
    _complete(ctx, reading_b[1])
    dec_2_now = evaluate_remediation_prerequisite(ctx["db"], activity_2, ctx["student"])
    assert (dec_2_now.allowed, dec_2_now.code) == (True, "PREPARATION_COMPLETE")
    assert dec_2_now.preparation.summary == "2 of 2 completed"


def test_wrong_student_and_wrong_intervention_scope_are_denied(candidate_context):
    ctx = candidate_context
    _, remediation = _guided_context(ctx)
    other = Student(
        student_id=uuid4(),
        student_lrn="300000000096",
        first_name="Wrong",
        last_name="Student",
    )
    ctx["db"].add(other)
    ctx["db"].add(StudentClass(
        student_id=other.student_id,
        class_id=ctx["class"].class_id,
        academic_year_id=ctx["class"].academic_year_id,
        enrollment_status="enrolled",
    ))
    ctx["db"].commit()

    wrong_student = evaluate_remediation_prerequisite(ctx["db"], remediation, other)
    assert (wrong_student.allowed, wrong_student.code) == (False, "STUDENT_SCOPE_MISMATCH")

    remediation.is_published = False
    ctx["db"].commit()
    unavailable = evaluate_remediation_prerequisite(
        ctx["db"], remediation, ctx["student"],
    )
    assert (unavailable.allowed, unavailable.code) == (False, "REMEDIATION_UNAVAILABLE")

    remediation.is_published = True
    remediation.academic_period_id = None
    ctx["db"].commit()
    wrong_intervention = evaluate_remediation_prerequisite(
        ctx["db"], remediation, ctx["student"],
    )
    assert (wrong_intervention.allowed, wrong_intervention.code) == (
        False,
        "INTERVENTION_SCOPE_MISMATCH",
    )


def test_ordinary_classwork_is_outside_prerequisite_policy(candidate_context):
    ctx = candidate_context
    ordinary_work = Classwork(
        title="Ordinary class quiz",
        classwork_type="QUIZ",
        is_graded=True,
        total_points=Decimal("10"),
        is_published=True,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=_staff(ctx),
    )
    ctx["db"].add(ordinary_work)
    ctx["db"].flush()
    ordinary = ClassworkAssignment(
        classwork_id=ordinary_work.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=_staff(ctx),
        is_published=True,
    )
    ctx["db"].add(ordinary)
    ctx["db"].commit()

    decision = require_remediation_prerequisite(ctx["db"], ordinary, ctx["student"])
    assert (decision.applies, decision.allowed, decision.code) == (
        False,
        True,
        "NOT_REMEDIATION",
    )
