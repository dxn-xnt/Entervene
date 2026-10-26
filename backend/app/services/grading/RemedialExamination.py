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
    from app.models.classwork.ClassworkAssignment import ClassworkAssignment

    # 1. Examination remediation check
    is_exam_link = (
        getattr(assignment, "original_exam_assignment_id", None) is not None
        or (
            hasattr(assignment, "classwork_assignment_id")
            and db.query(ClassworkAssignment.classwork_assignment_id)
            .filter_by(original_exam_assignment_id=assignment.classwork_assignment_id)
            .first() is not None
        )
    )
    if is_exam_link:
        old = effective_exam_score_for_change(db, assignment, student_id, float(previous) if previous is not None else None)
        new = effective_exam_score_for_change(db, assignment, student_id, float(current) if current is not None else None)
        return old != new

    # 2. WW/PT remediation link check
    from uuid import UUID
    try:
        student_uuid = student_id if isinstance(student_id, UUID) else UUID(str(student_id))
    except (ValueError, TypeError):
        student_uuid = None

    if student_uuid is not None:
        from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink

        asgn_id = getattr(assignment, "classwork_assignment_id", None)
        if asgn_id is not None:
            link = db.query(RemediationAssignmentLink).filter(
                RemediationAssignmentLink.student_id == student_uuid,
                (
                    (RemediationAssignmentLink.remediation_assignment_id == asgn_id)
                    | (RemediationAssignmentLink.original_assignment_id == asgn_id)
                ),
            ).first()
            if link:
                from app.models.submissions.StudentSubmission import StudentSubmission
                from app.services.grading.RemediationScoreAdjuster import adjust_remediation_score

                orig_asgn = db.get(ClassworkAssignment, link.original_assignment_id)
                max_pts = float(orig_asgn.classwork.total_points) if orig_asgn and orig_asgn.classwork and orig_asgn.classwork.total_points else 0.0

                prev_f = float(previous) if previous is not None else None
                curr_f = float(current) if current is not None else None

                if asgn_id == link.remediation_assignment_id:
                    # Changing remediation grade
                    orig_sub = db.query(StudentSubmission).filter_by(
                        student_id=student_uuid, classwork_assignment_id=link.original_assignment_id
                    ).first()
                    orig_score = float(orig_sub.grade) if orig_sub and orig_sub.grade is not None else None
                    if orig_score is None:
                        return False
                    try:
                        old_adj = adjust_remediation_score(
                            original_score=orig_score,
                            remediation_score=prev_f,
                            original_max_points=max_pts,
                            remediation_max_points=max_pts,
                            cap_percentage=link.score_adjustment_cap,
                        ) if prev_f is not None else None
                    except Exception:
                        old_adj = None
                    try:
                        new_adj = adjust_remediation_score(
                            original_score=orig_score,
                            remediation_score=curr_f,
                            original_max_points=max_pts,
                            remediation_max_points=max_pts,
                            cap_percentage=link.score_adjustment_cap,
                        ) if curr_f is not None else None
                    except Exception:
                        new_adj = None
                    old_eff = float(old_adj.effective_score) if old_adj else orig_score
                    new_eff = float(new_adj.effective_score) if new_adj else orig_score
                    return old_eff != new_eff
                else:
                    # Changing original grade
                    rem_sub = db.query(StudentSubmission).filter_by(
                        student_id=student_uuid, classwork_assignment_id=link.remediation_assignment_id
                    ).first()
                    rem_score = float(rem_sub.grade) if rem_sub and rem_sub.grade is not None else None

                    try:
                        old_adj = adjust_remediation_score(
                            original_score=prev_f,
                            remediation_score=rem_score,
                            original_max_points=max_pts,
                            remediation_max_points=max_pts,
                            cap_percentage=link.score_adjustment_cap,
                        ) if (prev_f is not None and rem_score is not None) else None
                    except Exception:
                        old_adj = None
                    try:
                        new_adj = adjust_remediation_score(
                            original_score=curr_f,
                            remediation_score=rem_score,
                            original_max_points=max_pts,
                            remediation_max_points=max_pts,
                            cap_percentage=link.score_adjustment_cap,
                        ) if (curr_f is not None and rem_score is not None) else None
                    except Exception:
                        new_adj = None
                    old_eff = float(old_adj.effective_score) if old_adj else prev_f
                    new_eff = float(new_adj.effective_score) if new_adj else curr_f
                    return old_eff != new_eff

    return previous != current


def ensure_remedial_period_open(db: Any, assignment: Any, student_id: Any) -> None:
    is_exam_remedial = getattr(assignment, "original_exam_assignment_id", None) is not None
    is_ww_pt_remedial = False

    from uuid import UUID
    try:
        student_uuid = student_id if isinstance(student_id, UUID) else UUID(str(student_id))
    except (ValueError, TypeError):
        student_uuid = None

    if not is_exam_remedial and student_uuid is not None:
        from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink

        asgn_id = getattr(assignment, "classwork_assignment_id", None)
        if asgn_id is not None:
            is_ww_pt_remedial = (
                db.query(RemediationAssignmentLink.remediation_link_id)
                .filter_by(
                    remediation_assignment_id=asgn_id,
                    student_id=student_uuid,
                )
                .first()
                is not None
            )
        if not is_ww_pt_remedial:
            is_ww_pt_remedial = bool(
                getattr(assignment, "source_intervention_id", None) is not None
                and getattr(assignment, "recipient_student_id", None) == student_uuid
            )

    if not is_exam_remedial and not is_ww_pt_remedial:
        return

    from fastapi import HTTPException
    from app.models.academic.StudentPeriodGrade import StudentPeriodGrade

    subject_id = getattr(assignment.classwork, "subject_id", None) if getattr(assignment, "classwork", None) else None
    if subject_id is None:
        from app.models.classwork.Classwork import Classwork
        cw_row = db.query(Classwork.subject_id).filter_by(classwork_id=assignment.classwork_id).first()
        if cw_row:
            subject_id = cw_row[0]

    finalized = db.query(StudentPeriodGrade.period_grade_id).filter_by(
        student_id=student_uuid if student_uuid is not None else student_id,
        class_id=assignment.class_id,
        subject_id=subject_id,
        academic_period_id=assignment.academic_period_id,
        is_finalized=True,
    ).first()
    if finalized:
        raise HTTPException(status_code=409, detail="The period grade is finalized")
