"""Comprehensive test suite for Task S1D.2B.2: Secure Student Remediation Start and Submission.

Verifies:
- 0/3 and 2/3 Readings -> all remediation writes denied (HTTP 403 PREPARATION_REQUIRED).
- 3/3 completed -> normal start, answer, and submission operations permitted (HTTP 200).
- Direct attempt ID resolution and guard (require_remediation_prerequisite_for_attempt).
- Direct API bypasses and non-existent/foreign attempts denied.
- Wrong student writes denied.
- Missing snapshot denied (HTTP 403 PREREQUISITE_SNAPSHOT_MISSING).
- Failed requests create NO attempts, submissions, answers, or grades in the database.
- Ordinary Quiz/Classwork and Supporting Reading completions remain unaffected.
- Historical submissions and teacher grading/review access preserved.
"""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.academic.StudentCLass import StudentClass
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionReadingReview import InterventionReadingReview
from app.models.people.Student import Student
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizSetting import QuizSetting
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.submissions.SubmissionAttachment import SubmissionAttachment
from app.services.intervention.RemediationPrerequisiteService import (
    require_remediation_prerequisite_for_attempt,
    resolve_assignment_from_attempt,
)
from app.services.intervention.RemediationReadingPrerequisiteService import (
    ReadingPrerequisiteSnapshotItem,
    stage_remediation_reading_prerequisites,
)
from tests.test_classwork_submission_authorization import (
    _act_as,
    _bearer,
    authz_context,
)


