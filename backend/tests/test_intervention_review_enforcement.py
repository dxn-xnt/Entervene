"""Comprehensive verification test suite for Task S1D.2C.2B: Intervention Review Enforcement.

Verifies:
1. Previously completed Classwork + no reviews -> 0/3 completed, LOCKED.
2. 1/3 and 2/3 reviewed -> LOCKED (IN_PROGRESS, access denied with HTTP 403).
3. 3/3 reviewed -> READY (COMPLETE, access permitted with HTTP 200).
4. Another intervention requires separate reviews (intervention-specific isolation).
5. Ordinary Classwork submissions, focus telemetry, and grades remain unchanged.
6. Study Support progress matches actual backend access enforcement across all endpoints.
"""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Classworks import router as classworks_router
from app.api.v1.routes.Quizzes import router as quizzes_router
from app.api.v1.routes.StudentPersistentInterventions import router as student_interventions_router
from app.api.v1.routes.Submissions import router as submissions_router
from app.api.v1.routes.TeacherInterventions import require_development_intervention_api
from app.db.Session import get_db
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkAttachment import ClassworkAttachment
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionReadingReview import InterventionReadingReview
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizSetting import QuizSetting
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention.RemediationReadingPrerequisiteService import (
    ReadingPrerequisiteSnapshotItem,
    stage_remediation_reading_prerequisites,
)
from tests.test_classwork_submission_authorization import (
    _act_as,
    _bearer,
    authz_context,
)


def _client_with_all_student_routes(c):
    app = FastAPI()
    app.include_router(student_interventions_router, prefix="/api/v1/student/interventions")
    app.include_router(classworks_router, prefix="/api/v1/classwork-assignments")
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.include_router(submissions_router, prefix="/api/v1/submissions")
    app.dependency_overrides[get_db] = lambda: c["db"]
    app.dependency_overrides[get_current_user] = lambda: c["identity"]
    app.dependency_overrides[require_development_intervention_api] = lambda: None
    return TestClient(app)


