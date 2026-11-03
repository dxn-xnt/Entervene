// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import TeacherClasses from "@/pages/teacher/classes";
import { useTeacherClasses } from "@/hooks/use-teacher-classes";
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
    getTeacherClasses: vi.fn(),
    getTeacherAdvisoryClasses: vi.fn(),
  };
});

describe("H3C.5B: Teacher Classes Academic Context", () => {
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

  describe("useTeacherClasses hook", () => {
    it("gates requests while academic period context is loading", async () => {
      mockAcademicContext.isLoading = true;

      const { result } = renderHook(() => useTeacherClasses());

      expect(apiModule.getTeacherClasses).not.toHaveBeenCalled();
      expect(apiModule.getTeacherAdvisoryClasses).not.toHaveBeenCalled();
      expect(result.current.isLoading).toBe(true);
    });

    it("fetches teacher classes and advisory scoped to selected academic period and year", async () => {
      vi.mocked(apiModule.getTeacherClasses).mockResolvedValueOnce([
        {
          subject_load_id: 101,
          subject_id: 201,
          subject_name: "Mathematics 9",
          subject_codename: "MATH9",
          class_id: 301,
          section_name: "Section Diamond",
          grade_level: "Grade 9",
          academic_year_id: 10,
        },
      ]);
      vi.mocked(apiModule.getTeacherAdvisoryClasses).mockResolvedValueOnce([
        {
          class_id: 301,
          section_name: "Section Diamond",
          academic_level: "Grade 9",
          academic_year: "2025-2026",
          academic_year_id: 10,
          subject_count: 8,
          student_count: 35,
          class_status: "active",
          is_archived: false,
        },
      ]);

      const { result } = renderHook(() => useTeacherClasses());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(apiModule.getTeacherClasses).toHaveBeenCalledWith(1, 10);
      expect(apiModule.getTeacherAdvisoryClasses).toHaveBeenCalledWith(1, 10);
      expect(result.current.classes).toHaveLength(1);
      expect(result.current.advisoryClasses).toHaveLength(1);
    });

    it("prevents stale responses when switching academic periods rapidly (race condition protection)", async () => {
      let resolveFirst: (value: any) => void;
      let resolveSecond: (value: any) => void;

      const firstCallPromise = new Promise((resolve) => {
        resolveFirst = resolve;
      });
      const secondCallPromise = new Promise((resolve) => {
        resolveSecond = resolve;
      });

      vi.mocked(apiModule.getTeacherClasses)
        .mockImplementationOnce(() => firstCallPromise as any)
        .mockImplementationOnce(() => secondCallPromise as any);
      vi.mocked(apiModule.getTeacherAdvisoryClasses).mockResolvedValue([]);

      const { result, rerender } = renderHook(
        ({ periodId, yearId }) => useTeacherClasses({ periodId, yearId }),
        { initialProps: { periodId: 1, yearId: 10 } }
      );

      expect(apiModule.getTeacherClasses).toHaveBeenCalledWith(1, 10);

      // Rapidly switch to period 2
      rerender({ periodId: 2, yearId: 10 });
      expect(apiModule.getTeacherClasses).toHaveBeenCalledWith(2, 10);

      // Simulate second call resolving first with Period 2 data
      await act(async () => {
        resolveSecond!([
          {
            subject_load_id: 202,
            subject_id: 201,
            subject_name: "Mathematics 9 - Q2",
            class_id: 301,
            section_name: "Section Diamond",
            academic_year_id: 10,
          },
        ]);
      });

      await waitFor(() => {
        expect(result.current.classes).toHaveLength(1);
        expect(result.current.classes[0].subject_name).toBe("Mathematics 9 - Q2");
      });

      // Now older Period 1 call resolves LATER with stale Period 1 data
      await act(async () => {
        resolveFirst!([
          {
            subject_load_id: 101,
            subject_id: 201,
            subject_name: "Mathematics 9 - Q1 (STALE)",
            class_id: 301,
            section_name: "Section Diamond",
            academic_year_id: 10,
          },
        ]);
      });

      // Stale data MUST be discarded; result should still hold Period 2 data
      expect(result.current.classes).toHaveLength(1);
      expect(result.current.classes[0].subject_name).toBe("Mathematics 9 - Q2");
    });

    it("handles transition to a year with no periods gracefully without crashing", async () => {
      mockAcademicContext.periods = [];
      mockAcademicContext.selectedPeriodId = null;
      mockAcademicContext.selectedYearId = 15;

      const { result } = renderHook(() => useTeacherClasses());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.classes).toEqual([]);
      expect(result.current.advisoryClasses).toEqual([]);
      expect(result.current.error).toBeNull();
    });
  });

  describe("TeacherClasses page component", () => {
    it("renders TeacherEmptyState with BookOpen when teacher has no classes in period", async () => {
      vi.mocked(apiModule.getTeacherClasses).mockResolvedValueOnce([]);
      vi.mocked(apiModule.getTeacherAdvisoryClasses).mockResolvedValueOnce([]);

      render(
        <MemoryRouter>
          <TeacherClasses />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(
          screen.getByText("No subject teaching sections assigned")
        ).toBeTruthy();
        expect(
          screen.getByText(
            "No subject teaching sections are assigned to your account for this academic period."
          )
        ).toBeTruthy();
      });
    });

    it("renders teaching sections and advisory cards when authorized records are present", async () => {
      vi.mocked(apiModule.getTeacherClasses).mockResolvedValueOnce([
        {
          subject_load_id: 1,
          subject_id: 10,
          subject_name: "Science 9",
          subject_codename: "SCI9",
          class_id: 50,
          section_name: "Section Emerald",
          grade_level: "Grade 9",
          academic_year_id: 10,
        },
      ]);
      vi.mocked(apiModule.getTeacherAdvisoryClasses).mockResolvedValueOnce([
        {
          class_id: 50,
          section_name: "Section Emerald",
          academic_level: "Grade 9",
          academic_year: "2025-2026",
          academic_year_id: 10,
          subject_count: 7,
          student_count: 40,
          class_status: "active",
          is_archived: false,
        },
      ]);

      render(
        <MemoryRouter>
          <TeacherClasses />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getAllByText("Science 9").length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText("Section Emerald").length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText("Advisory Class")).toBeTruthy();
      });
    });
  });
});
