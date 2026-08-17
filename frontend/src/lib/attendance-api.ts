import { apiFetch } from "./api";

export type AttendanceStatus = "present" | "absent" | "late" | "excused";
export type LeaveStatus = "pending" | "approved" | "rejected";

export type AttendanceRecordItem = {
  attendance_id: number;
  student_id: string;
  student_name: string | null;
  class_id: number;
  subject_id: number | null;
  date: string;
  status: AttendanceStatus;
  remarks: string | null;
  recorded_by_staff_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type BatchAttendanceItem = {
  student_id: string;
  status: AttendanceStatus;
  remarks?: string;
};

export type BatchAttendancePayload = {
  class_id: number;
  subject_id?: number;
  date: string;
  records: BatchAttendanceItem[];
};

export type AttendanceSummaryResponse = {
  total_days: number;
  present_count: number;
  absent_count: number;
  late_count: number;
  excused_count: number;
  attendance_rate: number;
};

export type LeaveRequestItem = {
  leave_request_id: number;
  student_id: string;
  student_name: string | null;
  class_id: number;
  start_date: string;
  end_date: string;
  reason: string;
  status: LeaveStatus;
  reviewed_by_staff_id: string | null;
  reviewed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export async function recordBatchAttendance(payload: BatchAttendancePayload): Promise<AttendanceRecordItem[]> {
  const res = await apiFetch("/api/v1/attendance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to record attendance");
  return res.json();
}

export async function getClassAttendanceLogs(
  classId: number,
  dateStr?: string,
  subjectId?: number
): Promise<AttendanceRecordItem[]> {
  const params = new URLSearchParams();
  if (dateStr) params.append("date", dateStr);
  if (subjectId) params.append("subject_id", String(subjectId));

  const queryString = params.toString() ? `?${params.toString()}` : "";
  const res = await apiFetch(`/api/v1/attendance/class/${classId}${queryString}`);
  if (!res.ok) throw new Error("Failed to fetch class attendance logs");
  return res.json();
}

export async function getStudentAttendanceSummary(
  studentId: string,
  classId?: number
): Promise<AttendanceSummaryResponse> {
  const params = new URLSearchParams();
  if (classId) params.append("class_id", String(classId));

  const queryString = params.toString() ? `?${params.toString()}` : "";
  const res = await apiFetch(`/api/v1/attendance/student/${studentId}/summary${queryString}`);
  if (!res.ok) throw new Error("Failed to fetch student attendance summary");
  return res.json();
}

export async function submitLeaveRequest(payload: {
  class_id: number;
  start_date: string;
  end_date: string;
  reason: string;
}): Promise<LeaveRequestItem> {
  const res = await apiFetch("/api/v1/attendance/leave-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to submit leave request");
  return res.json();
}

export async function getClassLeaveRequests(
  classId: number,
  status?: LeaveStatus
): Promise<LeaveRequestItem[]> {
  const params = new URLSearchParams();
  if (status) params.append("status", status);

  const queryString = params.toString() ? `?${params.toString()}` : "";
  const res = await apiFetch(`/api/v1/attendance/class/${classId}/leave-requests${queryString}`);
  if (!res.ok) throw new Error("Failed to fetch class leave requests");
  return res.json();
}

export async function reviewLeaveRequest(
  leaveRequestId: number,
  status: LeaveStatus,
  remarks?: string
): Promise<LeaveRequestItem> {
  const res = await apiFetch(`/api/v1/attendance/leave-request/${leaveRequestId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, remarks }),
  });
  if (!res.ok) throw new Error("Failed to update leave request status");
  return res.json();
}
