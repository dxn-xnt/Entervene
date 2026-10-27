"""Focused recipient checks for existing Classwork, Quiz, and submission APIs."""
import asyncio
import json
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.academic.StudentCLass import StudentClass
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.intervention.Intervention import Intervention
from app.models.notifications.Notification import Notification
from app.models.auth.UserAccount import UserAccount
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.classwork.ClassworkService import _stage_targeted_assignment_notification
from app.services.quiz.QuizAnalysisService import build_teacher_quiz_analysis
from app.services.classwork.ClassworkService import create_classwork_wizard_record, assign_classwork_to_classes
from app.schemas.Classwork import ClassworkAssignRequest
from app.services.intervention.InterventionRemediationService import PlanUpdate, ResourceRef, save_plan as _raw_save_plan


def save_plan(db, staff_id, intervention_id, body: PlanUpdate):
    if not body.selected_resources:
        intervention = db.get(Intervention, intervention_id)
        if intervention:
            reading = db.query(Classwork).filter_by(
                subject_id=intervention.subject_id,
                classwork_type="READING",
                is_graded=False,
                is_published=True,
            ).first()
            if not reading:
                reading = Classwork(
                    title="Default test reading",
                    classwork_type="READING",
                    is_graded=False,
                    total_points=None,
                    is_published=True,
                    subject_id=intervention.subject_id,
                    created_by_staff_id=staff_id,
                )
                db.add(reading)
                db.flush()
                assignment = ClassworkAssignment(
                    classwork_id=reading.classwork_id,
                    class_id=intervention.class_id,
                    academic_period_id=intervention.academic_period_id,
                    assigned_by_staff_id=staff_id,
                    is_published=True,
                )
                db.add(assignment)
                db.flush()
            body = body.model_copy(update={
                "selected_resources": [ResourceRef(kind="CLASSWORK", id=reading.classwork_id)],
            })
    return _raw_save_plan(db, staff_id, intervention_id, body)
from tests.test_classwork_submission_authorization import authz_context, _act_as, _bearer
from tests.test_classwork_submission_authorization import _valid_quiz_payload
from tests.test_intervention_support_materials import _activate
from tests.test_remediation_target_persistence import _make_classwork_target
from tests.test_teacher_intervention_review import candidate_context, _id, _staff
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_quiz_attempt_api import quiz_attempt_context


