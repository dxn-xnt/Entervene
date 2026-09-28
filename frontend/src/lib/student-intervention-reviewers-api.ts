import { apiFetch } from "@/lib/api";

export interface StudentReviewerSummary {
  material_id: number;
  subject_name: string;
  title: string;
  sent_at: string;
}

export interface StudentReviewerDetail extends StudentReviewerSummary {
  introduction: string;
  body: string;
}

const base = "/api/v1/student/intervention-reviewers";

async function read<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  if (!response.ok) {
    throw new Error(response.status === 404 ? "Reviewer not found." : "Unable to load your reviewer.");
  }
  return response.json() as Promise<T>;
}

export const listMyReviewers = () => read<{ items: StudentReviewerSummary[]; total: number }>(base);
export const getMyReviewer = (id: number) => read<StudentReviewerDetail>(`${base}/${id}`);
