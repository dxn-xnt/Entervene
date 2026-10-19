"""PR 1a: bounded, SELECT-only template policy reader for an explicit year.

Authorization belongs to the caller. The current schema has no closure marker:
every existing requested year uses live policy, whether active or inactive.
No future columns/tables are queried. PR 2 must replace that schema-phase policy
selection with the authoritative closure marker and snapshots.
"""
from __future__ import annotations

from collections.abc import Iterable
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Subject import Subject
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.settings.Setting import Setting
from app.services.grading.PassingThresholdResolver import (
    GENERAL_AVERAGE_SETTING_KEY, PassingThresholdConfigurationError,
    PassingThresholdContext, PassingThresholdResolution, SubjectThresholdConfig,
    TemplateThresholdConfig, resolve_passing_threshold,
)


def _ids(values: Iterable[int]) -> tuple[int, ...]:
    result = set()
    for value in values:
        if type(value) is not int or value <= 0:
            raise PassingThresholdConfigurationError("request_scope_invalid")
        result.add(value)
    return tuple(sorted(result))


def read_passing_threshold_context(
    db: Session, *, academic_year_id: int, subject_ids: Iterable[int] = (),
) -> PassingThresholdContext:
    """At most three SELECTs, independent of subject/learner count; no autoflush.

    Raw global general-average text is transitional legacy configuration only.
    Its presence never initializes a year-specific policy. Missing/invalid subject
    configuration stays unresolved for an explicit per-subject error.
    """
    if type(academic_year_id) is not int or academic_year_id <= 0:
        raise PassingThresholdConfigurationError("academic_year_missing")
    ids = _ids(subject_ids)
    with db.no_autoflush:
        year = db.execute(select(AcademicYear.academic_year_id).where(
            AcademicYear.academic_year_id == academic_year_id)).scalar_one_or_none()
        if year is None:
            raise PassingThresholdConfigurationError("academic_year_missing")
        subjects, templates = {}, {}
        if ids:
            rows = db.execute(select(
                Subject.subject_id, Subject.grading_template_id,
                GradingTemplate.grading_template_id.label("linked_template_id"),
                GradingTemplate.passing_threshold,
            ).outerjoin(GradingTemplate, Subject.grading_template_id == GradingTemplate.grading_template_id)
                .where(Subject.subject_id.in_(ids))).all()
            for row in rows:
                subjects[row.subject_id] = SubjectThresholdConfig(row.subject_id, row.grading_template_id)
                if row.linked_template_id is not None:
                    templates[row.linked_template_id] = TemplateThresholdConfig(
                        row.linked_template_id, row.passing_threshold)
        raw = db.execute(select(Setting.value).where(Setting.key == GENERAL_AVERAGE_SETTING_KEY)).all()
        if len(raw) > 1:
            raise PassingThresholdConfigurationError("general_average_threshold_invalid")
    return PassingThresholdContext(
        academic_year_id=academic_year_id, policy_mode="live",
        subjects=subjects, grading_templates=templates,
        general_average_raw=raw[0].value if raw else None,
    )


def read_passing_threshold_context_or_422(
    db: Session, *, academic_year_id: int, subject_ids: Iterable[int] = (),
) -> PassingThresholdContext:
    """Sanitized application boundary; the low-level reader retains typed errors."""
    from fastapi import HTTPException

    try:
        return read_passing_threshold_context(
            db, academic_year_id=academic_year_id, subject_ids=subject_ids)
    except PassingThresholdConfigurationError as error:
        raise HTTPException(status_code=422,
                            detail={"code": error.code, "message": str(error)}) from None


def require_subject_passing_threshold(
    db: Session, *, academic_year_id: int, subject_id: int,
    context: PassingThresholdContext | None = None,
) -> PassingThresholdResolution:
    """Application adapter: explicit sanitized 422, never an empty-success fallback."""
    from fastapi import HTTPException

    try:
        if context is None:
            context = read_passing_threshold_context(
                db, academic_year_id=academic_year_id, subject_ids=[subject_id])
        return resolve_passing_threshold(
            context, academic_year_id=academic_year_id, scope="subject", subject_id=subject_id)
    except PassingThresholdConfigurationError as error:
        raise HTTPException(status_code=422,
                            detail={"code": error.code, "message": str(error)}) from None
