from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.v1.routes.Auth import get_current_user
from app.db.Session import get_db
from app.schemas.Attendance import (
    BatchAttendanceCreate,
    AttendanceRecordResponse,
    AttendanceSummaryResponse,
    LeaveRequestCreate,
    LeaveRequestResponse,
    LeaveRequestUpdate,
    QRScanAttendanceRequest,
    QRScanAttendanceResponse,
)
from app.services.attendance.AttendanceService import (
    _get_staff_id_from_user_id,
    _get_student_id_from_user_id,
    batch_mark_attendance,
    create_leave_request,
    get_class_attendance_logs,
    get_class_leave_requests,
    get_student_attendance_logs,
    get_student_attendance_summary,
    get_student_leave_requests,
    record_qr_scan_attendance,
    update_leave_request_status,
)

router = APIRouter()


@router.post("/scan", response_model=QRScanAttendanceResponse)
def scan_qr_attendance(
    payload: QRScanAttendanceRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Record attendance via QR code scan for the current teacher's selected class session.
    """
    user_id = UUID(current_user["sub"])
    staff_id = _get_staff_id_from_user_id(db, user_id)
    return record_qr_scan_attendance(db=db, payload=payload, recorded_by_staff_id=staff_id)


@router.post("", response_model=list[AttendanceRecordResponse])
def record_batch_attendance(
    payload: BatchAttendanceCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Batch mark or update daily attendance for a class.
    """
    user_id = UUID(current_user["sub"])
    staff_id = _get_staff_id_from_user_id(db, user_id)
    return batch_mark_attendance(db=db, payload=payload, recorded_by_staff_id=staff_id)


@router.get("/class/{class_id}", response_model=list[AttendanceRecordResponse])
def list_class_attendance_logs(
    class_id: int,
    date_val: Optional[date] = Query(None, alias="date", description="Filter by specific date (YYYY-MM-DD)"),
    subject_id: Optional[int] = Query(None, description="Filter by specific subject ID"),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Retrieve attendance logs for a class, optionally filtered by date or subject.
    """
    return get_class_attendance_logs(db=db, class_id=class_id, date_val=date_val, subject_id=subject_id)


@router.get("/student/my-summary", response_model=AttendanceSummaryResponse)
def get_my_attendance_summary(
    class_id: Optional[int] = Query(None, description="Filter summary by class ID"),
    subject_id: Optional[int] = Query(None, description="Filter summary by subject ID"),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get overall attendance statistics and rate (%) for the authenticated student.
    """
    user_id = UUID(current_user["sub"])
    student_id = _get_student_id_from_user_id(db, user_id)
    return get_student_attendance_summary(db=db, student_id=student_id, class_id=class_id, subject_id=subject_id)


@router.get("/student/my-logs", response_model=list[AttendanceRecordResponse])
def get_my_attendance_logs(
    class_id: Optional[int] = Query(None, description="Filter logs by class ID"),
    subject_id: Optional[int] = Query(None, description="Filter logs by subject ID"),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get attendance record history for the authenticated student.
    """
    user_id = UUID(current_user["sub"])
    student_id = _get_student_id_from_user_id(db, user_id)
    return get_student_attendance_logs(db=db, student_id=student_id, class_id=class_id, subject_id=subject_id)


@router.get("/student/my-leave-requests", response_model=list[LeaveRequestResponse])
def get_my_leave_requests(
    class_id: Optional[int] = Query(None, description="Filter leave requests by class ID"),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get submitted leave requests for the authenticated student.
    """
    user_id = UUID(current_user["sub"])
    student_id = _get_student_id_from_user_id(db, user_id)
    return get_student_leave_requests(db=db, student_id=student_id, class_id=class_id)


@router.get("/student/{student_id}/summary", response_model=AttendanceSummaryResponse)
def get_student_summary(
    student_id: UUID,
    class_id: Optional[int] = Query(None, description="Filter summary by class ID"),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get overall attendance statistics and rate (%) for a student by UUID.
    """
    return get_student_attendance_summary(db=db, student_id=student_id, class_id=class_id)


@router.post("/leave-request", response_model=LeaveRequestResponse)
def submit_leave_request(
    payload: LeaveRequestCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Submit a leave of absence request for the logged-in student.
    """
    user_id = UUID(current_user["sub"])
    student_id = _get_student_id_from_user_id(db, user_id)
    return create_leave_request(db=db, student_id=student_id, payload=payload)


@router.get("/class/{class_id}/leave-requests", response_model=list[LeaveRequestResponse])
def list_class_leave_requests(
    class_id: int,
    status: Optional[str] = Query(None, description="Filter by status (pending/approved/rejected)"),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Retrieve leave requests submitted for a class.
    """
    return get_class_leave_requests(db=db, class_id=class_id, status_filter=status)


@router.patch("/leave-request/{leave_request_id}", response_model=LeaveRequestResponse)
def review_leave_request(
    leave_request_id: int,
    payload: LeaveRequestUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Approve or reject a student's leave request.
    """
    user_id = UUID(current_user["sub"])
    staff_id = _get_staff_id_from_user_id(db, user_id)
    return update_leave_request_status(
        db=db,
        leave_request_id=leave_request_id,
        payload=payload,
        reviewed_by_staff_id=staff_id,
    )
