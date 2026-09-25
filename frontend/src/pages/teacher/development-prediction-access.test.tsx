// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PredictionsDashboard from "./predictions";
import PredictionTable from "@/components/predictions/prediction-table";
import { buildCurrentTermDashboard, currentTermRiskSummary, toDashboardPrediction, type AuthorizedCurrentTermRow } from "@/components/predictions/current-term-dashboard-adapter";

const auth = vi.hoisted(() => ({ role: "teacher" as "teacher" | "admin" }));
const currentTerm = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ role: auth.role, user: { role: auth.role } }) }));
vi.mock("@/context/AcademicPeriodContext", () => ({ useAcademicPeriod: () => ({ selectedPeriodId: 3 }) }));
vi.mock("@/layouts/app-layout", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("@/components/predictions/prediction-grade-section", () => ({
  PredictionGradeSection: ({ group }: { group: { level_name: string } }) => <div>{group.level_name}</div>,
}));
vi.mock("@/components/predictions/prediction-detail-sheet", () => ({
  default: ({ currentTermPrediction }: { currentTermPrediction?: { student_name: string } | null }) => currentTermPrediction ? <div>Prediction detail for {currentTermPrediction.student_name}</div> : null,
}));
vi.mock("@/components/predictions/development-current-term-panel", () => ({
  default: ({ role }: { role: "admin" | "teacher" }) => <div>Development panel mounted for {role}</div>,
}));
vi.mock("@/components/retroui/Tabs", () => ({ Tabs: ({ tabs, onTabChange }: { tabs: Array<{ id: string; label: string }>; onTabChange: (id: string) => void }) => <div>{tabs.map((tab) => <button key={tab.id} onClick={() => onTabChange(tab.id)}>{tab.label}</button>)}</div> }));
vi.mock("@/components/predictions/current-term-dashboard-adapter", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/predictions/current-term-dashboard-adapter")>();
  return { ...original, loadAuthorizedCurrentTermPredictions: currentTerm.load };
});
vi.mock("@/lib/prediction-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/prediction-api")>();
  return {
    ...original,
    fetchDashboardFilters: vi.fn().mockResolvedValue({ grades: [], classes: [], subjects: [], terms: [] }),
    fetchDashboardGradeSummaries: vi.fn().mockResolvedValue([]),
    fetchDashboardAtRisk: vi.fn().mockResolvedValue({ items: [], total: 0, risk_summary: { total: 0 } }),
  };
});

