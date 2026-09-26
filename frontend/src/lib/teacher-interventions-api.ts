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
  resolved_at: string | null;
  resolution_reason: string | null;
}

export class InterventionApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function read<T>(path: string, method = "GET"): Promise<T> {
  const response = await apiFetch(path, { method });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new InterventionApiError(response.status, typeof body.detail === "string" ? body.detail : "Unable to complete the request. Please try again.");
  }
  return response.json() as Promise<T>;
}

const base = "/api/v1/teacher/interventions/candidates";
export const listTeacherCandidates = () => read<{ items: TeacherInterventionSummary[]; total: number }>(base);
export const getTeacherCandidate = (id: number) => read<TeacherInterventionDetail>(`${base}/${id}`);
export const activateTeacherCandidate = (id: number) => read<TeacherInterventionDetail>(`${base}/${id}/activate`, "POST");

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
