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
from app.services.intervention import RemediationAssignmentLinkService as link_service
from tests.test_intervention_support_materials import _activate
from tests.test_remediation_target_persistence import _make_classwork_target
from tests.test_targeted_remedial_classwork import _linked_classwork_kwargs as _base_linked_classwork_kwargs
from tests.test_remediation_reading_prerequisite import _reading
from tests.test_teacher_intervention_review import candidate_context, _id, _staff
from tests.test_current_period_live_feature_builder import current_period_context


def _linked_classwork_kwargs(ctx, request_id, original_assignment_id):
    """Keep legacy progressive-target fixtures valid under required Reading policy."""
    row = ctx["db"].get(Intervention, _id(ctx))
    plan = dict(row.remediation_plan or {})
    selected = list(plan.get("selected_resources") or [])
    if not selected:
        reading, _assignment = _reading(ctx, "Progressive remediation preparation")
        plan["selected_resources"] = [{"kind": "CLASSWORK", "id": reading.classwork_id}]
        row.remediation_plan = plan
        ctx["db"].commit()
    return _base_linked_classwork_kwargs(ctx, request_id, original_assignment_id)


def _publish_and_grade(ctx, assignment, grade=18.0):
    assignment.is_published = True
    assignment.classwork.is_published = True
    ctx["db"].add(StudentSubmission(
        classwork_assignment_id=assignment.classwork_assignment_id,
        student_id=ctx["student"].student_id,
        grade=grade,
        status="graded",
    ))
    ctx["db"].commit()


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

    # A second activity is blocked until the first is published, completed, and graded.
    with pytest.raises(HTTPException) as pending:
        asyncio.run(create_classwork_wizard_record(
            **_linked_classwork_kwargs(c, uuid4(), second.classwork_assignment_id)
        ))
    assert pending.value.status_code == 409
    assert pending.value.detail["code"] == "REMEDIATION_RESULT_PENDING"

    rem_1.is_published = True
    rem_1.classwork.is_published = True
    db.add(StudentSubmission(
        classwork_assignment_id=rem_1.classwork_assignment_id,
        student_id=c["student"].student_id, grade=18.0, status="graded",
    ))
    db.commit()

    # Missing Examination evidence does not block a teacher-initiated second activity.
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

    # Add the second result; raw original scores remain preserved.
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


def test_progressive_creation_rejects_target_without_positive_gain(candidate_context):
    c = candidate_context
    db = c["db"]
    _activate(c)
    first = _make_classwork_target(c, "Initial WW", score=10.0, points=20.0)
    no_gain = _make_classwork_target(c, "Already above ceiling", score=18.0, points=20.0)
    save_plan(db, _staff(c), _id(c), PlanUpdate(
        teacher_choice="CLASSWORK",
        grade_treatment="WRITTEN_WORK",
        target_assignment_ids=[first.classwork_assignment_id, no_gain.classwork_assignment_id],
        score_adjustment_cap=80.0,
    ))
    created = asyncio.run(create_classwork_wizard_record(
        **_linked_classwork_kwargs(c, uuid4(), first.classwork_assignment_id)
    ))
    first_remediation = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()
    _publish_and_grade(c, first_remediation)

    with pytest.raises(HTTPException) as rejected:
        asyncio.run(create_classwork_wizard_record(
            **_linked_classwork_kwargs(c, uuid4(), no_gain.classwork_assignment_id)
        ))
    assert rejected.value.status_code == 409
    assert rejected.value.detail["code"] == "NO_POSITIVE_REMEDIATION_TARGET"


