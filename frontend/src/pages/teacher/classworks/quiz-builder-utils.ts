import type { QuizQuestionDraft, QuizQuestionType, QuizSettingsDraft } from "./quiz-builder-types";

export const defaultQuizSettings: QuizSettingsDraft = {
  is_shuffle_questions: false,
  is_shuffle_options: false,
  enable_per_question_scoring: true,
  enable_per_question_time_limits: false,
  max_attempts: "1",
  show_correct_answers: false,
  summary_release_mode: "IMMEDIATE",
  summary_release_at: "",
  duration_minutes: "",
};

export function interventionQuizCreationDefaults(
  isTargeted: boolean,
  gradeTreatment:
    | "PRACTICE_ONLY"
    | "WRITTEN_WORK"
    | "PERFORMANCE_TASK"
    | "EXAMINATION"
    | null
    | undefined,
) {
  void gradeTreatment;
  return {
    maxAttempts: isTargeted ? "3" : defaultQuizSettings.max_attempts,
    showScores: isTargeted ? true : defaultQuizSettings.show_correct_answers,
  };
}

const quizQuestionId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const createEmptyQuizQuestion = (
  displayOrder: number,
  questionType: QuizQuestionType = "MULTIPLE_CHOICE",
): QuizQuestionDraft => ({
  id: quizQuestionId(),
  lesson_id: null,
  question_text: "",
  question_type: questionType,
  points: "1",
  display_order: displayOrder,
  difficulty_level: "MEDIUM",
  explanation: "",
  is_ai_generated: false,
  options:
    questionType === "MULTIPLE_CHOICE"
      ? [
          { option_text: "", is_correct: true, option_order: 1 },
          { option_text: "", is_correct: false, option_order: 2 },
        ]
      : questionType === "IDENTIFICATION"
      ? [
          { option_text: "", is_correct: true, option_order: 1 },
        ]
      : [],
});
