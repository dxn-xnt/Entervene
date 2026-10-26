"""Focused tests for Task 4.7B.1: Cap snapshotting and progressive multi-target remediation."""

import asyncio
import json
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.intervention.Intervention import Intervention
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.classwork.ClassworkService import create_classwork_wizard_record
from app.services.intervention.InterventionRemediationService import PlanUpdate, save_plan
from app.services.intervention.RemediationAssignmentLinkService import create_remediation_assignment_link
from tests.test_intervention_support_materials import _activate
from tests.test_remediation_target_persistence import _make_classwork_target
from tests.test_targeted_remedial_classwork import _linked_classwork_kwargs
from tests.test_teacher_intervention_review import candidate_context, _id, _staff
from tests.test_current_period_live_feature_builder import current_period_context


def test_cap_snapshot_default_75_percent(candidate_context):
    c = candidate_context
    db = c["db"]
    _activate(c)
    original = _make_classwork_target(c, "Original WW", score=10.0, points=20.0)
    save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[original.classwork_assignment_id],
        ),
    )

    created = asyncio.run(create_classwork_wizard_record(
        **_linked_classwork_kwargs(c, uuid4(), original.classwork_assignment_id)
    ))
    remediation = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()
    link = db.query(RemediationAssignmentLink).filter_by(
        remediation_assignment_id=remediation.classwork_assignment_id,
    ).one()

    assert link.score_adjustment_cap == Decimal("75.00")
    assert link.original_assignment_id == original.classwork_assignment_id
    assert link.student_id == c["student"].student_id
    assert link.component == "WRITTEN_WORK"


def test_cap_snapshot_custom_cap_persists_immutably(candidate_context):
    c = candidate_context
    db = c["db"]
    _activate(c)
    original = _make_classwork_target(c, "Original WW Custom Cap", score=8.0, points=20.0)
    save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[original.classwork_assignment_id],
            score_adjustment_cap=85.0,
        ),
    )

    created = asyncio.run(create_classwork_wizard_record(
        **_linked_classwork_kwargs(c, uuid4(), original.classwork_assignment_id)
    ))
    remediation = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()
    link = db.query(RemediationAssignmentLink).filter_by(
        remediation_assignment_id=remediation.classwork_assignment_id,
    ).one()

    assert link.score_adjustment_cap == Decimal("85.00")


