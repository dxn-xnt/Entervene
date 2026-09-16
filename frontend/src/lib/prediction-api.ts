/**
 * prediction-api.ts
 * =================
 * Frontend API module for the Prediction Dashboard.
 * Uses the shared apiFetch helper from api.ts.
 */

import { apiFetch } from "./api";

// ---- Types ----

export type TeacherStatusLabel =
  | "ASSIGNED"
  | "SUBSTITUTE_ACTIVE"
  | "NO_CONFIRMED_TEACHER"
  | "HISTORICAL_UNMAPPED"
  | "UNASSIGNED";

export interface DashboardPredictionItem {
  prediction_id: number;
  student_id: string;
  student_name: string;
  student_lrn: string;
  class_name: string;
  grade_level?: number | null;
  subject_name: string;
  subject_codename?: string | null;
  term_label: string;
  term_number: number;
  teacher_name?: string | null;
  teacher_staff_id?: string | null;
  teacher_status_label?: TeacherStatusLabel;
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

export interface DashboardGradeOption {
  grade_level: number;
  level_name: string;
}

export interface DashboardClassOption {
  class_id: number;
  section_name: string;
  grade_level?: number | null;
}

export interface DashboardSubjectOption {
  subject_id: number;
  subject_name: string;
  subject_codename?: string | null;
  period_index?: number | null;
}

export interface DashboardTermOption {
  term_number: number;
  term_label: string;
  academic_period_id: number;
}

export interface DashboardFilters {
  grades: DashboardGradeOption[];
  classes: DashboardClassOption[];
  subjects: DashboardSubjectOption[];
  terms: DashboardTermOption[];
}

export interface DashboardSectionSummaryItem {
  class_id: number;
  section_name: string;
  grade_level: number;
  total_students: number;
  at_risk_count: number;
  high_risk_count: number;
  moderate_risk_count: number;
}

export interface DashboardGradeGroupSummary {
  grade_level: number;
  level_name: string;
  total_students: number;
  at_risk_count: number;
  sections: DashboardSectionSummaryItem[];
}

export type PredictionPrimaryDisplay =
  | "CURRENT_PROJECTION"
  | "BASELINE_FORECAST"
  | "NONE";

export type CurrentProjectionAction = "GENERATE" | "REFRESH" | "NONE";

export interface RosterTeacher {
  staff_id: string;
  teacher_name?: string | null;
  full_name?: string | null;
  email?: string | null;
}

export interface RosterClassContext {
  class_id: number;
  class_name: string;
  subject_id: number;
  subject_name: string;
  academic_period_id: number;
  period_label: string;
  academic_year_id: number;
  next_period_status?: string | null;
  teacher?: RosterTeacher | null;
}

export interface StudentSummary {
  student_id: string;
  student_name: string;
  student_lrn: string;
}

export interface PeriodOutcome {
  status: "FINALIZED" | "IN_PROGRESS" | string;
  actual_grade?: number | null;
}

export interface NextEvidenceReadiness {
  ready: boolean;
  level: string;
  coverage?: number | null;
  reasons?: string[];
}

export interface NextForecastEligibility {
  eligible: boolean;
  status: string;
  reasons?: string[];
}

export interface NextForecastFreshness {
  status: string;
  reasons?: string[];
}

export interface BaselineForecastSummary {
  purpose: "NEXT_PERIOD_BASELINE_FORECAST";
  status: string;
  message?: string | null;
  source_period_id?: number | null;
  target_period_id?: number | null;
  source_period_label?: string | null;
  target_period_label?: string | null;
  predicted_grade?: number | null;
  risk_level?: string | null;
  risk_score?: number | null;
  data_status?: string | null;
  risk_assessment_status?: string | null;
  evidence_readiness?: NextEvidenceReadiness | null;
  forecast_eligibility?: NextForecastEligibility | null;
  forecast_freshness?: NextForecastFreshness | null;
  latest_prediction_id?: number | null;
  model_version?: Record<string, unknown> | null;
  revision?: number | null;
  generated_at?: string | null;
}

export interface CurrentEvidenceReadiness {
  level: string;
  ready: boolean;
  reasons: string[];
}

export interface CurrentProjectionFreshness {
  status: string;
  saved_fingerprint?: string | null;
  current_fingerprint?: string | null;
  reasons: string[];
}

export interface CurrentModelCurrency {
  status: string;
  persisted_model_version_id?: number | null;
  active_model_version_id?: number | null;
  persisted_model_name?: string | null;
  active_model_name?: string | null;
}

export interface CurrentRefreshEligibility {
  status: string;
  eligible: boolean;
  reasons: string[];
}

export interface CurrentProjectionSummary {
  purpose: "CURRENT_PERIOD_FINAL_GRADE_PROJECTION" | "UNIFIED_CURRENT_TERM_PROJECTION";
  source_period_id?: number | null;
  target_period_id?: number | null;
  source_period_label?: string | null;
  target_period_label?: string | null;
  predicted_grade?: number | null;
  risk_level?: string | null;
  risk_score?: number | null;
  data_status?: string | null;
  risk_assessment_status?: string | null;
  evidence_readiness?: CurrentEvidenceReadiness | null;
  projection_freshness?: CurrentProjectionFreshness | null;
  model_currency?: CurrentModelCurrency | null;
  refresh_eligibility?: CurrentRefreshEligibility | null;
  domain_warnings: Array<Record<string, unknown>>;
  latest_prediction_id?: number | null;
  model_version?: Record<string, unknown> | null;
  revision?: number | null;
  generated_at?: string | null;
}

export interface PredictionRosterStudentItem {
  student: StudentSummary;
  period_outcome: PeriodOutcome;
  baseline_forecast?: BaselineForecastSummary;
  current_projection: CurrentProjectionSummary;
  primary_display?: PredictionPrimaryDisplay;
}

export interface PredictionRosterResponse {
  class_context: RosterClassContext;
  students: PredictionRosterStudentItem[];
  total: number;
}

// Backward-compatible internal aliases
export type DualPurposeRosterStudentItem = PredictionRosterStudentItem;
export type DualPurposeRosterResponse = PredictionRosterResponse;

export interface CurrentPeriodGenerateRequest {
  student_id: string;
  class_id: number;
  subject_id: number;
  academic_period_id: number;
  generation_request_id?: string;
}

export interface PredictionActionResponse {
  generation_status?: string | null;
  ready: boolean;
  readiness_level: string;
  prediction_mode: string;
  predicted_period_grade: number | null;
  risk_level: string | null;
  risk_score: number | null;
  data_status: string | null;
  risk_assessment_status?: string | null;
  reasons: string[];
  warnings: string[];
  model_version_id?: number | null;
  model_name?: string | null;
  prediction_id?: number | null;
  latest_prediction_id?: number | null;
  student_id?: string | null;
  class_id?: number | null;
  subject_id?: number | null;
  source_period_id?: number | null;
  target_period_id?: number | null;
  revision?: number | null;
  model_purpose?: string | null;
  validation_status?: string | null;
  purpose_label?: string | null;
  generated_at?: string | null;
  evidence_cutoff_at?: string | null;
  message?: string | null;
  blocking_reasons?: string[];
  duplicate?: boolean | null;
  final_period_grade?: number | null;
  is_finalized?: boolean | null;
}

export type CurrentPeriodGenerateResponse = PredictionActionResponse;
export type PredictionRefreshResponse = PredictionActionResponse;

export interface PredictionStatusLatest {
  prediction_id: number;
  revision: number;
  is_latest: boolean;
  model_version_id?: number | null;
  source_period_id: number;
  target_period_id: number;
  generated_at?: string | null;
  predicted_period_grade?: number | null;
  risk_level?: string | null;
  risk_score?: number | null;
  data_status?: string | null;
  risk_assessment_status?: string | null;
  validation_status?: string | null;
  model_purpose?: string | null;
}

export interface CurrentPredictionStatusEnvelope {
  prediction_id: number;
  model_purpose: "CURRENT_PERIOD_FINAL_GRADE_PROJECTION" | "UNIFIED_CURRENT_TERM_PROJECTION";
  status: {
    evidence_readiness: CurrentEvidenceReadiness;
    projection_freshness: CurrentProjectionFreshness;
    model_currency: CurrentModelCurrency;
    refresh_eligibility: CurrentRefreshEligibility;
    requested_prediction?: Record<string, unknown> | null;
    latest_prediction?: Record<string, unknown> | null;
    domain_warnings: Array<Record<string, unknown>>;
  };
}

export interface NextPredictionStatusEnvelope {
  prediction_id: number;
  model_purpose: "NEXT_PERIOD_BASELINE_FORECAST";
  status: {
    status: string;
    message: string;
    evidence_readiness: NextEvidenceReadiness;
    forecast_eligibility: NextForecastEligibility;
    forecast_freshness: NextForecastFreshness;
    requested_prediction?: PredictionStatusLatest | null;
    latest_prediction?: PredictionStatusLatest | null;
  };
}

export type PredictionStatusEnvelope =
  | CurrentPredictionStatusEnvelope
  | NextPredictionStatusEnvelope;

export interface PredictionHistoryItem extends PredictionStatusLatest {
  source_period_label?: string | null;
  target_period_label?: string | null;
  forecast_freshness?: NextForecastFreshness | CurrentProjectionFreshness | null;
}

export interface PredictionHistoryResponse {
  scope: Record<string, unknown>;
  items: PredictionHistoryItem[];
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

export type PredictionEvidenceState =
  | "AVAILABLE"
  | "NO_EXPECTED_ITEMS"
  | "NO_RECORDED_DATA"
  | "INSUFFICIENT_DATA"
  | "UNRESOLVED"
  | "NOT_APPLICABLE";

export type PredictionEvidenceCategory =
  | "GRADE"
  | "ACTIVITY_PROGRESS"
  | "ATTENDANCE"
  | "PARTICIPATION";

export type PredictionStatus = "GENERATED" | "INSUFFICIENT_DATA" | "LEGACY";
export type ModelExecutionStatus = "EXECUTED" | "SKIPPED" | "UNKNOWN";

export interface TeacherPredictionEvidence {
  feature_name: string;
  display_name: string;
  description: string;
  category: PredictionEvidenceCategory;
  value: number | string | null;
  unit: "PERCENTAGE" | "SCORE" | "NUMERIC" | "INDICATOR" | "TEXT" | null;
  value_scale: "ZERO_TO_ONE" | "ZERO_TO_100" | "MODEL_NATIVE" | "N/A" | null;
  evidence_state: PredictionEvidenceState;
  numerator: number | null;
  denominator: number | null;
  formatted_value: string;
  source_description: string;
  usage_description: string;
}

export interface PredictionCause {
  code: string;
  label: string;
  value?: string | null;
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
  revision?: number | null;
  model_purpose?: string | null;
  validation_status?: string | null;
  purpose_label?: string | null;
  student_id: string;
  student_name?: string | null;
  student_lrn?: string | null;
  grade_level?: number | null;
  level_name?: string | null;
  class_id: number;
  class_name?: string | null;
  subject_id: number;
  subject_name?: string | null;
  subject_codename?: string | null;
  teacher_name?: string | null;
  teacher_staff_id?: string | null;
  teacher_status_label?: TeacherStatusLabel;
  is_substitute?: boolean;
  substitution_id?: number | null;
  substitute_start_date?: string | null;
  substitute_end_date?: string | null;
  original_teacher_name?: string | null;
  source_period_id: number;
  target_period_id: number;
  predicted_period_grade: number | null;
  risk_score: number | null;
  risk_level: string | null;
  data_status: string | null;
  risk_assessment_status?: string | null;
  generated_at: string | null;
  model_version: {
    model_version_id: number;
    model_name: string;
    model_type: string;
    algorithm: string;
    is_active: boolean;
  } | null;
  features: PredictionFeature[];
  prediction_status: PredictionStatus;
  model_execution: ModelExecutionStatus;
  evidence: TeacherPredictionEvidence[];
  interpretations: string[];
  limitations: string[];
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
  academic_period_id?: number;
  term?: number;
  grade_level?: number;
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
  if (params.academic_period_id) query.set("academic_period_id", String(params.academic_period_id));
  if (params.term) query.set("term", String(params.term));
  if (params.grade_level) query.set("grade_level", String(params.grade_level));
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

export async function fetchDashboardFilters(
  params?: { class_id?: number; academic_period_id?: number }
): Promise<DashboardFilters> {
  const query = new URLSearchParams();
  if (params?.class_id !== undefined) query.set("class_id", String(params.class_id));
  if (params?.academic_period_id !== undefined) query.set("academic_period_id", String(params.academic_period_id));
  const qs = query.toString();
  const response = await apiFetch(`/api/v1/predictions/dashboard/filters${qs ? `?${qs}` : ""}`);
  if (!response.ok) throw new Error("Failed to load dashboard filters.");
  return response.json();
}

export async function fetchDashboardGradeSummaries(
  params: { academic_period_id?: number; term?: number } = {}
): Promise<DashboardGradeGroupSummary[]> {
  const query = new URLSearchParams();
  if (params.academic_period_id) query.set("academic_period_id", String(params.academic_period_id));
  if (params.term) query.set("term", String(params.term));
  const qs = query.toString();
  const response = await apiFetch(`/api/v1/predictions/dashboard/grade-summaries${qs ? `?${qs}` : ""}`);
  if (!response.ok) throw new Error("Failed to load grade summaries.");
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

export async function fetchPredictionRosterStatus(params: {
  class_id: number;
  subject_id: number;
  academic_period_id: number;
}): Promise<PredictionRosterResponse> {
  const query = new URLSearchParams();
  query.set("class_id", String(params.class_id));
  query.set("subject_id", String(params.subject_id));
  query.set("academic_period_id", String(params.academic_period_id));

  const response = await apiFetch(`/api/v1/predictions/status/roster?${query.toString()}`);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to load prediction roster.");
  }
  return response.json();
}

export const fetchDualPurposeRosterStatus = fetchPredictionRosterStatus;

export type PredictionGenerateRequest = CurrentPeriodGenerateRequest;

export async function generatePrediction(
  payload: PredictionGenerateRequest
): Promise<CurrentPeriodGenerateResponse> {
  const response = await apiFetch("/api/v1/predictions/unified/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to generate prediction.");
  }
  return response.json();
}

export const generateCurrentProjection = generatePrediction;

export async function refreshPrediction(
  predictionId: number,
  payload?: { generation_request_id?: string }
): Promise<PredictionRefreshResponse> {
  const response = await apiFetch(`/api/v1/predictions/${predictionId}/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to refresh prediction.");
  }
  return response.json();
}

export async function fetchPredictionStatus(
  predictionId: number
): Promise<PredictionStatusEnvelope> {
  const response = await apiFetch(`/api/v1/predictions/${predictionId}/status`);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to load prediction status.");
  }
  return response.json();
}

export async function fetchPredictionHistory(
  predictionId: number
): Promise<PredictionHistoryResponse> {
  const response = await apiFetch(`/api/v1/predictions/${predictionId}/history`);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || "Failed to load prediction history.");
  }
  return response.json();
}
