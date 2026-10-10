// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeacherDashboardHealthResponse, TrendChartPoint } from "@/lib/api";
import Dashboard from "./dashboard";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  navigate: vi.fn(),
  period: { selectedPeriodId: 3 as number | null, isLoading: false },
  classes: [] as Array<{ class_id: number; subject_id: number; subject_name: string }>,
  tooltipPoint: null as TrendChartPoint | null,
}));

vi.mock("@/lib/api", () => ({ getTeacherDashboardHealth: mocks.load }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/context/AcademicPeriodContext", () => ({ useAcademicPeriod: () => mocks.period }));
vi.mock("@/hooks/use-teacher-classes", () => ({ useTeacherClasses: () => ({ classes: mocks.classes }) }));
vi.mock("@/layouts/app-layout", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("@/components/retroui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render: trigger }: { render: ReactNode }) => <>{trigger}</>,
  TooltipContent: () => null,
}));
vi.mock("@/components/retroui/Select", () => ({
  Select: Object.assign(
    ({ children, value, onValueChange }: { children: ReactNode; value: string; onValueChange: (value: string) => void }) =>
      <select aria-label="Trend section" value={value} onChange={(event) => onValueChange(event.target.value)}>{children}</select>,
    {
      Trigger: () => null,
      Value: () => null,
      Content: ({ children }: { children: ReactNode }) => <>{children}</>,
      Item: ({ children, value }: { children: ReactNode; value: string }) => <option value={value}>{children}</option>,
    },
  ),
}));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
  LineChart: ({ data, children }: { data: unknown[]; children: ReactNode }) =>
    <div data-testid="trend-chart" data-points={JSON.stringify(data)}>{children}</div>,
  YAxis: ({ domain, ticks }: { domain: number[]; ticks: number[] }) =>
    <div data-testid="trend-axis" data-domain={JSON.stringify(domain)} data-ticks={JSON.stringify(ticks)} />,
  XAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: ({ content }: { content: (props: { active: boolean; payload: Array<{ payload: TrendChartPoint }> }) => ReactNode }) =>
    mocks.tooltipPoint ? <>{content({ active: true, payload: [{ payload: mocks.tooltipPoint }] })}</> : null,
  Line: () => null,
}));

function response(overrides: Partial<TeacherDashboardHealthResponse> = {}): TeacherDashboardHealthResponse {
  return {
    term_info: { period_id: 3, period_name: "Term 2", academic_year: "2026–2027", is_active: true },
    kpis: { active_classes: 0, enrolled_students: 0, overall_completion_rate: 0, ungraded_count: 0 },
    trend_chart: {
      available_filters: [], selected_class_id: null, selected_subject_id: null,
      selected_section_name: "", selected_subject_name: "", has_sufficient_data: false, points: [],
    },
    section_matrix: [],
    action_queue: { pending_grading: [], upcoming_deadlines: [] },
    ...overrides,
  };
}

function phaseTwoResponse(overrides: Partial<TeacherDashboardHealthResponse> = {}): TeacherDashboardHealthResponse {
  return response({
    phase_two: {
      grades: { current_grade: 80.5, passing_rate_percent: 50, available_grade_count: 2, total_grade_count: 3,
        passing_count: 1, passing_threshold: null, current_grade_meets_threshold: null, warnings: [] },
      attendance_today: { rate: 50, record_count: 4, present_count: 1, late_count: 1, excused_count: 1, absent_count: 1 },
      month_window: { start_date: "2026-10-01", end_date: "2026-10-09", today: "2026-10-09", label: "This month" },
      late_submissions: { late_rate_percent: 25, late_count: 1, eligible_count: 4, excused_excluded_count: 2,
        completed_count: 6, warnings: [] },
      weekdays: { days: [2, 0, 3, 1, 4, 0].map((count, day_index) => ({
        label: ["M", "T", "W", "Th", "F", "S"][day_index], day_index, count,
      })), sunday_count: 2, total_count: 12, warnings: [] },
      term_progress: { progress_percent: 40, elapsed_days: 14, total_days: 35, week_number: 2, total_weeks: 5, warnings: [] },
      require_subject_match: false,
    },
    ...overrides,
  });
}

