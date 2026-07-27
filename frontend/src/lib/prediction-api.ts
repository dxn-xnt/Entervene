/**
 * prediction-api.ts
 * =================
 * Frontend API module for the Prediction Dashboard.
 * Uses the shared apiFetch helper from api.ts.
 */

import { apiFetch } from "./api";

// ---- Types ----

export interface DashboardPredictionItem {
  prediction_id: number;
  student_id: string;
  student_name: string;
  student_lrn: string;
  class_name: string;
  subject_name: string;
  term_label: string;
  term_number: number;
  predicted_period_grade: number | null;
  risk_level: string;
  risk_score: number | null;
  data_status: string;
  generated_at: string | null;
}

export interface RiskSummary {
  HIGH_RISK: number;
  MODERATE_RISK: number;
  NEEDS_MONITORING: number;
  LOW_RISK: number;
  INSUFFICIENT_DATA: number;
  total: number;
}

export interface DashboardAtRiskResponse {
  items: DashboardPredictionItem[];
  risk_summary: RiskSummary;
  total: number;
  limit: number;
  offset: number;
}

export interface DashboardFilters {
  classes: { class_id: number; section_name: string }[];
  subjects: { subject_id: number; subject_name: string }[];
  terms: { term_number: number; term_label: string; academic_period_id: number }[];
}

export interface PredictionFeature {
  feature_id: number;
  feature_name: string;
  feature_value: number | null;
  feature_contribution: number | null;
  direction: string;
  feature_rank: number | null;
  explanation_method: string;
}

export interface PredictionCause {
  code: string;
  label: string;
  value: string;
  severity: string;
  explanation: string;
}

export interface PredictionAction {
  action_code: string;
  action_type: string;
  title: string;
  description: string;
  priority: string;
  source: string;
}

export interface TeacherReview {
  review_id: number;
  prediction_id: number;
  staff_id: string;
  decision: string;
  teacher_notes: string | null;
  reviewed_at: string;
}

export interface PredictionDetail {
  prediction_id: number;
  student_id: string;
  class_id: number;
  subject_id: number;
  source_period_id: number;
  target_period_id: number;
  predicted_period_grade: number | null;
  risk_score: number | null;
  risk_level: string;
  data_status: string;
  generated_at: string | null;
  model_version: {
    model_version_id: number;
    model_name: string;
    model_type: string;
    algorithm: string;
    is_active: boolean;
  } | null;
  features: PredictionFeature[];
  causes: PredictionCause[];
  recommended_actions: PredictionAction[];
  outcome: {
    outcome_id: number;
    actual_period_grade: number | null;
    prediction_error: number | null;
    absolute_error: number | null;
    actual_passed: boolean | null;
    actual_risk_label: string | null;
    outcome_status: string | null;
    evaluated_at: string | null;
  } | null;
  teacher_reviews: TeacherReview[];
  current_user_review: TeacherReview | null;
}

// ---- API Functions ----

export interface DashboardQueryParams {
  class_id?: number;
  subject_id?: number;
  term?: number;
  risk_level?: string;
  search?: string;
  sort_by?: string;
  sort_order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export async function fetchDashboardAtRisk(
  params: DashboardQueryParams = {}
): Promise<DashboardAtRiskResponse> {
  const query = new URLSearchParams();
  if (params.class_id) query.set("class_id", String(params.class_id));
  if (params.subject_id) query.set("subject_id", String(params.subject_id));
  if (params.term) query.set("term", String(params.term));
  if (params.risk_level) query.set("risk_level", params.risk_level);
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.sort_by) query.set("sort_by", params.sort_by);
  if (params.sort_order) query.set("sort_order", params.sort_order);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));

  const qs = query.toString();
  const response = await apiFetch(`/api/v1/predictions/dashboard/at-risk${qs ? `?${qs}` : ""}`);
  if (!response.ok) throw new Error("Failed to load predictions dashboard.");
  return response.json();
}

export async function fetchDashboardFilters(): Promise<DashboardFilters> {
  const response = await apiFetch("/api/v1/predictions/dashboard/filters");
  if (!response.ok) throw new Error("Failed to load dashboard filters.");
  return response.json();
}

export async function fetchPredictionDetail(
  predictionId: number
): Promise<PredictionDetail> {
  const response = await apiFetch(`/api/v1/predictions/${predictionId}/detail`);
  if (!response.ok) throw new Error("Failed to load prediction detail.");
  return response.json();
}

export async function submitTeacherReview(
  predictionId: number,
  payload: { decision: string; teacher_notes?: string }
): Promise<TeacherReview> {
  const response = await apiFetch(`/api/v1/predictions/${predictionId}/teacher-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Failed to submit teacher review.");
  return response.json();
}

export interface PredictionSuggestionItem {
  student_suggestion_id: number;
  suggestion_type: string;
  resource_type: string;
  title: string;
  description?: string;
  priority: string;
  status: string;
  created_at?: string;
  lesson_id?: number;
  lesson_title?: string;
  classwork_assignment_id?: number;
}

export interface AssignInterventionPayload {
  resource_type: "LESSON" | "CLASSWORK";
  lesson_id?: number;
  classwork_assignment_id?: number;
  title: string;
  description?: string;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
}

export async function fetchPredictionSuggestions(
  predictionId: number
): Promise<PredictionSuggestionItem[]> {
  const response = await apiFetch(
    `/api/v1/predictions/${predictionId}/suggestions`
  );
  if (!response.ok) throw new Error("Failed to fetch prediction suggestions.");
  return response.json();
}

export async function assignPredictionIntervention(
  predictionId: number,
  payload: AssignInterventionPayload
): Promise<{ message: string; student_suggestion_id: number }> {
  const response = await apiFetch(
    `/api/v1/predictions/${predictionId}/assign-intervention`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to assign intervention.");
  }
  return response.json();
}
