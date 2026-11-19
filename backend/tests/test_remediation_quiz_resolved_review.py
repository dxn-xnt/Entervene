"""Regression tests for remediation quiz submit, auto-resolution, and read-only review."""

from datetime import datetime, timezone
from decimal import Decimal

from app.models.intervention.Intervention import Intervention
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention.RemediationReadingPrerequisiteService import (
    ReadingPrerequisiteSnapshotItem,
    stage_remediation_reading_prerequisites,
)
from tests.test_classwork_submission_authorization import _act_as, authz_context
from tests.test_remediation_read_access_guard import (
    _complete_reading,
    _create_active_intervention,
    _create_reading,
    _create_remedial_classwork,
    _create_remedial_quiz,
)


def _setup_two_question_remedial_quiz(c, intervention_id: int = 3101):
    """Build a 10-point remediation quiz (7 + 3 points) with 1 reviewed reading."""
    intervention = _create_active_intervention(c, intervention_id)
    reading_cw, reading_as, _ = _create_reading(c, "Required Algebra Reading")
    quiz_cw, quiz_as, quiz = _create_remedial_quiz(c, intervention, title="Remediation Quiz 1")

    # Adjust first question to 7 points and add a 3-point second question (total 10).
    first_link = c["db"].query(QuizQuestion).filter_by(quiz_id=quiz.quiz_id).one()
    first_q = first_link.question
    first_q.points = Decimal("7")
    first_opt_correct = (
        c["db"].query(QuestionOption).filter_by(question_id=first_q.question_id).one()
    )

    second_q = Question(
        question_text="Remedial Q2: What is 3 * 3?",
        question_type="MULTIPLE_CHOICE",
        points=Decimal("3"),
    )
    c["db"].add(second_q)
    c["db"].flush()
    second_link = QuizQuestion(
        quiz_id=quiz.quiz_id,
        question_id=second_q.question_id,
        display_order=2,
    )
    c["db"].add(second_link)
    second_opt_correct = QuestionOption(
        question_id=second_q.question_id,
        option_text="9",
        is_correct=True,
        option_order=1,
    )
    second_opt_wrong = QuestionOption(
        question_id=second_q.question_id,
        option_text="6",
        is_correct=False,
        option_order=2,
    )
    c["db"].add_all([second_opt_correct, second_opt_wrong])
    quiz.total_items = 2

    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=quiz_as.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(
                reading_classwork_id=reading_cw.classwork_id,
                reading_assignment_id=reading_as.classwork_assignment_id,
                display_order=1,
            ),
        ],
    )
    _complete_reading(c, reading_as)
    c["db"].commit()
    return {
        "intervention": intervention,
        "quiz_cw": quiz_cw,
        "quiz_as": quiz_as,
        "first_link": first_link,
        "first_opt_correct": first_opt_correct,
        "second_link": second_link,
        "second_opt_wrong": second_opt_wrong,
    }


