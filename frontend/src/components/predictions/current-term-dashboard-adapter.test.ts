import { describe, expect, it } from "vitest";
import {
  buildCurrentTermGradeSummaries,
  buildCurrentTermSubjectSummaries,
  currentTermRiskSummary,
  formatSubjectDisplayName,
  type AuthorizedCurrentTermRow,
} from "./current-term-dashboard-adapter";

function createMockRow(overrides: Partial<AuthorizedCurrentTermRow> = {}): AuthorizedCurrentTermRow {
  return {
    prediction_id: 1,
    revision: 1,
    student_id: "student-1",
    student_name: "Demo Student",
    class_id: 1,
    class_name: "Demo Archimedes",
    subject_id: 1,
    subject_name: "Mathematics",
    subject_codename: "MATHEMATICS",
    grade_level: 9,
    academic_period_id: 1,
    period_name: "Term 1 Demo",
    projected_final_term_grade: 85,
    intervention_level: "LOW_RISK",
    intervention_basis: "RULE_BASED",
    readiness_status: "READY",
    readiness_level: "HIGH",
    readiness_label: "Ready",
    academic_evidence: {
      written_works: { graded_count: 4, performance_percent: 85 },
      performance_tasks: { graded_count: 3, performance_percent: 85 },
      examination: {
        graded_count: 2,
        performance_percent: 85,
        presentation: { status: "COMPLETE", completed_count: 2, components: {} },
      },
      overall: { graded_activity_count: 9, performance_percent: 85, observed_component_weight_percent: 100 },
    },
    participation_context: {
      attendance: { recorded_days: 15, attendance_rate: 95, present: 14, absent: 0, late: 1, excused: 0 },
      submissions: { assigned_count: 9, submitted_count: 9, missing_count: 0, late_count: 0, upcoming_count: 0, completion_rate: 100 },
    },
    term_context: {
      start_date: "2026-09-01",
      end_date: "2026-11-30",
      evidence_cutoff_date: "2026-09-25",
      progress_percent: 33,
      days_remaining: 66,
      is_active: true,
      scheduled_end_passed_while_active: false,
    },
    official_final_grade_available: false,
    official_final_grade: null,
    model_version_id: 2,
    model_name: "entervene_current_term_official_target_rf_candidate",
    lifecycle_status: "DEVELOPMENT",
    generated_at: "2026-09-25T10:00:00Z",
    ...overrides,
  };
}

describe("formatSubjectDisplayName", () => {
  it("formats subject name and grade level cleanly", () => {
    expect(formatSubjectDisplayName("Mathematics", 9)).toBe("Mathematics 9");
    expect(formatSubjectDisplayName("Science", 7)).toBe("Science 7");
  });

  it("avoids duplicating grade level if already in subject name", () => {
    expect(formatSubjectDisplayName("Mathematics 8", 8)).toBe("Mathematics 8");
    expect(formatSubjectDisplayName("Grade 9 Mathematics", 9)).toBe("Grade 9 Mathematics");
    expect(formatSubjectDisplayName("Science-9", 9)).toBe("Science-9");
  });

  it("handles null or missing grade level safely", () => {
    expect(formatSubjectDisplayName("General Assembly", null)).toBe("General Assembly");
    expect(formatSubjectDisplayName("Homeroom", undefined)).toBe("Homeroom");
  });

  it("handles empty subject name safely", () => {
    expect(formatSubjectDisplayName("", 9)).toBe("Subject 9");
    expect(formatSubjectDisplayName("", null)).toBe("Subject");
  });
});

