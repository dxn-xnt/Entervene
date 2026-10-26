"""Shared read-only backend resolver for Written Work and Performance Task effective scores.

Reuses the validated capped scoring formula:
    effective = max(original, min(remediation, original_max_points * cap_snapshot / 100))

This resolver is strictly read-only:
- It does not modify StudentSubmission records or database tables.
- It identifies remedial activities and separates them from official original assignments,
  preventing duplicate counting of assignments in denominators and gradebooks.
- It provides structured audit metadata for transparency and provenance.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timezone
from decimal import Decimal
from typing import Any, Iterable, Mapping, Sequence
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.models.academic.StudentCLass import StudentClass
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.grading.RemedialExamination import ensure_remedial_period_open
from app.services.grading.RemediationScoreAdjuster import (
    DEFAULT_REMEDIATION_CAP_PERCENTAGE,
    adjust_remediation_score,
    to_decimal,
    validate_cap_percentage,
)

SUPPORTED_COMPONENTS = frozenset({"WRITTEN_WORK", "PERFORMANCE_TASK"})


@dataclass(frozen=True)
class RemedialClassworkAudit:
    """Audit metadata for an original classwork and its linked remediation."""

    remediation_link_id: int | None
    source_intervention_id: int | None
    original_assignment_id: int
    remediation_assignment_id: int
    student_id: UUID
    component: str
    score_adjustment_cap: Decimal
    original_raw_score: Decimal | None
    remediation_raw_score: Decimal | None
    max_points: Decimal | None
    cap_score: Decimal | None
    effective_score: Decimal | None
    was_adjusted: bool
    was_capped: bool
    is_completed: bool
    status: str
    rejection_reason: str | None = None


@dataclass(frozen=True)
class ResolvedClassworkScores:
    """Read-only resolution of classwork scores for a student.

    Guarantees:
        - effective_scores: mapping of assignment_id -> Decimal effective score for all non-remedial assignments.
        - effective_scores_float: mapping of assignment_id -> float | None effective score for convenience.
        - remedial_assignment_ids: set of assignment IDs that are remedial activities for this student.
          Official consumers must exclude these IDs from official gradebook columns/denominators.
        - audits_by_original_id: audit trail indexed by original assignment ID.
        - audits_by_remediation_id: audit trail indexed by remediation assignment ID.
        - audit_records: all audit records in order.
    """

    student_id: UUID
    effective_scores: dict[int, Decimal | None]
    effective_scores_float: dict[int, float | None]
    remedial_assignment_ids: frozenset[int]
    audits_by_original_id: dict[int, RemedialClassworkAudit]
    audits_by_remediation_id: dict[int, RemedialClassworkAudit]
    audit_records: list[RemedialClassworkAudit]


def _extract_assignment_id(assignment: Any) -> int:
    if isinstance(assignment, dict):
        return int(assignment["classwork_assignment_id"])
    return int(getattr(assignment, "classwork_assignment_id"))


def _extract_max_points(assignment: Any) -> Decimal | None:
    if assignment is None:
        return None
    if isinstance(assignment, dict):
        pts = assignment.get("total_points")
        if pts is None and "classwork" in assignment and isinstance(assignment["classwork"], dict):
            pts = assignment["classwork"].get("total_points")
        if pts is None:
            return None
        try:
            return to_decimal(pts, param_name="max_points")
        except (ValueError, TypeError):
            return None
    pts = getattr(assignment, "total_points", None)
    if pts is None:
        cw = getattr(assignment, "classwork", None)
        if cw is not None:
            pts = getattr(cw, "total_points", None)
    if pts is None:
        return None
    try:
        return to_decimal(pts, param_name="max_points")
    except (ValueError, TypeError):
        return None


def _extract_score_from_value(value: Any) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, (Decimal, int, float, str)) and not isinstance(value, bool):
        try:
            return to_decimal(value)
        except (ValueError, TypeError):
            return None
    grade = getattr(value, "grade", None)
    if grade is None and isinstance(value, dict):
        grade = value.get("grade")
    if grade is None:
        return None
    try:
        return to_decimal(grade)
    except (ValueError, TypeError):
        return None


def _build_submission_score_map(
    submissions: Mapping[int, Any] | Iterable[Any],
    student_id: UUID | None = None,
) -> dict[int, Decimal | None]:
    if isinstance(submissions, Mapping):
        return {
            int(asgn_id): _extract_score_from_value(val)
            for asgn_id, val in submissions.items()
        }

    selected: dict[int, Any] = {}

    def _sort_key(row: Any) -> tuple[float, int]:
        stamp = getattr(row, "graded_at", None) or getattr(row, "submitted_at", None) or getattr(row, "created_at", None)
        sub_id = int(getattr(row, "submission_id", 0) or 0)
        if stamp is None:
            return (0.0, sub_id)
        if getattr(stamp, "tzinfo", None) is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        return (stamp.timestamp(), sub_id)

    for row in submissions:
        if student_id is not None:
            row_student_id = getattr(row, "student_id", None)
            if row_student_id is not None and row_student_id != student_id:
                continue
        asgn_id = getattr(row, "classwork_assignment_id", None)
        if asgn_id is None and isinstance(row, dict):
            asgn_id = row.get("classwork_assignment_id")
        if asgn_id is None:
            continue
        asgn_id = int(asgn_id)
        existing = selected.get(asgn_id)
        if existing is None:
            selected[asgn_id] = row
        else:
            # Prefer graded submission, then latest by sort key
            existing_grade = getattr(existing, "grade", None)
            row_grade = getattr(row, "grade", None)
            if existing_grade is None and row_grade is not None:
                selected[asgn_id] = row
            elif (existing_grade is None and row_grade is None) or (existing_grade is not None and row_grade is not None):
                if _sort_key(row) > _sort_key(existing):
                    selected[asgn_id] = row

    return {asgn_id: _extract_score_from_value(sub) for asgn_id, sub in selected.items()}


def resolve_student_classwork_scores(
    *,
    student_id: UUID,
    assignments: Iterable[Any],
    submissions: Mapping[int, Any] | Iterable[Any],
    links: Iterable[Any],
) -> ResolvedClassworkScores:
    """Calculate effective Written Work and Performance Task scores for a specific student.

    Guarantees:
        - Formula: max(original, min(remediation, max_points * cap / 100)).
        - Cap is read from link.score_adjustment_cap snapshot.
        - Strict student isolation: only links where link.student_id == student_id are considered.
        - Strict matching max points enforced (orig_max == rem_max).
        - If remediation is missing or ungraded, retains original score unadjusted.
        - Never decreases original score.
        - Remedial assignments are collected into remedial_assignment_ids so consumers can exclude them.
    """
    assignments_by_id: dict[int, Any] = {}
    for a in assignments:
        try:
            aid = _extract_assignment_id(a)
            assignments_by_id[aid] = a
        except (AttributeError, KeyError, TypeError, ValueError):
            continue

    raw_scores = _build_submission_score_map(submissions, student_id=student_id)

    # Filter links strictly for this student and supported WW/PT components
    student_links: list[Any] = []
    seen_originals: set[int] = set()
    conflicting_originals: set[int] = set()
    seen_remediations: set[int] = set()
    conflicting_remediations: set[int] = set()

    for link in links:
        link_student_id = getattr(link, "student_id", None)
        if link_student_id is None and isinstance(link, dict):
            link_student_id = link.get("student_id")
        if link_student_id != student_id:
            continue

        component = getattr(link, "component", None)
        if component is None and isinstance(link, dict):
            component = link.get("component")
        if component not in SUPPORTED_COMPONENTS:
            continue

        orig_id = getattr(link, "original_assignment_id", None)
        rem_id = getattr(link, "remediation_assignment_id", None)
        if orig_id is None and isinstance(link, dict):
            orig_id = link.get("original_assignment_id")
        if rem_id is None and isinstance(link, dict):
            rem_id = link.get("remediation_assignment_id")

        if orig_id is None or rem_id is None or orig_id == rem_id:
            continue

        orig_id = int(orig_id)
        rem_id = int(rem_id)

        if orig_id in seen_originals:
            conflicting_originals.add(orig_id)
        else:
            seen_originals.add(orig_id)

        if rem_id in seen_remediations:
            conflicting_remediations.add(rem_id)
        else:
            seen_remediations.add(rem_id)

        student_links.append(link)

    remedial_assignment_ids: set[int] = set()
    for link in student_links:
        rem_id = int(getattr(link, "remediation_assignment_id", None) if not isinstance(link, dict) else link["remediation_assignment_id"])
        remedial_assignment_ids.add(rem_id)

    # Base effective scores for all non-remedial assignments
    effective_scores: dict[int, Decimal | None] = {}
    for aid, asgn in assignments_by_id.items():
        if aid in remedial_assignment_ids:
            continue
        # Also exclude remedial exam assignments (handled by RemedialExamination)
        if getattr(asgn, "original_exam_assignment_id", None) is not None:
            continue
        effective_scores[aid] = raw_scores.get(aid)

    audits_by_original_id: dict[int, RemedialClassworkAudit] = {}
    audits_by_remediation_id: dict[int, RemedialClassworkAudit] = {}
    audit_records: list[RemedialClassworkAudit] = []

    for link in student_links:
        orig_id = int(getattr(link, "original_assignment_id", None) if not isinstance(link, dict) else link["original_assignment_id"])
        rem_id = int(getattr(link, "remediation_assignment_id", None) if not isinstance(link, dict) else link["remediation_assignment_id"])
        link_id = getattr(link, "remediation_link_id", None) if not isinstance(link, dict) else link.get("remediation_link_id")
        source_intervention_id = getattr(link, "source_intervention_id", None) if not isinstance(link, dict) else link.get("source_intervention_id")
        component = getattr(link, "component", "WRITTEN_WORK") if not isinstance(link, dict) else link.get("component", "WRITTEN_WORK")
        raw_cap = getattr(link, "score_adjustment_cap", None) if not isinstance(link, dict) else link.get("score_adjustment_cap")
        if raw_cap is None:
            raw_cap = DEFAULT_REMEDIATION_CAP_PERCENTAGE
        try:
            cap_dec = validate_cap_percentage(raw_cap)
        except (ValueError, TypeError):
            cap_dec = DEFAULT_REMEDIATION_CAP_PERCENTAGE

        orig_score = raw_scores.get(orig_id)
        rem_score = raw_scores.get(rem_id)

        # Guard: conflicting duplicate links
        if orig_id in conflicting_originals or rem_id in conflicting_remediations:
            audit = RemedialClassworkAudit(
                remediation_link_id=link_id,
                source_intervention_id=source_intervention_id,
                original_assignment_id=orig_id,
                remediation_assignment_id=rem_id,
                student_id=student_id,
                component=component,
                score_adjustment_cap=cap_dec,
                original_raw_score=orig_score,
                remediation_raw_score=rem_score,
                max_points=None,
                cap_score=None,
                effective_score=orig_score,
                was_adjusted=False,
                was_capped=False,
                is_completed=False,
                status="CORRUPT_CONFLICTING_LINK",
                rejection_reason="Conflicting duplicate links detected for this classwork target",
            )
            audit_records.append(audit)
            audits_by_original_id[orig_id] = audit
            audits_by_remediation_id[rem_id] = audit
            continue

        orig_asgn = assignments_by_id.get(orig_id)
        rem_asgn = assignments_by_id.get(rem_id)

        if orig_asgn is None or rem_asgn is None:
            audit = RemedialClassworkAudit(
                remediation_link_id=link_id,
                source_intervention_id=source_intervention_id,
                original_assignment_id=orig_id,
                remediation_assignment_id=rem_id,
                student_id=student_id,
                component=component,
                score_adjustment_cap=cap_dec,
                original_raw_score=orig_score,
                remediation_raw_score=rem_score,
                max_points=None,
                cap_score=None,
                effective_score=orig_score,
                was_adjusted=False,
                was_capped=False,
                is_completed=False,
                status="CORRUPT_MISSING_ASSIGNMENT",
                rejection_reason="Original or remediation assignment not found in assignment set",
            )
            audit_records.append(audit)
            audits_by_original_id[orig_id] = audit
            audits_by_remediation_id[rem_id] = audit
            continue

        orig_max = _extract_max_points(orig_asgn)
        rem_max = _extract_max_points(rem_asgn)

        if orig_max is None or rem_max is None or orig_max <= Decimal("0") or rem_max <= Decimal("0") or orig_max != rem_max:
            audit = RemedialClassworkAudit(
                remediation_link_id=link_id,
                source_intervention_id=source_intervention_id,
                original_assignment_id=orig_id,
                remediation_assignment_id=rem_id,
                student_id=student_id,
                component=component,
                score_adjustment_cap=cap_dec,
                original_raw_score=orig_score,
                remediation_raw_score=rem_score,
                max_points=orig_max,
                cap_score=None,
                effective_score=orig_score,
                was_adjusted=False,
                was_capped=False,
                is_completed=False,
                status="REJECTED_MISMATCHED_MAX_POINTS",
                rejection_reason=f"Mismatched maximum points (original={orig_max}, remediation={rem_max})",
            )
            audit_records.append(audit)
            audits_by_original_id[orig_id] = audit
            audits_by_remediation_id[rem_id] = audit
            continue

        cap_score = (orig_max * cap_dec) / Decimal("100")

        # Incomplete / ungraded remediation
        if rem_score is None:
            audit = RemedialClassworkAudit(
                remediation_link_id=link_id,
                source_intervention_id=source_intervention_id,
                original_assignment_id=orig_id,
                remediation_assignment_id=rem_id,
                student_id=student_id,
                component=component,
                score_adjustment_cap=cap_dec,
                original_raw_score=orig_score,
                remediation_raw_score=None,
                max_points=orig_max,
                cap_score=cap_score,
                effective_score=orig_score,
                was_adjusted=False,
                was_capped=False,
                is_completed=False,
                status="UNGRADED_REMEDIATION",
                rejection_reason=None,
            )
            audit_records.append(audit)
            audits_by_original_id[orig_id] = audit
            audits_by_remediation_id[rem_id] = audit
            continue

        # Original unrecorded / unscored
        if orig_score is None:
            audit = RemedialClassworkAudit(
                remediation_link_id=link_id,
                source_intervention_id=source_intervention_id,
                original_assignment_id=orig_id,
                remediation_assignment_id=rem_id,
                student_id=student_id,
                component=component,
                score_adjustment_cap=cap_dec,
                original_raw_score=None,
                remediation_raw_score=rem_score,
                max_points=orig_max,
                cap_score=cap_score,
                effective_score=None,
                was_adjusted=False,
                was_capped=False,
                is_completed=True,
                status="UNSCORED_ORIGINAL",
                rejection_reason="Original classwork has no recorded score",
            )
            audit_records.append(audit)
            audits_by_original_id[orig_id] = audit
            audits_by_remediation_id[rem_id] = audit
            continue

        try:
            adj = adjust_remediation_score(
                original_score=orig_score,
                remediation_score=rem_score,
                original_max_points=orig_max,
                remediation_max_points=rem_max,
                cap_percentage=cap_dec,
            )
            effective_scores[orig_id] = adj.effective_score

            if adj.was_capped:
                status = "CAPPED"
            elif adj.was_adjusted:
                status = "ADJUSTED"
            elif rem_score <= orig_score:
                status = "NO_INCREASE"
            else:
                status = "UNADJUSTED"

            audit = RemedialClassworkAudit(
                remediation_link_id=link_id,
                source_intervention_id=source_intervention_id,
                original_assignment_id=orig_id,
                remediation_assignment_id=rem_id,
                student_id=student_id,
                component=component,
                score_adjustment_cap=cap_dec,
                original_raw_score=orig_score,
                remediation_raw_score=rem_score,
                max_points=orig_max,
                cap_score=adj.cap_score,
                effective_score=adj.effective_score,
                was_adjusted=adj.was_adjusted,
                was_capped=adj.was_capped,
                is_completed=True,
                status=status,
                rejection_reason=None,
            )
        except ValueError as err:
            audit = RemedialClassworkAudit(
                remediation_link_id=link_id,
                source_intervention_id=source_intervention_id,
                original_assignment_id=orig_id,
                remediation_assignment_id=rem_id,
                student_id=student_id,
                component=component,
                score_adjustment_cap=cap_dec,
                original_raw_score=orig_score,
                remediation_raw_score=rem_score,
                max_points=orig_max,
                cap_score=cap_score,
                effective_score=orig_score,
                was_adjusted=False,
                was_capped=False,
                is_completed=True,
                status="INVALID_SCORE",
                rejection_reason=str(err),
            )

        audit_records.append(audit)
        audits_by_original_id[orig_id] = audit
        audits_by_remediation_id[rem_id] = audit

    effective_scores_float = {
        k: float(v) if v is not None else None
        for k, v in effective_scores.items()
    }

    return ResolvedClassworkScores(
        student_id=student_id,
        effective_scores=effective_scores,
        effective_scores_float=effective_scores_float,
        remedial_assignment_ids=frozenset(remedial_assignment_ids),
        audits_by_original_id=audits_by_original_id,
        audits_by_remediation_id=audits_by_remediation_id,
        audit_records=audit_records,
    )


def resolve_remediation_for_student_period(
    db: Session,
    *,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    academic_period_id: int,
) -> ResolvedClassworkScores:
    """Read-only database query helper resolving effective classwork scores for a student period."""
    assignments = (
        db.query(ClassworkAssignment)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .options(joinedload(ClassworkAssignment.classwork))
        .filter(
            ClassworkAssignment.class_id == class_id,
            ClassworkAssignment.academic_period_id == academic_period_id,
            Classwork.subject_id == subject_id,
            Classwork.is_archived.is_(False),
            (
                ClassworkAssignment.recipient_student_id.is_(None)
                | (ClassworkAssignment.recipient_student_id == student_id)
            ),
        )
        .all()
    )

    asgn_ids = [a.classwork_assignment_id for a in assignments]
    if not asgn_ids:
        return ResolvedClassworkScores(
            student_id=student_id,
            effective_scores={},
            effective_scores_float={},
            remedial_assignment_ids=frozenset(),
            audits_by_original_id={},
            audits_by_remediation_id={},
            audit_records=[],
        )

    links = (
        db.query(RemediationAssignmentLink)
        .filter(
            RemediationAssignmentLink.student_id == student_id,
            (
                RemediationAssignmentLink.original_assignment_id.in_(asgn_ids)
                | RemediationAssignmentLink.remediation_assignment_id.in_(asgn_ids)
            ),
        )
        .all()
    )

    submissions = (
        db.query(StudentSubmission)
        .filter(
            StudentSubmission.student_id == student_id,
            StudentSubmission.classwork_assignment_id.in_(asgn_ids),
        )
        .all()
    )

    return resolve_student_classwork_scores(
        student_id=student_id,
        assignments=assignments,
        submissions=submissions,
        links=links,
    )


def resolve_class_remediation_scores(
    db: Session,
    *,
    class_id: int,
    subject_id: int,
    academic_period_id: int,
    student_ids: Sequence[UUID] | None = None,
) -> dict[UUID, ResolvedClassworkScores]:
    """Read-only batch resolver for an entire class roster."""
    if student_ids is None:
        enrollments = (
            db.query(StudentClass.student_id)
            .filter(
                StudentClass.class_id == class_id,
                StudentClass.enrollment_status == "enrolled",
            )
            .all()
        )
        target_student_ids = [row[0] for row in enrollments]
    else:
        target_student_ids = list(student_ids)

    if not target_student_ids:
        return {}

    assignments = (
        db.query(ClassworkAssignment)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .options(joinedload(ClassworkAssignment.classwork))
        .filter(
            ClassworkAssignment.class_id == class_id,
            ClassworkAssignment.academic_period_id == academic_period_id,
            Classwork.subject_id == subject_id,
            Classwork.is_archived.is_(False),
            (
                ClassworkAssignment.recipient_student_id.is_(None)
                | ClassworkAssignment.recipient_student_id.in_(target_student_ids)
            ),
        )
        .all()
    )

    asgn_ids = [a.classwork_assignment_id for a in assignments]
    if not asgn_ids:
        return {
            sid: ResolvedClassworkScores(
                student_id=sid,
                effective_scores={},
                effective_scores_float={},
                remedial_assignment_ids=frozenset(),
                audits_by_original_id={},
                audits_by_remediation_id={},
                audit_records=[],
            )
            for sid in target_student_ids
        }

    links = (
        db.query(RemediationAssignmentLink)
        .filter(
            RemediationAssignmentLink.student_id.in_(target_student_ids),
            (
                RemediationAssignmentLink.original_assignment_id.in_(asgn_ids)
                | RemediationAssignmentLink.remediation_assignment_id.in_(asgn_ids)
            ),
        )
        .all()
    )

    submissions = (
        db.query(StudentSubmission)
        .filter(
            StudentSubmission.student_id.in_(target_student_ids),
            StudentSubmission.classwork_assignment_id.in_(asgn_ids),
        )
        .all()
    )

    # Group links and submissions by student_id
    links_by_student: dict[UUID, list[RemediationAssignmentLink]] = {sid: [] for sid in target_student_ids}
    for l in links:
        if l.student_id in links_by_student:
            links_by_student[l.student_id].append(l)

    subs_by_student: dict[UUID, list[StudentSubmission]] = {sid: [] for sid in target_student_ids}
    for s in submissions:
        if s.student_id in subs_by_student:
            subs_by_student[s.student_id].append(s)

    results: dict[UUID, ResolvedClassworkScores] = {}
    for sid in target_student_ids:
        # Filter assignments that apply to this student
        student_assignments = [
            a for a in assignments
            if a.recipient_student_id is None or a.recipient_student_id == sid
        ]
        results[sid] = resolve_student_classwork_scores(
            student_id=sid,
            assignments=student_assignments,
            submissions=subs_by_student[sid],
            links=links_by_student[sid],
        )

    return results


def effective_classwork_score_for_change(
    db: Session,
    assignment: Any,
    student_id: UUID,
    replacement_score: float | Decimal | str | None,
) -> Decimal | None:
    """Calculate the effective score of the target original assignment if this attempt has replacement_score."""
    asgn_id = _extract_assignment_id(assignment)

    link = (
        db.query(RemediationAssignmentLink)
        .filter(
            RemediationAssignmentLink.student_id == student_id,
            (
                (RemediationAssignmentLink.remediation_assignment_id == asgn_id)
                | (RemediationAssignmentLink.original_assignment_id == asgn_id)
            ),
        )
        .first()
    )

    if link is None:
        if replacement_score is None:
            return None
        try:
            return to_decimal(replacement_score)
        except (ValueError, TypeError):
            return None

    original_id = link.original_assignment_id
    remediation_id = link.remediation_assignment_id

    assignments = (
        db.query(ClassworkAssignment)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .options(joinedload(ClassworkAssignment.classwork))
        .filter(ClassworkAssignment.classwork_assignment_id.in_([original_id, remediation_id]))
        .all()
    )

    submissions = (
        db.query(StudentSubmission)
        .filter(
            StudentSubmission.student_id == student_id,
            StudentSubmission.classwork_assignment_id.in_([original_id, remediation_id]),
        )
        .all()
    )

    sub_map = _build_submission_score_map(submissions, student_id=student_id)
    sub_map[asgn_id] = to_decimal(replacement_score) if replacement_score is not None else None

    resolved = resolve_student_classwork_scores(
        student_id=student_id,
        assignments=assignments,
        submissions=sub_map,
        links=[link],
    )
    return resolved.effective_scores.get(original_id)


def effective_classwork_grade_changed(
    db: Session,
    assignment: Any,
    student_id: UUID,
    previous: Any,
    current: Any,
) -> bool:
    """Determine whether a grade change alters the effective score for the student."""
    asgn_id = _extract_assignment_id(assignment)

    link = (
        db.query(RemediationAssignmentLink)
        .filter(
            RemediationAssignmentLink.student_id == student_id,
            (
                (RemediationAssignmentLink.remediation_assignment_id == asgn_id)
                | (RemediationAssignmentLink.original_assignment_id == asgn_id)
            ),
        )
        .first()
    )

    if link is None:
        old_val = to_decimal(previous) if previous is not None else None
        new_val = to_decimal(current) if current is not None else None
        return old_val != new_val

    old_eff = effective_classwork_score_for_change(db, assignment, student_id, previous)
    new_eff = effective_classwork_score_for_change(db, assignment, student_id, current)
    return old_eff != new_eff
