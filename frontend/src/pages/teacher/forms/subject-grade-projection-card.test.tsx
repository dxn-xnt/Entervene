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
        hypothetical_predicted_term_grade: 88.3,
        step_estimated_difference: 5.4,
        estimated_difference_from_baseline: 5.4,
      },
    ],
    unavailable_reasons: [],
    limitations: [],
  },
};

describe("SubjectGradeProjectionCard", () => {
  it("shows only the essential score and AI values in scan order", () => {
    render(
      <SubjectGradeProjectionCard
        projection={unavailableProjection}
        selectedTargetIds={[7]}
        capPercentage={85}
        gradeTreatment="PERFORMANCE_TASK"
      />,
    );

    const scoreHeading = screen.getByText("Classwork score adjustment");
    const predictionHeading = screen.getByText("AI prediction");
    expect(scoreHeading.compareDocumentPosition(predictionHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Original score")).toBeDefined();
    expect(screen.getByText("Max score after remediation")).toBeDefined();
    expect(screen.getByText("Possible gain")).toBeDefined();
    expect(screen.getByText("20/50")).toBeDefined();
    expect(screen.getByText("42.5/50")).toBeDefined();
    expect(screen.getByText("+22.5 pts")).toBeDefined();
    expect(screen.getByText("Current AI prediction")).toBeDefined();
    expect(screen.getByText("Predicted AI result at max score")).toBeDefined();
    expect(screen.getByText("82.9%")).toBeDefined();
    expect(screen.getByText("88.3%")).toBeDefined();
    expect(screen.getByText("Preview only. Final result still depends on the student's actual remediation score.")).toBeDefined();
  });

  it("removes technical and repetitive grade-system explanations", () => {
    render(
      <SubjectGradeProjectionCard
        projection={unavailableProjection}
        selectedTargetIds={[7]}
        capPercentage={85}
        gradeTreatment="PERFORMANCE_TASK"
      />,
    );

    expect(screen.queryByText(/official/i)).toBeNull();
    expect(screen.queryByText(/Random Forest/i)).toBeNull();
    expect(screen.queryByText(/missing:/i)).toBeNull();
    expect(screen.queryByText(/passing/i)).toBeNull();
    expect(screen.queryByText(/predicted change/i)).toBeNull();
  });

  it("does not add the deterministic subject-grade panel when complete evidence exists", () => {
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

    expect(screen.queryByText("Projected Subject Grade")).toBeNull();
    expect(screen.queryByText("Authoritative")).toBeNull();
    expect(screen.queryByText("82.0%")).toBeNull();
    expect(screen.queryByText("86.0%")).toBeNull();
    expect(screen.getByText("Current AI prediction")).toBeDefined();
    expect(screen.getByText("Predicted AI result at max score")).toBeDefined();
  });
});
