from datetime import date as date_type, datetime
from typing import Any
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session
from app.core.Dependencies import require_role, get_optional_staff_id, get_student_record
from app.api.v1.routes.Auth import get_current_user
from app.db.Session import get_db
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPathway import AcademicPathway
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.people.AcademicStaff import AcademicStaff
from app.models.academic.SubjectOffering import SubjectOffering
from app.models.academic.PeriodTemplateSlot import PeriodTemplateSlot
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.SubjectLoadAssignmentLog import SubjectLoadAssignmentLog
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.services.academic.SubjectLoadDependencyService import SubjectLoadDependencyService, ChangeType
from app.schemas.SubjectLoad import (
    ValidateSubjectLoadRequest,
    ValidationResultResponse,
    AutoScheduleResponse,
    BatchSaveSubjectLoadRequest,
    BatchSaveSubjectLoadResponse,
    SubjectLoadItem,
    PeriodTemplateSlotSchema,
    PeriodTemplateOverridePreviewRequest,
    PeriodTemplateOverrideApplyRequest,
    UnlockSectionRequest,
    DiscardDraftRequest,
    SectionDraftResponse,
    TeacherAcademicScopeResponse,
)
from app.services.academic.TeacherAcademicScopeService import get_teacher_academic_scope
from pydantic import BaseModel
from sqlalchemy import text
from app.services.academic.ConflictDetectorService import ConflictDetectorService
from app.services.academic.AutoSchedulerService import AutoSchedulerService
from app.services.classes.ClassQueryService import class_pathway_code
from app.services.pathways.PathwayScopeService import resolve_pathway_scope
from app.services.academic.SubstitutionService import SubstitutionService
from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService
from app.services.academic.AcademicLifecycleService import resolve_active_academic_period
from app.services.academic.PeriodTemplateResolver import PeriodTemplateResolver
from app.services.academic.PeriodTemplateRevisionService import PeriodTemplateRevisionService

router = APIRouter()

JHS_TEMPLATE_GROUP = "JHS_45MIN"
JHS_REQUIRED_SLOT_NAMES = (
    "Homeroom Guidance",
    "Period 1",
    "Period 2",
    "Morning Recess",
    "Period 3",
    "Period 4",
    "Period 5",
    "Lunch Break",
    "Enhanced Period 1",
    "Enhanced Period 2",
    "Afternoon Recess",
    "Period 6",
    "Period 7",
)


def _resolve_requested_or_active_period(
    db: Session,
    academic_period_id: int | None,
) -> AcademicPeriod:
    if academic_period_id is not None:
        period = db.get(AcademicPeriod, academic_period_id)
        if period is None:
            raise HTTPException(status_code=404, detail="Academic period not found.")
        return period
    return resolve_active_academic_period(db)


def _effective_period_template_payload(
    db: Session,
    *,
    academic_year_id: int,
    classes: list[Class] | None = None,
) -> list[dict[str, Any]]:
    base_groups = {"JHS_45MIN", "SHS_CAMPOS_ZARA", "SHS_DELMUNDO_REYES"}
    base_groups.update(
        (class_.period_template_group or JHS_TEMPLATE_GROUP)
        for class_ in (classes or [])
    )
    result: list[dict[str, Any]] = []
    representative_by_group = {
        (class_.period_template_group or JHS_TEMPLATE_GROUP): class_
        for class_ in (classes or [])
    }
    for base_group in sorted(base_groups):
        representative = representative_by_group.get(base_group)
        resolved_slots = (
            PeriodTemplateResolver.slots_for_class(db, representative)
            if representative is not None
            else PeriodTemplateResolver.slots_for_group(
                db,
                base_group=base_group,
                academic_year_id=academic_year_id,
            )
        )
        for slot in resolved_slots:
            result.append({
                "slot_id": slot.slot_id,
                "template_group": base_group,
                "slot_name": slot.slot_name,
                "slot_type": slot.slot_type,
                "start_time": slot.start_time,
                "end_time": slot.end_time,
                "is_locked_break": slot.is_locked_break,
                "display_order": slot.display_order,
            })
    return result



def ensure_default_period_templates(db: Session):
    try:
        db.execute(text("ALTER TABLE subject ADD COLUMN IF NOT EXISTS is_math_or_science BOOLEAN DEFAULT FALSE;"))
        db.execute(text("ALTER TABLE subject ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';"))
        db.execute(text("ALTER TABLE subject ADD COLUMN IF NOT EXISTS academic_level_id INTEGER;"))
        db.execute(text("ALTER TABLE subject ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();"))
        db.execute(text("ALTER TABLE subject ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();"))
        db.execute(text("ALTER TABLE subject_load ADD COLUMN IF NOT EXISTS slot_id INTEGER;"))
        db.commit()
    except Exception:
        db.rollback()

    try:
        PeriodTemplateSlot.__table__.create(bind=db.get_bind(), checkfirst=True)
    except Exception:
        pass

    defaults = [
        # JHS 45MIN
        ("JHS_45MIN", "Homeroom Guidance", "HOMEROOM", "07:30", "08:00", True, 1),
        ("JHS_45MIN", "Period 1", "CLASS", "08:00", "08:45", False, 2),
        ("JHS_45MIN", "Period 2", "CLASS", "08:45", "09:30", False, 3),
        ("JHS_45MIN", "Morning Recess", "RECESS", "09:30", "09:45", True, 4),
        ("JHS_45MIN", "Period 3", "CLASS", "09:45", "10:30", False, 5),
        ("JHS_45MIN", "Period 4", "CLASS", "10:30", "11:15", False, 6),
        ("JHS_45MIN", "Period 5", "CLASS", "11:15", "12:00", False, 7),
        ("JHS_45MIN", "Lunch Break", "LUNCH", "12:00", "13:00", True, 8),
        ("JHS_45MIN", "Enhanced Period 1", "CLASS", "13:00", "14:00", False, 9),
        ("JHS_45MIN", "Enhanced Period 2", "CLASS", "14:00", "15:00", False, 10),
        ("JHS_45MIN", "Afternoon Recess", "RECESS", "15:00", "15:30", True, 11),
        ("JHS_45MIN", "Period 6", "CLASS", "15:30", "16:15", False, 12),
        ("JHS_45MIN", "Period 7", "CLASS", "16:15", "17:00", False, 13),
        # SHS CAMPOS ZARA
        ("SHS_CAMPOS_ZARA", "Homeroom Guidance", "HOMEROOM", "07:30", "08:00", True, 1),
        ("SHS_CAMPOS_ZARA", "Period 1", "CLASS", "08:00", "09:00", False, 2),
        ("SHS_CAMPOS_ZARA", "Period 2", "CLASS", "09:00", "10:00", False, 3),
        ("SHS_CAMPOS_ZARA", "Morning Recess", "RECESS", "10:00", "10:24", True, 4),
        ("SHS_CAMPOS_ZARA", "Lab Block", "CLASS", "10:24", "12:00", False, 5),
        ("SHS_CAMPOS_ZARA", "Lunch Break", "LUNCH", "12:00", "13:00", True, 6),
        ("SHS_CAMPOS_ZARA", "Period 3", "CLASS", "13:00", "14:00", False, 7),
        ("SHS_CAMPOS_ZARA", "Period 4", "CLASS", "14:00", "15:00", False, 8),
        ("SHS_CAMPOS_ZARA", "Afternoon Recess", "RECESS", "15:00", "15:30", True, 9),
        ("SHS_CAMPOS_ZARA", "Period 5", "CLASS", "15:30", "16:30", False, 10),
        # SHS DELMUNDO REYES
        ("SHS_DELMUNDO_REYES", "Homeroom Guidance", "HOMEROOM", "07:30", "08:00", True, 1),
        ("SHS_DELMUNDO_REYES", "Period 1", "CLASS", "08:00", "09:12", False, 2),
        ("SHS_DELMUNDO_REYES", "Period 2", "CLASS", "09:12", "10:24", False, 3),
        ("SHS_DELMUNDO_REYES", "Morning Recess", "RECESS", "10:24", "10:48", True, 4),
        ("SHS_DELMUNDO_REYES", "Period 3", "CLASS", "10:48", "12:00", False, 5),
        ("SHS_DELMUNDO_REYES", "Lunch Break", "LUNCH", "12:00", "13:00", True, 6),
        ("SHS_DELMUNDO_REYES", "Period 4", "CLASS", "13:00", "14:12", False, 7),
        ("SHS_DELMUNDO_REYES", "Period 5", "CLASS", "14:12", "15:24", False, 8),
        ("SHS_DELMUNDO_REYES", "Afternoon Recess", "RECESS", "15:24", "15:50", True, 9),
        ("SHS_DELMUNDO_REYES", "Period 6 (PE)", "CLASS", "15:50", "16:50", False, 10),
    ]

    for grp, name, stype, start, end, locked, ord_idx in defaults:
        existing = db.query(PeriodTemplateSlot).filter(
            PeriodTemplateSlot.template_group == grp,
            PeriodTemplateSlot.slot_name == name,
        ).first()
        if existing:
            continue
        db.add(
            PeriodTemplateSlot(
                template_group=grp,
                slot_name=name,
                slot_type=stype,
                start_time=start,
                end_time=end,
                is_locked_break=locked,
                display_order=ord_idx,
            )
        )
    db.commit()