def _create_active_intervention(
    c,
    intervention_id: int = 7001,
    *,
    subject_id: int | None = None,
) -> Intervention:
    intervention = Intervention(
        intervention_id=intervention_id,
        student_id=c["student"].student_id,
        class_id=c["allowed_class"].class_id,
        subject_id=subject_id or c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        source_prediction_id=intervention_id,
        status="ACTIVE",
        diagnosis_snapshot={},
        remediation_plan={"teacher_choice": "QUIZ", "selected_resources": []},
        activated_at=datetime.now(timezone.utc),
        activated_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(intervention)
    c["db"].flush()
    return intervention


def _create_reading(
    c,
    title: str,
    *,
    subject_id: int | None = None,
) -> tuple[Classwork, ClassworkAssignment]:
    cw = Classwork(
        title=title,
        classwork_type="READING",
        is_graded=False,
        total_points=None,
        is_published=True,
        is_archived=False,
        subject_id=subject_id or c["subject"].subject_id,
        created_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(cw)
    c["db"].flush()

    assign = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=c["allowed_class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=c["owner"].staff_id,
        is_published=True,
        is_locked=False,
    )
    c["db"].add(assign)
    c["db"].flush()
    return cw, assign


def _create_remedial_quiz(
    c,
    intervention: Intervention,
    *,
    title: str = "Targeted Remedial Quiz",
) -> tuple[Classwork, ClassworkAssignment, Quiz, QuestionOption, QuizQuestion]:
    cw = Classwork(
        title=title,
        classwork_type="QUIZ",
        instructions="Remedial Quiz Instructions",
        is_graded=True,
        total_points=Decimal("10"),
        is_published=True,
        is_archived=False,
        subject_id=intervention.subject_id,
        created_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(cw)
    c["db"].flush()

    assign = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=c["allowed_class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=c["owner"].staff_id,
        is_published=True,
        recipient_student_id=c["student"].student_id,
        source_intervention_id=intervention.intervention_id,
        remediation_request_id=uuid4(),
    )
    c["db"].add(assign)
    c["db"].flush()

    quiz = Quiz(
        classwork_id=cw.classwork_id,
        total_items=1,
        status="PUBLISHED",
    )
    c["db"].add(quiz)
    c["db"].flush()

    c["db"].add(QuizSetting(classwork_id=cw.classwork_id, is_shuffle_questions=False, max_attempts=1))

    q = Question(
        question_text="What is 5 + 5?",
        question_type="MULTIPLE_CHOICE",
        points=Decimal("10"),
    )
    c["db"].add(q)
    c["db"].flush()

    opt1 = QuestionOption(question_id=q.question_id, option_text="10", is_correct=True, option_order=1)
    opt2 = QuestionOption(question_id=q.question_id, option_text="7", is_correct=False, option_order=2)
    c["db"].add_all([opt1, opt2])
    c["db"].flush()

    qq = QuizQuestion(quiz_id=quiz.quiz_id, question_id=q.question_id, display_order=1)
    c["db"].add(qq)
    c["db"].flush()
    return cw, assign, quiz, opt1, qq


def _create_remedial_classwork(
    c,
    intervention: Intervention,
    *,
    title: str = "Targeted Remedial Assignment",
) -> tuple[Classwork, ClassworkAssignment]:
    cw = Classwork(
        title=title,
        classwork_type="ASSIGNMENT",
        instructions="Submit problem solution.",
        is_graded=True,
        total_points=Decimal("100"),
        is_published=True,
        is_archived=False,
        subject_id=intervention.subject_id,
        created_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(cw)
    c["db"].flush()

    assign = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=c["allowed_class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=c["owner"].staff_id,
        is_published=True,
        recipient_student_id=c["student"].student_id,
        source_intervention_id=intervention.intervention_id,
        remediation_request_id=uuid4(),
    )
    c["db"].add(assign)
    c["db"].flush()
    return cw, assign


def _submit_ordinary_reading(
    c,
    reading_assignment: ClassworkAssignment,
    *,
    focused_seconds: int = 150,
) -> StudentSubmission:
    sub = StudentSubmission(
        classwork_assignment_id=reading_assignment.classwork_assignment_id,
        student_id=c["student"].student_id,
        status="submitted",
        attempt_count=1,
        reading_focused_seconds=focused_seconds,
        submitted_at=datetime.now(timezone.utc),
    )
    c["db"].add(sub)
    c["db"].flush()
    return sub


def test_completed_classwork_without_reviews_reports_zero_of_three_and_locked(authz_context):
    """Previously completed Classwork submissions + no intervention reviews:
    - Study Support shows completion_status=COMPLETED, review_status=NOT_REVIEWED
    - Preparation progress is 0 of 3 completed, state=NOT_STARTED
    - Remediation activity access_state=PREPARATION_REQUIRED (LOCKED)
    - All backend assessment access (read, start, submit) is denied with HTTP 403.
    """
    c = authz_context
    _act_as(c, "student", "student")
    client = _client_with_all_student_routes(c)

    intervention = _create_active_intervention(c, 7010)
    r1_cw, r1_as = _create_reading(c, "Reading 1 Foundations")
    r2_cw, r2_as = _create_reading(c, "Reading 2 Worked Examples")
    r3_cw, r3_as = _create_reading(c, "Reading 3 Practice Guide")

    q_cw, q_as, quiz, opt1, qq = _create_remedial_quiz(c, intervention, title="Remedial Quiz A")
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=q_as.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(r1_cw.classwork_id, r1_as.classwork_assignment_id, 1),
            ReadingPrerequisiteSnapshotItem(r2_cw.classwork_id, r2_as.classwork_assignment_id, 2),
            ReadingPrerequisiteSnapshotItem(r3_cw.classwork_id, r3_as.classwork_assignment_id, 3),
        ],
    )

    # Student has completed ordinary classwork for ALL 3 readings in the past
    _submit_ordinary_reading(c, r1_as, focused_seconds=120)
    _submit_ordinary_reading(c, r2_as, focused_seconds=180)
    _submit_ordinary_reading(c, r3_as, focused_seconds=200)
    c["db"].commit()

    headers = _bearer(c, "student", "student")

    # 1. Study Support API reports:
    resp = client.get("/api/v1/student/interventions", headers=headers)
    assert resp.status_code == 200
    inv_data = resp.json()["items"][0]
    act_data = inv_data["activities"][0]

    # Ordinary classwork status is COMPLETED for all 3
    assert len(act_data["readings"]) == 3
    for r in act_data["readings"]:
        assert r["completion_status"] == "COMPLETED"
        assert r["review_status"] == "NOT_REVIEWED"
        assert r["reviewed_at"] is None
        assert r["focused_seconds"] > 0
        assert r["completed_at"] is not None

    # Preparation depends on reviews: 0 of 3 completed!
    assert act_data["preparation"]["completed_count"] == 0
    assert act_data["preparation"]["required_count"] == 3
    assert act_data["preparation"]["state"] == "NOT_STARTED"
    assert act_data["preparation"]["is_satisfied"] is False
    assert act_data["preparation"]["summary"] == "0 of 3 completed"
    assert act_data["access_state"] == "PREPARATION_REQUIRED"
    assert act_data["access_enforced"] is True
    assert act_data["prerequisite_code"] == "PREPARATION_REQUIRED"

    # 2. Backend access enforcement blocks read:
    read_resp = client.get(f"/api/v1/quizzes/assignment/{q_as.classwork_assignment_id}/attempt", headers=headers)
    assert read_resp.status_code == 403
    assert read_resp.json()["detail"]["code"] == "PREPARATION_REQUIRED"
    assert read_resp.json()["detail"]["preparation"]["completed_count"] == 0

    # 3. Backend access enforcement blocks start:
    start_resp = client.post(f"/api/v1/quizzes/assignment/{q_as.classwork_assignment_id}/start", headers=headers)
    assert start_resp.status_code == 403
    assert start_resp.json()["detail"]["code"] == "PREPARATION_REQUIRED"

    # 4. Backend access enforcement blocks submit:
    submit_resp = client.post(
        f"/api/v1/quizzes/assignment/{q_as.classwork_assignment_id}/submit",
        headers=headers,
        json={"answers": [{"quiz_question_id": qq.quiz_question_id, "selected_option_id": opt1.option_id}]},
    )
    assert submit_resp.status_code == 403
    assert submit_resp.json()["detail"]["code"] == "PREPARATION_REQUIRED"


def test_partial_reviews_progression_one_and_two_of_three_remain_locked(authz_context):
    """1/3 and 2/3 reviewed -> state is IN_PROGRESS, activity remains LOCKED."""
    c = authz_context
    _act_as(c, "student", "student")
    client = _client_with_all_student_routes(c)

    intervention = _create_active_intervention(c, 7020)
    r1_cw, r1_as = _create_reading(c, "Reading 1")
    r2_cw, r2_as = _create_reading(c, "Reading 2")
    r3_cw, r3_as = _create_reading(c, "Reading 3")

    q_cw, q_as, quiz, opt1, qq = _create_remedial_quiz(c, intervention, title="Remedial Quiz B")
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=q_as.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(r1_cw.classwork_id, r1_as.classwork_assignment_id, 1),
            ReadingPrerequisiteSnapshotItem(r2_cw.classwork_id, r2_as.classwork_assignment_id, 2),
            ReadingPrerequisiteSnapshotItem(r3_cw.classwork_id, r3_as.classwork_assignment_id, 3),
        ],
    )
    c["db"].commit()

    headers = _bearer(c, "student", "student")

    # Step A: Review 1 of 3
    rev_resp1 = client.post(
        f"/api/v1/student/interventions/{intervention.intervention_id}/readings/{r1_as.classwork_assignment_id}/review",
        headers=headers,
    )
    assert rev_resp1.status_code == 200
    assert rev_resp1.json()["reading_assignment_id"] == r1_as.classwork_assignment_id

    resp1 = client.get("/api/v1/student/interventions", headers=headers)
    act1 = resp1.json()["items"][0]["activities"][0]
    assert act1["preparation"]["completed_count"] == 1
    assert act1["preparation"]["required_count"] == 3
    assert act1["preparation"]["state"] == "IN_PROGRESS"
    assert act1["preparation"]["is_satisfied"] is False
    assert act1["preparation"]["summary"] == "1 of 3 completed"
    assert act1["access_state"] == "PREPARATION_REQUIRED"
    assert act1["readings"][0]["review_status"] == "REVIEWED"
    assert act1["readings"][1]["review_status"] == "NOT_REVIEWED"
    assert act1["readings"][2]["review_status"] == "NOT_REVIEWED"

    # Backend access is still denied
    assert client.get(f"/api/v1/quizzes/assignment/{q_as.classwork_assignment_id}/attempt", headers=headers).status_code == 403
    assert client.post(f"/api/v1/quizzes/assignment/{q_as.classwork_assignment_id}/start", headers=headers).status_code == 403

    # Step B: Review 2 of 3
    rev_resp2 = client.post(
        f"/api/v1/student/interventions/{intervention.intervention_id}/readings/{r2_as.classwork_assignment_id}/review",
        headers=headers,
    )
    assert rev_resp2.status_code == 200

    resp2 = client.get("/api/v1/student/interventions", headers=headers)
    act2 = resp2.json()["items"][0]["activities"][0]
    assert act2["preparation"]["completed_count"] == 2
    assert act2["preparation"]["required_count"] == 3
    assert act2["preparation"]["state"] == "IN_PROGRESS"
    assert act2["preparation"]["is_satisfied"] is False
    assert act2["preparation"]["summary"] == "2 of 3 completed"
    assert act2["access_state"] == "PREPARATION_REQUIRED"
    assert act2["readings"][0]["review_status"] == "REVIEWED"
    assert act2["readings"][1]["review_status"] == "REVIEWED"
    assert act2["readings"][2]["review_status"] == "NOT_REVIEWED"

    # Backend access is still denied
    assert client.get(f"/api/v1/quizzes/assignment/{q_as.classwork_assignment_id}/attempt", headers=headers).status_code == 403
    assert client.post(f"/api/v1/quizzes/assignment/{q_as.classwork_assignment_id}/start", headers=headers).status_code == 403


