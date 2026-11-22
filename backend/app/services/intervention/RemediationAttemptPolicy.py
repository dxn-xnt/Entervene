"""Unified 3-attempt remediation policy across quizzes, activities, assignments, and exams."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.intervention.Intervention import Intervention
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizSetting import QuizSetting
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.classwork.ClassworkShared import is_quiz_type, is_reading_type
from app.services.grading.PassingThresholdReader import read_passing_threshold_context
from app.services.grading.PassingThresholdResolver import (
    PassingThresholdConfigurationError,
    resolve_passing_threshold,
)
from app.services.grading.RemediationScoreAdjuster import validate_cap_percentage


REMEDIATION_MAX_ATTEMPTS = 3
REMEDIATION_PASSED_MESSAGE = (
    "You've successfully completed this Study Support assessment. "
    "No further attempts are needed."
)
REMEDIATION_NEEDS_TEACHER_REVIEW_LABEL = "Needs Teacher Review"
REMEDIATION_MAX_ATTEMPTS_LOCKED_MESSAGE = (
    "Maximum attempts reached (3/3). Needs Teacher Review."
)


def is_remediation_assessment(
    assignment: ClassworkAssignment | None,
    classwork: Classwork | None,
) -> bool:
    """Return True for any non-reading remediation assessment tied to an intervention."""
    return bool(
        assignment is not None
        and classwork is not None
        and assignment.source_intervention_id is not None
        and not is_reading_type(classwork.classwork_type)
    )


def remediation_max_attempts(
    db: Session,
    assignment: ClassworkAssignment,
    classwork: Classwork,
) -> int:
    """Resolve the effective attempt limit for a remediation assessment (1..3, default 3)."""
    configured = assignment.max_attempts
    if configured is None and is_quiz_type(classwork.classwork_type):
        setting = db.query(QuizSetting).filter(QuizSetting.classwork_id == classwork.classwork_id).first()
        configured = setting.max_attempts if setting is not None else None
    if configured is None:
        return REMEDIATION_MAX_ATTEMPTS
    return max(1, min(int(configured), REMEDIATION_MAX_ATTEMPTS))


def _configured_remediation_ceiling(
    db: Session,
    assignment: ClassworkAssignment,
    classwork: Classwork,
) -> Decimal | None:
    """Return the persisted intervention ceiling (score_adjustment_cap) if applicable.

    Precedence:
    1. Immutable per-assessment snapshot on ``RemediationAssignmentLink.score_adjustment_cap``
       when the link exists for this assignment and intervention. This governs
       existing assessments even if intervention plan settings are later altered.
    2. Associated ``Intervention.remediation_plan["score_adjustment_cap"]`` for
       non-examination, graded curated remediation assessments when no link row
       exists (e.g., legacy or unlinked records).

    Returns ``None`` for examination remediation, ungraded practice-only
    remediation, or interventions without a valid configured ceiling so callers
    can fall back to the subject passing threshold.
    """
    if assignment.source_intervention_id is None:
        return None

    if assignment.classwork_assignment_id is not None:
        link = (
            db.query(RemediationAssignmentLink)
            .filter_by(remediation_assignment_id=assignment.classwork_assignment_id)
            .first()
        )
        if (
            link is not None
            and link.source_intervention_id == assignment.source_intervention_id
            and link.score_adjustment_cap is not None
        ):
            try:
                return validate_cap_percentage(link.score_adjustment_cap)
            except (ValueError, TypeError):
                pass

    if assignment.original_exam_assignment_id is not None:
        return None

    if not classwork.is_graded:
        return None

    intervention = db.get(Intervention, assignment.source_intervention_id)
    if intervention is None or not isinstance(intervention.remediation_plan, dict):
        return None
    if intervention.remediation_plan.get("grade_treatment") in {"PRACTICE_ONLY", "EXAMINATION"}:
        return None
    raw_cap = intervention.remediation_plan.get("score_adjustment_cap")
    if raw_cap is None:
        return None
    try:
        return validate_cap_percentage(raw_cap)
    except (ValueError, TypeError):
        return None


def remediation_passing_threshold(
    db: Session,
    assignment: ClassworkAssignment,
    classwork: Classwork,
) -> Decimal | None:
    if not is_remediation_assessment(assignment, classwork):
        return None
    configured_ceiling = _configured_remediation_ceiling(db, assignment, classwork)
    if configured_ceiling is not None:
        return configured_ceiling
    academic_year_id: int | None = None
    if assignment.class_id is not None:
        class_row = db.get(Class, assignment.class_id)
        if class_row is not None:
            academic_year_id = class_row.academic_year_id
    if academic_year_id is None and assignment.academic_period_id is not None:
        period_row = db.get(AcademicPeriod, assignment.academic_period_id)
        if period_row is not None:
            academic_year_id = period_row.academic_year_id
    if academic_year_id is None or classwork.subject_id is None:
        return None
    try:
        context = read_passing_threshold_context(
            db,
            academic_year_id=academic_year_id,
            subject_ids=[classwork.subject_id],
            academic_period_id=assignment.academic_period_id,
        )
        resolved = resolve_passing_threshold(
            context,
            academic_year_id=academic_year_id,
            scope="subject",
            subject_id=classwork.subject_id,
        )
    except PassingThresholdConfigurationError:
        return None
    return resolved.threshold


def _assessment_max_points(classwork: Classwork, quiz: Quiz | None = None) -> Decimal:
    if classwork.total_points is not None and Decimal(str(classwork.total_points)) > 0:
        return Decimal(str(classwork.total_points))
    if quiz is not None and getattr(quiz, "questions", None):
        return sum(
            (Decimal(str(link.question.points)) for link in quiz.questions if link.question is not None),
            Decimal("0"),
        )
    return Decimal("0")


def evaluate_remediation_assessment_pass(
    db: Session,
    assignment: ClassworkAssignment,
    classwork: Classwork,
    submission: StudentSubmission | None,
    *,
    quiz: Quiz | None = None,
) -> tuple[bool, Decimal | None]:
    """Return (is_passed, passing_threshold) for any remediation assessment."""
    if not is_remediation_assessment(assignment, classwork):
        return False, None
    threshold = remediation_passing_threshold(db, assignment, classwork)
    if (
        threshold is None
        or submission is None
        or submission.status != "graded"
        or submission.grade is None
    ):
        return False, threshold
    max_points = _assessment_max_points(classwork, quiz)
    if max_points <= 0:
        return False, threshold
    is_passed = Decimal(str(submission.grade)) * Decimal("100") >= threshold * max_points
    return is_passed, threshold


def evaluate_remediation_attempt_state(
    db: Session,
    assignment: ClassworkAssignment | None,
    classwork: Classwork | None,
    submission: StudentSubmission | None,
    *,
    quiz: Quiz | None = None,
) -> dict[str, Any]:
    """Compute standardized remediation attempt counters, pass flag, retry eligibility, and review lock."""
    if not is_remediation_assessment(assignment, classwork):
        return {
            "is_remediation": False,
            "max_attempts": assignment.max_attempts if assignment is not None else None,
            "attempts_used": int(submission.attempt_count) if submission is not None else 0,
            "attempts_remaining": None,
            "is_passed": False,
            "passing_threshold": None,
            "needs_teacher_review": False,
            "can_retry": False,
        }

    assert assignment is not None and classwork is not None
    max_attempts = remediation_max_attempts(db, assignment, classwork)
    attempts_used = int(submission.attempt_count or 0) if submission is not None else 0
    is_passed, passing_threshold = evaluate_remediation_assessment_pass(
        db, assignment, classwork, submission, quiz=quiz,
    )
    attempts_remaining = 0 if is_passed else max(0, max_attempts - attempts_used)
    is_graded = submission is not None and submission.status == "graded"
    needs_teacher_review = bool(
        is_graded and not is_passed and attempts_used >= max_attempts
    )
    can_retry = bool(
        is_graded and not is_passed and attempts_used < max_attempts
    )
    return {
        "is_remediation": True,
        "max_attempts": max_attempts,
        "attempts_used": attempts_used,
        "attempts_remaining": attempts_remaining,
        "is_passed": is_passed,
        "passing_threshold": passing_threshold,
        "needs_teacher_review": needs_teacher_review,
        "can_retry": can_retry,
    }


def list_remediation_attempt_history(
    db: Session,
    assignment_id: int,
    student_id,
) -> list[StudentSubmission]:
    """Return all preserved attempt rows for one student and remediation assignment in chronological order."""
    return (
        db.query(StudentSubmission)
        .filter(
            StudentSubmission.classwork_assignment_id == assignment_id,
            StudentSubmission.student_id == student_id,
        )
        .order_by(StudentSubmission.attempt_count.asc(), StudentSubmission.submission_id.asc())
        .all()
    )
