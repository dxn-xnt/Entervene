export type QuizQuestionType = "MULTIPLE_CHOICE" | "SHORT_ANSWER";
export type QuizDifficulty = "EASY" | "MEDIUM" | "HARD";

export type QuizOptionDraft = {
  option_text: string;
  is_correct: boolean;
  option_order: number;
};

export type QuizQuestionDraft = {
  id: string;
  question_text: string;
  question_type: QuizQuestionType;
  points: string;
  display_order: number;
  difficulty_level: QuizDifficulty;
  explanation: string;
  options: QuizOptionDraft[];
};

export type QuizSettingsDraft = {
  is_shuffle_questions: boolean;
  enable_per_question_scoring: boolean;
  enable_per_question_time_limits: boolean;
  max_attempts: string;
  show_correct_answers: boolean;
  duration_minutes: string;
};

export type QuizQuestionAnalysis = {
  quiz_question_id: number;
  question_text: string;
  question_type: string;
  points: number;
  answered_count: number;
  correct_count: number;
  accuracy_percent?: number | null;
  needs_grading_count: number;
  option_distribution: Array<{
    option_id: number;
    option_text: string;
    is_correct: boolean;
    selected_count: number;
  }>;
};

export type QuizStudentScore = {
  student_id: string;
  student_name: string;
  status: string;
  attempt_count: number;
  grade?: number | null;
  score_percent?: number | null;
  submitted_at?: string | null;
  needs_grading: boolean;
};

export type QuizAnalysis = {
  quiz_id: number;
  classwork_id: number;
  title: string;
  total_points?: number | null;
  total_students: number;
  submitted_count: number;
  missing_count: number;
  graded_count: number;
  needs_grading_count: number;
  average_score?: number | null;
  class_accuracy_percent?: number | null;
  questions: QuizQuestionAnalysis[];
  students: QuizStudentScore[];
};

export type QuizImportPreview = {
  title?: string | null;
  instructions?: string | null;
  questions: Array<{
    question_text: string;
    question_type: QuizQuestionType;
    points: number;
    display_order: number;
    difficulty_level?: QuizDifficulty | null;
    explanation?: string | null;
    options: QuizOptionDraft[];
  }>;
  warnings: string[];
};