def test_cap_snapshot_rejects_100_percent_and_invalid(candidate_context):
    c = candidate_context
    db = c["db"]
    _activate(c)
    original = _make_classwork_target(c, "Original WW", score=10.0, points=20.0)
    save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[original.classwork_assignment_id],
        ),
    )
    rem_cw = Classwork(
        title="Unlinked remediation", classwork_category="WRITTEN_WORK",
        classwork_type="ASSIGNMENT", subject_id=c["subject"].subject_id,
        created_by_staff_id=_staff(c), total_points=20.0, is_graded=True,
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
    row = db.get(Intervention, _id(c))

    with pytest.raises(HTTPException) as exc_100:
        create_remediation_assignment_link(
            db,
            intervention=row,
            remediation_assignment=rem_asgn,
            original_assignment_id=original.classwork_assignment_id,
            component="WRITTEN_WORK",
            staff_id=_staff(c),
            score_adjustment_cap=100.0,
        )
    assert exc_100.value.status_code == 400
    assert "excluding 100% full replacement" in exc_100.value.detail

    with pytest.raises(HTTPException) as exc_neg:
        create_remediation_assignment_link(
            db,
            intervention=row,
            remediation_assignment=rem_asgn,
            original_assignment_id=original.classwork_assignment_id,
            component="WRITTEN_WORK",
            staff_id=_staff(c),
            score_adjustment_cap=-5.0,
        )
    assert exc_neg.value.status_code == 400


def test_multi_target_plan_creates_distinct_activities_and_links(candidate_context):
    c = candidate_context
    db = c["db"]
    _activate(c)
    first = _make_classwork_target(c, "Original WW 1", score=10.0, points=20.0)
    second = _make_classwork_target(c, "Original WW 2", score=12.0, points=20.0)

    save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[first.classwork_assignment_id, second.classwork_assignment_id],
            score_adjustment_cap=80.0,
        ),
    )

    # Create remediation activity 1 targeting first original
    created_1 = asyncio.run(create_classwork_wizard_record(
        **_linked_classwork_kwargs(c, uuid4(), first.classwork_assignment_id)
    ))
    rem_1 = db.query(ClassworkAssignment).filter_by(classwork_id=created_1.classwork_id).one()
    link_1 = db.query(RemediationAssignmentLink).filter_by(
        remediation_assignment_id=rem_1.classwork_assignment_id,
    ).one()

    assert link_1.original_assignment_id == first.classwork_assignment_id
    assert link_1.score_adjustment_cap == Decimal("80.00")

    # Create remediation activity 2 targeting second original
    created_2 = asyncio.run(create_classwork_wizard_record(
        **_linked_classwork_kwargs(c, uuid4(), second.classwork_assignment_id)
    ))
    rem_2 = db.query(ClassworkAssignment).filter_by(classwork_id=created_2.classwork_id).one()
    link_2 = db.query(RemediationAssignmentLink).filter_by(
        remediation_assignment_id=rem_2.classwork_assignment_id,
    ).one()

    assert link_2.original_assignment_id == second.classwork_assignment_id
    assert link_2.score_adjustment_cap == Decimal("80.00")

    # Distinct links and assignments
    assert link_1.remediation_link_id != link_2.remediation_link_id
    assert db.query(RemediationAssignmentLink).count() == 2

    # Add submissions to both remediation activities; raw original scores remain preserved
    db.add(StudentSubmission(
        classwork_assignment_id=rem_1.classwork_assignment_id,
        student_id=c["student"].student_id, grade=18.0, status="graded",
    ))
    db.add(StudentSubmission(
        classwork_assignment_id=rem_2.classwork_assignment_id,
        student_id=c["student"].student_id, grade=19.0, status="graded",
    ))
    db.commit()

    subs = {
        row.classwork_assignment_id: float(row.grade)
        for row in db.query(StudentSubmission).filter_by(student_id=c["student"].student_id).all()
        if row.classwork_assignment_id in {
            first.classwork_assignment_id,
            second.classwork_assignment_id,
            rem_1.classwork_assignment_id,
            rem_2.classwork_assignment_id,
        }
    }
    assert subs == {
        first.classwork_assignment_id: 10.0,
        second.classwork_assignment_id: 12.0,
        rem_1.classwork_assignment_id: 18.0,
        rem_2.classwork_assignment_id: 19.0,
    }


def test_prevent_conflicting_duplicate_remediation_for_same_original(candidate_context):
    c = candidate_context
    db = c["db"]
    _activate(c)
    original = _make_classwork_target(c, "Original WW", score=10.0, points=20.0)

    save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[original.classwork_assignment_id],
        ),
    )

    # First remediation activity succeeds
    asyncio.run(create_classwork_wizard_record(
        **_linked_classwork_kwargs(c, uuid4(), original.classwork_assignment_id)
    ))
    assert db.query(RemediationAssignmentLink).count() == 1

    # Second remediation activity attempting to target the same original is rejected
    with pytest.raises(HTTPException) as conflict:
        asyncio.run(create_classwork_wizard_record(
            **_linked_classwork_kwargs(c, uuid4(), original.classwork_assignment_id)
        ))
    assert conflict.value.status_code == 409
    assert "already linked to this original classwork" in conflict.value.detail
    assert db.query(RemediationAssignmentLink).count() == 1