def test_remediation_quiz_submit_resolution_allows_result_and_classwork_review_but_blocks_retake(
    authz_context,
    monkeypatch,
):
    c = authz_context
    db = c["db"]
    setup = _setup_two_question_remedial_quiz(c, intervention_id=3101)
    intervention_id = setup["intervention"].intervention_id
    aid = setup["quiz_as"].classwork_assignment_id
    cw_id = setup["quiz_cw"].classwork_id

    # Simulate prediction refresh resolving the intervention upon grade commit.
    def resolve_on_grade_refresh(_bind, **_kwargs):
        row = db.get(Intervention, intervention_id)
        row.status = "RESOLVED"
        row.resolution_reason = "IMPROVED_PREDICTION"
        row.resolved_at = datetime.now(timezone.utc)
        db.commit()

    monkeypatch.setattr(
        "app.services.quiz.QuizAttemptService.refresh_after_committed_grade_change",
        resolve_on_grade_refresh,
    )
    monkeypatch.setattr(
        "app.services.submission.SubmissionFeedbackService.dispatch_background_draft_processing",
        lambda: None,
    )

    _act_as(c, "student", "student")

    start_resp = c["client"].post(f"/api/v1/quizzes/assignment/{aid}/start")
    assert start_resp.status_code == 200
    assert start_resp.json()["status"] == "pending"

    submit_payload = {
        "answers": [
            {
                "quiz_question_id": setup["first_link"].quiz_question_id,
                "selected_option_id": setup["first_opt_correct"].option_id,
            },
            {
                "quiz_question_id": setup["second_link"].quiz_question_id,
                "selected_option_id": setup["second_opt_wrong"].option_id,
            },
        ]
    }
    submit_resp = c["client"].post(
        f"/api/v1/quizzes/assignment/{aid}/submit",
        json=submit_payload,
    )
    assert submit_resp.status_code == 200, submit_resp.text
    submit_body = submit_resp.json()
    assert submit_body["status"] == "graded"
    assert submit_body["grade"] == 7.0
    assert submit_body["attempt_count"] == 1
    assert submit_body["can_submit"] is False

    # Verify intervention actually transitioned to RESOLVED.
    db.expire_all()
    assert db.get(Intervention, intervention_id).status == "RESOLVED"

    # Immediately fetching quiz attempt result must succeed (200) for read-only review.
    attempt_resp = c["client"].get(f"/api/v1/quizzes/assignment/{aid}/attempt")
    assert attempt_resp.status_code == 200, attempt_resp.text
    attempt_body = attempt_resp.json()
    assert attempt_body["status"] == "graded"
    assert attempt_body["grade"] == 7.0
    assert attempt_body["total_points"] == 10.0
    assert attempt_body["can_submit"] is False
    assert attempt_body["summary_available"] is True
    assert len(attempt_body["questions"]) == 2

    # Navigating back to Study Support classwork detail must also succeed (200).
    assign_resp = c["client"].get(f"/api/v1/classwork-assignments/assignment/{aid}")
    assert assign_resp.status_code == 200, assign_resp.text
    assert assign_resp.json()["classwork_assignment_id"] == aid

    cw_resp = c["client"].get(f"/api/v1/classwork-assignments/classwork/{cw_id}")
    assert cw_resp.status_code == 200, cw_resp.text

    # Retakes and duplicate submissions must remain strictly blocked (403).
    retake_resp = c["client"].post(f"/api/v1/quizzes/assignment/{aid}/start")
    assert retake_resp.status_code == 403
    assert retake_resp.json()["detail"]["code"] == "INTERVENTION_NOT_ACTIVE"

    dup_submit_resp = c["client"].post(
        f"/api/v1/quizzes/assignment/{aid}/submit",
        json=submit_payload,
    )
    assert dup_submit_resp.status_code == 403
    assert dup_submit_resp.json()["detail"]["code"] == "INTERVENTION_NOT_ACTIVE"

    # Exactly one persisted submission with preserved 7.0 score.
    subs = (
        db.query(StudentSubmission)
        .filter_by(classwork_assignment_id=aid, student_id=c["student"].student_id)
        .all()
    )
    assert len(subs) == 1
    assert subs[0].attempt_count == 1
    assert float(subs[0].grade) == 7.0

    # Another student remains strictly denied even after resolution.
    _act_as(c, "other_student", "student")
    assert c["client"].get(f"/api/v1/quizzes/assignment/{aid}/attempt").status_code in (403, 404)
    assert c["client"].get(f"/api/v1/classwork-assignments/assignment/{aid}").status_code in (403, 404)


