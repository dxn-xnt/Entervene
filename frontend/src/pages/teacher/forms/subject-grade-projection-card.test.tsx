// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatPassingStatusMessage,
  type SubjectGradeProjectionResponse,
} from "@/lib/teacher-interventions-api";
import { SubjectGradeProjectionCard } from "./subject-grade-projection-card";

afterEach(cleanup);

const baseProjection: SubjectGradeProjectionResponse = {
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
      cap_percentage: 75,
      maximum_hypothetical_effective_score: 37.5,
      possible_score_gain: 17.5,
      applied: true,
      projected_initial_grade: null,
      projected_subject_grade: null,
      step_subject_grade_improvement: null,
      possible_grade_improvement: null,
      reaches_passing_threshold: null,
      unavailable_reasons: [],
    },
  ],
  eligible_target_gains: [],
  additional_eligible_targets_have_positive_improvement: false,
  recommended_target_assignment_id: 7,
  assumptions: [],
  unavailable_reasons: [],
  ai_midterm_what_if: {
    status: "AVAILABLE",
    estimate_kind: "AI_MIDTERM_WHAT_IF_ESTIMATE",
    is_official_grade: false,
    is_guaranteed: false,
    model_version_id: 3,
    model_name: "random_forest",
    prediction_purpose: "CURRENT_TERM_FINAL_GRADE_PROJECTION",
    evidence_basis: "LIVE_ACTUAL_EVIDENCE_WITH_EPHEMERAL_CAPPED_WW_PT_OVERRIDES",
    baseline_predicted_term_grade: 83.0,
    unremediated_baseline_predicted_term_grade: 83.0,
    selected_grade_ceiling: 85,
    effective_grade_ceiling: 85,
    baseline_remediation_adjusted_predicted_term_grade: 83.0,
    baseline_was_ceiling_applied: false,
    readiness: {},
    target_estimates: [
      {
        assignment_id: 7,
        maximum_hypothetical_effective_score: 37.5,
        hypothetical_predicted_term_grade: 84.2,
        raw_hypothetical_predicted_term_grade: 84.2,
        remediation_adjusted_predicted_term_grade: 84.2,
        applied_grade_ceiling: 85,
        was_ceiling_applied: false,
        step_estimated_difference: 1.2,
        estimated_difference_from_baseline: 1.2,
        capped_step_estimated_difference: 1.2,
        capped_estimated_difference_from_baseline: 1.2,
      },
    ],
    unavailable_reasons: [],
    limitations: [],
  },
};