def test_three_of_three_reviewed_unlocks_activity_and_permits_backend_access(authz_context):
    """3/3 reviewed -> state is COMPLETE, activity is READY, and backend access succeeds."""
    c = authz_context
    _act_as(c, "student", "student")
    client = _client_with_all_student_routes(c)

    intervention = _create_active_intervention(c, 7030)
    r1_cw, r1_as = _create_reading(c, "Reading 1")
    r2_cw, r2_as = _create_reading(c, "Reading 2")
    r3_cw, r3_as = _create_reading(c, "Reading 3")

    q_cw, q_as, quiz, opt1, qq = _create_remedial_quiz(c, intervention, title="Remedial Quiz C")
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=q_as.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(r1_cw.classwork_id, r1_as.classwork_assignment_id, 1),
            ReadingPrerequisiteSnapshotItem(r2_cw.classwork_id, r2_as.classwork_assignment_id, 2),
            ReadingPrerequisiteSnapshotItem(r3_cw.classwork_id, r3_as.classwork_assignment_id, 3),
        ],
    )
    c["db"].commit()

    headers = _bearer(c, "student", "student")

    # Review all 3 readings via the student API
    for r_as in (r1_as, r2_as, r3_as):
        rev = client.post(
            f"/api/v1/student/interventions/{intervention.intervention_id}/readings/{r_as.classwork_assignment_id}/review",
            headers=headers,
        )
        assert rev.status_code == 200

    # 1. Study Support shows activity is READY
    resp = client.get("/api/v1/student/interventions", headers=headers)
    act = resp.json()["items"][0]["activities"][0]
    assert act["preparation"]["completed_count"] == 3
    assert act["preparation"]["required_count"] == 3
    assert act["preparation"]["state"] == "COMPLETE"
    assert act["preparation"]["is_satisfied"] is True
    assert act["preparation"]["summary"] == "3 of 3 completed"
    assert act["access_state"] == "READY"
    assert act["access_enforced"] is True
    assert act["prerequisite_code"] == "PREPARATION_COMPLETE"
    assert all(r["review_status"] == "REVIEWED" for r in act["readings"])

    # 2. Backend access is permitted for read
    read_resp = client.get(f"/api/v1/quizzes/assignment/{q_as.classwork_assignment_id}/attempt", headers=headers)
    assert read_resp.status_code == 200
    assert "questions" in read_resp.json()

    # 3. Backend access is permitted for start
    start_resp = client.post(f"/api/v1/quizzes/assignment/{q_as.classwork_assignment_id}/start", headers=headers)
    assert start_resp.status_code == 200
    assert start_resp.json()["status"] == "pending"

    # 4. Backend access is permitted for submit
    submit_resp = client.post(
        f"/api/v1/quizzes/assignment/{q_as.classwork_assignment_id}/submit",
        headers=headers,
        json={"answers": [{"quiz_question_id": qq.quiz_question_id, "selected_option_id": opt1.option_id}]},
    )
    assert submit_resp.status_code == 200
    assert submit_resp.json()["status"] == "graded"
    assert float(submit_resp.json()["grade"]) == 10.0


