import { apiFetch } from "@/lib/api";
import type {
  ManualSuggestionCreate,
  RecommendationDraftRequest,
  SuggestionListResponse,
  SuggestionResponse,
} from "@/types/suggestion";

async function responseMessage(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  if (data && typeof data === "object" && "detail" in data && typeof data.detail === "string") {
    return data.detail;
  }
  return fallback;
}

export async function createManualSuggestion(payload: ManualSuggestionCreate): Promise<SuggestionResponse> {
  const response = await apiFetch("/api/v1/suggestions/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await responseMessage(response, "Unable to create suggestion."));
  }

  return (await response.json()) as SuggestionResponse;
}

export async function getTeacherSuggestions(params: {
  classId?: number;
  subjectId?: number;
  studentId?: string;
  status?: string;
}): Promise<SuggestionListResponse> {
  const query = new URLSearchParams();
  if (params.classId) query.set("class_id", String(params.classId));
  if (params.subjectId) query.set("subject_id", String(params.subjectId));
  if (params.studentId) query.set("student_id", params.studentId);
  if (params.status) query.set("status", params.status);

  const response = await apiFetch(`/api/v1/suggestions/teacher${query.toString() ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await responseMessage(response, "Unable to load suggestions."));
  }

  return (await response.json()) as SuggestionListResponse;
}

export async function dismissSuggestion(suggestionId: number): Promise<SuggestionResponse> {
  const response = await apiFetch(`/api/v1/suggestions/${suggestionId}/dismiss`, { method: "PATCH" });

  if (!response.ok) {
    throw new Error(await responseMessage(response, "Unable to dismiss suggestion."));
  }

  return (await response.json()) as SuggestionResponse;
}

export async function archiveSuggestion(suggestionId: number): Promise<SuggestionResponse> {
  const response = await apiFetch(`/api/v1/suggestions/${suggestionId}/archive`, { method: "PATCH" });

  if (!response.ok) {
    throw new Error(await responseMessage(response, "Unable to archive suggestion."));
  }

  return (await response.json()) as SuggestionResponse;
}

export async function generateRecommendationDrafts(
  payload: RecommendationDraftRequest,
): Promise<SuggestionListResponse> {
  const response = await apiFetch("/api/v1/suggestions/recommendations/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await responseMessage(response, "Unable to generate recommendation drafts."));
  }

  return (await response.json()) as SuggestionListResponse;
}

export async function approveSuggestion(suggestionId: number): Promise<SuggestionResponse> {
  const response = await apiFetch(`/api/v1/suggestions/${suggestionId}/approve`, { method: "PATCH" });

  if (!response.ok) {
    throw new Error(await responseMessage(response, "Unable to approve suggestion."));
  }

  return (await response.json()) as SuggestionResponse;
}

export async function getMySuggestions(status?: string): Promise<SuggestionListResponse> {
  const query = new URLSearchParams();
  if (status) query.set("status", status);

  const response = await apiFetch(`/api/v1/suggestions/my${query.toString() ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await responseMessage(response, "Unable to load study suggestions."));
  }

  return (await response.json()) as SuggestionListResponse;
}

export async function getMySuggestion(suggestionId: number): Promise<SuggestionResponse> {
  const response = await apiFetch(`/api/v1/suggestions/my/${suggestionId}`);

  if (!response.ok) {
    throw new Error(await responseMessage(response, "Unable to load study suggestion."));
  }

  return (await response.json()) as SuggestionResponse;
}

export async function markSuggestionViewed(suggestionId: number): Promise<SuggestionResponse> {
  const response = await apiFetch(`/api/v1/suggestions/my/${suggestionId}/viewed`, { method: "PATCH" });

  if (!response.ok) {
    throw new Error(await responseMessage(response, "Unable to mark suggestion as viewed."));
  }

  return (await response.json()) as SuggestionResponse;
}

export async function completeSuggestion(suggestionId: number): Promise<SuggestionResponse> {
  const response = await apiFetch(`/api/v1/suggestions/my/${suggestionId}/complete`, { method: "PATCH" });

  if (!response.ok) {
    throw new Error(await responseMessage(response, "Unable to complete suggestion."));
  }

  return (await response.json()) as SuggestionResponse;
}
