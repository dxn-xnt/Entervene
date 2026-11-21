"""Canonical quiz-results release policy over legacy persistence fields."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, cast

from app.models.classwork.Classwork import Classwork
from app.models.quiz.QuizSetting import QuizSetting


QuizResultsReleasePolicy = Literal[
    "HIDDEN",
    "IMMEDIATE",
    "AFTER_DUE_DATE",
    "SCHEDULED",
]

VISIBLE_RELEASE_MODES = frozenset({
    "IMMEDIATE",
    "AFTER_DUE_DATE",
    "SCHEDULED",
})


def effective_quiz_results_release_policy(
    classwork: Classwork,
    setting: QuizSetting | None,
) -> QuizResultsReleasePolicy:
    """Resolve legacy combinations conservatively for student-facing access."""
    if (
        setting is None
        or not bool(classwork.show_scores)
        or not bool(setting.show_correct_answers)
    ):
        return "HIDDEN"
    mode = (setting.summary_release_mode or "").strip().upper()
    if mode not in VISIBLE_RELEASE_MODES:
        return "HIDDEN"
    if mode == "SCHEDULED" and setting.summary_release_at is None:
        return "HIDDEN"
    return cast(QuizResultsReleasePolicy, mode)


def apply_quiz_results_release_policy(
    classwork: Classwork,
    setting: QuizSetting,
    policy: QuizResultsReleasePolicy,
) -> None:
    """Persist one explicit policy through the existing compatible columns."""
    if policy == "HIDDEN":
        classwork.show_scores = False
        setting.show_correct_answers = False
        setting.summary_release_mode = "NEVER"
        setting.summary_release_at = None
        return
    classwork.show_scores = True
    setting.show_correct_answers = True
    setting.summary_release_mode = policy


def quiz_results_are_visible(
    classwork: Classwork,
    setting: QuizSetting | None,
    assignment,
    *,
    submission_status: str | None,
    now: datetime | None = None,
) -> bool:
    """Return whether a completed student attempt may expose grading outcomes."""
    policy = effective_quiz_results_release_policy(classwork, setting)
    if policy == "HIDDEN" or submission_status not in {"submitted", "graded", "late", "completed"}:
        return False
    if policy == "IMMEDIATE":
        return True
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    boundary = (
        assignment.due_date
        if policy == "AFTER_DUE_DATE"
        else setting.summary_release_at if setting is not None else None
    )
    if boundary is None:
        return False
    if boundary.tzinfo is None:
        boundary = boundary.replace(tzinfo=timezone.utc)
    return current >= boundary