def test_intervention_isolation_separate_reviews_required(authz_context):
    """Reviews in Intervention 1 do not satisfy or leak into Intervention 2."""
    c = authz_context
    _act_as(c, "student", "student")
    client = _client_with_all_student_routes(c)

    # Subject 1 and Intervention 1
    intervention_1 = _create_active_intervention(c, 7041, subject_id=c["subject"].subject_id)

    # Subject 2 and Intervention 2
    subject_2 = Subject(
        subject_name="Mathematics",
        subject_codename="MATH101",
        academic_level_id=c["subject"].academic_level_id,
        grading_template_id=c["subject"].grading_template_id,
    )
    c["db"].add(subject_2)
    c["db"].flush()
    intervention_2 = _create_active_intervention(c, 7042, subject_id=subject_2.subject_id)

    r1_cw, r1_as = _create_reading(c, "Reading Subject 1", subject_id=c["subject"].subject_id)
    r2_cw, r2_as = _create_reading(c, "Reading Subject 2", subject_id=subject_2.subject_id)

    act1_cw, act1_as, _, _, _ = _create_remedial_quiz(c, intervention_1, title="Quiz 1")
    act2_cw, act2_as, _, _, _ = _create_remedial_quiz(c, intervention_2, title="Quiz 2")

    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=act1_as.classwork_assignment_id,
        items=[ReadingPrerequisiteSnapshotItem(r1_cw.classwork_id, r1_as.classwork_assignment_id, 1)],
    )
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=act2_as.classwork_assignment_id,
        items=[ReadingPrerequisiteSnapshotItem(r2_cw.classwork_id, r2_as.classwork_assignment_id, 1)],
    )
    c["db"].commit()

    headers = _bearer(c, "student", "student")

    # Review reading under Intervention 1 only
    rev1 = client.post(
        f"/api/v1/student/interventions/{intervention_1.intervention_id}/readings/{r1_as.classwork_assignment_id}/review",
        headers=headers,
    )
    assert rev1.status_code == 200

    # Query both interventions
    resp = client.get("/api/v1/student/interventions", headers=headers)
    assert resp.status_code == 200
    items = resp.json()["items"]
    data1 = next(it for it in items if it["intervention_id"] == intervention_1.intervention_id)
    data2 = next(it for it in items if it["intervention_id"] == intervention_2.intervention_id)

    # Intervention 1 is READY
    assert data1["activities"][0]["access_state"] == "READY"
    assert data1["activities"][0]["preparation"]["completed_count"] == 1
    assert data1["activities"][0]["preparation"]["is_satisfied"] is True

    # Intervention 2 is STILL LOCKED (0 of 1)
    assert data2["activities"][0]["access_state"] == "PREPARATION_REQUIRED"
    assert data2["activities"][0]["preparation"]["completed_count"] == 0
    assert data2["activities"][0]["preparation"]["is_satisfied"] is False

    # Backend access to Activity 1 is allowed
    assert client.get(f"/api/v1/quizzes/assignment/{act1_as.classwork_assignment_id}/attempt", headers=headers).status_code == 200

    # Backend access to Activity 2 is blocked
    assert client.get(f"/api/v1/quizzes/assignment/{act2_as.classwork_assignment_id}/attempt", headers=headers).status_code == 403


