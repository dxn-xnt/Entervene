from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.Dependencies import require_role
from app.db.Session import get_db
from app.schemas.Attendance import (
    BatchAttendanceCreate,
    AttendanceRecordResponse,
    AttendanceSummaryResponse,
    QRScanAttendanceRequest,
    QRScanAttendanceResponse,
)
from app.services.attendance.AttendanceService import (
    _get_staff_id_from_user_id,
    batch_mark_attendance,
    get_class_attendance_logs,
    get_student_attendance_summary,
    record_qr_scan_attendance,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Teacher Attendance Management Endpoints
# ---------------------------------------------------------------------------

@router.post("/scan", response_model=QRScanAttendanceResponse)
def scan_qr_attendance(
    payload: QRScanAttendanceRequest,
    current_user: dict = Depends(require_role("teacher", "admin")),
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
    current_user: dict = Depends(require_role("teacher", "admin")),
    db: Session = Depends(get_db),
):
    """
    Batch mark or update daily attendance for a class (including marking status as 'excused' with remarks).
    """
    user_id = UUID(current_user["sub"])
    staff_id = _get_staff_id_from_user_id(db, user_id)
    return batch_mark_attendance(db=db, payload=payload, recorded_by_staff_id=staff_id)


@router.get("/class/{class_id}", response_model=list[AttendanceRecordResponse])
def list_class_attendance_logs(
    class_id: int,
    date_val: Optional[date] = Query(None, alias="date", description="Filter by specific date (YYYY-MM-DD)"),
    subject_id: Optional[int] = Query(None, description="Filter by specific subject ID"),
    current_user: dict = Depends(require_role("teacher", "admin")),
    db: Session = Depends(get_db),
):
    """
    Retrieve attendance logs for a class, optionally filtered by date or subject.
    """
    return get_class_attendance_logs(db=db, class_id=class_id, date_val=date_val, subject_id=subject_id)


@router.get("/student/{student_id}/summary", response_model=AttendanceSummaryResponse)
def get_student_summary(
    student_id: UUID,
    class_id: Optional[int] = Query(None, description="Filter summary by class ID"),
    current_user: dict = Depends(require_role("teacher", "admin")),
    db: Session = Depends(get_db),
):
    """
    Get overall attendance statistics and rate (%) for a student by UUID (teacher/admin only).
    """
    return get_student_attendance_summary(db=db, student_id=student_id, class_id=class_id)


# ---------------------------------------------------------------------------
# Deprecated / Discontinued Student & Leave Request Endpoints
# Strictly reject student access with 403 Forbidden.
# ---------------------------------------------------------------------------

@router.get("/student/my-summary")
@router.get("/student/my-logs")
@router.get("/student/my-leave-requests")
@router.post("/leave-request")
@router.get("/class/{class_id}/leave-requests")
@router.patch("/leave-request/{leave_request_id}")
def discontinued_attendance_endpoints(
    current_user: dict = Depends(require_role("teacher", "admin")),
):
    """
    Digital leave requests and student-facing attendance endpoints are discontinued.
    Students attempting access will receive 403 Forbidden via require_role.
    """
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Access denied. Attendance and leave-request access is not available.",
    )
