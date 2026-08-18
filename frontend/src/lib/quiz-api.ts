/**
 * quiz-api.ts
 * ===========
 * API client for student quiz attempt endpoints.
 * Wraps /api/v1/quizzes/assignment/* routes.
 */

import { apiFetch } from "./api";

// ---------------------------------------------------------------------------
// Types – match backend schemas (Quiz.py)
// ---------------------------------------------------------------------------

export type QuizAttemptOption = {
  option_id: number;
  option_text: string;
  option_order: number;
  is_correct?: boolean | null;
};

export type QuizAttemptQuestion = {
  quiz_question_id: number;
  question_text: string;
  question_type: string; // "MULTIPLE_CHOICE" | "SHORT_ANSWER"
  points: number;
  display_order: number;
  options: QuizAttemptOption[];
  answer_text?: string | null;
  selected_option_id?: number | null;
  points_awarded?: number | null;
  is_correct?: boolean | null;
};

export type QuizAttemptResponse = {
  quiz_id: number;
  classwork_assignment_id: number;
  classwork_id: number;
  title: string;
  instructions?: string | null;
  total_points?: number | null;
  duration_minutes?: number | null;
  max_attempts: number;
  attempt_count: number;
  status: string;
  started_at?: string | null;
  server_time?: string | null;
  submitted_at?: string | null;
  grade?: number | null;
  can_submit: boolean;
  summary_available: boolean;
  summary_release_mode: string;
  summary_release_at?: string | null;
  summary_message?: string | null;
  questions: QuizAttemptQuestion[];
};

export type QuizAnswerInput = {
  quiz_question_id: number;
  selected_option_id?: number | null;
  answer_text?: string | null;
};

export type QuizSubmitRequest = {
  answers: QuizAnswerInput[];
};

// ---------------------------------------------------------------------------
// API Functions
// ---------------------------------------------------------------------------

/**
 * Fetch the current quiz attempt state for an assignment.
 * Returns questions with any previously saved answers.
 */
export async function getQuizAttempt(assignmentId: number): Promise<QuizAttemptResponse> {
  const res = await apiFetch(`/api/v1/quizzes/assignment/${assignmentId}/attempt`);
  if (!res.ok) throw new Error("Failed to fetch quiz attempt.");
  return res.json();
}

/**
 * Start a new quiz attempt for the given assignment.
 * Creates the attempt record and returns questions (without correct answers).
 */
export async function startQuizAttempt(assignmentId: number): Promise<QuizAttemptResponse> {
  const res = await apiFetch(`/api/v1/quizzes/assignment/${assignmentId}/start`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to start quiz attempt.");
  return res.json();
}

/**
 * Submit quiz answers for a given assignment.
 * Returns the graded attempt with scores (if auto-gradable).
 */
export async function submitQuizAttempt(
  assignmentId: number,
  answers: QuizAnswerInput[],
): Promise<QuizAttemptResponse> {
  const res = await apiFetch(`/api/v1/quizzes/assignment/${assignmentId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers } satisfies QuizSubmitRequest),
  });
  if (!res.ok) throw new Error("Failed to submit quiz attempt.");
  return res.json();
}