def test_ordinary_classwork_submissions_and_grades_remain_unchanged(authz_context):
    """Ordinary Classwork submissions and grades are never reset or altered by reviews."""
    c = authz_context
    _act_as(c, "student", "student")
    client = _client_with_all_student_routes(c)

    intervention = _create_active_intervention(c, 7050)
    r1_cw, r1_as = _create_reading(c, "Reading with Focus and Submission")

    act_cw, act_as, quiz, opt1, qq = _create_remedial_quiz(c, intervention, title="Remedial Quiz")
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=act_as.classwork_assignment_id,
        items=[ReadingPrerequisiteSnapshotItem(r1_cw.classwork_id, r1_as.classwork_assignment_id, 1)],
    )

    # Student has submitted reading work with focus telemetry
    original_sub = _submit_ordinary_reading(c, r1_as, focused_seconds=360)
    orig_time = original_sub.submitted_at
    c["db"].commit()

    headers = _bearer(c, "student", "student")

    # Acknowledge review
    client.post(
        f"/api/v1/student/interventions/{intervention.intervention_id}/readings/{r1_as.classwork_assignment_id}/review",
        headers=headers,
    )

    # Verify that the StudentSubmission record was completely preserved
    sub = c["db"].get(StudentSubmission, original_sub.submission_id)
    assert sub is not None
    assert sub.status == "submitted"
    assert sub.reading_focused_seconds == 360
    assert (sub.submitted_at.replace(tzinfo=timezone.utc) if sub.submitted_at.tzinfo is None else sub.submitted_at) == orig_time

    # Study Support displays both the ordinary history and the review
    resp = client.get("/api/v1/student/interventions", headers=headers)
    act = resp.json()["items"][0]["activities"][0]
    reading_item = act["readings"][0]
    assert reading_item["completion_status"] == "COMPLETED"
    assert reading_item["focused_seconds"] == 360
    assert reading_item["review_status"] == "REVIEWED"
    assert reading_item["reviewed_at"] is not None