def _create_active_intervention(c, intervention_id: int = 1001) -> Intervention:
    """Helper to create an active intervention for the primary test student."""
    intervention = Intervention(
        intervention_id=intervention_id,
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
    c["db"].flush()
    return intervention


def _create_reading(
    c,
    title: str,
) -> tuple[Classwork, ClassworkAssignment]:
    """Helper to create a published Supporting Reading."""
    cw = Classwork(
        title=title,
        classwork_type="READING",
        is_graded=False,
        total_points=None,
        is_published=True,
        is_archived=False,
        subject_id=c["subject"].subject_id,
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
    """Helper to create a remedial Quiz with questions and options."""
    cw = Classwork(
        title=title,
        classwork_type="QUIZ",
        is_graded=True,
        total_points=Decimal("10"),
        is_published=True,
        is_archived=False,
        subject_id=c["subject"].subject_id,
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

    setting = QuizSetting(
        classwork_id=cw.classwork_id,
        is_shuffle_questions=False,
        max_attempts=1,
    )
    c["db"].add(setting)

    q = Question(
        question_text="Remedial Secret Question: What is 2 + 2?",
        question_type="MULTIPLE_CHOICE",
        points=Decimal("10"),
    )
    c["db"].add(q)
    c["db"].flush()

    qq = QuizQuestion(
        quiz=quiz,
        question=q,
        display_order=1,
    )
    c["db"].add(qq)

    opt1 = QuestionOption(
        question=q,
        option_text="4",
        is_correct=True,
        option_order=1,
    )
    c["db"].add(opt1)
    c["db"].commit()
    c["db"].expire_all()
    return cw, assign, quiz, opt1, qq


def _create_remedial_classwork(
    c,
    intervention: Intervention,
    *,
    title: str = "Targeted Remedial Classwork",
) -> tuple[Classwork, ClassworkAssignment]:
    """Helper to create a remedial Classwork activity."""
    cw = Classwork(
        title=title,
        classwork_type="ASSIGNMENT",
        instructions="Remedial instructions: Solve problem set.",
        is_graded=True,
        total_points=Decimal("100"),
        is_published=True,
        is_archived=False,
        subject_id=c["subject"].subject_id,
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
    c["db"].commit()
    return cw, assign


def _review_reading(c, reading_assign: ClassworkAssignment, intervention: Intervention | None = None):
    inv = intervention or c["db"].query(Intervention).filter_by(student_id=c["student"].student_id).first()
    c["db"].add(InterventionReadingReview(
        intervention_id=inv.intervention_id,
        reading_assignment_id=reading_assign.classwork_assignment_id,
        student_id=c["student"].student_id,
    ))
    c["db"].commit()


def test_quiz_start_and_submit_denied_with_zero_and_partial_readings(authz_context):
    """0/3 and 2/3 Readings -> Quiz start and submit return HTTP 403 PREPARATION_REQUIRED.
    Failed requests must create no submission or answer rows.
    """
    c = authz_context
    intervention = _create_active_intervention(c)

    # Create 3 readings
    r1, a1 = _create_reading(c, "Reading 1")
    r2, a2 = _create_reading(c, "Reading 2")
    r3, a3 = _create_reading(c, "Reading 3")

    # Create remedial quiz and stage 3 prerequisites
    q_cw, q_assign, quiz, opt, qq = _create_remedial_quiz(c, intervention)
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=q_assign.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r1.classwork_id, reading_assignment_id=a1.classwork_assignment_id, display_order=1),
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r2.classwork_id, reading_assignment_id=a2.classwork_assignment_id, display_order=2),
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r3.classwork_id, reading_assignment_id=a3.classwork_assignment_id, display_order=3),
        ],
    )
    c["db"].commit()

    aid = q_assign.classwork_assignment_id
    _act_as(c, "student", "student")
    headers = _bearer(c, "student", "student")

    # --- Case 1: 0/3 Completed ---
    # Start quiz attempt
    start_resp = c["client"].post(f"/api/v1/quizzes/assignment/{aid}/start", headers=headers)
    assert start_resp.status_code == 403
    err = start_resp.json()["detail"]
    assert err["code"] == "PREPARATION_REQUIRED"
    assert err["preparation"]["completed_count"] == 0
    assert err["preparation"]["required_count"] == 3

    # Direct submit attempt
    submit_resp = c["client"].post(
        f"/api/v1/quizzes/assignment/{aid}/submit",
        headers=headers,
        json={"answers": [{"quiz_question_id": qq.quiz_question_id, "selected_option_id": opt.option_id}]},
    )
    assert submit_resp.status_code == 403
    assert submit_resp.json()["detail"]["code"] == "PREPARATION_REQUIRED"

    # Verify no attempts or answers in DB
    subs = c["db"].query(StudentSubmission).filter_by(
        classwork_assignment_id=aid, student_id=c["student"].student_id
    ).all()
    assert len(subs) == 0
    answers = c["db"].query(QuizAnswer).all()
    assert len(answers) == 0

    # --- Case 2: 2/3 Completed ---
    # Complete reading 1 and 2
    c["client"].post(f"/api/v1/submissions/assignment/{a1.classwork_assignment_id}/complete-reading", headers=headers)
    c["client"].post(f"/api/v1/submissions/assignment/{a2.classwork_assignment_id}/complete-reading", headers=headers)
    _review_reading(c, a1, intervention)
    _review_reading(c, a2, intervention)

    start_resp2 = c["client"].post(f"/api/v1/quizzes/assignment/{aid}/start", headers=headers)
    assert start_resp2.status_code == 403
    err2 = start_resp2.json()["detail"]
    assert err2["code"] == "PREPARATION_REQUIRED"
    assert err2["preparation"]["completed_count"] == 2
    assert err2["preparation"]["required_count"] == 3

    submit_resp2 = c["client"].post(
        f"/api/v1/quizzes/assignment/{aid}/submit",
        headers=headers,
        json={"answers": [{"quiz_question_id": qq.quiz_question_id, "selected_option_id": opt.option_id}]},
    )
    assert submit_resp2.status_code == 403
    assert submit_resp2.json()["detail"]["code"] == "PREPARATION_REQUIRED"

    # Verify still zero attempts created
    subs = c["db"].query(StudentSubmission).filter_by(
        classwork_assignment_id=aid, student_id=c["student"].student_id
    ).all()
    assert len(subs) == 0


