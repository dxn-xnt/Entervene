from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.AcademicPathway import AcademicPathway


def get_pathway_or_404(db: Session, pathway_id: int) -> AcademicPathway:
    pathway = db.get(AcademicPathway, pathway_id)
    if not pathway:
        raise HTTPException(status_code=404, detail="Academic pathway not found.")
    return pathway


def normalize_code(code: str) -> str:
    cleaned = code.strip().lower().replace(" ", "-")
    if not cleaned:
        raise HTTPException(status_code=422, detail="Pathway code cannot be empty.")
    return cleaned
