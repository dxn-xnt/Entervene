"""Cycle calculation shared by Practice Assessment and reading-review services."""

from sqlalchemy.orm import Session

from app.models.intervention.PracticeAttempt import PracticeAttempt


def current_practice_reading_cycle(db: Session, *, intervention_id: int, student_id) -> int:
    """Return the active reading-review cycle for a student's Practice Assessment.

    Cycle 1 is required before the first attempt. Each submitted below-passing
    attempt advances the cycle by 1 so all assigned readings must be reviewed
    again before retrying. Once any submitted attempt passes, its cycle is
    preserved so passing completion is never revoked.
    """
    passed_cycle = (
        db.query(PracticeAttempt.reading_review_cycle)
        .filter(
            PracticeAttempt.student_id == student_id,
            PracticeAttempt.status == "SUBMITTED",
            PracticeAttempt.is_passed.is_(True),
            PracticeAttempt.assessment.has(intervention_id=intervention_id),
        )
        .order_by(PracticeAttempt.attempt_number.asc())
        .first()
    )
    if passed_cycle is not None and passed_cycle[0] is not None:
        return int(passed_cycle[0])
    failed_count = (
        db.query(PracticeAttempt.attempt_id)
        .filter(
            PracticeAttempt.student_id == student_id,
            PracticeAttempt.status == "SUBMITTED",
            PracticeAttempt.is_passed.is_(False),
            PracticeAttempt.assessment.has(intervention_id=intervention_id),
        )
        .count()
    )
    return failed_count + 1