def ensure_jhs_template_assignments_and_backfill(db: Session) -> dict[str, Any]:
    """Keep every active Grade 7-10 section on the shared JHS template.

    Only draft rows are migrated. Published history is deliberately immutable;
    it is interpreted against an exact slot match when read/validated instead.
    """
    jhs_level_ids = {
        level_id for level_id, in db.query(AcademicLevel.academic_level_id).filter(
            AcademicLevel.grade_level.between(7, 10)
        ).all()
    }
    classes = db.query(Class).filter(
        Class.class_status == "active",
        Class.academic_level_id.in_(jhs_level_ids),
    ).all() if jhs_level_ids else []

    corrected_classes: list[str] = []
    class_ids: list[int] = []
    for cls in classes:
        class_ids.append(cls.class_id)
        if cls.period_template_group is None:
            cls.period_template_group = JHS_TEMPLATE_GROUP
            corrected_classes.append(cls.section_name)

    class_slots = db.query(PeriodTemplateSlot).filter(
        PeriodTemplateSlot.template_group == JHS_TEMPLATE_GROUP,
        PeriodTemplateSlot.slot_type == "CLASS",
        PeriodTemplateSlot.is_locked_break.is_(False),
    ).all()
    by_time: dict[tuple[str, str], list[PeriodTemplateSlot]] = {}
    for slot in class_slots:
        by_time.setdefault((slot.start_time, slot.end_time), []).append(slot)

    backfilled = 0
    unmatched = 0
    if class_ids:
        legacy_drafts = db.query(SubjectLoad).filter(
            SubjectLoad.class_id.in_(class_ids),
            SubjectLoad.status == "draft",
            SubjectLoad.slot_id.is_(None),
            SubjectLoad.start_time.is_not(None),
            SubjectLoad.end_time.is_not(None),
        ).all()
        for load in legacy_drafts:
            matches = by_time.get((load.start_time, load.end_time), [])
            if len(matches) == 1:
                load.slot_id = matches[0].slot_id
                backfilled += 1
            else:
                unmatched += 1

    if corrected_classes or backfilled:
        db.commit()

    return {
        "template_group": JHS_TEMPLATE_GROUP,
        "corrected_class_count": len(corrected_classes),
        "corrected_classes": corrected_classes,
        "draft_loads_backfilled": backfilled,
        "draft_loads_unmatched": unmatched,
    }


def _normalize_jhs_load_slots(
    db: Session,
    loads: list[SubjectLoadItem],
) -> list[SubjectLoadItem]:
    """Derive JHS times from slot_id and reject client-authored bell times."""
    ensure_default_period_templates(db)
    class_ids = {item.class_id for item in loads}
    classes = {
        cls.class_id: cls
        for cls in db.query(Class).filter(Class.class_id.in_(class_ids)).all()
    } if class_ids else {}
    level_ids = {cls.academic_level_id for cls in classes.values()}
    grades = {
        row.academic_level_id: row.grade_level
        for row in db.query(AcademicLevel).filter(AcademicLevel.academic_level_id.in_(level_ids)).all()
    } if level_ids else {}
    slot_ids = {item.slot_id for item in loads if item.slot_id is not None}
    slots = {
        slot.slot_id: slot
        for slot in db.query(PeriodTemplateSlot).filter(PeriodTemplateSlot.slot_id.in_(slot_ids)).all()
    } if slot_ids else {}
    exact_slots_by_class: dict[int, list[PeriodTemplateSlot]] = {}
    for class_id, cls in classes.items():
        exact_slots_by_class[class_id] = [
            slot for slot in PeriodTemplateResolver.slots_for_class(db, cls)
            if slot.slot_type == "CLASS" and not slot.is_locked_break
        ]

    normalized: list[SubjectLoadItem] = []
    for item in loads:
        cls = classes.get(item.class_id)
        is_jhs = (
            cls is not None
            and grades.get(cls.academic_level_id) in range(7, 11)
        )
        if not is_jhs:
            normalized.append(item)
            continue

        slot = slots.get(item.slot_id) if item.slot_id is not None else None
        # Preserve immutable legacy publications in validation requests by
        # resolving an exact match in memory. Draft/client edits must send ID.
        if slot is None and item.status in ("published", "active") and item.start_time and item.end_time:
            matches = [
                candidate for candidate in exact_slots_by_class.get(item.class_id, [])
                if candidate.start_time == item.start_time and candidate.end_time == item.end_time
            ]
            slot = matches[0] if len(matches) == 1 else None
        if slot is None:
            if item.status in ("published", "active") and item.is_locked:
                normalized.append(item)
                continue
            if item.slot_id is not None:
                raise HTTPException(
                    status_code=422,
                    detail=f"Grade 7-10 load {item.class_id}_{item.subject_id} must select a valid JHS timetable slot.",
                )
            # Legacy API clients may still submit explicit times without a
            # slot_id. Preserve that existing contract; Studio-generated
            # schedules use slot IDs and are resolved authoritatively above.
            normalized.append(item)
            continue
        allowed_slot_ids = {candidate.slot_id for candidate in exact_slots_by_class.get(item.class_id, [])}
        if (
            slot.slot_id not in allowed_slot_ids
            or slot.slot_type != "CLASS"
            or slot.is_locked_break
        ):
            raise HTTPException(
                status_code=422,
                detail=f"Slot {slot.slot_id} is not an assignable Grade 7-10 class period.",
            )
        normalized.append(item.model_copy(update={
            "slot_id": slot.slot_id,
            "start_time": slot.start_time,
            "end_time": slot.end_time,
        }))
    return normalized


def _attach_server_generated_slot_ids(
    db: Session,
    loads: list[SubjectLoadItem],
) -> list[SubjectLoadItem]:
    """Attach the unique CLASS slot matching server-generated schedule times."""
    class_ids = {item.class_id for item in loads}
    classes = {
        cls.class_id: cls
        for cls in db.query(Class).filter(Class.class_id.in_(class_ids)).all()
    } if class_ids else {}
    candidates: list[PeriodTemplateSlot] = []
    for class_ in classes.values():
        candidates.extend(
            slot for slot in PeriodTemplateResolver.slots_for_class(db, class_)
            if slot.slot_type == "CLASS" and not slot.is_locked_break
        )
    by_key: dict[tuple[str, str, str], list[PeriodTemplateSlot]] = {}
    for slot in candidates:
        by_key.setdefault((slot.template_group, slot.start_time, slot.end_time), []).append(slot)

    result: list[SubjectLoadItem] = []
    for item in loads:
        cls = classes.get(item.class_id)
        if not cls or not item.start_time or not item.end_time:
            result.append(item.model_copy(update={"slot_id": None}) if not item.start_time else item)
            continue
        group = PeriodTemplateResolver.effective_group(
            db,
            base_group=cls.period_template_group or JHS_TEMPLATE_GROUP,
            academic_year_id=cls.academic_year_id,
        )
        matches = by_key.get((group, item.start_time, item.end_time), [])
        result.append(item.model_copy(update={"slot_id": matches[0].slot_id if len(matches) == 1 else None}))
    return result


def ensure_shs_template_groups_backfilled(db: Session):
    """
    Idempotent one-time backfill:
    - Inspects all classes in the database.
    - Maps Senior High (Grade 11-12) sections currently set to 'JHS_45MIN' or None
      to their proper SHS template group ('SHS_CAMPOS_ZARA' or 'SHS_DELMUNDO_REYES').
    - Sets JHS sections to 'JHS_45MIN' if None.
    - Re-aligns existing Grade 11 draft loads for Zara and Campos to valid non-overlapping SHS periods.
    - Guarded by Setting(key='shs_template_groups_backfilled_v1') so it runs strictly once.
    """
    from app.models.settings.Setting import Setting, SettingType
    try:
        flag = db.query(Setting).filter(Setting.key == "shs_template_groups_backfilled_v1").first()
        if flag:
            return
    except Exception:
        return

    classes = db.query(Class).all()
    for c in classes:
        lvl = db.query(AcademicLevel).filter(AcademicLevel.academic_level_id == c.academic_level_id).first()
        grade = lvl.grade_level if lvl else c.academic_level_id
        sec_name = (c.section_name or "").lower()
        pw_code = (c.pathway.code if c.pathway else "").lower()

        if grade >= 11:
            if not c.period_template_group or c.period_template_group == "JHS_45MIN":
                if "del mundo" in sec_name or "reyes" in sec_name or "general" in pw_code:
                    c.period_template_group = "SHS_DELMUNDO_REYES"
                else:
                    c.period_template_group = "SHS_CAMPOS_ZARA"
        else:
            if c.period_template_group is None:
                c.period_template_group = "JHS_45MIN"

    # Re-align Zara (class 12) & Campos (class 13) draft loads to valid SHS periods
    # Non-overlapping SHS slots avoiding break walls (10:00-10:24 Morning Recess, 12:00-13:00 Lunch):
    # Zara: HAP1 (34), HSF1 (35), Research 1 (38), StatProb (39)
    # Campos: IntroEng1 (36), StatProb (39), Research 1 (38)
    zara_schedule = {
        34: ("08:00", "09:00"),
        35: ("09:00", "10:00"),
        38: ("10:24", "12:00"),
        39: ("13:00", "14:00"),
    }
    campos_schedule = {
        36: ("08:00", "09:00"),
        39: ("09:00", "10:00"),
        38: ("15:30", "16:30"),
    }

    shs_loads = db.query(SubjectLoad).filter(SubjectLoad.class_id.in_([12, 13])).all()
    for sl in shs_loads:
        if sl.class_id == 12 and sl.subject_id in zara_schedule:
            st, et = zara_schedule[sl.subject_id]
            sl.start_time = st
            sl.end_time = et
        elif sl.class_id == 13 and sl.subject_id in campos_schedule:
            st, et = campos_schedule[sl.subject_id]
            sl.start_time = st
            sl.end_time = et

    db.add(
        Setting(
            key="shs_template_groups_backfilled_v1",
            value="true",
            type=SettingType.BOOLEAN,
            group="general",
            is_public=False,
            description="Migration flag: one-time SHS period template group backfill completed.",
        )
    )
    db.commit()


from app.core.pathways import canonicalize_pathway, CANONICAL_MEDICAL, CANONICAL_ENGINEERING, PATHWAY_BOTH, PATHWAY_GENERAL


def offering_pathway_code(so: SubjectOffering) -> str:
    pathway_links = getattr(so, "offering_pathways", None) or []
    if not pathway_links:
        return canonicalize_pathway(getattr(so, "pathway", None))
    if len(pathway_links) == 1:
        pw = getattr(pathway_links[0], "pathway", None)
        if pw and getattr(pw, "code", None):
            return canonicalize_pathway(pw.code)
        return PATHWAY_GENERAL
    return PATHWAY_BOTH



