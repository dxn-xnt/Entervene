import { apiFetch } from "@/lib/api";

export type PracticeQuestionType = "MULTIPLE_CHOICE" | "TRUE_FALSE" | "IDENTIFICATION";
export type PracticeGatekeeperPolicy = "REQUIRE_PASS" | "REQUIRE_ATTEMPT" | "OPTIONAL";
export type PracticeAssessmentStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export interface PracticeOptionDraft {
  option_id?: number;
  option_text: string;
  is_correct: boolean;
  option_order: number;
}

export interface PracticeQuestionDraft {
  practice_question_id?: number;
  version?: number;
  question_text: string;
  question_type: PracticeQuestionType;
  points: number;
  explanation?: string | null;
  display_order: number;
  is_ai_generated?: boolean;
  options: PracticeOptionDraft[];
}

export interface PracticeAssessmentDetail {
  practice_assessment_id: number;
  intervention_id: number;
  title: string;
  status: PracticeAssessmentStatus;
  gatekeeper_policy: PracticeGatekeeperPolicy;
  passing_percentage: number;
  version: number;
  questions: PracticeQuestionDraft[];
}

export interface PracticeAttemptSummary {
  attempt_id: number;
  practice_assessment_id: number;
  student_id: string;
  attempt_number: number;
  status: string;
  total_score: number;
  max_score: number;
  score_percentage: number;
  is_passed: boolean;
  started_at: string;
  completed_at?: string | null;
}

export interface PracticeProgressionEvaluation {
  intervention_id: number;
  student_id: string;
  practice_exists: boolean;
  assessment_status?: string | null;
  gatekeeper_policy: PracticeGatekeeperPolicy;
  passing_percentage?: number | null;
  attempts_count: number;
  practice_completed: boolean;
  practice_passed: boolean;
  eligible_for_remediation: boolean;
  best_score_percentage?: number | null;
  reason: string;
}

export interface StudentPracticeAssessmentMetadata {
  practice_assessment_id: number;
  title: string;
  gatekeeper_policy: PracticeGatekeeperPolicy;
  passing_percentage: number;
  total_questions: number;
  total_points: number;
  attempts_count: number;
  has_active_attempt: boolean;
  active_attempt_id?: number | null;
  active_attempt_number?: number | null;
  has_passed: boolean;
  best_score_percentage?: number | null;
  latest_score_percentage?: number | null;
  latest_attempt_number?: number | null;
}

export interface PracticeAttemptActiveOption {
  option_id: number;
  option_text: string;
  option_order: number;
}

export interface PracticeAttemptActiveQuestion {
  practice_question_id: number;
  display_order: number;
  question_text: string;
  question_type: PracticeQuestionType;
  points: number;
  options: PracticeAttemptActiveOption[];
}

export interface PracticeAttemptStartResponse {
  attempt_id: number;
  attempt_number: number;
  status: string;
  passing_percentage: number;
  total_questions: number;
  questions: PracticeAttemptActiveQuestion[];
  saved_answers?: PracticeAttemptAnswerSubmission[];
}

export interface PracticeAttemptDraftSaveResponse {
  attempt_id: number;
  status: string;
  saved_answers_count: number;
  saved_at: string;
}

export interface PracticeAttemptAnswerSubmission {
  practice_question_id: number;
  selected_option_id?: number | null;
  student_answer_text?: string | null;
}

export interface PracticeFeedbackOption {
  option_id: number;
  option_text: string;
  is_correct: boolean;
}

export interface PracticeAttemptFeedbackItem {
  practice_question_id: number | null;
  question_text: string;
  question_type: PracticeQuestionType;
  points_possible: number;
  points_awarded: number;
  is_correct: boolean;
  student_answer?: string | null;
  selected_option_id?: number | null;
  correct_answer: string;
  explanation?: string | null;
  options: PracticeFeedbackOption[];
}

export interface PracticeAttemptFeedbackResponse {
  attempt_id: number;
  attempt_number: number;
  status: string;
  total_score: number;
  max_score: number;
  score_percentage: number;
  passing_percentage: number;
  is_passed: boolean;
  result_status: "PASSED" | "BELOW_PASSING";
  eligible_for_remediation: boolean;
  started_at: string;
  completed_at?: string | null;
  items: PracticeAttemptFeedbackItem[];
}

