"""Focused recipient checks for existing Classwork, Quiz, and submission APIs."""
import asyncio
import json
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.academic.StudentCLass import StudentClass
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.notifications.Notification import Notification
from app.models.auth.UserAccount import UserAccount
from app.services.classwork.ClassworkService import _stage_targeted_assignment_notification
from app.services.quiz.QuizAnalysisService import build_teacher_quiz_analysis
from app.services.classwork.ClassworkService import create_classwork_wizard_record, assign_classwork_to_classes
from app.schemas.Classwork import ClassworkAssignRequest
from app.services.intervention.InterventionRemediationService import PlanUpdate, save_plan
from tests.test_classwork_submission_authorization import authz_context, _act_as, _bearer
from tests.test_classwork_submission_authorization import _valid_quiz_payload
from tests.test_intervention_support_materials import _activate
from tests.test_teacher_intervention_review import candidate_context, _id, _staff
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_quiz_attempt_api import quiz_attempt_context


def test_targeted_assignment_is_private_across_existing_student_surfaces(authz_context):
    c = authz_context
    # Move the other student's fixture enrollment into the same class.
    other = c["db"].query(type(c["student"])).filter_by(user_id=c["accounts"]["other_student"].user_id).one()
    c["db"].query(StudentClass).filter_by(student_id=other.student_id).one().class_id = c["allowed_class"].class_id
    c["assignment"].recipient_student_id = c["student"].student_id
    c["assignment"].source_intervention_id = 9999
    c["assignment"].remediation_request_id = uuid4()
    c["db"].commit()
    assignment_id = c["assignment"].classwork_assignment_id
    classwork_id = c["classwork"].classwork_id
    list_url = f"/api/v1/classwork-assignments/class/{c['allowed_class'].class_id}/subject/{c['subject'].subject_id}"

    _act_as(c, "student", "student")
    assert len(c["client"].get(list_url).json()) == 1
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
    save_plan(db, _staff(c), _id(c), PlanUpdate(teacher_choice="CLASSWORK"))
    before = db.query(Classwork).count()
    created = asyncio.run(create_classwork_wizard_record(**kwargs))
    assignment = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()
    assert assignment.recipient_student_id == c["student"].student_id
    assert assignment.source_intervention_id == _id(c)
    assert assignment.remediation_request_id == request_id
    assert db.query(Classwork).count() == before + 1
    assert asyncio.run(create_classwork_wizard_record(**kwargs)).classwork_id == created.classwork_id
    assert db.query(Classwork).count() == before + 1
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
    save_plan(db, _staff(c), _id(c), PlanUpdate(teacher_choice="QUIZ"))
    result = asyncio.run(create_classwork_wizard_record(
        title="Targeted quiz", classwork_type="QUIZ", subject_id=c["subject"].subject_id,
        description=None, instructions="Practice", classwork_category="WRITTEN_WORK", total_points=10,
        is_published=True, class_ids=json.dumps([c["class"].class_id]), academic_period_id=c["period"].academic_period_id,
        lesson_ids="[]", due_date=None, lock_date=None, allow_late_submissions=False, max_attempts=1,
        quiz_payload=json.dumps(_valid_quiz_payload()), rubric_payload=None, files=None,
        intervention_id=_id(c), remediation_request_id=uuid4(), current_user={"sub": str(c["staff"].user_id), "role": "teacher"},
        staff_id=_staff(c), db=db,
    ))
    assignment = db.query(ClassworkAssignment).filter_by(classwork_id=result.classwork_id).one()
    assert assignment.recipient_student_id == c["student"].student_id
    from app.models.quiz.Quiz import Quiz
    assert db.query(Quiz).filter_by(classwork_id=result.classwork_id).one().total_items == 1
    notices = db.query(Notification).filter_by(user_id=c["student"].user_id).all()
    assert any("additional" in n.body for n in notices)


def test_targeted_draft_requires_explicit_publication(candidate_context):
    c = candidate_context; db = c["db"]
    _activate(c)
    save_plan(db, _staff(c), _id(c), PlanUpdate(teacher_choice="CLASSWORK"))
    identity = {"sub": str(c["staff"].user_id), "role": "teacher"}
    result = asyncio.run(create_classwork_wizard_record(
        title="Draft practice", classwork_type="ASSIGNMENT", subject_id=c["subject"].subject_id,
        description=None, instructions="Practice", classwork_category="WRITTEN_WORK", total_points=10,
        is_published=False, class_ids=json.dumps([c["class"].class_id]), academic_period_id=c["period"].academic_period_id,
        lesson_ids="[]", due_date=None, lock_date=None, allow_late_submissions=False, max_attempts=None,
        quiz_payload=None, rubric_payload=None, files=None, intervention_id=_id(c), remediation_request_id=uuid4(),
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
    c["assignment"].recipient_student_id = c["student"].student_id
    c["assignment"].source_intervention_id = 9999
    c["assignment"].remediation_request_id = uuid4()
    db.commit()
    aid = c["assignment"].classwork_assignment_id
    assert c["client"].post(f"/api/v1/quizzes/assignment/{aid}/start").status_code == 200
    c["identity"].update(sub=c["accounts"]["other_student"].user_id, role="student")
    assert c["client"].get(f"/api/v1/quizzes/assignment/{aid}/attempt").status_code == 404
    assert c["client"].post(f"/api/v1/quizzes/assignment/{aid}/start").status_code == 404
    assert c["client"].post(f"/api/v1/quizzes/assignment/{aid}/submit", json={"answers": []}).status_code == 404
    analysis = build_teacher_quiz_analysis(db, "T-QUIZ", c["classwork"].classwork_id)
    assert analysis.total_students == 1
