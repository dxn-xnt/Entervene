from __future__ import annotations

from typing import List
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AcademicLevelPathwayScope import AcademicLevelPathwayScope
from app.schemas.AcademicLevelPathwayScope import (
    PathwayScopeBatchPayload,
    PathwayScopeListResponse,
    PathwayScopeRead,
)


def resolve_pathway_scope(db: Session, academic_year_id: int, academic_level_id: int) -> bool:
    """
    Resolves whether a grade level requires DO 017 pathway assignment for a given academic year.
    Fallback priority:
    1. Explicit scope row for (academic_year_id, academic_level_id).
    2. Prior year scope row for the same academic_level_id (carries forward prior year settings).
    3. Static bootstrap default: Grade 11 requires pathway, all others do not.
    """
    scope = (
        db.query(AcademicLevelPathwayScope)
        .filter(
            AcademicLevelPathwayScope.academic_year_id == academic_year_id,
            AcademicLevelPathwayScope.academic_level_id == academic_level_id,
        )
        .first()
    )
    if scope is not None:
        return scope.requires_pathway

    current_year = (
        db.query(AcademicYear)
        .filter(AcademicYear.academic_year_id == academic_year_id)
        .first()
    )

    if current_year is not None:
        prior_scope = (
            db.query(AcademicLevelPathwayScope)
            .join(AcademicYear, AcademicYear.academic_year_id == AcademicLevelPathwayScope.academic_year_id)
            .filter(
                AcademicLevelPathwayScope.academic_level_id == academic_level_id,
                AcademicYear.start_date < current_year.start_date,
            )
            .order_by(AcademicYear.start_date.desc())
            .first()
        )
        if prior_scope is not None:
            return prior_scope.requires_pathway

    level = (
        db.query(AcademicLevel)
        .filter(AcademicLevel.academic_level_id == academic_level_id)
        .first()
    )
    if level is not None:
        return level.grade_level == 11

    return False


def get_pathway_scopes_for_year(db: Session, academic_year_id: int) -> PathwayScopeListResponse:
    levels = (
        db.query(AcademicLevel)
        .order_by(AcademicLevel.grade_level.asc())
        .all()
    )

    items: List[PathwayScopeRead] = []
    for level in levels:
        scope_row = (
            db.query(AcademicLevelPathwayScope)
            .filter(
                AcademicLevelPathwayScope.academic_year_id == academic_year_id,
                AcademicLevelPathwayScope.academic_level_id == level.academic_level_id,
            )
            .first()
        )

        requires = resolve_pathway_scope(db, academic_year_id, level.academic_level_id)

        items.append(
            PathwayScopeRead(
                id=scope_row.id if scope_row else None,
                academic_year_id=academic_year_id,
                academic_level_id=level.academic_level_id,
                grade_level=level.grade_level,
                level_name=level.level_name,
                requires_pathway=requires,
            )
        )

    return PathwayScopeListResponse(academic_year_id=academic_year_id, scopes=items)


def upsert_pathway_scopes(db: Session, payload: PathwayScopeBatchPayload) -> PathwayScopeListResponse:
    for item in payload.scopes:
        scope = (
            db.query(AcademicLevelPathwayScope)
            .filter(
                AcademicLevelPathwayScope.academic_year_id == payload.academic_year_id,
                AcademicLevelPathwayScope.academic_level_id == item.academic_level_id,
            )
            .first()
        )

        if scope is not None:
            scope.requires_pathway = item.requires_pathway
        else:
            scope = AcademicLevelPathwayScope(
                academic_year_id=payload.academic_year_id,
                academic_level_id=item.academic_level_id,
                requires_pathway=item.requires_pathway,
            )
            db.add(scope)

    db.commit()
    return get_pathway_scopes_for_year(db, payload.academic_year_id)


def clone_prior_year_pathway_scopes(db: Session, target_academic_year_id: int) -> int:
    target_year = (
        db.query(AcademicYear)
        .filter(AcademicYear.academic_year_id == target_academic_year_id)
        .first()
    )
    if target_year is None:
        return 0

    prior_year = (
        db.query(AcademicYear)
        .filter(AcademicYear.start_date < target_year.start_date)
        .order_by(AcademicYear.start_date.desc())
        .first()
    )

    levels = db.query(AcademicLevel).all()
    created_count = 0

    for level in levels:
        existing = (
            db.query(AcademicLevelPathwayScope)
            .filter(
                AcademicLevelPathwayScope.academic_year_id == target_academic_year_id,
                AcademicLevelPathwayScope.academic_level_id == level.academic_level_id,
            )
            .first()
        )
        if existing is not None:
            continue

        requires = resolve_pathway_scope(
            db,
            prior_year.academic_year_id if prior_year else target_academic_year_id,
            level.academic_level_id,
        )

        new_scope = AcademicLevelPathwayScope(
            academic_year_id=target_academic_year_id,
            academic_level_id=level.academic_level_id,
            requires_pathway=requires,
        )
        db.add(new_scope)
        created_count += 1

    if created_count > 0:
        db.commit()

    return created_count
