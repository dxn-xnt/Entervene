import type { SubjectGradeProjectionResponse } from "@/lib/teacher-interventions-api";

export type RemediationProgressState =
  | "NO_ACTIVITY"
  | "WAITING_FOR_STUDENT"
  | "NEEDS_GRADING"
  | "EVALUATING_RESULT"
  | "CAN_ADD_ANOTHER"
  | "PASSING_RESULT"
  | "NO_ELIGIBLE_TARGET"
  | "PERIOD_FINALIZED"
  | "RESULT_UNAVAILABLE";

interface ActivityState {
  submission_status: string | null;
  grade: number | null;
}

export function remediationProgressState({
  interventionStatus,
  activities,
  outcome,
  outcomeLoading,
}: {
  interventionStatus: string;
  activities: ActivityState[];
  outcome: SubjectGradeProjectionResponse | null;
  outcomeLoading: boolean;
}): RemediationProgressState {
  if (activities.length === 0) return "NO_ACTIVITY";
  const pending = activities.filter(
    (activity) => activity.submission_status !== "graded" || activity.grade == null,
  );
  if (pending.length > 0) {
    return pending.some((activity) => activity.submission_status === "submitted")
      ? "NEEDS_GRADING"
      : "WAITING_FOR_STUDENT";
  }
  if (outcomeLoading) return "EVALUATING_RESULT";
  if (!outcome) return "RESULT_UNAVAILABLE";
  if (outcome.status === "FINALIZED") return "PERIOD_FINALIZED";
  if (outcome.status === "AVAILABLE" && outcome.current_reaches_passing_threshold === true) {
    return "PASSING_RESULT";
  }
  if (
    interventionStatus === "ACTIVE"
    && outcome.additional_eligible_targets_have_positive_improvement
  ) {
    return "CAN_ADD_ANOTHER";
  }
  return "NO_ELIGIBLE_TARGET";
}

export const remediationProgressMessage: Record<RemediationProgressState, string> = {
  NO_ACTIVITY: "Select a classwork to begin remediation.",
  WAITING_FOR_STUDENT: "Waiting for the student to complete the activity.",
  NEEDS_GRADING: "Grade the activity to evaluate the result.",
  EVALUATING_RESULT: "Evaluating the graded remediation result.",
  CAN_ADD_ANOTHER: "The graded result has been applied. Another eligible classwork can still benefit from remediation.",
  PASSING_RESULT: "The official subject grade meets the passing threshold. Additional remediation is unnecessary.",
  NO_ELIGIBLE_TARGET: "No unused eligible classwork has a positive possible improvement.",
  PERIOD_FINALIZED: "The academic period grade is finalized. Another remediation activity cannot be created.",
  RESULT_UNAVAILABLE: "The graded result could not be evaluated. Refresh the support plan and try again.",
};
