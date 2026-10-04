import type {
  QuizQuestionDraft,
  QuizQuestionType,
  QuizOptionDraft,
  QuizDifficulty,
} from "./quiz-builder-types";

/**
 * Checks whether a question is unkeyed (missing required answer keys).
 * - MULTIPLE_CHOICE: true if no options or no option has is_correct === true.
 * - IDENTIFICATION: true if no options or no option has a non-blank option_text.
 * - SHORT_ANSWER: always false (SHORT_ANSWER is open-ended and never requires an answer key).
 */
export function isUnkeyed(question: {
  question_type: string;
  options?: Array<{ option_text?: string; is_correct?: boolean }>;
}): boolean {
  const type = (question.question_type || "").trim().toUpperCase();
  if (type === "MULTIPLE_CHOICE") {
    const opts = question.options || [];
    return opts.length === 0 || !opts.some((o) => Boolean(o.is_correct));
  }
  if (type === "IDENTIFICATION") {
    const opts = question.options || [];
    return (
      opts.length === 0 ||
      !opts.some((o) => Boolean(o.option_text && o.option_text.trim()))
    );
  }
  if (type === "SHORT_ANSWER") {
    return false;
  }
  return false;
}

/**
 * Normalizes a single question loaded from the API / legacy payloads:
 * If question_type is SHORT_ANSWER but it has at least one non-blank option key,
 * coerce it to IDENTIFICATION with is_correct = true on its options.
 * This mirrors the backend coercion in QuizBuilderService._coerce_legacy_short_answer_questions.
 */
export function normalizeIncomingQuestion<
  T extends {
    question_type: string;
    options?: Array<{ option_text?: string; is_correct?: boolean; [key: string]: unknown }>;
    [key: string]: unknown;
  }
>(question: T): T {
  const type = (question.question_type || "").trim().toUpperCase();
  if (type === "SHORT_ANSWER") {
    const hasNonBlankKey = question.options?.some(
      (opt) => Boolean(opt.option_text && opt.option_text.trim())
    );
    if (hasNonBlankKey) {
      return {
        ...question,
        question_type: "IDENTIFICATION",
        options: question.options?.map((opt) => ({
          ...opt,
          is_correct: true,
        })),
      };
    } else {
      return {
        ...question,
        options: [],
      };
    }
  }
  return question;
}

/**
 * Normalizes an array of questions loaded from the API or import.
 */
export function normalizeIncomingQuestions<
  T extends {
    question_type: string;
    options?: Array<{ option_text?: string; is_correct?: boolean; [key: string]: unknown }>;
    [key: string]: unknown;
  }
>(questions: T[]): T[] {
  return questions.map(normalizeIncomingQuestion);
}

/**
 * Effective question type for student-facing screens. Uses normalizeIncomingQuestion so a legacy
 * SHORT_ANSWER that still carries answer keys is treated as IDENTIFICATION everywhere.
 */
export function getEffectiveQuestionType(question: {
  question_type: string;
  options?: Array<{ option_text?: string | null }> | null;
}): string {
  const normalized = normalizeIncomingQuestion({
    question_type: question.question_type,
    options: (question.options ?? []).map((o) => ({ option_text: o.option_text ?? undefined })),
  });
  return (normalized.question_type || "").trim().toUpperCase();
}

export interface PublishReadinessResult {
  is_publish_ready: boolean;
  canProceed: boolean;
  errors: string[];
  errorMessage?: string;
  unkeyedIdentificationCount: number;
}

/**
 * Checks publish-readiness mirroring backend validation:
 * Block publishing if any IDENTIFICATION question has no non-blank key.
 */
export function checkPublishReadiness(
  questions: Array<{
    question_type: string;
    options?: Array<{ option_text?: string; is_correct?: boolean }>;
  }>,
  isPublished = true
): PublishReadinessResult {
  const errors: string[] = [];
  let unkeyedIdentificationCount = 0;

  questions.forEach((q, idx) => {
    const questionNumber = idx + 1;
    const type = (q.question_type || "").trim().toUpperCase();

    if (type === "IDENTIFICATION") {
      const hasKey = (q.options || []).some(
        (opt) => Boolean(opt.option_text && opt.option_text.trim())
      );
      if (!hasKey) {
        unkeyedIdentificationCount++;
        errors.push(
          `Question ${questionNumber} is an Identification question with no answer key. Add at least one acceptable answer before publishing.`
        );
      }
    } else if (type === "MULTIPLE_CHOICE") {
      const opts = q.options || [];
      const filled = opts.filter((o) => Boolean(o.option_text && o.option_text.trim()));
      const correct = opts.filter((o) => Boolean(o.is_correct));
      if (opts.length < 2 || filled.length < 2) {
        errors.push(`Question ${questionNumber} needs at least two answer choices.`);
      }
      if (correct.length !== 1) {
        errors.push(`Question ${questionNumber} needs exactly one correct answer.`);
      }
    }
    // SHORT_ANSWER requires no answer key and is always publish-ready with regards to keys.
  });

  const isPublishReady = errors.length === 0 && unkeyedIdentificationCount === 0;
  const canProceed = isPublished ? isPublishReady : true;

  let errorMessage: string | undefined;
  if (isPublished && unkeyedIdentificationCount > 0) {
    errorMessage = `${unkeyedIdentificationCount} identification question(s) need at least one non-blank answer key before publishing.`;
  } else if (isPublished && errors.length > 0) {
    errorMessage = errors[0];
  }

  return {
    is_publish_ready: isPublishReady,
    canProceed,
    errors,
    errorMessage,
    unkeyedIdentificationCount,
  };
}

