from __future__ import annotations
import uuid
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.api.v1.routes.Auth import get_current_user
from app.core.Dependencies import require_role, get_optional_staff_id
from app.db.Session import get_db
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.Subject import Subject
from app.models.academic.Class_ import Class
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.people.AcademicStaff import AcademicStaff
from app.schemas.SubjectLoad import SubjectLoadItem, ConflictItem
from app.schemas.TeacherSubstitution import (
    TeacherSubstitutionCreate,
    TeacherSubstitutionBulkCreate,
    TeacherSubstitutionBulkResponse,
    TeacherSubstitutionResponse,
    TeacherSubstitutionUpdateEndDate,
    TeacherLoadSummaryItem,
)
from app.services.academic.ConflictDetectorService import ConflictDetectorService
from app.services.academic.SubstitutionService import SubstitutionService, _staff_full_name

router = APIRouter()


def _format_substitution_response(
    sub: TeacherSubstitution,
    load: SubjectLoad,
    orig_staff: AcademicStaff,
    sub_staff: AcademicStaff,
    subject: Subject,
    cls: Class,
    period: AcademicPeriod,
    conflicts: list[ConflictItem] | None = None,
) -> TeacherSubstitutionResponse:
    today_date = date.today()
    is_active = (
        sub.status == "active"
        and sub.start_date <= today_date
        and (sub.end_date is None or today_date <= sub.end_date)
    )
    return TeacherSubstitutionResponse(
        substitution_id=sub.substitution_id,
        batch_id=sub.batch_id,
        subject_load_id=sub.subject_load_id,
        original_staff_id=sub.original_staff_id,
        original_staff_name=_staff_full_name(orig_staff),
        substitute_staff_id=sub.substitute_staff_id,
        substitute_staff_name=_staff_full_name(sub_staff),
        subject_id=subject.subject_id,
        subject_name=subject.subject_name,
        subject_codename=subject.subject_codename,
        class_id=cls.class_id,
        section_name=cls.section_name,
        academic_period_id=period.academic_period_id,
        period_name=period.period_name,
        start_date=sub.start_date,
        end_date=sub.end_date,
        status=sub.status,
        is_currently_active=is_active,
        reason=sub.reason,
        conflicts=conflicts or [],
        created_by_admin_id=sub.created_by_admin_id,
        ended_by_admin_id=sub.ended_by_admin_id,
        ended_at=sub.ended_at,
        created_at=sub.created_at,
        updated_at=sub.updated_at,
    )