def test_targeted_assignment_is_private_across_existing_student_surfaces(authz_context):
    c = authz_context
    # Move the other student's fixture enrollment into the same class.
    other = c["db"].query(type(c["student"])).filter_by(user_id=c["accounts"]["other_student"].user_id).one()
    c["db"].query(StudentClass).filter_by(student_id=other.student_id).one().class_id = c["allowed_class"].class_id
    from datetime import datetime, timezone
    from app.services.intervention.RemediationReadingPrerequisiteService import (
        ReadingPrerequisiteSnapshotItem,
        stage_remediation_reading_prerequisites,
    )

    intervention = Intervention(
        intervention_id=9999,
        student_id=c["student"].student_id,
        class_id=c["allowed_class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        source_prediction_id=1,
        status="ACTIVE",
        diagnosis_snapshot={},
        activated_at=datetime.now(timezone.utc),
        activated_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(intervention)
    reading_cw = Classwork(
        title="Prep Reading",
        classwork_type="READING",
        is_graded=False,
        is_published=True,
        is_archived=False,
        subject_id=c["subject"].subject_id,
        created_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(reading_cw)
    c["db"].flush()
    reading_assign = ClassworkAssignment(
        classwork_id=reading_cw.classwork_id,
        class_id=c["allowed_class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=c["owner"].staff_id,
        is_published=True,
        recipient_student_id=c["student"].student_id,
        source_intervention_id=9999,
        remediation_request_id=uuid4(),
    )
    c["db"].add(reading_assign)
    c["db"].flush()
    c["db"].add(StudentSubmission(
        classwork_assignment_id=reading_assign.classwork_assignment_id,
        student_id=c["student"].student_id,
        status="submitted",
    ))
    c["assignment"].recipient_student_id = c["student"].student_id
    c["assignment"].source_intervention_id = 9999
    c["assignment"].remediation_request_id = uuid4()
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=c["assignment"].classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(
                reading_classwork_id=reading_cw.classwork_id,
                reading_assignment_id=reading_assign.classwork_assignment_id,
                display_order=1,
            )
        ],
    )
    c["db"].commit()
    assignment_id = c["assignment"].classwork_assignment_id
    classwork_id = c["classwork"].classwork_id
    list_url = f"/api/v1/classwork-assignments/class/{c['allowed_class'].class_id}/subject/{c['subject'].subject_id}"

    _act_as(c, "student", "student")
    assert len(c["client"].get(list_url).json()) == 2
    assert c["client"].get(f"/api/v1/classwork-assignments/classwork/{classwork_id}").status_code == 200
    _act_as(c, "other_student", "student")
    assert c["client"].get(list_url).json() == []
    assert c["client"].get(f"/api/v1/classwork-assignments/assignment/{assignment_id}").status_code == 403
    assert c["client"].get(f"/api/v1/classwork-assignments/classwork/{classwork_id}").status_code == 403
    assert c["client"].post(f"/api/v1/submissions/assignment/{assignment_id}/submit").status_code == 404
    assert c["client"].get(f"/api/v1/classwork-assignments/classwork/{classwork_id}/attachments/{c['classwork_attachment'].classwork_attachment_id}/download", headers=_bearer(c, "other_student", "student")).status_code == 403

    _act_as(c, "owner", "teacher")
    tracking = c["client"].get(f"/api/v1/submissions/assignment/{assignment_id}/tracking").json()
    assert tracking["total_students"] == 1
    assert tracking["missing_count"] == 0
    aggregate = c["client"].get(f"/api/v1/submissions/classwork/{classwork_id}/tracking").json()
    assert aggregate["total_students"] == 1
    _stage_targeted_assignment_notification(c["db"], c["assignment"], c["classwork"], c["subject"].subject_id)
    c["db"].commit()
    recipients = {row.user_id for row in c["db"].query(Notification).all()}
    assert c["accounts"]["student"].user_id in recipients
    assert c["accounts"]["other_student"].user_id not in recipients


def test_intervention_publication_scope_and_retry(candidate_context):
    c = candidate_context
    db = c["db"]
    request_id = uuid4()
    kwargs = dict(
        title="Focused practice", classwork_type="ASSIGNMENT", subject_id=c["subject"].subject_id,
        description=None, instructions="Practice", classwork_category="WRITTEN_WORK", total_points=10,
        is_published=True, class_ids=json.dumps([c["class"].class_id]),
        academic_period_id=c["period"].academic_period_id, lesson_ids="[]", due_date=None, lock_date=None,
        allow_late_submissions=False, max_attempts=None, quiz_payload=None, rubric_payload=None, files=None,
        intervention_id=_id(c), remediation_request_id=request_id,
        current_user={"sub": str(c["staff"].user_id), "role": "teacher"}, staff_id=_staff(c), db=db,
    )
    with pytest.raises(HTTPException):
        asyncio.run(create_classwork_wizard_record(**kwargs))
    _activate(c)
    plan = save_plan(db, _staff(c), _id(c), PlanUpdate(teacher_choice="CLASSWORK"))
    assert plan["plan"]["grade_treatment"] == "PRACTICE_ONLY"
    with pytest.raises(HTTPException) as missing_treatment:
        asyncio.run(create_classwork_wizard_record(**kwargs))
    assert missing_treatment.value.status_code == 400
    target = _make_classwork_target(c, "Original Target", points=10.0, score=5.0)
    save_plan(db, _staff(c), _id(c), PlanUpdate(
        teacher_choice="CLASSWORK", grade_treatment="WRITTEN_WORK",
        target_assignment_ids=[target.classwork_assignment_id],
    ))
    kwargs["classwork_category"] = "PERFORMANCE_TASK"
    kwargs["original_classwork_assignment_id"] = target.classwork_assignment_id
    with pytest.raises(HTTPException) as treatment_error:
        asyncio.run(create_classwork_wizard_record(**kwargs))
    assert treatment_error.value.status_code == 400
    kwargs["classwork_category"] = "WRITTEN_WORK"
    before = db.query(Classwork).count()
    created = asyncio.run(create_classwork_wizard_record(**kwargs))
    assignment = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()
    assert assignment.recipient_student_id == c["student"].student_id
    assert assignment.source_intervention_id == _id(c)
    assert assignment.remediation_request_id == request_id
    assert db.query(Classwork).count() == before + 1
    assert asyncio.run(create_classwork_wizard_record(**kwargs)).classwork_id == created.classwork_id
    assert db.query(Classwork).count() == before + 1
    with pytest.raises(HTTPException) as locked_plan:
        save_plan(db, _staff(c), _id(c), PlanUpdate(
            teacher_choice="CLASSWORK", grade_treatment="PRACTICE_ONLY",
        ))
    assert locked_plan.value.status_code == 409
    unchanged = save_plan(db, _staff(c), _id(c), PlanUpdate(
        teacher_choice="CLASSWORK", grade_treatment="WRITTEN_WORK",
        target_assignment_ids=[target.classwork_assignment_id],
    ))
    assert unchanged["plan"]["grade_treatment"] == "WRITTEN_WORK"
    kwargs["class_ids"] = json.dumps([c["class"].class_id + 1])
    with pytest.raises(HTTPException):
        asyncio.run(create_classwork_wizard_record(**kwargs))
    kwargs["class_ids"] = json.dumps([c["class"].class_id])
    kwargs["remediation_request_id"] = uuid4()
    kwargs["current_user"] = {"sub": str(c["staff"].user_id), "role": "admin"}
    with pytest.raises(HTTPException) as admin:
        asyncio.run(create_classwork_wizard_record(**kwargs))
    assert admin.value.status_code == 403
    row = db.get(Intervention, _id(c))
    from datetime import datetime, timezone
    row.status = "RESOLVED"; row.resolution_reason = "IMPROVED_PREDICTION"; row.resolved_at = datetime.now(timezone.utc)
    db.commit()
    kwargs["current_user"]["role"] = "teacher"
    with pytest.raises(HTTPException) as resolved:
        asyncio.run(create_classwork_wizard_record(**kwargs))
    assert resolved.value.status_code == 404


def test_intervention_quiz_uses_existing_builder(candidate_context):
    c = candidate_context; db = c["db"]
    account = UserAccount(user_id=uuid4(), email=f"remediation-{uuid4().hex[:8]}@example.test", password_hash="test")
    db.add(account); db.flush(); c["student"].user_id = account.user_id; db.commit()
    _activate(c)
    target = _make_classwork_target(c, "Original Quiz Target", points=10.0, score=5.0)
    save_plan(db, _staff(c), _id(c), PlanUpdate(
        teacher_choice="QUIZ", grade_treatment="WRITTEN_WORK",
        target_assignment_ids=[target.classwork_assignment_id],
    ))
    result = asyncio.run(create_classwork_wizard_record(
        title="Targeted quiz", classwork_type="QUIZ", subject_id=c["subject"].subject_id,
        description=None, instructions="Practice", classwork_category="WRITTEN_WORK", total_points=10,
        is_published=True, class_ids=json.dumps([c["class"].class_id]), academic_period_id=c["period"].academic_period_id,
        lesson_ids="[]", due_date=None, lock_date=None, allow_late_submissions=False, max_attempts=1,
        quiz_payload=json.dumps(_valid_quiz_payload()), rubric_payload=None, files=None,
        intervention_id=_id(c), remediation_request_id=uuid4(),
        original_classwork_assignment_id=target.classwork_assignment_id,
        current_user={"sub": str(c["staff"].user_id), "role": "teacher"},
        staff_id=_staff(c), db=db,
    ))
    assignment = db.query(ClassworkAssignment).filter_by(classwork_id=result.classwork_id).one()
    assert assignment.recipient_student_id == c["student"].student_id
    from app.models.quiz.Quiz import Quiz
    assert db.query(Quiz).filter_by(classwork_id=result.classwork_id).one().total_items == 1
    notices = db.query(Notification).filter_by(user_id=c["student"].user_id).all()
    assert any("additional" in n.body for n in notices)


def test_authoring_rejects_legacy_treatment_outside_verified_focus(candidate_context):
    c = candidate_context; db = c["db"]
    _activate(c)
    row = db.get(Intervention, _id(c))
    row.remediation_plan = {
        "teacher_choice": "CLASSWORK",
        "grade_treatment": "PERFORMANCE_TASK",
        "selected_resources": [],
    }
    db.commit()
    before = db.query(Classwork).count()

    with pytest.raises(HTTPException) as exc:
        asyncio.run(create_classwork_wizard_record(
            title="Legacy mismatched task", classwork_type="ASSIGNMENT",
            subject_id=c["subject"].subject_id, description=None,
            instructions="Practice", classwork_category="PERFORMANCE_TASK",
            total_points=10, is_published=True,
            class_ids=json.dumps([c["class"].class_id]),
            academic_period_id=c["period"].academic_period_id,
            lesson_ids="[]", due_date=None, lock_date=None,
            allow_late_submissions=False, max_attempts=None, quiz_payload=None,
            rubric_payload=None, files=None, intervention_id=_id(c),
            remediation_request_id=uuid4(),
            current_user={"sub": str(c["staff"].user_id), "role": "teacher"},
            staff_id=_staff(c), db=db,
        ))

    assert exc.value.status_code == 400
    assert "verified intervention focus" in exc.value.detail
    assert db.query(Classwork).count() == before
    db.refresh(row)
    assert row.remediation_plan["grade_treatment"] == "PERFORMANCE_TASK"


def _linked_classwork_kwargs(c, request_id, original_assignment_id):
    return dict(
        title="Linked written remediation", classwork_type="ASSIGNMENT",
        subject_id=c["subject"].subject_id, description=None,
        instructions="Complete the remediation", classwork_category="WRITTEN_WORK",
        total_points=20, is_published=True,
        class_ids=json.dumps([c["class"].class_id]),
        academic_period_id=c["period"].academic_period_id,
        lesson_ids="[]", due_date=None, lock_date=None,
        allow_late_submissions=False, max_attempts=None, quiz_payload=None,
        rubric_payload=None, files=None, intervention_id=_id(c),
        remediation_request_id=request_id,
        original_classwork_assignment_id=original_assignment_id,
        current_user={"sub": str(c["staff"].user_id), "role": "teacher"},
        staff_id=_staff(c), db=c["db"],
    )


def test_ww_remediation_link_is_auditable_and_preserves_raw_scores(candidate_context):
    c = candidate_context; db = c["db"]
    _activate(c)
    original = _make_classwork_target(c, "Original Written Work", score=10.0)
    save_plan(db, _staff(c), _id(c), PlanUpdate(
        teacher_choice="CLASSWORK", grade_treatment="WRITTEN_WORK",
        target_assignment_ids=[original.classwork_assignment_id],
    ))

    created = asyncio.run(create_classwork_wizard_record(
        **_linked_classwork_kwargs(c, uuid4(), original.classwork_assignment_id)
    ))
    remediation = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()
    link = db.query(RemediationAssignmentLink).one()

    assert link.source_intervention_id == _id(c)
    assert link.remediation_assignment_id == remediation.classwork_assignment_id
    assert link.original_assignment_id == original.classwork_assignment_id
    assert link.student_id == c["student"].student_id
    assert link.component == "WRITTEN_WORK"
    assert remediation.original_exam_assignment_id is None

    from app.models.submissions.StudentSubmission import StudentSubmission
    original_submission = db.query(StudentSubmission).filter_by(
        classwork_assignment_id=original.classwork_assignment_id,
        student_id=c["student"].student_id,
    ).one()
    db.add(StudentSubmission(
        classwork_assignment_id=remediation.classwork_assignment_id,
        student_id=c["student"].student_id, grade=8, status="graded",
    ))
    db.commit()
    db.refresh(original_submission)
    assert float(original_submission.grade) == 10.0
    assert {
        row.classwork_assignment_id: float(row.grade)
        for row in db.query(StudentSubmission).filter_by(student_id=c["student"].student_id).all()
        if row.classwork_assignment_id in {
            original.classwork_assignment_id, remediation.classwork_assignment_id,
        }
    } == {
        original.classwork_assignment_id: 10.0,
        remediation.classwork_assignment_id: 8.0,
    }

    from app.services.intervention.RemediationAssignmentLinkService import create_remediation_assignment_link
    assert create_remediation_assignment_link(
        db, intervention=db.get(Intervention, _id(c)),
        remediation_assignment=remediation,
        original_assignment_id=original.classwork_assignment_id,
        component="WRITTEN_WORK", staff_id=_staff(c),
    ).remediation_link_id == link.remediation_link_id
    assert db.query(RemediationAssignmentLink).count() == 1


def test_performance_task_remediation_link_uses_same_isolated_foundation(candidate_context):
    c = candidate_context; db = c["db"]
    _activate(c)
    row = db.get(Intervention, _id(c))
    row.diagnosis_snapshot = {
        **row.diagnosis_snapshot,
        "weakest_supported_components": ["PERFORMANCE_TASK"],
    }
    db.commit()
    original = _make_classwork_target(
        c, "Original Performance Task", category="PERFORMANCE_TASK", score=12.0,
    )
    save_plan(db, _staff(c), _id(c), PlanUpdate(
        teacher_choice="CLASSWORK", grade_treatment="PERFORMANCE_TASK",
        target_assignment_ids=[original.classwork_assignment_id],
    ))
    kwargs = _linked_classwork_kwargs(c, uuid4(), original.classwork_assignment_id)
    kwargs.update(
        title="Linked performance remediation",
        classwork_category="PERFORMANCE_TASK",
    )

    created = asyncio.run(create_classwork_wizard_record(**kwargs))
    remediation = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()
    link = db.query(RemediationAssignmentLink).one()
    assert link.component == "PERFORMANCE_TASK"
    assert link.original_assignment_id == original.classwork_assignment_id
    assert link.remediation_assignment_id == remediation.classwork_assignment_id
    assert remediation.original_exam_assignment_id is None


def test_ww_link_allows_individual_target_from_multi_target_plan_and_rolls_back_on_unselected(candidate_context):
    c = candidate_context; db = c["db"]
    _activate(c)
    first = _make_classwork_target(c, "Original WW 1", score=10.0)
    second = _make_classwork_target(c, "Original WW 2", score=12.0)
    third = _make_classwork_target(c, "Original WW 3", score=14.0)
    save_plan(db, _staff(c), _id(c), PlanUpdate(
        teacher_choice="CLASSWORK", grade_treatment="WRITTEN_WORK",
        target_assignment_ids=[first.classwork_assignment_id, second.classwork_assignment_id],
    ))
    before = db.query(Classwork).count()

    with pytest.raises(HTTPException) as exc:
        asyncio.run(create_classwork_wizard_record(
            **_linked_classwork_kwargs(c, uuid4(), third.classwork_assignment_id)
        ))

    assert exc.value.status_code == 400
    assert "not in the intervention plan's saved targets" in exc.value.detail
    assert db.query(Classwork).count() == before
    assert db.query(RemediationAssignmentLink).count() == 0

    created = asyncio.run(create_classwork_wizard_record(
        **_linked_classwork_kwargs(c, uuid4(), first.classwork_assignment_id)
    ))
    remediation = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()
    link = db.query(RemediationAssignmentLink).one()
    assert link.original_assignment_id == first.classwork_assignment_id
    assert link.remediation_assignment_id == remediation.classwork_assignment_id


def test_ww_link_rejects_cross_category_and_finalized_period(candidate_context):
    c = candidate_context; db = c["db"]
    _activate(c)
    performance = _make_classwork_target(
        c, "Original Performance Task", category="PERFORMANCE_TASK", score=10.0,
    )
    row = db.get(Intervention, _id(c))
    row.remediation_plan = {
        "teacher_choice": "CLASSWORK", "grade_treatment": "WRITTEN_WORK",
        "target_assignment_ids": [performance.classwork_assignment_id],
        "selected_resources": [],
    }
    db.commit()
    with pytest.raises(HTTPException) as cross_category:
        asyncio.run(create_classwork_wizard_record(
            **_linked_classwork_kwargs(c, uuid4(), performance.classwork_assignment_id)
        ))
    assert cross_category.value.status_code == 400
    assert "same grading category" in cross_category.value.detail

    written = _make_classwork_target(c, "Finalized Original WW", score=10.0)
    row.remediation_plan = {
        **row.remediation_plan,
        "target_assignment_ids": [written.classwork_assignment_id],
    }
    from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
    db.add(StudentPeriodGrade(
        student_id=c["student"].student_id, class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        final_period_grade=80, is_finalized=True,
    ))
    db.commit()
    with pytest.raises(HTTPException) as finalized:
        asyncio.run(create_classwork_wizard_record(
            **_linked_classwork_kwargs(c, uuid4(), written.classwork_assignment_id)
        ))
    assert finalized.value.status_code == 409
    assert db.query(RemediationAssignmentLink).count() == 0


def test_one_remediation_attempt_cannot_link_to_multiple_originals(candidate_context):
    c = candidate_context; db = c["db"]
    _activate(c)
    first = _make_classwork_target(c, "First Original", score=10.0)
    second = _make_classwork_target(c, "Second Original", score=11.0)
    save_plan(db, _staff(c), _id(c), PlanUpdate(
        teacher_choice="CLASSWORK", grade_treatment="WRITTEN_WORK",
        target_assignment_ids=[first.classwork_assignment_id],
    ))
    created = asyncio.run(create_classwork_wizard_record(
        **_linked_classwork_kwargs(c, uuid4(), first.classwork_assignment_id)
    ))
    remediation = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()
    row = db.get(Intervention, _id(c))
    row.remediation_plan = {**row.remediation_plan, "target_assignment_ids": [second.classwork_assignment_id]}
    db.commit()

    from app.services.intervention.RemediationAssignmentLinkService import create_remediation_assignment_link
    with pytest.raises(HTTPException) as duplicate:
        create_remediation_assignment_link(
            db, intervention=row, remediation_assignment=remediation,
            original_assignment_id=second.classwork_assignment_id,
            component="WRITTEN_WORK", staff_id=_staff(c),
        )
    assert duplicate.value.status_code == 409
    assert db.query(RemediationAssignmentLink).one().original_assignment_id == first.classwork_assignment_id


def test_targeted_draft_requires_explicit_publication(candidate_context):
    c = candidate_context; db = c["db"]
    _activate(c)
    target = _make_classwork_target(c, "Original Draft Target", points=10.0, score=5.0)
    save_plan(db, _staff(c), _id(c), PlanUpdate(
        teacher_choice="CLASSWORK", grade_treatment="WRITTEN_WORK",
        target_assignment_ids=[target.classwork_assignment_id],
    ))
    identity = {"sub": str(c["staff"].user_id), "role": "teacher"}
    result = asyncio.run(create_classwork_wizard_record(
        title="Draft practice", classwork_type="ASSIGNMENT", subject_id=c["subject"].subject_id,
        description=None, instructions="Practice", classwork_category="WRITTEN_WORK", total_points=10,
        is_published=False, class_ids=json.dumps([c["class"].class_id]), academic_period_id=c["period"].academic_period_id,
        lesson_ids="[]", due_date=None, lock_date=None, allow_late_submissions=False, max_attempts=None,
        quiz_payload=None, rubric_payload=None, files=None, intervention_id=_id(c), remediation_request_id=uuid4(),
        original_classwork_assignment_id=target.classwork_assignment_id,
        current_user=identity, staff_id=_staff(c), db=db,
    ))
    assignment = db.query(ClassworkAssignment).filter_by(classwork_id=result.classwork_id).one()
    assert not assignment.is_published
    publish = ClassworkAssignRequest(class_ids=[c["class"].class_id], academic_period_id=c["period"].academic_period_id, is_published=True)
    assign_classwork_to_classes(result.classwork_id, publish, _staff(c), db, identity)
    db.refresh(assignment)
    assert assignment.is_published and assignment.recipient_student_id == c["student"].student_id
    assert db.get(Classwork, result.classwork_id).is_published
    row = db.get(Intervention, _id(c))
    from datetime import datetime, timezone
    row.status = "RESOLVED"; row.resolution_reason = "IMPROVED_PREDICTION"; row.resolved_at = datetime.now(timezone.utc)
    db.commit()
    with pytest.raises(HTTPException):
        assign_classwork_to_classes(result.classwork_id, publish, _staff(c), db, identity)
    assert db.get(ClassworkAssignment, assignment.classwork_assignment_id).is_published


def test_targeted_quiz_attempt_rejects_classmate(quiz_attempt_context):
    c = quiz_attempt_context
    db = c["db"]
    db.add(StudentClass(student_id=c["other_student"].student_id, class_id=c["assignment"].class_id,
                        academic_year_id=db.query(StudentClass).filter_by(student_id=c["student"].student_id).one().academic_year_id,
                        enrollment_status="enrolled"))
    from datetime import date, datetime, timezone
    from app.models.academic.AcademicPeriod import AcademicPeriod
    from app.services.intervention.RemediationReadingPrerequisiteService import (
        ReadingPrerequisiteSnapshotItem,
        stage_remediation_reading_prerequisites,
    )

    period = db.query(AcademicPeriod).first()
    if not period:
        period = AcademicPeriod(
            period_name="Q1",
            academic_year_id=c["assignment"].class_.academic_year_id,
            start_date=date(2025, 6, 1),
            end_date=date(2025, 8, 31),
            is_active=True,
        )
        db.add(period)
        db.flush()
    c["assignment"].academic_period_id = period.academic_period_id

    intervention = Intervention(
        intervention_id=9999,
        student_id=c["student"].student_id,
        class_id=c["assignment"].class_id,
        subject_id=c["classwork"].subject_id,
        academic_period_id=period.academic_period_id,
        source_prediction_id=1,
        status="ACTIVE",
        diagnosis_snapshot={},
        activated_at=datetime.now(timezone.utc),
        activated_by_staff_id=c["classwork"].created_by_staff_id,
    )
    db.add(intervention)
    reading_cw = Classwork(
        title="Prep Reading",
        classwork_type="READING",
        is_graded=False,
        is_published=True,
        is_archived=False,
        subject_id=c["classwork"].subject_id,
        created_by_staff_id=c["classwork"].created_by_staff_id,
    )
    db.add(reading_cw)
    db.flush()
    reading_assign = ClassworkAssignment(
        classwork_id=reading_cw.classwork_id,
        class_id=c["assignment"].class_id,
        academic_period_id=period.academic_period_id,
        assigned_by_staff_id=c["classwork"].created_by_staff_id,
        is_published=True,
        recipient_student_id=c["student"].student_id,
        source_intervention_id=9999,
        remediation_request_id=uuid4(),
    )
    db.add(reading_assign)
    db.flush()
    db.add(StudentSubmission(
        classwork_assignment_id=reading_assign.classwork_assignment_id,
        student_id=c["student"].student_id,
        status="submitted",
    ))
    c["assignment"].recipient_student_id = c["student"].student_id
    c["assignment"].source_intervention_id = 9999
    c["assignment"].remediation_request_id = uuid4()
    stage_remediation_reading_prerequisites(
        db,
        remediation_assignment_id=c["assignment"].classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(
                reading_classwork_id=reading_cw.classwork_id,
                reading_assignment_id=reading_assign.classwork_assignment_id,
                display_order=1,
            )
        ],
    )
    db.commit()
    aid = c["assignment"].classwork_assignment_id
    assert c["client"].post(f"/api/v1/quizzes/assignment/{aid}/start").status_code == 200
    c["identity"].update(sub=c["accounts"]["other_student"].user_id, role="student")
    assert c["client"].get(f"/api/v1/quizzes/assignment/{aid}/attempt").status_code == 404
    assert c["client"].post(f"/api/v1/quizzes/assignment/{aid}/start").status_code == 404
    assert c["client"].post(f"/api/v1/quizzes/assignment/{aid}/submit", json={"answers": []}).status_code == 404
    analysis = build_teacher_quiz_analysis(db, "T-QUIZ", c["classwork"].classwork_id)
    assert analysis.total_students == 1


def test_quiz_creator_produces_valid_link_and_enforces_one_attempt(candidate_context):
    c = candidate_context; db = c["db"]
    account = UserAccount(user_id=uuid4(), email=f"rem-quiz-{uuid4().hex[:8]}@example.test", password_hash="test")
    db.add(account); db.flush(); c["student"].user_id = account.user_id; db.commit()
    _activate(c)
    target = _make_classwork_target(c, "Original Target WW", points=10.0, score=4.0)
    save_plan(db, _staff(c), _id(c), PlanUpdate(
        teacher_choice="QUIZ", grade_treatment="WRITTEN_WORK",
        target_assignment_ids=[target.classwork_assignment_id],
    ))

    # Reject more than 1 attempt
    with pytest.raises(HTTPException) as multi_attempt_err:
        asyncio.run(create_classwork_wizard_record(
            title="Remedial Quiz 2 attempts", classwork_type="QUIZ", subject_id=c["subject"].subject_id,
            description=None, instructions="Practice", classwork_category="WRITTEN_WORK", total_points=10,
            is_published=True, class_ids=json.dumps([c["class"].class_id]), academic_period_id=c["period"].academic_period_id,
            lesson_ids="[]", due_date=None, lock_date=None, allow_late_submissions=False, max_attempts=2,
            quiz_payload=json.dumps(_valid_quiz_payload()), rubric_payload=None, files=None,
            intervention_id=_id(c), remediation_request_id=uuid4(),
            original_classwork_assignment_id=target.classwork_assignment_id,
            current_user={"sub": str(c["staff"].user_id), "role": "teacher"},
            staff_id=_staff(c), db=db,
        ))
    assert multi_attempt_err.value.status_code == 400
    assert "one attempt" in multi_attempt_err.value.detail.lower()

    # Exactly 1 attempt succeeds and creates link
    result = asyncio.run(create_classwork_wizard_record(
        title="Remedial Quiz 1 attempt", classwork_type="QUIZ", subject_id=c["subject"].subject_id,
        description=None, instructions="Practice", classwork_category="WRITTEN_WORK", total_points=10,
        is_published=True, class_ids=json.dumps([c["class"].class_id]), academic_period_id=c["period"].academic_period_id,
        lesson_ids="[]", due_date=None, lock_date=None, allow_late_submissions=False, max_attempts=1,
        quiz_payload=json.dumps(_valid_quiz_payload()), rubric_payload=None, files=None,
        intervention_id=_id(c), remediation_request_id=uuid4(),
        original_classwork_assignment_id=target.classwork_assignment_id,
        current_user={"sub": str(c["staff"].user_id), "role": "teacher"},
        staff_id=_staff(c), db=db,
    ))
    link = db.query(RemediationAssignmentLink).filter_by(
        original_assignment_id=target.classwork_assignment_id
    ).one()
    assert link.source_intervention_id == _id(c)
    assert link.student_id == c["student"].student_id
    assert link.component == "WRITTEN_WORK"


def test_graded_remediation_rejects_missing_or_forged_original_id(candidate_context):
    c = candidate_context; db = c["db"]
    _activate(c)
    target = _make_classwork_target(c, "Original Target", points=20.0, score=10.0)
    save_plan(db, _staff(c), _id(c), PlanUpdate(
        teacher_choice="CLASSWORK", grade_treatment="WRITTEN_WORK",
        target_assignment_ids=[target.classwork_assignment_id],
    ))

    # Missing original_classwork_assignment_id
    with pytest.raises(HTTPException) as missing_err:
        asyncio.run(create_classwork_wizard_record(
            **_linked_classwork_kwargs(c, uuid4(), None)
        ))
    assert missing_err.value.status_code == 400
    assert "select the original classwork assignment" in missing_err.value.detail.lower()

    # Forged ID (not in intervention plan)
    with pytest.raises(HTTPException) as forged_err:
        asyncio.run(create_classwork_wizard_record(
            **_linked_classwork_kwargs(c, uuid4(), 999999)
        ))
    assert forged_err.value.status_code == 400
    assert "not in the intervention plan's saved targets" in forged_err.value.detail.lower()


def test_graded_remediation_rejects_mismatched_maximum_points_and_rolls_back(candidate_context):
    c = candidate_context; db = c["db"]
    _activate(c)
    target = _make_classwork_target(c, "Original 20pt Target", points=20.0, score=10.0)
    save_plan(db, _staff(c), _id(c), PlanUpdate(
        teacher_choice="CLASSWORK", grade_treatment="WRITTEN_WORK",
        target_assignment_ids=[target.classwork_assignment_id],
    ))
    before_classworks = db.query(Classwork).count()
    before_assignments = db.query(ClassworkAssignment).count()
    before_links = db.query(RemediationAssignmentLink).count()

    # Total points = 15 != 20
    kwargs = _linked_classwork_kwargs(c, uuid4(), target.classwork_assignment_id)
    kwargs["total_points"] = 15

    with pytest.raises(HTTPException) as mismatch_err:
        asyncio.run(create_classwork_wizard_record(**kwargs))
    assert mismatch_err.value.status_code == 400
    assert "equal the original classwork" in mismatch_err.value.detail.lower()

    # Assert transactional rollback: no orphaned classwork or link
    assert db.query(Classwork).count() == before_classworks
    assert db.query(ClassworkAssignment).count() == before_assignments
    assert db.query(RemediationAssignmentLink).count() == before_links


def test_practice_only_and_examination_remain_unaffected(candidate_context):
    c = candidate_context; db = c["db"]
    _activate(c)

    # PRACTICE_ONLY requires NO original link and creates NO link
    save_plan(db, _staff(c), _id(c), PlanUpdate(
        teacher_choice="CLASSWORK", grade_treatment="PRACTICE_ONLY",
    ))
    prac = asyncio.run(create_classwork_wizard_record(
        title="Practice task", classwork_type="ASSIGNMENT", subject_id=c["subject"].subject_id,
        description=None, instructions="Practice", classwork_category=None, total_points=10,
        is_published=True, class_ids=json.dumps([c["class"].class_id]), academic_period_id=c["period"].academic_period_id,
        lesson_ids="[]", due_date=None, lock_date=None, allow_late_submissions=False, max_attempts=None,
        quiz_payload=None, rubric_payload=None, files=None, intervention_id=_id(c), remediation_request_id=uuid4(),
        current_user={"sub": str(c["staff"].user_id), "role": "teacher"}, staff_id=_staff(c), db=db,
    ))
    assert prac.classwork_id is not None
    assert db.query(RemediationAssignmentLink).count() == 0


def test_intervention_progress_reflects_linked_activity_history(candidate_context):
    c = candidate_context; db = c["db"]
    _activate(c)
    target = _make_classwork_target(c, "Original Progress Target", points=20.0, score=10.0)
    save_plan(db, _staff(c), _id(c), PlanUpdate(
        teacher_choice="CLASSWORK", grade_treatment="WRITTEN_WORK",
        target_assignment_ids=[target.classwork_assignment_id],
    ))
    created = asyncio.run(create_classwork_wizard_record(
        **_linked_classwork_kwargs(c, uuid4(), target.classwork_assignment_id)
    ))
    remediation_assignment = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()

    # Add student submission on remediation
    from app.models.submissions.StudentSubmission import StudentSubmission
    db.add(StudentSubmission(
        classwork_assignment_id=remediation_assignment.classwork_assignment_id,
        student_id=c["student"].student_id, grade=18.0, status="graded",
    ))
    db.commit()

    from app.services.intervention.InterventionRemediationService import progress
    intervention_row = db.get(Intervention, _id(c))
    prog = progress(db, intervention_row)
    assert len(prog["assigned_remediation"]) == 1
    act = prog["assigned_remediation"][0]
    assert act["assignment_id"] == remediation_assignment.classwork_assignment_id
    assert act["original_assignment_id"] == target.classwork_assignment_id
    assert act["original_title"] == "Original Progress Target"
    assert act["original_grade"] == 10.0
    assert act["grade"] == 18.0
    # Adjusted cap is 75% of 20 = 15.0; min(18, 15) = 15.0
    assert act["effective_grade"] == 15.0
