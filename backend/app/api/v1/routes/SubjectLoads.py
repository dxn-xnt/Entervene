from datetime import datetime
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
from app.schemas.SubjectLoad import (
    ValidateSubjectLoadRequest,
    ValidationResultResponse,
    AutoScheduleResponse,
    BatchSaveSubjectLoadRequest,
    BatchSaveSubjectLoadResponse,
    SubjectLoadItem,
    PeriodTemplateSlotSchema,
)
from sqlalchemy import text
from app.services.academic.ConflictDetectorService import ConflictDetectorService
from app.services.academic.AutoSchedulerService import AutoSchedulerService
from app.services.classes.ClassQueryService import class_pathway_code

router = APIRouter()


def ensure_default_period_templates(db: Session):
    try:
        db.execute(text("ALTER TABLE subject ADD COLUMN IF NOT EXISTS is_math_or_science BOOLEAN DEFAULT FALSE;"))
        db.execute(text("ALTER TABLE subject ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';"))
        db.execute(text("ALTER TABLE subject ADD COLUMN IF NOT EXISTS academic_level_id INTEGER;"))
        db.execute(text("ALTER TABLE subject ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();"))
        db.execute(text("ALTER TABLE subject ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();"))
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


@router.get("/studio-data")
def get_subject_load_studio_data(
    academic_period_id: int | None = Query(None),
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
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

    existing_loads = db.query(SubjectLoad).filter(SubjectLoad.academic_period_id == selected_period_id).all()
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
                "period_template_group": getattr(c, "period_template_group", None) or "JHS_45MIN",
            }
            for c in classes
        ],
        "subjects": [
            {
                "subject_id": s.subject_id,
                "subject_name": s.subject_name,
                "subject_codename": s.subject_codename,
                "academic_level_id": s.academic_level_id,
                "hours": s.hours,
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
                "pathway_ids": [op.pathway_id for op in so.offering_pathways],
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
        "existing_loads": [
            {
                "subject_load_id": sl.subject_load_id,
                "class_id": sl.class_id,
                "subject_id": sl.subject_id,
                "staff_id": sl.staff_id,
                "academic_period_id": sl.academic_period_id,
                "start_time": getattr(sl, "start_time", None),
                "end_time": getattr(sl, "end_time", None),
                "days_of_week": getattr(sl, "days_of_week", []) or [],
                "status": sl.status or "draft",
                "version": getattr(sl, "version", 1) or 1,
                "is_active_version": bool(getattr(sl, "is_active_version", True)),
                "is_locked": bool(getattr(sl, "is_locked", False)),
                "published_at": sl.published_at.isoformat() if getattr(sl, "published_at", None) else None,
                "published_by": getattr(sl, "published_by", None),
                "last_modified_by": getattr(sl, "last_modified_by", None),
                "continued_from_load_id": getattr(sl, "continued_from_load_id", None),
            }
            for sl in existing_loads
        ],
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
    for item in payload:
        if item.slot_id:
            db_slot = db.query(PeriodTemplateSlot).filter(PeriodTemplateSlot.slot_id == item.slot_id).first()
            if db_slot:
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
    return {"message": "Period templates updated successfully."}


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


@router.post("/batch-save", response_model=BatchSaveSubjectLoadResponse)
def batch_save_subject_loads(
    payload: BatchSaveSubjectLoadRequest,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    period = db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id == payload.academic_period_id).first()

    # Identify affected classes in this payload
    affected_class_ids = set(load_item.class_id for load_item in payload.loads)

    # Fetch all existing DB loads for full-school merged validation
    db_all_period_loads = (
        db.query(SubjectLoad)
        .filter(SubjectLoad.academic_period_id == payload.academic_period_id)
        .all()
    )

    # Merge incoming payload loads with existing DB loads from non-affected classes
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

    user_email = current_user.get("email") or current_user.get("username") or "Admin"
    status_value = "published" if payload.action == "publish" else "draft"
    is_publishing = (payload.action == "publish")

    # Determine target class IDs based on publish scope
    target_class_ids: set[int] = set()
    if is_publishing:
        scope = payload.publish_scope or "all"
        if scope == "level":
            target_lvl = payload.target_level_id or payload.academic_level_id
            matching_classes = db.query(Class.class_id).filter(Class.academic_level_id == target_lvl).all()
            target_class_ids = {c[0] for c in matching_classes}
        elif scope == "section" and payload.target_class_id is not None:
            target_class_ids = {payload.target_class_id}
        else:
            # "all" scope
            target_class_ids = set(affected_class_ids)

        # Enforce that all subject loads within target_class_ids have assigned teachers
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
    
    # If action is publish and there are error-level conflicts, block publication
    if payload.action == "publish" and not validation_res.is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot publish schedule with unresolved conflicts. Please fix all errors before publishing.",
        )


    existing_db_affected = [sl for sl in db_all_period_loads if sl.class_id in affected_class_ids]
    existing_map = {sl.subject_load_id: sl for sl in existing_db_affected}
    incoming_ids = {item.subject_load_id for item in payload.loads if item.subject_load_id is not None}

    # Delete loads that were removed in the UI for affected classes
    for sl_id, sl_obj in existing_map.items():
        if sl_id not in incoming_ids:
            db.delete(sl_obj)

    saved_count = 0
    now_time = datetime.now()
    for load_item in payload.loads:
        db_load = None
        if load_item.subject_load_id and load_item.subject_load_id in existing_map:
            db_load = existing_map[load_item.subject_load_id]
        else:
            db_load = SubjectLoad(
                class_id=load_item.class_id,
                subject_id=load_item.subject_id,
                academic_period_id=payload.academic_period_id,
            )
            db.add(db_load)

        db_load.staff_id = load_item.staff_id
        db_load.start_time = load_item.start_time
        db_load.end_time = load_item.end_time
        db_load.days_of_week = load_item.days_of_week
        db_load.last_modified_by = user_email
        db_load.continued_from_load_id = load_item.continued_from_load_id

        should_publish_this_load = is_publishing and (load_item.class_id in target_class_ids) and bool(load_item.staff_id)
        if should_publish_this_load:
            db_load.status = "published"
            db_load.is_locked = True
            db_load.locked_at = now_time
            db_load.published_at = now_time
            db_load.published_by = user_email
        elif payload.action == "draft" or not load_item.staff_id:
            db_load.status = "draft"
            db_load.is_locked = False
            db_load.published_at = None
            db_load.published_by = None
        else:
            if not getattr(db_load, "status", None):
                db_load.status = "draft"
                db_load.is_locked = False

        saved_count += 1

    # Cleanup any stale published records in DB that have no assigned staff
    try:
        db.execute(text("UPDATE subject_load SET status = 'draft', is_locked = FALSE WHERE staff_id IS NULL AND status = 'published';"))
    except Exception:
        pass

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
            SubjectLoad.status == "published",
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
            pub_load = db.query(SubjectLoad).filter(SubjectLoad.academic_period_id == period_id, SubjectLoad.status == "published").first()
            if pub_load:
                return get_class_schedule(class_id=pub_load.class_id, academic_period_id=period_id, current_user=current_user, db=db)
            return {"is_published": False, "schedule": []}

        teacher_loads = (
            db.query(SubjectLoad)
            .filter(
                SubjectLoad.staff_id == staff_id,
                SubjectLoad.academic_period_id == period_id,
                SubjectLoad.status == "published",
            )
            .all()
        )

        if not teacher_loads:
            return {"is_published": False, "schedule": []}

        class_ids = list(set(sl.class_id for sl in teacher_loads))
        primary_class = db.query(Class).filter(Class.class_id == class_ids[0]).first() if class_ids else None
        grp = getattr(primary_class, "period_template_group", None) or "JHS_45MIN" if primary_class else "JHS_45MIN"

        ensure_default_period_templates(db)
        break_slots = (
            db.query(PeriodTemplateSlot)
            .filter(PeriodTemplateSlot.template_group == grp)
            .order_by(PeriodTemplateSlot.display_order)
            .all()
        )

        slots = []
        for sl in teacher_loads:
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
