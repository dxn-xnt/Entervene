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
  resolved_at?: string | null;
  resolution_reason?: string | null;
  diagnosis_summary: {
    weakest_supported_components?: string[];
    competency_detail_status?: string;
    external_assessment_detail_status?: string;
    covered_competencies_for_teacher_review_count?: number;
  };
  passing_threshold?: number | null;
}

export interface DiagnosisSnapshot {
  evidence_cutoff_at?: string;
  weakest_supported_components?: string[];
  components?: Record<string, { evidence_state: string; percent: number | null; model_observation_count?: number }>;
  supporting_activities?: Array<{ classwork_id: number; classwork_assignment_id?: number; title: string; component: string; score: number; possible_score: number; percent: number }>;
  lowest_supported_competencies?: Array<{ competency_id: number; competency_code: string; competency_statement: string; percent: number; score: number; possible_score: number; supporting_scores: Array<{ source_type: string; activity_title: string; quiz_question_id?: number; lesson_title?: string; score?: number; possible_score?: number }> }>;
  manual_assessment_coverage?: Array<{ classwork_id: number; title: string; component: string; score: number; possible_score: number; percent: number; in_weakest_supported_component?: boolean; covered_lessons: Array<{ lesson_id: number; title: string }>; covered_competencies: Array<{ competency_id: number; competency_code: string; competency_statement: string }>; score_scope: string; coverage_provenance: string }>;
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

export interface TeacherResolvedInterventionDetail extends TeacherInterventionDetail {
  resolution_projection: number | null;
  targeted_activities: Array<{ assignment_id: number; title: string; classwork_type: string; submission_status: string | null; grade: number | null; total_points: number | null; original_assignment_id?: number | null; original_title?: string | null; exam_subtype?: string | null; original_grade?: number | null; effective_grade?: number | null }>;
  sent_reviewer: { title: string; introduction: string; body: string } | null;
}

export class InterventionApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function read<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await apiFetch(path, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = body.detail;
    const message = typeof detail === "string"
      ? detail
      : Array.isArray(detail)
        ? detail.map((item: { loc?: Array<string | number>; msg?: string }) => {
          const field = (item.loc ?? []).filter((part) => part !== "body").join(".");
          return field ? `${field}: ${item.msg ?? "Validation error"}` : (item.msg ?? "Validation error");
        }).join("; ")
        : "Unable to complete the request. Please try again.";
    throw new InterventionApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

const base = "/api/v1/teacher/interventions";
export const listTeacherCandidates = () => read<{ items: TeacherInterventionSummary[]; total: number }>(`${base}/candidates`);
export const getTeacherCandidate = (id: number) => read<TeacherInterventionDetail>(`${base}/candidates/${id}`);
export const activateTeacherCandidate = (id: number) => read<TeacherInterventionDetail>(`${base}/candidates/${id}/activate`, "POST");
export const listTeacherActive = () => read<{ items: TeacherInterventionSummary[]; total: number }>(`${base}/active`);
export const getTeacherActive = (id: number) => read<TeacherInterventionDetail>(`${base}/active/${id}`);
export const listTeacherResolved = () => read<{ items: TeacherInterventionSummary[]; total: number }>(`${base}/resolved`);
export const getTeacherResolved = (id: number) => read<TeacherResolvedInterventionDetail>(`${base}/resolved/${id}`);

export type MaterialKind = "STUDENT_REVIEWER" | "REMEDIAL_ASSESSMENT";
export interface ReviewerDraft { title: string; introduction: string; body: string }
export interface RemedialQuestion {
  question_text: string;
  question_type: "MULTIPLE_CHOICE" | "IDENTIFICATION" | "SHORT_ANSWER";
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
export type RemediationGradeTreatment = "PRACTICE_ONLY" | "WRITTEN_WORK" | "PERFORMANCE_TASK" | "EXAMINATION";
export interface RemediationResource {
  kind: "LESSON" | "CLASSWORK"; id: number; title: string; description: string;
  lesson: string; topic: string; attachments: string[]; classwork_type?: string;
  access: "ALREADY_ACCESSIBLE" | "PLANNING_ONLY"; ai_read: "METADATA_ONLY";
  recommended: boolean; match_reason: string | null; match_level: "COMPETENCY" | "LESSON" | "SOURCE_ACTIVITY" | null; match_rank: number;
  is_graded?: boolean;
}
export interface RemediationFocus {
  basis: "FROZEN_TRIGGER_DIAGNOSIS";
  evidence_level: "QUESTION_SCORE" | "SCORED_COMPETENCY" | "ACTIVITY_COVERAGE" | "COMPONENT_ONLY";
  component: "WRITTEN_WORK" | "PERFORMANCE_TASK" | "EXAMINATION" | null;
  exam_subtype: "SUMMATIVE_1" | "SUMMATIVE_2" | "TERM_EXAM" | null;
  exam_subtype_requires_confirmation: boolean;
  lesson_ids: number[]; lessons: Array<{ id: number; title: string }>;
  competency_ids: number[]; competencies: Array<{ id: number; label: string }>;
  topics: string[]; source_classwork_ids: number[];
  question_evidence: Array<{ quiz_question_id: number | null; score: number; possible_score: number }>;
  coverage_is_context_only: boolean;
}
export interface RemediationProgress {
  triggering_projection: number; latest_projection: number | null; latest_revision: number | null;
  completed_remediation: Array<{ title: string; assignment_id: number; grade: number | null; total_points: number | null }>;
  assigned_remediation?: Array<{ title: string; assignment_id: number; classwork_id?: number; classwork_type?: string; is_published?: boolean; component: string | null; is_graded: boolean; submission_status: string | null; grade: number | null; total_points: number | null; original_assignment_id?: number | null; original_title?: string | null; original_grade?: number | null; effective_grade?: number | null; exam_subtype?: string | null }>;
  status: string; status_reason: string;
}
export interface RemediationPlan {
  teacher_choice: RemediationFormat | null;
  grade_treatment?: RemediationGradeTreatment | null;
  original_exam_assignment_id?: number | null;
  target_assignment_ids?: number[];
  score_adjustment_cap?: number;
  selected_resources: Array<{ kind: "LESSON" | "CLASSWORK"; id: number }>;
  ai_suggestion: null | { recommended_format: RemediationFormat; recommended_grade_treatment?: RemediationGradeTreatment | null; reason: string; focus: Array<{ competency: string }>; evidence_used: Record<string, unknown> };
}
export interface OriginalExamination { assignment_id: number; title: string; subtype: "SUMMATIVE_1" | "SUMMATIVE_2" | "TERM_EXAM"; score: number; total_points: number }
export interface RemediationClassworkTarget {
  assignment_id: number;
  classwork_id: number;
  title: string;
  component: "WRITTEN_WORK" | "PERFORMANCE_TASK";
  original_score: number | null;
  max_points: number;
  percent?: number | null;
  is_recommended?: boolean;
}
export interface ClassworkScorePreview {
  assignment_id: number;
  title?: string | null;
  original_score: number;
  max_points: number;
  max_adjusted_score: number;
  possible_gain: number;
  cap_percentage: number;
  was_adjusted: boolean;
  was_capped: boolean;
}
export interface ScoreAdjustmentPreviewResponse {
  score_adjustment_cap: number;
  previews: ClassworkScorePreview[];
  disclaimer: string;
}
export interface RemediationWorkspace {
  plan: RemediationPlan;
  resources: RemediationResource[];
  focus: RemediationFocus;
  progress: RemediationProgress;
  original_exams: OriginalExamination[];
  score_previews?: ClassworkScorePreview[];
}
export const getRemediationWorkspace = (id: number) => read<RemediationWorkspace>(`${base}/${id}/remediation`);
export const saveRemediationPlan = (id: number, plan: Pick<RemediationPlan, "teacher_choice" | "selected_resources" | "grade_treatment"> & Partial<Pick<RemediationPlan, "original_exam_assignment_id" | "target_assignment_ids" | "score_adjustment_cap">>) => read<RemediationWorkspace>(`${base}/${id}/remediation`, "PUT", plan);
export const generateRemediationAdvisory = (id: number) => read<RemediationWorkspace>(`${base}/${id}/remediation/advisory`, "POST");
export const previewScoreAdjustment = (
  id: number,
  payload: {
    score_adjustment_cap: number;
    target_assignment_ids: number[];
    items?: Array<{ assignment_id: number; original_score?: number; max_points?: number; title?: string | null }>;
  }
) => read<ScoreAdjustmentPreviewResponse>(`${base}/${id}/remediation/score-preview`, "POST", payload);

export interface ProjectionUnavailableReason {
  code: string;
  message: string;
  assignment_id?: number | null;
}

export interface PassingThresholdPolicy {
  academic_year_id: number;
  subject_id?: number | null;
  grading_template_id?: number | null;
  source: string;
  policy_version?: string | null;
  revision?: number | null;
  captured_at?: string | null;
}

export interface EligibleTargetGain {
  assignment_id: number;
  title: string;
  component: "WRITTEN_WORK" | "PERFORMANCE_TASK";
  original_score: number;
  current_effective_score: number;
  max_points: number;
  cap_percentage: number;
  maximum_hypothetical_effective_score: number;
  possible_score_gain: number;
}

export interface TargetProjection {
  assignment_id: number;
  title?: string | null;
  component?: "WRITTEN_WORK" | "PERFORMANCE_TASK" | null;
  original_score?: number | null;
  current_effective_score?: number | null;
  max_points?: number | null;
  cap_percentage?: number | null;
  maximum_hypothetical_effective_score?: number | null;
  possible_score_gain?: number | null;
  applied: boolean;
  projected_initial_grade?: number | null;
  projected_subject_grade?: number | null;
  step_subject_grade_improvement?: number | null;
  possible_grade_improvement?: number | null;
  reaches_passing_threshold?: boolean | null;
  unavailable_reasons: ProjectionUnavailableReason[];
}

export interface AIMidtermTargetEstimate {
  assignment_id: number;
  maximum_hypothetical_effective_score: number;
  hypothetical_predicted_term_grade: number;
  step_estimated_difference: number;
  estimated_difference_from_baseline: number;
}

export interface AIMidtermWhatIf {
  status: "AVAILABLE" | "UNAVAILABLE";
  estimate_kind: "AI_MIDTERM_WHAT_IF_ESTIMATE";
  is_official_grade: false;
  is_guaranteed: false;
  model_version_id?: number | null;
  model_name?: string | null;
  prediction_purpose: "CURRENT_TERM_FINAL_GRADE_PROJECTION";
  evidence_basis: "LIVE_ACTUAL_EVIDENCE_WITH_EPHEMERAL_CAPPED_WW_PT_OVERRIDES";
  baseline_predicted_term_grade?: number | null;
  readiness: Record<string, unknown>;
  target_estimates: AIMidtermTargetEstimate[];
  unavailable_reasons: ProjectionUnavailableReason[];
  limitations: string[];
}

export interface SubjectGradeProjectionResponse {
  status: "AVAILABLE" | "UNAVAILABLE" | "FINALIZED";
  grade_representation: "TRANSMUTED_TERM_GRADE" | "FINAL_PERIOD_GRADE";
  current_initial_grade?: number | null;
  current_subject_grade?: number | null;
  passing_threshold?: number | null;
  passing_threshold_policy?: PassingThresholdPolicy | null;
  current_reaches_passing_threshold?: boolean | null;
  target_projections: TargetProjection[];
  eligible_target_gains: EligibleTargetGain[];
  additional_eligible_targets_have_positive_improvement: boolean;
  recommended_target_assignment_id?: number | null;
  assumptions: string[];
  unavailable_reasons: ProjectionUnavailableReason[];
  ai_midterm_what_if: AIMidtermWhatIf;
}

export const projectSubjectGrade = (
  id: number,
  payload: { target_assignment_ids: number[]; score_adjustment_cap?: number }
) => read<SubjectGradeProjectionResponse>(`${base}/${id}/remediation/subject-grade-projection`, "POST", payload);

export function matchingCandidate(prediction: DevelopmentCurrentTermListItem, candidates: TeacherInterventionSummary[]): TeacherInterventionSummary | undefined {
  return candidates.find((candidate) => candidate.status === "CANDIDATE"
    && candidate.student_id === prediction.student_id
    && candidate.class_id === prediction.class_id
    && candidate.subject_id === prediction.subject_id
    && candidate.academic_period_id === prediction.academic_period_id
    && candidate.source_prediction_revision <= prediction.revision
    && prediction.readiness_status === "READY"
    && prediction.projected_final_term_grade !== null
    && prediction.projected_final_term_grade < (candidate.passing_threshold ?? 85));
}

export function matchingActiveIntervention(prediction: DevelopmentCurrentTermListItem, activeInterventions: TeacherInterventionSummary[]): TeacherInterventionSummary | undefined {
  return activeInterventions.find((intervention) => intervention.status === "ACTIVE"
    && intervention.student_id === prediction.student_id
    && intervention.class_id === prediction.class_id
    && intervention.subject_id === prediction.subject_id
    && intervention.academic_period_id === prediction.academic_period_id);
}

export interface RemediationDraftGenerationRequest {
  draft_format: "QUIZ" | "CLASSWORK";
  target_component: "WRITTEN_WORK" | "PERFORMANCE_TASK" | "EXAMINATION";
  grade_treatment: "WRITTEN_WORK" | "PERFORMANCE_TASK" | "EXAMINATION" | "PRACTICE_ONLY";
  exam_subtype?: "SUMMATIVE_1" | "SUMMATIVE_2" | "TERM_EXAM" | null;
  item_count?: number;
  total_points?: number;
  activity_mode?: "ONLINE" | "MANUAL";
  selected_lesson_ids?: number[] | null;
  selected_competency_ids?: number[] | null;
  selected_quiz_question_ids?: number[] | null;
  selected_reading_ids?: number[] | null;
  custom_teacher_instructions?: string | null;
}

export interface RemediationQuizOptionDraft {
  option_text: string;
  option_order: number;
}

export interface RemediationTeacherAnswerKey {
  correct_answer: string;
  explanation: string;
  scoring_guide?: string | null;
}

export interface RemediationQuizQuestionDraft {
  question_text: string;
  question_type: "MULTIPLE_CHOICE" | "TRUE_FALSE" | "IDENTIFICATION" | "SHORT_ANSWER";
  points: number;
  display_order: number;
  difficulty_level?: "EASY" | "MEDIUM" | "HARD" | null;
  targeted_competency_id: number;
  targeted_lesson_id: number;
  targeted_quiz_question_id?: number | null;
  options: RemediationQuizOptionDraft[];
  teacher_answer_key: RemediationTeacherAnswerKey;
}

export interface RemediationQuizDraft {
  draft_format: "QUIZ";
  target_component: "WRITTEN_WORK" | "EXAMINATION";
  grade_treatment: "WRITTEN_WORK" | "EXAMINATION" | "PRACTICE_ONLY";
  exam_subtype?: "SUMMATIVE_1" | "SUMMATIVE_2" | "TERM_EXAM" | null;
  title: string;
  instructions: string;
  total_points: number;
  duration_minutes?: number | null;
  settings?: Record<string, unknown>;
  questions: RemediationQuizQuestionDraft[];
}

export interface RemediationTaskDraft {
  task_number: number;
  title: string;
  instructions: string;
  targeted_competency_id: number;
  targeted_lesson_id: number;
}

export interface RemediationDeliverableDraft {
  deliverable_name: string;
  deliverable_type: "DOCUMENT" | "SPREADSHEET" | "PRESENTATION" | "IMAGE" | "PDF" | "AUDIO" | "VIDEO" | "CODE" | "WRITTEN_REPORT";
  description: string;
}

export interface RemediationRubricLevelDraft {
  level_name: string;
  description: string;
  points: number;
  display_order: number;
}

export interface RemediationTeacherClassworkGuide {
  exemplar_or_expected_response: string;
  evaluation_notes: string;
  common_misconceptions: string[];
}

export interface RemediationClassworkDraft {
  draft_format: "CLASSWORK";
  target_component: "WRITTEN_WORK" | "PERFORMANCE_TASK";
  grade_treatment: "WRITTEN_WORK" | "PERFORMANCE_TASK" | "PRACTICE_ONLY";
  title: string;
  description: string;
  student_instructions: string;
  total_points: number;
  activity_mode: "ONLINE" | "MANUAL";
  tasks: RemediationTaskDraft[];
  deliverables: RemediationDeliverableDraft[];
  supported_upload_formats: string[];
  rubric_levels: RemediationRubricLevelDraft[];
  teacher_guide: RemediationTeacherClassworkGuide;
}

export type RemediationGeneratedDraft = RemediationQuizDraft | RemediationClassworkDraft;

export const generateRemediationDraft = (
  id: number,
  payload: RemediationDraftGenerationRequest
) => read<RemediationGeneratedDraft>(`${base}/${id}/remediation/draft`, "POST", payload);

export interface RemediationDraftPreflightResult {
  is_valid: boolean;
  draft_format: "QUIZ" | "CLASSWORK";
  target_component: "WRITTEN_WORK" | "PERFORMANCE_TASK" | "EXAMINATION";
  grade_treatment: RemediationGradeTreatment;
  total_points: number;
  authoritative_cap: number;
  target_assignment_ids: number[];
  reading_prerequisites: Array<{
    reading_classwork_id: number;
    reading_assignment_id: number;
    display_order: number;
  }>;
}

export interface RemediationAssessmentCreateResult {
  remediation_request_id: string;
  intervention_id: number;
  classwork_id: number;
  classwork_assignment_id: number;
  quiz_id?: number | null;
  draft_format: "QUIZ" | "CLASSWORK";
  grade_treatment: RemediationGradeTreatment;
  is_published: false;
}

export const preflightRemediationDraft = (
  id: number,
  draft: RemediationGeneratedDraft
) => read<RemediationDraftPreflightResult>(
  `${base}/${id}/remediation/preflight`,
  "POST",
  { draft, validation_stage: "SAVE_DRAFT" }
);

export const createRemediationAssessment = (
  id: number,
  remediationRequestId: string,
  draft: RemediationGeneratedDraft
) => read<RemediationAssessmentCreateResult>(
  `${base}/${id}/remediation/assessment`,
  "POST",
  { remediation_request_id: remediationRequestId, draft }
);
