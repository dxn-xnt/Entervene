/**
 * interventions-api.ts
 * ====================
 * API module for Interventions Dashboard.
 * Connects to /api/v1/suggestions/* endpoints.
 */

import { apiFetch } from "./api";

export interface StudentSuggestionItem {
  suggestion_id: number;
  student_id: string;
  student_name?: string;
  class_name?: string;
  subject_id: number;
  subject_name?: string;
  suggestion_type: "MANUAL" | "AUTOMATED";
  resource_type: "LESSON" | "CLASSWORK";
  title: string;
  description?: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  status: "DRAFT" | "ACTIVE" | "COMPLETED" | "DISMISSED" | "ARCHIVED";
  is_viewed: boolean;
  viewed_at?: string;
  created_at?: string;
  lesson_id?: number;
  lesson_title?: string;
  classwork_assignment_id?: number;
  classwork_title?: string;
  prediction_id?: number;
}

export interface SuggestionListResponse {
  suggestions: StudentSuggestionItem[];
  total?: number;
}

export interface InterventionFilters {
  class_id?: number;
  subject_id?: number;
  student_id?: string;
  status?: string;
}

export async function fetchTeacherInterventions(
  filters?: InterventionFilters
): Promise<SuggestionListResponse> {
  const query = new URLSearchParams();
  if (filters?.class_id) query.append("class_id", filters.class_id.toString());
  if (filters?.subject_id) query.append("subject_id", filters.subject_id.toString());
  if (filters?.student_id) query.append("student_id", filters.student_id);
  if (filters?.status && filters.status !== "All") query.append("status", filters.status);

  const qs = query.toString();
  const response = await apiFetch(`/api/v1/suggestions/teacher${qs ? `?${qs}` : ""}`);
  if (!response.ok) throw new Error("Failed to load interventions list.");
  return response.json();
}

export async function approveIntervention(suggestionId: number): Promise<StudentSuggestionItem> {
  const response = await apiFetch(`/api/v1/suggestions/${suggestionId}/approve`, {
    method: "PATCH",
  });
  if (!response.ok) throw new Error("Failed to approve intervention.");
  return response.json();
}

export async function dismissIntervention(suggestionId: number): Promise<StudentSuggestionItem> {
  const response = await apiFetch(`/api/v1/suggestions/${suggestionId}/dismiss`, {
    method: "PATCH",
  });
  if (!response.ok) throw new Error("Failed to dismiss intervention.");
  return response.json();
}

export async function archiveIntervention(suggestionId: number): Promise<StudentSuggestionItem> {
  const response = await apiFetch(`/api/v1/suggestions/${suggestionId}/archive`, {
    method: "PATCH",
  });
  if (!response.ok) throw new Error("Failed to archive intervention.");
  return response.json();
}

// Student Endpoints
export async function fetchMyInterventions(status?: string): Promise<SuggestionListResponse> {
  const qs = status && status !== "All" ? `?status=${encodeURIComponent(status)}` : "";
  const response = await apiFetch(`/api/v1/suggestions/my${qs}`);
  if (!response.ok) throw new Error("Failed to load your study recommendations.");
  return response.json();
}

export async function markInterventionViewed(suggestionId: number): Promise<StudentSuggestionItem> {
  const response = await apiFetch(`/api/v1/suggestions/my/${suggestionId}/viewed`, {
    method: "PATCH",
  });
  if (!response.ok) throw new Error("Failed to mark recommendation as viewed.");
  return response.json();
}

export async function completeMyIntervention(suggestionId: number): Promise<StudentSuggestionItem> {
  const response = await apiFetch(`/api/v1/suggestions/my/${suggestionId}/complete`, {
    method: "PATCH",
  });
  if (!response.ok) throw new Error("Failed to mark recommendation as completed.");
  return response.json();
}
