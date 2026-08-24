from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Subject import Subject
from app.models.academic.SubjectOffering import SubjectOffering


GENERAL_PATHWAY = "general"
SHS_PATHWAYS = {"both", "stem_medical", "stem_engineering"}
ALLOWED_PATHWAYS = [GENERAL_PATHWAY, "both", "stem_medical", "stem_engineering"]
ALLOWED_OFFERING_STATUSES = ["active", "archived"]
DEFAULT_OFFERING_STATUS = "active"
INACTIVE_ACADEMIC_YEAR_READ_ONLY_MESSAGE = (
    "Subject offerings for inactive academic years are read-only to protect historical records."
)


def readable_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def normalized_text(value: Any) -> str:
    return readable_text(value).casefold()


def normalize_pathway(value: Any) -> str:
    pathway = normalized_text(value)
    if pathway not in ALLOWED_PATHWAYS:
        raise HTTPException(status_code=422, detail="Pathway must be general, both, stem_medical, or stem_engineering.")
    return pathway


def validate_pathway_for_grade(
    pathway: str,
    academic_level: AcademicLevel,
    academic_year_id: int | None = None,
    db: Session | None = None,
) -> None:
    pathway = normalize_pathway(pathway)
    if db is not None and academic_year_id is not None:
        from app.services.pathways.PathwayScopeService import resolve_pathway_scope
        requires_pathway = resolve_pathway_scope(db, academic_year_id, academic_level.academic_level_id)
    else:
        requires_pathway = (academic_level.grade_level == 11)

    if not requires_pathway and pathway != GENERAL_PATHWAY:
        raise HTTPException(
            status_code=422,
            detail=f"Grade {academic_level.grade_level} offerings must use the general pathway for this academic year.",
        )
    if requires_pathway and pathway == GENERAL_PATHWAY:
        raise HTTPException(
            status_code=422,
            detail=f"Grade {academic_level.grade_level} offerings require a specific pathway for this academic year.",
        )


def normalize_offering_status(value: Any) -> str:
    status = normalized_text(value or DEFAULT_OFFERING_STATUS)
    if status not in ALLOWED_OFFERING_STATUSES:
        raise HTTPException(status_code=422, detail="Subject offering status must be active or archived.")
    return status


def get_subject_or_404(db: Session, subject_id: int) -> Subject:
    subject = db.query(Subject).filter(Subject.subject_id == subject_id).first()
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found.")
    return subject


def get_active_subject_or_404(db: Session, subject_id: int) -> Subject:
    subject = get_subject_or_404(db, subject_id)
    if (subject.status or "active").casefold() != "active":
        raise HTTPException(status_code=422, detail="Subject must be active before it can be offered.")
    return subject


def get_academic_year_or_404(db: Session, academic_year_id: int) -> AcademicYear:
    academic_year = db.query(AcademicYear).filter(AcademicYear.academic_year_id == academic_year_id).first()
    if academic_year is None:
        raise HTTPException(status_code=404, detail="Academic year not found.")
    return academic_year


def ensure_academic_year_is_active(academic_year: AcademicYear) -> None:
    if not academic_year.is_active:
        raise HTTPException(status_code=409, detail=INACTIVE_ACADEMIC_YEAR_READ_ONLY_MESSAGE)


def get_academic_level_or_404(db: Session, academic_level_id: int) -> AcademicLevel:
    academic_level = db.query(AcademicLevel).filter(AcademicLevel.academic_level_id == academic_level_id).first()
    if academic_level is None:
        raise HTTPException(status_code=404, detail="Academic level not found.")
    return academic_level


def get_academic_period_or_404(db: Session, academic_period_id: int) -> AcademicPeriod:
    academic_period = db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id == academic_period_id).first()
    if academic_period is None:
        raise HTTPException(status_code=404, detail="Academic period not found.")
    return academic_period


def validate_offering_scope(
    db: Session,
    subject_id: int,
    academic_year_id: int,
    academic_level_id: int,
    academic_period_id: int,
) -> tuple[Subject, AcademicYear, AcademicLevel, AcademicPeriod]:
    subject = get_active_subject_or_404(db, subject_id)
    academic_year = get_academic_year_or_404(db, academic_year_id)
    academic_level = get_academic_level_or_404(db, academic_level_id)
    academic_period = get_academic_period_or_404(db, academic_period_id)

    if academic_period.academic_year_id != academic_year.academic_year_id:
        raise HTTPException(status_code=422, detail="Academic period must belong to the selected academic year.")
    if subject.academic_level_id != academic_level.academic_level_id:
        raise HTTPException(status_code=422, detail="Subject grade level must match the offering grade level.")

    return subject, academic_year, academic_level, academic_period


def validate_core_subject_pathway_restriction(subject: Subject, pathway_ids: list[int] | None) -> None:
    if getattr(subject, "is_core", False) and pathway_ids:
        raise HTTPException(
            status_code=422,
            detail="Core subjects are mandatory for all pathways and cannot have pathway restrictions.",
        )


