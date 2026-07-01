import type { QuizQuestionDraft, QuizQuestionType, QuizSettingsDraft } from "./quiz-builder-types";

export const defaultQuizSettings: QuizSettingsDraft = {
  is_shuffle_questions: false,
  enable_per_question_scoring: true,
  enable_per_question_time_limits: false,
  max_attempts: "1",
  show_correct_answers: false,
  summary_release_mode: "IMMEDIATE",
  summary_release_at: "",
  duration_minutes: "",
};

const quizQuestionId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const createEmptyQuizQuestion = (
  displayOrder: number,
  questionType: QuizQuestionType = "MULTIPLE_CHOICE",
): QuizQuestionDraft => ({
  id: quizQuestionId(),
  question_text: "",
  question_type: questionType,
  points: "1",
  display_order: displayOrder,
  difficulty_level: "MEDIUM",
  explanation: "",
  options:
    questionType === "MULTIPLE_CHOICE"
      ? [
          { option_text: "", is_correct: true, option_order: 1 },
          { option_text: "", is_correct: false, option_order: 2 },
        ]
      : [],
});
