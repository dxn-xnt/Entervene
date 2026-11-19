import { describe, expect, it } from "vitest";
import type { SubjectGradeProjectionResponse } from "@/lib/teacher-interventions-api";
import { remediationProgressState } from "./remediation-progress-status";

const outcome = (overrides: Partial<SubjectGradeProjectionResponse> = {}) => ({
  status: "UNAVAILABLE",
  grade_representation: "TRANSMUTED_TERM_GRADE",
  current_reaches_passing_threshold: null,
  target_projections: [],
  eligible_target_gains: [],
  additional_eligible_targets_have_positive_improvement: true,
  assumptions: [],
  unavailable_reasons: [],
  ai_midterm_what_if: {
    status: "UNAVAILABLE",
    estimate_kind: "AI_MIDTERM_WHAT_IF_ESTIMATE",
    is_official_grade: false,
    is_guaranteed: false,
    prediction_purpose: "CURRENT_TERM_FINAL_GRADE_PROJECTION",
    evidence_basis: "LIVE_ACTUAL_EVIDENCE_WITH_EPHEMERAL_CAPPED_WW_PT_OVERRIDES",
    readiness: {},
    target_estimates: [],
    unavailable_reasons: [],
    limitations: [],
  },
  ...overrides,
}) as SubjectGradeProjectionResponse;

const state = (
  activities: Array<{ submission_status: string | null; grade: number | null }>,
  result: SubjectGradeProjectionResponse | null = null,
) => remediationProgressState({
  interventionStatus: "ACTIVE",
  activities,
  outcome: result,
  outcomeLoading: false,
});

describe("remediationProgressState", () => {
  it("guides initial, pending, and submitted activities", () => {
    expect(state([])).toBe("NO_ACTIVITY");
    expect(state([{ submission_status: null, grade: null }])).toBe("WAITING_FOR_STUDENT");
    expect(state([{ submission_status: "submitted", grade: null }])).toBe("NEEDS_GRADING");
  });

  it("allows another target after grading even when official grade evidence is missing", () => {
    expect(state([{ submission_status: "graded", grade: 8 }], outcome())).toBe("CAN_ADD_ANOTHER");
  });

  it("blocks another target when no positive unused target remains", () => {
    expect(state(
      [{ submission_status: "graded", grade: 8 }],
      outcome({ additional_eligible_targets_have_positive_improvement: false }),
    )).toBe("NO_ELIGIBLE_TARGET");
  });

  it("blocks unnecessary remediation after an official passing result", () => {
    expect(state(
      [{ submission_status: "graded", grade: 8 }],
      outcome({ status: "AVAILABLE", current_reaches_passing_threshold: true }),
    )).toBe("PASSING_RESULT");
  });
});
