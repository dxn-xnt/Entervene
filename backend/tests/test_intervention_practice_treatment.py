"""Practice keeps a support score without creating official grade evidence."""

import asyncio
import json
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.schemas.Activity import BulkScoreUpdateRequest
from app.schemas.Classwork import ClassworkUpdate
from app.schemas.Submission import GradeRequest
from app.services.activity import ActivityService as activity
from app.services.classwork.ClassworkService import create_classwork_wizard_record, update_classwork_record
from app.services.intervention.InterventionRemediationService import PlanUpdate, save_plan
from app.services.student_record.StudentRecordService import teacher_student_gradebook
from app.services.submission import SubmissionService as submissions
from tests.test_classwork_submission_authorization import authz_context
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_intervention_support_materials import _activate
from tests.test_teacher_intervention_review import candidate_context, _id, _staff
from tests.test_quiz_attempt_api import quiz_attempt_context


def test_targeted_practice_creation_defaults_to_no_official_component(candidate_context):
    c = candidate_context
    _activate(c)
    plan = save_plan(c["db"], _staff(c), _id(c), PlanUpdate(teacher_choice="CLASSWORK"))
    assert plan["plan"]["grade_treatment"] == "PRACTICE_ONLY"
    kwargs = dict(
        title="Targeted practice", classwork_type="ASSIGNMENT", subject_id=c["subject"].subject_id,
        description=None, instructions="Practice", classwork_category=None, total_points=10,
        is_published=False, class_ids=json.dumps([c["class"].class_id]),
        academic_period_id=c["period"].academic_period_id, lesson_ids="[]", due_date=None,
        lock_date=None, allow_late_submissions=False, max_attempts=None, quiz_payload=None,
        rubric_payload=None, files=None, intervention_id=_id(c), remediation_request_id=uuid4(),
        current_user={"sub": str(c["staff"].user_id), "role": "teacher"}, staff_id=_staff(c), db=c["db"],
    )
    result = asyncio.run(create_classwork_wizard_record(**kwargs))
    work = c["db"].get(Classwork, result.classwork_id)
    assignment = c["db"].query(ClassworkAssignment).filter_by(classwork_id=work.classwork_id).one()
    assert work.is_graded is False and work.classwork_category is None and work.total_points == 10
    assert assignment.recipient_student_id == c["student"].student_id
    with pytest.raises(HTTPException):
        update_classwork_record(work.classwork_id, ClassworkUpdate(is_graded=True), _staff(c), c["db"])
    with pytest.raises(HTTPException):
        update_classwork_record(work.classwork_id, ClassworkUpdate(classwork_category="WRITTEN_WORK"), _staff(c), c["db"])
    kwargs["remediation_request_id"] = uuid4()
    kwargs["classwork_category"] = "WRITTEN_WORK"
    with pytest.raises(HTTPException):
        asyncio.run(create_classwork_wizard_record(**kwargs))


def test_practice_score_stays_out_of_gradebook_and_skips_refresh(authz_context, monkeypatch):
    c = authz_context
    c["classwork"].is_graded = False
    c["classwork"].classwork_category = None
    c["assignment"].recipient_student_id = c["student"].student_id
    c["assignment"].source_intervention_id = 9999
    c["assignment"].remediation_request_id = uuid4()
    c["db"].commit()
    calls = []
    monkeypatch.setattr(activity, "refresh_after_committed_grade_change", lambda *_args, **_kwargs: calls.append(True))
    activity.bulk_update_activity_scores(c["db"], c["owner"].staff_id, c["classwork"].classwork_id,
        BulkScoreUpdateRequest(class_id=c["allowed_class"].class_id,
            scores=[{"student_id": c["student"].student_id, "score": 100}]))
    c["db"].refresh(c["submission"])
    assert float(c["submission"].grade) == 100 and c["submission"].status == "graded"
    assert calls == []
    gradebook = teacher_student_gradebook(c["db"], c["owner"].staff_id, c["allowed_class"].class_id,
        c["subject"].subject_id, c["period"].academic_period_id)
    assert gradebook.classwork[0].writtenWork == []
    assert all(row.ps_written is None for row in gradebook.studentGrades)


def test_manual_practice_score_keeps_intervention_record_without_refresh(authz_context, monkeypatch):
    c = authz_context
    c["classwork"].is_graded = False
    c["classwork"].classwork_category = None
    c["assignment"].recipient_student_id = c["student"].student_id
    c["assignment"].source_intervention_id = 9999
    c["assignment"].remediation_request_id = uuid4()
    c["db"].commit()
    calls = []
    monkeypatch.setattr(submissions, "refresh_after_committed_grade_change", lambda *_args, **_kwargs: calls.append(True))
    result = submissions.grade_student_submission(c["submission"].submission_id,
        GradeRequest(grade=80), c["owner"].staff_id, c["db"])
    assert result.grade == 80 and calls == []


@pytest.mark.parametrize("component", ["WRITTEN_WORK", "PERFORMANCE_TASK"])
def test_explicit_official_component_keeps_normal_refresh(authz_context, monkeypatch, component):
    c = authz_context
    c["classwork"].classwork_category = component
    c["db"].commit()
    calls = []
    monkeypatch.setattr(activity, "refresh_after_committed_grade_change", lambda *_args, **_kwargs: calls.append(True))
    activity.bulk_update_activity_scores(c["db"], c["owner"].staff_id, c["classwork"].classwork_id,
        BulkScoreUpdateRequest(class_id=c["allowed_class"].class_id,
            scores=[{"student_id": c["student"].student_id, "score": 100}]))
    assert calls == [True]
    gradebook = teacher_student_gradebook(c["db"], c["owner"].staff_id, c["allowed_class"].class_id,
        c["subject"].subject_id, c["period"].academic_period_id)
    row = next(item for item in gradebook.studentGrades if item.student_id == str(c["student"].student_id))
    assert (row.writtenWork if component == "WRITTEN_WORK" else row.performanceTask) == [100]


def test_practice_quiz_stores_score_without_refresh(quiz_attempt_context, monkeypatch):
    from app.models.quiz.QuizQuestion import QuizQuestion
    from app.services.quiz import QuizAttemptService as attempts

    c = quiz_attempt_context
    c["db"].query(QuizQuestion).filter_by(quiz_question_id=c["short_link"].quiz_question_id).delete()
    c["classwork"].is_graded = False
    c["classwork"].classwork_category = None
    c["db"].commit()
    calls = []
    monkeypatch.setattr(attempts, "refresh_after_committed_grade_change", lambda *_args, **_kwargs: calls.append(True))
    response = c["client"].post(f"/api/v1/quizzes/assignment/{c['assignment'].classwork_assignment_id}/submit",
        json={"answers": [{"quiz_question_id": c["mc_link"].quiz_question_id,
                           "selected_option_id": c["correct"].option_id}]})
    assert response.status_code == 200
    assert response.json()["status"] == "graded"
    assert response.json()["grade"] is not None
    assert calls == []