function phaseTwoSection(): TeacherDashboardHealthResponse["section_matrix"][number] {
  return { class_id: 17, subject_id: 25, section_name: "Actual Section", grade_level: "Grade 8", subject_name: "Actual Subject",
    student_count: 3, published_classworks: 2, completion_rate_percent: 50, attendance_rate_percent: 50,
    avg_score_percent: null, current_grade: 80.5, passing_rate_percent: 50, available_grade_count: 2, total_grade_count: 3,
    passing_count: 1, passing_threshold: 80.5, current_grade_meets_threshold: true, warnings: [] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function cardFor(title: string): HTMLElement {
  const card = screen.getByText(title, { exact: true }).closest<HTMLElement>('[data-slot="card"]');
  if (!card) throw new Error(`Missing card: ${title}`);
  return card;
}

function countFor(title: string) {
  return within(cardFor(title)).getByRole("heading").textContent;
}

function chartPoints() {
  return JSON.parse(screen.getByTestId("trend-chart").getAttribute("data-points") ?? "[]");
}

beforeEach(() => {
  mocks.load.mockReset().mockImplementation(() => new Promise(() => {}));
  mocks.navigate.mockReset();
  mocks.period.selectedPeriodId = 3;
  mocks.period.isLoading = false;
  mocks.classes = [];
  mocks.tooltipPoint = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected live request in a mocked dashboard test"); }));
});

afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// These exercise the page with mocked requests, contexts, navigation, and charts;
// they are component behavior tests, not live API integration or end-to-end tests.
describe("teacher dashboard Phase 1 mocked component behavior", () => {
  it("keeps eight overview skeletons and empty Phase 1 widgets while loading", () => {
    const { container } = render(<Dashboard />);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(8);
    expect(chartPoints()).toEqual([]);
    for (const title of ["Submissions to Review", "Due this week", "Section-by-Section Health"]) {
      expect(within(cardFor(title)).getByText("Loading dashboard data...")).toBeTruthy();
    }
    expect(screen.queryByText("Panganganak ng Pang-uri")).toBeNull();
    expect(screen.queryByText("Fractions worksheet")).toBeNull();
    expect(screen.queryByText("17 Students")).toBeNull();
    expect(screen.getByText("Jose Reyes")).toBeTruthy();
    expect(screen.queryByText("Maria Santos")).toBeNull();
    expect(within(cardFor("Top Performers")).getByText("Loading dashboard data...")).toBeTruthy();
  });

  it("shows unavailable overview values after errors while retaining later detail demos", async () => {
    mocks.load.mockRejectedValue(new Error("Dashboard request failed"));
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Dashboard request failed"));
    expect([countFor("Active Classes"), countFor("Overall Completion"), countFor("Ungraded Queue")]).toEqual(["—", "—", "—"]);
    expect([countFor("Current grade"), countFor("Passing Rate"), countFor("Late Submissions"), countFor("Attendance Today"), countFor("Term Progress")])
      .toEqual(["—", "—", "—", "—", "—"]);
    expect(chartPoints()).toEqual([]);
    expect(within(cardFor("Submissions to Review")).getByText("Dashboard data is unavailable.")).toBeTruthy();
  });

  it.each([
    { status: 403, detail: "Teacher identity could not be resolved" },
    { status: 404, detail: "Academic period not found" },
  ])("renders the existing Alert for $status ($detail) without a blank page or Phase 1 demo data", async ({ status, detail }) => {
    // Match getTeacherDashboardHealth's ApiRequestError message and metadata
    // without importing the live client into this mocked component test.
    const requestError = Object.assign(new Error(detail), {
      name: "ApiRequestError", status, data: { detail },
    });
    mocks.load.mockRejectedValue(requestError);
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(detail));
    expect(screen.getByRole("heading", { name: "Dashboard", level: 1 })).toBeTruthy();
    expect([countFor("Active Classes"), countFor("Overall Completion"), countFor("Ungraded Queue")]).toEqual(["—", "—", "—"]);
    expect(chartPoints()).toEqual([]);
    for (const title of ["Submissions to Review", "Due this week", "Section-by-Section Health"]) {
      const card = cardFor(title);
      expect(within(card).getByText("Dashboard data is unavailable.")).toBeTruthy();
      expect(card.querySelectorAll('[data-slot="card-content"] > [data-slot="card"]')).toHaveLength(0);
    }
    expect(within(cardFor("Submissions to Review")).queryByText("Panganganak ng Pang-uri")).toBeNull();
    expect(within(cardFor("Due this week")).queryByText("Fractions worksheet")).toBeNull();
    expect(within(cardFor("Section-by-Section Health")).queryByText("Archimedes", { exact: true })).toBeNull();
    expect([countFor("Current grade"), countFor("Passing Rate"), countFor("Late Submissions"), countFor("Attendance Today"), countFor("Term Progress")])
      .toEqual(["—", "—", "—", "—", "—"]);
    expect(screen.getByText("Jose Reyes")).toBeTruthy();
    expect(screen.queryByText("Maria Santos")).toBeNull();
    expect(within(cardFor("Top Performers")).getByText("Dashboard data is unavailable.")).toBeTruthy();
  });

  it("preserves real zero KPIs, empty responses, card order, layout classes, and the 50–100 chart axis", async () => {
    mocks.load.mockResolvedValue(response());
    const { container } = render(<Dashboard />);
    await waitFor(() => expect(countFor("Active Classes")).toBe("0"));
    expect(countFor("Overall Completion")).toBe("0%");
    expect(countFor("Ungraded Queue")).toBe("0");
    expect(screen.queryByText("31 of 36 submitted")).toBeNull();
    expect(screen.getByText("No submissions need grading.")).toBeTruthy();
    expect(screen.getByText("No classwork due this week.")).toBeTruthy();
    expect(screen.getByText("No classes for this academic period.")).toBeTruthy();
    expect(screen.getByText("No published classwork for this selection.")).toBeTruthy();
    expect(chartPoints()).toEqual([]);
    const cards = cardFor("Active Classes").parentElement!.querySelectorAll(':scope > [data-slot="card"]');
    expect(Array.from(cards, (card) => card.querySelector('[data-slot="card-description"]')!.textContent))
      .toEqual(["Active Classes", "Overall Completion", "Ungraded Queue", "Current grade", "Passing Rate", "Late Submissions", "Attendance Today", "Term Progress"]);
    expect(screen.getByTestId("trend-axis").getAttribute("data-domain")).toBe("[50,100]");
    expect(screen.getByTestId("trend-axis").getAttribute("data-ticks")).toBe("[50,75,100]");
    expect(container.querySelector(".grid.grid-cols-1.items-start")?.className).toBe("grid grid-cols-1 items-start gap-4 lg:grid-cols-12 md:gap-4");
    expect(cardFor("Due this week").className).toContain("flex flex-col justify-between p-4 sm:p-5");
  });

  it("uses supplied cards in the existing order and leaves missing Phase 2 metrics unavailable", async () => {
    mocks.load.mockResolvedValue(response({ cards: [
      { title: "Ungraded Queue", count: "0", stat: "0 submissions" },
      { title: "Active Classes", count: "2", stat: "2 sections" },
      { title: "Overall Completion", count: "40%", stat: "4 of 10 submitted" },
      { title: "Unknown metric", count: "999" },
    ] }));
    render(<Dashboard />);
    await waitFor(() => expect(countFor("Active Classes")).toBe("2"));
    expect(countFor("Overall Completion")).toBe("40%");
    expect(countFor("Ungraded Queue")).toBe("0");
    expect(countFor("Current grade")).toBe("—");
    expect(countFor("Term Progress")).toBe("—");
    expect(screen.queryByText("Unknown metric")).toBeNull();
  });

  it("keeps missing KPI fields unavailable instead of inserting mock counts", async () => {
    const partial = response();
    partial.kpis = {} as TeacherDashboardHealthResponse["kpis"];
    mocks.load.mockResolvedValue(partial);
    render(<Dashboard />);
    await waitFor(() => expect(countFor("Active Classes")).toBe("—"));
    expect(countFor("Overall Completion")).toBe("—");
    expect(countFor("Ungraded Queue")).toBe("—");
    expect(within(cardFor("Active Classes")).queryByText("3 sections")).toBeNull();
    expect(within(cardFor("Ungraded Queue")).queryByText("14 submissions")).toBeNull();
  });

  it("renders actual trend points including zero completion and missing mastery", async () => {
    const result = response();
    result.trend_chart.points = [{ classwork_id: 71, title: "Actual task", category: "Assignment", due_date: null,
      label: "Actual task", short_label: "A1", avg_score_percent: null, completion_rate_percent: 0, submitted_count: 0, total_enrolled: 8 }];
    mocks.load.mockResolvedValue(result);
    render(<Dashboard />);
    await waitFor(() => expect(chartPoints()).toEqual(result.trend_chart.points));
    expect(screen.queryByText("No published classwork for this selection.")).toBeNull();
  });

  it("renders real section zeros and missing rates without presenting null as zero percent", async () => {
    mocks.load.mockResolvedValue(response({ section_matrix: [{ class_id: 17, subject_id: 25, section_name: "Real Section", grade_level: "Grade 8",
      subject_name: "Real Subject", student_count: 0, published_classworks: 0, completion_rate_percent: 0,
      avg_score_percent: null, passing_rate_percent: null, attendance_rate_percent: null }] }));
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("Real Section")).toBeTruthy());
    const section = cardFor("Real Section");
    expect(within(section).getByText("0 Students")).toBeTruthy();
    expect(within(section).getAllByText("—")).toHaveLength(3);
    expect(within(section).getAllByText("0%")).toHaveLength(1);
    expect(section.textContent).toContain("Current grade: —");
    expect(section.textContent).toContain("Passing Rate: —");
    fireEvent.click(screen.getByText("Real Section"));
    expect(mocks.navigate).toHaveBeenCalledWith("/teacher/classes/17/25");
  });

  it("maps pending submissions to real names and a Needs grading badge and navigates only real classwork IDs", async () => {
    mocks.load.mockResolvedValue(response({ action_queue: { upcoming_deadlines: [], pending_grading: [
      { submission_id: 41, student_id: "s-2", student_name: "Real Student", classwork_id: 712,
        classwork_title: "Actual review task", section_name: "Real Section", submitted_at: null },
      { submission_id: 42, student_id: "s-3", student_name: "Other Student", classwork_id: null,
        classwork_title: "No classwork link", section_name: "Other Section", submitted_at: null },
    ] } }));
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("Actual review task")).toBeTruthy());
    expect(screen.getByText("Real Student · Real Section")).toBeTruthy();
    expect(within(cardFor("Submissions to Review")).getAllByText("Needs grading")).toHaveLength(2);
    fireEvent.click(screen.getByText("No classwork link"));
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Actual review task"));
    expect(mocks.navigate).toHaveBeenCalledWith("/teacher/classworks/712");
  });

  it("uses real deadlines in API order and derives badge labels in Manila time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T00:00:00Z"));
    mocks.load.mockResolvedValue(response({ action_queue: { pending_grading: [], upcoming_deadlines: [
      { classwork_id: 812, title: "Real deadline", section_name: "Actual Section", due_date: "2026-10-08T17:00:00Z", submitted_count: 0, total_students: 10 },
      { classwork_id: null, title: "Another deadline", section_name: "Other Section", due_date: "2026-10-10T00:00:00Z", submitted_count: 1, total_students: 10 },
    ] } }));
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("Real deadline")).toBeTruthy());
    const rows = cardFor("Due this week").querySelectorAll('[data-slot="card-content"] > [data-slot="card"]');
    expect(Array.from(rows, (row) => row.textContent)).toEqual(["Real deadlineActual SectionTomorrow", "Another deadlineOther SectionOct 10"]);
    expect(screen.getByText("Tomorrow").className).toContain("bg-destructive/70");
    fireEvent.click(screen.getByText("Another deadline"));
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Real deadline"));
    expect(mocks.navigate).toHaveBeenCalledWith("/teacher/classworks/812");
  });

  it("does not turn retained support or lesson mock IDs into navigation targets", async () => {
    mocks.load.mockResolvedValue(response());
    render(<Dashboard />);
    await waitFor(() => expect(countFor("Active Classes")).toBe("0"));
    fireEvent.click(screen.getByText("Jose Reyes"));
    fireEvent.click(within(cardFor("Lesson Mastery")).getAllByRole("button")[0]);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByText("Pang-uri")).toBeTruthy();
  });

  it("requires both a real grade and class for support navigation and uses an actual load for lessons", async () => {
    mocks.classes = [{ class_id: 53, subject_id: 25, subject_name: "Actual Subject" }];
    mocks.load.mockResolvedValue(response({ details: { students_needing_support: [
      { name: "Missing grade", class_id: 53, score: 50, section: "Actual Section" },
      { name: "Missing class", grade_level: 8, score: 50, section: "Actual Section" },
      { name: "Actual support", grade_level: 8, class_id: 53, student_id: "s-5", prediction_id: 45, score: 60, section: "Actual Section" },
    ] } }));
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("Actual support")).toBeTruthy());
    fireEvent.click(screen.getByText("Missing grade"));
    fireEvent.click(screen.getByText("Missing class"));
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Actual support"));
    expect(mocks.navigate).toHaveBeenCalledWith("/teacher/predictions/8/53?predictionId=45&studentId=s-5&studentName=Actual+support");
    fireEvent.click(within(cardFor("Lesson Mastery")).getAllByRole("button")[0]);
    expect(mocks.navigate).toHaveBeenCalledWith("/teacher/classes/53/subjects/25");
  });

  it("waits for academic period initialization before requesting the selected period", async () => {
    mocks.period.isLoading = true;
    mocks.period.selectedPeriodId = null;
    mocks.load.mockResolvedValue(response());
    const page = render(<Dashboard />);
    expect(mocks.load).not.toHaveBeenCalled();
    mocks.period.isLoading = false;
    mocks.period.selectedPeriodId = 3;
    page.rerender(<Dashboard />);
    await waitFor(() => expect(countFor("Active Classes")).toBe("0"));
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith({ academic_period_id: 3, class_id: undefined, subject_id: undefined });
  });

  it("ignores an older period response after the newer request succeeds", async () => {
    const oldRequest = deferred<TeacherDashboardHealthResponse>();
    const newRequest = deferred<TeacherDashboardHealthResponse>();
    mocks.load.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    const page = render(<Dashboard />);
    mocks.period.selectedPeriodId = 4;
    page.rerender(<Dashboard />);
    await act(async () => newRequest.resolve(response({ kpis: { active_classes: 2, enrolled_students: 5, overall_completion_rate: 0, ungraded_count: 0 } })));
    expect(countFor("Active Classes")).toBe("2");
    await act(async () => oldRequest.resolve(response({ kpis: { active_classes: 99, enrolled_students: 99, overall_completion_rate: 99, ungraded_count: 99 } })));
    expect(countFor("Active Classes")).toBe("2");
    expect(countFor("Ungraded Queue")).toBe("0");
    expect(mocks.load.mock.calls.map(([params]) => params.academic_period_id)).toEqual([3, 4]);
  });

  it("clears prior period rows while loading and ignores a cancelled request error", async () => {
    const result = response();
    result.trend_chart.available_filters = [{ class_id: 17, subject_id: 25, section_name: "Previous section", subject_name: "Previous subject" }];
    const oldFilteredRequest = deferred<TeacherDashboardHealthResponse>();
    const newRequest = deferred<TeacherDashboardHealthResponse>();
    mocks.load.mockResolvedValueOnce(result).mockReturnValueOnce(oldFilteredRequest.promise).mockReturnValueOnce(newRequest.promise);
    const page = render(<Dashboard />);
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
    mocks.period.selectedPeriodId = 4;
    page.rerender(<Dashboard />);
    expect(screen.queryByText("Previous section · Previous subject")).toBeNull();
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(3));
    expect(mocks.load.mock.calls[2][0]).toEqual({ academic_period_id: 4, class_id: undefined, subject_id: undefined });
    await act(async () => oldFilteredRequest.reject(new Error("Cancelled period error")));
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => newRequest.resolve(response()));
    expect(countFor("Active Classes")).toBe("0");
  });

  it("hides the previous section trend while a new selection loads or fails and keeps filter options", async () => {
    const sectionA = response();
    sectionA.trend_chart.available_filters = [
      { class_id: 17, subject_id: 25, section_name: "Section A", subject_name: "Subject A" },
      { class_id: 18, subject_id: 26, section_name: "Section B", subject_name: "Subject B" },
    ];
    sectionA.trend_chart.points = [{ classwork_id: 71, title: "Section A task", category: "Assignment", due_date: null,
      label: "A task", short_label: "A1", avg_score_percent: 85, completion_rate_percent: 50, submitted_count: 4, total_enrolled: 8 }];
    const sectionBRequest = deferred<TeacherDashboardHealthResponse>();
    mocks.load.mockResolvedValueOnce(sectionA).mockResolvedValueOnce(sectionA).mockReturnValueOnce(sectionBRequest.promise);
    render(<Dashboard />);
    await waitFor(() => expect(chartPoints()).toEqual(sectionA.trend_chart.points));
    fireEvent.change(screen.getByRole("combobox", { name: "Trend section" }), { target: { value: "18-26" } });
    expect(chartPoints()).toEqual([]);
    expect(screen.getByRole("combobox", { name: "Trend section" })).toBeTruthy();
    expect(mocks.load.mock.calls[2][0]).toEqual({ academic_period_id: 3, class_id: 18, subject_id: 26 });
    await act(async () => sectionBRequest.reject(new Error("Section B failed")));
    expect(screen.getByRole("alert").textContent).toContain("Section B failed");
    expect(chartPoints()).toEqual([]);
    expect(within(cardFor("Classwork Performance & Completion Trend")).getByText("Dashboard data is unavailable.")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("ignores an older selected-section response after a newer selection succeeds", async () => {
    const initial = response();
    initial.trend_chart.available_filters = [
      { class_id: 17, subject_id: 25, section_name: "Section A", subject_name: "Subject A" },
      { class_id: 18, subject_id: 26, section_name: "Section B", subject_name: "Subject B" },
    ];
    const sectionARequest = deferred<TeacherDashboardHealthResponse>();
    const sectionBRequest = deferred<TeacherDashboardHealthResponse>();
    mocks.load.mockResolvedValueOnce(initial).mockReturnValueOnce(sectionARequest.promise).mockReturnValueOnce(sectionBRequest.promise);
    render(<Dashboard />);
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByRole("combobox", { name: "Trend section" }), { target: { value: "18-26" } });
    expect(chartPoints()).toEqual([]);
    const sectionB = response({ trend_chart: { ...initial.trend_chart, selected_class_id: 18, selected_subject_id: 26, points: [
      { classwork_id: 72, title: "Section B task", category: "Assignment", due_date: null,
        label: "B task", short_label: "B1", avg_score_percent: 90, completion_rate_percent: 75, submitted_count: 6, total_enrolled: 8 },
    ] } });
    await act(async () => sectionBRequest.resolve(sectionB));
    expect(chartPoints()).toEqual(sectionB.trend_chart.points);
    await act(async () => sectionARequest.resolve(initial));
    expect(chartPoints()).toEqual(sectionB.trend_chart.points);
    expect((screen.getByRole("combobox", { name: "Trend section" }) as HTMLSelectElement).value).toBe("18-26");
  });
});