def validate_subject_is_core_toggle(db: Session, subject_id: int, new_is_core: bool) -> None:
    if new_is_core:
        from app.models.academic.SubjectOfferingPathway import SubjectOfferingPathway
        conflict = (
            db.query(SubjectOfferingPathway)
            .join(SubjectOffering, SubjectOfferingPathway.subject_offering_id == SubjectOffering.subject_offering_id)
            .filter(SubjectOffering.subject_id == subject_id)
            .first()
        )
        if conflict:
            raise HTTPException(
                status_code=422,
                detail="Cannot mark subject as core while active pathway-restricted offerings exist for it. Remove pathway restrictions from its offerings first.",
            )


def ensure_offering_available(
    db: Session,
    subject_id: int,
    academic_year_id: int,
    academic_level_id: int,
    academic_period_id: int,
    pathway_ids: list[int] | None = None,
    exclude_subject_offering_id: int | None = None,
) -> None:
    from app.models.academic.SubjectOfferingPathway import SubjectOfferingPathway
    new_set = set(pathway_ids or [])

    query = db.query(SubjectOffering).filter(
        SubjectOffering.subject_id == subject_id,
        SubjectOffering.academic_year_id == academic_year_id,
        SubjectOffering.academic_level_id == academic_level_id,
        SubjectOffering.academic_period_id == academic_period_id,
    )
    if exclude_subject_offering_id is not None:
        query = query.filter(SubjectOffering.subject_offering_id != exclude_subject_offering_id)

    existing_offerings = query.all()
    for offering in existing_offerings:
        existing_set = {link.pathway_id for link in offering.offering_pathways}
        if not new_set or not existing_set:
            raise HTTPException(
                status_code=409,
                detail="Subject offering already exists for this scope and pathway.",
            )
        if new_set & existing_set:
            raise HTTPException(
                status_code=409,
                detail="Subject offering conflicts with an existing pathway-specific offering.",
            )


def get_offering_legacy_pathway(offering: SubjectOffering) -> str:
    pathway_links = getattr(offering, "offering_pathways", None) or []
    pathway_ids = [p.pathway_id for p in pathway_links if p]
    if not pathway_ids:
        return getattr(offering, "pathway", None) or "general"
    if len(pathway_ids) == 1:
        pw = getattr(pathway_links[0], "pathway", None)
        if pw and getattr(pw, "code", None):
            code = str(pw.code).lower()
            if "medical" in code:
                return "stem_medical"
            if "engineering" in code:
                return "stem_engineering"
            return code
        return "general"
    return "both"


def offering_to_item(
    offering: SubjectOffering,
    subject: Subject | None = None,
    academic_year: AcademicYear | None = None,
    academic_level: AcademicLevel | None = None,
    academic_period: AcademicPeriod | None = None,
) -> dict:
    subject = subject or offering.subject
    academic_year = academic_year or offering.academic_year
    academic_level = academic_level or offering.academic_level
    academic_period = academic_period or offering.academic_period

    pathway_links = offering.offering_pathways or []
    pathways_data = [
        {
            "id": p.pathway.id,
            "code": p.pathway.code,
            "name": p.pathway.name,
            "is_enabled": p.pathway.is_enabled,
            "sort_order": p.pathway.sort_order,
            "deped_cluster_id": p.pathway.deped_cluster_id,
        }
        for p in pathway_links
        if p.pathway
    ]
    pathway_ids = [p["id"] for p in pathways_data]
    legacy_pathway = get_offering_legacy_pathway(offering)

    return {
        "subject_offering_id": offering.subject_offering_id,
        "subject": {
            "subject_id": subject.subject_id,
            "subject_name": subject.subject_name,
            "subject_codename": subject.subject_codename,
            "subject_group": subject.subject_group,
            "default_grading_template": subject.default_grading_template,
            "is_core": getattr(subject, "is_core", False),
        },
        "academic_year": {
            "academic_year_id": academic_year.academic_year_id,
            "year_label": academic_year.year_label,
            "is_active": academic_year.is_active,
        },
        "academic_level": {
            "academic_level_id": academic_level.academic_level_id,
            "level_name": academic_level.level_name,
            "grade_level": academic_level.grade_level,
        },
        "academic_period": {
            "academic_period_id": academic_period.academic_period_id,
            "period_name": academic_period.period_name,
            "period_type": academic_period.period_type,
            "period_sequence": academic_period.period_sequence,
            "academic_year_id": academic_period.academic_year_id,
        },
        "pathway": legacy_pathway,
        "pathway_ids": pathway_ids,
        "pathways": pathways_data,
        "minutes": getattr(offering, "minutes", None),
        "status": offering.status or DEFAULT_OFFERING_STATUS,
        "created_at": offering.created_at,
        "updated_at": offering.updated_at,
    }