export interface SwitchTypeOptions {
  confirmOverwrite?: () => boolean;
}

/**
 * Switches a question's type while preserving data:
 * - IDENTIFICATION to SHORT_ANSWER: moves the first key into the sample-answer (explanation)
 *   field if empty. If explanation already has content, calls confirmOverwrite() (defaulting to true)
 *   before overwriting. Clears options to [].
 * - SHORT_ANSWER to IDENTIFICATION: starts with an empty key option and keeps the explanation.
 * - Transitions to/from MULTIPLE_CHOICE ensure valid default options without losing explanation.
 */
export function switchQuestionType(
  question: QuizQuestionDraft,
  targetType: QuizQuestionType,
  options?: SwitchTypeOptions
): QuizQuestionDraft {
  const currentType = question.question_type;
  if (currentType === targetType) {
    return question;
  }

  let nextExplanation = question.explanation;
  let nextOptions: QuizOptionDraft[] = [];

  if (currentType === "IDENTIFICATION" && targetType === "SHORT_ANSWER") {
    const firstKey =
      question.options.find((o) => o.option_text.trim().length > 0)?.option_text.trim() ||
      question.options[0]?.option_text.trim() ||
      "";

    if (firstKey) {
      if (!nextExplanation || !nextExplanation.trim()) {
        nextExplanation = firstKey;
      } else {
        const allow = options?.confirmOverwrite ? options.confirmOverwrite() : true;
        if (allow) {
          nextExplanation = firstKey;
        }
      }
    }
    nextOptions = [];
  } else if (currentType === "SHORT_ANSWER" && targetType === "IDENTIFICATION") {
    // Keep explanation intact, start with an empty key
    nextOptions = [{ option_text: "", is_correct: true, option_order: 1 }];
  } else if (targetType === "IDENTIFICATION") {
    // From MULTIPLE_CHOICE to IDENTIFICATION: take the correct option if available, otherwise first option or empty
    const correctOpt = question.options.find((o) => o.is_correct && o.option_text.trim());
    const firstOpt = question.options.find((o) => o.option_text.trim());
    const initialText = correctOpt?.option_text.trim() || firstOpt?.option_text.trim() || "";
    nextOptions = [{ option_text: initialText, is_correct: true, option_order: 1 }];
  } else if (targetType === "SHORT_ANSWER") {
    nextOptions = [];
  } else if (targetType === "MULTIPLE_CHOICE") {
    if (question.options.length >= 2) {
      nextOptions = question.options.map((o, idx) => ({
        option_text: o.option_text,
        is_correct: idx === 0 ? true : Boolean(o.is_correct),
        option_order: idx + 1,
      }));
      if (!nextOptions.some((o) => o.is_correct)) {
        nextOptions[0].is_correct = true;
      }
    } else if (question.options.length === 1) {
      nextOptions = [
        { option_text: question.options[0].option_text, is_correct: true, option_order: 1 },
        { option_text: "", is_correct: false, option_order: 2 },
      ];
    } else {
      nextOptions = [
        { option_text: "", is_correct: true, option_order: 1 },
        { option_text: "", is_correct: false, option_order: 2 },
      ];
    }
  }

  return {
    ...question,
    question_type: targetType,
    explanation: nextExplanation,
    options: nextOptions,
  };
}

export interface GeneratedQuestionPayload {
  question_text?: string;
  question_type?: QuizQuestionType;
  points?: number;
  display_order?: number;
  difficulty_level?: QuizDifficulty;
  explanation?: string | null;
  options?: Array<{
    option_text: string;
    is_correct: boolean;
    option_order?: number;
  }>;
}

/**
 * Maps raw questions returned by the AI quiz generation endpoint into QuizQuestionDraft items.
 * Ensures:
 * - IDENTIFICATION options are mapped to key options with is_correct: true
 * - SHORT_ANSWER options are empty ([]), explanation holds sample answer/rubric
 * - is_ai_generated is explicitly set to true
 */
export function mapGeneratedQuizQuestions(
  apiQuestions: GeneratedQuestionPayload[]
): QuizQuestionDraft[] {
  return (apiQuestions || []).map((q, idx) => ({
    id: `ai-q-${Date.now()}-${idx + 1}`,
    lesson_id: null,
    question_text: q.question_text || `Question ${idx + 1}`,
    question_type: q.question_type || "MULTIPLE_CHOICE",
    points: String(q.points ?? 1),
    display_order: idx + 1,
    difficulty_level: q.difficulty_level || "EASY",
    explanation: q.explanation || "",
    is_ai_generated: true,
    options:
      q.question_type === "MULTIPLE_CHOICE"
        ? (q.options ?? []).map((opt, oIdx) => ({
            option_text: opt.option_text || `Option ${oIdx + 1}`,
            is_correct: Boolean(opt.is_correct),
            option_order: opt.option_order ?? oIdx + 1,
          }))
        : q.question_type === "IDENTIFICATION"
        ? (q.options && q.options.length > 0
            ? q.options.map((opt, oIdx) => ({
                option_text: opt.option_text || "",
                is_correct: true,
                option_order: opt.option_order ?? oIdx + 1,
              }))
            : [{ option_text: "", is_correct: true, option_order: 1 }])
        : [],
  }));
}