def test_progressive_creation_rejects_official_passing_result(candidate_context, monkeypatch):
    c = candidate_context
    db = c["db"]
    _activate(c)
    first = _make_classwork_target(c, "Initial WW", score=10.0, points=20.0)
    second = _make_classwork_target(c, "Unused WW", score=11.0, points=20.0)
    save_plan(db, _staff(c), _id(c), PlanUpdate(
        teacher_choice="CLASSWORK",
        grade_treatment="WRITTEN_WORK",
        target_assignment_ids=[first.classwork_assignment_id, second.classwork_assignment_id],
        score_adjustment_cap=80.0,
    ))
    created = asyncio.run(create_classwork_wizard_record(
        **_linked_classwork_kwargs(c, uuid4(), first.classwork_assignment_id)
    ))
    first_remediation = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()
    _publish_and_grade(c, first_remediation)
    monkeypatch.setattr(link_service, "calculate_subject_grade_projection", lambda *_args, **_kwargs: {
        "status": "AVAILABLE",
        "current_reaches_passing_threshold": True,
        "eligible_target_gains": [{
            "assignment_id": second.classwork_assignment_id,
            "possible_score_gain": 5.0,
        }],
    })

    with pytest.raises(HTTPException) as rejected:
        asyncio.run(create_classwork_wizard_record(
            **_linked_classwork_kwargs(c, uuid4(), second.classwork_assignment_id)
        ))
    assert rejected.value.status_code == 409
    assert rejected.value.detail["code"] == "PASSING_RESULT_REACHED"


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


