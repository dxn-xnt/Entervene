"""R1 bulk context reader: SELECT projections only, raw settings, no cache.

No authorization is granted by this reader. Callers must supply subject/group
IDs from an already authorized scope. No student information is selected.
Snapshot storage, the authoritative R2a frozen marker, consumer integration and
stale AI-outcome reporting deliberately do not exist in this R1 reader.
"""
from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Subject import Subject
from app.models.academic.SubjectGroup import SubjectGroup
from app.models.settings.Setting import Setting
from app.services.grading.PassingThresholdResolver import (
    GENERAL_AVERAGE_SETTING_KEY,
    PassingThresholdConfigurationError,
    PassingThresholdContext,
    SubjectGroupThresholdConfig,
    SubjectThresholdConfig,
)


def _ids(values: Iterable[int]) -> tuple[int, ...]:
    result = set()
    for value in values:
        if type(value) is not int or value <= 0:
            raise PassingThresholdConfigurationError("request_scope_invalid")
        result.add(value)
    return tuple(sorted(result))


def read_passing_threshold_context(
    db: Session, *, academic_year_id: int,
    subject_ids: Iterable[int] = (), subject_group_ids: Iterable[int] = (),
) -> PassingThresholdContext:
    """At most four SELECTs, independent of roster/list size, with no autoflush.

    Missing subjects/groups remain unresolved for the pure resolver to report per
    scope. The raw general-average setting is not parsed unless requested.
    No-active/non-active years are snapshot_required, NOT declared closed. R1
    must not query future snapshot/freeze schema; R2a must extend policy selection
    before any production consumer is migrated.
    """
    if type(academic_year_id) is not int or academic_year_id <= 0:
        raise PassingThresholdConfigurationError("academic_year_missing")
    subjects_requested = _ids(subject_ids)
    groups_requested = set(_ids(subject_group_ids))
    with db.no_autoflush:
        years = db.execute(select(AcademicYear.academic_year_id, AcademicYear.is_active).where(
            or_(AcademicYear.academic_year_id == academic_year_id, AcademicYear.is_active.is_(True))
        )).all()
        if not any(year.academic_year_id == academic_year_id for year in years):
            raise PassingThresholdConfigurationError("academic_year_missing")
        active_ids = [year.academic_year_id for year in years if year.is_active]
        if len(active_ids) > 1:
            raise PassingThresholdConfigurationError("academic_year_ambiguous")
        active_id = active_ids[0] if active_ids else None

        subjects = {}
        if subjects_requested:
            rows = db.execute(select(Subject.subject_id, Subject.subject_group_id).where(
                Subject.subject_id.in_(subjects_requested)
            )).all()
            for row in rows:
                subjects[row.subject_id] = SubjectThresholdConfig(row.subject_id, row.subject_group_id)
                if row.subject_group_id is not None:
                    groups_requested.add(row.subject_group_id)
        groups = {}
        if groups_requested:
            rows = db.execute(select(SubjectGroup.subject_group_id,
                SubjectGroup.passing_threshold, SubjectGroup.is_active).where(
                SubjectGroup.subject_group_id.in_(sorted(groups_requested))
            )).all()
            groups = {row.subject_group_id: SubjectGroupThresholdConfig(
                row.subject_group_id, row.passing_threshold, row.is_active) for row in rows}
        raw = db.execute(select(Setting.value).where(Setting.key == GENERAL_AVERAGE_SETTING_KEY)).all()
        if len(raw) > 1:
            raise PassingThresholdConfigurationError("general_average_threshold_invalid")
    return PassingThresholdContext(
        academic_year_id=academic_year_id, active_academic_year_id=active_id,
        policy_mode="live" if active_id == academic_year_id else "snapshot_required",
        subjects=subjects, subject_groups=groups,
        general_average_raw=raw[0].value if raw else None,
    )
