// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PredictionDetailSheet from "./prediction-detail-sheet";
import type { DevelopmentCurrentTermListItem } from "@/lib/prediction-api";

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { role: "teacher" } }) }));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div>{children}</div> : null,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
}));

const prediction: DevelopmentCurrentTermListItem = {
  prediction_id: 41, revision: 2, student_id: "s1", student_name: "Alex Rivera",
  class_id: 7, class_name: "Archimedes", subject_id: 5, subject_name: "Mathematics", subject_codename: "MATH",
  academic_period_id: 3, period_name: "Term 1", projected_final_term_grade: 86.25,
  intervention_level: "NEEDS_MONITORING", intervention_basis: "RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE",
  readiness_status: "READY", readiness_level: "STANDARD_READY", readiness_label: "Projection ready",
  model_version_id: 8, model_name: "v3", lifecycle_status: "DEVELOPMENT", generated_at: "2026-09-23T00:00:00Z",
  academic_evidence: {
    written_works: { graded_count: 2, performance_percent: 82 },
    performance_tasks: { graded_count: 1, performance_percent: 88 },
    examination: { graded_count: 0, performance_percent: null },
    overall: { graded_activity_count: 3, performance_percent: 85, observed_component_weight_percent: 60 },
  },
  participation_context: {
    attendance: { recorded_days: 10, attendance_rate: 90, present: 8, absent: 1, late: 1, excused: 0 },
    submissions: { assigned_count: 4, submitted_count: 3, missing_count: 1, late_count: 1, upcoming_count: 1, completion_rate: 75 },
  },
  term_context: { start_date: "2026-08-10", end_date: "2026-10-30", evidence_cutoff_date: "2026-09-23", progress_percent: 54, days_remaining: 37, is_active: true },
  official_final_grade_available: false,
};

afterEach(cleanup);

describe("current-term prediction detail", () => {
  it("explains academic evidence separately from participation context", () => {
    render(<PredictionDetailSheet predictionId={41} currentTermPrediction={prediction} open onOpenChange={() => undefined} />);

    expect(screen.getByText("Projected Final Term Grade")).toBeTruthy();
    expect(screen.getByText("Needs Monitoring")).toBeTruthy();
    expect(screen.getByText("Academic Evidence Used for Projection")).toBeTruthy();
    expect(screen.getByText("Additional Classroom Context")).toBeTruthy();
    expect(screen.getByText(/not inputs to the current grade-projection model/i)).toBeTruthy();
    expect(screen.getByText("Aug 10, 2026 - Oct 30, 2026")).toBeTruthy();
    expect(screen.queryByText("STANDARD_READY")).toBeNull();
    expect(screen.queryByText("DEVELOPMENT")).toBeNull();
    expect(screen.queryByText(/probability|confidence|risk score/i)).toBeNull();
  });
});
