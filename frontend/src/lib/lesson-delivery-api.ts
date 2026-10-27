import { apiFetch } from "@/lib/api";

export interface LessonDeliveryRecord {
  delivery_id: number;
  lesson_id: number;
  lesson_title?: string | null;
  class_id: number;
  subject_id: number;
  academic_period_id: number;
  delivered_by_staff_id?: string | null;
  delivered_at: string;
  is_active: boolean;
  revoked_at?: string | null;
  revoked_by_staff_id?: string | null;
  correction_reason?: string | null;
  created_at?: string | null;
}

export interface LessonDeliveryConfirmPayload {
  lesson_id: number;
  class_id: number;
  subject_id: number;
  academic_period_id: number;
}

export interface LessonDeliveryCorrectionPayload {
  reason: string;
}

export interface LessonDeliveryStatusResponse {
  lesson_id: number;
  class_id: number;
  subject_id: number;
  academic_period_id: number;
  is_delivered: boolean;
  active_delivery?: LessonDeliveryRecord | null;
  history?: LessonDeliveryRecord[];
}

/**
 * Fetch all active verified lesson deliveries for a specific class, subject, and academic period.
 */
export async function fetchClassSubjectDeliveries(
  classId: number,
  subjectId: number,
  academicPeriodId: number,
): Promise<LessonDeliveryRecord[]> {
  const query = new URLSearchParams({
    academic_period_id: String(academicPeriodId),
  });
  const res = await apiFetch(
    `/api/v1/lesson-deliveries/class/${encodeURIComponent(String(classId))}/subject/${encodeURIComponent(String(subjectId))}?${query.toString()}`,
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message =
      typeof data?.detail === "string"
        ? data.detail
        : "Failed to load lesson delivery records.";
    throw new Error(message);
  }
  return (await res.json()) as LessonDeliveryRecord[];
}

/**
 * Confirm that a lesson was delivered to a class in an academic grading period.
 */
export async function confirmLessonDelivery(
  payload: LessonDeliveryConfirmPayload,
): Promise<LessonDeliveryRecord> {
  const res = await apiFetch("/api/v1/lesson-deliveries/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message =
      typeof data?.detail === "string"
        ? data.detail
        : "Unable to confirm lesson delivery.";
    throw new Error(message);
  }
  return (await res.json()) as LessonDeliveryRecord;
}

/**
 * Correct or revoke a teacher-confirmed lesson delivery with an auditable reason.
 */
export async function correctLessonDelivery(
  deliveryId: number,
  payload: LessonDeliveryCorrectionPayload,
): Promise<LessonDeliveryRecord> {
  const res = await apiFetch(
    `/api/v1/lesson-deliveries/${encodeURIComponent(String(deliveryId))}/correct`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message =
      typeof data?.detail === "string"
        ? data.detail
        : "Unable to correct lesson delivery confirmation.";
    throw new Error(message);
  }
  return (await res.json()) as LessonDeliveryRecord;
}

/**
 * Fetch delivery status and full audit history for a single lesson in a class/period.
 */
export async function fetchLessonDeliveryStatus(
  classId: number,
  subjectId: number,
  lessonId: number,
  academicPeriodId: number,
): Promise<LessonDeliveryStatusResponse> {
  const query = new URLSearchParams({
    academic_period_id: String(academicPeriodId),
  });
  const res = await apiFetch(
    `/api/v1/lesson-deliveries/class/${encodeURIComponent(String(classId))}/subject/${encodeURIComponent(String(subjectId))}/lesson/${encodeURIComponent(String(lessonId))}?${query.toString()}`,
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message =
      typeof data?.detail === "string"
        ? data.detail
        : "Failed to fetch lesson delivery status.";
    throw new Error(message);
  }
  return (await res.json()) as LessonDeliveryStatusResponse;
}
