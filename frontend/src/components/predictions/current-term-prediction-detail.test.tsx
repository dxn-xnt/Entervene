// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import PredictionDetailSheet from "./prediction-detail-sheet";
import type { DevelopmentCurrentTermListItem } from "@/lib/prediction-api";

const auth = vi.hoisted(() => ({ role: "teacher" as "teacher" | "admin" }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { role: auth.role } }) }));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div>{children}</div> : null,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
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
    examination: { graded_count: 0, performance_percent: null, presentation: { status: "NOT_STARTED", completed_count: 0, components: { SUMMATIVE_1: null, SUMMATIVE_2: null, TERM_EXAM: null } } },
    overall: { graded_activity_count: 3, performance_percent: 85, observed_component_weight_percent: 60 },
  },
  participation_context: {
    attendance: { recorded_days: 10, attendance_rate: 90, present: 8, absent: 1, late: 1, excused: 0 },
    submissions: { assigned_count: 4, submitted_count: 3, missing_count: 1, late_count: 1, upcoming_count: 1, completion_rate: 75 },
  },
  term_context: { start_date: "2026-08-10", end_date: "2026-10-30", evidence_cutoff_date: "2026-09-23", progress_percent: 54, days_remaining: 37, is_active: true, scheduled_end_passed_while_active: false },
  official_final_grade_available: false,
  official_final_grade: null,
};

afterEach(() => { cleanup(); auth.role = "teacher"; });

describe("current-term prediction detail", () => {
  it("links only a supplied matching candidate to teacher review", () => {
    const view = render(<MemoryRouter><PredictionDetailSheet predictionId={41} currentTermPrediction={prediction} candidateId={12} open onOpenChange={() => undefined} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Review Intervention" }).getAttribute("href")).toBe("/teacher/interventions?candidate=12");
    view.unmount();
    render(<MemoryRouter><PredictionDetailSheet predictionId={41} currentTermPrediction={prediction} open onOpenChange={() => undefined} /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "Review Intervention" })).toBeNull();
  });
  it("never shows candidate review in the Admin prediction detail", () => {
    auth.role = "admin";
    render(<MemoryRouter><PredictionDetailSheet predictionId={41} currentTermPrediction={prediction} candidateId={12} open onOpenChange={() => undefined} /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "Review Intervention" })).toBeNull();
  });
  const renderExamination = (status: DevelopmentCurrentTermListItem["academic_evidence"]["examination"]["presentation"]["status"], components: { SUMMATIVE_1: number | null; SUMMATIVE_2: number | null; TERM_EXAM: number | null }, performancePercent: number | null = null) => {
    render(<PredictionDetailSheet predictionId={41} currentTermPrediction={{
      ...prediction,
      academic_evidence: {
        ...prediction.academic_evidence,
        examination: {
          graded_count: performancePercent === null ? 0 : 1,
          performance_percent: performancePercent,
          presentation: { status, completed_count: Object.values(components).filter((value) => value !== null).length, components },
        },
      },
    }} open onOpenChange={() => undefined} />);
    return within(screen.getByLabelText("Examination evidence"));
  };

  it("distinguishes no scored examination from a numeric zero", () => {
    const exam = renderExamination("NOT_STARTED", { SUMMATIVE_1: null, SUMMATIVE_2: null, TERM_EXAM: null });
    expect(exam.getByText("0 of 3 graded")).toBeTruthy();
    expect(exam.queryByText("0.0%")).toBeNull();
  });

  it("shows only Summative 1 as partial evidence", () => {
    const exam = renderExamination("PARTIAL", { SUMMATIVE_1: 80, SUMMATIVE_2: null, TERM_EXAM: null });
    expect(exam.getByText("In progress")).toBeTruthy();
    expect(exam.getByText("1 of 3 graded")).toBeTruthy();
    expect(exam.getByText("80.0%")).toBeTruthy();
    expect(exam.getByText("Final Examination component not yet available for prediction.")).toBeTruthy();
  });

  it("shows two graded summatives without presenting a final examination percentage", () => {
    const exam = renderExamination("PARTIAL", { SUMMATIVE_1: 80, SUMMATIVE_2: 70, TERM_EXAM: null });
    expect(exam.getByText("2 of 3 graded")).toBeTruthy();
    expect(exam.getByText("80.0%")).toBeTruthy();
    expect(exam.getByText("70.0%")).toBeTruthy();
    expect(exam.queryByText("75.0%")).toBeNull();
  });

  it("shows the completed examination component separately from its subparts", () => {
    const exam = renderExamination("COMPLETE", { SUMMATIVE_1: 90, SUMMATIVE_2: 70, TERM_EXAM: 80 }, 80);
    expect(exam.getByText("3 of 3 graded")).toBeTruthy();
    expect(exam.getAllByText("80.0%")).toHaveLength(2);
    expect(exam.queryByText("In progress")).toBeNull();
  });

  it("does not reinterpret older snapshots as having no examination evidence", () => {
    const exam = renderExamination("DETAILS_UNAVAILABLE", { SUMMATIVE_1: null, SUMMATIVE_2: null, TERM_EXAM: null });
    expect(exam.getByText("Status unknown")).toBeTruthy();
    expect(exam.getByText("Component details are unavailable for this saved prediction.")).toBeTruthy();
    expect(exam.queryByText("0 of 3 graded")).toBeNull();
  });

  it("explains academic evidence separately from participation context", () => {
    render(<PredictionDetailSheet predictionId={41} currentTermPrediction={prediction} open onOpenChange={() => undefined} />);

    expect(screen.getByText("Projected Final Term Grade")).toBeTruthy();
    expect(screen.getByText("Needs Monitoring")).toBeTruthy();
    expect(screen.getByText("Academic Evidence at Prediction Time")).toBeTruthy();
    expect(screen.getByText("Additional Classroom Context")).toBeTruthy();
    expect(screen.getByText(/not inputs to the current grade-projection model/i)).toBeTruthy();
    expect(screen.getByText("Aug 10, 2026 - Oct 30, 2026")).toBeTruthy();
    expect(screen.queryByText("STANDARD_READY")).toBeNull();
    expect(screen.queryByText("DEVELOPMENT")).toBeNull();
    expect(screen.queryByText(/probability|confidence|risk score/i)).toBeNull();
  });

  it("shows an actual final grade separately from the earlier projection", () => {
    render(<PredictionDetailSheet predictionId={41} currentTermPrediction={{
      ...prediction,
      official_final_grade_available: true,
      official_final_grade: 87,
      term_context: { ...prediction.term_context, progress_percent: 100, scheduled_end_passed_while_active: true },
    }} open onOpenChange={() => undefined} />);

    expect(screen.getByText("Final Grade: 87.00")).toBeTruthy();
    expect(screen.getByText("Earlier Projected Final Term Grade: 86.25")).toBeTruthy();
    expect(screen.getByText("Earlier Projection")).toBeTruthy();
    expect(screen.getByText(/scheduled end date has passed; this term remains active/i)).toBeTruthy();
    expect(screen.getByText("100.0%")).toBeTruthy();
  });

  it("marks an inactive period's projection as historical even without a final grade", () => {
    render(<PredictionDetailSheet predictionId={41} currentTermPrediction={{
      ...prediction,
      term_context: { ...prediction.term_context, is_active: false },
    }} open onOpenChange={() => undefined} />);
    expect(screen.getByText(/term is no longer active/i)).toBeTruthy();
    expect(screen.getByText("Earlier Projection")).toBeTruthy();
  });
});
