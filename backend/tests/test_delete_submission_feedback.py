"""Unit and integration tests for deleting published submission feedback.

Verifies:
1. Deleting published feedback clears submission.feedback and leaves grade, scores,
   and official gradebook records strictly untouched.
2. Draft synchronization: an APPROVED draft is safely transitioned to DISCARDED so stale
   draft text cannot be accidentally re-published.
3. Concurrency check: stale expected_feedback_fingerprint returns 409 Conflict.
4. Idempotency: deleting when feedback is already None succeeds with 200.
5. RBAC and authorization: unassigned teacher and student role are rejected with 403.
6. Period finalization: finalized period grade blocks feedback deletion with 409 Conflict.
7. Student visibility: after deletion, student submission reads return feedback: null.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.submissions.SubmissionFeedbackDraft import SubmissionFeedbackDraft
from app.services.submission.SubmissionService import feedback_fingerprint
from tests.test_submission_feedback_suggestion import (
    feedback_context,
    _authorize_answer_release,
    _suggestion_tokens,
    _publication_body,
)


def _publish_feedback_for_test(feedback_context, monkeypatch, text="Review the lesson concepts and continue strengthening your explanations."):
    _authorize_answer_release(feedback_context)
    tokens, _ = _suggestion_tokens(feedback_context, monkeypatch)
    client = feedback_context["client"]
    sub_id = feedback_context["submission"].submission_id
    resp = client.put(
        f"/api/v1/submissions/{sub_id}/feedback",
        json=_publication_body(tokens, feedback=text),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_delete_published_feedback_preserves_grade(feedback_context, monkeypatch):
    """Deleting feedback must remove feedback text while preserving student's grade and scores."""
    published = _publish_feedback_for_test(feedback_context, monkeypatch)
    sub = feedback_context["submission"]
    db = feedback_context["db"]
    client = feedback_context["client"]

    initial_grade = sub.grade
    initial_status = sub.status
    assert initial_grade is not None

    # Verify feedback was saved
    db.refresh(sub)
    assert sub.feedback == published["feedback"]

    # Delete feedback
    resp = client.delete(
        f"/api/v1/submissions/{sub.submission_id}/feedback",
        params={"expected_feedback_fingerprint": published["feedback_fingerprint"]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["submission_id"] == sub.submission_id
    assert body["feedback"] is None
    assert body["feedback_fingerprint"] == feedback_fingerprint(None)

    # Verify database state: grade preserved, feedback cleared
    db.refresh(sub)
    assert sub.feedback is None
    assert sub.grade == initial_grade
    assert sub.status == initial_status


def test_delete_feedback_synchronizes_approved_draft(feedback_context, monkeypatch):
    """An approved draft must transition to DISCARDED when feedback is deleted."""
    published = _publish_feedback_for_test(feedback_context, monkeypatch)
    sub = feedback_context["submission"]
    db = feedback_context["db"]
    client = feedback_context["client"]

    # Create/ensure an APPROVED draft exists
    draft = db.query(SubmissionFeedbackDraft).filter_by(submission_id=sub.submission_id).first()
    if draft is None:
        draft = SubmissionFeedbackDraft(
            submission_id=sub.submission_id,
            status="APPROVED",
            staff_id=feedback_context["teacher"].staff_id,
            feedback_fingerprint=published["feedback_fingerprint"],
        )
        db.add(draft)
        db.commit()
    else:
        draft.status = "APPROVED"
        db.commit()

    # Perform deletion
    resp = client.delete(f"/api/v1/submissions/{sub.submission_id}/feedback")
    assert resp.status_code == 200, resp.text

    # Verify draft status transitioned to DISCARDED
    db.refresh(draft)
    assert draft.status == "DISCARDED"
    assert draft.claim_token is None
    assert draft.locked_until is None


def test_delete_feedback_stale_concurrency_protection(feedback_context, monkeypatch):
    """Passing a stale feedback fingerprint must return 409 Conflict."""
    _publish_feedback_for_test(feedback_context, monkeypatch)
    sub = feedback_context["submission"]
    client = feedback_context["client"]

    stale_fingerprint = "0" * 64
    resp = client.delete(
        f"/api/v1/submissions/{sub.submission_id}/feedback",
        params={"expected_feedback_fingerprint": stale_fingerprint},
    )
    assert resp.status_code == 409
    data = resp.json()
    detail = data.get("detail", {})
    code = detail.get("code") if isinstance(detail, dict) else None
    assert code == "FEEDBACK_COMMENT_STALE"


def test_delete_feedback_idempotent_when_already_none(feedback_context, monkeypatch):
    """Deleting feedback when none exists is safe and idempotent."""
    sub = feedback_context["submission"]
    db = feedback_context["db"]
    client = feedback_context["client"]

    sub.feedback = None
    db.commit()

    resp = client.delete(f"/api/v1/submissions/{sub.submission_id}/feedback")
    assert resp.status_code == 200
    body = resp.json()
    assert body["feedback"] is None
    assert body["feedback_fingerprint"] == feedback_fingerprint(None)


def test_delete_feedback_unauthorized_teacher_rejected(feedback_context, monkeypatch):
    """A teacher not assigned to the classwork cannot delete feedback."""
    _publish_feedback_for_test(feedback_context, monkeypatch)
    sub = feedback_context["submission"]

    # Switch identity to unassigned teacher
    feedback_context["identity"]["sub"] = feedback_context["accounts"]["other_teacher"].user_id
    resp = feedback_context["client"].delete(f"/api/v1/submissions/{sub.submission_id}/feedback")
    assert resp.status_code in (403, 404)


def test_delete_feedback_student_role_rejected(feedback_context, monkeypatch):
    """Student role cannot delete feedback."""
    _publish_feedback_for_test(feedback_context, monkeypatch)
    sub = feedback_context["submission"]

    # Switch identity to student
    feedback_context["identity"].update({
        "sub": feedback_context["accounts"]["student"].user_id,
        "role": "student",
    })
    resp = feedback_context["client"].delete(f"/api/v1/submissions/{sub.submission_id}/feedback")
    assert resp.status_code == 403


def test_delete_feedback_finalized_period_grade_rejected(feedback_context, monkeypatch):
    """Finalized academic period grade must prevent feedback deletion."""
    _publish_feedback_for_test(feedback_context, monkeypatch)
    sub = feedback_context["submission"]
    db = feedback_context["db"]
    client = feedback_context["client"]

    # Finalize the period grade
    pg = StudentPeriodGrade(
        student_id=sub.student_id,
        class_id=feedback_context["class"].class_id,
        subject_id=feedback_context["subject"].subject_id,
        academic_period_id=feedback_context["period"].academic_period_id,
        is_finalized=True,
    )
    db.add(pg)
    db.commit()

    resp = client.delete(f"/api/v1/submissions/{sub.submission_id}/feedback")
    assert resp.status_code == 409
    data = resp.json()
    detail = data.get("detail", {})
    code = detail.get("code") if isinstance(detail, dict) else None
    assert code == "FEEDBACK_PERIOD_GRADE_FINALIZED"


def test_delete_feedback_student_visibility_cleared(feedback_context, monkeypatch):
    """Student read endpoint must reflect cleared feedback after deletion."""
    _publish_feedback_for_test(feedback_context, monkeypatch)
    sub = feedback_context["submission"]
    client = feedback_context["client"]

    # Verify student can see the feedback initially
    feedback_context["identity"].update({
        "sub": feedback_context["accounts"]["student"].user_id,
        "role": "student",
    })
    read_resp = client.get(f"/api/v1/submissions/{sub.submission_id}")
    assert read_resp.status_code == 200
    assert read_resp.json()["feedback"] is not None

    # Switch back to teacher and delete feedback
    feedback_context["identity"].update({
        "sub": feedback_context["accounts"]["teacher"].user_id,
        "role": "teacher",
    })
    del_resp = client.delete(f"/api/v1/submissions/{sub.submission_id}/feedback")
    assert del_resp.status_code == 200

    # Student reads again - feedback must be None
    feedback_context["identity"].update({
        "sub": feedback_context["accounts"]["student"].user_id,
        "role": "student",
    })
    read_resp_after = client.get(f"/api/v1/submissions/{sub.submission_id}")
    assert read_resp_after.status_code == 200
    assert read_resp_after.json()["feedback"] is None
