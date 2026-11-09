// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PredictionsDashboard from "./predictions";
import SubjectPrediction from "./subject-prediction";
import SectionPredictions from "./section-predictions";
import PredictionTable from "@/components/predictions/prediction-table";
import { buildCurrentTermDashboard, currentTermRiskSummary, toDashboardPrediction, type AuthorizedCurrentTermRow } from "@/components/predictions/current-term-dashboard-adapter";

const auth = vi.hoisted(() => ({ role: "teacher" as "teacher" | "admin" }));
const currentTerm = vi.hoisted(() => ({ load: vi.fn() }));
const academicContext = vi.hoisted(() => ({ selectedPeriodId: 3 }));
const teacherOnly = vi.hoisted(() => ({
  health: vi.fn(),
  candidates: vi.fn().mockResolvedValue({ items: [] }),
  active: vi.fn().mockResolvedValue({ items: [] }),
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ role: auth.role, user: { role: auth.role } }) }));
vi.mock("@/context/AcademicPeriodContext", () => ({ useAcademicPeriod: () => academicContext }));
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
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, getTeacherDashboardHealth: teacherOnly.health };
});
vi.mock("@/lib/teacher-interventions-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/teacher-interventions-api")>();
  return {
    ...original,
    listTeacherCandidates: teacherOnly.candidates,
    listTeacherActive: teacherOnly.active,
  };
});
vi.mock("@/lib/prediction-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/prediction-api")>();
  return {
    ...original,
    fetchDashboardFilters: vi.fn().mockResolvedValue({ grades: [], classes: [], subjects: [], terms: [] }),
    fetchTeacherAcademicScope: vi.fn().mockResolvedValue({ grades: [], classes: [], subjects: [], terms: [] }),
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

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.clearAllMocks(); academicContext.selectedPeriodId = 3; auth.role = "teacher"; });