// All Phase 2 cases are mocked component behavior tests. Aggregation and policy
// arithmetic live in the dashboard-only backend helpers, not this page.
describe("teacher dashboard Phase 2 mocked component behavior", () => {
  it("renders current grade points, coverage, real overview metrics and no invented trend deltas", async () => {
    mocks.load.mockResolvedValue(phaseTwoResponse());
    render(<Dashboard />);
    await waitFor(() => expect(countFor("Current grade")).toBe("80.5"));
    expect(within(cardFor("Current grade")).getByText(/2 of 3 student-subject grades available/)).toBeTruthy();
    expect(within(cardFor("Current grade")).getByText(/Weighted and transmuted, as in the class record/)).toBeTruthy();
    expect(countFor("Passing Rate")).toBe("50%");
    expect(within(cardFor("Passing Rate")).getByText("1 of 2 available grades pass.")).toBeTruthy();
    expect(within(cardFor("Passing Rate")).getByText(/Passing grade is set per subject group/)).toBeTruthy();
    expect(countFor("Late Submissions")).toBe("25%");
    expect(within(cardFor("Late Submissions")).getByText("1 of 4 assessed submissions are late.")).toBeTruthy();
    expect(within(cardFor("Late Submissions")).getByText(/2 excused submissions excluded/)).toBeTruthy();
    expect(countFor("Attendance Today")).toBe("2 / 4");
    expect(within(cardFor("Attendance Today")).getByText(/1 late · 1 absent · 1 excused/)).toBeTruthy();
    expect(countFor("Term Progress")).toBe("Week 2");
    expect(within(cardFor("Term Progress")).getByText(/Calendar progress in Term 2/)).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Term Progress: 40%" })).toBeTruthy();
    expect(screen.queryByText("Class Average")).toBeNull();
    expect(screen.queryByText(/▲ 3 pts|▲ 2 pts|at or above 75%/)).toBeNull();
    // Deferred detail widgets retain their existing behavior, not Phase 2 cards.
    expect(screen.queryByText("Maria Santos")).toBeNull();
    expect(within(cardFor("Top Performers")).getByText("Current-grade details are unavailable.")).toBeTruthy();
    expect(screen.getByText("Pang-uri")).toBeTruthy();
  });

  it("uses the real backend cards without losing excluded counts or threshold warnings", async () => {
    const result = phaseTwoResponse({ cards: [
      { title: "Current grade", count: "80.5", stat: "2 of 3 student-subject grades available",
        statDescription: "Weighted and transmuted, as in the class record." },
      { title: "Late Submissions", count: "25%", stat: "1 of 4 assessed submissions · 2 excused excluded",
        statDescription: "Late submissions, excluding excused submissions." },
      { title: "Passing Rate", count: "—", stat: "2 of 3 student-subject grades available",
        statDescription: "Passing rate unavailable: subject-group passing grade is missing or invalid." },
      { title: "Term Progress", count: "Ended", stat: "of 5", statDescription: "Calendar progress in Term 2.", progressValue: 100 },
    ] });
    mocks.load.mockResolvedValue(result);
    render(<Dashboard />);
    await waitFor(() => expect(countFor("Current grade")).toBe("80.5"));
    expect(countFor("Passing Rate")).toBe("—");
    expect(within(cardFor("Passing Rate")).getByText(/Passing rate unavailable/)).toBeTruthy();
    expect(within(cardFor("Late Submissions")).getByText(/2 excused submissions excluded/)).toBeTruthy();
    expect(countFor("Term Progress")).toBe("Ended");
  });

  it.each([75, 83, 85, 82.25].flatMap((threshold) => [-0.25, 0, 0.25].map((delta) => ({ threshold, delta }))))(
    "renders runtime threshold $threshold at its derived boundary delta $delta, with a neutral cohort passing badge", async ({ threshold, delta }) => {
      const grade = threshold + delta;
      const section = { ...phaseTwoSection(), current_grade: grade, passing_threshold: threshold,
        current_grade_meets_threshold: delta >= 0 };
      mocks.load.mockResolvedValue(phaseTwoResponse({ section_matrix: [section] }));
      render(<Dashboard />);
      await waitFor(() => expect(screen.getByText("Actual Section")).toBeTruthy());
      const row = cardFor("Actual Section");
      const gradeBadge = within(row).getByText(String(grade), { exact: true });
      expect(gradeBadge.getAttribute("title")).toBe(`Passing grade is set per subject group: ${threshold}. Compared before display rounding.`);
      expect(gradeBadge.className).toContain(delta >= 0 ? "bg-success" : "bg-destructive");
      const passingBadge = within(row).getAllByText("50%").find((element) => element.parentElement?.textContent?.includes("Passing Rate:"));
      expect(passingBadge?.className).toContain("bg-primary");
      expect(passingBadge?.className).not.toMatch(/bg-destructive|bg-success/);
      expect(row.textContent).toContain("Current grade:");
      expect(row.textContent).toContain("2 of 3 student-subject grades available.");
      expect(row.textContent).not.toContain("Class Average:");
    },
  );

  it("shows missing-threshold configuration warnings without discarding valid grade points or inventing a passing rate", async () => {
    const warning = { code: "invalid_passing_threshold", message: "Passing rate unavailable: subject-group passing grade is missing or invalid.", subject_id: 25 };
    const result = phaseTwoResponse({ section_matrix: [{ ...phaseTwoSection(), passing_rate_percent: null,
      passing_count: null, passing_threshold: null, current_grade_meets_threshold: null, warnings: [warning] }] });
    result.phase_two!.grades = { ...result.phase_two!.grades, passing_rate_percent: null, passing_count: null, warnings: [warning] };
    mocks.load.mockResolvedValue(result);
    render(<Dashboard />);
    await waitFor(() => expect(countFor("Current grade")).toBe("80.5"));
    expect(countFor("Passing Rate")).toBe("—");
    expect(within(cardFor("Passing Rate")).getByText(/subject-group passing grade is missing or invalid/)).toBeTruthy();
    expect(within(cardFor("Passing Rate")).queryByText(/0 of 2 available grades/)).toBeNull();
    const row = cardFor("Actual Section");
    expect(within(row).getByText(/subject-group passing grade is missing or invalid/)).toBeTruthy();
    expect(row.textContent).toContain("Passing Rate: —");
    expect(within(row).getByText("80.5", { exact: true }).className).not.toMatch(/bg-destructive|bg-success/);
  });

  it("uses the backend's pre-rounding threshold classification rather than comparing rounded display grades", async () => {
    mocks.load.mockResolvedValue(phaseTwoResponse({ section_matrix: [{ ...phaseTwoSection(), current_grade: 85,
      passing_threshold: 85, current_grade_meets_threshold: false }] }));
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("Actual Section")).toBeTruthy());
    const badge = within(cardFor("Actual Section")).getByText("85", { exact: true });
    expect(badge.className).toContain("bg-destructive");
    expect(badge.getAttribute("title")).toContain("Compared before display rounding.");
  });

  it("keeps mixed-group aggregate grades neutral and renders each subject's own threshold result", async () => {
    const core = { ...phaseTwoSection(), section_name: "Shared Section", subject_name: "Core Subject", current_grade: 84,
      passing_threshold: 85, current_grade_meets_threshold: false, passing_rate_percent: 0 };
    const other = { ...phaseTwoSection(), subject_id: 26, section_name: "Shared Section", subject_name: "Other Subject", current_grade: 84,
      passing_threshold: 83, current_grade_meets_threshold: true, passing_rate_percent: 100 };
    const mixed = { ...phaseTwoSection(), class_id: 18, section_name: "Mixed Section", current_grade: 84,
      passing_threshold: null, current_grade_meets_threshold: null };
    mocks.load.mockResolvedValue(phaseTwoResponse({ section_matrix: [core, other, mixed] }));
    render(<Dashboard />);
    await waitFor(() => expect(screen.getAllByText("Shared Section")).toHaveLength(2));
    const sharedRows = screen.getAllByText("Shared Section").map((element) => element.closest<HTMLElement>('[data-slot="card"]')!);
    expect(within(sharedRows[0]).getByText("84", { exact: true }).className).toContain("bg-destructive");
    expect(within(sharedRows[1]).getByText("84", { exact: true }).className).toContain("bg-success");
    fireEvent.click(screen.getByRole("button", { name: "Show all classes" }));
    expect(within(cardFor("Mixed Section")).getByText("84", { exact: true }).className).not.toMatch(/bg-destructive|bg-success/);
    expect(countFor("Current grade")).not.toContain("%");
  });

  it("shows genuine zero metrics, no-grade coverage and monthly no-record dashes rather than demo values", async () => {
    const result = phaseTwoResponse({ details: { attendance_by_section: [{ class_id: 17, section: "Actual Section", rate: null,
      record_count: 0, present_count: 0, late_count: 0, excused_count: 0, absent_count: 0 }] } });
    result.phase_two!.grades = { ...result.phase_two!.grades, current_grade: null, passing_rate_percent: null,
      available_grade_count: 0, total_grade_count: 3, passing_count: null };
    result.phase_two!.attendance_today = { rate: null, record_count: 0, present_count: 0, late_count: 0, excused_count: 0, absent_count: 0 };
    result.phase_two!.late_submissions = { ...result.phase_two!.late_submissions, late_rate_percent: 0, late_count: 0,
      eligible_count: 4, excused_excluded_count: 0, completed_count: 4 };
    result.phase_two!.weekdays = { ...result.phase_two!.weekdays, days: result.phase_two!.weekdays.days.map((day) => ({ ...day, count: 0 })),
      sunday_count: 0, total_count: 0 };
    mocks.load.mockResolvedValue(result);
    render(<Dashboard />);
    await waitFor(() => expect(countFor("Late Submissions")).toBe("0%"));
    expect(countFor("Current grade")).toBe("—");
    expect(countFor("Attendance Today")).toBe("—");
    expect(within(cardFor("Current grade")).getByText(/No current grades available/)).toBeTruthy();
    expect(within(cardFor("Current grade")).getByText(/0 of 3 student-subject grades available/)).toBeTruthy();
    const attendance = cardFor("Attendance by section");
    expect(within(attendance).getByText("No attendance records this month for the selected period.")).toBeTruthy();
    expect(within(attendance).getByText("—", { exact: true })).toBeTruthy();
    expect(within(attendance).queryByText("0%", { exact: true })).toBeNull();
    expect(within(cardFor("Submissions by weekday")).getAllByText("0", { exact: true })).toHaveLength(6);
    expect(within(cardFor("Submissions by weekday")).getByText("Selected period · Manila time · Sunday: 0.")).toBeTruthy();
    expect(screen.queryByText(/Last 20 school days/)).toBeNull();
  });

  it("keeps six Monday-Saturday rows, shows Sunday's real count, and exposes sparse monthly record counts", async () => {
    mocks.load.mockResolvedValue(phaseTwoResponse({ details: { attendance_by_section: [{ class_id: 17, section: "Actual Section", rate: 100,
      record_count: 1, present_count: 0, late_count: 1, excused_count: 0, absent_count: 0 }] } }));
    render(<Dashboard />);
    await waitFor(() => expect(countFor("Current grade")).toBe("80.5"));
    const weekdays = cardFor("Submissions by weekday");
    expect(within(weekdays).getAllByRole("progressbar")).toHaveLength(6);
    expect(weekdays.textContent).toContain("Selected period · Manila time · Sunday: 2.");
    const rows = weekdays.querySelectorAll('[data-slot="card-content"] > div');
    expect(Array.from(rows, (row) => row.textContent)).toEqual(["M2", "T0", "W3", "Th1", "F4", "S0"]);
    expect(weekdays.querySelectorAll('[data-slot="card-content"] > div')).toHaveLength(6);
    const attendance = cardFor("Attendance by section");
    expect(within(attendance).getByText("100%")).toBeTruthy();
    expect(within(attendance).getByTitle("1 recorded entry.")).toBeTruthy();
    expect(within(attendance).getByText("This month · Present + late / recorded entries. Excused and absent do not count as present.")).toBeTruthy();
    expect(within(attendance).queryByText(/No attendance records/)).toBeNull();
  });

  it("renders late-data warnings as unavailable instead of displaying a complete-looking rate", async () => {
    const result = phaseTwoResponse();
    result.phase_two!.late_submissions = { ...result.phase_two!.late_submissions, late_rate_percent: null,
      warnings: [{ code: "missing_submission_timestamp", message: "Late submission rate unavailable: submission timestamps are missing." }] };
    mocks.load.mockResolvedValue(result);
    render(<Dashboard />);
    await waitFor(() => expect(countFor("Late Submissions")).toBe("—"));
    expect(within(cardFor("Late Submissions")).getByText(/submission timestamps are missing/)).toBeTruthy();
    expect(within(cardFor("Late Submissions")).getByText(/2 excused submissions excluded/)).toBeTruthy();
  });

  it("clears old monthly and overview metrics on a period change and ignores a stale Phase 2 response", async () => {
    const initial = phaseTwoResponse({ details: { attendance_by_section: [{ class_id: 17, section: "Old Monthly Section", rate: 100,
      record_count: 1, present_count: 1, late_count: 0, excused_count: 0, absent_count: 0 }] } });
    const older = deferred<TeacherDashboardHealthResponse>();
    const newer = deferred<TeacherDashboardHealthResponse>();
    mocks.load.mockResolvedValueOnce(initial).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const page = render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("Old Monthly Section")).toBeTruthy());
    mocks.period.selectedPeriodId = 4;
    page.rerender(<Dashboard />);
    expect(screen.queryByText("Old Monthly Section")).toBeNull();
    expect(within(cardFor("Attendance by section")).getByText("Loading dashboard data...")).toBeTruthy();
    mocks.period.selectedPeriodId = 5;
    page.rerender(<Dashboard />);
    const latest = phaseTwoResponse();
    latest.phase_two!.grades.current_grade = 90;
    latest.phase_two!.weekdays.sunday_count = 0;
    await act(async () => newer.resolve(latest));
    expect(countFor("Current grade")).toBe("90");
    expect(within(cardFor("Submissions by weekday")).getByText("Selected period · Manila time · Sunday: 0.")).toBeTruthy();
    const stale = phaseTwoResponse();
    stale.phase_two!.grades.current_grade = 1;
    stale.phase_two!.weekdays.sunday_count = 99;
    await act(async () => older.resolve(stale));
    expect(countFor("Current grade")).toBe("90");
    expect(within(cardFor("Submissions by weekday")).queryByText(/Sunday: 99/)).toBeNull();
    expect(mocks.load.mock.calls.map(([params]) => params.academic_period_id)).toEqual([3, 4, 5]);
  });

  it("keeps Phase 2 chart areas unavailable while loading and after a request failure", async () => {
    const request = deferred<TeacherDashboardHealthResponse>();
    mocks.load.mockReturnValueOnce(request.promise);
    render(<Dashboard />);
    const weekdayCard = cardFor("Submissions by weekday");
    expect(within(weekdayCard).getAllByText("—", { exact: true })).toHaveLength(6);
    expect(weekdayCard.textContent).toContain("Sunday: —");
    expect(within(cardFor("Attendance by section")).getByText("Loading dashboard data...")).toBeTruthy();
    await act(async () => request.reject(new Error("Phase 2 request failed")));
    expect(screen.getByRole("alert").textContent).toContain("Phase 2 request failed");
    expect(within(cardFor("Attendance by section")).getByText("Dashboard data is unavailable.")).toBeTruthy();
    expect(within(weekdayCard).getAllByText("—", { exact: true })).toHaveLength(6);
    expect(countFor("Current grade")).toBe("—");
  });

  it("renders Not started and invalid-calendar warnings without inventing Week 0 or progress", async () => {
    const initial = phaseTwoResponse();
    initial.phase_two!.term_progress = { ...initial.phase_two!.term_progress!, progress_percent: 0, elapsed_days: 0, week_number: 0 };
    const invalid = phaseTwoResponse();
    invalid.phase_two!.term_progress = { ...invalid.phase_two!.term_progress!, progress_percent: null,
      warnings: [{ code: "invalid_period_dates", message: "Calendar progress unavailable: invalid period dates." }] };
    mocks.load.mockResolvedValueOnce(initial).mockResolvedValueOnce(invalid);
    const page = render(<Dashboard />);
    await waitFor(() => expect(countFor("Term Progress")).toBe("Not started"));
    expect(screen.queryByText("Week 0")).toBeNull();
    mocks.period.selectedPeriodId = 4;
    page.rerender(<Dashboard />);
    await waitFor(() => expect(countFor("Term Progress")).toBe("—"));
    expect(within(cardFor("Term Progress")).getByText(/Calendar progress unavailable: invalid period dates/)).toBeTruthy();
    expect(within(cardFor("Term Progress")).queryByRole("progressbar")).toBeNull();
  });
});


