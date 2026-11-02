// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeacherDashboardHealthResponse } from "@/lib/api";
import Dashboard from "./dashboard";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  navigate: vi.fn(),
  period: {
    selectedPeriodId: 10 as number | null,
    selectedYearId: 1 as number | null,
    selectedYear: { academic_year_id: 1, year_label: "2025-2026", is_active: true } as any,
    selectedPeriod: { id: 10, period: "Term 1", academic_year_id: 1, is_active: true } as any,
    periods: [{ id: 10, period: "Term 1", academic_year_id: 1, is_active: true }] as any[],
    isLoading: false,
  },
}));

vi.mock("@/lib/api", () => ({ getTeacherDashboardHealth: mocks.load }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/context/AcademicPeriodContext", () => ({ useAcademicPeriod: () => mocks.period }));
vi.mock("@/layouts/app-layout", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("@/components/retroui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render: trigger }: { render: ReactNode }) => <>{trigger}</>,
  TooltipContent: () => null,
}));
vi.mock("@/components/retroui/Select", () => ({
  Select: Object.assign(
    ({ children, value, onValueChange, name }: { children: ReactNode; value: string; name?: string; onValueChange: (value: string) => void }) =>
      <select aria-label={name ?? "Trend section"} value={value} onChange={(event) => onValueChange(event.target.value)}>{children}</select>,
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
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  YAxis: () => null,
  XAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Line: () => null,
}));

function baseResponse(overrides: Partial<TeacherDashboardHealthResponse> = {}): TeacherDashboardHealthResponse {
  return {
    term_info: {
      period_id: 10,
      period_name: "Term 1",
      academic_year: "2025-2026",
      academic_year_id: 1,
      is_active: true,
    },
    dashboard_filters: [
      { class_id: 1, subject_id: 1, section_name: "Section A", subject_name: "Math" },
    ],
    kpis: {
      active_classes: 1,
      enrolled_students: 25,
      overall_completion_rate: 80,
      ungraded_count: 3,
    },
    trend_chart: {
      available_filters: [
        { class_id: 1, subject_id: 1, section_name: "Section A", subject_name: "Math" },
      ],
      selected_class_id: 1,
      selected_subject_id: 1,
      selected_section_name: "Section A",
      selected_subject_name: "Math",
      has_sufficient_data: true,
      points: [],
    },
    section_matrix: [
      {
        class_id: 1,
        subject_id: 1,
        section_name: "Section A",
        grade_level: "Grade 7",
        subject_name: "Math",
        student_count: 25,
        published_classworks: 5,
        avg_score_percent: 85,
        completion_rate_percent: 80,
        attendance_rate_percent: 95,
        current_grade: 88,
        passing_rate_percent: 92,
      },
    ],
    action_queue: {
      pending_grading: [
        {
          submission_id: 101,
          student_id: "STU-001",
          classwork_id: 50,
          classwork_title: "Math Quiz 1",
          student_name: "Juan Dela Cruz",
          section_name: "Section A",
          submitted_at: "2026-10-08T01:00:00Z",
        },
      ],
      upcoming_deadlines: [],
    },
    ...overrides,
  };
}

describe("Teacher Dashboard Academic Context Synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.period = {
      selectedPeriodId: 10,
      selectedYearId: 1,
      selectedYear: { academic_year_id: 1, year_label: "2025-2026", is_active: true } as any,
      selectedPeriod: { id: 10, period: "Term 1", academic_year_id: 1, is_active: true } as any,
      periods: [{ id: 10, period: "Term 1", academic_year_id: 1, is_active: true }] as any[],
      isLoading: false,
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("requests dashboard metrics passing academic_year_id and academic_period_id", async () => {
    mocks.load.mockResolvedValue(baseResponse());

    render(<Dashboard />);

    await waitFor(() => {
      expect(mocks.load).toHaveBeenCalledWith(
        expect.objectContaining({
          academic_year_id: 1,
          academic_period_id: 10,
        })
      );
    });

    expect(await screen.findByText("Dashboard")).toBeDefined();
    // In active mode, "Historical · Read-Only" is NOT present
    expect(screen.queryByText("Historical · Read-Only")).toBeNull();
    // Active submission queue badge is "1 ungraded"
    expect(screen.getByText("1 ungraded")).toBeDefined();
  });

  it("displays Historical · Read-Only badge and historical action queue when context is historical", async () => {
    mocks.period = {
      selectedPeriodId: 5,
      selectedYearId: 99,
      selectedYear: { academic_year_id: 99, year_label: "2024-2025", is_active: false } as any,
      selectedPeriod: { id: 5, period: "Term 1", academic_year_id: 99, is_active: false } as any,
      periods: [{ id: 5, period: "Term 1", academic_year_id: 99, is_active: false }] as any[],
      isLoading: false,
    };

    mocks.load.mockResolvedValue(
      baseResponse({
        term_info: {
          period_id: 5,
          period_name: "Term 1",
          academic_year: "2024-2025",
          academic_year_id: 99,
          is_active: false,
        },
      })
    );

    render(<Dashboard />);

    await waitFor(() => {
      expect(mocks.load).toHaveBeenCalledWith(
        expect.objectContaining({
          academic_year_id: 99,
          academic_period_id: 5,
        })
      );
    });

    // Header displays Historical · Read-Only badge
    expect(await screen.findByText("Historical · Read-Only")).toBeDefined();
    // Submissions queue badge reflects historical status
    expect(screen.getByText("1 historical")).toBeDefined();
  });

  it("displays TeacherEmptyState and does not call API when year has 0 periods", async () => {
    mocks.period = {
      selectedPeriodId: null,
      selectedYearId: 88,
      selectedYear: { academic_year_id: 88, year_label: "2023-2024", is_active: false } as any,
      selectedPeriod: null,
      periods: [],
      isLoading: false,
    };

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText("No academic periods available")).toBeDefined();
    });

    expect(
      screen.getByText("There are no academic periods configured for this academic year.")
    ).toBeDefined();

    // The API must NEVER be called with empty periods (avoids defaulting to active year)
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("discards stale in-flight responses when switching periods", async () => {
    let resolveFirstRequest: (value: TeacherDashboardHealthResponse) => void = () => {};
    const firstPromise = new Promise<TeacherDashboardHealthResponse>((res) => {
      resolveFirstRequest = res;
    });

    let resolveSecondRequest: (value: TeacherDashboardHealthResponse) => void = () => {};
    const secondPromise = new Promise<TeacherDashboardHealthResponse>((res) => {
      resolveSecondRequest = res;
    });

    mocks.load.mockImplementation((params: any) => {
      if (params.academic_period_id === 20) {
        return secondPromise;
      }
      return firstPromise;
    });

    const { rerender } = render(<Dashboard />);

    // Fast switch to Period 2
    mocks.period = {
      selectedPeriodId: 20,
      selectedYearId: 1,
      selectedYear: { academic_year_id: 1, year_label: "2025-2026", is_active: true } as any,
      selectedPeriod: { id: 20, period: "Term 2", academic_year_id: 1, is_active: true } as any,
      periods: [
        { id: 10, period: "Term 1", academic_year_id: 1, is_active: true },
        { id: 20, period: "Term 2", academic_year_id: 1, is_active: true },
      ] as any[],
      isLoading: false,
    };

    rerender(<Dashboard />);

    // Second request finishes FIRST with Period 2 data
    await act(async () => {
      resolveSecondRequest(
        baseResponse({
          term_info: {
            period_id: 20,
            period_name: "Term 2",
            academic_year: "2025-2026",
            academic_year_id: 1,
            is_active: true,
          },
          kpis: {
            active_classes: 2,
            enrolled_students: 50,
            overall_completion_rate: 90,
            ungraded_count: 0,
          },
        })
      );
    });

    // Then first request finishes LATE with stale Period 1 data
    await act(async () => {
      resolveFirstRequest(
        baseResponse({
          term_info: {
            period_id: 10,
            period_name: "Term 1",
            academic_year: "2025-2026",
            academic_year_id: 1,
            is_active: true,
          },
          kpis: {
            active_classes: 1,
            enrolled_students: 25,
            overall_completion_rate: 80,
            ungraded_count: 3,
          },
        })
      );
    });

    // The dashboard must display Period 2 data (50 students), NOT stale Period 1 data
    await waitFor(() => {
      expect(screen.getByText("in Term 2")).toBeDefined();
    });
    expect(screen.queryByText("in Term 1")).toBeNull();
  });

  it("renders error alert and does not display metrics when API rejects with 403", async () => {
    mocks.load.mockRejectedValue(new Error("Not authorized to access this academic year"));

    render(<Dashboard />);

    expect(
      await screen.findByText("Not authorized to access this academic year")
    ).toBeDefined();

    // Metric counts are not displayed
    expect(screen.queryByText("Section A")).toBeNull();
  });
});