@router.post("", response_model=TeacherSubstitutionResponse, status_code=status.HTTP_201_CREATED)
def create_substitution(
    payload: TeacherSubstitutionCreate,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    admin_staff_id = get_optional_staff_id(current_user=current_user, db=db)

    # 1. Load target subject_load
    load = db.query(SubjectLoad).filter(SubjectLoad.subject_load_id == payload.subject_load_id).first()
    if not load:
        raise HTTPException(status_code=404, detail="Target subject load not found")

    original_staff_id = load.staff_id
    if not original_staff_id:
        raise HTTPException(status_code=400, detail="Cannot substitute an unassigned subject load")

    # 2. Check self-substitution
    if payload.substitute_staff_id == original_staff_id:
        raise HTTPException(status_code=400, detail="Substitute teacher cannot be the same as the original teacher")

    # Verify substitute staff exists
    sub_staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == payload.substitute_staff_id).first()
    if not sub_staff:
        raise HTTPException(status_code=404, detail="Substitute teacher not found")

    orig_staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == original_staff_id).first()

    # 3. Check date sanity
    if payload.end_date is not None and payload.end_date < payload.start_date:
        raise HTTPException(status_code=400, detail="End date must be greater than or equal to start date")

    # 4. App-layer Overlap check on same subject_load_id
    new_start = payload.start_date
    new_end = payload.end_date
    existing_active = (
        db.query(TeacherSubstitution)
        .filter(
            TeacherSubstitution.subject_load_id == payload.subject_load_id,
            TeacherSubstitution.status == "active",
        )
        .all()
    )
    for existing in existing_active:
        e_start = existing.start_date
        e_end = existing.end_date
        if e_end is not None and e_end < date.today():
            continue
        overlaps = (new_end is None or e_start <= new_end) and (e_end is None or new_start <= e_end)
        if overlaps:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"An active substitution already covers this subject load for dates {e_start} to {e_end or 'open-ended'}.",
            )

    # 5. Conflict Check on Substitute's Own Schedule
    period = db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id == load.academic_period_id).first()
    sub_existing_loads = (
        db.query(SubjectLoad)
        .filter(
            SubjectLoad.staff_id == payload.substitute_staff_id,
            SubjectLoad.academic_period_id == load.academic_period_id,
            SubjectLoad.status == "published",
        )
        .all()
    )

    validation_items: list[SubjectLoadItem] = [
        SubjectLoadItem(
            subject_load_id=sl.subject_load_id,
            class_id=sl.class_id,
            subject_id=sl.subject_id,
            staff_id=sl.staff_id,
            academic_period_id=sl.academic_period_id,
            start_time=getattr(sl, "start_time", None),
            end_time=getattr(sl, "end_time", None),
            days_of_week=getattr(sl, "days_of_week", []) or [],
            status=sl.status or "published",
        )
        for sl in sub_existing_loads
    ]

    validation_items.append(
        SubjectLoadItem(
            subject_load_id=load.subject_load_id,
            class_id=load.class_id,
            subject_id=load.subject_id,
            staff_id=payload.substitute_staff_id,
            academic_period_id=load.academic_period_id,
            start_time=getattr(load, "start_time", None),
            end_time=getattr(load, "end_time", None),
            days_of_week=getattr(load, "days_of_week", []) or [],
            status="published",
        )
    )

    val_res = ConflictDetectorService.validate_loads(db=db, loads=validation_items, academic_period=period)
    errors = [c for c in val_res.conflicts if c.severity == "error" and c.staff_id == payload.substitute_staff_id]
    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Scheduling conflict for substitute: {errors[0].message}",
        )

    # 6. Insert new TeacherSubstitution with distinct batch_id
    batch_id = uuid.uuid4()
    new_sub = TeacherSubstitution(
        batch_id=batch_id,
        subject_load_id=payload.subject_load_id,
        original_staff_id=original_staff_id,
        substitute_staff_id=payload.substitute_staff_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        status="active",
        reason=payload.reason,
        created_by_admin_id=admin_staff_id,
    )
    db.add(new_sub)
    db.commit()
    db.refresh(new_sub)

    subject = db.query(Subject).filter(Subject.subject_id == load.subject_id).first()
    cls = db.query(Class).filter(Class.class_id == load.class_id).first()

    warnings = [c for c in val_res.conflicts if c.severity == "warning" and c.staff_id == payload.substitute_staff_id]
    return _format_substitution_response(new_sub, load, orig_staff, sub_staff, subject, cls, period, conflicts=warnings)


