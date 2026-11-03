// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import ClassworksPage from "@/pages/teacher/classworks";
import * as apiModule from "@/lib/api";

// ── Mock AppLayout & Sidebar ──
vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button type="button">SidebarTrigger</button>,
}));

vi.mock("@/components/retroui/Tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render }: { render: ReactNode }) => <>{render}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock academic context state variable
let mockAcademicContext = {
  selectedPeriodId: 1 as number | null,
  selectedYearId: 10 as number | null,
  selectedPeriod: {
    id: 1,
    period: "Quarter 1",
    period_sequence: 1,
    total_periods: 4,
    academicyear: "2025-2026",
    academic_year_id: 10,
    startDate: null,
    endDate: null,
    is_active: true,
  },
  selectedYear: {
    academic_year_id: 10,
    school_year: "2025-2026",
    is_active: true,
  },
  periods: [
    {
      id: 1,
      period: "Quarter 1",
      period_sequence: 1,
      total_periods: 4,
      academicyear: "2025-2026",
      academic_year_id: 10,
      startDate: null,
      endDate: null,
      is_active: true,
    },
  ],
  academicYears: [
    {
      academic_year_id: 10,
      school_year: "2025-2026",
      is_active: true,
    },
  ],
  isLoading: false,
  setSelectedPeriodId: vi.fn(),
  setSelectedYearId: vi.fn(),
  refetch: vi.fn(),
  registerDirtyGuard: () => () => {},
};

vi.mock("@/context/AcademicPeriodContext", () => ({
  useAcademicPeriod: () => mockAcademicContext,
}));

// Mock api calls
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getTeacherClassworks: vi.fn(),
    getTeacherClasses: vi.fn(),
  };
});