def test_uncompleted_remediation_quiz_on_resolved_or_candidate_intervention_remains_blocked(
    authz_context,
):
    c = authz_context
    db = c["db"]
    setup = _setup_two_question_remedial_quiz(c, intervention_id=3102)
    aid = setup["quiz_as"].classwork_assignment_id

    # Create only a pending (unsubmitted) row, then resolve the intervention.
    db.add(StudentSubmission(
        student_id=c["student"].student_id,
        classwork_assignment_id=aid,
        status="pending",
        attempt_count=0,
    ))
    setup["intervention"].status = "RESOLVED"
    setup["intervention"].resolution_reason = "IMPROVED_PREDICTION"
    setup["intervention"].resolved_at = datetime.now(timezone.utc)
    db.commit()

    _act_as(c, "student", "student")
    attempt_resp = c["client"].get(f"/api/v1/quizzes/assignment/{aid}/attempt")
    assert attempt_resp.status_code == 403
    assert attempt_resp.json()["detail"]["code"] == "INTERVENTION_NOT_ACTIVE"

    assign_resp = c["client"].get(f"/api/v1/classwork-assignments/assignment/{aid}")
    assert assign_resp.status_code == 403
    assert assign_resp.json()["detail"]["code"] == "INTERVENTION_NOT_ACTIVE"

    start_resp = c["client"].post(f"/api/v1/quizzes/assignment/{aid}/start")
    assert start_resp.status_code == 403
    assert start_resp.json()["detail"]["code"] == "INTERVENTION_NOT_ACTIVE"

    # CANDIDATE interventions must never expose completed or uncompleted records to students.
    sub = db.query(StudentSubmission).filter_by(classwork_assignment_id=aid).one()
    sub.status = "graded"
    sub.submitted_at = datetime.now(timezone.utc)
    setup["intervention"].status = "CANDIDATE"
    setup["intervention"].resolution_reason = None
    setup["intervention"].resolved_at = None
    db.commit()

    cand_resp = c["client"].get(f"/api/v1/quizzes/assignment/{aid}/attempt")
    assert cand_resp.status_code == 403
    assert cand_resp.json()["detail"]["code"] == "INTERVENTION_NOT_ACTIVE"


def test_completed_remediation_classwork_read_allowed_after_resolution_but_mutations_blocked(
    authz_context,
):
    c = authz_context
    db = c["db"]
    intervention = _create_active_intervention(c, 3103)
    reading_cw, reading_as, _ = _create_reading(c, "Required Writing Reading")
    cw, assign, _att = _create_remedial_classwork(c, intervention, title="Remediation Essay")
    stage_remediation_reading_prerequisites(
        db,
        remediation_assignment_id=assign.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(
                reading_classwork_id=reading_cw.classwork_id,
                reading_assignment_id=reading_as.classwork_assignment_id,
                display_order=1,
            ),
        ],
    )
    _complete_reading(c, reading_as)
    sub = StudentSubmission(
        student_id=c["student"].student_id,
        classwork_assignment_id=assign.classwork_assignment_id,
        status="graded",
        grade=Decimal("85"),
        attempt_count=1,
        submitted_at=datetime.now(timezone.utc),
    )
    db.add(sub)
    intervention.status = "RESOLVED"
    intervention.resolution_reason = "IMPROVED_PREDICTION"
    intervention.resolved_at = datetime.now(timezone.utc)
    db.commit()

    _act_as(c, "student", "student")
    assert c["client"].get(f"/api/v1/classwork-assignments/assignment/{assign.classwork_assignment_id}").status_code == 200
    assert c["client"].get(f"/api/v1/classwork-assignments/classwork/{cw.classwork_id}").status_code == 200

    # Mutations on a resolved intervention must stay blocked (403).
    unsubmit_resp = c["client"].post(f"/api/v1/submissions/assignment/{assign.classwork_assignment_id}/unsubmit")
    assert unsubmit_resp.status_code == 403
    assert unsubmit_resp.json()["detail"]["code"] == "INTERVENTION_NOT_ACTIVE"

    delete_resp = c["client"].delete(f"/api/v1/submissions/assignment/{assign.classwork_assignment_id}/submit")
    assert delete_resp.status_code == 403
    assert delete_resp.json()["detail"]["code"] == "INTERVENTION_NOT_ACTIVE"
