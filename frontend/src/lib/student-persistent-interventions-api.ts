import { apiFetch } from "@/lib/api";

export interface StudentRequiredReading {
  classwork_id: number;
  title: string;
  assignment_id: number;
  order: number;
  completion_status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  focused_seconds: number;
  completed_at: string | null;
  review_status?: "NOT_REVIEWED" | "REVIEWED";
  reviewed_at?: string | null;
}

export interface StudentRequiredReadingIssue {
  resource_id: number | null;
  order: number;
  reason:
    | "INVALID_RESOURCE"
    | "MISSING_RESOURCE"
    | "NOT_REQUIRED_READING"
    | "INACCESSIBLE"
    | "PLANNING_ONLY"
    | "UNPUBLISHED"
    | "LOCKED";
}

export interface StudentPreparationProgress {
  state:
    | "NOT_APPLICABLE"
    | "NOT_CONFIGURED"
    | "BLOCKED"
    | "NOT_STARTED"
    | "IN_PROGRESS"
    | "COMPLETE";
  is_satisfied: boolean;
  completed_count: number;
  required_count: number;
  accessible_count: number;
  unavailable_count: number;
  summary: string;
}

export interface StudentSupportActivity {
  assignment_id: number;
  title: string;
  classwork_type: string;
  submission_status: string | null;
  grade: number | null;
  total_points: number | null;
  access_state: "HISTORICAL" | "PREPARATION_REQUIRED" | "READY";
  access_enforced: boolean;
  prerequisite_code: string | null;
  prerequisite_message: string | null;
  preparation: StudentPreparationProgress | null;
  readings: StudentRequiredReading[];
}

export interface StudentPersistentIntervention {
  intervention_id: number;
  status: string;
  subject_id: number;
  subject_name: string;
  class_id: number;
  class_name: string;
  teacher_name: string | null;
  required_readings: StudentRequiredReading[];
  resource_issues: StudentRequiredReadingIssue[];
  preparation: StudentPreparationProgress;
  activities: StudentSupportActivity[];
  reviewer_id: number | null;
  resolved_at: string | null;
  resolution_message: string | null;
}

const base = "/api/v1/student/interventions";

async function read<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  if (!response.ok) throw new Error("Unable to load your active support.");
  return response.json() as Promise<T>;
}

export const listMyActiveInterventions = () =>
  read<{ items: StudentPersistentIntervention[] }>(base);
export const getMyActiveIntervention = (id: number) =>
  read<StudentPersistentIntervention>(`${base}/${id}`);
export const listMyResolvedInterventions = () =>
  read<{ items: StudentPersistentIntervention[] }>(`${base}/resolved`);
export const getMyResolvedIntervention = (id: number) =>
  read<StudentPersistentIntervention>(`${base}/resolved/${id}`);

export interface StudentReadingReviewResponse {
  review_id: number;
  intervention_id: number;
  reading_assignment_id: number;
  assignment_id?: number | null;
  student_id: string;
  review_status: "NOT_REVIEWED" | "REVIEWED";
  reviewed_at?: string | null;
  acknowledged_at: string;
}

export async function reviewInterventionReading(
  interventionId: number,
  readingAssignmentId: number
): Promise<StudentReadingReviewResponse> {
  const response = await apiFetch(
    `${base}/${interventionId}/readings/${readingAssignmentId}/review`,
    {
      method: "POST",
    }
  );
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      (typeof errorBody?.detail === "string" && errorBody.detail) ||
        "Unable to confirm your reading review."
    );
  }
  return response.json() as Promise<StudentReadingReviewResponse>;
}

export async function listInterventionReadingReviews(
  interventionId: number
): Promise<StudentReadingReviewResponse[]> {
  const response = await apiFetch(`${base}/${interventionId}/reviews`);
  if (!response.ok) {
    throw new Error("Unable to load reading reviews.");
  }
  return response.json() as Promise<StudentReadingReviewResponse[]>;
}