function phaseThreeResponse(): TeacherDashboardHealthResponse {
  return phaseTwoResponse({ details: {
    top_performers: [
      { student_id: "learner-a", class_id: 17, subject_id: 25, academic_period_id: 3,
        name: "Learner, Alex", section_name: "Actual Section", subject_name: "Mathematics", current_grade: 95 },
      { student_id: "learner-a", class_id: 19, subject_id: 27, academic_period_id: 3,
        name: "Learner, Alex", section_name: "Other Actual Section", subject_name: "History", current_grade: 84.99 },
      { student_id: "learner-b", class_id: 17, subject_id: 25, academic_period_id: 3,
        name: "Learner, Blake", section_name: "Actual Section", subject_name: "Mathematics", current_grade: 75 },
    ],
    grade_distribution: [
      { band: "90-100", count: 1 }, { band: "85-89", count: 0 }, { band: "80-84", count: 1 },
      { band: "75-79", count: 1 }, { band: "Below 75", count: 0 },
    ],
    grade_details: { total_grade_count: 4, available_grade_count: 3, unavailable_grade_count: 1,
      top_performer_limit: 3, cutoff_tie_omitted_count: 0, warnings: [] },
  } });
}

// Part 1: mocked component behavior, preserving the existing card structure.
describe("teacher dashboard small UI fixes", () => {
  it("keeps the complete Below 75 label and top-aligns uniformly styled weekday bars", async () => {
    mocks.load.mockResolvedValue(phaseThreeResponse());
    render(<Dashboard />);
    await waitFor(() => expect(countFor("Current grade")).toBe("80.5"));
    const label = within(cardFor("Grade distribution")).getByText("Below 75", { exact: true });
    expect(label.className).toContain("w-20 whitespace-nowrap");
    expect(label.className).not.toContain("truncate");
    const weekday = cardFor("Submissions by weekday");
    expect(weekday.className).toContain("justify-start");
    expect(weekday.className).not.toContain("justify-between");
    const bars = within(weekday).getAllByRole("progressbar");
    expect(bars).toHaveLength(6);
    expect(bars.every((bar) => !bar.className.includes("bg-success"))).toBe(true);
    expect(new Set(bars.map((bar) => bar.className)).size).toBe(1);
  });

  it("separates metric sentences without repeating policy text, including singular exclusions", async () => {
    const result = phaseThreeResponse();
    result.phase_two!.late_submissions.excused_excluded_count = 1;
    mocks.load.mockResolvedValue(result);
    render(<Dashboard />);
    await waitFor(() => expect(countFor("Current grade")).toBe("80.5"));
    expect(cardFor("Current grade").textContent).toContain("available. Weighted and transmuted, as in the class record.");
    expect(cardFor("Passing Rate").textContent).toContain("grades pass. Passing grade is set per subject group.");
    expect(cardFor("Passing Rate").textContent?.match(/Passing grade is set per subject group/g)).toHaveLength(1);
    expect(cardFor("Late Submissions").textContent).toContain("are late. 1 excused submission excluded.");
    expect(cardFor("Late Submissions").textContent).not.toContain("Late submissions, excluding");
  });
});