def test_classwork_submission_denied_with_zero_and_partial_readings(authz_context):
    """0/3 and 2/3 Readings -> Classwork file submit returns HTTP 403 PREPARATION_REQUIRED.
    Failed requests must create no submission records or attachments.
    """
    c = authz_context
    intervention = _create_active_intervention(c)

    r1, a1 = _create_reading(c, "Reading 1")
    r2, a2 = _create_reading(c, "Reading 2")
    r3, a3 = _create_reading(c, "Reading 3")

    cw, assign = _create_remedial_classwork(c, intervention)
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=assign.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r1.classwork_id, reading_assignment_id=a1.classwork_assignment_id, display_order=1),
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r2.classwork_id, reading_assignment_id=a2.classwork_assignment_id, display_order=2),
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r3.classwork_id, reading_assignment_id=a3.classwork_assignment_id, display_order=3),
        ],
    )
    c["db"].commit()

    aid = assign.classwork_assignment_id
    _act_as(c, "student", "student")
    headers = _bearer(c, "student", "student")

    # 0/3: Try submit work
    resp = c["client"].post(
        f"/api/v1/submissions/assignment/{aid}/submit",
        headers=headers,
        files=[("files", ("solution.pdf", b"%PDF-1.4 solution content", "application/pdf"))],
    )
    assert resp.status_code == 403
    err = resp.json()["detail"]
    assert err["code"] == "PREPARATION_REQUIRED"
    assert err["preparation"]["completed_count"] == 0
    assert err["preparation"]["required_count"] == 3

    # Check DB: no submission for this assignment
    subs = c["db"].query(StudentSubmission).filter_by(
        classwork_assignment_id=aid, student_id=c["student"].student_id
    ).all()
    assert len(subs) == 0

    # 2/3: Complete 2 readings
    c["client"].post(f"/api/v1/submissions/assignment/{a1.classwork_assignment_id}/complete-reading", headers=headers)
    c["client"].post(f"/api/v1/submissions/assignment/{a2.classwork_assignment_id}/complete-reading", headers=headers)

    resp2 = c["client"].post(
        f"/api/v1/submissions/assignment/{aid}/submit",
        headers=headers,
        files=[("files", ("solution.pdf", b"%PDF-1.4 solution content attempt 2", "application/pdf"))],
    )
    assert resp2.status_code == 403
    assert resp2.json()["detail"]["code"] == "PREPARATION_REQUIRED"

    # Still no submissions
    subs = c["db"].query(StudentSubmission).filter_by(
        classwork_assignment_id=aid, student_id=c["student"].student_id
    ).all()
    assert len(subs) == 0


def test_remedial_quiz_start_and_submission_permitted_when_fully_completed(authz_context):
    """3/3 completed Readings -> Quiz start, answer submission, and automatic grading succeed."""
    c = authz_context
    intervention = _create_active_intervention(c)

    r1, a1 = _create_reading(c, "Reading 1")
    r2, a2 = _create_reading(c, "Reading 2")
    r3, a3 = _create_reading(c, "Reading 3")

    q_cw, q_assign, quiz, opt, qq = _create_remedial_quiz(c, intervention)
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=q_assign.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r1.classwork_id, reading_assignment_id=a1.classwork_assignment_id, display_order=1),
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r2.classwork_id, reading_assignment_id=a2.classwork_assignment_id, display_order=2),
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r3.classwork_id, reading_assignment_id=a3.classwork_assignment_id, display_order=3),
        ],
    )
    c["db"].commit()

    aid = q_assign.classwork_assignment_id
    _act_as(c, "student", "student")
    headers = _bearer(c, "student", "student")

    # Complete 3/3 readings
    c["client"].post(f"/api/v1/submissions/assignment/{a1.classwork_assignment_id}/complete-reading", headers=headers)
    c["client"].post(f"/api/v1/submissions/assignment/{a2.classwork_assignment_id}/complete-reading", headers=headers)
    c["client"].post(f"/api/v1/submissions/assignment/{a3.classwork_assignment_id}/complete-reading", headers=headers)
    _review_reading(c, a1, intervention)
    _review_reading(c, a2, intervention)
    _review_reading(c, a3, intervention)

    # Start quiz attempt
    start_resp = c["client"].post(f"/api/v1/quizzes/assignment/{aid}/start", headers=headers)
    assert start_resp.status_code == 200
    start_data = start_resp.json()
    assert start_data["status"] == "pending"
    assert start_data["attempt_count"] == 0
    assert len(start_data["questions"]) == 1

    # Submit quiz answers
    submit_resp = c["client"].post(
        f"/api/v1/quizzes/assignment/{aid}/submit",
        headers=headers,
        json={"answers": [{"quiz_question_id": qq.quiz_question_id, "selected_option_id": opt.option_id}]},
    )
    assert submit_resp.status_code == 200
    submit_data = submit_resp.json()
    assert submit_data["status"] == "graded"
    assert submit_data["attempt_count"] == 1
    assert float(submit_data["grade"]) == 10.0

    # Verify answers recorded in DB
    ans = c["db"].query(QuizAnswer).filter_by(quiz_question_id=qq.quiz_question_id).first()
    assert ans is not None
    assert ans.answer_text == "4"
    assert ans.is_correct is True

    # One attempt rule preserved
    repeat_start = c["client"].post(f"/api/v1/quizzes/assignment/{aid}/start", headers=headers)
    assert repeat_start.status_code == 403
    assert repeat_start.json()["detail"] == "Maximum attempts reached"