const row: AuthorizedCurrentTermRow = {
  prediction_id: 41, revision: 2, student_id: "s1", student_name: "Alex Rivera",
  class_id: 7, class_name: "Archimedes", subject_id: 5, subject_name: "Mathematics", subject_codename: "MATH",
  academic_period_id: 3, period_name: "Term 1", projected_final_term_grade: 72.5,
  intervention_level: "HIGH_RISK" as const, intervention_basis: "RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE",
  readiness_status: "READY", readiness_level: "STANDARD_READY", readiness_label: "Projection ready",
  model_version_id: 8, model_name: "v3", lifecycle_status: "DEVELOPMENT", generated_at: "2026-09-23T00:00:00Z",
  academic_evidence: {
    written_works: { graded_count: 2, performance_percent: 70 },
    performance_tasks: { graded_count: 1, performance_percent: 75 },
    examination: { graded_count: 0, performance_percent: null, presentation: { status: "NOT_STARTED", completed_count: 0, components: { SUMMATIVE_1: null, SUMMATIVE_2: null, TERM_EXAM: null } } },
    overall: { graded_activity_count: 3, performance_percent: 72, observed_component_weight_percent: 60 },
  },
  participation_context: {
    attendance: { recorded_days: 10, attendance_rate: 90, present: 8, absent: 1, late: 1, excused: 0 },
    submissions: { assigned_count: 4, submitted_count: 3, missing_count: 1, late_count: 1, upcoming_count: 1, completion_rate: 75 },
  },
  term_context: { start_date: "2026-08-10", end_date: "2026-10-30", evidence_cutoff_date: "2026-09-23", progress_percent: 54, days_remaining: 37, is_active: true, scheduled_end_passed_while_active: false },
  official_final_grade_available: false,
  official_final_grade: null as number | null,
  grade_level: 9,
};
const filters = {
  grades: [{ grade_level: 9, level_name: "Grade 9" }],
  classes: [{ class_id: 7, section_name: "Archimedes", grade_level: 9 }],
  subjects: [{ subject_id: 5, subject_name: "Mathematics", subject_codename: "MATH" }],
  terms: [{ term_number: 1, term_label: "Term 1", academic_period_id: 3 }],
};

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("shared prediction page access", () => {
  it("uses one AI Predictions experience and renders V3 semantics for teachers", async () => {
    auth.role = "teacher";
    currentTerm.load.mockResolvedValue({ rows: [row], filters });
    render(<PredictionsDashboard />);
    await waitFor(() => expect(screen.getByText("Grade Cohort Summaries")).toBeTruthy());
    expect(screen.getByRole("heading", { name: "AI Predictions" })).toBeTruthy();
    expect(screen.queryByText("Current-Term Development")).toBeNull();
    expect(screen.getByRole("button", { name: /High Risk\s+1/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /High Risk/i }));
    expect(screen.getByText("Projected Final Term Grade")).toBeTruthy();
    expect(screen.getByText("Intervention Level")).toBeTruthy();
    expect(screen.queryByText("Risk Score")).toBeNull();
    fireEvent.click(screen.getByText("Alex Rivera"));
    expect(screen.getByText("Prediction detail for Alex Rivera")).toBeTruthy();
  });

  it.each(["admin", "teacher"] as const)("hides the development tab in production for %s", (role) => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_ENABLE_DEVELOPMENT_PREDICTIONS", "true");
    auth.role = role;
    render(<PredictionsDashboard />);
    expect(screen.queryByText("Current-Term Development")).toBeNull();
  });

  it("mounts the development surface only for an enabled admin", () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_ENABLE_DEVELOPMENT_PREDICTIONS", "true");
    auth.role = "admin";
    render(<PredictionsDashboard />);
    fireEvent.click(screen.getByRole("button", { name: "Current-Term Development" }));
    expect(screen.getByText("Development panel mounted for admin")).toBeTruthy();
  });

  it("leaves the legacy table's risk-score rendering intact", () => {
    render(<PredictionTable items={[{
      prediction_id: 1,
      student_id: "s1",
      student_name: "Alex Rivera",
      student_lrn: "123456789012",
      class_name: "Archimedes",
      subject_name: "Science",
      term_label: "Term 1",
      term_number: 1,
      predicted_period_grade: 84,
      risk_level: "MODERATE_RISK",
      risk_score: 70,
      data_status: "GENERATED",
      generated_at: null,
    }]} total={1} limit={5} offset={0} onSort={() => {}} onPageChange={() => {}} onRowClick={() => {}} />);
    expect(screen.getByText("Predicted Grade")).toBeTruthy();
    expect(screen.getByText("Risk Level")).toBeTruthy();
    expect(screen.getByText("Risk Score")).toBeTruthy();
  });

  it("uses a neutral empty state for current-term results", () => {
    render(<PredictionTable items={[]} total={0} limit={10} offset={0} currentTerm hidePagination onSort={() => undefined} onPageChange={() => undefined} onRowClick={() => undefined} />);
    expect(screen.getByText("No prediction results available")).toBeTruthy();
    expect(screen.getByText("No current-term projections are available for this scope.")).toBeTruthy();
    expect(screen.queryByText(/currently on track/i)).toBeNull();
  });

  it("shows a request error instead of an empty prediction state", async () => {
    auth.role = "teacher";
    currentTerm.load.mockRejectedValue(new Error("network unavailable"));
    render(<PredictionsDashboard />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/could not be loaded/i)).toBeTruthy();
    expect(screen.queryByText("No current-term projections are available for this scope.")).toBeNull();
  });

  it("keeps finalized projections visible as history and out of actionable risk counts", () => {
    const historical = { ...row, official_final_grade_available: true, official_final_grade: 87 };
    expect(currentTermRiskSummary([historical]).total).toBe(0);
    expect(currentTermRiskSummary([{ ...row, term_context: { ...row.term_context, is_active: false } }]).total).toBe(0);
    expect(buildCurrentTermDashboard([historical], { interventionLevel: "HIGH_RISK" }).items).toEqual([]);
    render(<PredictionTable items={[toDashboardPrediction(historical)]} total={1} limit={10} offset={0} currentTerm onSort={() => undefined} onPageChange={() => undefined} onRowClick={() => undefined} />);
    expect(screen.getByText("Final Grade: 87.00")).toBeTruthy();
    expect(screen.getByText("Earlier projection: 72.50")).toBeTruthy();
    expect(screen.getByText("Historical projection")).toBeTruthy();
  });
});
