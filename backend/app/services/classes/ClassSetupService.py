from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPathway import AcademicPathway
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.OfficialSection import OfficialSection
from app.models.people.AcademicStaff import AcademicStaff
from app.schemas.ClassSetup import (
    AcademicYearSetupClassItem,
    AcademicYearSetupMode,
    AcademicYearSetupRequest,
    AcademicYearSetupResponse,
    AcademicYearSetupSectionItem,
)
from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService
from app.services.classes.ClassShared import eligible_advisers_query, normalized_text, readable_text
from app.services.pathways.PathwayScopeService import clone_prior_year_pathway_scopes, resolve_pathway_scope


def setup_academic_year(db: Session, payload: AcademicYearSetupRequest) -> dict:
    """
    Atomic, idempotent preparation of sections and classes for a new academic year.

    Supports three modes:
    1. sections_only: Copy official section definitions; Admin creates classes manually.
    2. retain_classes_and_advisers: Copy sections and create independent new-year classes
       with eligible previous advisers.
    3. retain_classes_without_advisers: Copy sections and classes with unassigned advisers.

    Guarantees:
    - Never mutates source-year records.
    - Never copies enrollments (StudentClass), SubjectLoads, grades, or student records.
    - Respects future-year configuration authorization.
    - Idempotent on repeated runs (skips already-created sections and classes).
    - Clear conflict reporting with full transactional rollback.
    """
    source_year = db.get(AcademicYear, payload.source_academic_year_id)
    if source_year is None:
        raise HTTPException(status_code=404, detail="Source academic year not found.")

    target_year = db.get(AcademicYear, payload.target_academic_year_id)
    if target_year is None:
        raise HTTPException(status_code=404, detail="Target academic year not found.")

    if source_year.academic_year_id == target_year.academic_year_id:
        raise HTTPException(status_code=409, detail="Source and target academic years must be different.")

    # Authorization guard: target year must be active or future (not historical / closed)
    SubjectLoadAuthorizationService.assert_context_configurable(
        db, academic_year_id=target_year.academic_year_id
    )

    # Ensure target year has pathway scopes cloned from prior year
    clone_prior_year_pathway_scopes(db, target_year.academic_year_id, commit=False)

    # 1. Discover all unique section definitions from the source year
    # Includes both OfficialSection rows (even without classes) and any active Class sections
    sec_query = db.query(OfficialSection).filter(
        OfficialSection.academic_year_id == source_year.academic_year_id
    )
    if payload.academic_level_ids:
        sec_query = sec_query.filter(OfficialSection.academic_level_id.in_(payload.academic_level_ids))
    source_official_sections = sec_query.order_by(
        OfficialSection.academic_level_id, OfficialSection.section_name
    ).all()

    # Key: (academic_level_id, normalized_name) -> {"section_name": str, "pathway_id": int | None}
    sections_to_setup: dict[tuple[int, str], dict] = {}
    for sec in source_official_sections:
        key = (sec.academic_level_id, sec.normalized_name)
        if key not in sections_to_setup:
            sections_to_setup[key] = {
                "section_name": sec.section_name,
                "pathway_id": sec.pathway_id,
            }

    # Also discover sections from source classes to guarantee none are missed
    cls_query = db.query(Class).filter(
        Class.academic_year_id == source_year.academic_year_id,
        func.lower(Class.class_status) == "active",
    )
    if payload.academic_level_ids:
        cls_query = cls_query.filter(Class.academic_level_id.in_(payload.academic_level_ids))
    source_classes = cls_query.order_by(
        Class.academic_level_id, func.lower(Class.section_name)
    ).all()

    for c in source_classes:
        name = readable_text(c.section_name)
        norm = normalized_text(name)
        key = (c.academic_level_id, norm)
        if key not in sections_to_setup:
            sections_to_setup[key] = {
                "section_name": name,
                "pathway_id": c.pathway_id,
            }

    # 2. Existing official sections in target year (for idempotency)
    existing_target_sections = db.query(OfficialSection).filter(
        OfficialSection.academic_year_id == target_year.academic_year_id
    ).all()
    target_sections_map = {
        (s.academic_level_id, s.normalized_name): s
        for s in existing_target_sections
    }

    sections_created = 0
    sections_reused = 0
    section_items: list[AcademicYearSetupSectionItem] = []

    try:
        for (level_id, norm_name), sec_data in sections_to_setup.items():
            if (level_id, norm_name) in target_sections_map:
                existing_sec = target_sections_map[(level_id, norm_name)]
                sections_reused += 1
                section_items.append(
                    AcademicYearSetupSectionItem(
                        id=existing_sec.id,
                        academic_year_id=existing_sec.academic_year_id,
                        academic_level_id=existing_sec.academic_level_id,
                        section_name=existing_sec.section_name,
                        pathway_id=existing_sec.pathway_id,
                        is_active=existing_sec.is_active,
                        is_created=False,
                    )
                )
            else:
                requires_pathway = resolve_pathway_scope(db, target_year.academic_year_id, level_id)
                target_pathway_id: int | None = None
                if requires_pathway:
                    source_pw_id = sec_data["pathway_id"]
                    if source_pw_id is not None:
                        pathway = db.get(AcademicPathway, source_pw_id)
                        if pathway is not None and pathway.is_enabled:
                            target_pathway_id = pathway.id
                        else:
                            raise HTTPException(
                                status_code=422,
                                detail=f"Pathway for section '{sec_data['section_name']}' is disabled or unavailable in the target academic year.",
                            )
                    else:
                        raise HTTPException(
                            status_code=422,
                            detail=f"Section '{sec_data['section_name']}' requires an assigned pathway for grade {level_id} in academic year '{target_year.year_label}'.",
                        )

                new_sec = OfficialSection(
                    academic_year_id=target_year.academic_year_id,
                    academic_level_id=level_id,
                    section_name=sec_data["section_name"],
                    normalized_name=norm_name,
                    pathway_id=target_pathway_id,
                    is_active=True,
                )
                db.add(new_sec)
                db.flush()
                target_sections_map[(level_id, norm_name)] = new_sec
                sections_created += 1
                section_items.append(
                    AcademicYearSetupSectionItem(
                        id=new_sec.id,
                        academic_year_id=new_sec.academic_year_id,
                        academic_level_id=new_sec.academic_level_id,
                        section_name=new_sec.section_name,
                        pathway_id=new_sec.pathway_id,
                        is_active=new_sec.is_active,
                        is_created=True,
                    )
                )

        classes_created = 0
        classes_reused = 0
        class_items: list[AcademicYearSetupClassItem] = []

        # 3. Create or reuse classes if mode is not SECTIONS_ONLY
        if payload.mode in (
            AcademicYearSetupMode.RETAIN_CLASSES_AND_ADVISERS,
            AcademicYearSetupMode.RETAIN_CLASSES_WITHOUT_ADVISERS,
        ):
            existing_target_classes = db.query(Class).filter(
                Class.academic_year_id == target_year.academic_year_id
            ).all()

            target_class_map = {
                (c.academic_level_id, normalized_text(c.section_name)): c
                for c in existing_target_classes
            }

            assigned_advisers_in_target = {
                c.adviser_staff_id
                for c in existing_target_classes
                if c.adviser_staff_id
            }

            for sc in source_classes:
                norm_cname = normalized_text(sc.section_name)
                class_key = (sc.academic_level_id, norm_cname)

                if class_key in target_class_map:
                    existing_class = target_class_map[class_key]
                    classes_reused += 1
                    class_items.append(
                        AcademicYearSetupClassItem(
                            class_id=existing_class.class_id,
                            academic_year_id=existing_class.academic_year_id,
                            academic_level_id=existing_class.academic_level_id,
                            section_name=existing_class.section_name,
                            adviser_staff_id=existing_class.adviser_staff_id,
                            pathway_id=existing_class.pathway_id,
                            is_created=False,
                        )
                    )
                    continue

                # Determine target adviser
                target_adviser_id: str | None = None
                if payload.mode == AcademicYearSetupMode.RETAIN_CLASSES_AND_ADVISERS:
                    if sc.adviser_staff_id:
                        # Validate that adviser is an active eligible teacher
                        eligible = (
                            eligible_advisers_query(db)
                            .filter(AcademicStaff.staff_id == sc.adviser_staff_id)
                            .first()
                        )
                        if eligible is None:
                            raise HTTPException(
                                status_code=409,
                                detail=f"Adviser '{sc.adviser_staff_id}' for section '{sc.section_name}' is not an active eligible teacher.",
                            )

                        # Validate that adviser is not already assigned to another class in target year
                        if sc.adviser_staff_id in assigned_advisers_in_target:
                            raise HTTPException(
                                status_code=409,
                                detail=f"Adviser '{sc.adviser_staff_id}' is already assigned to a class in academic year '{target_year.year_label}'.",
                            )

                        assigned_advisers_in_target.add(sc.adviser_staff_id)
                        target_adviser_id = sc.adviser_staff_id

                # Resolve pathway from official section
                official = target_sections_map.get((sc.academic_level_id, norm_cname))
                target_pw_id = official.pathway_id if official else None

                new_class = Class(
                    section_name=sc.section_name,
                    class_status="active",
                    adviser_staff_id=target_adviser_id,
                    academic_year_id=target_year.academic_year_id,
                    academic_level_id=sc.academic_level_id,
                    academic_period_id=None,
                    pathway_id=target_pw_id,
                    period_template_group=sc.period_template_group,
                )
                db.add(new_class)
                db.flush()
                target_class_map[class_key] = new_class
                classes_created += 1
                class_items.append(
                    AcademicYearSetupClassItem(
                        class_id=new_class.class_id,
                        academic_year_id=new_class.academic_year_id,
                        academic_level_id=new_class.academic_level_id,
                        section_name=new_class.section_name,
                        adviser_staff_id=new_class.adviser_staff_id,
                        pathway_id=new_class.pathway_id,
                        is_created=True,
                    )
                )

        db.commit()

        return {
            "source_academic_year_id": source_year.academic_year_id,
            "target_academic_year_id": target_year.academic_year_id,
            "mode": payload.mode.value,
            "sections_created": sections_created,
            "sections_reused": sections_reused,
            "classes_created": classes_created,
            "classes_reused": classes_reused,
            "sections": [s.model_dump() for s in section_items],
            "classes": [c.model_dump() for c in class_items],
        }

    except Exception:
        db.rollback()
        raise

