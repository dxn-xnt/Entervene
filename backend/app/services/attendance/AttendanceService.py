from datetime import date, datetime, timezone
from typing import Any, Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from app.models.academic.StudentCLass import StudentClass
from app.models.attendance.Attendance import AttendanceRecord
from app.models.people.Student import Student
from app.models.people.AcademicStaff import AcademicStaff
from app.schemas.Attendance import (
    BatchAttendanceCreate,
    AttendanceRecordResponse,
    AttendanceSummaryResponse,
    QRScanAttendanceRequest,
    QRScanAttendanceResponse,
)


def _get_staff_id_from_user_id(db: Session, user_id: UUID) -> str | None:
    staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == user_id).first()
    return staff.staff_id if staff else None


def _get_student_id_from_user_id(db: Session, user_id: UUID) -> UUID:
    student = db.query(Student).filter(Student.user_id == user_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student profile not found for this account")
    return student.student_id


def _to_attendance_response(
    record: AttendanceRecord,
    student_name: str | None = None,
    subject_name: str | None = None,
) -> AttendanceRecordResponse:
    resolved_subject_name = subject_name
    if not resolved_subject_name and getattr(record, "subject", None):
        resolved_subject_name = record.subject.subject_name
    return AttendanceRecordResponse(
        attendance_id=getattr(record, "attendance_id"),
        student_id=getattr(record, "student_id"),
        student_name=student_name,
        class_id=getattr(record, "class_id"),
        subject_id=getattr(record, "subject_id"),
        subject_name=resolved_subject_name,
        date=getattr(record, "date"),
        status=getattr(record, "status"),
        remarks=getattr(record, "remarks"),
        recorded_by_staff_id=getattr(record, "recorded_by_staff_id"),
        created_at=getattr(record, "created_at"),
        updated_at=getattr(record, "updated_at"),
    )


def _resolve_attendance_period_id(
    db: Session,
    class_id: int,
    subject_id: int | None,
    target_date: date | None,
    academic_period_id: int | None = None,
) -> int | None:
    from app.models.academic.AcademicPeriod import AcademicPeriod
    from app.models.academic.Class_ import Class
    from app.models.academic.SubjectLoad import SubjectLoad

    class_obj = db.get(Class, class_id)
    if class_obj is None:
        raise HTTPException(status_code=404, detail="Class not found.")

    requested_period = db.get(AcademicPeriod, academic_period_id) if academic_period_id is not None else None
    if academic_period_id is not None and requested_period is None:
        raise HTTPException(status_code=404, detail="Academic period not found.")
    if requested_period is not None:
        if requested_period.academic_year_id != class_obj.academic_year_id:
            raise HTTPException(
                status_code=400,
                detail="Academic class and period must belong to the same academic year.",
            )
        if target_date is not None:
            if requested_period.start_date and target_date < requested_period.start_date:
                raise HTTPException(
                    status_code=400,
                    detail="Attendance date must fall within the selected academic period.",
                )
            if requested_period.end_date and target_date > requested_period.end_date:
                raise HTTPException(
                    status_code=400,
                    detail="Attendance date must fall within the selected academic period.",
                )

    if subject_id is not None:
        load_query = (
            db.query(SubjectLoad)
            .filter(
                SubjectLoad.class_id == class_id,
                SubjectLoad.subject_id == subject_id,
                SubjectLoad.is_active_version.is_(True),
                SubjectLoad.status.in_(["active", "published"]),
            )
        )
        if requested_period is not None:
            if load_query.filter(SubjectLoad.academic_period_id == requested_period.academic_period_id).first() is None:
                raise HTTPException(
                    status_code=400,
                    detail="No published subject load exists in the selected academic period.",
                )
            return requested_period.academic_period_id

        loads = load_query.all()
        matching_loads = []
        for load in loads:
            period = db.get(AcademicPeriod, load.academic_period_id)
            if target_date is not None and period and (
                (period.start_date is None or period.start_date <= target_date)
                and (period.end_date is None or target_date <= period.end_date)
            ):
                matching_loads.append(load)
        if len(matching_loads) == 1:
            return matching_loads[0].academic_period_id
        if len(matching_loads) > 1:
            raise HTTPException(status_code=409, detail="Attendance period is ambiguous for this date.")
        raise HTTPException(
            status_code=400,
            detail="Attendance date does not belong to a published subject load period.",
        )

    if requested_period is not None:
        return requested_period.academic_period_id

    if class_obj.academic_year_id is not None and target_date is not None:
        matching_periods = (
            db.query(AcademicPeriod)
            .filter(
                AcademicPeriod.academic_year_id == class_obj.academic_year_id,
                or_(AcademicPeriod.start_date.is_(None), AcademicPeriod.start_date <= target_date),
                or_(AcademicPeriod.end_date.is_(None), AcademicPeriod.end_date >= target_date),
            )
            .all()
        )
        if len(matching_periods) == 1:
            return matching_periods[0].academic_period_id
        if len(matching_periods) > 1:
            raise HTTPException(status_code=409, detail="Attendance period is ambiguous for this date.")
    raise HTTPException(
        status_code=400,
        detail="Attendance date does not belong to an academic period for this class year.",
    )


def _assert_attendance_write_access(
    db: Session,
    class_id: int,
    subject_id: int | None,
    target_date: date,
    recorded_by_staff_id: str | None,
    academic_period_id: int | None = None,
    role: str = "teacher",
) -> int:
    from app.models.academic.Class_ import Class
    from app.models.academic.SubjectLoad import SubjectLoad
    from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService
    from app.services.academic.AcademicYearService import is_academic_year_authorized

    class_obj = db.get(Class, class_id)
    if class_obj is None:
        raise HTTPException(status_code=404, detail="Class not found.")

    if class_obj.academic_year_id is not None and role != "admin":
        if not is_academic_year_authorized(db, class_obj.academic_year_id, role=role, staff_id=recorded_by_staff_id):
            raise HTTPException(
                status_code=403,
                detail="Not authorized to access this academic year",
            )

    period_id = _resolve_attendance_period_id(
        db, class_id, subject_id, target_date, academic_period_id=academic_period_id
    )
    SubjectLoadAuthorizationService.assert_context_writable(
        db,
        class_id=class_id,
        academic_period_id=period_id,
        as_of=target_date,
        block_future_period_in_current_year=True,
    )
    if not recorded_by_staff_id or role == "admin":
        return period_id

    if subject_id is not None:
        if period_id is not None:
            SubjectLoadAuthorizationService.assert_can_write(
                db,
                recorded_by_staff_id,
                class_id,
                subject_id,
                period_id,
                as_of=target_date,
            )
            return period_id
        class_loads = (
            db.query(SubjectLoad)
            .filter(
                SubjectLoad.class_id == class_id,
                SubjectLoad.is_active_version.is_(True),
                SubjectLoad.status.in_(["active", "published"]),
            )
            .all()
        )
        if (class_obj and class_obj.adviser_staff_id) or class_loads:
            raise HTTPException(
                status_code=403,
                detail="You are not authorized to modify records for this class and subject.",
            )
        return period_id

    class_loads = (
        db.query(SubjectLoad)
        .filter(
            SubjectLoad.class_id == class_id,
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(["active", "published"]),
        )
        .all()
    )
    is_adviser = bool(class_obj and class_obj.adviser_staff_id == recorded_by_staff_id)
    has_load_write = any(
        SubjectLoadAuthorizationService.can_write(
            db, recorded_by_staff_id, l.class_id, l.subject_id, l.academic_period_id, as_of=target_date
        )
        for l in class_loads
    )
    if not is_adviser and not has_load_write:
        raise HTTPException(
            status_code=403,
            detail="You are not authorized to modify attendance records for this class.",
        )
    return period_id


def _assert_attendance_read_access(
    db: Session,
    class_id: int | None,
    subject_id: int | None,
    staff_id: str | None,
    student_id: UUID | None = None,
    academic_period_id: int | None = None,
    role: str = "teacher",
) -> None:
    if not staff_id or role == "admin":
        return
    from app.models.academic.Class_ import Class
    from app.models.academic.SubjectLoad import SubjectLoad
    from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService
    from app.services.academic.AcademicYearService import is_academic_year_authorized

    if class_id is not None:
        class_obj = db.get(Class, class_id)
        if class_obj and class_obj.academic_year_id is not None:
            if not is_academic_year_authorized(db, class_obj.academic_year_id, role=role, staff_id=staff_id):
                raise HTTPException(
                    status_code=403,
                    detail="Not authorized to access this academic year",
                )
        if subject_id is not None:
            load_query = (
                db.query(SubjectLoad)
                .filter(
                    SubjectLoad.class_id == class_id,
                    SubjectLoad.subject_id == subject_id,
                    SubjectLoad.is_active_version.is_(True),
                    SubjectLoad.status.in_(["active", "published"]),
                )
            )
            if academic_period_id is not None:
                load_query = load_query.filter(SubjectLoad.academic_period_id == academic_period_id)
            loads = load_query.all()
            if loads:
                if (class_obj and class_obj.adviser_staff_id == staff_id) or any(
                    SubjectLoadAuthorizationService.can_view(
                        db, staff_id, l.class_id, l.subject_id, l.academic_period_id
                    )
                    for l in loads
                ):
                    return
                raise HTTPException(
                    status_code=403,
                    detail="You do not have access to view attendance records for this class and subject.",
                )
        all_class_loads_query = (
            db.query(SubjectLoad)
            .filter(
                SubjectLoad.class_id == class_id,
                SubjectLoad.is_active_version.is_(True),
                SubjectLoad.status.in_(["active", "published"]),
            )
        )
        if academic_period_id is not None:
            all_class_loads_query = all_class_loads_query.filter(
                SubjectLoad.academic_period_id == academic_period_id
            )
        all_class_loads = all_class_loads_query.all()
        if (class_obj and class_obj.adviser_staff_id) or all_class_loads:
            if (class_obj and class_obj.adviser_staff_id == staff_id) or any(
                SubjectLoadAuthorizationService.can_view(
                    db, staff_id, l.class_id, l.subject_id, l.academic_period_id
                )
                for l in all_class_loads
            ):
                return
            raise HTTPException(
                status_code=403,
                detail="You do not have access to view attendance records for this class.",
            )
        return

    if student_id is not None:
        enrolled_class_ids = [
            row[0]
            for row in db.query(StudentClass.class_id)
            .filter(StudentClass.student_id == student_id)
            .all()
        ]
        if not enrolled_class_ids:
            return
        classes = db.query(Class).filter(Class.class_id.in_(enrolled_class_ids)).all()
        loads = (
            db.query(SubjectLoad)
            .filter(
                SubjectLoad.class_id.in_(enrolled_class_ids),
                SubjectLoad.is_active_version.is_(True),
                SubjectLoad.status.in_(["active", "published"]),
            )
            .all()
        )
        if any(c.adviser_staff_id for c in classes) or loads:
            if any(c.adviser_staff_id == staff_id for c in classes) or any(
                SubjectLoadAuthorizationService.can_view(
                    db, staff_id, l.class_id, l.subject_id, l.academic_period_id
                )
                for l in loads
            ):
                return
            raise HTTPException(
                status_code=403,
                detail="You do not have access to view attendance records for this student.",
            )


def batch_mark_attendance(
    db: Session,
    payload: BatchAttendanceCreate,
    recorded_by_staff_id: str | None = None,
    role: str = "teacher",
) -> list[AttendanceRecordResponse]:
    """Upsert daily attendance records for a batch of students in a class."""
    _assert_attendance_write_access(
        db,
        class_id=payload.class_id,
        subject_id=payload.subject_id,
        target_date=payload.date,
        recorded_by_staff_id=recorded_by_staff_id,
        academic_period_id=payload.academic_period_id,
        role=role,
    )
    requested_student_ids = {item.student_id for item in payload.records}
    if requested_student_ids:
        enrolled_student_ids = {
            row[0]
            for row in db.query(StudentClass.student_id)
            .filter(
                StudentClass.class_id == payload.class_id,
                StudentClass.student_id.in_(requested_student_ids),
                StudentClass.enrollment_status == "enrolled",
            )
            .all()
        }
        if enrolled_student_ids != requested_student_ids:
            raise HTTPException(
                status_code=400,
                detail="Attendance can only be recorded for students actively enrolled in this class.",
            )
    results: list[AttendanceRecordResponse] = []


    for item in payload.records:
        existing_q = (
            db.query(AttendanceRecord)
            .filter(
                AttendanceRecord.student_id == item.student_id,
                AttendanceRecord.class_id == payload.class_id,
                AttendanceRecord.date == payload.date,
            )
        )
        if payload.subject_id is not None:
            existing_q = existing_q.filter(AttendanceRecord.subject_id == payload.subject_id)
        else:
            existing_q = existing_q.filter(AttendanceRecord.subject_id.is_(None))
        existing = existing_q.first()


        if existing:
            existing.status = item.status
            existing.remarks = item.remarks
            existing.recorded_by_staff_id = recorded_by_staff_id
            existing.subject_id = payload.subject_id
            record = existing
        else:
            record = AttendanceRecord(
                student_id=item.student_id,
                class_id=payload.class_id,
                subject_id=payload.subject_id,
                date=payload.date,
                status=item.status,
                remarks=item.remarks,
                recorded_by_staff_id=recorded_by_staff_id,
            )
            db.add(record)

        db.flush()

        student = db.query(Student).filter(Student.student_id == item.student_id).first()
        student_name = f"{student.first_name} {student.last_name}" if student else None
        results.append(_to_attendance_response(record, student_name=student_name))

    db.commit()
    return results


def record_qr_scan_attendance(
    db: Session,
    payload: QRScanAttendanceRequest,
    recorded_by_staff_id: str | None = None,
    role: str = "teacher",
) -> QRScanAttendanceResponse:
    """Record student attendance via QR code scan.
    
    Validates that:
    1. Student exists.
    2. Student is actively enrolled in the selected class (section).
    3. Teacher has authorization (including substitution permissions if subject_id specified).
    4. Handles duplicates:
       - If already marked 'present': returns is_duplicate=True without changes.
       - If already marked 'excused': does NOT overwrite approved excuse, returns is_duplicate=True.
       - If marked 'absent' or 'late': updates to 'present'.
       - If not marked: creates new record with 'present'.
    5. Server strictly computes date.today() (never trusts client date).
    """
    today = date.today()

    # 1. Fetch student
    student = db.query(Student).filter(Student.student_id == payload.student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")

    student_name = f"{student.first_name} {student.last_name}"

    # 2. Check enrollment in class
    enrollment = (
        db.query(StudentClass)
        .filter(
            StudentClass.student_id == payload.student_id,
            StudentClass.class_id == payload.class_id,
            StudentClass.enrollment_status == "enrolled",
        )
        .first()
    )
    if not enrollment:
        raise HTTPException(
            status_code=400,
            detail=f"{student_name} is not actively enrolled in this class section.",
        )

    # 3. Check substitution / teacher write permissions
    _assert_attendance_write_access(
        db,
        class_id=payload.class_id,
        subject_id=payload.subject_id,
        target_date=today,
        recorded_by_staff_id=recorded_by_staff_id,
        academic_period_id=payload.academic_period_id,
        role=role,
    )
    # 4. Check existing attendance record for (student_id, class_id, subject_id, today)
    existing_q = db.query(AttendanceRecord).filter(
        AttendanceRecord.student_id == payload.student_id,
        AttendanceRecord.class_id == payload.class_id,
        AttendanceRecord.date == today,
    )
    if payload.subject_id is not None:
        existing_q = existing_q.filter(AttendanceRecord.subject_id == payload.subject_id)
    else:
        existing_q = existing_q.filter(AttendanceRecord.subject_id.is_(None))

    existing = existing_q.first()

    is_duplicate = False
    if existing:
        if existing.status == "present":
            is_duplicate = True
            message = f"{student_name} is already marked present for today's session."
            record = existing
        elif existing.status == "excused":
            is_duplicate = True
            message = f"{student_name} has an approved excused absence. Record not overwritten."
            record = existing
        else:
            old_status = existing.status
            existing.status = "present"
            existing.recorded_by_staff_id = recorded_by_staff_id
            db.commit()
            db.refresh(existing)
            record = existing
            message = f"{student_name} marked present (updated from {old_status})."
    else:
        record = AttendanceRecord(
            student_id=payload.student_id,
            class_id=payload.class_id,
            subject_id=payload.subject_id,
            date=today,
            status="present",
            recorded_by_staff_id=recorded_by_staff_id,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        message = f"{student_name} marked present successfully."

    resolved_subject_name = None
    if getattr(record, "subject", None):
        resolved_subject_name = record.subject.subject_name

    return QRScanAttendanceResponse(
        attendance_id=record.attendance_id,
        student_id=record.student_id,
        student_name=student_name,
        student_lrn=student.student_lrn,
        class_id=record.class_id,
        subject_id=record.subject_id,
        subject_name=resolved_subject_name,
        date=record.date,
        status=record.status,
        is_duplicate=is_duplicate,
        message=message,
    )


def get_class_attendance_logs(
    db: Session,
    class_id: int,
    date_val: Optional[date] = None,
    subject_id: Optional[int] = None,
    academic_period_id: Optional[int] = None,
    academic_year_id: Optional[int] = None,
    staff_id: Optional[str] = None,
    role: str = "teacher",
) -> list[AttendanceRecordResponse]:
    """Retrieve attendance logs for a specific class, optionally filtered by date, subject, period, or year."""
    from app.models.academic.Class_ import Class
    from app.models.academic.AcademicPeriod import AcademicPeriod
    from app.services.academic.AcademicYearService import is_academic_year_authorized

    class_obj = db.get(Class, class_id)
    if class_obj is None:
        raise HTTPException(status_code=404, detail="Class not found.")

    if role != "admin":
        if academic_year_id is not None and not is_academic_year_authorized(
            db, academic_year_id, role=role, staff_id=staff_id
        ):
            raise HTTPException(status_code=403, detail="Not authorized to access this academic year")
        if class_obj.academic_year_id is not None and not is_academic_year_authorized(
            db, class_obj.academic_year_id, role=role, staff_id=staff_id
        ):
            raise HTTPException(status_code=403, detail="Not authorized to access this academic year")

    if academic_year_id is not None and class_obj.academic_year_id is not None:
        if class_obj.academic_year_id != academic_year_id:
            raise HTTPException(
                status_code=400,
                detail="Class does not belong to specified academic year.",
            )

    period = None
    if academic_period_id is not None:
        period = db.get(AcademicPeriod, academic_period_id)
        if period is None:
            raise HTTPException(status_code=404, detail="Academic period not found.")
        if class_obj.academic_year_id is not None and period.academic_year_id != class_obj.academic_year_id:
            raise HTTPException(
                status_code=400,
                detail="Academic class and period must belong to the same academic year.",
            )
        if academic_year_id is not None and period.academic_year_id != academic_year_id:
            raise HTTPException(
                status_code=400,
                detail="Academic period does not belong to specified academic year.",
            )
        if role != "admin" and not is_academic_year_authorized(
            db, period.academic_year_id, role=role, staff_id=staff_id
        ):
            raise HTTPException(status_code=403, detail="Not authorized to access this academic year")

    _assert_attendance_read_access(
        db, class_id=class_id, subject_id=subject_id, staff_id=staff_id,
        academic_period_id=academic_period_id, role=role,
    )
    query = (
        db.query(AttendanceRecord, Student)
        .join(Student, Student.student_id == AttendanceRecord.student_id)
        .filter(AttendanceRecord.class_id == class_id)
    )

    if date_val:
        query = query.filter(AttendanceRecord.date == date_val)
    if subject_id:
        query = query.filter(AttendanceRecord.subject_id == subject_id)
    if period is not None:
        if period.start_date is not None:
            query = query.filter(AttendanceRecord.date >= period.start_date)
        if period.end_date is not None:
            query = query.filter(AttendanceRecord.date <= period.end_date)

    query = query.order_by(AttendanceRecord.date.desc(), Student.last_name.asc())
    rows = query.all()

    return [
        _to_attendance_response(record, student_name=f"{student.first_name} {student.last_name}")
        for record, student in rows
    ]


def get_student_attendance_summary(
    db: Session,
    student_id: UUID,
    class_id: Optional[int] = None,
    subject_id: Optional[int] = None,
    academic_period_id: Optional[int] = None,
    academic_year_id: Optional[int] = None,
    staff_id: Optional[str] = None,
    role: str = "teacher",
) -> AttendanceSummaryResponse:
    """Calculate attendance statistics and overall rate for a student."""
    from app.models.academic.Class_ import Class
    from app.models.academic.AcademicPeriod import AcademicPeriod
    from app.services.academic.AcademicYearService import is_academic_year_authorized

    if class_id is not None:
        class_obj = db.get(Class, class_id)
        if class_obj is None:
            raise HTTPException(status_code=404, detail="Class not found.")
        if role != "admin":
            if academic_year_id is not None and not is_academic_year_authorized(
                db, academic_year_id, role=role, staff_id=staff_id
            ):
                raise HTTPException(status_code=403, detail="Not authorized to access this academic year")
            if class_obj.academic_year_id is not None and not is_academic_year_authorized(
                db, class_obj.academic_year_id, role=role, staff_id=staff_id
            ):
                raise HTTPException(status_code=403, detail="Not authorized to access this academic year")
        if academic_year_id is not None and class_obj.academic_year_id is not None:
            if class_obj.academic_year_id != academic_year_id:
                raise HTTPException(
                    status_code=400,
                    detail="Class does not belong to specified academic year.",
                )

    period = None
    if academic_period_id is not None:
        period = db.get(AcademicPeriod, academic_period_id)
        if period is None:
            raise HTTPException(status_code=404, detail="Academic period not found.")
        if class_id is not None:
            class_obj = db.get(Class, class_id)
            if class_obj and class_obj.academic_year_id is not None and period.academic_year_id != class_obj.academic_year_id:
                raise HTTPException(
                    status_code=400,
                    detail="Academic class and period must belong to the same academic year.",
                )
        if academic_year_id is not None and period.academic_year_id != academic_year_id:
            raise HTTPException(
                status_code=400,
                detail="Academic period does not belong to specified academic year.",
            )
        if role != "admin" and not is_academic_year_authorized(
            db, period.academic_year_id, role=role, staff_id=staff_id
        ):
            raise HTTPException(status_code=403, detail="Not authorized to access this academic year")

    _assert_attendance_read_access(
        db,
        class_id=class_id,
        subject_id=subject_id,
        staff_id=staff_id,
        student_id=student_id,
        academic_period_id=academic_period_id,
        role=role,
    )
    query = db.query(AttendanceRecord).filter(AttendanceRecord.student_id == student_id)
    if class_id:
        query = query.filter(AttendanceRecord.class_id == class_id)
    if subject_id:
        query = query.filter(AttendanceRecord.subject_id == subject_id)
    if period is not None:
        if period.start_date is not None:
            query = query.filter(AttendanceRecord.date >= period.start_date)
        if period.end_date is not None:
            query = query.filter(AttendanceRecord.date <= period.end_date)

    records = query.all()
    total_days = len(records)
    present_count = sum(1 for r in records if r.status == "present")
    absent_count = sum(1 for r in records if r.status == "absent")
    late_count = sum(1 for r in records if r.status == "late")
    excused_count = sum(1 for r in records if r.status == "excused")

    # Rate calculation: present + late counts as attended
    attended = present_count + late_count + excused_count
    attendance_rate = round((attended / total_days * 100), 2) if total_days > 0 else 100.0

    return AttendanceSummaryResponse(
        total_days=total_days,
        present_count=present_count,
        absent_count=absent_count,
        late_count=late_count,
        excused_count=excused_count,
        attendance_rate=attendance_rate,
    )


def get_risk_adjusted_attendance_rate(
    db: Session,
    student_id: UUID,
    class_id: Optional[int] = None,
    subject_id: Optional[int] = None,
    staff_id: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    cutoff_date: Optional[date] = None,
) -> dict[str, Any]:
    """Calculate risk-adjusted attendance statistics and weighted rate for early risk detection.

    Formula: (1.0*present + 0.8*excused + 0.5*late + 0.0*absent) / total_days * 100
    Returns risk_adjusted_rate = None if total_days == 0 (cold start / no records).
    """
    query = db.query(AttendanceRecord).filter(AttendanceRecord.student_id == student_id)
    if class_id:
        query = query.filter(AttendanceRecord.class_id == class_id)
    if subject_id:
        query = query.filter(AttendanceRecord.subject_id == subject_id)
    if start_date is not None:
        query = query.filter(AttendanceRecord.date >= start_date)
    if end_date is not None:
        query = query.filter(AttendanceRecord.date <= end_date)
    if cutoff_date is not None:
        query = query.filter(AttendanceRecord.date <= cutoff_date)

    records = query.all()
    total_days = len(records)
    if total_days == 0:
        return {
            "total_days": 0,
            "present_count": 0,
            "absent_count": 0,
            "late_count": 0,
            "excused_count": 0,
            "risk_adjusted_rate": None,
            "records": [],
        }

    present_count = sum(1 for r in records if r.status == "present")
    absent_count = sum(1 for r in records if r.status == "absent")
    late_count = sum(1 for r in records if r.status == "late")
    excused_count = sum(1 for r in records if r.status == "excused")

    weighted_score = (1.0 * present_count) + (0.8 * excused_count) + (0.5 * late_count) + (0.0 * absent_count)
    risk_adjusted_rate = round((weighted_score / total_days * 100.0), 2)

    return {
        "total_days": total_days,
        "present_count": present_count,
        "absent_count": absent_count,
        "late_count": late_count,
        "excused_count": excused_count,
        "risk_adjusted_rate": risk_adjusted_rate,
        "records": [
            {"attendance_id": record.attendance_id, "date": record.date.isoformat(), "status": record.status}
            for record in records
        ],
    }




def get_student_attendance_logs(
    db: Session,
    student_id: UUID,
    class_id: Optional[int] = None,
    subject_id: Optional[int] = None,
    staff_id: Optional[str] = None,
) -> list[AttendanceRecordResponse]:
    """Retrieve attendance record history for a specific student."""
    from app.models.academic.Subject import Subject
    query = (
        db.query(AttendanceRecord, Student, Subject)
        .join(Student, Student.student_id == AttendanceRecord.student_id)
        .outerjoin(Subject, Subject.subject_id == AttendanceRecord.subject_id)
        .filter(AttendanceRecord.student_id == student_id)
    )
    if class_id:
        query = query.filter(AttendanceRecord.class_id == class_id)
    if subject_id:
        query = query.filter(AttendanceRecord.subject_id == subject_id)

    query = query.order_by(AttendanceRecord.date.desc())
    rows = query.all()

    return [
        _to_attendance_response(
            record,
            student_name=f"{student.first_name} {student.last_name}",
            subject_name=subject.subject_name if subject else None,
        )
        for record, student, subject in rows
    ]


