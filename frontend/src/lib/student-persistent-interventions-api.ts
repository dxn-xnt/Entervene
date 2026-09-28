import { apiFetch } from "@/lib/api";

export interface StudentSupportActivity {
  assignment_id: number;
  title: string;
  classwork_type: string;
  submission_status: string | null;
  grade: number | null;
  total_points: number | null;
}

export interface StudentPersistentIntervention {
  intervention_id: number;
  status: "ACTIVE" | "RESOLVED";
  subject_id: number;
  subject_name: string;
  class_id: number;
  class_name: string;
  teacher_name: string | null;
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

export const listMyActiveInterventions = () => read<{ items: StudentPersistentIntervention[] }>(base);
export const getMyActiveIntervention = (id: number) => read<StudentPersistentIntervention>(`${base}/${id}`);
export const listMyResolvedInterventions = () => read<{ items: StudentPersistentIntervention[] }>(`${base}/resolved`);
export const getMyResolvedIntervention = (id: number) => read<StudentPersistentIntervention>(`${base}/resolved/${id}`);