@router.post("/bulk", response_model=TeacherSubstitutionBulkResponse, status_code=status.HTTP_201_CREATED)
def create_bulk_substitutions(
    payload: TeacherSubstitutionBulkCreate,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    if not payload.subject_load_ids:
        raise HTTPException(status_code=400, detail="At least one subject load must be selected")

    admin_staff_id = get_optional_staff_id(current_user=current_user, db=db)

    # 1. Verify substitute staff exists
    sub_staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == payload.substitute_staff_id).first()
    if not sub_staff:
        raise HTTPException(status_code=404, detail="Substitute teacher not found")

    # 2. Check date sanity
    if payload.end_date is not None and payload.end_date < payload.start_date:
        raise HTTPException(status_code=400, detail="End date must be greater than or equal to start date")

    # 3. Load all target subject_loads
    loads = db.query(SubjectLoad).filter(SubjectLoad.subject_load_id.in_(payload.subject_load_ids)).all()
    if len(loads) != len(payload.subject_load_ids):
        raise HTTPException(status_code=404, detail="One or more selected subject loads were not found")

    # Verify all loads have an assigned teacher and belong to the same original teacher
    original_staff_ids = {l.staff_id for l in loads if l.staff_id}
    if None in [l.staff_id for l in loads] or not original_staff_ids:
        raise HTTPException(status_code=400, detail="Cannot substitute unassigned subject load(s)")
    if len(original_staff_ids) > 1:
        raise HTTPException(status_code=400, detail="All subject loads in a program takeover must belong to the same original teacher")

    original_staff_id = list(original_staff_ids)[0]
    if payload.substitute_staff_id == original_staff_id:
        raise HTTPException(status_code=400, detail="Substitute teacher cannot be the same as the original teacher")

    orig_staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == original_staff_id).first()

    # 4. Overlap check across all loads
    new_start = payload.start_date
    new_end = payload.end_date
    existing_active = (
        db.query(TeacherSubstitution)
        .filter(
            TeacherSubstitution.subject_load_id.in_(payload.subject_load_ids),
            TeacherSubstitution.status == "active",
        )
        .all()
    )
    for existing in existing_active:
        e_start = existing.start_date
        e_end = existing.end_date
        if e_end is not None and e_end < date.today():
            continue
        overlaps = (new_end is None or e_start <= new_end) and (e_end is None or new_start <= e_end)
        if overlaps:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"An active substitution already covers subject load #{existing.subject_load_id} for dates {e_start} to {e_end or 'open-ended'}.",
            )

    # 5. Conflict check on substitute schedule with all candidate loads bundled
    # Group candidate loads by academic period
    loads_by_period: dict[int, list[SubjectLoad]] = {}
    for l in loads:
        loads_by_period.setdefault(l.academic_period_id, []).append(l)

    all_warnings: list[ConflictItem] = []
    for period_id, period_loads in loads_by_period.items():
        period = db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id == period_id).first()
        sub_existing_loads = (
            db.query(SubjectLoad)
            .filter(
                SubjectLoad.staff_id == payload.substitute_staff_id,
                SubjectLoad.academic_period_id == period_id,
                SubjectLoad.status == "published",
            )
            .all()
        )
        validation_items: list[SubjectLoadItem] = [
            SubjectLoadItem(
                subject_load_id=sl.subject_load_id,
                class_id=sl.class_id,
                subject_id=sl.subject_id,
                staff_id=sl.staff_id,
                academic_period_id=sl.academic_period_id,
                start_time=getattr(sl, "start_time", None),
                end_time=getattr(sl, "end_time", None),
                days_of_week=getattr(sl, "days_of_week", []) or [],
                status=sl.status or "published",
            )
            for sl in sub_existing_loads
        ]
        for cl in period_loads:
            validation_items.append(
                SubjectLoadItem(
                    subject_load_id=cl.subject_load_id,
                    class_id=cl.class_id,
                    subject_id=cl.subject_id,
                    staff_id=payload.substitute_staff_id,
                    academic_period_id=cl.academic_period_id,
                    start_time=getattr(cl, "start_time", None),
                    end_time=getattr(cl, "end_time", None),
                    days_of_week=getattr(cl, "days_of_week", []) or [],
                    status="published",
                )
            )
        val_res = ConflictDetectorService.validate_loads(db=db, loads=validation_items, academic_period=period)
        errors = [c for c in val_res.conflicts if c.severity == "error" and c.staff_id == payload.substitute_staff_id]
        if errors:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Scheduling conflict for substitute: {errors[0].message}",
            )
        all_warnings.extend([c for c in val_res.conflicts if c.severity == "warning" and c.staff_id == payload.substitute_staff_id])

    # 6. Single multi-row insert with shared batch_id
    batch_id = uuid.uuid4()
    created_subs: list[TeacherSubstitution] = []
    for l in loads:
        new_sub = TeacherSubstitution(
            batch_id=batch_id,
            subject_load_id=l.subject_load_id,
            original_staff_id=original_staff_id,
            substitute_staff_id=payload.substitute_staff_id,
            start_date=payload.start_date,
            end_date=payload.end_date,
            status="active",
            reason=payload.reason,
            created_by_admin_id=admin_staff_id,
        )
        created_subs.append(new_sub)

    db.add_all(created_subs)
    db.commit()
    for sub in created_subs:
        db.refresh(sub)

    # Format responses
    load_map = {l.subject_load_id: l for l in loads}
    subject_ids = {l.subject_id for l in loads}
    class_ids = {l.class_id for l in loads}
    period_ids = {l.academic_period_id for l in loads}

    subjects = {s.subject_id: s for s in db.query(Subject).filter(Subject.subject_id.in_(subject_ids)).all()}
    classes = {c.class_id: c for c in db.query(Class).filter(Class.class_id.in_(class_ids)).all()}
    periods = {p.academic_period_id: p for p in db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id.in_(period_ids)).all()}

    formatted: list[TeacherSubstitutionResponse] = [
        _format_substitution_response(
            sub,
            load_map[sub.subject_load_id],
            orig_staff,
            sub_staff,
            subjects[load_map[sub.subject_load_id].subject_id],
            classes[load_map[sub.subject_load_id].class_id],
            periods[load_map[sub.subject_load_id].academic_period_id],
            conflicts=all_warnings,
        )
        for sub in created_subs
    ]

    return TeacherSubstitutionBulkResponse(
        batch_id=batch_id,
        created_count=len(formatted),
        substitutions=formatted,
    )


