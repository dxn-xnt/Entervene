"""Rubric inheritance and compatibility checks for linked remediation classwork."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.schemas.Classwork import ActivityRubricLevelInput

RUBRIC_CLASSWORK_TYPES = {"ACTIVITY", "ASSIGNMENT"}


def serialize_classwork_rubric_levels(classwork: Classwork | None) -> list[dict[str, Any]]:
    """Return canonical descending rubric levels saved on a classwork."""
    if classwork is None or not classwork.rubric_levels:
        return []
    ordered = sorted(
        classwork.rubric_levels,
        key=lambda level: (
            -Decimal(str(level.points)),
            level.display_order,
            level.rubric_level_id or 0,
        ),
    )
    return [
        {
            "level_name": level.level_name.strip(),
            "description": level.description.strip(),
            "points": float(level.points),
            "display_order": index,
        }
        for index, level in enumerate(ordered)
    ]


def original_rubric_inputs(classwork: Classwork | None) -> list[ActivityRubricLevelInput]:
    """Convert an original classwork's saved rubric into ActivityRubricLevelInput copies."""
    return [
        ActivityRubricLevelInput(
            level_name=item["level_name"],
            description=item["description"],
            points=item["points"],
            display_order=item["display_order"],
        )
        for item in serialize_classwork_rubric_levels(classwork)
    ]


def _canonical_rubric_signature(levels: list[Any] | None) -> list[tuple[str, str, Decimal]]:
    if not levels:
        return []
    extracted: list[tuple[Decimal, int, str, str]] = []
    for index, level in enumerate(levels):
        if isinstance(level, dict):
            name = str(level.get("level_name", "")).strip()
            desc = str(level.get("description", "")).strip()
            pts = Decimal(str(level.get("points")))
            order = int(level.get("display_order", index))
        else:
            name = str(level.level_name).strip()
            desc = str(level.description).strip()
            pts = Decimal(str(level.points))
            order = int(getattr(level, "display_order", index))
        extracted.append((pts, order, name, desc))
    extracted.sort(key=lambda item: (-item[0], item[1]))
    return [(name, desc, pts) for pts, _order, name, desc in extracted]


def rubric_levels_match(
    original_levels: list[Any] | None,
    candidate_levels: list[Any] | None,
) -> bool:
    """Verify criteria/descriptions, level names, score ranges (points), and maximum points match."""
    return _canonical_rubric_signature(original_levels) == _canonical_rubric_signature(candidate_levels)


def assert_remediation_rubric_compatible(
    original_work: Classwork | None,
    candidate_levels: list[Any] | None,
    *,
    candidate_type: str,
    candidate_total_points: Decimal | float | int | None = None,
    status_code: int = 422,
) -> None:
    """Ensure a rubric-based remediation classwork inherits the original's saved rubric."""
    if original_work is None:
        return
    normalized_type = (candidate_type or "").strip().upper()
    if normalized_type not in RUBRIC_CLASSWORK_TYPES:
        return
    original_levels = serialize_classwork_rubric_levels(original_work)
    if not original_levels:
        return
    if not candidate_levels or not rubric_levels_match(original_levels, candidate_levels):
        raise HTTPException(
            status_code=status_code,
            detail=(
                "Remediation scoring rubric must match the linked original classwork's saved rubric "
                "(criteria, performance levels, score ranges, and maximum points)."
            ),
        )
    expected_max = max(Decimal(str(level["points"])) for level in original_levels)
    if candidate_total_points is not None and Decimal(str(candidate_total_points)) != expected_max:
        raise HTTPException(
            status_code=status_code,
            detail=(
                f"Remediation maximum points ({candidate_total_points}) must equal "
                f"the original rubric maximum points ({expected_max})."
            ),
        )


def resolve_linked_original_classwork(
    db: Session,
    *,
    classwork: Classwork,
) -> Classwork | None:
    """Return the linked original classwork for a remediation classwork, if any."""
    from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink

    for assignment in classwork.assignments:
        if assignment.original_exam_assignment_id is not None:
            orig_asgn = db.get(ClassworkAssignment, assignment.original_exam_assignment_id)
            if orig_asgn is not None and orig_asgn.classwork is not None:
                return orig_asgn.classwork
        link = db.query(RemediationAssignmentLink).filter_by(
            remediation_assignment_id=assignment.classwork_assignment_id,
        ).first()
        if link is not None:
            orig_asgn = db.get(ClassworkAssignment, link.original_assignment_id)
            if orig_asgn is not None and orig_asgn.classwork is not None:
                return orig_asgn.classwork
    return None