def _serialize_load_item(sl: SubjectLoad, period_deps: dict[tuple[int, int], dict[str, int]] | None = None) -> dict[str, Any]:
    deps = (period_deps or {}).get((sl.class_id, sl.subject_id), {
        "classwork_assignments": 0,
        "student_submissions": 0,
        "assessment_scores": 0,
        "period_grades": 0,
        "grade_logs": 0,
        "attendance_records": 0,
        "lesson_assignments": 0,
        "substitutions": 0,
        "reassignment_logs": 0,
        "educational_total": 0,
        "administrative_total": 0,
        "total": 0,
    })
    return {
        "subject_load_id": sl.subject_load_id,
        "class_id": sl.class_id,
        "subject_id": sl.subject_id,
        "staff_id": sl.staff_id,
        "academic_period_id": sl.academic_period_id,
        "slot_id": getattr(sl, "slot_id", None),
        "template_revision_id": getattr(sl, "template_revision_id", None),
        "start_time": getattr(sl, "start_time", None),
        "end_time": getattr(sl, "end_time", None),
        "days_of_week": getattr(sl, "days_of_week", []) or [],
        "status": sl.status or "draft",
        "logical_load_id": sl.logical_load_id or f"LL_{sl.class_id}_{sl.subject_id}_{sl.academic_period_id}",
        "section_revision": getattr(sl, "section_revision", 1) or 1,
        "base_revision": getattr(sl, "base_revision", None),
        "version": getattr(sl, "version", 1) or 1,
        "is_active_version": bool(getattr(sl, "is_active_version", True)),
        "is_locked": bool(getattr(sl, "is_locked", False)),
        "published_at": sl.published_at.isoformat() if getattr(sl, "published_at", None) else None,
        "published_by": getattr(sl, "published_by", None),
        "effective_from": sl.effective_from.isoformat() if getattr(sl, "effective_from", None) else None,
        "effective_to": sl.effective_to.isoformat() if getattr(sl, "effective_to", None) else None,
        "last_modified_by": getattr(sl, "last_modified_by", None),
        "continued_from_load_id": getattr(sl, "continued_from_load_id", None),
        "dependencies": deps,
        "has_live_data": bool(deps.get("educational_total", 0) > 0),
        "has_admin_records": bool(deps.get("administrative_total", 0) > 0),
    }


def _to_subject_load_item(sl: SubjectLoad) -> SubjectLoadItem:
    return SubjectLoadItem(
        subject_load_id=sl.subject_load_id,
        class_id=sl.class_id,
        subject_id=sl.subject_id,
        staff_id=sl.staff_id,
        academic_period_id=sl.academic_period_id,
        slot_id=sl.slot_id,
        template_revision_id=getattr(sl, "template_revision_id", None),
        start_time=sl.start_time,
        end_time=sl.end_time,
        days_of_week=sl.days_of_week or [],
        status=sl.status or "draft",
        logical_load_id=sl.logical_load_id,
        section_revision=sl.section_revision or 1,
        base_revision=sl.base_revision,
        effective_from=getattr(sl, "effective_from", None),
        effective_to=getattr(sl, "effective_to", None),
        is_active_version=bool(sl.is_active_version),
        is_locked=bool(sl.is_locked),
    )


def _authoritative_period_snapshot(db: Session, academic_period_id: int) -> list[SubjectLoadItem]:
    """Return the same per-section draft-or-published snapshot shown by Studio."""
    rows = db.query(SubjectLoad).filter(
        SubjectLoad.academic_period_id == academic_period_id,
    ).all()
    by_class: dict[int, list[SubjectLoad]] = {}
    for row in rows:
        by_class.setdefault(row.class_id, []).append(row)

    snapshot: list[SubjectLoadItem] = []
    for class_rows in by_class.values():
        drafts = [row for row in class_rows if row.status == "draft"]
        selected = drafts or [
            row for row in class_rows
            if row.is_active_version is True and row.status in ("published", "active")
        ]
        snapshot.extend(_to_subject_load_item(row) for row in selected)
    return snapshot


def _merge_proposed_period_snapshot(
    db: Session,
    academic_period_id: int,
    proposed: list[SubjectLoadItem],
) -> list[SubjectLoadItem]:
    affected_class_ids = {item.class_id for item in proposed}
    return list(proposed) + [
        item for item in _authoritative_period_snapshot(db, academic_period_id)
        if item.class_id not in affected_class_ids
    ]