@router.get("", response_model=list[TeacherSubstitutionResponse])
def list_substitutions(
    status_filter: Optional[str] = Query(None, alias="status"),
    staff_id: Optional[str] = Query(None),
    batch_id: Optional[uuid.UUID] = Query(None),
    academic_period_id: Optional[int] = Query(None),
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    query = (
        db.query(TeacherSubstitution, SubjectLoad, AcademicStaff, Subject, Class, AcademicPeriod)
        .join(SubjectLoad, SubjectLoad.subject_load_id == TeacherSubstitution.subject_load_id)
        .join(AcademicStaff, AcademicStaff.staff_id == TeacherSubstitution.original_staff_id)
        .join(Subject, Subject.subject_id == SubjectLoad.subject_id)
        .join(Class, Class.class_id == SubjectLoad.class_id)
        .join(AcademicPeriod, AcademicPeriod.academic_period_id == SubjectLoad.academic_period_id)
    )

    if status_filter:
        query = query.filter(TeacherSubstitution.status == status_filter)

    if batch_id:
        query = query.filter(TeacherSubstitution.batch_id == batch_id)

    if staff_id:
        query = query.filter(
            or_(
                TeacherSubstitution.original_staff_id == staff_id,
                TeacherSubstitution.substitute_staff_id == staff_id,
            )
        )

    if academic_period_id:
        query = query.filter(SubjectLoad.academic_period_id == academic_period_id)

    rows = query.order_by(TeacherSubstitution.created_at.desc()).all()

    sub_staff_ids = {sub.substitute_staff_id for sub, *_ in rows}
    sub_staff_map = {
        s.staff_id: s
        for s in db.query(AcademicStaff).filter(AcademicStaff.staff_id.in_(sub_staff_ids)).all()
    } if sub_staff_ids else {}

    return [
        _format_substitution_response(
            sub,
            load,
            orig_staff,
            sub_staff_map.get(sub.substitute_staff_id, orig_staff),
            subject,
            cls,
            period,
        )
        for sub, load, orig_staff, subject, cls, period in rows
    ]


@router.get("/teacher-loads/{staff_id}", response_model=list[TeacherLoadSummaryItem])
def get_teacher_loads(
    staff_id: str,
    academic_period_id: Optional[int] = Query(None),
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    active_period = db.query(AcademicPeriod).filter(AcademicPeriod.is_active == True).first()

    query = (
        db.query(SubjectLoad, Subject, Class, AcademicPeriod)
        .join(Subject, Subject.subject_id == SubjectLoad.subject_id)
        .join(Class, Class.class_id == SubjectLoad.class_id)
        .join(AcademicPeriod, AcademicPeriod.academic_period_id == SubjectLoad.academic_period_id)
        .filter(
            SubjectLoad.staff_id == staff_id,
            SubjectLoad.status.in_(["active", "published"]),
            Class.class_status != "archived",
        )
    )
    if academic_period_id is not None:
        query = query.filter(SubjectLoad.academic_period_id == academic_period_id)

    rows = query.order_by(AcademicPeriod.period_sequence.asc(), Class.section_name.asc(), Subject.subject_name.asc()).all()

    today_date = date.today()
    load_ids = [sl.subject_load_id for sl, *_ in rows]
    active_subs = (
        db.query(TeacherSubstitution, AcademicStaff)
        .join(AcademicStaff, AcademicStaff.staff_id == TeacherSubstitution.substitute_staff_id)
        .filter(
            TeacherSubstitution.subject_load_id.in_(load_ids),
            TeacherSubstitution.status == "active",
            TeacherSubstitution.start_date <= today_date,
        )
        .all()
    ) if load_ids else []

    active_sub_map: dict[int, str] = {}
    for sub, sub_staff in active_subs:
        if sub.end_date is None or today_date <= sub.end_date:
            active_sub_map[sub.subject_load_id] = _staff_full_name(sub_staff)

    items: list[TeacherLoadSummaryItem] = []
    for load, subject, cls, period in rows:
        sub_name = active_sub_map.get(load.subject_load_id)
        is_active_term = bool(period.is_active or (active_period and period.academic_period_id == active_period.academic_period_id))
        items.append(
            TeacherLoadSummaryItem(
                subject_load_id=load.subject_load_id,
                subject_id=subject.subject_id,
                subject_name=subject.subject_name,
                subject_codename=subject.subject_codename,
                class_id=cls.class_id,
                section_name=cls.section_name,
                academic_period_id=period.academic_period_id,
                period_name=period.period_name,
                is_active_period=is_active_term,
                start_time=load.start_time,
                end_time=load.end_time,
                days_of_week=load.days_of_week or [],
                has_active_substitution=bool(sub_name),
                active_substitute_name=sub_name,
            )
        )

    return items


# ─── BATCH-LEVEL LIFECYCLE ENDPOINTS ──────────────────────────────────────────

@router.patch("/batch/{batch_id}/end-date", response_model=list[TeacherSubstitutionResponse])
def adjust_batch_end_date(
    batch_id: uuid.UUID,
    payload: TeacherSubstitutionUpdateEndDate,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    subs = db.query(TeacherSubstitution).filter(
        TeacherSubstitution.batch_id == batch_id,
        TeacherSubstitution.status == "active",
    ).all()
    if not subs:
        raise HTTPException(status_code=404, detail="No active substitutions found for this batch")

    new_end_date = payload.end_date
    today_date = date.today()

    for sub in subs:
        if new_end_date is not None:
            if new_end_date < sub.start_date:
                raise HTTPException(status_code=400, detail=f"End date cannot be earlier than start date for load #{sub.subject_load_id}")
            if sub.start_date <= today_date and new_end_date < today_date:
                raise HTTPException(status_code=400, detail="End date cannot be set in the past for active substitutions. Use 'End Batch' to conclude today.")

        # Overlap check
        other_subs = db.query(TeacherSubstitution).filter(
            TeacherSubstitution.subject_load_id == sub.subject_load_id,
            TeacherSubstitution.substitution_id != sub.substitution_id,
            TeacherSubstitution.status == "active",
        ).all()
        for other in other_subs:
            if other.end_date is not None and other.end_date < today_date:
                continue
            overlaps = (new_end_date is None or other.start_date <= new_end_date) and (other.end_date is None or sub.start_date <= other.end_date)
            if overlaps:
                raise HTTPException(status_code=409, detail=f"Adjusting date creates an overlap on load #{sub.subject_load_id}")

        sub.end_date = new_end_date

    db.commit()
    for sub in subs:
        db.refresh(sub)

    # Return formatted responses
    return [get_substitution(sub.substitution_id, current_user=current_user, db=db) for sub in subs]


@router.patch("/batch/{batch_id}/end", response_model=list[TeacherSubstitutionResponse])
def end_batch_substitutions_early(
    batch_id: uuid.UUID,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    subs = db.query(TeacherSubstitution).filter(
        TeacherSubstitution.batch_id == batch_id,
        TeacherSubstitution.status == "active",
    ).all()
    if not subs:
        raise HTTPException(status_code=404, detail="No active substitutions found for this batch")

    admin_staff_id = get_optional_staff_id(current_user=current_user, db=db)
    now_utc = datetime.now(timezone.utc)
    today_date = date.today()

    for sub in subs:
        sub.status = "completed"
        sub.ended_at = now_utc
        sub.ended_by_admin_id = admin_staff_id
        sub.end_date = today_date

    db.commit()
    for sub in subs:
        db.refresh(sub)

    return [get_substitution(sub.substitution_id, current_user=current_user, db=db) for sub in subs]


@router.patch("/batch/{batch_id}/cancel", response_model=list[TeacherSubstitutionResponse])
def cancel_batch_substitutions(
    batch_id: uuid.UUID,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    today_date = date.today()
    future_subs = db.query(TeacherSubstitution).filter(
        TeacherSubstitution.batch_id == batch_id,
        TeacherSubstitution.status == "active",
        TeacherSubstitution.start_date > today_date,
    ).all()

    if not future_subs:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot cancel: all active substitutions in this batch have already started. Use 'End Batch' to record when coverage stopped.",
        )

    admin_staff_id = get_optional_staff_id(current_user=current_user, db=db)
    now_utc = datetime.now(timezone.utc)

    for sub in future_subs:
        sub.status = "cancelled"
        sub.ended_at = now_utc
        sub.ended_by_admin_id = admin_staff_id

    db.commit()
    for sub in future_subs:
        db.refresh(sub)

    return [get_substitution(sub.substitution_id, current_user=current_user, db=db) for sub in future_subs]


# ─── SINGLE ROW LIFECYCLE ENDPOINTS ───────────────────────────────────────────

@router.get("/{substitution_id}", response_model=TeacherSubstitutionResponse)
def get_substitution(
    substitution_id: int,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    sub = db.query(TeacherSubstitution).filter(TeacherSubstitution.substitution_id == substitution_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Substitution record not found")

    load = db.query(SubjectLoad).filter(SubjectLoad.subject_load_id == sub.subject_load_id).first()
    orig_staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == sub.original_staff_id).first()
    sub_staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == sub.substitute_staff_id).first()
    subject = db.query(Subject).filter(Subject.subject_id == load.subject_id).first()
    cls = db.query(Class).filter(Class.class_id == load.class_id).first()
    period = db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id == load.academic_period_id).first()

    return _format_substitution_response(sub, load, orig_staff, sub_staff, subject, cls, period)


@router.patch("/{substitution_id}/end-date", response_model=TeacherSubstitutionResponse)
def adjust_substitution_end_date(
    substitution_id: int,
    payload: TeacherSubstitutionUpdateEndDate,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    sub = db.query(TeacherSubstitution).filter(TeacherSubstitution.substitution_id == substitution_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Substitution record not found")

    if sub.status != "active":
        raise HTTPException(status_code=400, detail=f"Cannot adjust end date for a {sub.status} substitution")

    new_end_date = payload.end_date
    today_date = date.today()

    if new_end_date is not None:
        if new_end_date < sub.start_date:
            raise HTTPException(status_code=400, detail="End date cannot be earlier than start date")
        if sub.start_date <= today_date and new_end_date < today_date:
            raise HTTPException(
                status_code=400,
                detail="For an active substitution, end date cannot be set in the past. Use /end to conclude coverage today.",
            )

    other_subs = (
        db.query(TeacherSubstitution)
        .filter(
            TeacherSubstitution.subject_load_id == sub.subject_load_id,
            TeacherSubstitution.substitution_id != sub.substitution_id,
            TeacherSubstitution.status == "active",
        )
        .all()
    )
    for other in other_subs:
        o_start = other.start_date
        o_end = other.end_date
        if o_end is not None and o_end < today_date:
            continue
        overlaps = (new_end_date is None or o_start <= new_end_date) and (o_end is None or sub.start_date <= o_end)
        if overlaps:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Adjusting date creates an overlap with another substitution from {o_start} to {o_end or 'open-ended'}.",
            )

    sub.end_date = new_end_date
    db.commit()
    db.refresh(sub)

    load = db.query(SubjectLoad).filter(SubjectLoad.subject_load_id == sub.subject_load_id).first()
    orig_staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == sub.original_staff_id).first()
    sub_staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == sub.substitute_staff_id).first()
    subject = db.query(Subject).filter(Subject.subject_id == load.subject_id).first()
    cls = db.query(Class).filter(Class.class_id == load.class_id).first()
    period = db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id == load.academic_period_id).first()

    return _format_substitution_response(sub, load, orig_staff, sub_staff, subject, cls, period)


@router.patch("/{substitution_id}/end", response_model=TeacherSubstitutionResponse)
def end_substitution_early(
    substitution_id: int,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    sub = db.query(TeacherSubstitution).filter(TeacherSubstitution.substitution_id == substitution_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Substitution record not found")

    if sub.status != "active":
        raise HTTPException(status_code=400, detail=f"Substitution is already {sub.status}")

    admin_staff_id = get_optional_staff_id(current_user=current_user, db=db)
    now_utc = datetime.now(timezone.utc)
    today_date = date.today()

    sub.status = "completed"
    sub.ended_at = now_utc
    sub.ended_by_admin_id = admin_staff_id
    sub.end_date = today_date

    db.commit()
    db.refresh(sub)

    load = db.query(SubjectLoad).filter(SubjectLoad.subject_load_id == sub.subject_load_id).first()
    orig_staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == sub.original_staff_id).first()
    sub_staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == sub.substitute_staff_id).first()
    subject = db.query(Subject).filter(Subject.subject_id == load.subject_id).first()
    cls = db.query(Class).filter(Class.class_id == load.class_id).first()
    period = db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id == load.academic_period_id).first()

    return _format_substitution_response(sub, load, orig_staff, sub_staff, subject, cls, period)