@pytest.mark.parametrize("second_creation_mode", ["AI", "MANUAL"])
def test_end_to_end_progressive_remediation_workflow(candidate_context, second_creation_mode):
    """End-to-end verification of progressive remediation across AI and manual paths."""
    from app.schemas.Submission import GradeRequest
    from app.services.intervention.InterventionHistoryService import targeted_activities
    from app.services.intervention.InterventionRemediationAssessmentCreationService import (
        create_remediation_assessment,
    )
    from app.services.intervention.InterventionRemediationService import (
        ResourceRef,
        get_workspace,
        project_subject_grade,
    )
    from app.services.student_record.StudentRecordService import teacher_student_gradebook
    from app.services.submission.SubmissionService import grade_student_submission
    from tests.test_remediation_draft_preflight import (
        _make_quiz_draft,
        _setup_intervention_with_targets,
    )
    from tests.test_teacher_intervention_review import _other_staff

    c = candidate_context
    db = c["db"]

    # Classwork A (10/20 = 50% score), taught lesson, and accessible reading
    competency, lesson, classwork_a, reading = _setup_intervention_with_targets(
        c, "WRITTEN_WORK", 20.0,
    )
    # Classwork B (9/30 = 30% score; 75% ceiling = 22.5 pts -> +13.5 possible gain)
    classwork_b = _make_classwork_target(
        c, "Original WW B", category="WRITTEN_WORK", score=9.0, points=30.0,
    )
    # Classwork C (18/20 = 90% score; already above 75% ceiling -> 0 possible gain)
    classwork_c = _make_classwork_target(
        c, "Original WW C Above Ceiling", category="WRITTEN_WORK", score=18.0, points=20.0,
    )
    reading_ref = [ResourceRef(kind="CLASSWORK", id=reading.classwork_id)]

    # Save initial plan targeting Classwork A only
    save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="QUIZ",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[classwork_a.classwork_assignment_id],
            score_adjustment_cap=75.0,
            selected_resources=reading_ref,
        ),
    )

    # Create Remediation 1 targeting Classwork A
    draft_1 = _make_quiz_draft(competency.competency_id, lesson.lesson_id, 20.0)
    created_1 = create_remediation_assessment(
        db,
        staff_id=_staff(c),
        intervention_id=_id(c),
        remediation_request_id=uuid4(),
        target_assignment_id=classwork_a.classwork_assignment_id,
        draft_input=draft_1,
    )
    rem_1 = db.get(ClassworkAssignment, created_1.classwork_assignment_id)

    # Requirement 5: While Remediation 1 is ungraded, creating Remediation 2 is blocked
    save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="QUIZ",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[
                classwork_a.classwork_assignment_id,
                classwork_b.classwork_assignment_id,
            ],
            score_adjustment_cap=75.0,
            selected_resources=reading_ref,
        ),
    )
    draft_2 = _make_quiz_draft(competency.competency_id, lesson.lesson_id, 30.0)
    with pytest.raises(HTTPException) as ungraded_block:
        create_remediation_assessment(
            db,
            staff_id=_staff(c),
            intervention_id=_id(c),
            remediation_request_id=uuid4(),
            target_assignment_id=classwork_b.classwork_assignment_id,
            draft_input=draft_2,
        )
    assert ungraded_block.value.status_code == 409
    assert ungraded_block.value.detail["code"] == "REMEDIATION_RESULT_PENDING"

    # Requirement 5: Unauthorized teacher creation is blocked
    outsider = _other_staff(c)
    with pytest.raises(HTTPException) as unauth_exc:
        create_remediation_assessment(
            db,
            staff_id=outsider.staff_id,
            intervention_id=_id(c),
            remediation_request_id=uuid4(),
            target_assignment_id=classwork_b.classwork_assignment_id,
            draft_input=draft_2,
        )
    assert unauth_exc.value.status_code == 404

    # Publish and grade Remediation 1 (19/20 -> capped at 75% of 20 = 15.0)
    _publish_and_grade(c, rem_1, grade=19.0)

    # Requirement 5: Duplicate target creation for Classwork A is blocked
    with pytest.raises(HTTPException) as dup_target_exc:
        create_remediation_assessment(
            db,
            staff_id=_staff(c),
            intervention_id=_id(c),
            remediation_request_id=uuid4(),
            target_assignment_id=classwork_a.classwork_assignment_id,
            draft_input=draft_1,
        )
    assert dup_target_exc.value.status_code == 409

    # Teacher selects Classwork B via Add Another Remediation Activity and saves plan
    saved_plan_ws = save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="QUIZ",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[
                classwork_a.classwork_assignment_id,
                classwork_b.classwork_assignment_id,
            ],
            score_adjustment_cap=75.0,
            selected_resources=reading_ref,
        ),
    )
    assert saved_plan_ws["plan"]["target_assignment_ids"] == [
        classwork_a.classwork_assignment_id,
        classwork_b.classwork_assignment_id,
    ]
    assert saved_plan_ws["plan"]["original_exam_assignment_id"] is None

    # Create Remediation 2 targeting Classwork B via AI or MANUAL path
    if second_creation_mode == "AI":
        created_2 = create_remediation_assessment(
            db,
            staff_id=_staff(c),
            intervention_id=_id(c),
            remediation_request_id=uuid4(),
            target_assignment_id=classwork_b.classwork_assignment_id,
            draft_input=draft_2,
        )
        rem_2 = db.get(ClassworkAssignment, created_2.classwork_assignment_id)
    else:
        from tests.test_classwork_submission_authorization import _valid_quiz_payload
        quiz_payload = _valid_quiz_payload()
        for q in quiz_payload["questions"]:
            q["points"] = 15
        kwargs = _linked_classwork_kwargs(c, uuid4(), classwork_b.classwork_assignment_id)
        kwargs.update(
            title="Manual Remediation 2 Quiz",
            classwork_type="QUIZ",
            total_points=30,
            max_attempts=1,
            quiz_payload=json.dumps(quiz_payload),
        )
        created_manual = asyncio.run(create_classwork_wizard_record(**kwargs))
        rem_2 = db.query(ClassworkAssignment).filter_by(
            classwork_id=created_manual.classwork_id
        ).one()

    # Requirement 1: Remediation 2 creates a separate assignment and links exclusively to Classwork B
    assert rem_2.classwork_assignment_id != rem_1.classwork_assignment_id
    assert rem_2.classwork_id != rem_1.classwork_id
    link_1 = db.query(RemediationAssignmentLink).filter_by(
        remediation_assignment_id=rem_1.classwork_assignment_id
    ).one()
    link_2 = db.query(RemediationAssignmentLink).filter_by(
        remediation_assignment_id=rem_2.classwork_assignment_id
    ).one()
    assert link_1.original_assignment_id == classwork_a.classwork_assignment_id
    assert link_2.original_assignment_id == classwork_b.classwork_assignment_id
    assert link_1.remediation_link_id != link_2.remediation_link_id

    # Student completes Remediation 2 and teacher grades it (27/30 -> capped at 75% of 30 = 22.5)
    rem_2.is_published = True
    rem_2.classwork.is_published = True
    sub_2 = StudentSubmission(
        classwork_assignment_id=rem_2.classwork_assignment_id,
        student_id=c["student"].student_id,
        status="submitted",
        attempt_count=1,
    )
    db.add(sub_2)
    db.commit()
    grade_student_submission(
        sub_2.submission_id,
        GradeRequest(grade=27.0, feedback="Completed second remediation"),
        _staff(c),
        db,
    )

    # Requirements 2, 3, 4, 6: Workspace reload preserves both activities, scores, links, and history
    reopened = get_workspace(db, _staff(c), _id(c))
    assigned = reopened["progress"]["assigned_remediation"]
    completed = reopened["progress"]["completed_remediation"]
    assert len(assigned) == 2
    assert len(completed) == 2

    by_orig = {item["original_assignment_id"]: item for item in assigned}
    act_a = by_orig[classwork_a.classwork_assignment_id]
    act_b = by_orig[classwork_b.classwork_assignment_id]

    assert act_a["assignment_id"] == rem_1.classwork_assignment_id
    assert act_a["original_grade"] == 10.0
    assert act_a["grade"] == 19.0
    assert act_a["effective_grade"] == 15.0

    assert act_b["assignment_id"] == rem_2.classwork_assignment_id
    assert act_b["original_grade"] == 9.0
    assert act_b["grade"] == 27.0
    assert act_b["effective_grade"] == 22.5

    # Verify history view (targeted_activities) also reflects both graded activities accurately
    row = db.get(Intervention, _id(c))
    history_items = {
        item["original_assignment_id"]: item
        for item in targeted_activities(db, row, student_view=False)
    }
    assert history_items[classwork_a.classwork_assignment_id]["effective_grade"] == 15.0
    assert history_items[classwork_b.classwork_assignment_id]["effective_grade"] == 22.5

    # Verify official gradebook applies each capped remediation adjustment exclusively to its target
    gb = teacher_student_gradebook(
        db, _staff(c), c["class"].class_id, c["subject"].subject_id, c["period"].academic_period_id,
    )
    student_row = next(r for r in gb.studentGrades if r.student_id == str(c["student"].student_id))
    remedial_by_orig = {
        item["original_assignment_id"]: item for item in student_row.remedial_classworks
    }
    assert remedial_by_orig[classwork_a.classwork_assignment_id]["effective_score"] == 15.0
    assert remedial_by_orig[classwork_b.classwork_assignment_id]["effective_score"] == 22.5
    assert classwork_c.classwork_assignment_id not in remedial_by_orig

    # Requirement 7: Additional remediation stops when no unused eligible targets have positive gain,
    # while the intervention remains ACTIVE (not auto-resolved).
    tracked_ids = {
        classwork_a.classwork_assignment_id,
        classwork_b.classwork_assignment_id,
        classwork_c.classwork_assignment_id,
        rem_1.classwork_assignment_id,
        rem_2.classwork_assignment_id,
    }
    for sub in db.query(StudentSubmission).filter_by(student_id=c["student"].student_id).all():
        if sub.classwork_assignment_id not in tracked_ids:
            asgn = db.get(ClassworkAssignment, sub.classwork_assignment_id)
            if asgn and asgn.classwork and asgn.classwork.total_points:
                sub.grade = asgn.classwork.total_points
    db.commit()

    post_outcome = project_subject_grade(db, _staff(c), _id(c), [])
    assert post_outcome["additional_eligible_targets_have_positive_improvement"] is False
    assert post_outcome["recommended_target_assignment_id"] is None
    assert all(item["possible_score_gain"] == 0.0 for item in post_outcome["eligible_target_gains"])
    db.refresh(row)
    assert row.status == "ACTIVE"
    assert row.resolved_at is None