describe("H3C.5C: Teacher Classwork Academic Context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAcademicContext = {
      selectedPeriodId: 1,
      selectedYearId: 10,
      selectedPeriod: {
        id: 1,
        period: "Quarter 1",
        period_sequence: 1,
        total_periods: 4,
        academicyear: "2025-2026",
        academic_year_id: 10,
        startDate: null,
        endDate: null,
        is_active: true,
      },
      selectedYear: {
        academic_year_id: 10,
        school_year: "2025-2026",
        is_active: true,
      },
      periods: [
        {
          id: 1,
          period: "Quarter 1",
          period_sequence: 1,
          total_periods: 4,
          academicyear: "2025-2026",
          academic_year_id: 10,
          startDate: null,
          endDate: null,
          is_active: true,
        },
      ],
      academicYears: [
        {
          academic_year_id: 10,
          school_year: "2025-2026",
          is_active: true,
        },
      ],
      isLoading: false,
      setSelectedPeriodId: vi.fn(),
      setSelectedYearId: vi.fn(),
      refetch: vi.fn(),
      registerDirtyGuard: () => () => {},
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("gates requests while academic period context is loading", async () => {
    mockAcademicContext.isLoading = true;

    render(
      <MemoryRouter>
        <ClassworksPage />
      </MemoryRouter>
    );

    expect(apiModule.getTeacherClassworks).not.toHaveBeenCalled();
    expect(apiModule.getTeacherClasses).not.toHaveBeenCalled();
  });

  it("fetches classworks scoped to selected academic period and year", async () => {
    vi.mocked(apiModule.getTeacherClassworks).mockResolvedValueOnce([
      {
        classwork_id: 101,
        title: "Algebra Homework 1",
        classwork_type: "ASSIGNMENT",
        classwork_category: "Written Work",
        total_points: 100,
        is_published: true,
        show_scores: true,
        is_locked: false,
        is_archived: false,
        subject_id: 1,
        subject_name: "Mathematics 7",
        assignments: [
          {
            classwork_assignment_id: 501,
            classwork_id: 101,
            class_id: 301,
            title: "Section Diamond",
            due_date: "2025-10-15T00:00:00Z",
            lock_date: null,
            allow_late_submissions: false,
            is_published: true,
            show_scores: true,
            is_locked: false,
          },
        ],
        attachments: [],
        linked_lessons: [],
        created_at: "2025-08-15T00:00:00Z",
      },
    ]);
    vi.mocked(apiModule.getTeacherClasses).mockResolvedValueOnce([]);

    render(
      <MemoryRouter>
        <ClassworksPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(apiModule.getTeacherClassworks).toHaveBeenCalledWith(1, 10);
      expect(apiModule.getTeacherClasses).toHaveBeenCalledWith(1, 10);
    });

    expect(await screen.findByText("Algebra Homework 1")).toBeTruthy();
  });

  it("prevents stale responses when switching academic periods rapidly (race condition protection)", async () => {
    let resolveFirst: (val: any) => void = () => {};
    const firstCall = new Promise<any>((res) => {
      resolveFirst = res;
    });

    let resolveSecond: (val: any) => void = () => {};
    const secondCall = new Promise<any>((res) => {
      resolveSecond = res;
    });

    vi.mocked(apiModule.getTeacherClassworks)
      .mockImplementationOnce(() => firstCall)
      .mockImplementationOnce(() => secondCall);
    vi.mocked(apiModule.getTeacherClasses).mockResolvedValue([]);

    const { rerender } = render(
      <MemoryRouter>
        <ClassworksPage />
      </MemoryRouter>
    );

    expect(apiModule.getTeacherClassworks).toHaveBeenCalledWith(1, 10);

    // Switch to Quarter 2 (Period 2)
    mockAcademicContext.selectedPeriodId = 2;
    mockAcademicContext.selectedPeriod = {
      ...mockAcademicContext.selectedPeriod,
      id: 2,
      period: "Quarter 2",
      period_sequence: 2,
    };

    rerender(
      <MemoryRouter>
        <ClassworksPage />
      </MemoryRouter>
    );

    expect(apiModule.getTeacherClassworks).toHaveBeenCalledWith(2, 10);

    // Second call resolves first with Period 2 data
    resolveSecond([
      {
        classwork_id: 202,
        title: "Q2 Midterm Exam",
        classwork_type: "EXAM",
        total_points: 100,
        is_published: true,
        show_scores: true,
        is_locked: false,
        is_archived: false,
        subject_id: 1,
        subject_name: "Mathematics 7",
        assignments: [],
        attachments: [],
        linked_lessons: [],
        created_at: "2025-11-15T00:00:00Z",
      },
    ]);

    expect(await screen.findByText("Q2 Midterm Exam")).toBeTruthy();

    // First call resolves later with stale Period 1 data
    resolveFirst([
      {
        classwork_id: 101,
        title: "Stale Q1 Assignment",
        classwork_type: "ASSIGNMENT",
        total_points: 50,
        is_published: true,
        show_scores: true,
        is_locked: false,
        is_archived: false,
        subject_id: 1,
        subject_name: "Mathematics 7",
        assignments: [],
        attachments: [],
        linked_lessons: [],
        created_at: "2025-08-15T00:00:00Z",
      },
    ]);

    // Stale Q1 item must not overwrite Q2
    await waitFor(() => {
      expect(screen.queryByText("Stale Q1 Assignment")).toBeNull();
      expect(screen.getByText("Q2 Midterm Exam")).toBeTruthy();
    });
  });

  it("enforces read-only UI in historical period context", async () => {
    // Set inactive historical year
    mockAcademicContext.selectedYear = {
      academic_year_id: 9,
      school_year: "2024-2025",
      is_active: false,
    };
    mockAcademicContext.selectedPeriod = {
      id: 91,
      period: "Quarter 1",
      period_sequence: 1,
      total_periods: 4,
      academicyear: "2024-2025",
      academic_year_id: 9,
      startDate: null,
      endDate: null,
      is_active: false,
    };
    mockAcademicContext.selectedYearId = 9;
    mockAcademicContext.selectedPeriodId = 91;

    vi.mocked(apiModule.getTeacherClassworks).mockResolvedValueOnce([]);
    vi.mocked(apiModule.getTeacherClasses).mockResolvedValueOnce([]);

    render(
      <MemoryRouter>
        <ClassworksPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(apiModule.getTeacherClassworks).toHaveBeenCalledWith(91, 9);
    });

    // Check header "New Classwork" button is disabled
    const newButtons = screen.getAllByRole("button", { name: /new classwork/i });
    expect(newButtons.length).toBeGreaterThan(0);
    expect((newButtons[0] as HTMLButtonElement).disabled).toBe(true);

    // Empty state should be TeacherEmptyState without create action
    expect(screen.getByText("No Classworks Found")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /create classwork/i })).toBeNull();
  });
});