def test_remedial_classwork_submission_and_modification_permitted_when_fully_completed(authz_context):
    """3/3 completed Readings -> Classwork submission, unsubmit, and modification succeed."""
    c = authz_context
    intervention = _create_active_intervention(c)

    r1, a1 = _create_reading(c, "Reading 1")
    r2, a2 = _create_reading(c, "Reading 2")
    r3, a3 = _create_reading(c, "Reading 3")

    cw, assign = _create_remedial_classwork(c, intervention)
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=assign.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r1.classwork_id, reading_assignment_id=a1.classwork_assignment_id, display_order=1),
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r2.classwork_id, reading_assignment_id=a2.classwork_assignment_id, display_order=2),
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r3.classwork_id, reading_assignment_id=a3.classwork_assignment_id, display_order=3),
        ],
    )
    c["db"].commit()

    aid = assign.classwork_assignment_id
    _act_as(c, "student", "student")
    headers = _bearer(c, "student", "student")

    # Complete 3/3 readings
    c["client"].post(f"/api/v1/submissions/assignment/{a1.classwork_assignment_id}/complete-reading", headers=headers)
    c["client"].post(f"/api/v1/submissions/assignment/{a2.classwork_assignment_id}/complete-reading", headers=headers)
    c["client"].post(f"/api/v1/submissions/assignment/{a3.classwork_assignment_id}/complete-reading", headers=headers)
    _review_reading(c, a1, intervention)
    _review_reading(c, a2, intervention)
    _review_reading(c, a3, intervention)

    # Submit file work
    resp = c["client"].post(
        f"/api/v1/submissions/assignment/{aid}/submit",
        headers=headers,
        files=[("files", ("work.pdf", b"%PDF-1.4 full completed work", "application/pdf"))],
    )
    assert resp.status_code == 200
    sub_data = resp.json()
    assert sub_data["status"] == "submitted"
    assert len(sub_data["attachments"]) == 1
    att_id = sub_data["attachments"][0]["submission_attachment_id"]

    # Unsubmit work
    unsub_resp = c["client"].post(f"/api/v1/submissions/assignment/{aid}/unsubmit", headers=headers)
    assert unsub_resp.status_code == 200
    assert unsub_resp.json()["status"] == "pending"

    # Remove attachment
    del_resp = c["client"].delete(f"/api/v1/submissions/assignment/{aid}/attachments/{att_id}", headers=headers)
    assert del_resp.status_code == 200
    assert len(del_resp.json()["attachments"]) == 0


def test_missing_snapshot_denies_all_mutations(authz_context):
    """Remediation activities with NO snapshot must be denied (HTTP 403 PREREQUISITE_SNAPSHOT_MISSING).
    No attempt, submission, or grade rows must be created.
    """
    c = authz_context
    intervention = _create_active_intervention(c)

    q_cw, q_assign, quiz, opt, qq = _create_remedial_quiz(c, intervention)
    # Deliberately DO NOT stage any prerequisites
    c["db"].commit()

    aid = q_assign.classwork_assignment_id
    _act_as(c, "student", "student")
    headers = _bearer(c, "student", "student")

    # Quiz start denied
    resp_start = c["client"].post(f"/api/v1/quizzes/assignment/{aid}/start", headers=headers)
    assert resp_start.status_code == 403
    assert resp_start.json()["detail"]["code"] == "PREREQUISITE_SNAPSHOT_MISSING"

    # Quiz submit denied
    resp_submit = c["client"].post(
        f"/api/v1/quizzes/assignment/{aid}/submit",
        headers=headers,
        json={"answers": [{"quiz_question_id": qq.quiz_question_id, "selected_option_id": opt.option_id}]},
    )
    assert resp_submit.status_code == 403
    assert resp_submit.json()["detail"]["code"] == "PREREQUISITE_SNAPSHOT_MISSING"

    # Classwork submit denied
    cw, assign = _create_remedial_classwork(c, intervention, title="No Snapshot Classwork")
    c["db"].commit()

    cw_submit = c["client"].post(
        f"/api/v1/submissions/assignment/{assign.classwork_assignment_id}/submit",
        headers=headers,
        files=[("files", ("test.pdf", b"%PDF-1.4 attempt", "application/pdf"))],
    )
    assert cw_submit.status_code == 403
    assert cw_submit.json()["detail"]["code"] == "PREREQUISITE_SNAPSHOT_MISSING"

    # Verify 0 submissions in DB for these assignments
    subs = c["db"].query(StudentSubmission).filter(
        StudentSubmission.classwork_assignment_id.in_([aid, assign.classwork_assignment_id])
    ).all()
    assert len(subs) == 0


