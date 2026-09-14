from datetime import datetime
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
    UnlockSectionRequest,
    DiscardDraftRequest,
    SectionDraftResponse,
)
from pydantic import BaseModel
from sqlalchemy import text
from app.services.academic.ConflictDetectorService import ConflictDetectorService
from app.services.academic.AutoSchedulerService import AutoSchedulerService
from app.services.classes.ClassQueryService import class_pathway_code
from app.services.academic.SubstitutionService import SubstitutionService

router = APIRouter()



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

    try:
        existing = db.query(PeriodTemplateSlot).first()
        if existing:
            return
    except Exception:
        return

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
        "last_modified_by": getattr(sl, "last_modified_by", None),
        "continued_from_load_id": getattr(sl, "continued_from_load_id", None),
        "dependencies": deps,
        "has_live_data": bool(deps.get("educational_total", 0) > 0),
        "has_admin_records": bool(deps.get("administrative_total", 0) > 0),
    }


@router.get("/studio-data")
def get_subject_load_studio_data(
    academic_period_id: int | None = Query(None),
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    ensure_default_period_templates(db)
    ensure_shs_template_groups_backfilled(db)
    years = db.query(AcademicYear).all()
    periods = db.query(AcademicPeriod).all()
    
    selected_period = None
    if academic_period_id:
        selected_period = db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id == academic_period_id).first()
    if not selected_period:
        selected_period = db.query(AcademicPeriod).filter(AcademicPeriod.is_active == True).first() or (periods[0] if periods else None)

    selected_period_id = selected_period.academic_period_id if selected_period else 1

    levels = db.query(AcademicLevel).order_by(AcademicLevel.grade_level).all()
    classes = db.query(Class).filter(Class.class_status == "active").all()
    subjects = db.query(Subject).filter(Subject.status == "active").all()
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

    try:
        db.execute(text("UPDATE subject_load SET status = 'draft', is_locked = FALSE, published_at = NULL, published_by = NULL WHERE staff_id IS NULL OR staff_id = '';"))
        db.commit()
    except Exception:
        db.rollback()

    period_deps = SubjectLoadDependencyService.get_batched_period_dependencies(db, selected_period_id)
    all_period_loads = db.query(SubjectLoad).filter(SubjectLoad.academic_period_id == selected_period_id).all()
    loads_by_class: dict[int, list[SubjectLoad]] = {}
    for sl in all_period_loads:
        loads_by_class.setdefault(sl.class_id, []).append(sl)

    existing_loads: list[dict[str, Any]] = []
    has_pending_draft_by_class: dict[int, bool] = {}

    for c in classes:
        c_loads = loads_by_class.get(c.class_id, [])
        draft_loads = [l for l in c_loads if l.status == "draft"]
        if draft_loads:
            has_pending_draft_by_class[c.class_id] = True
            for dl in draft_loads:
                existing_loads.append(_serialize_load_item(dl, period_deps))
        else:
            has_pending_draft_by_class[c.class_id] = False
            published_active_loads = [
                l for l in c_loads
                if l.is_active_version is True and l.status in ("published", "active")
            ]
            for pl in published_active_loads:
                existing_loads.append(_serialize_load_item(pl, period_deps))

    try:
        offerings = (
            db.query(SubjectOffering)
            .filter(
                SubjectOffering.academic_period_id == selected_period_id,
                SubjectOffering.status == "active",
            )
            .all()
        )
    except Exception:
        db.rollback()
        offerings = []

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
                "subject_group": s.subject_group or "General",
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
        "period_template_slots": [
            {
                "slot_id": pts.slot_id,
                "template_group": pts.template_group,
                "slot_name": pts.slot_name,
                "slot_type": pts.slot_type,
                "start_time": pts.start_time,
                "end_time": pts.end_time,
                "is_locked_break": pts.is_locked_break,
                "display_order": pts.display_order,
            }
            for pts in (ensure_default_period_templates(db) or db.query(PeriodTemplateSlot).order_by(PeriodTemplateSlot.template_group, PeriodTemplateSlot.display_order).all())
        ],
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