export interface PracticeQuestionsImportPreviewResponse {
  source_filename?: string;
  total_parsed?: number;
  questions: PracticeQuestionDraft[];
  warnings: string[];
}

export class PracticeAssessmentApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const headers: Record<string, string> = {};
  if (!isFormData && body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await apiFetch(path, {
    method,
    headers,
    body: isFormData ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const detail = errorBody.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail
              .map((item: { loc?: Array<string | number>; msg?: string }) => {
                const field = (item.loc ?? []).filter((part) => part !== "body").join(".");
                return field ? `${field}: ${item.msg ?? "Validation error"}` : item.msg ?? "Validation error";
              })
              .join("; ")
          : errorBody.message || "Unable to complete practice assessment request.";
    throw new PracticeAssessmentApiError(response.status, message);
  }

  return response.json() as Promise<T>;
}

const teacherBase = (interventionId: number) =>
  `/api/v1/teacher/interventions/${interventionId}/practice-assessment`;

/**
 * Fetch the teacher's practice assessment for the given intervention.
 * Returns null if no practice assessment exists yet (404).
 */
export async function getTeacherPracticeAssessment(
  interventionId: number
): Promise<PracticeAssessmentDetail | null> {
  try {
    return await request<PracticeAssessmentDetail>(teacherBase(interventionId));
  } catch (err) {
    if (err instanceof PracticeAssessmentApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * Initialize or get the practice assessment in DRAFT status.
 */
export async function initializeTeacherPracticeAssessment(
  interventionId: number,
  payload?: {
    title?: string;
    passing_percentage?: number;
    gatekeeper_policy?: PracticeGatekeeperPolicy;
  }
): Promise<PracticeAssessmentDetail> {
  return request<PracticeAssessmentDetail>(teacherBase(interventionId), "POST", payload || {});
}

/**
 * Update practice assessment settings (title, passing percentage, progression policy).
 */
export async function updateTeacherPracticeAssessment(
  interventionId: number,
  payload: {
    title?: string;
    passing_percentage?: number;
    gatekeeper_policy?: PracticeGatekeeperPolicy;
  }
): Promise<PracticeAssessmentDetail> {
  return request<PracticeAssessmentDetail>(teacherBase(interventionId), "PATCH", payload);
}

/**
 * Publish the practice assessment. Requires at least one configured question.
 */
export async function publishTeacherPracticeAssessment(
  interventionId: number
): Promise<PracticeAssessmentDetail> {
  return request<PracticeAssessmentDetail>(`${teacherBase(interventionId)}/publish`, "POST");
}

/**
 * Archive the practice assessment.
 */
export async function archiveTeacherPracticeAssessment(
  interventionId: number
): Promise<PracticeAssessmentDetail> {
  return request<PracticeAssessmentDetail>(`${teacherBase(interventionId)}/archive`, "POST");
}

/**
 * Batch save all draft questions for the practice assessment.
 */
export async function batchSavePracticeQuestions(
  interventionId: number,
  questions: PracticeQuestionDraft[]
): Promise<PracticeQuestionDraft[]> {
  return request<PracticeQuestionDraft[]>(`${teacherBase(interventionId)}/questions/batch`, "POST", {
    questions: questions.map((q, idx) => ({
      question_text: q.question_text,
      question_type: q.question_type,
      points: q.points ?? 1.0,
      explanation: q.explanation || null,
      display_order: idx + 1,
      is_ai_generated: q.is_ai_generated ?? false,
      options: q.options.map((opt, optIdx) => ({
        option_text: opt.option_text,
        is_correct: opt.is_correct,
        option_order: optIdx + 1,
      })),
    })),
  });
}

/**
 * Request AI to generate multiple-choice practice questions grounded in selected reading materials.
 */
export async function generatePracticeQuestionsAI(
  interventionId: number,
  payload: {
    target_count?: number;
    reading_classwork_ids?: number[];
    additional_guidance?: string;
  }
): Promise<PracticeQuestionDraft[]> {
  return request<PracticeQuestionDraft[]>(`${teacherBase(interventionId)}/ai-generate`, "POST", payload);
}

/**
 * Upload a quiz document (.docx, .pdf, .txt) and preview the extracted practice questions.
 */
export async function importPracticeQuestionsPreview(
  interventionId: number,
  file: File
): Promise<PracticeQuestionsImportPreviewResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return request<PracticeQuestionsImportPreviewResponse>(`${teacherBase(interventionId)}/import`, "POST", formData);
}

/**
 * List student attempts for this practice assessment.
 */
export async function listTeacherPracticeAttempts(
  interventionId: number
): Promise<PracticeAttemptSummary[]> {
  try {
    return await request<PracticeAttemptSummary[]>(`${teacherBase(interventionId)}/attempts`);
  } catch (err) {
    if (err instanceof PracticeAssessmentApiError && err.status === 404) {
      return [];
    }
    throw err;
  }
}

/**
 * Fetch complete diagnostic feedback for a student attempt as a teacher.
 */
export async function getTeacherPracticeAttemptFeedback(
  interventionId: number,
  attemptId: number
): Promise<PracticeAttemptFeedbackResponse> {
  return request<PracticeAttemptFeedbackResponse>(
    `${teacherBase(interventionId)}/attempts/${attemptId}/feedback`
  );
}

/**
 * Evaluate current progression status for the intervention student.
 */
export async function getTeacherPracticeProgression(
  interventionId: number
): Promise<PracticeProgressionEvaluation> {
  return request<PracticeProgressionEvaluation>(`${teacherBase(interventionId)}/progression`);
}

// ---------------------------------------------------------------------------
// Student Practice Assessment APIs
// ---------------------------------------------------------------------------

const studentBase = (interventionId: number) =>
  `/api/v1/student/interventions/${interventionId}/practice-assessment`;

/**
 * Fetch lightweight practice assessment summary for the student.
 * Returns null if no published practice assessment exists (404).
 */
export async function getStudentPracticeAssessment(
  interventionId: number
): Promise<StudentPracticeAssessmentMetadata | null> {
  try {
    return await request<StudentPracticeAssessmentMetadata>(studentBase(interventionId));
  } catch (err) {
    if (err instanceof PracticeAssessmentApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * Start a new attempt or resume an existing active attempt.
 */
export async function startStudentPracticeAttempt(
  interventionId: number
): Promise<PracticeAttemptStartResponse> {
  return request<PracticeAttemptStartResponse>(`${studentBase(interventionId)}/start`, "POST");
}

/**
 * Save draft answers for an active practice attempt without submitting or scoring.
 */
export async function saveStudentPracticeAttemptDraft(
  interventionId: number,
  attemptId: number,
  answers: PracticeAttemptAnswerSubmission[]
): Promise<PracticeAttemptDraftSaveResponse> {
  return request<PracticeAttemptDraftSaveResponse>(
    `${studentBase(interventionId)}/attempts/${attemptId}/draft`,
    "PUT",
    { answers }
  );
}

/**
 * Submit answers for an active practice attempt and receive complete diagnostic feedback.
 */
export async function submitStudentPracticeAttempt(
  interventionId: number,
  attemptId: number,
  answers: PracticeAttemptAnswerSubmission[]
): Promise<PracticeAttemptFeedbackResponse> {
  return request<PracticeAttemptFeedbackResponse>(
    `${studentBase(interventionId)}/attempts/${attemptId}/submit`,
    "POST",
    { answers }
  );
}

/**
 * List all historical attempts submitted by the student for this practice assessment.
 */
export async function listStudentPracticeAttempts(
  interventionId: number
): Promise<PracticeAttemptSummary[]> {
  try {
    return await request<PracticeAttemptSummary[]>(`${studentBase(interventionId)}/attempts`);
  } catch (err) {
    if (err instanceof PracticeAssessmentApiError && err.status === 404) {
      return [];
    }
    throw err;
  }
}

/**
 * Fetch complete diagnostic feedback for a submitted attempt.
 */
export async function getStudentPracticeAttemptFeedback(
  interventionId: number,
  attemptId: number
): Promise<PracticeAttemptFeedbackResponse> {
  return request<PracticeAttemptFeedbackResponse>(
    `${studentBase(interventionId)}/attempts/${attemptId}/feedback`
  );
}

/**
 * Fetch practice progression evaluation for the student.
 */
export async function getStudentPracticeProgression(
  interventionId: number
): Promise<PracticeProgressionEvaluation> {
  return request<PracticeProgressionEvaluation>(`${studentBase(interventionId)}/progression`);
}
