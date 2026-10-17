from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPathway import AcademicPathway
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.OfficialSection import OfficialSection
from app.services.classes.ClassShared import normalized_text, readable_text
from app.services.pathways.PathwayScopeService import resolve_pathway_scope


def section_read(db: Session, section: OfficialSection) -> dict:
    has_class = db.query(Class.class_id).filter(
        Class.academic_year_id == section.academic_year_id,
        Class.academic_level_id == section.academic_level_id,
        func.lower(Class.section_name) == section.normalized_name,
    ).first() is not None
    return {
        "id": section.id,
        "academic_year_id": section.academic_year_id,
        "academic_level_id": section.academic_level_id,
        "section_name": section.section_name,
        "pathway_id": section.pathway_id,
        "pathway_name": section.pathway.name if section.pathway else None,
        "pathway_code": section.pathway.code if section.pathway else None,
        "is_active": section.is_active,
        "has_class": has_class,
    }


def list_official_sections(db: Session, academic_year_id: int, academic_level_id: int | None = None) -> dict:
    if db.get(AcademicYear, academic_year_id) is None:
        raise HTTPException(status_code=404, detail="Academic year not found.")
    query = db.query(OfficialSection).options(joinedload(OfficialSection.pathway)).filter(
        OfficialSection.academic_year_id == academic_year_id,
    )
    if academic_level_id is not None:
        if db.get(AcademicLevel, academic_level_id) is None:
            raise HTTPException(status_code=404, detail="Academic level not found.")
        query = query.filter(OfficialSection.academic_level_id == academic_level_id)
    sections = query.order_by(OfficialSection.academic_level_id, OfficialSection.section_name).all()
    return {"sections": [section_read(db, section) for section in sections]}


def _validate_pathway(db: Session, year_id: int, level_id: int, pathway_id: int | None) -> None:
    if db.get(AcademicYear, year_id) is None or db.get(AcademicLevel, level_id) is None:
        raise HTTPException(status_code=404, detail="Academic year or level not found.")
    required = resolve_pathway_scope(db, year_id, level_id)
    if required != (pathway_id is not None):
        raise HTTPException(status_code=422, detail="Section pathway must match this grade's academic-year pathway setting.")
    if pathway_id is not None:
        pathway = db.get(AcademicPathway, pathway_id)
        if pathway is None or not pathway.is_enabled:
            raise HTTPException(status_code=422, detail="Choose an enabled pathway.")


def create_official_section(db: Session, payload) -> dict:
    name = readable_text(payload.section_name)
    if not name:
        raise HTTPException(status_code=422, detail="Section name is required.")
    _validate_pathway(db, payload.academic_year_id, payload.academic_level_id, payload.pathway_id)
    if db.query(OfficialSection.id).filter(
        OfficialSection.academic_year_id == payload.academic_year_id,
        OfficialSection.academic_level_id == payload.academic_level_id,
        OfficialSection.normalized_name == normalized_text(name),
    ).first():
        raise HTTPException(status_code=409, detail="This official section already exists for the grade and academic year.")
    existing_class = db.query(Class).filter(
        Class.academic_year_id == payload.academic_year_id,
        Class.academic_level_id == payload.academic_level_id,
        func.lower(Class.section_name) == normalized_text(name),
    ).first()
    if existing_class and existing_class.pathway_id != payload.pathway_id:
        raise HTTPException(status_code=409, detail="An existing class with this section name has a different pathway.")
    section = OfficialSection(academic_year_id=payload.academic_year_id, academic_level_id=payload.academic_level_id,
                              section_name=name, normalized_name=normalized_text(name), pathway_id=payload.pathway_id)
    db.add(section)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This official section already exists for the grade and academic year.")
    db.refresh(section)
    return section_read(db, section)


def update_official_section(db: Session, section_id: int, payload) -> dict:
    section = db.get(OfficialSection, section_id)
    if section is None:
        raise HTTPException(status_code=404, detail="Official section not found.")
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail="Provide at least one change.")
    has_class = section_read(db, section)["has_class"]
    if has_class and any(key in changes and changes[key] != getattr(section, key) for key in ("section_name", "pathway_id", "is_active")):
        raise HTTPException(status_code=409, detail="A class uses this section. Its name, pathway, and availability cannot be changed.")
    if "section_name" in changes:
        name = readable_text(changes["section_name"])
        if not name:
            raise HTTPException(status_code=422, detail="Section name is required.")
        duplicate = db.query(OfficialSection.id).filter(
            OfficialSection.id != section.id, OfficialSection.academic_year_id == section.academic_year_id,
            OfficialSection.academic_level_id == section.academic_level_id,
            OfficialSection.normalized_name == normalized_text(name),
        ).first()
        if duplicate:
            raise HTTPException(status_code=409, detail="This official section already exists for the grade and academic year.")
        section.section_name = name
        section.normalized_name = normalized_text(name)
    if "pathway_id" in changes:
        _validate_pathway(db, section.academic_year_id, section.academic_level_id, changes["pathway_id"])
        section.pathway_id = changes["pathway_id"]
    if "is_active" in changes:
        if changes["is_active"] is None:
            raise HTTPException(status_code=422, detail="Section availability must be true or false.")
        section.is_active = changes["is_active"]
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This official section already exists for the grade and academic year.")
    db.refresh(section)
    return section_read(db, section)


def selected_official_section(db: Session, year_id: int, level_id: int, name: str) -> OfficialSection:
    section = db.query(OfficialSection).filter(
        OfficialSection.academic_year_id == year_id,
        OfficialSection.academic_level_id == level_id,
        OfficialSection.normalized_name == normalized_text(name),
        OfficialSection.is_active.is_(True),
    ).first()
    if section is None:
        raise HTTPException(status_code=422, detail="Select an active official section for this grade and academic year.")
    _validate_pathway(db, year_id, level_id, section.pathway_id)
    return section