describe("SubjectGradeProjectionCard", () => {
  it("shows Before, After Remediation, and short still-below-passing status for valid sub-passing previews", () => {
    render(
      <SubjectGradeProjectionCard
        projection={baseProjection}
        selectedTargetIds={[7]}
        capPercentage={75}
        gradeTreatment="PERFORMANCE_TASK"
      />,
    );

    const scoreHeading = screen.getByText("Classwork score adjustment");
    const beforeLabel = screen.getByText("Before");
    expect(scoreHeading.compareDocumentPosition(beforeLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("20/50")).toBeDefined();
    expect(screen.getByText("37.5/50")).toBeDefined();
    expect(screen.getByText("+17.5 pts")).toBeDefined();
    expect(screen.getByText("Before")).toBeDefined();
    expect(screen.getByText("After Remediation")).toBeDefined();
    expect(screen.getByText("83.0")).toBeDefined();
    expect(screen.getByText("84.2")).toBeDefined();
    expect(screen.getByText("Still below passing (85)")).toBeDefined();
    expect(screen.getByText("Preview only. Final result still depends on the student's actual remediation score.")).toBeDefined();
  });

  it("displays remediation-adjusted 85 projection without prominently showing raw uncapped RF output", () => {
    const cappedProjection = structuredClone(baseProjection);
    cappedProjection.ai_midterm_what_if.target_estimates[0] = {
      ...cappedProjection.ai_midterm_what_if.target_estimates[0],
      hypothetical_predicted_term_grade: 88.9,
      raw_hypothetical_predicted_term_grade: 88.9,
      remediation_adjusted_predicted_term_grade: 85.0,
      applied_grade_ceiling: 85,
      was_ceiling_applied: true,
    };

    render(
      <SubjectGradeProjectionCard
        projection={cappedProjection}
        selectedTargetIds={[7]}
        capPercentage={85}
        gradeTreatment="PERFORMANCE_TASK"
      />,
    );

    expect(screen.getByText("83.0")).toBeDefined();
    expect(screen.getByText("85.0")).toBeDefined();
    expect(screen.getByText("Reaches passing (85)")).toBeDefined();
    expect(screen.queryByText(/88\.9/)).toBeNull();
    expect(screen.queryByText(/Random Forest/i)).toBeNull();
  });

  it("uses the configured passing threshold rather than hardcoding 85", () => {
    const customThresholdProjection = structuredClone(baseProjection);
    customThresholdProjection.passing_threshold = 75;

    render(
      <SubjectGradeProjectionCard
        projection={customThresholdProjection}
        selectedTargetIds={[7]}
        capPercentage={75}
        gradeTreatment="PERFORMANCE_TASK"
      />,
    );

    expect(screen.getByText("Reaches passing (75)")).toBeDefined();
    expect(formatPassingStatusMessage(84.2, 85)).toBe("Still below passing (85)");
    expect(formatPassingStatusMessage(84.2, 75)).toBe("Reaches passing (75)");
    expect(formatPassingStatusMessage(null, 85)).toBeNull();
  });

  it("preserves legacy plans that lack remediation_adjusted fields", () => {
    const legacyProjection = structuredClone(baseProjection);
    delete legacyProjection.ai_midterm_what_if.baseline_remediation_adjusted_predicted_term_grade;
    delete legacyProjection.ai_midterm_what_if.selected_grade_ceiling;
    delete legacyProjection.ai_midterm_what_if.target_estimates[0].remediation_adjusted_predicted_term_grade;
    legacyProjection.ai_midterm_what_if.target_estimates[0].hypothetical_predicted_term_grade = 88.3;

    render(
      <SubjectGradeProjectionCard
        projection={legacyProjection}
        selectedTargetIds={[7]}
        capPercentage={85}
        gradeTreatment="PERFORMANCE_TASK"
      />,
    );

    expect(screen.getByText("83.0")).toBeDefined();
    expect(screen.getByText("88.3")).toBeDefined();
    expect(screen.getByText("Reaches passing (85)")).toBeDefined();
  });

  it("renders Before, After Remediation, and passing status for EXAMINATION treatment", () => {
    const examProjection = structuredClone(baseProjection);
    examProjection.target_projections = [];
    examProjection.ai_midterm_what_if.target_estimates = [
      {
        assignment_id: 202,
        maximum_hypothetical_effective_score: 50,
        hypothetical_predicted_term_grade: 89.4,
        raw_hypothetical_predicted_term_grade: 89.4,
        remediation_adjusted_predicted_term_grade: 85.0,
        applied_grade_ceiling: 85,
        was_ceiling_applied: true,
        step_estimated_difference: 6.4,
        estimated_difference_from_baseline: 6.4,
        capped_step_estimated_difference: 2.0,
        capped_estimated_difference_from_baseline: 2.0,
      },
    ];

    render(
      <SubjectGradeProjectionCard
        projection={examProjection}
        selectedTargetIds={[202]}
        gradeTreatment="EXAMINATION"
      />,
    );

    expect(screen.getByText("Remedial exam")).toBeDefined();
    expect(screen.getByText("Before")).toBeDefined();
    expect(screen.getByText("After Remediation")).toBeDefined();
    expect(screen.getByText("83.0")).toBeDefined();
    expect(screen.getByText("85.0")).toBeDefined();
    expect(screen.getByText("Reaches passing (85)")).toBeDefined();
    expect(screen.queryByText(/89\.4/)).toBeNull();
  });

  it("shows explicit unavailable warning instead of fabricating a grade when AI what-if is unavailable", () => {
    const unavailableAi = structuredClone(baseProjection);
    unavailableAi.ai_midterm_what_if = {
      ...unavailableAi.ai_midterm_what_if,
      status: "UNAVAILABLE",
      baseline_predicted_term_grade: null,
      baseline_remediation_adjusted_predicted_term_grade: null,
      target_estimates: [],
      unavailable_reasons: [
        { code: "UNREMEDIATED_BASELINE_UNAVAILABLE", message: "Baseline unavailable." },
      ],
    };

    render(
      <SubjectGradeProjectionCard
        projection={unavailableAi}
        selectedTargetIds={[7]}
        capPercentage={75}
        gradeTreatment="PERFORMANCE_TASK"
      />,
    );

    expect(screen.getByText("Prediction preview is currently unavailable for this student.")).toBeDefined();
    expect(screen.queryByText("Reaches passing (85)")).toBeNull();
    expect(screen.queryByText("Still below passing (85)")).toBeNull();
  });
});
