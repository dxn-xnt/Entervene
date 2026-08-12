from __future__ import annotations

from sqlalchemy.orm import Session
from sqlalchemy.sql import func

from app.models.academic.AcademicPathway import AcademicPathway
from app.schemas.AcademicPathway import AcademicPathwayRead, PathwayListResponse


def list_pathways(
    db: Session,
    is_enabled: bool | None = None,
) -> PathwayListResponse:
    query = db.query(AcademicPathway)
    if is_enabled is not None:
        query = query.filter(AcademicPathway.is_enabled.is_(is_enabled))
    pathways = query.order_by(AcademicPathway.sort_order, func.lower(AcademicPathway.name)).all()
    return PathwayListResponse(
        pathways=[AcademicPathwayRead.model_validate(p) for p in pathways]
    )


def get_pathway(db: Session, pathway_id: int) -> AcademicPathwayRead:
    from app.services.pathways.PathwayShared import get_pathway_or_404
    pathway = get_pathway_or_404(db, pathway_id)
    return AcademicPathwayRead.model_validate(pathway)
