"""A targeted activity is visible in the class record but grades one learner only."""

from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.academic.StudentCLass import StudentClass
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Activity import BulkScoreUpdateRequest
from app.schemas.Submission import GradeRequest
from app.services.activity import ActivityService as activity
from app.services.student_record.StudentRecordService import teacher_student_gradebook
from app.services.submission.SubmissionService import grade_student_submission
from tests.test_classwork_submission_authorization import authz_context


def _targeted(context):
    db = context["db"]
    other = db.query(Student).filter_by(user_id=context["accounts"]["other_student"].user_id).one()
    db.query(StudentClass).filter_by(student_id=other.student_id).one().class_id = context["allowed_class"].class_id
    assignment = context["assignment"]
    assignment.recipient_student_id = context["student"].student_id
    assignment.source_intervention_id = 9999
    assignment.remediation_request_id = uuid4()
    db.commit()
    return other


def test_targeted_gradebook_omits_classmate_denominator_and_identifies_column(authz_context):
    c = authz_context
    other = _targeted(c)
    c["submission"].grade = 100
    c["submission"].status = "graded"
    c["db"].commit()
    gradebook = teacher_student_gradebook(c["db"], c["owner"].staff_id, c["allowed_class"].class_id,
                                          c["subject"].subject_id, c["period"].academic_period_id)
    header = gradebook.classwork[0].writtenWork[0]
    assert header.recipientStudentId == str(c["student"].student_id)
    assert header.sourceInterventionId == 9999 and header.assignedLearnerCount == 1
    rows = {row.student_id: row for row in gradebook.studentGrades}
    assert rows[str(c["student"].student_id)].writtenWork == [100]
    assert rows[str(other.student_id)].writtenWork == [None]
    assert rows[str(other.student_id)].ps_written is None


def test_bulk_and_submission_grade_writes_reject_non_recipient(authz_context, monkeypatch):
    c = authz_context
    other = _targeted(c)
    monkeypatch.setattr(activity, "refresh_after_committed_grade_change", lambda *_args, **_kwargs: None)
    activity_id = c["classwork"].classwork_id
    class_id = c["allowed_class"].class_id
    response = activity.get_activity_scores(c["db"], c["owner"].staff_id, activity_id, class_id)
    items = {str(item.student_id): item for item in response.students}
    assert items[str(c["student"].student_id)].assigned
    assert not items[str(other.student_id)].assigned
    forged = BulkScoreUpdateRequest(class_id=class_id, scores=[
        {"student_id": c["student"].student_id, "score": 80},
        {"student_id": other.student_id, "score": 90},
    ])
    with pytest.raises(HTTPException) as error:
        activity.bulk_update_activity_scores(c["db"], c["owner"].staff_id, activity_id, forged)
    assert error.value.status_code == 403
    assert c["submission"].grade is None

    target = BulkScoreUpdateRequest(class_id=class_id, scores=[{"student_id": c["student"].student_id, "score": 80}])
    activity.bulk_update_activity_scores(c["db"], c["owner"].staff_id, activity_id, target)
    c["db"].refresh(c["submission"])
    assert float(c["submission"].grade) == 80

    nonrecipient_submission = StudentSubmission(student_id=other.student_id,
        classwork_assignment_id=c["assignment"].classwork_assignment_id, status="submitted")
    c["db"].add(nonrecipient_submission)
    c["db"].commit()
    with pytest.raises(HTTPException) as error:
        grade_student_submission(nonrecipient_submission.submission_id, GradeRequest(grade=90), c["owner"].staff_id, c["db"])
    assert error.value.status_code == 403
    assert nonrecipient_submission.grade is None


def test_classwide_score_path_remains_available(authz_context, monkeypatch):
    c = authz_context
    other = _targeted(c)
    assignment: ClassworkAssignment = c["assignment"]
    assignment.recipient_student_id = None
    assignment.source_intervention_id = None
    assignment.remediation_request_id = None
    c["db"].commit()
    monkeypatch.setattr(activity, "refresh_after_committed_grade_change", lambda *_args, **_kwargs: None)
    payload = BulkScoreUpdateRequest(class_id=c["allowed_class"].class_id,
        scores=[{"student_id": other.student_id, "score": 70}])
    response = activity.bulk_update_activity_scores(c["db"], c["owner"].staff_id, c["classwork"].classwork_id, payload)
    assert all(item.assigned for item in response.students)
    assert next(item.score for item in response.students if item.student_id == other.student_id) == 70
