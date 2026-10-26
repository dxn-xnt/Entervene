// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SubjectGradeProjectionCard from "./subject-grade-projection-card";
import type { SubjectGradeProjectionResponse } from "@/lib/teacher-interventions-api";

describe("SubjectGradeProjectionCard unit tests", () => {
  afterEach(cleanup);

  const baseResponse: SubjectGradeProjectionResponse = {
    status: "AVAILABLE",
    grade_representation: "TRANSMUTED_TERM_GRADE",
    current_initial_grade: 68.5,
    current_subject_grade: 74.0,
    passing_threshold: 75.0,
    passing_threshold_policy: {
      academic_year_id: 1,
      source: "live_grading_template",
    },
    current_reaches_passing_threshold: false,
    target_projections: [
      {
        assignment_id: 101,
        title: "Worksheet 1",
        component: "WRITTEN_WORK",
        original_score: 10,
        current_effective_score: 10,
        max_points: 20,
        cap_percentage: 75,
        maximum_hypothetical_effective_score: 15,
        possible_score_gain: 5,
        applied: true,
        projected_initial_grade: 72.0,
        projected_subject_grade: 78.0,
        step_subject_grade_improvement: 4.0,
        possible_grade_improvement: 4.0,
        reaches_passing_threshold: true,
        unavailable_reasons: [],
      },
    ],
    eligible_target_gains: [
      {
        assignment_id: 101,
        title: "Worksheet 1",
        component: "WRITTEN_WORK",
        original_score: 10,
        current_effective_score: 10,
        max_points: 20,
        cap_percentage: 75,
        maximum_hypothetical_effective_score: 15,
        possible_score_gain: 5,
      },
    ],
    additional_eligible_targets_have_positive_improvement: false,
    recommended_target_assignment_id: 101,
    assumptions: ["Authoritative projection requires complete scored academic evidence."],
    unavailable_reasons: [],
    ai_midterm_what_if: {
      status: "UNAVAILABLE",
      estimate_kind: "AI_MIDTERM_WHAT_IF_ESTIMATE",
      is_official_grade: false,
      is_guaranteed: false,
      prediction_purpose: "CURRENT_TERM_FINAL_GRADE_PROJECTION",
      evidence_basis: "LIVE_ACTUAL_EVIDENCE_WITH_EPHEMERAL_CAPPED_WW_PT_OVERRIDES",
      baseline_predicted_term_grade: null,
      readiness: {},
      target_estimates: [],
      unavailable_reasons: [],
      limitations: [],
    },
  };

  it("1. Complete-evidence authoritative projection displays official grades and reaches passing mark", () => {
    render(
      <SubjectGradeProjectionCard
        projection={baseResponse}
        selectedTargetIds={[101]}
        capPercentage={75}
        gradeTreatment="WRITTEN_WORK"
      />
    );

    expect(screen.getByText("Projected Grade")).toBeTruthy();
    expect(screen.getByText("Authoritative")).toBeTruthy();
    expect(screen.getAllByText("74.0%").length).toBeGreaterThanOrEqual(1); // current
    expect(screen.getByText("78.0%")).toBeTruthy(); // projected
    expect(screen.getByText("+4.0%")).toBeTruthy(); // gain
    expect(screen.getByText("Reaches Passing")).toBeTruthy();
    expect(screen.getByText("75.0%")).toBeTruthy(); // passing threshold
    expect(
      screen.getByText(/Authoritative calculation based on official DepEd grading weights/i)
    ).toBeTruthy();
  });

  it("2. Midterm AI what-if displays exploratory notice and never claims official status", () => {
    const aiResponse: SubjectGradeProjectionResponse = {
      ...baseResponse,
      status: "UNAVAILABLE",
      current_subject_grade: null,
      unavailable_reasons: [
        { code: "INCOMPLETE_EXAMINATION_EVIDENCE", message: "Incomplete examination evidence." },
      ],
      ai_midterm_what_if: {
        status: "AVAILABLE",
        estimate_kind: "AI_MIDTERM_WHAT_IF_ESTIMATE",
        is_official_grade: false,
        is_guaranteed: false,
        model_name: "midterm-remediation-v1",
        prediction_purpose: "CURRENT_TERM_FINAL_GRADE_PROJECTION",
        evidence_basis: "LIVE_ACTUAL_EVIDENCE_WITH_EPHEMERAL_CAPPED_WW_PT_OVERRIDES",
        baseline_predicted_term_grade: 72.4,
        readiness: { ready: true },
        target_estimates: [
          {
            assignment_id: 101,
            maximum_hypothetical_effective_score: 15.0,
            hypothetical_predicted_term_grade: 76.8,
            step_estimated_difference: 4.4,
            estimated_difference_from_baseline: 4.4,
          },
        ],
        unavailable_reasons: [],
        limitations: ["Exploratory estimate"],
      },
    };

    render(
      <SubjectGradeProjectionCard
        projection={aiResponse}
        selectedTargetIds={[101]}
        capPercentage={75}
        gradeTreatment="WRITTEN_WORK"
      />
    );

    expect(screen.getByText("Provisional AI Estimate")).toBeTruthy();
    expect(screen.getAllByText("72.4%").length).toBeGreaterThanOrEqual(1); // baseline
    expect(screen.getByText("76.8%")).toBeTruthy(); // hypothetical
    expect(screen.getByText("+4.4%")).toBeTruthy(); // difference
    expect(screen.getByText("Est. Reaches Passing")).toBeTruthy();

    // Verify explicit disclaimer that it is NOT official or guaranteed
    expect(
      screen.getByText(/not an official grade or guaranteed result/i)
    ).toBeTruthy();
    expect(screen.queryByText("Authoritative")).toBeNull();
  });

  it("3. Supports multiple targets with cumulative sequence breakdown", () => {
    const multiTargetResponse: SubjectGradeProjectionResponse = {
      ...baseResponse,
      target_projections: [
        {
          assignment_id: 101,
          title: "Worksheet 1",
          component: "WRITTEN_WORK",
          original_score: 10,
          current_effective_score: 10,
          max_points: 20,
          cap_percentage: 80,
          maximum_hypothetical_effective_score: 16,
          possible_score_gain: 6,
          applied: true,
          projected_initial_grade: 72.0,
          projected_subject_grade: 77.0,
          step_subject_grade_improvement: 3.0,
          possible_grade_improvement: 3.0,
          reaches_passing_threshold: true,
          unavailable_reasons: [],
        },
        {
          assignment_id: 102,
          title: "Worksheet 2",
          component: "WRITTEN_WORK",
          original_score: 8,
          current_effective_score: 8,
          max_points: 20,
          cap_percentage: 80,
          maximum_hypothetical_effective_score: 16,
          possible_score_gain: 8,
          applied: true,
          projected_initial_grade: 75.0,
          projected_subject_grade: 80.0,
          step_subject_grade_improvement: 3.0,
          possible_grade_improvement: 6.0,
          reaches_passing_threshold: true,
          unavailable_reasons: [],
        },
      ],
    };

    render(
      <SubjectGradeProjectionCard
        projection={multiTargetResponse}
        selectedTargetIds={[101, 102]}
        capPercentage={80}
        gradeTreatment="WRITTEN_WORK"
      />
    );

    expect(screen.getAllByText("80.0%").length).toBeGreaterThanOrEqual(1); // Cumulative projected grade after both
    expect(screen.getAllByText(/\+6\.0/).length).toBeGreaterThanOrEqual(1); // Cumulative gain after both
    expect(screen.getByText(/Cumulative Target Sequence/i)).toBeTruthy();
    expect(screen.getByText(/Worksheet 1/)).toBeTruthy();
    expect(screen.getByText(/Worksheet 2/)).toBeTruthy();
  });

  it("4. Displays the correct saved cap percentage", () => {
    render(
      <SubjectGradeProjectionCard
        projection={baseResponse}
        selectedTargetIds={[101]}
        capPercentage={90}
        gradeTreatment="WRITTEN_WORK"
      />
    );

    expect(screen.getByText("90% Cap")).toBeTruthy();
  });

  it("5. Insufficient evidence shows Unavailable badge with reasons and fallbacks", () => {
    const unavailableResponse: SubjectGradeProjectionResponse = {
      ...baseResponse,
      status: "UNAVAILABLE",
      current_subject_grade: null,
      unavailable_reasons: [
        { code: "INCOMPLETE_EXAMINATION_EVIDENCE", message: "Incomplete examination evidence." },
      ],
      ai_midterm_what_if: {
        status: "UNAVAILABLE",
        estimate_kind: "AI_MIDTERM_WHAT_IF_ESTIMATE",
        is_official_grade: false,
        is_guaranteed: false,
        prediction_purpose: "CURRENT_TERM_FINAL_GRADE_PROJECTION",
        evidence_basis: "LIVE_ACTUAL_EVIDENCE_WITH_EPHEMERAL_CAPPED_WW_PT_OVERRIDES",
        baseline_predicted_term_grade: null,
        readiness: {},
        target_estimates: [],
        unavailable_reasons: [
          { code: "INSUFFICIENT_AVAILABLE_ACTIVITIES", message: "Insufficient activities." },
        ],
        limitations: [],
      },
      eligible_target_gains: [
        {
          assignment_id: 101,
          title: "Worksheet 1",
          component: "WRITTEN_WORK",
          original_score: 10,
          current_effective_score: 10,
          max_points: 20,
          cap_percentage: 75,
          maximum_hypothetical_effective_score: 15,
          possible_score_gain: 5,
        },
      ],
    };

    render(
      <SubjectGradeProjectionCard
        projection={unavailableResponse}
        selectedTargetIds={[]}
        capPercentage={75}
        gradeTreatment="WRITTEN_WORK"
      />
    );

    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.getByText(/Subject grade projection is unavailable for this student/i)).toBeTruthy();
    expect(screen.getByText(/Incomplete examination evidence/i)).toBeTruthy();
    expect(screen.getByText(/Worksheet 1/i)).toBeTruthy();
    expect(screen.getByText(/\+5\.0 pts/i)).toBeTruthy();
  });

  it("6. Does not fabricate improvement when AI difference is zero or negative", () => {
    const nonMonotonicAiResponse: SubjectGradeProjectionResponse = {
      ...baseResponse,
      status: "UNAVAILABLE",
      current_subject_grade: null,
      ai_midterm_what_if: {
        status: "AVAILABLE",
        estimate_kind: "AI_MIDTERM_WHAT_IF_ESTIMATE",
        is_official_grade: false,
        is_guaranteed: false,
        prediction_purpose: "CURRENT_TERM_FINAL_GRADE_PROJECTION",
        evidence_basis: "LIVE_ACTUAL_EVIDENCE_WITH_EPHEMERAL_CAPPED_WW_PT_OVERRIDES",
        baseline_predicted_term_grade: 75.0,
        readiness: { ready: true },
        target_estimates: [
          {
            assignment_id: 101,
            maximum_hypothetical_effective_score: 15.0,
            hypothetical_predicted_term_grade: 74.2,
            step_estimated_difference: -0.8,
            estimated_difference_from_baseline: -0.8,
          },
        ],
        unavailable_reasons: [],
        limitations: [],
      },
    };

    render(
      <SubjectGradeProjectionCard
        projection={nonMonotonicAiResponse}
        selectedTargetIds={[101]}
        capPercentage={75}
        gradeTreatment="WRITTEN_WORK"
      />
    );

    expect(screen.getByText("-0.8%")).toBeTruthy();
    expect(screen.queryByText("+0.8%")).toBeNull();
  });

  it("7. Ungraded support (PRACTICE_ONLY) displays Ungraded Support Treatment and does not present grade improvement", () => {
    render(
      <SubjectGradeProjectionCard
        projection={null}
        selectedTargetIds={[]}
        capPercentage={75}
        gradeTreatment="PRACTICE_ONLY"
      />
    );

    expect(screen.getByText("Practice Only")).toBeTruthy();
    expect(screen.getByText("Ungraded Support Treatment")).toBeTruthy();
    expect(screen.getByText(/does not alter classwork grades or academic projections/i)).toBeTruthy();
    expect(screen.queryByText(/Preview is pending official backend grade calculation/i)).toBeNull();
  });

  it("8. Examination treatment displays Examination Remediation explanation", () => {
    render(
      <SubjectGradeProjectionCard
        projection={null}
        selectedTargetIds={[]}
        capPercentage={75}
        gradeTreatment="EXAMINATION"
      />
    );

    expect(screen.getByText("Remedial Exam")).toBeTruthy();
    expect(screen.getByText("Examination Remediation")).toBeTruthy();
    expect(screen.getByText(/directly replace the recorded examination score/i)).toBeTruthy();
    expect(screen.queryByText(/Preview is pending official backend grade calculation/i)).toBeNull();
  });

  it("9. Regression test: old placeholder string is never rendered in any state", () => {
    const { rerender } = render(
      <SubjectGradeProjectionCard
        projection={null}
        selectedTargetIds={[]}
        capPercentage={75}
        gradeTreatment="WRITTEN_WORK"
      />
    );
    expect(screen.queryByText(/Subject grade projections are not calculated in-browser/i)).toBeNull();

    rerender(
      <SubjectGradeProjectionCard
        projection={null}
        loading={true}
        selectedTargetIds={[]}
        capPercentage={75}
        gradeTreatment="WRITTEN_WORK"
      />
    );
    expect(screen.queryByText(/Subject grade projections are not calculated in-browser/i)).toBeNull();

    rerender(
      <SubjectGradeProjectionCard
        projection={null}
        error="Network error"
        selectedTargetIds={[]}
        capPercentage={75}
        gradeTreatment="WRITTEN_WORK"
      />
    );
    expect(screen.queryByText(/Subject grade projections are not calculated in-browser/i)).toBeNull();
  });
});