@router.get("/teacher/scope", response_model=TeacherAcademicScopeResponse)
def get_teacher_academic_scope_endpoint(
    class_id: int | None = Query(None, description="Optional class ID to scope subjects"),
    academic_period_id: int | None = Query(None, description="Optional academic period ID to scope subjects"),
    _teacher: dict = Depends(require_role("teacher")),
    staff_id: str | None = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    return get_teacher_academic_scope(
        db,
        staff_id=staff_id,
        class_id=class_id,
        academic_period_id=academic_period_id,
        reject_unassigned_class=True,
    )


@router.get("/studio-data")
def get_subject_load_studio_data(
    academic_period_id: int | None = Query(None),
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    ensure_default_period_templates(db)
    ensure_shs_template_groups_backfilled(db)
    jhs_template_audit = ensure_jhs_template_assignments_and_backfill(db)
    years = db.query(AcademicYear).all()
    periods = db.query(AcademicPeriod).all()
    
    selected_period = _resolve_requested_or_active_period(db, academic_period_id)
    selected_period_id = selected_period.academic_period_id

    levels = db.query(AcademicLevel).order_by(AcademicLevel.grade_level).all()
    classes = db.query(Class).filter(
        Class.class_status == "active",
        Class.academic_year_id == selected_period.academic_year_id,
    ).all()
    pathway_by_id = {pathway.id: pathway for pathway in db.query(AcademicPathway).all()}
    teachers = (
        db.query(AcademicStaff)
        .filter(
            or_(
                AcademicStaff.employment_status.is_(None),
                AcademicStaff.employment_status != "inactive",
            ),
            ~AcademicStaff.staff_id.ilike("ADM%"),
            ~AcademicStaff.email.ilike("%admin%"),
            ~AcademicStaff.last_name.ilike("%administrator%"),
        )
        .all()
    )

    period_deps = SubjectLoadDependencyService.get_batched_period_dependencies(db, selected_period_id)
    all_period_loads = db.query(SubjectLoad).filter(SubjectLoad.academic_period_id == selected_period_id).all()
    loads_by_class: dict[int, list[SubjectLoad]] = {}
    for sl in all_period_loads:
        loads_by_class.setdefault(sl.class_id, []).append(sl)

    existing_loads: list[dict[str, Any]] = []
    has_pending_draft_by_class: dict[int, bool] = {}
    published_load_count_by_class: dict[int, int] = {}

    for c in classes:
        c_loads = loads_by_class.get(c.class_id, [])
        published_active_loads = [
            l for l in c_loads
            if l.is_active_version is True and l.status in ("published", "active")
        ]
        published_load_count_by_class[c.class_id] = len(published_active_loads)
        draft_loads = [l for l in c_loads if l.status == "draft"]
        if draft_loads:
            has_pending_draft_by_class[c.class_id] = True
            for dl in draft_loads:
                existing_loads.append(_serialize_load_item(dl, period_deps))
        else:
            has_pending_draft_by_class[c.class_id] = False
            for pl in published_active_loads:
                existing_loads.append(_serialize_load_item(pl, period_deps))

    # Active catalog subjects are selectable. Subjects referenced by the
    # returned snapshot remain present solely so an archived/invalid existing
    # load can still be displayed and corrected rather than disappearing.
    existing_subject_ids = {
        item["subject_id"] for item in existing_loads if item.get("subject_id") is not None
    }
    subject_filter = Subject.status == "active"
    if existing_subject_ids:
        subject_filter = or_(subject_filter, Subject.subject_id.in_(existing_subject_ids))
    subjects = db.query(Subject).filter(subject_filter).all()

    # Studio eligibility must use the same exact year/term offering scope as
    # publication validation.  Let database failures surface to the client;
    # an unavailable query is not equivalent to a successfully configured
    # period with zero offerings.
    offerings = (
        db.query(SubjectOffering)
        .filter(
            SubjectOffering.academic_year_id == selected_period.academic_year_id,
            SubjectOffering.academic_period_id == selected_period_id,
            SubjectOffering.status == "active",
        )
        .all()
    )

    return {
        "active_period_id": selected_period_id,
        "academic_years": [
            {"academic_year_id": y.academic_year_id, "year_label": y.year_label, "is_active": y.is_active}
            for y in years
        ],
        "academic_periods": [
            {"academic_period_id": p.academic_period_id, "period_name": p.period_name, "is_active": p.is_active}
            for p in periods
        ],
        "academic_levels": [
            {"academic_level_id": l.academic_level_id, "level_name": l.level_name, "grade_level": l.grade_level}
            for l in levels
        ],
        "classes": [
            {
                "class_id": c.class_id,
                "section_name": c.section_name,
                "academic_level_id": c.academic_level_id,
                "academic_year_id": c.academic_year_id,
                "pathway": class_pathway_code(c),
                "pathway_id": c.pathway_id,
                "pathway_name": pathway_by_id[c.pathway_id].name if c.pathway_id in pathway_by_id else None,
                "pathway_is_enabled": pathway_by_id[c.pathway_id].is_enabled if c.pathway_id in pathway_by_id else None,
                "requires_pathway": resolve_pathway_scope(db, c.academic_year_id, c.academic_level_id),
                "paired_class_id": getattr(c, "paired_class_id", None),
                "period_template_group": getattr(c, "period_template_group", None),
            }
            for c in classes
        ],
        "subjects": [
            {
                "subject_id": s.subject_id,
                "subject_name": s.subject_name,
                "subject_codename": s.subject_codename,
                "academic_level_id": s.academic_level_id,
                "grading_template": s.grading_template.template_name,
                "is_core": bool(getattr(s, "is_core", False)),
                "is_math_or_science": bool(
                    getattr(s, "is_math_or_science", False)
                    or any(
                        k in (s.subject_name or "").lower()
                        or k in (s.subject_codename or "").lower()
                        for k in ["math", "mathematics", "science", "physics", "chemistry", "biology"]
                    )
                ),
            }
            for s in subjects
        ],
        "subject_offerings": [
            {
                "subject_offering_id": so.subject_offering_id,
                "subject_id": so.subject_id,
                "academic_year_id": so.academic_year_id,
                "academic_level_id": so.academic_level_id,
                "academic_period_id": so.academic_period_id,
                "pathway": offering_pathway_code(so),
                "pathway_ids": [op.pathway_id for op in (getattr(so, "offering_pathways", None) or [])],
                "minutes": so.minutes,
            }
            for so in offerings
        ],
        "teachers": [
            {
                "staff_id": t.staff_id,
                "name": f"{t.first_name} {t.last_name}",
                "department": getattr(t, "department", None) or "Faculty",
                "specialization": getattr(t, "specialization", None) or "",
            }
            for t in teachers
        ],
        "existing_loads": existing_loads,
        "has_pending_draft_by_class": has_pending_draft_by_class,
        "published_load_count_by_class": published_load_count_by_class,
        "jhs_template_audit": jhs_template_audit,
        "period_template_slots": _effective_period_template_payload(
            db,
            academic_year_id=selected_period.academic_year_id,
            classes=classes,
        ),
    }

def get_school_hours_settings(db: Session) -> tuple[str, str]:
    from app.models.settings.Setting import Setting
    settings = db.query(Setting).filter(Setting.key.in_(["school_day_start", "school_day_end"])).all()
    s_map = {s.key: s.value for s in settings}
    return s_map.get("school_day_start", "06:00"), s_map.get("school_day_end", "20:00")

def time_str_to_mins(t_str: str) -> int:
    if not t_str:
        return 9999
    try:
        h, m = t_str.split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return 9999


def _validate_period_template_payload(
    db: Session,
    payload: list[PeriodTemplateSlotSchema],
    min_mins: int,
    max_mins: int,
    school_start: str,
    school_end: str,
) -> None:
    by_group: dict[str, list[PeriodTemplateSlotSchema]] = {}
    for item in payload:
        by_group.setdefault(item.template_group, []).append(item)

    for group, items in by_group.items():
        names = [item.slot_name.strip() for item in items]
        if len(names) != len(set(names)):
            raise HTTPException(status_code=400, detail=f"{group} contains duplicate slot names.")
        orders = [item.display_order for item in items]
        if len(orders) != len(set(orders)):
            raise HTTPException(status_code=400, detail=f"{group} contains duplicate display order values.")
        # The endpoint supports a one-slot PATCH-style update for internal and
        # migration callers. The editor sends the complete template, where the
        # canonical 13-slot shape is enforced.
        if group == JHS_TEMPLATE_GROUP and len(items) > 1:
            missing = [name for name in JHS_REQUIRED_SLOT_NAMES if name not in names]
            if missing:
                detail = "The shared Grade 7-10 timetable must keep its 13 required CTU slots."
                if missing:
                    detail += f" Missing: {', '.join(missing)}."
                raise HTTPException(status_code=400, detail=detail)

        intervals: list[tuple[int, int, str]] = []
        for item in items:
            start = time_str_to_mins(item.start_time)
            end = time_str_to_mins(item.end_time)
            if end <= start:
                raise HTTPException(status_code=400, detail=f"{item.slot_name}: end time must be after start time.")
            if start < min_mins or end > max_mins:
                raise HTTPException(
                    status_code=400,
                    detail=f"{item.slot_name} falls outside configured school hours ({school_start} - {school_end}).",
                )
            intervals.append((start, end, item.slot_name))
        intervals.sort()
        for previous, current in zip(intervals, intervals[1:]):
            if current[0] < previous[1]:
                raise HTTPException(
                    status_code=400,
                    detail=f"{group} has overlapping slots: {previous[2]} and {current[2]}.",
                )
@router.get("/period-templates")
def get_period_templates(
    academic_period_id: int | None = Query(None),
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    ensure_default_period_templates(db)
    period = _resolve_requested_or_active_period(db, academic_period_id)
    classes = db.query(Class).filter(Class.academic_year_id == period.academic_year_id).all()
    return _effective_period_template_payload(
        db,
        academic_year_id=period.academic_year_id,
        classes=classes,
    )


@router.post("/period-templates/override-preview")
def preview_published_period_template_override(
    payload: PeriodTemplateOverridePreviewRequest,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    period = _resolve_requested_or_active_period(db, payload.academic_period_id)
    actor = current_user.get("email") or current_user.get("username") or "Admin"
    return PeriodTemplateRevisionService.create_preview(
        db,
        period=period,
        submitted_slots=payload.slots,
        effective_date=payload.effective_date,
        actor=actor,
    )


@router.post("/period-templates/override-apply")
def apply_published_period_template_override(
    payload: PeriodTemplateOverrideApplyRequest,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    actor = current_user.get("email") or current_user.get("username") or "Admin"
    try:
        return PeriodTemplateRevisionService.apply_preview(
            db,
            token=payload.preview_token,
            confirmation=payload.confirmation,
            actor=actor,
        )
    except Exception:
        db.rollback()
        raise


@router.put("/period-templates")
def update_period_templates(
    payload: list[PeriodTemplateSlotSchema],
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    start_str, end_str = get_school_hours_settings(db)
    min_mins = time_str_to_mins(start_str)
    max_mins = time_str_to_mins(end_str)

    _validate_period_template_payload(
        db, payload, min_mins, max_mins, start_str, end_str
    )

    for item in payload:
        s_mins = time_str_to_mins(item.start_time)
        e_mins = time_str_to_mins(item.end_time)
        if e_mins <= s_mins:
            raise HTTPException(status_code=400, detail="End time must be after start time.")
        if s_mins < min_mins or e_mins > max_mins:
            raise HTTPException(status_code=400, detail=f"Time falls outside configured school hours ({start_str} - {end_str}).")

        if item.slot_id:
            db_slot = db.query(PeriodTemplateSlot).filter(PeriodTemplateSlot.slot_id == item.slot_id).first()
            if db_slot:
                old_start = db_slot.start_time
                old_end = db_slot.end_time
                new_start = item.start_time
                new_end = item.end_time
                grp = PeriodTemplateRevisionService._base_group_for_slot(db, db_slot)

                # Class-slot edits cascade into loads. Never change a published
                # section through the global template editor.
                if db_slot.slot_type == "CLASS" and (old_start != new_start or old_end != new_end):
                    candidate_classes = db.query(Class).filter(
                        (Class.period_template_group == grp) | ((Class.period_template_group == None) & (grp == "JHS_45MIN"))
                    ).order_by(Class.class_id).with_for_update().all()
                    target_class_ids = [
                        class_.class_id
                        for class_ in candidate_classes
                        if SubjectLoadAuthorizationService.get_configuration_restriction_reason(
                            db, class_id=class_.class_id
                        ) is None
                    ]

                    if target_class_ids:
                        affected = db.query(SubjectLoad).filter(
                            SubjectLoad.class_id.in_(target_class_ids),
                            (SubjectLoad.slot_id == db_slot.slot_id) | (
                                (SubjectLoad.slot_id == None) &
                                (SubjectLoad.start_time == old_start) &
                                (SubjectLoad.end_time == old_end)
                            ),
                        )
                        if affected.filter(
                            SubjectLoad.is_active_version.is_(True),
                            SubjectLoad.status.in_(["published", "active"]),
                        ).first():
                            db.rollback()
                            raise HTTPException(status_code=409, detail="This class period belongs to a locked published section. Unlock and revise affected sections before changing its time.")
                        affected.filter(SubjectLoad.status == "draft").update(
                            {
                                SubjectLoad.start_time: new_start,
                                SubjectLoad.end_time: new_end,
                                SubjectLoad.slot_id: db_slot.slot_id,
                            },
                            synchronize_session=False,
                        )

                db_slot.slot_name = item.slot_name
                db_slot.slot_type = item.slot_type
                db_slot.start_time = item.start_time
                db_slot.end_time = item.end_time
                db_slot.is_locked_break = item.is_locked_break
                db_slot.display_order = item.display_order
        else:
            new_slot = PeriodTemplateSlot(
                template_group=item.template_group,
                slot_name=item.slot_name,
                slot_type=item.slot_type,
                start_time=item.start_time,
                end_time=item.end_time,
                is_locked_break=item.is_locked_break,
                display_order=item.display_order,
            )
            db.add(new_slot)
    db.commit()
    return {"message": "Period templates updated and cascaded to schedules successfully."}


class UpdateClassTemplateGroupRequest(BaseModel):
    template_group: str | None = None


@router.put("/classes/{class_id}/template-group")
def update_class_template_group(
    class_id: int,
    payload: UpdateClassTemplateGroupRequest,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    cls = db.query(Class).filter(Class.class_id == class_id).with_for_update().first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    SubjectLoadAuthorizationService.assert_context_configurable(
        db, class_id=class_id
    )

    if cls.period_template_group != payload.template_group and db.query(SubjectLoad).filter(
        SubjectLoad.class_id == class_id,
        SubjectLoad.is_active_version.is_(True),
        SubjectLoad.status.in_(["published", "active"]),
    ).first():
        raise HTTPException(status_code=409, detail="Section is locked. Unlock Section before changing its bell schedule template.")

    level = db.get(AcademicLevel, cls.academic_level_id)
    if level and 7 <= level.grade_level <= 10 and payload.template_group:
        ensure_default_period_templates(db)
        target_slots = PeriodTemplateResolver.slots_for_group(
            db,
            base_group=payload.template_group,
            academic_year_id=cls.academic_year_id,
        )
        if not any(slot.slot_type == "CLASS" for slot in target_slots):
            raise HTTPException(status_code=422, detail="The selected Junior High template has no class periods.")

    cls.period_template_group = payload.template_group
    db.commit()

    # A template group belongs to the class, not the globally active year.
    # Re-validate every configured period for this class without crossing years.
    class_loads = db.query(SubjectLoad).join(
        AcademicPeriod,
        AcademicPeriod.academic_period_id == SubjectLoad.academic_period_id,
    ).filter(
        SubjectLoad.class_id == class_id,
        AcademicPeriod.academic_year_id == cls.academic_year_id,
    ).all()
    loads_by_period: dict[int, list[SubjectLoad]] = {}
    for load in class_loads:
        loads_by_period.setdefault(load.academic_period_id, []).append(load)

    conflicts = []
    is_valid = True
    for period_id, period_loads in loads_by_period.items():
        period = db.get(AcademicPeriod, period_id)
        load_items = [
            SubjectLoadItem(
                subject_load_id=load.subject_load_id,
                class_id=load.class_id,
                subject_id=load.subject_id,
                staff_id=load.staff_id,
                academic_period_id=load.academic_period_id,
                start_time=load.start_time,
                end_time=load.end_time,
                days_of_week=load.days_of_week or [],
                status=load.status or "draft",
                is_locked=bool(load.is_locked),
            )
            for load in period_loads
        ]
        validation_res = ConflictDetectorService.validate_loads(
            db=db,
            loads=load_items,
            academic_period=period,
        )
        is_valid = is_valid and validation_res.is_valid
        conflicts.extend(validation_res.conflicts)

    return {
        "message": f"Successfully updated bell schedule template for section '{cls.section_name}'.",
        "class_id": cls.class_id,
        "period_template_group": cls.period_template_group,
        "conflicts": [c.dict() if hasattr(c, "dict") else c for c in conflicts],
        "is_valid": is_valid,
    }


@router.post("/validate", response_model=ValidationResultResponse)
def validate_subject_loads(
    payload: ValidateSubjectLoadRequest,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    period = _resolve_requested_or_active_period(db, payload.academic_period_id)
    if any(item.academic_period_id != period.academic_period_id for item in payload.loads):
        raise HTTPException(status_code=422, detail="Every subject load must use the requested academic period.")
    normalized = _normalize_jhs_load_slots(db, payload.loads)
    merged = _merge_proposed_period_snapshot(db, period.academic_period_id, normalized)
    return ConflictDetectorService.validate_loads(
        db=db, loads=merged, academic_period=period, require_complete_schedule=True
    )


@router.post("/auto-schedule", response_model=AutoScheduleResponse)
def auto_schedule_subject_loads(
    payload: ValidateSubjectLoadRequest,
    mode: str = Query("standard"),
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    period = db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id == payload.academic_period_id).first()
    normalized_payload_loads = _normalize_jhs_load_slots(db, payload.loads)
    class_ids = {item.class_id for item in normalized_payload_loads}
    published = db.query(SubjectLoad).filter(
        SubjectLoad.class_id.in_(class_ids),
        SubjectLoad.academic_period_id == payload.academic_period_id,
        SubjectLoad.is_active_version.is_(True),
        SubjectLoad.status.in_(["published", "active"]),
    ).all() if class_ids else []
    draft_class_ids = {row[0] for row in db.query(SubjectLoad.class_id).filter(
        SubjectLoad.class_id.in_(class_ids),
        SubjectLoad.academic_period_id == payload.academic_period_id,
        SubjectLoad.status == "draft",
    ).distinct().all()} if class_ids else set()
    locked_class_ids = {load.class_id for load in published} - draft_class_ids
    protected_loads = [SubjectLoadItem(
        subject_load_id=load.subject_load_id,
        class_id=load.class_id,
        subject_id=load.subject_id,
        staff_id=load.staff_id,
        academic_period_id=load.academic_period_id,
        slot_id=load.slot_id,
        start_time=load.start_time,
        end_time=load.end_time,
        days_of_week=load.days_of_week or [],
        status=load.status,
        is_locked=True,
        section_revision=load.section_revision or 1,
    ) for load in published if load.class_id in locked_class_ids]
    scheduling_input = [item.model_copy(deep=True) for item in normalized_payload_loads if item.class_id not in locked_class_ids]
    scheduling_input.extend(item.model_copy(deep=True) for item in protected_loads)
    if not any(item.class_id not in locked_class_ids for item in scheduling_input):
        auto_scheduled_loads = protected_loads
    elif mode == "teacher_swap":
        auto_scheduled_loads = AutoSchedulerService.auto_schedule_paired_swap(db=db, loads=scheduling_input, academic_period=period)
    else:
        auto_scheduled_loads = AutoSchedulerService.auto_schedule_loads(db=db, loads=scheduling_input, academic_period=period)

    auto_scheduled_loads = [item for item in auto_scheduled_loads if item.class_id not in locked_class_ids]
    auto_scheduled_loads.extend(protected_loads)
    auto_scheduled_loads = _attach_server_generated_slot_ids(db, auto_scheduled_loads)

    validation_res = ConflictDetectorService.validate_loads(
        db=db, loads=auto_scheduled_loads, academic_period=period, require_complete_schedule=True
    )
    unscheduled_loads = [
        {
            "class_id": item.class_id,
            "subject_id": item.subject_id,
            "staff_id": item.staff_id,
            "reason": "No conflict-free timetable slot is available.",
        }
        for item in auto_scheduled_loads
        if not item.start_time or not item.end_time or not item.days_of_week
    ]
    
    return AutoScheduleResponse(
        is_valid=validation_res.is_valid,
        conflicts=validation_res.conflicts,
        teacher_workloads=validation_res.teacher_workloads,
        scheduled_loads=auto_scheduled_loads,
        unscheduled_loads=unscheduled_loads,
    )


@router.post("/unlock-section", response_model=SectionDraftResponse)
def unlock_section(
    payload: UnlockSectionRequest,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    user_email = current_user.get("email") or current_user.get("sub") or "admin"

    # Concurrency protection: Row-level lock on the Class section
    cls = db.query(Class).filter(Class.class_id == payload.class_id).with_for_update().first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class section not found.")
    if db.get(AcademicPeriod, payload.academic_period_id) is None:
        raise HTTPException(status_code=404, detail="Academic period not found.")
    SubjectLoadAuthorizationService.assert_context_configurable(
        db,
        class_id=payload.class_id,
        academic_period_id=payload.academic_period_id,
    )

    # Idempotent safeguard: check if a working draft already exists
    existing_drafts = (
        db.query(SubjectLoad)
        .filter(
            SubjectLoad.class_id == payload.class_id,
            SubjectLoad.academic_period_id == payload.academic_period_id,
            SubjectLoad.status == "draft",
        )
        .all()
    )
    if existing_drafts:
        period_deps = SubjectLoadDependencyService.get_batched_period_dependencies(db, payload.academic_period_id)
        draft_items = [_serialize_load_item(sl, period_deps) for sl in existing_drafts]
        base_rev = existing_drafts[0].base_revision
        sec_rev = existing_drafts[0].section_revision
        return SectionDraftResponse(
            message=f"Working draft (Revision {sec_rev}) already exists for {cls.section_name}.",
            class_id=payload.class_id,
            section_revision=sec_rev,
            base_revision=base_rev,
            has_pending_draft=True,
            loads=draft_items,
        )

    # Clone active published loads into draft revision
    published_loads = (
        db.query(SubjectLoad)
        .filter(
            SubjectLoad.class_id == payload.class_id,
            SubjectLoad.academic_period_id == payload.academic_period_id,
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(["published", "active"]),
        )
        .all()
    )

    base_rev = max((sl.section_revision or 1 for sl in published_loads), default=1)
    draft_rev = base_rev + 1
    cloned_drafts: list[SubjectLoad] = []

    for pub in published_loads:
        logical_id = pub.logical_load_id or f"LL_{pub.class_id}_{pub.subject_id}_{pub.academic_period_id}"
        draft_load = SubjectLoad(
            class_id=pub.class_id,
            subject_id=pub.subject_id,
            staff_id=pub.staff_id,
            academic_period_id=pub.academic_period_id,
            slot_id=pub.slot_id,
            start_time=pub.start_time,
            end_time=pub.end_time,
            days_of_week=pub.days_of_week,
            status="draft",
            logical_load_id=logical_id,
            section_revision=draft_rev,
            base_revision=base_rev,
            version=(pub.version or 1) + 1,
            is_active_version=False,
            is_locked=False,
            continued_from_load_id=pub.subject_load_id,
            last_modified_by=user_email,
        )
        db.add(draft_load)
        cloned_drafts.append(draft_load)

    db.commit()
    for d in cloned_drafts:
        db.refresh(d)

    period_deps = SubjectLoadDependencyService.get_batched_period_dependencies(db, payload.academic_period_id)
    draft_items = [_serialize_load_item(sl, period_deps) for sl in cloned_drafts]

    return SectionDraftResponse(
        message=f"Created working draft (Revision {draft_rev}) for {cls.section_name}. Baseline published schedule remains active.",
        class_id=payload.class_id,
        section_revision=draft_rev,
        base_revision=base_rev,
        has_pending_draft=True,
        loads=draft_items,
    )


@router.post("/discard-draft", response_model=SectionDraftResponse)
def discard_draft(
    payload: DiscardDraftRequest,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    cls = db.query(Class).filter(Class.class_id == payload.class_id).with_for_update().first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class section not found.")
    if db.get(AcademicPeriod, payload.academic_period_id) is None:
        raise HTTPException(status_code=404, detail="Academic period not found.")
    SubjectLoadAuthorizationService.assert_context_configurable(
        db,
        class_id=payload.class_id,
        academic_period_id=payload.academic_period_id,
    )

    # Delete all draft rows for this section and period
    db.query(SubjectLoad).filter(
        SubjectLoad.class_id == payload.class_id,
        SubjectLoad.academic_period_id == payload.academic_period_id,
        SubjectLoad.status == "draft",
    ).delete(synchronize_session=False)
    db.commit()

    # Retrieve published baseline
    published_loads = (
        db.query(SubjectLoad)
        .filter(
            SubjectLoad.class_id == payload.class_id,
            SubjectLoad.academic_period_id == payload.academic_period_id,
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(["published", "active"]),
        )
        .all()
    )
    base_rev = max((sl.section_revision or 1 for sl in published_loads), default=1)
    period_deps = SubjectLoadDependencyService.get_batched_period_dependencies(db, payload.academic_period_id)
    baseline_items = [_serialize_load_item(sl, period_deps) for sl in published_loads]

    return SectionDraftResponse(
        message=f"Abandoned working draft for {cls.section_name}. Retained unchanged published baseline (Revision {base_rev}).",
        class_id=payload.class_id,
        section_revision=base_rev,
        base_revision=base_rev,
        has_pending_draft=False,
        loads=baseline_items,
    )


@router.post("/batch-save", response_model=BatchSaveSubjectLoadResponse)
def batch_save_subject_loads(
    payload: BatchSaveSubjectLoadRequest,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    period = db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id == payload.academic_period_id).first()
    if period is None:
        raise HTTPException(status_code=404, detail="Academic period not found.")
    if payload.action not in {"draft", "publish"}:
        raise HTTPException(status_code=422, detail="Action must be draft or publish.")
    for load in payload.loads:
        if load.academic_period_id != payload.academic_period_id:
            raise HTTPException(
                status_code=422,
                detail="Every subject load must use the requested academic period.",
            )

    start_str, end_str = get_school_hours_settings(db)
    min_mins = time_str_to_mins(start_str)
    max_mins = time_str_to_mins(end_str)

    for load in payload.loads:
        if load.start_time and load.end_time:
            s_mins = time_str_to_mins(load.start_time)
            e_mins = time_str_to_mins(load.end_time)
            if e_mins <= s_mins:
                raise HTTPException(status_code=400, detail="End time must be after start time.")
            if s_mins < min_mins or e_mins > max_mins:
                raise HTTPException(status_code=400, detail=f"Time falls outside configured school hours ({start_str} - {end_str}).")

    affected_class_ids = set(load_item.class_id for load_item in payload.loads)

    user_email = current_user.get("email") or current_user.get("username") or "Admin"
    is_publishing = (payload.action == "publish")
    status_value = "published" if is_publishing else "draft"

    scope = payload.publish_scope or "all"
    if scope == "level":
        target_lvl = payload.target_level_id or payload.academic_level_id
        matching_classes = db.query(Class.class_id).filter(
            Class.academic_level_id == target_lvl,
            Class.academic_year_id == period.academic_year_id,
        ).all()
        target_class_ids = {c[0] for c in matching_classes}
    elif scope == "section" and payload.target_class_id is not None:
        target_class_ids = {payload.target_class_id}
    else:
        target_class_ids = set(affected_class_ids)

    for cid in sorted(target_class_ids | affected_class_ids):
        if db.get(Class, cid) is None:
            raise HTTPException(status_code=404, detail=f"Class {cid} not found.")
        SubjectLoadAuthorizationService.assert_context_configurable(
            db,
            class_id=cid,
            academic_period_id=payload.academic_period_id,
        )

    # Lock the section rows before deciding whether a published revision may be
    # changed. The request's status/is_locked fields are never authoritative.
    for cid in sorted(target_class_ids):
        db.query(Class).filter(Class.class_id == cid).with_for_update().first()
        published = db.query(SubjectLoad).filter(
            SubjectLoad.class_id == cid,
            SubjectLoad.academic_period_id == payload.academic_period_id,
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(["published", "active"]),
        ).all()
        if not published:
            continue
        drafts = db.query(SubjectLoad).filter(
            SubjectLoad.class_id == cid,
            SubjectLoad.academic_period_id == payload.academic_period_id,
            SubjectLoad.status == "draft",
        ).all()
        current_revision = max(load.section_revision or 1 for load in published)
        if drafts and any(d.base_revision != current_revision for d in drafts):
            raise HTTPException(status_code=409, detail=f"Section revision conflict for class {cid}: discard the stale draft and unlock again.")
        items = [item for item in payload.loads if item.class_id == cid]
        if not items and scope != "section":
            target_class_ids.remove(cid)
            continue
        if drafts:
            published_ids = {load.subject_load_id for load in published}
            if any(item.subject_load_id in published_ids for item in items):
                raise HTTPException(status_code=409, detail=f"Section {cid} is locked: edit its unlocked draft, not published rows.")
            if any(item.base_revision is not None and item.base_revision != current_revision for item in items):
                raise HTTPException(status_code=409, detail=f"Section revision conflict for class {cid}: reload the current draft.")
            continue

        if payload.base_revision is not None and payload.base_revision != current_revision:
            raise HTTPException(status_code=409, detail=f"Section revision conflict for class {cid}: reload the published section.")
        if any(item.section_revision != current_revision for item in items if item.status in ("published", "active")):
            raise HTTPException(status_code=409, detail=f"Section revision conflict for class {cid}: reload the published section.")
        if any(item.status not in ("published", "active") for item in items):
            raise HTTPException(status_code=409, detail=f"Section {cid} is locked. Unlock Section before saving a draft.")

        def schedule_signature(load):
            return (
                load.subject_id, load.staff_id, load.start_time, load.end_time,
                tuple(sorted(load.days_of_week or [])), load.slot_id,
            )

        # An unchanged published section in a global request is a no-op.
        # Any changed or added item requires the explicit unlock workflow.
        if sorted(map(schedule_signature, items), key=str) != sorted(map(schedule_signature, published), key=str):
            raise HTTPException(status_code=409, detail=f"Section {cid} is locked. Unlock Section before editing schedules or teacher assignments.")
        target_class_ids.remove(cid)

    # Authorization and revision checks intentionally run before timetable
    # normalization so a forged edit to a locked publication is always a 409,
    # never an opportunity to probe or bypass slot validation.
    payload.loads = _normalize_jhs_load_slots(db, payload.loads)

    # Serialize assignments for the same teacher. Two admins publishing
    # different sections must not both validate against the same old snapshot.
    incoming_staff_ids = {item.staff_id for item in payload.loads if item.staff_id}
    existing_staff_ids = {
        row[0]
        for row in db.query(SubjectLoad.staff_id).filter(
            SubjectLoad.academic_period_id == payload.academic_period_id,
            SubjectLoad.class_id.in_(affected_class_ids),
            SubjectLoad.staff_id.is_not(None),
        ).all()
    }
    staff_ids_to_lock = sorted(incoming_staff_ids | existing_staff_ids)
    if staff_ids_to_lock:
        db.query(AcademicStaff).filter(
            AcademicStaff.staff_id.in_(staff_ids_to_lock),
        ).order_by(AcademicStaff.staff_id).with_for_update().all()

    # Re-read after acquiring teacher locks and merge each unaffected section's
    # authoritative draft-or-published snapshot exactly once.
    merged_validation_loads = _merge_proposed_period_snapshot(
        db,
        payload.academic_period_id,
        payload.loads,
    )

    if is_publishing:
        unassigned_in_target: list[str] = []
        for load_item in merged_validation_loads:
            if load_item.class_id in target_class_ids and not load_item.staff_id:
                c_obj = db.query(Class).filter(Class.class_id == load_item.class_id).first()
                s_obj = db.query(Subject).filter(Subject.subject_id == load_item.subject_id).first()
                c_name = c_obj.section_name if c_obj else f"Section #{load_item.class_id}"
                s_name = s_obj.subject_name if s_obj else f"Subject #{load_item.subject_id}"
                unassigned_in_target.append(f"'{s_name}' in {c_name}")

        if unassigned_in_target:
            sample_str = ", ".join(unassigned_in_target[:3])
            if len(unassigned_in_target) > 3:
                sample_str += f" and {len(unassigned_in_target) - 3} more"
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot publish schedule: All subjects in the target schedule must have an assigned teacher. Unassigned: {sample_str}.",
            )

    validation_res = ConflictDetectorService.validate_loads(
        db=db,
        loads=merged_validation_loads,
        academic_period=period,
        require_complete_schedule=is_publishing,
    )
    proposed_keys = {f"{item.class_id}_{item.subject_id}" for item in payload.loads}
    proposed_teacher_overlaps = [
        conflict for conflict in validation_res.conflicts
        if conflict.rule == "TEACHER_OVERLAP"
        and proposed_keys.intersection(
            conflict.affected_keys
            or [key for key in (conflict.affected_key, conflict.related_affected_key) if key]
        )
    ]
    if proposed_teacher_overlaps and not is_publishing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot save a teacher double-booking: {proposed_teacher_overlaps[0].message}",
        )
    if is_publishing:
        if scope in ("section", "level") and target_class_ids:
            target_staff_ids = {
                load.staff_id for load in merged_validation_loads
                if load.class_id in target_class_ids and load.staff_id
            }
            target_conflicts = [
                c for c in validation_res.conflicts
                if c.severity == "error" and (
                    (c.class_id is not None and c.class_id in target_class_ids)
                    or (c.affected_key and any(c.affected_key.startswith(f"{cid}_") for cid in target_class_ids))
                    or any(key.startswith(f"{cid}_") for key in c.affected_keys for cid in target_class_ids)
                    or (c.staff_id is not None and c.staff_id in target_staff_ids and c.rule in ("TEACHER_OVERLAP", "DAILY_WORKLOAD_EXCEEDED"))
                )
            ]
        else:
            target_conflicts = [c for c in validation_res.conflicts if c.severity == "error"]

        if target_conflicts:
            sample_err = target_conflicts[0].message
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot publish schedule with unresolved conflicts: {sample_err}",
            )

    saved_count = 0
    now_time = datetime.now()

    if not is_publishing:
        # ACTION == DRAFT: Save only working draft loads for target sections
        for cid in target_class_ids:
            cls_items = [item for item in payload.loads if item.class_id == cid]
            if not cls_items:
                continue
            db.query(Class).filter(Class.class_id == cid).with_for_update().first()
            # Fetch existing draft rows for this class
            existing_drafts = (
                db.query(SubjectLoad)
                .filter(
                    SubjectLoad.class_id == cid,
                    SubjectLoad.academic_period_id == payload.academic_period_id,
                    SubjectLoad.status == "draft",
                )
                .all()
            )
            if not existing_drafts and all(
                item.status in ("published", "active") and item.is_locked for item in cls_items
            ):
                continue
            published_loads = (
                db.query(SubjectLoad)
                .filter(
                    SubjectLoad.class_id == cid,
                    SubjectLoad.academic_period_id == payload.academic_period_id,
                    SubjectLoad.is_active_version.is_(True),
                    SubjectLoad.status.in_(["published", "active"]),
                )
                .all()
            )
            current_base = max((load.section_revision or 1 for load in published_loads), default=0)
            if published_loads and any(draft.base_revision != current_base for draft in existing_drafts):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Section revision conflict for class {cid}: the saved draft is older than published Revision {current_base}. Discard the draft and unlock the section again.",
                )
            if published_loads and any(
                item.base_revision is not None and item.base_revision != current_base for item in cls_items
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Section revision conflict for class {cid}: your edit is based on an older revision than published Revision {current_base}. Reload the section before saving.",
                )
            draft_map = {d.subject_load_id: d for d in existing_drafts}
            incoming_ids = {item.subject_load_id for item in cls_items if item.subject_load_id is not None}

            # Delete removed draft rows
            for d_id, d_obj in draft_map.items():
                if d_id not in incoming_ids:
                    db.delete(d_obj)

            for item in cls_items:
                logical_id = item.logical_load_id or f"LL_{item.class_id}_{item.subject_id}_{payload.academic_period_id}"
                if item.subject_load_id and item.subject_load_id in draft_map:
                    d_load = draft_map[item.subject_load_id]
                else:
                    d_load = SubjectLoad(
                        class_id=item.class_id,
                        subject_id=item.subject_id,
                        academic_period_id=payload.academic_period_id,
                        logical_load_id=logical_id,
                    )
                    db.add(d_load)

                d_load.staff_id = item.staff_id
                d_load.start_time = item.start_time
                d_load.end_time = item.end_time
                d_load.days_of_week = item.days_of_week
                d_load.slot_id = item.slot_id
                d_load.status = "draft"
                d_load.is_active_version = False
                d_load.is_locked = False
                d_load.last_modified_by = user_email
                d_load.section_revision = current_base + 1 if published_loads else (item.section_revision or 1)
                d_load.base_revision = current_base if published_loads else item.base_revision
                d_load.continued_from_load_id = item.continued_from_load_id
                saved_count += 1

        db.commit()

    else:
        # ACTION == PUBLISH: Staged Publishing with concurrency protection, deletion guard, and atomic promotion
        today_date = SubstitutionService.get_academic_date()

        for cid in target_class_ids:
            # Row lock Class section
            cls_obj = db.query(Class).filter(Class.class_id == cid).with_for_update().first()

            # 1. Fetch current active published loads
            current_pub_loads = (
                db.query(SubjectLoad)
                .filter(
                    SubjectLoad.class_id == cid,
                    SubjectLoad.academic_period_id == payload.academic_period_id,
                    SubjectLoad.is_active_version.is_(True),
                    SubjectLoad.status.in_(["published", "active"]),
                )
                .all()
            )
            current_base = max((sl.section_revision or 1 for sl in current_pub_loads), default=0)

            # Optimistic concurrency check
            if payload.base_revision is not None and current_pub_loads and payload.base_revision != current_base:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Section revision conflict for '{cls_obj.section_name if cls_obj else cid}': your edit is based on Revision {payload.base_revision}, but the published section is Revision {current_base}. Reload the section before publishing.",
                )

            cls_items = [item for item in payload.loads if item.class_id == cid]

            # 2. Deletion Guard & Strict Identity Check
            # Convert incoming items into transient SubjectLoads for classification
            incoming_transient = [
                SubjectLoad(
                    class_id=it.class_id,
                    subject_id=it.subject_id,
                    staff_id=it.staff_id,
                    academic_period_id=payload.academic_period_id,
                    start_time=it.start_time,
                    end_time=it.end_time,
                    days_of_week=it.days_of_week,
                    slot_id=it.slot_id,
                    logical_load_id=it.logical_load_id or f"LL_{it.class_id}_{it.subject_id}_{payload.academic_period_id}",
                )
                for it in cls_items
            ]

            classified = SubjectLoadDependencyService.classify_section_changes(current_pub_loads, incoming_transient)
            for change in classified:
                if change["change_type"] == ChangeType.REMOVED_SUBJECT:
                    b_load = change["baseline_load"]
                    can_del, deps = SubjectLoadDependencyService.can_delete_subject_load(db, b_load)
                    if not can_del:
                        s_name = db.query(Subject.subject_name).filter(Subject.subject_id == b_load.subject_id).scalar() or f"Subject #{b_load.subject_id}"
                        if deps.get("educational_total", 0) > 0:
                            dep_parts = [
                                f"{cnt} {k.replace('_', ' ')}"
                                for k, cnt in deps.items()
                                if k in ("classwork_assignments", "student_submissions", "assessment_scores", "period_grades", "grade_logs", "attendance_records", "lesson_assignments") and cnt > 0
                            ]
                            dep_summary = ", ".join(dep_parts)
                            raise HTTPException(
                                status_code=status.HTTP_409_CONFLICT,
                                detail=f"Cannot remove '{s_name}' from section '{cls_obj.section_name if cls_obj else cid}': student academic records exist ({dep_summary}). De-allocation is blocked to preserve academic integrity.",
                            )
                        elif deps.get("active_substitutions", 0) > 0:
                            raise HTTPException(
                                status_code=status.HTTP_409_CONFLICT,
                                detail=f"Cannot remove '{s_name}' from section '{cls_obj.section_name if cls_obj else cid}': an active teacher substitution is currently assigned. Please conclude or cancel the substitution before removing the subject.",
                            )

            # 3. Archive previous active published loads
            for pub in current_pub_loads:
                pub.is_active_version = False
                pub.status = "archived"

            new_revision = current_base + 1

            # Fetch existing draft loads for this class to promote or reuse
            existing_drafts = (
                db.query(SubjectLoad)
                .filter(
                    SubjectLoad.class_id == cid,
                    SubjectLoad.academic_period_id == payload.academic_period_id,
                    SubjectLoad.status == "draft",
                )
                .all()
            )
            draft_by_logical = {d.logical_load_id: d for d in existing_drafts if d.logical_load_id}

            promoted_loads: list[SubjectLoad] = []
            for it in cls_items:
                logical_id = it.logical_load_id or f"LL_{it.class_id}_{it.subject_id}_{payload.academic_period_id}"
                prev_pub = next((p for p in current_pub_loads if p.logical_load_id == logical_id), None)
                cont_id = prev_pub.subject_load_id if prev_pub else None

                if logical_id in draft_by_logical:
                    p_load = draft_by_logical[logical_id]
                else:
                    p_load = SubjectLoad(
                        class_id=it.class_id,
                        subject_id=it.subject_id,
                        academic_period_id=payload.academic_period_id,
                        logical_load_id=logical_id,
                    )
                    db.add(p_load)

                p_load.staff_id = it.staff_id
                p_load.slot_id = it.slot_id
                p_load.start_time = it.start_time
                p_load.end_time = it.end_time
                p_load.days_of_week = it.days_of_week
                p_load.status = "published"
                p_load.is_active_version = True
                p_load.is_locked = True
                p_load.section_revision = new_revision
                p_load.base_revision = current_base
                p_load.published_at = now_time
                p_load.published_by = user_email
                p_load.last_modified_by = user_email
                p_load.continued_from_load_id = cont_id
                promoted_loads.append(p_load)
                saved_count += 1

            db.flush()

            # 4. Atomic substitution repointing & Reassignment audit logs
            for p_load in promoted_loads:
                prev_pub = next((p for p in current_pub_loads if p.logical_load_id == p_load.logical_load_id), None)
                if prev_pub:
                    # Repoint active non-terminal substitutions
                    subs = (
                        db.query(TeacherSubstitution)
                        .filter(
                            TeacherSubstitution.subject_load_id == prev_pub.subject_load_id,
                            TeacherSubstitution.status == "active",
                            or_(TeacherSubstitution.end_date.is_(None), TeacherSubstitution.end_date >= today_date),
                        )
                        .all()
                    )
                    for s in subs:
                        s.subject_load_id = p_load.subject_load_id

                    # Log teacher reassignment
                    if prev_pub.staff_id != p_load.staff_id:
                        log_entry = SubjectLoadAssignmentLog(
                            logical_load_id=p_load.logical_load_id,
                            subject_load_id=p_load.subject_load_id,
                            class_id=p_load.class_id,
                            subject_id=p_load.subject_id,
                            academic_period_id=p_load.academic_period_id,
                            old_staff_id=prev_pub.staff_id,
                            new_staff_id=p_load.staff_id,
                            changed_by=user_email,
                            change_reason="Section revision published",
                        )
                        db.add(log_entry)

            # 5. Delete any remaining unpromoted draft rows for this section
            promoted_ids = {p.subject_load_id for p in promoted_loads}
            db.query(SubjectLoad).filter(
                SubjectLoad.class_id == cid,
                SubjectLoad.academic_period_id == payload.academic_period_id,
                SubjectLoad.status == "draft",
                ~SubjectLoad.subject_load_id.in_(promoted_ids),
            ).delete(synchronize_session=False)

        db.commit()

    scope_label = "all sections" if payload.publish_scope == "all" else f"{payload.publish_scope} scope"
    return BatchSaveSubjectLoadResponse(
        message=f"Successfully saved {saved_count} subject loads for {scope_label} as {status_value.upper()}.",
        saved_count=saved_count,
        status=status_value,
        is_valid=validation_res.is_valid,
        conflicts=validation_res.conflicts,
    )


DAY_MAP = {
    "MON": "M",
    "TUE": "T",
    "WED": "W",
    "THU": "Th",
    "FRI": "F",
    "SAT": "Sa",
    "SUN": "Su",
}


def format_time_str(t: str | None) -> str:
    if not t:
        return ""
    try:
        parts = t.split(":")
        hh = int(parts[0])
        mm = int(parts[1])
        suffix = "AM" if hh < 12 else "PM"
        display_hh = hh if hh <= 12 else hh - 12
        if display_hh == 0:
            display_hh = 12
        return f"{display_hh}:{mm:02d} {suffix}"
    except Exception:
        return t or ""


def _assert_can_view_class_schedule(
    db: Session,
    *,
    current_user: dict,
    class_: Class,
    period: AcademicPeriod,
) -> None:
    role = (current_user.get("role") or "").lower()
    if role == "admin":
        return

    if role == "teacher":
        staff_id = get_optional_staff_id(current_user=current_user, db=db)
        if staff_id and class_.adviser_staff_id == staff_id:
            return

        published_loads = db.query(SubjectLoad).filter(
            SubjectLoad.class_id == class_.class_id,
            SubjectLoad.academic_period_id == period.academic_period_id,
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(["published", "active"]),
        ).all()
        if staff_id and any(
            SubjectLoadAuthorizationService.can_view(
                db,
                staff_id,
                load.class_id,
                load.subject_id,
                load.academic_period_id,
            )
            for load in published_loads
        ):
            return

    elif role == "student":
        student = get_student_record(current_user=current_user, db=db)
        enrollment = db.query(StudentClass.student_class_id).filter(
            StudentClass.student_id == student.student_id,
            StudentClass.class_id == class_.class_id,
            StudentClass.academic_year_id == period.academic_year_id,
            StudentClass.enrollment_status == "enrolled",
        ).first()
        if enrollment is not None:
            return

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You are not authorized to view this class schedule.",
    )


@router.get("/class-schedule/{class_id}")
def get_class_schedule(
    class_id: int,
    academic_period_id: int | None = Query(None),
    schedule_date: date_type | None = Query(None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cls = db.query(Class).filter(Class.class_id == class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class section not found")

    period = _resolve_requested_or_active_period(db, academic_period_id)
    if period.academic_year_id != cls.academic_year_id:
        raise HTTPException(
            status_code=409,
            detail="The requested academic period does not belong to the class academic year.",
        )
    _assert_can_view_class_schedule(
        db,
        current_user=current_user,
        class_=cls,
        period=period,
    )
    period_id = period.academic_period_id

    load_query = db.query(SubjectLoad).filter(
        SubjectLoad.class_id == class_id,
        SubjectLoad.academic_period_id == period_id,
    )
    if schedule_date is None:
        load_query = load_query.filter(
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(["published", "active"]),
        )
    else:
        load_query = load_query.filter(
            SubjectLoad.status.in_(["published", "active", "archived"]),
            or_(SubjectLoad.effective_from.is_(None), SubjectLoad.effective_from <= schedule_date),
            or_(SubjectLoad.effective_to.is_(None), SubjectLoad.effective_to >= schedule_date),
        )
    published_loads = load_query.all()

    ensure_default_period_templates(db)
    break_slots = PeriodTemplateResolver.slots_for_class(db, cls, as_of=schedule_date)

    is_published = len(published_loads) > 0
    slots = []

    for sl in published_loads:
        sub = db.query(Subject).filter(Subject.subject_id == sl.subject_id).first()
        staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == sl.staff_id).first() if sl.staff_id else None

        start_fmt = format_time_str(sl.start_time)
        end_fmt = format_time_str(sl.end_time)
        time_range = f"{start_fmt} - {end_fmt}" if (start_fmt and end_fmt) else ""

        raw_days = getattr(sl, "days_of_week", []) or []
        formatted_days = [DAY_MAP.get(d.upper(), d) for d in raw_days]

        slots.append({
            "type": "class",
            "subject_load_id": sl.subject_load_id,
            "subject": sub.subject_name if sub else f"Subject #{sl.subject_id}",
            "subject_codename": sub.subject_codename if sub else "",
            "teacher": f"{staff.first_name} {staff.last_name}" if staff else "Unassigned",
            "section_name": cls.section_name,
            "start_time": sl.start_time or "00:00",
            "end_time": sl.end_time or "00:00",
            "time": time_range,
            "days": formatted_days if formatted_days else ["M", "T", "W", "Th", "F"],
            "slot_type": "CLASS",
        })

    for b in break_slots:
        if b.slot_type in ("HOMEROOM", "RECESS", "LUNCH"):
            start_fmt = format_time_str(b.start_time)
            end_fmt = format_time_str(b.end_time)
            slots.append({
                "type": "break",
                "label": b.slot_name,
                "start_time": b.start_time,
                "end_time": b.end_time,
                "time": f"{start_fmt} - {end_fmt}" if (start_fmt and end_fmt) else "",
                "slot_type": b.slot_type,
            })

    slots.sort(key=lambda s: s.get("start_time") or "00:00")

    lvl = db.query(AcademicLevel).filter(AcademicLevel.academic_level_id == cls.academic_level_id).first()
    lvl_name = lvl.level_name if lvl else ""

    return {
        "is_published": is_published,
        "class_id": cls.class_id,
        "section_name": cls.section_name,
        "grade_level": lvl_name,
        "schedule": slots,
    }


@router.get("/my-schedule")
def get_my_schedule(
    academic_period_id: int | None = Query(None),
    schedule_date: date_type | None = Query(None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role = current_user.get("role", "")
    period = _resolve_requested_or_active_period(db, academic_period_id)
    period_id = period.academic_period_id

    if role == "student":
        try:
            student_obj = get_student_record(current_user=current_user, db=db)
            st_class = (
                db.query(StudentClass)
                .filter(
                    StudentClass.student_id == student_obj.student_id,
                    StudentClass.academic_year_id == period.academic_year_id,
                    StudentClass.enrollment_status == "enrolled",
                )
                .first()
            )
            if not st_class:
                return {"is_published": False, "schedule": []}
            return get_class_schedule(class_id=st_class.class_id, academic_period_id=period_id, schedule_date=schedule_date, current_user=current_user, db=db)
        except Exception:
            return {"is_published": False, "schedule": []}

    elif role in ("teacher", "admin"):
        staff_id = get_optional_staff_id(current_user=current_user, db=db)
        if not staff_id:
            pub_load = db.query(SubjectLoad).filter(
                SubjectLoad.academic_period_id == period_id,
                SubjectLoad.is_active_version.is_(True),
                SubjectLoad.status.in_(["published", "active"]),
            ).first()
            if pub_load:
                return get_class_schedule(class_id=pub_load.class_id, academic_period_id=period_id, schedule_date=schedule_date, current_user=current_user, db=db)
            return {"is_published": False, "schedule": []}

        teacher_query = db.query(SubjectLoad).filter(
            SubjectLoad.staff_id == staff_id,
            SubjectLoad.academic_period_id == period_id,
        )
        if schedule_date is None:
            teacher_query = teacher_query.filter(
                SubjectLoad.is_active_version.is_(True),
                SubjectLoad.status.in_(["published", "active"]),
            )
        else:
            teacher_query = teacher_query.filter(
                SubjectLoad.status.in_(["published", "active", "archived"]),
                or_(SubjectLoad.effective_from.is_(None), SubjectLoad.effective_from <= schedule_date),
                or_(SubjectLoad.effective_to.is_(None), SubjectLoad.effective_to >= schedule_date),
            )
        teacher_loads = teacher_query.all()

        covered_by_sub_map = SubstitutionService.get_original_teacher_covered_load_ids(db, staff_id, period_id)
        covered_as_sub_loads = SubstitutionService.get_substitute_covered_loads(db, staff_id, period_id)

        if not teacher_loads and not covered_as_sub_loads:
            return {"is_published": False, "schedule": []}

        all_class_ids = list(set(
            [sl.class_id for sl in teacher_loads] + [sl.class_id for sl, _ in covered_as_sub_loads]
        ))
        primary_class = db.query(Class).filter(Class.class_id == all_class_ids[0]).first() if all_class_ids else None
        ensure_default_period_templates(db)
        break_slots = PeriodTemplateResolver.slots_for_class(db, primary_class, as_of=schedule_date) if primary_class else []

        slots = []
        # 1. Teacher's own assigned loads
        for sl in teacher_loads:
            sub = db.query(Subject).filter(Subject.subject_id == sl.subject_id).first()
            cls_obj = db.query(Class).filter(Class.class_id == sl.class_id).first()
            staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == staff_id).first()

            start_fmt = format_time_str(sl.start_time)
            end_fmt = format_time_str(sl.end_time)
            time_range = f"{start_fmt} - {end_fmt}" if (start_fmt and end_fmt) else ""
            raw_days = getattr(sl, "days_of_week", []) or []
            formatted_days = [DAY_MAP.get(d.upper(), d) for d in raw_days]

            is_covered = sl.subject_load_id in covered_by_sub_map
            sub_name = covered_by_sub_map.get(sl.subject_load_id)

            slots.append({
                "type": "class",
                "subject_load_id": sl.subject_load_id,
                "subject": sub.subject_name if sub else f"Subject #{sl.subject_id}",
                "subject_codename": sub.subject_codename if sub else "",
                "teacher": f"{staff.first_name} {staff.last_name}" if staff else "",
                "section_name": cls_obj.section_name if cls_obj else "",
                "start_time": sl.start_time or "00:00",
                "end_time": sl.end_time or "00:00",
                "time": time_range,
                "days": formatted_days if formatted_days else ["M", "T", "W", "Th", "F"],
                "slot_type": "CLASS",
                "is_covered": is_covered,
                "substitute_name": sub_name,
                "is_substitution": False,
                "original_teacher_name": None,
            })

        # 2. Loads covered by this teacher as a substitute
        for sl, orig_name in covered_as_sub_loads:
            sub = db.query(Subject).filter(Subject.subject_id == sl.subject_id).first()
            cls_obj = db.query(Class).filter(Class.class_id == sl.class_id).first()
            staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == staff_id).first()

            start_fmt = format_time_str(sl.start_time)
            end_fmt = format_time_str(sl.end_time)
            time_range = f"{start_fmt} - {end_fmt}" if (start_fmt and end_fmt) else ""
            raw_days = getattr(sl, "days_of_week", []) or []
            formatted_days = [DAY_MAP.get(d.upper(), d) for d in raw_days]

            slots.append({
                "type": "class",
                "subject_load_id": sl.subject_load_id,
                "subject": sub.subject_name if sub else f"Subject #{sl.subject_id}",
                "subject_codename": sub.subject_codename if sub else "",
                "teacher": f"{staff.first_name} {staff.last_name}" if staff else "",
                "section_name": cls_obj.section_name if cls_obj else "",
                "start_time": sl.start_time or "00:00",
                "end_time": sl.end_time or "00:00",
                "time": time_range,
                "days": formatted_days if formatted_days else ["M", "T", "W", "Th", "F"],
                "slot_type": "CLASS",
                "is_covered": False,
                "substitute_name": None,
                "is_substitution": True,
                "original_teacher_name": orig_name,
            })

        for b in break_slots:
            if b.slot_type in ("HOMEROOM", "RECESS", "LUNCH"):
                start_fmt = format_time_str(b.start_time)
                end_fmt = format_time_str(b.end_time)
                slots.append({
                    "type": "break",
                    "label": b.slot_name,
                    "start_time": b.start_time,
                    "end_time": b.end_time,
                    "time": f"{start_fmt} - {end_fmt}" if (start_fmt and end_fmt) else "",
                    "slot_type": b.slot_type,
                })

        slots.sort(key=lambda s: s.get("start_time") or "00:00")
        return {"is_published": True, "schedule": slots}

    return {"is_published": False, "schedule": []}

