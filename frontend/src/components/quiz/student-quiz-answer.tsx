import { Input } from "@/components/retroui/Input";
import { getEffectiveQuestionType } from "@/pages/teacher/classworks/quiz-question-rules";

/**
 * Shared answer widgets for every student-facing quiz screen
 * (quiz-interface.tsx, subject-classwork-tab.tsx, subject-lesson-tab.tsx).
 */

export const IDENTIFICATION_PLACEHOLDER = "Type your answer";
export const SHORT_ANSWER_PLACEHOLDER = "Write your response";

type AnswerableQuestion = {
  question_type: string;
  options?: Array<{ option_text?: string | null; is_correct?: boolean | null }> | null;
};

type TextAnswerInputProps = {
  question: AnswerableQuestion;
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
};

/** IDENTIFICATION: single-line input. SHORT_ANSWER: textarea. */
export function QuizTextAnswerInput({ question, value, onChange, disabled }: TextAnswerInputProps) {
  if (getEffectiveQuestionType(question) === "IDENTIFICATION") {
    return (
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={IDENTIFICATION_PLACEHOLDER}
        disabled={disabled}
        className="w-full border-2 border-black bg-white p-4 text-base"
      />
    );
  }
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={SHORT_ANSWER_PLACEHOLDER}
      disabled={disabled}
      rows={4}
      className="w-full border-2 border-black bg-white p-4 text-sm resize-none"
    />
  );
}

type TextAnswerSummaryProps = {
  question: AnswerableQuestion & {
    answer_text?: string | null;
    is_correct?: boolean | null;
    points_awarded?: number | null;
    options?: Array<{ option_text?: string | null; is_correct?: boolean | null }> | null;
  };
};

/**
 * Result block for non-multiple-choice questions.
 * - "Expected answer" is only ever shown for IDENTIFICATION, and only when the server revealed the
 *   key (option.is_correct is non-null). SHORT_ANSWER never shows a sample answer or rubric.
 * - Status: Correct / Incorrect for auto-graded items, "Pending teacher review" for open-ended ones.
 */
export function QuizTextAnswerSummary({ question }: TextAnswerSummaryProps) {
  const type = getEffectiveQuestionType(question);
  const expected =
    type === "IDENTIFICATION"
      ? (question.options ?? []).find((o) => o.is_correct === true && (o.option_text ?? "").trim())
      : undefined;

  let status: { label: string; className: string };
  if (question.is_correct === true) {
    status = { label: "Marked correct", className: "font-bold text-green-700" };
  } else if (question.is_correct === false) {
    status = { label: "Incorrect", className: "font-bold text-red-700" };
  } else if (question.points_awarded !== null && question.points_awarded !== undefined) {
    status = { label: "Graded by teacher", className: "font-bold text-green-700" };
  } else {
    status = { label: "Pending teacher review", className: "font-bold text-amber-700" };
  }

  return (
    <div className="mt-3 space-y-2 text-sm">
      <div className="border border-primary bg-primary px-3 py-2 text-primary-foreground">
        <p className="text-xs font-bold uppercase">Your answer</p>
        <p className="mt-1 whitespace-pre-wrap break-words">
          {question.answer_text?.trim() || "No answer recorded."}
        </p>
      </div>
      {expected ? (
        <p className="border border-green-500 bg-green-50 px-3 py-2 font-semibold">
          Expected answer: {expected.option_text}
        </p>
      ) : null}
      <p className={status.className}>{status.label}</p>
    </div>
  );
}