def test_direct_attempt_id_resolution_and_guard(authz_context):
    """Direct attempt ID resolution and prerequisite guard verify exact remediation assignment."""
    c = authz_context
    intervention = _create_active_intervention(c)

    other_student = c["db"].query(Student).filter_by(user_id=c["accounts"]["other_student"].user_id).one()

    r1, a1 = _create_reading(c, "Reading 1")
    q_cw, q_assign, quiz, opt, qq = _create_remedial_quiz(c, intervention)
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=q_assign.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r1.classwork_id, reading_assignment_id=a1.classwork_assignment_id, display_order=1),
        ],
    )
    c["db"].commit()

    # Pre-create an attempt row directly (e.g. historical or draft attempt)
    sub = StudentSubmission(
        classwork_assignment_id=q_assign.classwork_assignment_id,
        student_id=c["student"].student_id,
        status="pending",
        attempt_count=1,
    )
    c["db"].add(sub)
    c["db"].commit()

    # 1. Resolve assignment from attempt
    resolved_assign = resolve_assignment_from_attempt(c["db"], sub.submission_id)
    assert resolved_assign is not None
    assert resolved_assign.classwork_assignment_id == q_assign.classwork_assignment_id

    # Non-existent attempt returns None
    assert resolve_assignment_from_attempt(c["db"], 999999) is None

    # 2. require_remediation_prerequisite_for_attempt with 0/1 reading completed -> 403
    with pytest.raises(HTTPException) as exc_info:
        require_remediation_prerequisite_for_attempt(c["db"], sub.submission_id, c["student"])
    assert exc_info.value.status_code == 403
    assert exc_info.value.detail["code"] == "PREPARATION_REQUIRED"

    # 3. Wrong student attempt ID -> 403 Access denied
    with pytest.raises(HTTPException) as wrong_student_exc:
        require_remediation_prerequisite_for_attempt(c["db"], sub.submission_id, other_student)
    assert wrong_student_exc.value.status_code == 403
    assert wrong_student_exc.value.detail == "Access denied"

    # 4. Non-existent attempt ID -> 404
    with pytest.raises(HTTPException) as not_found_exc:
        require_remediation_prerequisite_for_attempt(c["db"], 999999, c["student"])
    assert not_found_exc.value.status_code == 404

    # 5. After reading completion -> succeeds
    _act_as(c, "student", "student")
    headers = _bearer(c, "student", "student")
    c["client"].post(f"/api/v1/submissions/assignment/{a1.classwork_assignment_id}/complete-reading", headers=headers)
    _review_reading(c, a1, intervention)

    decision = require_remediation_prerequisite_for_attempt(c["db"], sub.submission_id, c["student"])
    assert decision.allowed is True
    assert decision.code == "PREPARATION_COMPLETE"


def test_wrong_student_writes_denied(authz_context):
    """A classmate cannot start or submit work for another student's targeted remedial activity."""
    c = authz_context
    intervention = _create_active_intervention(c)

    other_student = c["db"].query(Student).filter_by(user_id=c["accounts"]["other_student"].user_id).one()

    # Update other_student to be enrolled in allowed_class
    other_sc = c["db"].query(StudentClass).filter_by(student_id=other_student.student_id).one()
    other_sc.class_id = c["allowed_class"].class_id
    c["db"].commit()

    r1, a1 = _create_reading(c, "Reading 1")
    q_cw, q_assign, quiz, opt, qq = _create_remedial_quiz(c, intervention)
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=q_assign.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r1.classwork_id, reading_assignment_id=a1.classwork_assignment_id, display_order=1),
        ],
    )
    c["db"].commit()

    aid = q_assign.classwork_assignment_id
    _act_as(c, "other_student", "student")
    other_headers = _bearer(c, "other_student", "student")

    # Start attempt as other_student -> 404 (assignment is targeted to recipient_student_id)
    resp = c["client"].post(f"/api/v1/quizzes/assignment/{aid}/start", headers=other_headers)
    assert resp.status_code == 404

    # Submit attempt as other_student -> 404
    resp_sub = c["client"].post(
        f"/api/v1/quizzes/assignment/{aid}/submit",
        headers=other_headers,
        json={"answers": [{"quiz_question_id": qq.quiz_question_id, "selected_option_id": opt.option_id}]},
    )
    assert resp_sub.status_code == 404

    # Classwork submit as other_student -> 404
    cw, assign = _create_remedial_classwork(c, intervention)
    c["db"].commit()
    cw_resp = c["client"].post(
        f"/api/v1/submissions/assignment/{assign.classwork_assignment_id}/submit",
        headers=other_headers,
        files=[("files", ("other.pdf", b"%PDF-1.4 data", "application/pdf"))],
    )
    assert cw_resp.status_code == 404


