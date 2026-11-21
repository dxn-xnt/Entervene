export type QuizResultsReleasePolicy =
  | "HIDDEN"
  | "IMMEDIATE"
  | "AFTER_DUE_DATE"
  | "SCHEDULED";

export type LegacyQuizReleaseMode =
  | "IMMEDIATE"
  | "SCHEDULED"
  | "AFTER_DUE_DATE"
  | "NEVER";

export function quizResultsReleasePolicyFromLegacy(
  showScores: boolean,
  showCorrectAnswers: boolean,
  mode: LegacyQuizReleaseMode,
  scheduledAt?: string | null,
): QuizResultsReleasePolicy {
  if (!showScores || !showCorrectAnswers || mode === "NEVER") return "HIDDEN";
  void scheduledAt;
  return mode;
}

export function legacyQuizReleaseSettings(
  policy: QuizResultsReleasePolicy,
  currentScheduledAt = "",
): {
  showResults: boolean;
  mode: LegacyQuizReleaseMode;
  scheduledAt: string;
} {
  if (policy === "HIDDEN") {
    return { showResults: false, mode: "NEVER", scheduledAt: "" };
  }
  return {
    showResults: true,
    mode: policy,
    scheduledAt: policy === "SCHEDULED" ? currentScheduledAt : "",
  };
}
