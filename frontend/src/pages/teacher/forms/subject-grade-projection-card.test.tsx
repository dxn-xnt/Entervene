// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SubjectGradeProjectionResponse } from "@/lib/teacher-interventions-api";
import { SubjectGradeProjectionCard } from "./subject-grade-projection-card";

afterEach(cleanup);

const unavailableProjection: SubjectGradeProjectionResponse = {
  status: "UNAVAILABLE",
  grade_representation: "TRANSMUTED_TERM_GRADE",
  current_initial_grade: null,
  current_subject_grade: null,
  passing_threshold: 85,
  current_reaches_passing_threshold: null,
  target_projections: [
    {
      assignment_id: 7,
      title: "Geometry in My Surroundings",
      component: "PERFORMANCE_TASK",
      original_score: 20,
      current_effective_score: 20,
      max_points: 50,
      cap_percentage: 85,
      maximum_hypothetical_effective_score: 42.5,
      possible_score_gain: 22.5,
      applied: true,
      projected_initial_grade: null,
      projected_subject_grade: null,
      step_subject_grade_improvement: null,
      possible_grade_improvement: null,
      reaches_passing_threshold: null,
      unavailable_reasons: [
        {
          code: "INCOMPLETE_EXAMINATION_EVIDENCE",
          message: "Complete examination evidence is required.",
          missing_evidence: ["Summative 1", "Summative 2", "Term Examination"],
        },
      ],
    },
  ],
  eligible_target_gains: [],
  additional_eligible_targets_have_positive_improvement: false,
  recommended_target_assignment_id: 7,
  assumptions: [],
  unavailable_reasons: [
    {
      code: "INCOMPLETE_EXAMINATION_EVIDENCE",
      message: "Complete examination evidence is required.",
      missing_evidence: ["Summative 1", "Summative 2", "Term Examination"],
    },
  ],
  ai_midterm_what_if: {
    status: "AVAILABLE",
    estimate_kind: "AI_MIDTERM_WHAT_IF_ESTIMATE",
    is_official_grade: false,
    is_guaranteed: false,
    model_version_id: 3,
    model_name: "random_forest",
    prediction_purpose: "CURRENT_TERM_FINAL_GRADE_PROJECTION",
    evidence_basis: "LIVE_ACTUAL_EVIDENCE_WITH_EPHEMERAL_CAPPED_WW_PT_OVERRIDES",
    baseline_predicted_term_grade: 82.9,
    readiness: {},
    target_estimates: [
      {
        assignment_id: 7,
        maximum_hypothetical_effective_score: 42.5,
        hypothetical_predicted_term_grade: 82.8,
        step_estimated_difference: -0.1,
        estimated_difference_from_baseline: -0.1,
      },
    ],
    unavailable_reasons: [],
    limitations: [],
  },
};

describe("SubjectGradeProjectionCard", () => {
  it("shows score bounds instead of inventing an official grade when examination evidence is missing", () => {
    render(
      <SubjectGradeProjectionCard
        projection={unavailableProjection}
        selectedTargetIds={[7]}
        capPercentage={85}
        gradeTreatment="PERFORMANCE_TASK"
      />,
    );

    expect(screen.getByText("Classwork Score Adjustment")).toBeDefined();
    expect(screen.getByText("Overall Grade Preview Unavailable")).toBeDefined();
    expect(screen.getByText("85% Target-Score Ceiling")).toBeDefined();
    expect(screen.getByText("20/50")).toBeDefined();
    expect(screen.getByText("42.5/50")).toBeDefined();
    expect(screen.getByText("+22.5 pts")).toBeDefined();
    expect(screen.getByText(/Some required grades have not been recorded yet/)).toBeDefined();
    expect(screen.getByText(/Summative 1, Summative 2, Term Examination/)).toBeDefined();
    expect(screen.queryByText("Official Projection Unavailable")).toBeNull();
    expect(screen.queryByText("Projected Subject Grade")).toBeNull();
  });

  it("keeps a non-monotonic AI estimate secondary and explains that it cannot reduce the actual grade", () => {
    render(
      <SubjectGradeProjectionCard
        projection={unavailableProjection}
        selectedTargetIds={[7]}
        capPercentage={85}
        gradeTreatment="PERFORMANCE_TASK"
      />,
    );

    expect(screen.getByText("Provisional AI Advisory")).toBeDefined();
    expect(screen.getByText("Not an Official Grade")).toBeDefined();
    expect(screen.getByText("82.9%")).toBeDefined();
    expect(screen.getByText("82.8%")).toBeDefined();
    expect(screen.getByText("Model variation -0.1%")).toBeDefined();
    expect(screen.getByText(/may increase or decrease/)).toBeDefined();
    expect(screen.getByText(/does not calculate or reduce the student's actual grade/)).toBeDefined();
  });

  it("normalizes negative zero in advisory differences", () => {
    const projection = structuredClone(unavailableProjection);
    projection.ai_midterm_what_if.target_estimates[0].estimated_difference_from_baseline = -0.04;
    projection.ai_midterm_what_if.target_estimates[0].step_estimated_difference = -0.04;

    render(
      <SubjectGradeProjectionCard
        projection={projection}
        selectedTargetIds={[7]}
        capPercentage={85}
        gradeTreatment="PERFORMANCE_TASK"
      />,
    );

    expect(screen.getByText("Model variation 0.0%")).toBeDefined();
    expect(screen.queryByText(/-0\.0%/)).toBeNull();
  });

  it("prioritizes the deterministic subject-grade projection when complete evidence exists", () => {
    const projection = structuredClone(unavailableProjection);
    projection.status = "AVAILABLE";
    projection.current_initial_grade = 80;
    projection.current_subject_grade = 82;
    projection.current_reaches_passing_threshold = false;
    projection.unavailable_reasons = [];
    projection.target_projections[0].projected_initial_grade = 84;
    projection.target_projections[0].projected_subject_grade = 86;
    projection.target_projections[0].step_subject_grade_improvement = 4;
    projection.target_projections[0].possible_grade_improvement = 4;
    projection.target_projections[0].reaches_passing_threshold = true;
    projection.target_projections[0].unavailable_reasons = [];

    render(
      <SubjectGradeProjectionCard
        projection={projection}
        selectedTargetIds={[7]}
        capPercentage={85}
        gradeTreatment="PERFORMANCE_TASK"
      />,
    );

    expect(screen.getByText("Projected Subject Grade")).toBeDefined();
    expect(screen.getByText("Authoritative")).toBeDefined();
    expect(screen.getAllByText("82.0%").length).toBeGreaterThan(0);
    expect(screen.getByText("86.0%")).toBeDefined();
    expect(screen.getByText("Reaches Passing")).toBeDefined();
    expect(screen.getByText("Provisional AI Advisory")).toBeDefined();
  });
});