def test_study_support_progress_matches_backend_access_enforcement(authz_context):
    """Study Support access_state and backend endpoint authorization are in 1:1 agreement."""
    c = authz_context
    _act_as(c, "student", "student")
    client = _client_with_all_student_routes(c)

    intervention = _create_active_intervention(c, 7060)
    r1_cw, r1_as = _create_reading(c, "Reading 1")
    cw, cw_as = _create_remedial_classwork(c, intervention, title="Remedial Assignment")

    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=cw_as.classwork_assignment_id,
        items=[ReadingPrerequisiteSnapshotItem(r1_cw.classwork_id, r1_as.classwork_assignment_id, 1)],
    )
    c["db"].commit()

    headers = _bearer(c, "student", "student")

    # State 1: Locked
    support_data = client.get("/api/v1/student/interventions", headers=headers).json()
    act = support_data["items"][0]["activities"][0]
    assert act["access_state"] == "PREPARATION_REQUIRED"

    # Direct detail access is 403
    assert client.get(f"/api/v1/classwork-assignments/assignment/{cw_as.classwork_assignment_id}").status_code == 403

    # Direct file submission is 403
    submit_fail = client.post(
        f"/api/v1/submissions/assignment/{cw_as.classwork_assignment_id}/submit",
        headers=headers,
        files=[("files", ("test.pdf", b"%PDF-1.4 solution content", "application/pdf"))],
    )
    assert submit_fail.status_code == 403

    # State 2: Unlocked via review
    client.post(
        f"/api/v1/student/interventions/{intervention.intervention_id}/readings/{r1_as.classwork_assignment_id}/review",
        headers=headers,
    )

    support_data2 = client.get("/api/v1/student/interventions", headers=headers).json()
    act2 = support_data2["items"][0]["activities"][0]
    assert act2["access_state"] == "READY"

    # Direct detail access is 200
    detail_resp = client.get(f"/api/v1/classwork-assignments/assignment/{cw_as.classwork_assignment_id}")
    assert detail_resp.status_code == 200
    assert "Submit problem solution." in detail_resp.json()["instructions"]

    # Direct file submission is 200
    submit_ok = client.post(
        f"/api/v1/submissions/assignment/{cw_as.classwork_assignment_id}/submit",
        headers=headers,
        files=[("files", ("test.pdf", b"%PDF-1.4 solution content", "application/pdf"))],
    )
    assert submit_ok.status_code == 200
    assert submit_ok.json()["status"] == "submitted"
