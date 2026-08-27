from datetime import date, datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.attendance.Attendance import AttendanceRecord, LeaveRequest
from app.models.people.Student import Student
from app.models.people.AcademicStaff import AcademicStaff
from app.schemas.Attendance import (
    BatchAttendanceCreate,
    AttendanceRecordResponse,
    AttendanceSummaryResponse,
    LeaveRequestCreate,
    LeaveRequestResponse,
    LeaveRequestUpdate,
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


def _to_leave_request_response(leave_req: LeaveRequest, student_name: str | None = None) -> LeaveRequestResponse:
    return LeaveRequestResponse(
        leave_request_id=getattr(leave_req, "leave_request_id"),
        student_id=getattr(leave_req, "student_id"),
        student_name=student_name,
        class_id=getattr(leave_req, "class_id"),
        start_date=getattr(leave_req, "start_date"),
        end_date=getattr(leave_req, "end_date"),
        reason=getattr(leave_req, "reason"),
        status=getattr(leave_req, "status"),
        reviewed_by_staff_id=getattr(leave_req, "reviewed_by_staff_id"),
        reviewed_at=getattr(leave_req, "reviewed_at"),
        created_at=getattr(leave_req, "created_at"),
        updated_at=getattr(leave_req, "updated_at"),
    )


def batch_mark_attendance(
    db: Session,
    payload: BatchAttendanceCreate,
    recorded_by_staff_id: str | None = None,
) -> list[AttendanceRecordResponse]:
    """Upsert daily attendance records for a batch of students in a class."""
    if recorded_by_staff_id and payload.subject_id:
        from app.models.academic.SubjectLoad import SubjectLoad
        from app.services.academic.SubstitutionService import SubstitutionService
        loads = db.query(SubjectLoad).filter(
            SubjectLoad.class_id == payload.class_id,
            SubjectLoad.subject_id == payload.subject_id,
            SubjectLoad.status.in_(["active", "published"]),
        ).all()
        for sl in loads:
            if sl.staff_id == recorded_by_staff_id:
                SubstitutionService.assert_can_write(db, recorded_by_staff_id, sl.subject_load_id, payload.date)

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


def get_class_attendance_logs(
    db: Session,
    class_id: int,
    date_val: Optional[date] = None,
    subject_id: Optional[int] = None,
) -> list[AttendanceRecordResponse]:
    """Retrieve attendance logs for a specific class, optionally filtered by date or subject."""
    query = (
        db.query(AttendanceRecord, Student)
        .join(Student, Student.student_id == AttendanceRecord.student_id)
        .filter(AttendanceRecord.class_id == class_id)
    )

    if date_val:
        query = query.filter(AttendanceRecord.date == date_val)
    if subject_id:
        query = query.filter(AttendanceRecord.subject_id == subject_id)

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
) -> AttendanceSummaryResponse:
    """Calculate attendance statistics and overall rate for a student."""
    query = db.query(AttendanceRecord).filter(AttendanceRecord.student_id == student_id)
    if class_id:
        query = query.filter(AttendanceRecord.class_id == class_id)
    if subject_id:
        query = query.filter(AttendanceRecord.subject_id == subject_id)

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


def create_leave_request(
    db: Session,
    student_id: UUID,
    payload: LeaveRequestCreate,
) -> LeaveRequestResponse:
    """Submit a leave of absence request for a student."""
    leave_req = LeaveRequest(
        student_id=student_id,
        class_id=payload.class_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        reason=payload.reason,
        status="pending",
    )
    db.add(leave_req)
    db.commit()
    db.refresh(leave_req)

    student = db.query(Student).filter(Student.student_id == student_id).first()
    student_name = f"{student.first_name} {student.last_name}" if student else None

    return _to_leave_request_response(leave_req, student_name=student_name)


def get_class_leave_requests(
    db: Session,
    class_id: int,
    status_filter: Optional[str] = None,
) -> list[LeaveRequestResponse]:
    """Retrieve leave requests for a class."""
    query = (
        db.query(LeaveRequest, Student)
        .join(Student, Student.student_id == LeaveRequest.student_id)
        .filter(LeaveRequest.class_id == class_id)
    )

    if status_filter:
        query = query.filter(LeaveRequest.status == status_filter)

    query = query.order_by(LeaveRequest.created_at.desc())
    rows = query.all()

    return [
        _to_leave_request_response(req, student_name=f"{student.first_name} {student.last_name}")
        for req, student in rows
    ]


def update_leave_request_status(
    db: Session,
    leave_request_id: int,
    payload: LeaveRequestUpdate,
    reviewed_by_staff_id: str | None = None,
) -> LeaveRequestResponse:
    """Approve or reject a student leave request."""
    leave_req = db.query(LeaveRequest).filter(LeaveRequest.leave_request_id == leave_request_id).first()
    if not leave_req:
        raise HTTPException(status_code=404, detail="Leave request not found")

    leave_req.status = payload.status
    leave_req.reviewed_by_staff_id = reviewed_by_staff_id
    leave_req.reviewed_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(leave_req)

    student = db.query(Student).filter(Student.student_id == leave_req.student_id).first()
    student_name = f"{student.first_name} {student.last_name}" if student else None

    return _to_leave_request_response(leave_req, student_name=student_name)


def get_student_attendance_logs(
    db: Session,
    student_id: UUID,
    class_id: Optional[int] = None,
    subject_id: Optional[int] = None,
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


def get_student_leave_requests(
    db: Session,
    student_id: UUID,
    class_id: Optional[int] = None,
) -> list[LeaveRequestResponse]:
    """Retrieve submitted leave requests for a specific student."""
    query = (
        db.query(LeaveRequest, Student)
        .join(Student, Student.student_id == LeaveRequest.student_id)
        .filter(LeaveRequest.student_id == student_id)
    )
    if class_id:
        query = query.filter(LeaveRequest.class_id == class_id)

    query = query.order_by(LeaveRequest.created_at.desc())
    rows = query.all()

    return [
        _to_leave_request_response(req, student_name=f"{student.first_name} {student.last_name}")
        for req, student in rows
    ]

