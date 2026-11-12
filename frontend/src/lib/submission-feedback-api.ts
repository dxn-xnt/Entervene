import { apiFetch } from "@/lib/api";

export type FeedbackEligibility = {
  submission_id: number;
  eligible: boolean;
  answer_release_authorized: boolean;
  code: string | null;
  message: string | null;
};

export type FeedbackSuggestion = {
  submission_id: number;
  feedback: string;
  detail_level: "GENERAL" | "DETAILED";
  answer_release_authorized: boolean;
  attempt_count: number;
  evidence_item_count: number;
  included_item_count: number;
  evidence_fingerprint: string;
  feedback_fingerprint: string;
  generated_at: string;
};

export type FeedbackPublication = {
  submission_id: number;
  feedback: string;
  evidence_fingerprint: string;
  feedback_fingerprint: string;
};

export class SubmissionFeedbackApiError extends Error {
  status: number;
  code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = "SubmissionFeedbackApiError";
    this.status = status;
    this.code = code;
  }
}

async function readResponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.detail;
    const code = typeof detail === "object" && detail ? detail.code : null;
    const message =
      (typeof detail === "object" && detail ? detail.message : detail) ||
      body?.message ||
      fallback;
    throw new SubmissionFeedbackApiError(response.status, String(message), code);
  }
  return body as T;
}

export async function getSubmissionFeedbackEligibility(
  submissionId: number,
): Promise<FeedbackEligibility> {
  const response = await apiFetch(
    `/api/v1/submissions/${encodeURIComponent(String(submissionId))}/feedback/eligibility`,
  );
  return readResponse<FeedbackEligibility>(response, "Unable to check AI feedback availability.");
}

export async function generateSubmissionFeedbackSuggestion(
  submissionId: number,
): Promise<FeedbackSuggestion> {
  const response = await apiFetch(
    `/api/v1/submissions/${encodeURIComponent(String(submissionId))}/feedback/suggestion`,
    { method: "POST" },
  );
  return readResponse<FeedbackSuggestion>(response, "Unable to generate an AI feedback suggestion.");
}

export async function publishSubmissionFeedback(
  submissionId: number,
  payload: {
    feedback: string;
    expected_evidence_fingerprint: string;
    expected_feedback_fingerprint: string;
  },
): Promise<FeedbackPublication> {
  const response = await apiFetch(
    `/api/v1/submissions/${encodeURIComponent(String(submissionId))}/feedback`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  return readResponse<FeedbackPublication>(response, "Unable to post the approved feedback.");
}
