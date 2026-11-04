// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Grades from "@/pages/teacher/grades";
import TeacherGradeView from "@/pages/teacher/grade-view";
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
  TooltipContent: () => null,
}));

vi.mock("@/components/retroui/Dialog", async () => {
  const React = await import("react");
  const Open = React.createContext(false);
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Object.assign(
      ({ children, open }: { children: ReactNode; open: boolean }) => (
        <Open.Provider value={open}>{children}</Open.Provider>
      ),
      {
        Content: ({ children }: { children: ReactNode }) =>
          React.useContext(Open) ? <section role="dialog">{children}</section> : null,
        Header: Part,
        Footer: Part,
      }
    ),
  };
});

vi.mock("@/components/retroui/Select", () => ({
  Select: Object.assign(
    ({ children, value, onValueChange }: { children: ReactNode; value: string; onValueChange: (v: string) => void }) => (
      <select value={value} onChange={(e) => onValueChange(e.target.value)}>
        {children}
      </select>
    ),
    {
      Trigger: () => null,
      Value: () => null,
      Content: ({ children }: { children: ReactNode }) => <>{children}</>,
      Group: ({ children }: { children: ReactNode }) => <>{children}</>,
      Item: ({ children, value }: { children: ReactNode; value: string }) => <option value={value}>{children}</option>,
    }
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("./forms/view-grade-scores", () => ({ default: () => null }));
vi.mock("./forms/add-classwork-score", () => ({ default: () => null }));
vi.mock("./forms/enter-manual-scores", () => ({ default: () => null }));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ section: "101", subject: "201" }),
  };
});

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

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getTeacherClasses: vi.fn(),
    getTeacherAvailablePeriods: vi.fn(),
    getTeacherGradebook: vi.fn(),
    getTeacherTermSummary: vi.fn(),
    exportTeacherClassRecord: vi.fn(),
    exportTeacherClassRecordWorkbook: vi.fn(),
    sendStudentGradeToAdviser: vi.fn(),
    bulkSendGradesToAdviser: vi.fn(),
  };
});

const mockGradebookActive: apiModule.StudentGradebookResponse = {
  scope: {
    section_name: "Grade 10 - Diamond",
    subject_name: "Mathematics",
    is_view_only: false,
  },
  classwork: [
    {
      writtenWork: [{ id: 1, title: "Quiz 1", maxScore: 50 }],
      performanceTask: [{ id: 2, title: "Project 1", maxScore: 100 }],
      quarterlyAssessment: [],
      exams: [],
    },
  ],
  grading_weights: {
    template_id: 1,
    template_name: "DepEd Standard",
    ww_weight: 0.4,
    pt_weight: 0.4,
    exams_weight: 0.2,
    ww_percentage: 40,
    pt_percentage: 40,
    exams_percentage: 20,
  },
  studentGrades: [
    {
      student_id: "s1",
      name: "Alice Smith",
      writtenWork: [45],
      performanceTask: [90],
      quarterlyAssessment: [],
      exams: [],
      ps_written: 90,
      ps_performance: 90,
      ps_quarterly: null,
      ps_exams: null,
      transmuted_grade: 92,
      initial_grade: 90,
      total: "92",
      finalized_at: null,
    },
  ],
};

const mockGradebookHistorical: apiModule.StudentGradebookResponse = {
  ...mockGradebookActive,
  scope: {
    ...mockGradebookActive.scope,
    is_view_only: true,
  },
};

const mockAvailablePeriods: apiModule.StudentRecordPeriodOptionsResponse = {
  default_academic_period_id: 1,
  periods: [
    {
      academic_period_id: 1,
      period_name: "First Quarter",
      period_sequence: 1,
      is_active: true,
    },
    {
      academic_period_id: 2,
      period_name: "Second Quarter",
      period_sequence: 2,
      is_active: false,
    },
  ],
};

const mockTermSummary: apiModule.TermGradeSummaryResponse = {
  scope: {
    class_id: 101,
    subject_id: 201,
    academic_year_id: 10,
    section_name: "Grade 10 - Diamond",
    subject_name: "Mathematics",
    year_label: "2025-2026",
  },
  periods: [
    {
      academic_period_id: 1,
      period_name: "First Quarter",
      period_sequence: 1,
      is_active: true,
    },
  ],
  students: [
    {
      student_id: "s1",
      name: "Alice Smith",
      gender: "Female",
      term_grades: { 1: 92 },
      final_grade: 92,
      remark: "PASSED",
      performance_descriptor: "Outstanding",
    },
  ],
  passing_threshold: 75,
};