@router.get("/period-templates")
def get_period_templates(
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    ensure_default_period_templates(db)
    slots = db.query(PeriodTemplateSlot).order_by(PeriodTemplateSlot.template_group, PeriodTemplateSlot.display_order).all()
    return [
        {
            "slot_id": s.slot_id,
            "template_group": s.template_group,
            "slot_name": s.slot_name,
            "slot_type": s.slot_type,
            "start_time": s.start_time,
            "end_time": s.end_time,
            "is_locked_break": s.is_locked_break,
            "display_order": s.display_order,
        }
        for s in slots
    ]


@router.put("/period-templates")
def update_period_templates(
    payload: list[PeriodTemplateSlotSchema],
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    start_str, end_str = get_school_hours_settings(db)
    min_mins = time_str_to_mins(start_str)
    max_mins = time_str_to_mins(end_str)

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
                grp = db_slot.template_group

                # Automatically cascade time updates to matching subject loads (including locked/published schedules) by slot_id or time window
                if db_slot.slot_type == "CLASS" and (old_start != new_start or old_end != new_end):
                    target_classes = db.query(Class).filter(
                        (Class.period_template_group == grp) | ((Class.period_template_group == None) & (grp == "JHS_45MIN"))
                    ).all()
                    target_class_ids = [c.class_id for c in target_classes]

                    if target_class_ids:
                        db.query(SubjectLoad).filter(
                            (SubjectLoad.slot_id == db_slot.slot_id) | (
                                (SubjectLoad.slot_id == None) &
                                (SubjectLoad.class_id.in_(target_class_ids)) &
                                (SubjectLoad.start_time == old_start) &
                                (SubjectLoad.end_time == old_end)
                            ),
                        ).update(
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
    cls = db.query(Class).filter(Class.class_id == class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")

    cls.period_template_group = payload.template_group
    db.commit()

    # Re-validate loads for this class against the new template
    period = db.query(AcademicPeriod).filter(AcademicPeriod.is_active == True).first()
    period_id = period.academic_period_id if period else 1

    class_loads = db.query(SubjectLoad).filter(
        SubjectLoad.class_id == class_id,
        SubjectLoad.academic_period_id == period_id,
    ).all()

    load_items = [
        SubjectLoadItem(
            subject_load_id=l.subject_load_id,
            class_id=l.class_id,
            subject_id=l.subject_id,
            staff_id=l.staff_id,
            academic_period_id=l.academic_period_id,
            start_time=l.start_time,
            end_time=l.end_time,
            days_of_week=l.days_of_week or [],
            status=l.status or "draft",
            is_locked=bool(l.is_locked),
        )
        for l in class_loads
    ]

    validation_res = ConflictDetectorService.validate_loads(db=db, loads=load_items, academic_period=period)

    return {
        "message": f"Successfully updated bell schedule template for section '{cls.section_name}'.",
        "class_id": cls.class_id,
        "period_template_group": cls.period_template_group,
        "conflicts": [c.dict() if hasattr(c, "dict") else c for c in validation_res.conflicts],
        "is_valid": validation_res.is_valid,
    }


@router.post("/validate", response_model=ValidationResultResponse)
def validate_subject_loads(
    payload: ValidateSubjectLoadRequest,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    period = db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id == payload.academic_period_id).first()
    return ConflictDetectorService.validate_loads(db=db, loads=payload.loads, academic_period=period)


@router.post("/auto-schedule", response_model=AutoScheduleResponse)
def auto_schedule_subject_loads(
    payload: ValidateSubjectLoadRequest,
    mode: str = Query("standard"),
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    period = db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id == payload.academic_period_id).first()
    if mode == "teacher_swap":
        auto_scheduled_loads = AutoSchedulerService.auto_schedule_paired_swap(db=db, loads=payload.loads, academic_period=period)
    else:
        auto_scheduled_loads = AutoSchedulerService.auto_schedule_loads(db=db, loads=payload.loads, academic_period=period)

    validation_res = ConflictDetectorService.validate_loads(db=db, loads=auto_scheduled_loads, academic_period=period)
    
    return AutoScheduleResponse(
        is_valid=validation_res.is_valid,
        conflicts=validation_res.conflicts,
        teacher_workloads=validation_res.teacher_workloads,
        scheduled_loads=auto_scheduled_loads,
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
        matching_classes = db.query(Class.class_id).filter(Class.academic_level_id == target_lvl).all()
        target_class_ids = {c[0] for c in matching_classes}
    elif scope == "section" and payload.target_class_id is not None:
        target_class_ids = {payload.target_class_id}
    else:
        target_class_ids = set(affected_class_ids)

    # 1. Validation across loads
    # Fetch all active version DB loads for full-school merged validation
    db_all_period_loads = (
        db.query(SubjectLoad)
        .filter(
            SubjectLoad.academic_period_id == payload.academic_period_id,
            SubjectLoad.is_active_version.is_(True),
        )
        .all()
    )
    merged_validation_loads: list[SubjectLoadItem] = list(payload.loads)
    for sl in db_all_period_loads:
        if sl.class_id not in affected_class_ids:
            merged_validation_loads.append(
                SubjectLoadItem(
                    subject_load_id=sl.subject_load_id,
                    class_id=sl.class_id,
                    subject_id=sl.subject_id,
                    staff_id=sl.staff_id,
                    academic_period_id=sl.academic_period_id,
                    start_time=getattr(sl, "start_time", None),
                    end_time=getattr(sl, "end_time", None),
                    days_of_week=getattr(sl, "days_of_week", []) or [],
                    status=sl.status or "draft",
                    is_locked=bool(getattr(sl, "is_locked", False)),
                )
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

    validation_res = ConflictDetectorService.validate_loads(db=db, loads=merged_validation_loads, academic_period=period)
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
                d_load.section_revision = item.section_revision or 2
                d_load.base_revision = item.base_revision or 1
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
                    detail=f"Section revision conflict for '{cls_obj.section_name if cls_obj else cid}': Another administrator published Revision {current_base} while you were editing. Please reload the section before publishing.",
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


@router.get("/class-schedule/{class_id}")
def get_class_schedule(
    class_id: int,
    academic_period_id: int | None = Query(None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cls = db.query(Class).filter(Class.class_id == class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="Class section not found")

    period = None
    if academic_period_id:
        period = db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id == academic_period_id).first()
    if not period:
        period = db.query(AcademicPeriod).filter(AcademicPeriod.is_active == True).first()

    period_id = period.academic_period_id if period else 1

    published_loads = (
        db.query(SubjectLoad)
        .filter(
            SubjectLoad.class_id == class_id,
            SubjectLoad.academic_period_id == period_id,
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(["published", "active"]),
        )
        .all()
    )

    ensure_default_period_templates(db)
    grp = getattr(cls, "period_template_group", None) or "JHS_45MIN"
    break_slots = (
        db.query(PeriodTemplateSlot)
        .filter(PeriodTemplateSlot.template_group == grp)
        .order_by(PeriodTemplateSlot.display_order)
        .all()
    )

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
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role = current_user.get("role", "")
    period = None
    if academic_period_id:
        period = db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id == academic_period_id).first()
    if not period:
        period = db.query(AcademicPeriod).filter(AcademicPeriod.is_active == True).first()
    period_id = period.academic_period_id if period else 1

    if role == "student":
        try:
            student_obj = get_student_record(current_user=current_user, db=db)
            st_class = (
                db.query(StudentClass)
                .filter(
                    StudentClass.student_id == student_obj.student_id,
                    StudentClass.enrollment_status == "enrolled",
                )
                .first()
            )
            if not st_class:
                return {"is_published": False, "schedule": []}
            return get_class_schedule(class_id=st_class.class_id, academic_period_id=period_id, current_user=current_user, db=db)
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
                return get_class_schedule(class_id=pub_load.class_id, academic_period_id=period_id, current_user=current_user, db=db)
            return {"is_published": False, "schedule": []}

        teacher_loads = (
            db.query(SubjectLoad)
            .filter(
                SubjectLoad.staff_id == staff_id,
                SubjectLoad.academic_period_id == period_id,
                SubjectLoad.is_active_version.is_(True),
                SubjectLoad.status.in_(["published", "active"]),
            )
            .all()
        )

        covered_by_sub_map = SubstitutionService.get_original_teacher_covered_load_ids(db, staff_id, period_id)
        covered_as_sub_loads = SubstitutionService.get_substitute_covered_loads(db, staff_id, period_id)

        if not teacher_loads and not covered_as_sub_loads:
            return {"is_published": False, "schedule": []}

        all_class_ids = list(set(
            [sl.class_id for sl in teacher_loads] + [sl.class_id for sl, _ in covered_as_sub_loads]
        ))
        primary_class = db.query(Class).filter(Class.class_id == all_class_ids[0]).first() if all_class_ids else None
        grp = getattr(primary_class, "period_template_group", None) or "JHS_45MIN" if primary_class else "JHS_45MIN"

        ensure_default_period_templates(db)
        break_slots = (
            db.query(PeriodTemplateSlot)
            .filter(PeriodTemplateSlot.template_group == grp)
            .order_by(PeriodTemplateSlot.display_order)
            .all()
        )

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