describe("shared prediction page access", () => {
  it("uses one AI Predictions experience and renders V3 semantics for teachers", async () => {
    auth.role = "teacher";
    currentTerm.load.mockResolvedValue({ rows: [row], filters, assignedScopes: [] });
    render(
      <MemoryRouter>
        <PredictionsDashboard />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.queryByText(/Loading current-term projections/i)).toBeNull());
    expect(screen.getByRole("heading", { name: "AI Predictions" })).toBeTruthy();
    expect(screen.queryByText("Current-Term Development")).toBeNull();
    expect(screen.getAllByText("Moderate Risk").length).toBeGreaterThan(0);
    expect(screen.getAllByText("High Risk").length).toBeGreaterThan(0);
    expect(screen.getAllByText("On Track").length).toBeGreaterThan(0);
    const summaryButtons = screen.queryAllByRole("button").filter((button) =>
      /Moderate Risk|High Risk|On Track/.test(button.textContent || "")
    );
    expect(summaryButtons).toHaveLength(0);

    fireEvent.change(screen.getByPlaceholderText("Search student or LRN..."), { target: { value: "Alex" } });
    expect(screen.getByText("Grade Level")).toBeTruthy();
    expect(screen.getByText("Grade 9")).toBeTruthy();
    expect(screen.getByText("Projected Grade")).toBeTruthy();
    expect(screen.getByText("Risk Level")).toBeTruthy();
    expect(screen.queryByText("Risk Score")).toBeNull();
    fireEvent.click(screen.getByText("Alex Rivera"));
    expect(screen.getByText("Prediction detail for Alex Rivera")).toBeTruthy();
  });

  it("renders the read-only Admin current-term dashboard with the Teacher risk mapping", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_ENABLE_DEVELOPMENT_PREDICTIONS", "true");
    auth.role = "admin";
    const rows = [
      row,
      { ...row, prediction_id: 42, student_id: "s2", student_name: "Morgan Lee", intervention_level: "MODERATE_RISK" as const },
      { ...row, prediction_id: 43, student_id: "s3", student_name: "Taylor Cruz", intervention_level: "NEEDS_MONITORING" as const },
      { ...row, prediction_id: 44, student_id: "s4", student_name: "Jamie Santos", intervention_level: "LOW_RISK" as const },
      { ...row, prediction_id: 45, student_id: "s5", student_name: "Historical Student", intervention_level: "HIGH_RISK" as const, official_final_grade_available: true, official_final_grade: 80 },
    ];
    currentTerm.load.mockResolvedValue({
      rows,
      filters,
      assignedScopes: [{ subject_id: 5, subject_name: "Mathematics", subject_codename: "MATH", grade_level: 9, class_id: 7, section_name: "Archimedes" }],
    });

    render(
      <MemoryRouter>
        <PredictionsDashboard />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.queryByText(/Loading current-term projections/i)).toBeNull());
    expect(currentTerm.load).toHaveBeenCalledWith(3, {}, "admin");
    const summary = screen.getByLabelText("Prediction risk summary");
    const cards = Array.from(summary.querySelectorAll(":scope > [data-slot='card']"));
    expect(cards).toHaveLength(3);
    expect(cards.map((card) => card.querySelector("[data-slot='card-description']")?.textContent)).toEqual([
      "Moderate Risk",
      "High Risk",
      "On Track",
    ]);
    expect(within(cards[0] as HTMLElement).getByText("1")).toBeTruthy();
    expect(within(cards[1] as HTMLElement).getByText("1")).toBeTruthy();
    expect(within(cards[2] as HTMLElement).getByText("2")).toBeTruthy();
    expect(screen.queryByText("Current-Term Development")).toBeNull();
    expect(screen.queryByText("Development panel mounted for admin")).toBeNull();
    expect(screen.getByRole("link", { name: "View Mathematics 9 predictions" }).getAttribute("href"))
      .toBe("/admin/predictions/subject/5");
    expect(screen.getByRole("link", { name: "View Archimedes predictions" }).getAttribute("href"))
      .toBe("/admin/predictions/subject/5/section/7");

    fireEvent.change(screen.getByPlaceholderText("Search student or LRN..."), { target: { value: "Alex" } });
    fireEvent.click(screen.getByText("Alex Rivera"));
    expect(screen.getByText("Prediction detail for Alex Rivera")).toBeTruthy();
    expect(screen.queryByText(/Assign Intervention|Submit Review|Review Intervention|View Active Intervention/i)).toBeNull();
  });

  it("shows an Admin empty state without issuing write controls", async () => {
    auth.role = "admin";
    currentTerm.load.mockResolvedValue({ rows: [], filters, assignedScopes: [] });

    render(<MemoryRouter><PredictionsDashboard /></MemoryRouter>);

    await waitFor(() => expect(screen.queryByText(/Loading current-term projections/i)).toBeNull());
    expect(screen.getByText("No current-term projections available")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /generate/i })).toBeNull();
  });

  it("shows Admin API failures separately from empty data", async () => {
    auth.role = "admin";
    currentTerm.load.mockRejectedValue(new Error("network unavailable"));

    render(<MemoryRouter><PredictionsDashboard /></MemoryRouter>);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/could not be loaded/i)).toBeTruthy();
    expect(screen.queryByText("No current-term projections available")).toBeNull();
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
    expect(screen.queryByText("Grade Level")).toBeNull();
  });

  it("shows both current-term low categories as On Track without changing stored values", () => {
    const lowRisk = toDashboardPrediction({ ...row, prediction_id: 51, intervention_level: "LOW_RISK" });
    const monitoring = toDashboardPrediction({ ...row, prediction_id: 52, intervention_level: "NEEDS_MONITORING" });

    render(<PredictionTable
      items={[lowRisk, monitoring]}
      total={2}
      limit={10}
      offset={0}
      currentTerm
      simplifiedTeacherRisk
      hidePagination
      onSort={() => undefined}
      onPageChange={() => undefined}
      onRowClick={() => undefined}
    />);

    expect(screen.getAllByText("On Track")).toHaveLength(2);
    expect(screen.queryByText("Low Risk")).toBeNull();
    expect(screen.queryByText("Needs Monitoring")).toBeNull();
    expect(lowRisk.risk_level).toBe("LOW_RISK");
    expect(monitoring.risk_level).toBe("NEEDS_MONITORING");
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

  it("closes stale prediction detail when the academic term changes", async () => {
    auth.role = "teacher";
    currentTerm.load.mockResolvedValue({ rows: [row], filters, assignedScopes: [] });
    const view = render(<MemoryRouter><PredictionsDashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.queryByText(/Loading current-term projections/i)).toBeNull());
    fireEvent.change(screen.getByPlaceholderText("Search student or LRN..."), { target: { value: "Alex" } });
    fireEvent.click(screen.getByText("Alex Rivera"));
    expect(screen.getByText("Prediction detail for Alex Rivera")).toBeTruthy();

    academicContext.selectedPeriodId = 4;
    view.rerender(<MemoryRouter><PredictionsDashboard /></MemoryRouter>);

    await waitFor(() => expect(screen.queryByText("Prediction detail for Alex Rivera")).toBeNull());
    expect(currentTerm.load).toHaveBeenLastCalledWith(4);
  });

  it("ignores an older Admin term response that resolves after the selected term", async () => {
    auth.role = "admin";
    let resolveOld: (value: unknown) => void = () => undefined;
    let resolveCurrent: (value: unknown) => void = () => undefined;
    currentTerm.load.mockImplementation((periodId: number) => new Promise((resolve) => {
      if (periodId === 3) resolveOld = resolve;
      else resolveCurrent = resolve;
    }));

    const view = render(<MemoryRouter><PredictionsDashboard /></MemoryRouter>);
    academicContext.selectedPeriodId = 4;
    view.rerender(<MemoryRouter><PredictionsDashboard /></MemoryRouter>);

    await act(async () => resolveCurrent({
      rows: [{ ...row, prediction_id: 61, intervention_level: "MODERATE_RISK" as const }],
      filters,
      assignedScopes: [],
    }));
    await waitFor(() => expect(screen.queryByText(/Loading current-term projections/i)).toBeNull());

    const currentSummary = screen.getByLabelText("Prediction risk summary");
    const currentCards = Array.from(currentSummary.querySelectorAll(":scope > [data-slot='card']"));
    expect(within(currentCards[0] as HTMLElement).getByText("1")).toBeTruthy();
    expect(within(currentCards[1] as HTMLElement).getByText("0")).toBeTruthy();

    await act(async () => resolveOld({
      rows: [row, { ...row, prediction_id: 62 }, { ...row, prediction_id: 63 }],
      filters,
      assignedScopes: [],
    }));

    const finalSummary = screen.getByLabelText("Prediction risk summary");
    const finalCards = Array.from(finalSummary.querySelectorAll(":scope > [data-slot='card']"));
    expect(within(finalCards[0] as HTMLElement).getByText("1")).toBeTruthy();
    expect(within(finalCards[1] as HTMLElement).getByText("0")).toBeTruthy();
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

  it("loads the Admin subject route with school-wide scope and preserves period context", async () => {
    auth.role = "admin";
    currentTerm.load.mockResolvedValue({
      rows: [row],
      filters,
      assignedScopes: [{ subject_id: 5, subject_name: "Mathematics", subject_codename: "MATH", grade_level: 9, class_id: 7, section_name: "Archimedes" }],
    });

    render(
      <MemoryRouter initialEntries={["/admin/predictions/subject/5"]}>
        <Routes>
          <Route path="/admin/predictions/subject/:subjectId" element={<SubjectPrediction />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.queryByText(/Loading current-term projections/i)).toBeNull());
    expect(currentTerm.load).toHaveBeenCalledWith(3, { subjectId: 5 }, "admin");
    expect(teacherOnly.health).not.toHaveBeenCalled();
    expect(teacherOnly.candidates).not.toHaveBeenCalled();
    expect(teacherOnly.active).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "AI Predictions" }).getAttribute("href")).toBe("/admin/predictions");
    expect(screen.getByText("Alex Rivera")).toBeTruthy();
    fireEvent.click(screen.getByText("Alex Rivera"));
    expect(screen.getByText("Prediction detail for Alex Rivera")).toBeTruthy();
    expect(screen.queryByText(/Assign Intervention|Submit Review|View Active Intervention/i)).toBeNull();
  });

  it("loads the Admin subject-section route without Teacher redirects or write controls", async () => {
    auth.role = "admin";
    currentTerm.load.mockResolvedValue({
      rows: [row],
      filters,
      assignedScopes: [{ subject_id: 5, subject_name: "Mathematics", subject_codename: "MATH", grade_level: 9, class_id: 7, section_name: "Archimedes" }],
    });

    render(
      <MemoryRouter initialEntries={["/admin/predictions/subject/5/section/7"]}>
        <Routes>
          <Route path="/admin/predictions/subject/:subjectId/section/:classId" element={<SectionPredictions />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.queryByText(/Loading current-term projections/i)).toBeNull());
    expect(currentTerm.load).toHaveBeenCalledWith(3, { classId: 7, subjectId: 5 }, "admin");
    expect(teacherOnly.health).not.toHaveBeenCalled();
    expect(teacherOnly.candidates).not.toHaveBeenCalled();
    expect(teacherOnly.active).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "AI Predictions" }).getAttribute("href")).toBe("/admin/predictions");
    expect(screen.getByRole("link", { name: "Mathematics 9" }).getAttribute("href"))
      .toBe("/admin/predictions/subject/5");
    expect(screen.getByText("Alex Rivera")).toBeTruthy();
    expect(Array.from(document.querySelectorAll("a")).every((link) => !link.getAttribute("href")?.startsWith("/teacher/")))
      .toBe(true);
    fireEvent.click(screen.getByText("Alex Rivera"));
    expect(screen.getByText("Prediction detail for Alex Rivera")).toBeTruthy();
    expect(screen.queryByText(/Assign Intervention|Submit Review|View Active Intervention/i)).toBeNull();
  });
});
