from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.AcademicPathway import AcademicPathway
from app.schemas.AcademicPathway import AcademicPathwayRead, PathwayCreate, PathwayUpdate
from app.services.pathways.PathwayShared import get_pathway_or_404, normalize_code


def create_pathway(db: Session, payload: PathwayCreate) -> AcademicPathwayRead:
    code = normalize_code(payload.code)
    existing = db.query(AcademicPathway).filter(AcademicPathway.code == code).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Academic pathway with code '{code}' already exists.")

    pathway = AcademicPathway(
        code=code,
        name=payload.name.strip(),
        is_enabled=payload.is_enabled,
        sort_order=payload.sort_order,
        deped_cluster_id=payload.deped_cluster_id,
    )
    db.add(pathway)
    db.commit()
    db.refresh(pathway)
    return AcademicPathwayRead.model_validate(pathway)


def update_pathway(db: Session, pathway_id: int, payload: PathwayUpdate) -> AcademicPathwayRead:
    pathway = get_pathway_or_404(db, pathway_id)

    if payload.code is not None:
        new_code = normalize_code(payload.code)
        if new_code != pathway.code:
            dup = db.query(AcademicPathway).filter(AcademicPathway.code == new_code).first()
            if dup:
                raise HTTPException(status_code=409, detail=f"Academic pathway with code '{new_code}' already exists.")
            pathway.code = new_code

    if payload.name is not None:
        pathway.name = payload.name.strip()
    if payload.is_enabled is not None:
        pathway.is_enabled = payload.is_enabled
    if payload.sort_order is not None:
        pathway.sort_order = payload.sort_order
    if payload.deped_cluster_id is not None:
        pathway.deped_cluster_id = payload.deped_cluster_id

    db.commit()
    db.refresh(pathway)
    return AcademicPathwayRead.model_validate(pathway)