describe("buildCurrentTermSubjectSummaries", () => {
  it("1. handles one subject with one section", () => {
    const rows = [
      createMockRow({ prediction_id: 101, student_id: "s1", subject_id: 1, class_id: 1 }),
      createMockRow({ prediction_id: 102, student_id: "s2", subject_id: 1, class_id: 1 }),
    ];
    const summaries = buildCurrentTermSubjectSummaries(rows);

    expect(summaries).toHaveLength(1);
    expect(summaries[0].subject_id).toBe(1);
    expect(summaries[0].display_name).toBe("Mathematics 9");
    expect(summaries[0].total_predictions).toBe(2);
    expect(summaries[0].sections).toHaveLength(1);
    expect(summaries[0].sections[0].class_id).toBe(1);
    expect(summaries[0].sections[0].total_predictions).toBe(2);
  });

  it("2. handles one subject with multiple sections without cross-section contamination", () => {
    const rows = [
      createMockRow({ prediction_id: 101, student_id: "s1", subject_id: 1, class_id: 1, class_name: "Demo Archimedes" }),
      createMockRow({ prediction_id: 102, student_id: "s2", subject_id: 1, class_id: 1, class_name: "Demo Archimedes" }),
      createMockRow({ prediction_id: 103, student_id: "s3", subject_id: 1, class_id: 2, class_name: "Demo Aristotle" }),
    ];
    const summaries = buildCurrentTermSubjectSummaries(rows);

    expect(summaries).toHaveLength(1);
    expect(summaries[0].subject_id).toBe(1);
    expect(summaries[0].total_predictions).toBe(3);
    expect(summaries[0].sections).toHaveLength(2);
    expect(summaries[0].sections[0].section_name).toBe("Demo Archimedes");
    expect(summaries[0].sections[0].total_predictions).toBe(2);
    expect(summaries[0].sections[1].section_name).toBe("Demo Aristotle");
    expect(summaries[0].sections[1].total_predictions).toBe(1);
  });

  it("3. handles multiple subjects assigned to the same section as separate subject groups", () => {
    const rows = [
      createMockRow({ prediction_id: 101, student_id: "s1", subject_id: 1, subject_name: "Mathematics", class_id: 1, class_name: "Demo Archimedes" }),
      createMockRow({ prediction_id: 102, student_id: "s1", subject_id: 2, subject_name: "Science", class_id: 1, class_name: "Demo Archimedes" }),
    ];
    const summaries = buildCurrentTermSubjectSummaries(rows);

    expect(summaries).toHaveLength(2);
    const math = summaries.find((s) => s.subject_id === 1)!;
    const science = summaries.find((s) => s.subject_id === 2)!;
    expect(math).toBeDefined();
    expect(science).toBeDefined();
    expect(math.display_name).toBe("Mathematics 9");
    expect(science.display_name).toBe("Science 9");
    expect(math.sections[0].class_id).toBe(1);
    expect(science.sections[0].class_id).toBe(1);
    expect(math.total_predictions).toBe(1);
    expect(science.total_predictions).toBe(1);
  });

  it("4. keeps Mathematics 7 and Mathematics 8 as distinct groups even with similar names", () => {
    const rows = [
      createMockRow({ prediction_id: 201, subject_id: 70, subject_name: "Mathematics", grade_level: 7 }),
      createMockRow({ prediction_id: 202, subject_id: 80, subject_name: "Mathematics", grade_level: 8 }),
    ];
    const summaries = buildCurrentTermSubjectSummaries(rows);

    expect(summaries).toHaveLength(2);
    expect(summaries[0].subject_id).toBe(70);
    expect(summaries[0].display_name).toBe("Mathematics 7");
    expect(summaries[1].subject_id).toBe(80);
    expect(summaries[1].display_name).toBe("Mathematics 8");
  });

  it("5. keeps different subject IDs with identical names separate", () => {
    const rows = [
      createMockRow({ prediction_id: 301, subject_id: 10, subject_name: "Special Topics", grade_level: 9 }),
      createMockRow({ prediction_id: 302, subject_id: 20, subject_name: "Special Topics", grade_level: 9 }),
    ];
    const summaries = buildCurrentTermSubjectSummaries(rows);

    expect(summaries).toHaveLength(2);
    expect(summaries[0].subject_id).toBe(10);
    expect(summaries[1].subject_id).toBe(20);
    expect(summaries[0].subject_id).not.toBe(summaries[1].subject_id);
  });

  it("6. aggregates multiple prediction rows under the same subject ID and section", () => {
    const rows = [
      createMockRow({ prediction_id: 401, student_id: "s1", subject_id: 1, class_id: 1 }),
      createMockRow({ prediction_id: 402, student_id: "s2", subject_id: 1, class_id: 1 }),
      createMockRow({ prediction_id: 403, student_id: "s3", subject_id: 1, class_id: 1 }),
    ];
    const summaries = buildCurrentTermSubjectSummaries(rows);

    expect(summaries).toHaveLength(1);
    expect(summaries[0].total_predictions).toBe(3);
    expect(summaries[0].sections[0].total_predictions).toBe(3);
  });

  it("7. calculates correct risk counts within each subject-section group", () => {
    const rows = [
      createMockRow({ prediction_id: 501, intervention_level: "HIGH_RISK" }),
      createMockRow({ prediction_id: 502, intervention_level: "MODERATE_RISK" }),
      createMockRow({ prediction_id: 503, intervention_level: "NEEDS_MONITORING" }),
      createMockRow({ prediction_id: 504, intervention_level: "LOW_RISK" }),
      createMockRow({ prediction_id: 505, intervention_level: "LOW_RISK" }),
    ];
    const summaries = buildCurrentTermSubjectSummaries(rows);

    expect(summaries).toHaveLength(1);
    const subject = summaries[0];
    expect(subject.high_risk_count).toBe(1);
    expect(subject.moderate_risk_count).toBe(1); // 1 MODERATE_RISK
    expect(subject.needs_monitoring_count).toBe(1); // 1 NEEDS_MONITORING
    expect(subject.low_risk_count).toBe(2);
    expect(subject.at_risk_count).toBe(3); // 1 High + 1 Moderate + 1 Needs Monitoring
    expect(subject.total_predictions).toBe(5);

    const section = subject.sections[0];
    expect(section.high_risk_count).toBe(1);
    expect(section.moderate_risk_count).toBe(1);
    expect(section.needs_monitoring_count).toBe(1);
    expect(section.low_risk_count).toBe(2);
    expect(section.at_risk_count).toBe(3);
  });

  it("8. handles empty prediction arrays gracefully", () => {
    const summaries = buildCurrentTermSubjectSummaries([]);
    expect(summaries).toEqual([]);
  });

  it("9. allows pre-populating assigned scopes with 0 predictions without inventing fake predictions", () => {
    const assignedScopes = [
      {
        subject_id: 99,
        subject_name: "Robotics",
        grade_level: 9,
        class_id: 10,
        section_name: "Demo Turing",
      },
    ];
    const summaries = buildCurrentTermSubjectSummaries([], assignedScopes);

    expect(summaries).toHaveLength(1);
    expect(summaries[0].subject_id).toBe(99);
    expect(summaries[0].display_name).toBe("Robotics 9");
    expect(summaries[0].total_predictions).toBe(0);
    expect(summaries[0].at_risk_count).toBe(0);
    expect(summaries[0].sections).toHaveLength(1);
    expect(summaries[0].sections[0].class_id).toBe(10);
    expect(summaries[0].sections[0].total_predictions).toBe(0);
  });

  it("10. excludes finalized official grades and inactive terms from actionable at-risk counts", () => {
    const rows = [
      // Active prediction (actionable)
      createMockRow({ prediction_id: 601, intervention_level: "HIGH_RISK" }),
      // Finalized official grade available (historical, non-actionable)
      createMockRow({
        prediction_id: 602,
        intervention_level: "HIGH_RISK",
        official_final_grade_available: true,
        official_final_grade: 74,
      }),
      // Term inactive (historical, non-actionable)
      createMockRow({
        prediction_id: 603,
        intervention_level: "HIGH_RISK",
        term_context: {
          start_date: "2026-06-01",
          end_date: "2026-08-31",
          evidence_cutoff_date: "2026-08-31",
          progress_percent: 100,
          days_remaining: 0,
          is_active: false,
          scheduled_end_passed_while_active: false,
        },
      }),
    ];
    const summaries = buildCurrentTermSubjectSummaries(rows);

    expect(summaries).toHaveLength(1);
    expect(summaries[0].total_predictions).toBe(3);
    // Only row 601 is active and actionable
    expect(summaries[0].high_risk_count).toBe(1);
    expect(summaries[0].at_risk_count).toBe(1);
  });

  it("11. does not mutate the input rows array or row objects", () => {
    const originalRow = createMockRow({ prediction_id: 701, intervention_level: "MODERATE_RISK" });
    const originalRowCopy = JSON.parse(JSON.stringify(originalRow));
    const rows = [originalRow];

    buildCurrentTermSubjectSummaries(rows);

    expect(rows).toHaveLength(1);
    expect(originalRow).toEqual(originalRowCopy);
  });

  it("12. preserves existing grade-grouping and risk summary functionality unchanged", () => {
    const rows = [
      createMockRow({ prediction_id: 801, grade_level: 9, class_id: 1, intervention_level: "HIGH_RISK" }),
      createMockRow({ prediction_id: 802, grade_level: 9, class_id: 1, intervention_level: "LOW_RISK" }),
      createMockRow({ prediction_id: 803, grade_level: 10, class_id: 2, intervention_level: "MODERATE_RISK" }),
    ];

    const gradeSummaries = buildCurrentTermGradeSummaries(rows);
    expect(gradeSummaries).toHaveLength(2);
    expect(gradeSummaries[0].grade_level).toBe(9);
    expect(gradeSummaries[0].sections[0].high_risk_count).toBe(1);
    expect(gradeSummaries[1].grade_level).toBe(10);
    expect(gradeSummaries[1].sections[0].moderate_risk_count).toBe(1);

    const riskSummary = currentTermRiskSummary(rows);
    expect(riskSummary.HIGH_RISK).toBe(1);
    expect(riskSummary.MODERATE_RISK).toBe(1);
    expect(riskSummary.LOW_RISK).toBe(1);
    expect(riskSummary.total).toBe(3);
  });

  it("13. regression: verified Demo Archimedes Mathematics counts match expected values", () => {
    // Exactly matches the 9 Demo Archimedes prediction rows in Entervene_Demo:
    // 5 LOW_RISK, 2 MODERATE_RISK, 2 NEEDS_MONITORING, 0 HIGH_RISK
    const demoRows = [
      createMockRow({ prediction_id: 33, student_id: "s-blake", intervention_level: "LOW_RISK", projected_final_term_grade: 92.51 }),
      createMockRow({ prediction_id: 36, student_id: "s-avery", intervention_level: "LOW_RISK", projected_final_term_grade: 94.67 }),
      createMockRow({ prediction_id: 31, student_id: "s-gray", intervention_level: "LOW_RISK", projected_final_term_grade: 91.50 }),
      createMockRow({ prediction_id: 29, student_id: "s-indigo", intervention_level: "LOW_RISK", projected_final_term_grade: 93.00 }),
      createMockRow({ prediction_id: 32, student_id: "s-casey", intervention_level: "LOW_RISK", projected_final_term_grade: 91.68 }),
      createMockRow({ prediction_id: 43, student_id: "s-drew", intervention_level: "MODERATE_RISK", projected_final_term_grade: 83.65 }),
      createMockRow({ prediction_id: 40, student_id: "s-finley", intervention_level: "MODERATE_RISK", projected_final_term_grade: 83.99 }),
      createMockRow({ prediction_id: 35, student_id: "s-emery", intervention_level: "NEEDS_MONITORING", projected_final_term_grade: 86.64 }),
      createMockRow({ prediction_id: 30, student_id: "s-harper", intervention_level: "NEEDS_MONITORING", projected_final_term_grade: 86.92 }),
    ];

    const summaries = buildCurrentTermSubjectSummaries(demoRows);

    expect(summaries).toHaveLength(1);
    const mathGroup = summaries[0];
    expect(mathGroup.subject_id).toBe(1);
    expect(mathGroup.display_name).toBe("Mathematics 9");
    expect(mathGroup.total_predictions).toBe(9);
    expect(mathGroup.high_risk_count).toBe(0);
    expect(mathGroup.moderate_risk_count).toBe(2); // 2 Moderate
    expect(mathGroup.needs_monitoring_count).toBe(2); // 2 Needs Monitoring
    expect(mathGroup.low_risk_count).toBe(5);
    expect(mathGroup.at_risk_count).toBe(4);

    expect(mathGroup.sections).toHaveLength(1);
    const archimedes = mathGroup.sections[0];
    expect(archimedes.class_id).toBe(1);
    expect(archimedes.section_name).toBe("Demo Archimedes");
    expect(archimedes.total_predictions).toBe(9);
    expect(archimedes.high_risk_count).toBe(0);
    expect(archimedes.moderate_risk_count).toBe(2);
    expect(archimedes.needs_monitoring_count).toBe(2);
    expect(archimedes.low_risk_count).toBe(5);
    expect(archimedes.at_risk_count).toBe(4);
  });
});