describe("teacher dashboard Phase 3 mocked component behavior", () => {
  it("renders real student-subject grade points, neutral bands and explicit coverage without demo data", async () => {
    mocks.load.mockResolvedValue(phaseThreeResponse());
    render(<Dashboard />);
    const top = cardFor("Top Performers");
    const bands = cardFor("Grade distribution");
    await waitFor(() => expect(within(top).getAllByText("Learner, Alex")).toHaveLength(2));
    expect(within(top).getByText("Other Actual Section · History")).toBeTruthy();
    expect(within(top).getByText("84.99", { exact: true })).toBeTruthy();
    expect(within(top).queryByText("84.99%")).toBeNull();
    expect(within(top).getAllByTitle("Current grade").every((badge) => !badge.className.includes("bg-success"))).toBe(true);
    expect(Array.from(bands.querySelectorAll('[data-slot="card-content"] > div'), (row) => row.textContent))
      .toEqual(["90-1001", "85-890", "80-841", "75-791", "Below 750"]);
    expect(within(bands).getAllByRole("progressbar")).toHaveLength(5);
    for (const bar of within(bands).getAllByRole("progressbar")) {
      expect(bar.firstElementChild?.className).toContain("bg-muted-foreground");
      expect(bar.firstElementChild?.className).not.toMatch(/bg-success|bg-destructive/);
    }
    for (const card of [top, bands]) {
      expect(card.textContent).toContain("3 of 4 student-subject grades available.");
      expect(card.textContent).toContain("Unavailable: 1.");
    }
    expect(screen.queryByText("Maria Santos")).toBeNull();
    expect(within(bands).queryByText("80-89")).toBeNull();
    expect(within(bands).getByText("Bands use unrounded grades and do not indicate passing.")).toBeTruthy();
    expect(screen.getByText("Jose Reyes")).toBeTruthy(); // Untouched later-phase demo.
  });

  it.each([0, 2])("shows cutoff tie text only for actually omitted entries (%s)", async (omitted) => {
    const result = phaseThreeResponse();
    result.details!.grade_details!.cutoff_tie_omitted_count = omitted;
    mocks.load.mockResolvedValue(result);
    render(<Dashboard />);
    await waitFor(() => expect(within(cardFor("Top Performers")).getAllByTitle("Current grade")).toHaveLength(3));
    const message = within(cardFor("Top Performers")).queryByText(/additional .*cutoff grade/);
    expect(Boolean(message)).toBe(omitted > 0);
    if (omitted) expect(message?.textContent).toContain("2 additional entries share the cutoff grade");
  });

  it.each([
    { total: 0, message: "No student-subject grades for this academic period." },
    { total: 4, message: "No Current grades available." },
  ])("distinguishes empty scope from all missing grades ($total)", async ({ total, message }) => {
    const result = phaseThreeResponse();
    result.details!.top_performers = [];
    result.details!.grade_distribution!.forEach((band) => { band.count = 0; });
    Object.assign(result.details!.grade_details!, { total_grade_count: total, available_grade_count: 0, unavailable_grade_count: total });
    mocks.load.mockResolvedValue(result);
    render(<Dashboard />);
    for (const title of ["Top Performers", "Grade distribution"]) {
      await waitFor(() => expect(within(cardFor(title)).getByText(message)).toBeTruthy());
      expect(cardFor(title).textContent).toContain(`Unavailable: ${total}.`);
      expect(within(cardFor(title)).queryByRole("progressbar")).toBeNull();
      expect(within(cardFor(title)).queryByTitle("Current grade")).toBeNull();
    }
  });

  it("preserves configuration warnings, authorization coverage and missing-name grade entries", async () => {
    const result = phaseThreeResponse();
    result.details!.top_performers![0].name = "Name unavailable";
    result.details!.grade_details!.warnings = [
      { code: "invalid_passing_threshold", message: "Passing rate unavailable: subject-group passing grade is missing or invalid." },
      { code: "grade_scope_unavailable", message: "Current grade unavailable for this teacher scope." },
      { code: "student_name_unavailable", message: "Student name unavailable for one or more Current-grade entries." },
    ];
    mocks.load.mockResolvedValue(result);
    render(<Dashboard />);
    await waitFor(() => expect(within(cardFor("Top Performers")).getByText("Name unavailable")).toBeTruthy());
    expect(within(cardFor("Top Performers")).getByText("95", { exact: true })).toBeTruthy();
    for (const title of ["Top Performers", "Grade distribution"]) {
      for (const warning of result.details!.grade_details!.warnings) {
        expect(cardFor(title).textContent).toContain(warning.message);
      }
    }
    expect(within(cardFor("Grade distribution")).getAllByRole("progressbar")).toHaveLength(5);
  });

  it("keeps a same-student same-subject entry in each class without averaging", async () => {
    const result = phaseThreeResponse();
    Object.assign(result.details!.top_performers![1], { subject_id: 25, subject_name: "Mathematics" });
    mocks.load.mockResolvedValue(result);
    render(<Dashboard />);
    const top = cardFor("Top Performers");
    await waitFor(() => expect(within(top).getAllByText("Learner, Alex")).toHaveLength(2));
    expect(within(top).getByText("95", { exact: true })).toBeTruthy();
    expect(within(top).getByText("84.99", { exact: true })).toBeTruthy();
    expect(within(top).getByText("Other Actual Section · Mathematics")).toBeTruthy();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("keeps both cards unavailable while loading, after failure and when contract fields are missing", async () => {
    const request = deferred<TeacherDashboardHealthResponse>();
    mocks.load.mockReturnValueOnce(request.promise);
    const page = render(<Dashboard />);
    for (const title of ["Top Performers", "Grade distribution"]) {
      expect(within(cardFor(title)).getByText("Loading dashboard data...")).toBeTruthy();
    }
    await act(async () => request.reject(new Error("Phase 3 request failed")));
    expect(screen.getByRole("alert").textContent).toContain("Phase 3 request failed");
    for (const title of ["Top Performers", "Grade distribution"]) {
      expect(within(cardFor(title)).getByText("Dashboard data is unavailable.")).toBeTruthy();
    }
    mocks.load.mockResolvedValueOnce(phaseTwoResponse());
    mocks.period.selectedPeriodId = 4;
    page.rerender(<Dashboard />);
    for (const title of ["Top Performers", "Grade distribution"]) {
      await waitFor(() => expect(within(cardFor(title)).getByText("Current-grade details are unavailable.")).toBeTruthy());
    }
    expect(screen.queryByText("Maria Santos")).toBeNull();
  });

  it("clears old grade rows on period changes and ignores stale responses", async () => {
    const old = deferred<TeacherDashboardHealthResponse>();
    const newer = deferred<TeacherDashboardHealthResponse>();
    mocks.load.mockResolvedValueOnce(phaseThreeResponse()).mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise);
    const page = render(<Dashboard />);
    await waitFor(() => expect(within(cardFor("Top Performers")).getAllByText("Learner, Alex")).toHaveLength(2));
    mocks.period.selectedPeriodId = 4;
    page.rerender(<Dashboard />);
    expect(screen.queryByText("Learner, Alex")).toBeNull();
    mocks.period.selectedPeriodId = 5;
    page.rerender(<Dashboard />);
    const result = phaseThreeResponse();
    result.details!.top_performers!.forEach((row) => { row.name = "New period learner"; row.academic_period_id = 5; });
    await act(async () => newer.resolve(result));
    await waitFor(() => expect(within(cardFor("Top Performers")).getAllByText("New period learner")).toHaveLength(3));
    await act(async () => old.resolve(phaseThreeResponse()));
    expect(screen.queryByText("Learner, Alex")).toBeNull();
    expect(within(cardFor("Top Performers")).getAllByText("New period learner")).toHaveLength(3);
  });
});


function phaseFourResponse(): TeacherDashboardHealthResponse {
  const result = phaseThreeResponse();
  result.engagement = {
    expected_count: 318, completed_count: 313, pending_grading_count: 0,
    resolved_completed_count: 313, resolved_pending_grading_count: 0,
    completion_rate_percent: 98.4, avg_score_percent: 82.9,
    scored_count: 313, graded_task_count: 26, warnings: [],
  };
  result.kpis = { active_classes: 4, enrolled_students: 46, overall_completion_rate: 98.4, ungraded_count: 0 };
  result.trend_chart = { ...result.trend_chart, has_sufficient_data: true, graded_task_count: 6,
    date_group_count: 2, warnings: [], points: [
      { classwork_id: 71, date_key: "2026-10-04", assignment_ids: [1], task_count: 1, title: "1 task",
        category: "Grouped tasks", due_date: null, label: "Oct 04", short_label: "Oct 04", avg_score_percent: 95.5,
        completion_rate_percent: 100, submitted_count: 3, total_enrolled: 3, eligible_count: 3, scored_count: 3, graded_task_count: 1, warnings: [] },
      { classwork_id: null, date_key: "2026-10-08", assignment_ids: [2, 3, 4, 5, 6], task_count: 5, title: "5 tasks",
        category: "Grouped tasks", due_date: null, label: "Oct 08", short_label: "Oct 08", avg_score_percent: 95.4,
        completion_rate_percent: 100, submitted_count: 15, total_enrolled: 15, eligible_count: 15, scored_count: 15, graded_task_count: 5, warnings: [] },
    ] };
  result.phase_two!.late_submissions = { late_rate_percent: 0.3, late_count: 1, eligible_count: 312,
    excused_excluded_count: 1, completed_count: 313, warnings: [] };
  result.phase_two!.weekdays = { days: [45, 44, 44, 45, 44, 44].map((count, day_index) => ({
    label: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day_index], day_index, count,
  })), sunday_count: 47, total_count: 313, warnings: [] };
  return result;
}