describe("H3C.5D: Teacher Gradebook Academic Context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (!window.URL.createObjectURL) {
      window.URL.createObjectURL = vi.fn(() => "blob:mock-url");
      window.URL.revokeObjectURL = vi.fn();
    }
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

    vi.mocked(apiModule.getTeacherClasses).mockResolvedValue([
      {
        subject_load_id: 1,
        class_id: 101,
        subject_id: 201,
        section_name: "Grade 10 - Diamond",
        subject_name: "Mathematics",
      },
    ]);
    vi.mocked(apiModule.getTeacherAvailablePeriods).mockResolvedValue(mockAvailablePeriods);
    vi.mocked(apiModule.getTeacherGradebook).mockResolvedValue(mockGradebookActive);
    vi.mocked(apiModule.getTeacherTermSummary).mockResolvedValue(mockTermSummary);
    vi.mocked(apiModule.exportTeacherClassRecordWorkbook).mockResolvedValue({
      blob: new Blob(["dummy"]),
      filename: "Diamond_Math_FullYear.xlsx",
    });
  });

  afterEach(cleanup);

  describe("Grades Page (Classes List)", () => {
    it("fetches teacher classes using the active academic period and year", async () => {
      render(
        <MemoryRouter>
          <Grades />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(apiModule.getTeacherClasses).toHaveBeenCalledWith(1, 10);
      });

      expect(await screen.findByText("Grade 10 - Diamond")).toBeTruthy();
      expect(screen.getByText("Mathematics")).toBeTruthy();
    });

    it("re-fetches teacher classes when academic context changes", async () => {
      const { rerender } = render(
        <MemoryRouter>
          <Grades />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(apiModule.getTeacherClasses).toHaveBeenCalledWith(1, 10);
      });

      // Switch context to Period 2, Year 11
      mockAcademicContext = {
        ...mockAcademicContext,
        selectedPeriodId: 2,
        selectedYearId: 11,
      };

      rerender(
        <MemoryRouter>
          <Grades />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(apiModule.getTeacherClasses).toHaveBeenCalledWith(2, 11);
      });
    });

    it("discards stale responses when context switches rapidly (race condition guard)", async () => {
      let resolveFirst: (val: apiModule.TeacherClassItem[]) => void;
      const firstPromise = new Promise<apiModule.TeacherClassItem[]>((res) => {
        resolveFirst = res;
      });

      vi.mocked(apiModule.getTeacherClasses).mockImplementationOnce(() => firstPromise);

      const { rerender } = render(
        <MemoryRouter>
          <Grades />
        </MemoryRouter>
      );

      // Context changes before first request completes
      mockAcademicContext = {
        ...mockAcademicContext,
        selectedPeriodId: 2,
        selectedYearId: 11,
      };

      vi.mocked(apiModule.getTeacherClasses).mockResolvedValueOnce([
        {
          subject_load_id: 2,
          class_id: 102,
          subject_id: 202,
          section_name: "Grade 11 - Sapphire",
          subject_name: "Physics",
        },
      ]);

      rerender(
        <MemoryRouter>
          <Grades />
        </MemoryRouter>
      );

      // Fast second request resolves
      await screen.findByText("Grade 11 - Sapphire");

      // Slow first request finishes afterwards
      resolveFirst!([
        {
          subject_load_id: 1,
          class_id: 101,
          subject_id: 201,
          section_name: "Stale Grade 10 - Diamond",
          subject_name: "Stale Mathematics",
        },
      ]);

      // Verify stale response did not overwrite the fresh one
      await waitFor(() => {
        expect(screen.queryByText("Stale Grade 10 - Diamond")).toBeNull();
        expect(screen.getByText("Grade 11 - Sapphire")).toBeTruthy();
      });
    });

    it("displays TeacherEmptyState when no classes are assigned for the selected period", async () => {
      vi.mocked(apiModule.getTeacherClasses).mockResolvedValueOnce([]);

      render(
        <MemoryRouter>
          <Grades />
        </MemoryRouter>
      );

      expect(await screen.findByText("No classes assigned")).toBeTruthy();
      expect(
        screen.getByText(
          "Your class grades will appear here once classes are assigned to you for this academic period."
        )
      ).toBeTruthy();
    });

    it("displays RetroUI Alert on fetch error", async () => {
      vi.mocked(apiModule.getTeacherClasses).mockRejectedValueOnce(
        new Error("Database connection lost")
      );

      render(
        <MemoryRouter>
          <Grades />
        </MemoryRouter>
      );

      expect(await screen.findByText("Database connection lost")).toBeTruthy();
    });
  });

  describe("Grade View Page", () => {
    it("fetches available periods and gradebook scoped to selectedYearId", async () => {
      render(
        <MemoryRouter>
          <TeacherGradeView />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(apiModule.getTeacherAvailablePeriods).toHaveBeenCalledWith(101, 201, 10);
      });

      await waitFor(() => {
        expect(apiModule.getTeacherGradebook).toHaveBeenCalledWith("101", "201", 1, 10);
      });

      const matchedStudents = await screen.findAllByText("Alice Smith");
      expect(matchedStudents.length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "Send All to Adviser" })).toBeTruthy();
    });

    it("shows a corrected finalized grade instead of its stale transmuted snapshot", async () => {
      vi.mocked(apiModule.getTeacherGradebook).mockResolvedValue({
        ...mockGradebookActive,
        studentGrades: [{
          ...mockGradebookActive.studentGrades[0],
          transmuted_grade: 92,
          total: "95",
          is_finalized: true,
          performance_descriptor: "Outstanding",
        }],
      });

      render(
        <MemoryRouter>
          <TeacherGradeView />
        </MemoryRouter>
      );

      expect(await screen.findByText("95.0")).toBeTruthy();
      expect(screen.queryByText("92.0")).toBeNull();
    });

    it("fetches term summary scoped to selectedYearId when summary tab is selected", async () => {
      render(
        <MemoryRouter>
          <TeacherGradeView />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(apiModule.getTeacherGradebook).toHaveBeenCalled();
      });

      // Switch to Summary tab
      const summaryTab = screen.getByRole("tab", { name: /Summary of Termly Grades/i });
      fireEvent.click(summaryTab);

      await waitFor(() => {
        expect(apiModule.getTeacherTermSummary).toHaveBeenCalledWith(101, 201, 10);
      });

      const matchedStudents = await screen.findAllByText(/Alice Smith/);
      expect(matchedStudents.length).toBeGreaterThan(0);
      expect(screen.getByText("Passed")).toBeTruthy();
    });

    it("renders read-only mode banner and disables mutations when is_view_only is true", async () => {
      vi.mocked(apiModule.getTeacherGradebook).mockResolvedValue(mockGradebookHistorical);

      render(
        <MemoryRouter>
          <TeacherGradeView />
        </MemoryRouter>
      );

      // Verify read-only historical banner is rendered
      expect(await screen.findByText("Read-Only Mode (Historical Record)")).toBeTruthy();
      expect(
        screen.getByText("This academic period is closed or historical. Records are view-only.")
      ).toBeTruthy();

      // Verify bulk "Send All to Adviser" button is hidden
      expect(screen.queryByRole("button", { name: "Send All to Adviser" })).toBeNull();

      // Verify header "+ Manual Score" / "+ Add Classwork" action buttons are hidden
      expect(screen.queryByRole("button", { name: /\+ Manual Score/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /\+ Add Classwork/i })).toBeNull();

      // Verify that activity header score button has cursor-default and does not trigger scoring modal
      const activityButton = screen.getByRole("button", { name: "Quiz 1" });
      expect(activityButton.className).toContain("cursor-default");
      fireEvent.click(activityButton);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("keeps a future term viewable while hiding every live grading action", async () => {
      mockAcademicContext = {
        ...mockAcademicContext,
        selectedPeriodId: 2,
        selectedPeriod: {
          ...mockAcademicContext.selectedPeriod,
          id: 2,
          period: "Quarter 2",
          period_sequence: 2,
          is_active: false,
        },
        periods: [
          mockAcademicContext.periods[0],
          {
            ...mockAcademicContext.periods[0],
            id: 2,
            period: "Quarter 2",
            period_sequence: 2,
            is_active: false,
          },
        ],
      };

      render(
        <MemoryRouter>
          <TeacherGradeView />
        </MemoryRouter>
      );

      expect(await screen.findByText("Read-Only Mode (Future Term)")).toBeTruthy();
      expect((await screen.findAllByText("Alice Smith")).length).toBeGreaterThan(0);
      expect(screen.getByText(/before this term becomes active/i)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Send All to Adviser" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Add Written Works score" })).toBeNull();

      const activityButton = screen.getByRole("button", { name: "Quiz 1" });
      expect(activityButton.className).toContain("cursor-default");
      fireEvent.click(activityButton);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(apiModule.sendStudentGradeToAdviser).not.toHaveBeenCalled();
      expect(apiModule.bulkSendGradesToAdviser).not.toHaveBeenCalled();
    });

    it("passes selectedYearId when exporting full year workbook", async () => {
      render(
        <MemoryRouter>
          <TeacherGradeView />
        </MemoryRouter>
      );

      const matchedStudents = await screen.findAllByText("Alice Smith");
      expect(matchedStudents.length).toBeGreaterThan(0);

      const exportWorkbookBtn = screen.getByText("Full Year Workbook (.xlsx)");
      fireEvent.click(exportWorkbookBtn);

      await waitFor(() => {
        expect(apiModule.exportTeacherClassRecordWorkbook).toHaveBeenCalledWith("101", "201", 10);
      });
    });
  });
});
