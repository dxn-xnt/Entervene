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
from app.schemas.SubjectLoad import (
    ValidateSubjectLoadRequest,
    ValidationResultResponse,
    BatchSaveSubjectLoadRequest,
    BatchSaveSubjectLoadResponse,
    SubjectLoadItem,
)
from app.services.academic.ConflictDetectorService import ConflictDetectorService

router = APIRouter()


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
                "continued_from_load_id": getattr(sl, "continued_from_load_id", None),
            }
            for sl in existing_loads
        ],
    }


@router.post("/validate", response_model=ValidationResultResponse)
def validate_subject_loads(
    payload: ValidateSubjectLoadRequest,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    period = db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id == payload.academic_period_id).first()
    return ConflictDetectorService.validate_loads(db=db, loads=payload.loads, academic_period=period)


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

    status_value = "published" if payload.action == "publish" else "draft"

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
        db_load.continued_from_load_id = load_item.continued_from_load_id
        saved_count += 1

    db.commit()

    return BatchSaveSubjectLoadResponse(
        message=f"Successfully saved {saved_count} subject loads as {status_value.upper()}.",
        saved_count=saved_count,
        status=status_value,
        is_valid=validation_res.is_valid,
        conflicts=validation_res.conflicts,
    )