// Phase 4 tests are mocked component-behavior tests, with no live requests.
describe("teacher dashboard Phase 4 engagement rendering", () => {
  it("uses eligible completion counts and keeps seeded weekdays, lateness and an empty review queue", async () => {
    mocks.load.mockResolvedValue(phaseFourResponse());
    render(<Dashboard />);
    await waitFor(() => expect(countFor("Overall Completion")).toBe("98%"));
    expect(cardFor("Overall Completion").textContent).toContain("313 of 318 submitted.");
    expect(cardFor("Overall Completion").textContent).toContain("eligible student-task requirements");
    expect(countFor("Ungraded Queue")).toBe("0");
    expect(within(cardFor("Submissions to Review")).getByText("No submissions need grading.")).toBeTruthy();
    expect(countFor("Late Submissions")).toBe("0.3%");
    expect(cardFor("Late Submissions").textContent).toContain("1 of 312 assessed submissions are late. 1 excused submission excluded.");
    const weekday = cardFor("Submissions by weekday");
    expect(Array.from(weekday.querySelectorAll('[data-slot="card-content"] > div'), (row) => row.textContent))
      .toEqual(["M45", "T44", "W44", "Th45", "F44", "S44"]);
    expect(weekday.textContent).toContain("Sunday: 47.");
  });

  it("renders one/two grouped date points without hiding them or inventing task IDs, retaining the chart axis", async () => {
    const result = phaseFourResponse();
    result.trend_chart.has_sufficient_data = false;
    mocks.load.mockResolvedValue(result);
    mocks.tooltipPoint = result.trend_chart.points[1];
    render(<Dashboard />);
    await waitFor(() => expect(chartPoints()).toEqual(result.trend_chart.points));
    expect(screen.getByText("Classwork Performance & Completion Trend")).toBeTruthy();
    expect(screen.queryByText("Classwork Mastery & Completion Trend")).toBeNull();
    expect(screen.getByText("Average task score (%)")).toBeTruthy();
    expect(screen.getByText("Submission completion (%)")).toBeTruthy();
    expect(chartPoints().map((point: TrendChartPoint) => point.short_label)).toEqual(["Oct 04", "Oct 08"]);
    expect(chartPoints()[1].classwork_id).toBeNull();
    expect(screen.getByText("Oct 08 · 5 tasks")).toBeTruthy();
    expect(screen.getByText("Average task score: 95.4%")).toBeTruthy();
    expect(screen.getByText("15 scored of 15 eligible student-task requirements.")).toBeTruthy();
    expect(screen.getByText("Grouped by Manila deadline date; publish or creation date used when no deadline exists. Raw task scores, not Current grades.")).toBeTruthy();
    expect(screen.getByTestId("trend-axis").getAttribute("data-domain")).toBe("[50,100]");
    expect(screen.getByTestId("trend-axis").getAttribute("data-ticks")).toBe("[50,75,100]");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("keeps ambiguous totals unavailable and resolved review entries visible with an incomplete warning", async () => {
    const result = phaseFourResponse();
    const warning = { code: "ambiguous_submission_attempts", message: "Submission metrics unavailable: ambiguous duplicate submissions.", assignment_id: 1 };
    Object.assign(result.engagement!, { completed_count: null, pending_grading_count: null, completion_rate_percent: null,
      resolved_completed_count: 1, resolved_pending_grading_count: 1, warnings: [warning] });
    result.action_queue.pending_grading = [{ submission_id: 44, student_id: "synthetic", student_name: "Synthetic Learner",
      classwork_id: 555, classwork_title: "Resolved review", section_name: "Actual Section", submitted_at: null }];
    result.trend_chart.warnings = [warning];
    result.trend_chart.points[0].completion_rate_percent = null;
    result.trend_chart.points[0].avg_score_percent = null;
    mocks.tooltipPoint = result.trend_chart.points[0];
    mocks.load.mockResolvedValue(result);
    render(<Dashboard />);
    await waitFor(() => expect(countFor("Overall Completion")).toBe("—"));
    expect(countFor("Ungraded Queue")).toBe("—");
    expect(cardFor("Overall Completion").textContent).toContain("1 resolved of 318 expected.");
    for (const title of ["Overall Completion", "Ungraded Queue", "Submissions to Review", "Classwork Performance & Completion Trend"]) {
      expect(cardFor(title).textContent).toContain(warning.message);
    }
    expect(within(cardFor("Submissions to Review")).getByText("Resolved review")).toBeTruthy();
    expect(screen.getByText("Average task score: —")).toBeTruthy();
    expect(screen.getByText("Completion: —")).toBeTruthy();
    fireEvent.click(screen.getByText("Resolved review"));
    expect(mocks.navigate).toHaveBeenCalledWith("/teacher/classworks/555");
  });

  it("does not claim an empty review queue is complete when attempts are ambiguous", async () => {
    const result = phaseFourResponse();
    result.engagement!.warnings = [{ code: "ambiguous_submission_attempts", message: "Ambiguous completed attempts." }];
    mocks.load.mockResolvedValue(result);
    render(<Dashboard />);
    await waitFor(() => expect(within(cardFor("Submissions to Review")).getByText("Review queue incomplete.")).toBeTruthy());
    expect(screen.queryByText("No submissions need grading.")).toBeNull();
  });

  it("keeps an outside-roster targeted deadline visible with its configuration warning and a real link", async () => {
    const result = phaseFourResponse();
    result.action_queue.upcoming_deadlines = [{ classwork_id: 81, assignment_id: 11, title: "Targeted work",
      section_name: "Actual Section", due_date: "2026-10-10T00:00:00Z", submitted_count: 0, total_students: 0, eligible_count: 0,
      warnings: [{ code: "targeted_recipient_outside_active_roster", message: "Assignment configuration: targeted recipient is outside the active roster." }] }];
    mocks.load.mockResolvedValue(result);
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("Targeted work")).toBeTruthy());
    expect(cardFor("Due this week").textContent).toContain("Assignment configuration: targeted recipient is outside the active roster.");
    fireEvent.click(screen.getByText("Targeted work"));
    expect(mocks.navigate).toHaveBeenCalledWith("/teacher/classworks/81");
  });

  it("shows section completion gaps without replacing Current-grade warnings or class-record values", async () => {
    const result = phaseFourResponse();
    result.section_matrix = [{ ...phaseTwoSection(), completion_rate_percent: null,
      engagement: { ...result.engagement!, completed_count: null, completion_rate_percent: null,
        warnings: [{ code: "ambiguous_submission_attempts", message: "Section completion is unavailable." }] },
      warnings: [{ code: "invalid_passing_threshold", message: "Passing configuration is unavailable." }] }];
    mocks.load.mockResolvedValue(result);
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("Actual Section")).toBeTruthy());
    const section = cardFor("Actual Section");
    expect(section.textContent).toContain("Section completion is unavailable.");
    expect(section.textContent).toContain("Passing configuration is unavailable.");
    expect(within(section).getByText("80.5", { exact: true })).toBeTruthy();
    expect(section.textContent).toContain("Task Completion—");
  });
});