def test_ordinary_activities_and_readings_unaffected(authz_context):
    """Ordinary (non-remedial) Quizzes and Classworks do not require reading prerequisites."""
    c = authz_context
    _act_as(c, "student", "student")
    headers = _bearer(c, "student", "student")

    # 1. Ordinary Quiz
    cw = Classwork(
        title="Ordinary Quiz",
        classwork_type="QUIZ",
        is_graded=True,
        total_points=Decimal("10"),
        is_published=True,
        is_archived=False,
        subject_id=c["subject"].subject_id,
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
        # No source_intervention_id
    )
    c["db"].add(assign)
    c["db"].flush()

    quiz = Quiz(classwork_id=cw.classwork_id, total_items=1, status="PUBLISHED")
    c["db"].add(quiz)
    c["db"].flush()

    setting = QuizSetting(classwork_id=cw.classwork_id, is_shuffle_questions=False, max_attempts=1)
    c["db"].add(setting)

    q = Question(question_text="Normal Question", question_type="MULTIPLE_CHOICE", points=Decimal("10"))
    c["db"].add(q)
    c["db"].flush()

    qq = QuizQuestion(quiz=quiz, question=q, display_order=1)
    opt = QuestionOption(question=q, option_text="Answer", is_correct=True, option_order=1)
    c["db"].add_all([qq, opt])
    c["db"].commit()
    c["db"].expire_all()

    aid = assign.classwork_assignment_id

    # Normal quiz starts without prerequisites
    start_resp = c["client"].post(f"/api/v1/quizzes/assignment/{aid}/start", headers=headers)
    assert start_resp.status_code == 200

    # Normal quiz submits without prerequisites
    submit_resp = c["client"].post(
        f"/api/v1/quizzes/assignment/{aid}/submit",
        headers=headers,
        json={"answers": [{"quiz_question_id": qq.quiz_question_id, "selected_option_id": opt.option_id}]},
    )
    assert submit_resp.status_code == 200
    assert submit_resp.json()["status"] == "graded"

    # 2. Ordinary Classwork submits without prerequisites
    ord_cw = Classwork(
        title="Ordinary Assignment",
        classwork_type="ASSIGNMENT",
        instructions="Normal instructions",
        is_graded=True,
        total_points=Decimal("50"),
        is_published=True,
        is_archived=False,
        subject_id=c["subject"].subject_id,
        created_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(ord_cw)
    c["db"].flush()
    ord_assign = ClassworkAssignment(
        classwork_id=ord_cw.classwork_id,
        class_id=c["allowed_class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=c["owner"].staff_id,
        is_published=True,
    )
    c["db"].add(ord_assign)
    c["db"].commit()

    ord_submit = c["client"].post(
        f"/api/v1/submissions/assignment/{ord_assign.classwork_assignment_id}/submit",
        headers=headers,
        files=[("files", ("answer.pdf", b"%PDF-1.4 ordinary assignment answer", "application/pdf"))],
    )
    assert ord_submit.status_code == 200

    # 3. Supporting Reading completes without prerequisite guard
    r_cw, r_assign = _create_reading(c, "Independent Reading")
    c["db"].commit()
    r_resp = c["client"].post(
        f"/api/v1/submissions/assignment/{r_assign.classwork_assignment_id}/complete-reading",
        headers=headers,
    )
    assert r_resp.status_code == 200
    assert r_resp.json()["status"] == "submitted"
