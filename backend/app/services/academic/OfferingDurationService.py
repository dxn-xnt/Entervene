from __future__ import annotations

from sqlalchemy.orm import Session, joinedload

from app.models.academic.Class_ import Class
from app.models.academic.SubjectOffering import SubjectOffering


def time_range_minutes(start_time: str | None, end_time: str | None) -> int | None:
    """Return the positive duration of an HH:MM range, or ``None`` if invalid."""
    if not start_time or not end_time:
        return None
    try:
        start_hour, start_minute = (int(part) for part in start_time.split(":")[:2])
        end_hour, end_minute = (int(part) for part in end_time.split(":")[:2])
    except (TypeError, ValueError):
        return None
    duration = (end_hour * 60 + end_minute) - (start_hour * 60 + start_minute)
    return duration if duration > 0 else None


def offering_is_eligible_for_class(offering: SubjectOffering, class_obj: Class) -> bool:
    if (
        offering.academic_year_id != class_obj.academic_year_id
        or offering.academic_level_id != class_obj.academic_level_id
    ):
        return False
    pathway_ids = {
        link.pathway_id for link in (offering.offering_pathways or [])
    }
    return not pathway_ids or (
        class_obj.pathway_id is not None and class_obj.pathway_id in pathway_ids
    )


def load_active_offerings(
    db: Session,
    *,
    academic_period_id: int,
    academic_year_id: int | None = None,
) -> list[SubjectOffering]:
    query = (
        db.query(SubjectOffering)
        .options(joinedload(SubjectOffering.offering_pathways))
        .filter(
            SubjectOffering.academic_period_id == academic_period_id,
            SubjectOffering.status == "active",
        )
    )
    if academic_year_id is not None:
        query = query.filter(SubjectOffering.academic_year_id == academic_year_id)
    return query.all()


def resolve_offering_for_class(
    offerings: list[SubjectOffering],
    *,
    subject_id: int,
    class_obj: Class,
    academic_period_id: int | None = None,
) -> SubjectOffering | None:
    matches = [
        offering
        for offering in offerings
        if offering.subject_id == subject_id
        and (academic_period_id is None or offering.academic_period_id == academic_period_id)
        and offering_is_eligible_for_class(offering, class_obj)
    ]
    if not matches:
        return None
    # A pathway-specific row is more precise than an unrestricted row. Conflict
    # validation prevents overlapping scopes, but this ordering is deterministic
    # for legacy data that predates that invariant.
    matches.sort(key=lambda item: 0 if item.offering_pathways else 1)
    return matches[0]