def test_progressive_target_appending_to_plan(candidate_context):
    c = candidate_context
    db = c["db"]
    _activate(c)
    first = _make_classwork_target(c, "Original WW 1", score=10.0, points=20.0)
    second = _make_classwork_target(c, "Original WW 2", score=11.0, points=20.0)

    # Initial plan with first target only
    save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[first.classwork_assignment_id],
            score_adjustment_cap=75.0,
        ),
    )

    # Create Activity 1 for first target
    asyncio.run(create_classwork_wizard_record(
        **_linked_classwork_kwargs(c, uuid4(), first.classwork_assignment_id)
    ))

    # Teacher safely appends second target to the plan
    updated = save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[first.classwork_assignment_id, second.classwork_assignment_id],
            score_adjustment_cap=75.0,
        ),
    )
    assert updated["plan"]["target_assignment_ids"] == [
        first.classwork_assignment_id, second.classwork_assignment_id,
    ]

    # Removing first target is rejected
    with pytest.raises(HTTPException) as remove_exc:
        save_plan(
            db, _staff(c), _id(c),
            PlanUpdate(
                teacher_choice="CLASSWORK",
                grade_treatment="WRITTEN_WORK",
                target_assignment_ids=[second.classwork_assignment_id],
            ),
        )
    assert remove_exc.value.status_code == 409

    # Reordering targets is rejected
    with pytest.raises(HTTPException) as reorder_exc:
        save_plan(
            db, _staff(c), _id(c),
            PlanUpdate(
                teacher_choice="CLASSWORK",
                grade_treatment="WRITTEN_WORK",
                target_assignment_ids=[second.classwork_assignment_id, first.classwork_assignment_id],
            ),
        )
    assert reorder_exc.value.status_code == 409

    # Modifying cap after activity creation is rejected
    with pytest.raises(HTTPException) as cap_exc:
        save_plan(
            db, _staff(c), _id(c),
            PlanUpdate(
                teacher_choice="CLASSWORK",
                grade_treatment="WRITTEN_WORK",
                target_assignment_ids=[first.classwork_assignment_id, second.classwork_assignment_id],
                score_adjustment_cap=80.0,
            ),
        )
    assert cap_exc.value.status_code == 409


def test_matching_maximum_points_enforced(candidate_context):
    c = candidate_context
    db = c["db"]
    _activate(c)
    original = _make_classwork_target(c, "Original WW 20 pts", score=10.0, points=20.0)

    save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[original.classwork_assignment_id],
        ),
    )

    # Remediation activity with 25 points instead of 20 points
    kwargs = _linked_classwork_kwargs(c, uuid4(), original.classwork_assignment_id)
    kwargs["total_points"] = 25

    with pytest.raises(HTTPException) as points_exc:
        asyncio.run(create_classwork_wizard_record(**kwargs))
    assert points_exc.value.status_code == 400
    assert "maximum points must equal" in points_exc.value.detail
    assert db.query(RemediationAssignmentLink).count() == 0


def test_quiz_remediation_enforces_single_attempt(candidate_context):
    c = candidate_context
    db = c["db"]
    _activate(c)
    original = _make_classwork_target(
        c, "Original Quiz Target", category="WRITTEN_WORK",
        classwork_type="QUIZ", score=10.0, points=20.0,
    )

    save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="QUIZ",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[original.classwork_assignment_id],
        ),
    )

    from tests.test_classwork_submission_authorization import _valid_quiz_payload
    quiz_payload = json.dumps(_valid_quiz_payload())

    kwargs = _linked_classwork_kwargs(c, uuid4(), original.classwork_assignment_id)
    kwargs.update(
        classwork_type="QUIZ",
        quiz_payload=quiz_payload,
        max_attempts=2,
    )

    # Attempting to create remedial quiz with max_attempts=2 fails
    with pytest.raises(HTTPException) as attempt_exc:
        asyncio.run(create_classwork_wizard_record(**kwargs))
    assert attempt_exc.value.status_code == 400
    assert "permits one attempt" in attempt_exc.value.detail

    # Creating with max_attempts=1 succeeds
    kwargs["max_attempts"] = 1
    created = asyncio.run(create_classwork_wizard_record(**kwargs))
    remediation = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()
    link = db.query(RemediationAssignmentLink).one()
    assert link.remediation_assignment_id == remediation.classwork_assignment_id
