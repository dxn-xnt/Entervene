from __future__ import annotations

from fastapi import HTTPException

from app.models.classwork.Classwork import Classwork
from app.models.submissions.StudentSubmission import StudentSubmission


GRADEABLE_SUBMISSION_STATUSES = frozenset({"submitted", "late", "graded"})
ONLINE_SUBMISSION_REQUIRED = (
    "A submitted student attempt is required before an online grade can be saved."
)


def is_manual_activity(classwork: Classwork) -> bool:
    return (
        (classwork.classwork_type or "").strip().upper() == "ACTIVITY"
        and (classwork.activity_mode or "").strip().upper() == "MANUAL"
    )


def has_submitted_attempt(submission: StudentSubmission | None) -> bool:
    if submission is None:
        return False
    return (
        (submission.attempt_count or 0) > 0
        and (submission.status or "").strip().lower() in GRADEABLE_SUBMISSION_STATUSES
    )


def can_enter_grade(
    classwork: Classwork,
    submission: StudentSubmission | None,
) -> bool:
    return is_manual_activity(classwork) or has_submitted_attempt(submission)


def require_gradeable_submission(
    classwork: Classwork,
    submission: StudentSubmission | None,
) -> None:
    if can_enter_grade(classwork, submission):
        return
    raise HTTPException(status_code=409, detail=ONLINE_SUBMISSION_REQUIRED)
