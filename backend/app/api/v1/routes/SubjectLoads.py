from datetime import datetime
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session
from app.core.Dependencies import require_role
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
                "pathway": getattr(c, "pathway", None) or "general",
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
                "pathway": so.pathway,
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
    validation_res = ConflictDetectorService.validate_loads(db=db, loads=payload.loads, academic_period=period)
    
    # If action is publish and there are error-level conflicts, block publication
    if payload.action == "publish" and not validation_res.is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot publish schedule with unresolved conflicts. Please fix all errors before publishing.",
        )

    user_email = current_user.get("email") or current_user.get("username") or "Admin"
    status_value = "published" if payload.action == "publish" else "draft"
    is_publishing = (payload.action == "publish")

    # Identify affected classes in this academic period
    affected_class_ids = list({load_item.class_id for load_item in payload.loads})
    existing_db_loads = (
        db.query(SubjectLoad)
        .filter(
            SubjectLoad.academic_period_id == payload.academic_period_id,
            SubjectLoad.class_id.in_(affected_class_ids),
        )
        .all()
        if affected_class_ids
        else []
    )

    existing_map = {sl.subject_load_id: sl for sl in existing_db_loads}
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
        db_load.status = status_value
        db_load.last_modified_by = user_email
        db_load.continued_from_load_id = load_item.continued_from_load_id

        if is_publishing:
            db_load.is_locked = True
            db_load.locked_at = now_time
            db_load.published_at = now_time
            db_load.published_by = user_email
        else:
            db_load.is_locked = False

        saved_count += 1

    db.commit()

    return BatchSaveSubjectLoadResponse(
        message=f"Successfully saved {saved_count} subject loads as {status_value.upper()}.",
        saved_count=saved_count,
        status=status_value,
        is_valid=validation_res.is_valid,
        conflicts=validation_res.conflicts,
    )
