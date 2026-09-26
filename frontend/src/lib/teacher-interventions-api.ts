import { apiFetch } from "@/lib/api";
import type { DevelopmentCurrentTermListItem } from "@/lib/prediction-api";

export interface TeacherInterventionSummary {
  intervention_id: number;
  student_id: string;
  student_name: string;
  student_lrn: string;
  class_id: number;
  class_name: string;
  subject_id: number;
  subject_name: string;
  academic_period_id: number;
  academic_period_name: string;
  status: string;
  source_prediction_id: number;
  source_prediction_revision: number;
  triggering_predicted_grade: number;
  triggering_intervention_level: string;
  created_at: string;
  activated_at?: string | null;
  diagnosis_summary: {
    weakest_supported_components?: string[];
    competency_detail_status?: string;
    external_assessment_detail_status?: string;
    covered_competencies_for_teacher_review_count?: number;
  };
}

export interface DiagnosisSnapshot {
  evidence_cutoff_at?: string;
  weakest_supported_components?: string[];
  components?: Record<string, { evidence_state: string; percent: number | null; model_observation_count?: number }>;
  supporting_activities?: Array<{ classwork_id: number; title: string; component: string; score: number; possible_score: number; percent: number }>;
  lowest_supported_competencies?: Array<{ competency_id: number; competency_code: string; competency_statement: string; percent: number; score: number; possible_score: number; supporting_scores: Array<{ source_type: string; activity_title: string }> }>;
  manual_assessment_coverage?: Array<{ classwork_id: number; title: string; component: string; score: number; possible_score: number; percent: number; covered_lessons: Array<{ lesson_id: number; title: string }>; covered_competencies: Array<{ competency_id: number; competency_code: string; competency_statement: string }>; score_scope: string; coverage_provenance: string }>;
  covered_competencies_for_teacher_review?: Array<{ competency_id: number; competency_code: string; competency_statement: string; ranking_status: string; assessment_classwork_ids: number[] }>;
  competency_detail_status?: string;
  external_assessment_detail_status?: string;
}

export interface TeacherInterventionDetail extends TeacherInterventionSummary {
  diagnosis_snapshot: DiagnosisSnapshot;
  activated_at: string | null;
  activated_by_staff_id: string | null;
  resolved_at: string | null;
  resolution_reason: string | null;
}

export class InterventionApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function read<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await apiFetch(path, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new InterventionApiError(response.status, typeof body.detail === "string" ? body.detail : "Unable to complete the request. Please try again.");
  }
  return response.json() as Promise<T>;
}

const base = "/api/v1/teacher/interventions";
export const listTeacherCandidates = () => read<{ items: TeacherInterventionSummary[]; total: number }>(`${base}/candidates`);
export const getTeacherCandidate = (id: number) => read<TeacherInterventionDetail>(`${base}/candidates/${id}`);
export const activateTeacherCandidate = (id: number) => read<TeacherInterventionDetail>(`${base}/candidates/${id}/activate`, "POST");
export const listTeacherActive = () => read<{ items: TeacherInterventionSummary[]; total: number }>(`${base}/active`);
export const getTeacherActive = (id: number) => read<TeacherInterventionDetail>(`${base}/active/${id}`);

export type MaterialKind = "STUDENT_REVIEWER" | "REMEDIAL_ASSESSMENT";
export interface ReviewerDraft { title: string; introduction: string; body: string }
export interface RemedialQuestion {
  question_text: string;
  question_type: "MULTIPLE_CHOICE" | "SHORT_ANSWER";
  points: number;
  display_order: number;
  difficulty_level: "EASY" | "MEDIUM" | "HARD" | null;
  explanation: string | null;
  lesson_id: number | null;
  options: Array<{ option_text: string; is_correct: boolean; option_order: number }>;
  provenance?: null | { source_kind: "QUESTION_SCORE" | "SCORED_COMPETENCY" | "COVERAGE" | "COMPONENT"; source_question_id?: number | null; lesson_id?: number | null; competency_id?: number | null; coverage_classwork_id?: number | null; component?: string | null };
}
export interface RemedialDraft {
  title: string;
  instructions: string;
  duration_minutes: number | null;
  settings: Record<string, unknown>;
  questions: RemedialQuestion[];
}
export interface SupportMaterial {
  material_id: number;
  intervention_id: number;
  kind: MaterialKind;
  status: "DRAFT" | "SENT";
  evidence_basis: Record<string, unknown>;
  generated_content: ReviewerDraft | RemedialDraft | null;
  current_content: ReviewerDraft | RemedialDraft;
  created_by_staff_id: string;
  updated_by_staff_id: string;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  sent_by_staff_id: string | null;
}
export const listSupportMaterials = (id: number) => read<{ items: SupportMaterial[]; total: number }>(`${base}/${id}/materials`);
export const createSupportMaterial = (id: number, kind: MaterialKind) => read<SupportMaterial>(`${base}/${id}/materials`, "POST", { kind });
export const getSupportMaterial = (id: number, materialId: number) => read<SupportMaterial>(`${base}/${id}/materials/${materialId}`);
export const saveSupportMaterial = (id: number, materialId: number, content: ReviewerDraft | RemedialDraft) => read<SupportMaterial>(`${base}/${id}/materials/${materialId}`, "PUT", { content });
export const generateStudentReviewer = (id: number, materialId: number) => read<SupportMaterial>(`${base}/${id}/materials/${materialId}/generate`, "POST");
export const sendStudentReviewer = (id: number, materialId: number) => read<SupportMaterial>(`${base}/${id}/materials/${materialId}/send`, "POST");

export type RemediationFormat = "QUIZ" | "TOS" | "CLASSWORK" | "EXISTING_MATERIAL_ONLY";
export interface RemediationResource {
  kind: "LESSON" | "CLASSWORK"; id: number; title: string; description: string;
  lesson: string; topic: string; attachments: string[]; classwork_type?: string;
  access: "ALREADY_ACCESSIBLE" | "PLANNING_ONLY"; ai_read: "METADATA_ONLY";
}
export interface RemediationPlan {
  teacher_choice: RemediationFormat | null;
  selected_resources: Array<{ kind: "LESSON" | "CLASSWORK"; id: number }>;
  ai_suggestion: null | { recommended_format: RemediationFormat; reason: string; focus: Array<{ competency: string }>; evidence_used: Record<string, unknown> };
}
export interface RemediationWorkspace { plan: RemediationPlan; resources: RemediationResource[] }
export const getRemediationWorkspace = (id: number) => read<RemediationWorkspace>(`${base}/${id}/remediation`);
export const saveRemediationPlan = (id: number, plan: Pick<RemediationPlan, "teacher_choice" | "selected_resources">) => read<RemediationWorkspace>(`${base}/${id}/remediation`, "PUT", plan);
export const generateRemediationAdvisory = (id: number) => read<RemediationWorkspace>(`${base}/${id}/remediation/advisory`, "POST");

export function matchingCandidate(prediction: DevelopmentCurrentTermListItem, candidates: TeacherInterventionSummary[]): TeacherInterventionSummary | undefined {
  return candidates.find((candidate) => candidate.status === "CANDIDATE"
    && candidate.student_id === prediction.student_id
    && candidate.class_id === prediction.class_id
    && candidate.subject_id === prediction.subject_id
    && candidate.academic_period_id === prediction.academic_period_id
    && candidate.source_prediction_revision <= prediction.revision
    && prediction.readiness_status === "READY"
    && prediction.projected_final_term_grade !== null
    && prediction.projected_final_term_grade < 85);
}
