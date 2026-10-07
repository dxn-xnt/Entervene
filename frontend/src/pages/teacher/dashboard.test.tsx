// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeacherDashboardHealthResponse } from "@/lib/api";
import Dashboard from "./dashboard";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  navigate: vi.fn(),
  period: { selectedPeriodId: 3 as number | null, isLoading: false },
  classes: [] as Array<{ class_id: number; subject_id: number; subject_name: string }>,
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
  Tooltip: () => null,
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
    expect(screen.getByText("Maria Santos")).toBeTruthy();
  });

  it("shows unavailable Phase 1 values after errors and retains the five later card defaults", async () => {
    mocks.load.mockRejectedValue(new Error("Dashboard request failed"));
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Dashboard request failed"));
    expect([countFor("Active Classes"), countFor("Overall Completion"), countFor("Ungraded Queue")]).toEqual(["—", "—", "—"]);
    expect([countFor("Class Average"), countFor("Passing Rate"), countFor("Late Submissions"), countFor("Attendance Today"), countFor("Term Progress")])
      .toEqual(["82%", "89%", "8%", "33 / 36", "Week 6"]);
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
    expect([countFor("Class Average"), countFor("Passing Rate"), countFor("Late Submissions"), countFor("Attendance Today"), countFor("Term Progress")])
      .toEqual(["82%", "89%", "8%", "33 / 36", "Week 6"]);
    expect(screen.getByText("Jose Reyes")).toBeTruthy();
    expect(screen.getByText("Maria Santos")).toBeTruthy();
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
      .toEqual(["Active Classes", "Overall Completion", "Ungraded Queue", "Class Average", "Passing Rate", "Late Submissions", "Attendance Today", "Term Progress"]);
    expect(screen.getByTestId("trend-axis").getAttribute("data-domain")).toBe("[50,100]");
    expect(screen.getByTestId("trend-axis").getAttribute("data-ticks")).toBe("[50,75,100]");
    expect(container.querySelector(".grid.grid-cols-1.items-start")?.className).toBe("grid grid-cols-1 items-start gap-4 lg:grid-cols-12 md:gap-4");
    expect(cardFor("Due this week").className).toContain("flex flex-col justify-between p-4 sm:p-5");
  });

  it("uses supplied cards in the existing order and fills missing later cards with their defaults", async () => {
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
    expect(countFor("Class Average")).toBe("82%");
    expect(countFor("Term Progress")).toBe("Week 6");
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
    expect(section.textContent).toContain("Class Average: —");
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
    expect(within(cardFor("Classwork Mastery & Completion Trend")).getByText("Dashboard data is unavailable.")).toBeTruthy();
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
