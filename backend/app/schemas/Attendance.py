from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


AttendanceStatus = Literal["present", "absent", "late", "excused"]
LeaveStatus = Literal["pending", "approved", "rejected"]


# ---------------------------------------------------------------------------
# Attendance Record Schemas
# ---------------------------------------------------------------------------

class AttendanceRecordCreate(BaseModel):
    student_id: UUID
    class_id: int
    subject_id: int | None = None
    date: date
    status: AttendanceStatus = "present"
    remarks: str | None = None


class BatchAttendanceItem(BaseModel):
    student_id: UUID
    status: AttendanceStatus = "present"
    remarks: str | None = None


class BatchAttendanceCreate(BaseModel):
    class_id: int
    subject_id: int | None = None
    date: date
    records: list[BatchAttendanceItem]


class AttendanceRecordUpdate(BaseModel):
    status: AttendanceStatus | None = None
    remarks: str | None = None


# ---------------------------------------------------------------------------
# QR Scan Attendance Schemas
# ---------------------------------------------------------------------------

class QRScanAttendanceRequest(BaseModel):
    student_id: UUID
    class_id: int
    subject_id: int | None = None


class QRScanAttendanceResponse(BaseModel):
    attendance_id: int
    student_id: UUID
    student_name: str | None = None
    student_lrn: str | None = None
    class_id: int
    subject_id: int | None = None
    subject_name: str | None = None
    date: date
    status: str
    is_duplicate: bool = False
    message: str


class AttendanceRecordResponse(BaseModel):
    attendance_id: int
    student_id: UUID
    student_name: str | None = None
    class_id: int
    subject_id: int | None = None
    subject_name: str | None = None
    date: date
    status: str
    remarks: str | None = None
    recorded_by_staff_id: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


class AttendanceSummaryResponse(BaseModel):
    total_days: int
    present_count: int
    absent_count: int
    late_count: int
    excused_count: int
    attendance_rate: float  # e.g., 95.5 (%)


# ---------------------------------------------------------------------------
# Leave Request Schemas
# ---------------------------------------------------------------------------

class LeaveRequestCreate(BaseModel):
    class_id: int
    start_date: date
    end_date: date
    reason: str


class LeaveRequestUpdate(BaseModel):
    status: LeaveStatus
    remarks: str | None = None


class LeaveRequestResponse(BaseModel):
    leave_request_id: int
    student_id: UUID
    student_name: str | None = None
    class_id: int
    start_date: date
    end_date: date
    reason: str
    status: str
    reviewed_by_staff_id: str | None = None
    reviewed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True
