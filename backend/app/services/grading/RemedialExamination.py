"""Select one official score for each original Examination assignment.

Both submissions remain stored. Remedial assignments have the same maximum
points as their original, so comparing raw scores is equivalent to comparing
percentages. Ordinary examinations keep their historical pooled-subtype rule.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import timezone
from typing import Any


def effective_exam_scores(assignments: Iterable[Any], scores: dict[int, float | None]) -> dict[int, float | None]:
    rows = list(assignments)
    effective = {row.classwork_assignment_id: scores.get(row.classwork_assignment_id) for row in rows
                 if row.original_exam_assignment_id is None}
    for row in rows:
        original_id = row.original_exam_assignment_id
        if original_id is None or original_id not in effective:
            continue
        remedial = scores.get(row.classwork_assignment_id)
        original = effective[original_id]
        possible = getattr(row.classwork, "total_points", None) if getattr(row, "classwork", None) else None
        if (remedial is not None and possible is not None and possible > 0
            and 0 <= remedial <= float(possible) and (original is None or remedial > original)):
            effective[original_id] = remedial
    return effective


def effective_exam_score_for_change(db: Any, assignment: Any, student_id: Any, replacement: float | None) -> float | None:
    """Read the effective score with this attempt's score replaced."""
    from app.models.classwork.ClassworkAssignment import ClassworkAssignment
    from app.models.submissions.StudentSubmission import StudentSubmission

    original_id = assignment.original_exam_assignment_id or assignment.classwork_assignment_id
    assignments = db.query(ClassworkAssignment).filter(
        (ClassworkAssignment.classwork_assignment_id == original_id)
        | (ClassworkAssignment.original_exam_assignment_id == original_id),
    ).all()
    ids = [row.classwork_assignment_id for row in assignments]
    submissions = db.query(StudentSubmission).filter(
        StudentSubmission.student_id == student_id,
        StudentSubmission.classwork_assignment_id.in_(ids),
    ).all()
    selected = {}
    def sort_key(row: Any) -> tuple[float, int]:
        stamp = row.graded_at or row.submitted_at or row.created_at
        if stamp is None:
            return (0, row.submission_id)
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        return (stamp.timestamp(), row.submission_id)
    for row in submissions:
        if row.grade is None:
            continue
        existing = selected.get(row.classwork_assignment_id)
        if existing is None or sort_key(row) > sort_key(existing):
            selected[row.classwork_assignment_id] = row
    scores = {key: float(row.grade) for key, row in selected.items()}
    scores[assignment.classwork_assignment_id] = replacement
    return effective_exam_scores(assignments, scores).get(original_id)


def effective_grade_changed(db: Any, assignment: Any, student_id: Any, previous: Any, current: Any) -> bool:
    if assignment.original_exam_assignment_id is None:
        from app.models.classwork.ClassworkAssignment import ClassworkAssignment
        if not db.query(ClassworkAssignment.classwork_assignment_id).filter_by(
            original_exam_assignment_id=assignment.classwork_assignment_id,
        ).first():
            return previous != current
    old = effective_exam_score_for_change(db, assignment, student_id, float(previous) if previous is not None else None)
    new = effective_exam_score_for_change(db, assignment, student_id, float(current) if current is not None else None)
    return old != new


def ensure_remedial_period_open(db: Any, assignment: Any, student_id: Any) -> None:
    if assignment.original_exam_assignment_id is None:
        return
    from fastapi import HTTPException
    from app.models.academic.StudentPeriodGrade import StudentPeriodGrade

    finalized = db.query(StudentPeriodGrade.period_grade_id).filter_by(
        student_id=student_id, class_id=assignment.class_id,
        subject_id=assignment.classwork.subject_id, academic_period_id=assignment.academic_period_id,
        is_finalized=True,
    ).first()
    if finalized:
        raise HTTPException(status_code=409, detail="The period grade is finalized")
