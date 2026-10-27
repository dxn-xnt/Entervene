"""Create-once persistence contract for remediation Reading prerequisites."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationReadingPrerequisite import (
    RemediationReadingPrerequisite,
)
from app.models.intervention.Intervention import Intervention
from app.services.classwork.ClassworkShared import is_reading_type
from app.services.intervention.StudentPersistentInterventionService import (
    resolve_required_readings,
)


@dataclass(frozen=True)
class ReadingPrerequisiteSnapshotItem:
    reading_classwork_id: int
    reading_assignment_id: int
    display_order: int


def remediation_reading_prerequisites(
    db: Session,
    remediation_assignment_id: int,
) -> list[RemediationReadingPrerequisite]:
    return db.query(RemediationReadingPrerequisite).filter_by(
        remediation_assignment_id=remediation_assignment_id,
    ).order_by(
        RemediationReadingPrerequisite.display_order,
        RemediationReadingPrerequisite.prerequisite_id,
    ).all()


def stage_remediation_reading_prerequisites(
    db: Session,
    *,
    remediation_assignment_id: int,
    items: list[ReadingPrerequisiteSnapshotItem],
) -> list[RemediationReadingPrerequisite]:
    """Stage one immutable snapshot in the caller's transaction.

    Identical retries are idempotent. Once any rows exist for the remediation
    assignment, a different ordered snapshot is rejected rather than replaced.
    Publication-time accessibility validation belongs to the later integration.
    """
    remediation = db.query(ClassworkAssignment).filter_by(
        classwork_assignment_id=remediation_assignment_id,
    ).with_for_update().one_or_none()
    if remediation is None:
        raise HTTPException(status_code=404, detail="Remediation assignment not found")
    if (
        remediation.source_intervention_id is None
        or remediation.recipient_student_id is None
        or remediation.remediation_request_id is None
    ):
        raise HTTPException(
            status_code=400,
            detail="Reading prerequisites require a targeted remediation assignment",
        )
    if not items:
        raise HTTPException(
            status_code=400,
            detail="A remediation prerequisite snapshot cannot be empty",
        )

    requested = [
        (item.reading_classwork_id, item.reading_assignment_id, item.display_order)
        for item in items
    ]
    expected_orders = list(range(1, len(items) + 1))
    if [item.display_order for item in items] != expected_orders:
        raise HTTPException(
            status_code=400,
            detail="Reading prerequisite display order must be contiguous and start at 1",
        )
    if len({item.reading_assignment_id for item in items}) != len(items):
        raise HTTPException(
            status_code=400,
            detail="A Reading assignment can appear only once in a prerequisite snapshot",
        )

    existing = remediation_reading_prerequisites(db, remediation_assignment_id)
    if existing:
        persisted = [
            (row.reading_classwork_id, row.reading_assignment_id, row.display_order)
            for row in existing
        ]
        if persisted == requested:
            return existing
        raise HTTPException(
            status_code=409,
            detail="The remediation Reading prerequisite snapshot is immutable",
        )

    rows: list[RemediationReadingPrerequisite] = []
    for item in items:
        reading_assignment = db.get(ClassworkAssignment, item.reading_assignment_id)
        reading = db.get(Classwork, item.reading_classwork_id)
        if (
            reading_assignment is None
            or reading is None
            or reading_assignment.classwork_id != reading.classwork_id
            or not is_reading_type(reading.classwork_type)
            or reading.is_graded
        ):
            raise HTTPException(
                status_code=400,
                detail="Prerequisite identity must reference an exact non-graded Reading assignment",
            )
        row = RemediationReadingPrerequisite(
            remediation_assignment_id=remediation_assignment_id,
            reading_classwork_id=item.reading_classwork_id,
            reading_assignment_id=item.reading_assignment_id,
            display_order=item.display_order,
        )
        db.add(row)
        rows.append(row)
    db.flush()
    return rows


def resolve_reading_prerequisite_snapshot_items(
    db: Session,
    *,
    intervention: Intervention,
    remediation_assignment: ClassworkAssignment | None = None,
    is_graded: bool | None = None,
    require_readings: bool = False,
) -> list[ReadingPrerequisiteSnapshotItem]:
    """Resolve and validate Supporting Readings into ordered snapshot items.

    Validates that every selected reading is a genuine, non-graded, published,
    accessible, unlocked READING assignment in the intervention scope.

    New graded or required remediation activities require at least one valid reading.
    Duplicate readings, missing resources, or out-of-scope assignments are
    rejected with clear 400 Bad Request errors.
    """
    if intervention.status != "ACTIVE":
        raise HTTPException(
            status_code=400,
            detail="Remediation reading prerequisites require an active intervention",
        )

    if remediation_assignment is not None:
        if (
            remediation_assignment.source_intervention_id is None
            or remediation_assignment.recipient_student_id is None
            or remediation_assignment.remediation_request_id is None
        ):
            raise HTTPException(
                status_code=400,
                detail="Reading prerequisites require a targeted remediation assignment",
            )
        if remediation_assignment.source_intervention_id != intervention.intervention_id:
            raise HTTPException(
                status_code=400,
                detail="Remediation assignment does not belong to this intervention",
            )
        if remediation_assignment.recipient_student_id != intervention.student_id:
            raise HTTPException(
                status_code=400,
                detail="Remediation assignment recipient does not match intervention student",
            )
        if remediation_assignment.class_id != intervention.class_id:
            raise HTTPException(
                status_code=400,
                detail="Remediation assignment class does not match intervention class",
            )
        if remediation_assignment.academic_period_id != intervention.academic_period_id:
            raise HTTPException(
                status_code=400,
                detail="Remediation assignment period does not match intervention period",
            )
        work = remediation_assignment.classwork or db.get(Classwork, remediation_assignment.classwork_id)
        if work is not None and work.subject_id != intervention.subject_id:
            raise HTTPException(
                status_code=400,
                detail="Remediation assignment subject does not match intervention subject",
            )
        if is_graded is None and work is not None:
            is_graded = bool(work.is_graded)

    plan = intervention.remediation_plan if isinstance(intervention.remediation_plan, dict) else {}
    selected = plan.get("selected_resources")
    selected = selected if isinstance(selected, list) else []

    if is_graded is None:
        treatment = plan.get("grade_treatment")
        is_graded = bool(treatment != "PRACTICE_ONLY")

    resource_keys = [
        (res.get("kind"), res.get("id"))
        for res in selected
        if isinstance(res, dict)
    ]
    if len(resource_keys) != len(set(resource_keys)):
        raise HTTPException(
            status_code=400,
            detail="Duplicate reading resources are not permitted in prerequisite selection",
        )

    readings, issues, _ = resolve_required_readings(
        db,
        intervention,
        intervention.student_id,
    )

    if issues:
        first_issue = issues[0]
        raise HTTPException(
            status_code=400,
            detail=f"Required Reading at position {first_issue.order} is unavailable ({first_issue.reason})",
        )

    if (require_readings or is_graded) and not readings:
        detail = (
            "Remediation requires at least one valid Supporting Reading"
            if require_readings and not is_graded
            else "Graded remediation requires at least one valid Supporting Reading"
        )
        raise HTTPException(
            status_code=400,
            detail=detail,
        )

    if not readings:
        return []

    items = [
        ReadingPrerequisiteSnapshotItem(
            reading_classwork_id=r.classwork_id,
            reading_assignment_id=r.assignment_id,
            display_order=r.order,
        )
        for r in readings
    ]

    if len({item.reading_assignment_id for item in items}) != len(items):
        raise HTTPException(
            status_code=400,
            detail="A Reading assignment can appear only once in a prerequisite snapshot",
        )

    return items