@router.patch("/{substitution_id}/cancel", response_model=TeacherSubstitutionResponse)
def cancel_future_substitution(
    substitution_id: int,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    sub = db.query(TeacherSubstitution).filter(TeacherSubstitution.substitution_id == substitution_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Substitution record not found")

    if sub.status != "active":
        raise HTTPException(status_code=400, detail=f"Substitution is already {sub.status}")

    today_date = date.today()
    if sub.start_date <= today_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This substitution has already started. Use /end to record when coverage stopped.",
        )

    admin_staff_id = get_optional_staff_id(current_user=current_user, db=db)
    sub.status = "cancelled"
    sub.ended_at = datetime.now(timezone.utc)
    sub.ended_by_admin_id = admin_staff_id

    db.commit()
    db.refresh(sub)

    load = db.query(SubjectLoad).filter(SubjectLoad.subject_load_id == sub.subject_load_id).first()
    orig_staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == sub.original_staff_id).first()
    sub_staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == sub.substitute_staff_id).first()
    subject = db.query(Subject).filter(Subject.subject_id == load.subject_id).first()
    cls = db.query(Class).filter(Class.class_id == load.class_id).first()
    period = db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id == load.academic_period_id).first()

    return _format_substitution_response(sub, load, orig_staff, sub_staff, subject, cls, period)
