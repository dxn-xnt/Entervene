from decimal import Decimal

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.routes.Activities import router as activities_router
from app.api.v1.routes.Auth import get_current_user
from app.db.Session import get_db
from app.models.academic.StudentCLass import StudentClass
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.activity import ActivityService
from tests.test_classwork_submission_authorization import authz_context  # noqa: F401


def _activity_client(context) -> TestClient:
    app = FastAPI()
    app.include_router(activities_router, prefix="/api/v1/activities")
    app.dependency_overrides[get_db] = lambda: context["db"]
    app.dependency_overrides[get_current_user] = lambda: context["identity"]
    return TestClient(app)


def test_bulk_online_scoring_rejects_absent_attempt_atomically(authz_context, monkeypatch):
    context = authz_context
    db = context["db"]
    classwork = context["classwork"]
    classwork.classwork_type = "ACTIVITY"
    classwork.activity_mode = "ONLINE"
    context["submission"].status = "submitted"
    context["submission"].attempt_count = 1

    other_student = db.query(Student).filter_by(
        user_id=context["accounts"]["other_student"].user_id,
    ).one()
    other_enrollment = db.query(StudentClass).filter_by(
        student_id=other_student.student_id,
        academic_year_id=context["period"].academic_year_id,
    ).one()
    other_enrollment.class_id = context["allowed_class"].class_id
    other_enrollment.enrollment_status = "enrolled"
    db.commit()
    monkeypatch.setattr(ActivityService, "refresh_after_committed_grade_change", lambda *_args, **_kwargs: None)

    with _activity_client(context) as client:
        response = client.put(
            f"/api/v1/activities/{classwork.classwork_id}/scores",
            json={
                "class_id": context["allowed_class"].class_id,
                "scores": [
                    {"student_id": str(context["student"].student_id), "score": 50},
                    {"student_id": str(other_student.student_id), "score": 60},
                ],
            },
        )

    assert response.status_code == 409
    assert "submitted student attempt" in response.json()["detail"]
    db.refresh(context["submission"])
    assert context["submission"].grade is None
    assert db.query(StudentSubmission).filter_by(
        classwork_assignment_id=context["assignment"].classwork_assignment_id,
        student_id=other_student.student_id,
    ).first() is None


def test_manual_activity_still_allows_offline_zero_score(authz_context, monkeypatch):
    context = authz_context
    db = context["db"]
    classwork = context["classwork"]
    classwork.classwork_type = "ACTIVITY"
    classwork.activity_mode = "MANUAL"
    db.delete(context["submission"])
    db.commit()
    monkeypatch.setattr(ActivityService, "refresh_after_committed_grade_change", lambda *_args, **_kwargs: None)

    with _activity_client(context) as client:
        response = client.put(
            f"/api/v1/activities/{classwork.classwork_id}/scores",
            json={
                "class_id": context["allowed_class"].class_id,
                "scores": [{"student_id": str(context["student"].student_id), "score": 0}],
            },
        )

    assert response.status_code == 200
    saved = db.query(StudentSubmission).filter_by(
        classwork_assignment_id=context["assignment"].classwork_assignment_id,
        student_id=context["student"].student_id,
    ).one()
    assert saved.grade == Decimal("0")
    assert saved.status == "graded"


def test_empty_online_score_does_not_create_submission(authz_context):
    context = authz_context
    db = context["db"]
    classwork = context["classwork"]
    classwork.classwork_type = "ACTIVITY"
    classwork.activity_mode = "ONLINE"
    student_id = context["submission"].student_id
    db.delete(context["submission"])
    db.commit()

    with _activity_client(context) as client:
        response = client.put(
            f"/api/v1/activities/{classwork.classwork_id}/scores",
            json={
                "class_id": context["allowed_class"].class_id,
                "scores": [{"student_id": str(student_id), "score": None}],
            },
        )

    assert response.status_code == 200
    assert db.query(StudentSubmission).filter_by(
        classwork_assignment_id=context["assignment"].classwork_assignment_id,
        student_id=student_id,
    ).first() is None


def test_submission_grade_api_rejects_pending_placeholder(authz_context):
    context = authz_context
    submission = context["submission"]
    submission.status = "pending"
    submission.attempt_count = 0
    context["db"].commit()

    response = context["client"].put(
        f"/api/v1/submissions/{submission.submission_id}/grade",
        json={"grade": 25},
    )

    assert response.status_code == 409
    assert "submitted student attempt" in response.json()["detail"]
    context["db"].refresh(submission)
    assert submission.grade is None
    assert submission.status == "pending"


def test_quiz_grade_api_rejects_unsubmitted_attempt(authz_context):
    context = authz_context
    submission = context["submission"]
    context["classwork"].classwork_type = "QUIZ"
    context["classwork"].activity_mode = "ONLINE"
    submission.status = "pending"
    submission.attempt_count = 1
    context["db"].commit()

    response = context["client"].put(
        f"/api/v1/quizzes/submission/{submission.submission_id}/grade",
        json={"answers": [], "override_total_grade": 10},
    )

    assert response.status_code == 409
    assert "submitted student attempt" in response.json()["detail"]
    context["db"].refresh(submission)
    assert submission.grade is None
    assert submission.status == "pending"


def test_submitted_online_zero_grade_and_later_edit_remain_valid(authz_context, monkeypatch):
    context = authz_context
    submission = context["submission"]
    submission.status = "submitted"
    submission.attempt_count = 1
    context["db"].commit()

    import app.services.submission.SubmissionFeedbackService as feedback_service
    import app.services.submission.SubmissionService as submission_service

    monkeypatch.setattr(feedback_service, "enqueue_automatic_feedback_draft", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(feedback_service, "dispatch_background_draft_processing", lambda: None)
    monkeypatch.setattr(submission_service, "refresh_after_committed_grade_change", lambda *_args, **_kwargs: None)

    first = context["client"].put(
        f"/api/v1/submissions/{submission.submission_id}/grade",
        json={"grade": 0},
    )
    assert first.status_code == 200
    assert first.json()["grade"] == 0

    second = context["client"].put(
        f"/api/v1/submissions/{submission.submission_id}/grade",
        json={"grade": 40},
    )
    assert second.status_code == 200
    assert second.json()["grade"] == 40
