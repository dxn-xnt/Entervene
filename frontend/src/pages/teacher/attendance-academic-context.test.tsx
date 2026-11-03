// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import TeacherAttendancePage from "@/pages/teacher/attendance";
import * as attendanceApi from "@/lib/attendance-api";
import * as apiModule from "@/lib/api";

// ── Mocks ──
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
    ({ children, value, onValueChange, disabled }: { children: ReactNode; value: string; onValueChange: (v: string) => void; disabled?: boolean }) => (
      <select value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)} data-testid="target-select">
        {children}
      </select>
    ),
    {
      Trigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
      Value: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
      Content: ({ children }: { children: ReactNode }) => <>{children}</>,
      Group: ({ children }: { children: ReactNode }) => <>{children}</>,
      Label: ({ children }: { children: ReactNode }) => <label>{children}</label>,
      Item: ({ children, value }: { children: ReactNode; value: string }) => <option value={value}>{children}</option>,
    }
  ),
}));

vi.mock("html5-qrcode", () => ({
  Html5Qrcode: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn(),
    isScanning: false,
  })),
}));

let mockClassesHook = {
  classes: [] as apiModule.TeacherClassItem[],
  advisoryClasses: [] as any[],
  isLoading: false,
  error: null as Error | null,
  refetch: vi.fn(),
  selectedPeriodId: 1 as number | null,
  selectedYearId: 10 as number | null,
};

let mockAcademicPeriodContext = {
  selectedPeriodId: 1 as number | null,
  selectedYearId: 10 as number | null,
  selectedPeriod: { id: 1, period: "Q1", is_active: true } as any,
  selectedYear: { academic_year_id: 10, year_label: "2025-2026", is_active: true } as any,
  isLoading: false,
};

vi.mock("@/hooks/use-teacher-classes", () => ({
  useTeacherClasses: () => mockClassesHook,
}));

vi.mock("@/context/AcademicPeriodContext", () => ({
  useRegisterDirtyGuard: () => {},
  useAcademicPeriod: () => mockAcademicPeriodContext,
}));

vi.mock("@/lib/attendance-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/attendance-api")>();
  return {
    ...actual,
    getClassAttendanceLogs: vi.fn(),
    recordBatchAttendance: vi.fn(),
    scanQRAttendance: vi.fn(),
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiFetch: vi.fn(),
  };
});

describe("H3C.5E.1: Teacher Attendance List Synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockClassesHook = {
      classes: [
        {
          subject_load_id: 1,
          class_id: 101,
          subject_id: 201,
          section_name: "Diamond",
          subject_name: "Mathematics",
          grade_level: "Grade 10",
          academic_period_id: 1,
        },
      ],
      advisoryClasses: [
        {
          class_id: 102,
          section_name: "Emerald",
          academic_level: "Grade 10",
        },
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      selectedPeriodId: 1,
      selectedYearId: 10,
    };

    vi.mocked(apiModule.apiFetch).mockImplementation(async (url: string) => {
      if (url.includes("/students")) {
        return {
          ok: true,
          json: async () => [
            {
              student_id: "s1",
              full_name: "Alice Smith",
              student_lrn: "123456789012",
              gender: "Female",
            },
          ],
        } as any;
      }
      return { ok: true, json: async () => ({}) } as any;
    });

    vi.mocked(attendanceApi.getClassAttendanceLogs).mockResolvedValue([
      {
        attendance_id: 1,
        student_id: "s1",
        student_name: "Alice Smith",
        class_id: 102,
        subject_id: null,
        date: new Date().toISOString().split("T")[0],
        status: "present",
        remarks: null,
        recorded_by_staff_id: "TCH-001",
        created_at: null,
        updated_at: null,
      },
    ]);
  });

  afterEach(cleanup);

  it("fetches attendance logs using selectedClassId, selectedAcademicPeriodId, and selectedYearId", async () => {
    render(
      <MemoryRouter>
        <TeacherAttendancePage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(attendanceApi.getClassAttendanceLogs).toHaveBeenCalledWith(
        102,
        undefined,
        undefined,
        1,
        10
      );
    });

    expect(await screen.findByText("Alice Smith")).toBeTruthy();
  });

  it("clears displayed students and attendance logs when switched to an academic context with no classes", async () => {
    const { rerender } = render(
      <MemoryRouter>
        <TeacherAttendancePage />
      </MemoryRouter>
    );

    await screen.findByText("Alice Smith");

    // Context changes: no classes or advisory assigned for this new term
    mockClassesHook = {
      ...mockClassesHook,
      classes: [],
      advisoryClasses: [],
      selectedPeriodId: 2,
      selectedYearId: 11,
    };

    rerender(
      <MemoryRouter>
        <TeacherAttendancePage />
      </MemoryRouter>
    );

    // Verify stale records from prior term are cleared and empty placeholder is shown
    await waitFor(() => {
      expect(screen.queryByText("Alice Smith")).toBeNull();
      expect(screen.getByText("No classes available for this term")).toBeTruthy();
    });
  });

  it("discards stale responses when context or target switches rapidly (race condition guard)", async () => {
    let resolveSlowFetch: (val: attendanceApi.AttendanceRecordItem[]) => void;
    const slowPromise = new Promise<attendanceApi.AttendanceRecordItem[]>((res) => {
      resolveSlowFetch = res;
    });

    vi.mocked(attendanceApi.getClassAttendanceLogs).mockImplementationOnce(() => slowPromise);

    const { rerender } = render(
      <MemoryRouter>
        <TeacherAttendancePage />
      </MemoryRouter>
    );

    // Switch rapidly to another class/period before first fetch completes
    mockClassesHook = {
      ...mockClassesHook,
      classes: [
        {
          subject_load_id: 2,
          class_id: 103,
          subject_id: 203,
          section_name: "Ruby",
          subject_name: "Science",
          grade_level: "Grade 10",
          academic_period_id: 2,
        },
      ],
      advisoryClasses: [],
      selectedPeriodId: 2,
      selectedYearId: 10,
    };

    vi.mocked(apiModule.apiFetch).mockImplementation(async (url: string) => {
      if (url.includes("/students")) {
        return {
          ok: true,
          json: async () => [
            {
              student_id: "s2",
              full_name: "Bob Jones",
              student_lrn: "987654321098",
              gender: "Male",
            },
          ],
        } as any;
      }
      return { ok: true, json: async () => ({}) } as any;
    });

    vi.mocked(attendanceApi.getClassAttendanceLogs).mockResolvedValueOnce([
      {
        attendance_id: 2,
        student_id: "s2",
        student_name: "Bob Jones",
        class_id: 103,
        subject_id: 203,
        date: new Date().toISOString().split("T")[0],
        status: "present",
        remarks: null,
        recorded_by_staff_id: "TCH-001",
        created_at: null,
        updated_at: null,
      },
    ]);

    rerender(
      <MemoryRouter>
        <TeacherAttendancePage />
      </MemoryRouter>
    );

    // Fresh fast response displays Bob Jones
    expect(await screen.findByText("Bob Jones")).toBeTruthy();

    // Slow first response resolves late with Alice Smith
    resolveSlowFetch!([
      {
        attendance_id: 1,
        student_id: "s1",
        student_name: "Alice Smith",
        class_id: 102,
        subject_id: null,
        date: new Date().toISOString().split("T")[0],
        status: "present",
        remarks: null,
        recorded_by_staff_id: "TCH-001",
        created_at: null,
        updated_at: null,
      },
    ]);

    // Verify stale response did not overwrite current view
    await waitFor(() => {
      expect(screen.queryByText("Alice Smith")).toBeNull();
      expect(screen.getByText("Bob Jones")).toBeTruthy();
    });
  });

  it("disables write controls and displays historical read-only badges when period is historical", async () => {
    mockAcademicPeriodContext = {
      selectedPeriodId: 1,
      selectedYearId: 10,
      selectedPeriod: { id: 1, period: "Q1", is_active: false },
      selectedYear: { academic_year_id: 10, year_label: "2024-2025", is_active: false },
      isLoading: false,
    };

    render(
      <MemoryRouter>
        <TeacherAttendancePage />
      </MemoryRouter>
    );

    // Verify historical badge and warning banner
    expect(await screen.findByText("Historical · Read-Only")).toBeTruthy();
    expect(
      screen.getByText("Historical academic period: Attendance records are viewable in read-only mode.")
    ).toBeTruthy();

    // Verify tab labels
    expect(screen.getByText("View Attendance")).toBeTruthy();
    expect(screen.queryByText("QR Scanner")).toBeNull();

    // Verify Mark All buttons are disabled
    const presentBtn = screen.getByRole("button", { name: /present/i });
    const absentBtn = screen.getByRole("button", { name: /absent/i });
    expect((presentBtn as HTMLButtonElement).disabled).toBe(true);
    expect((absentBtn as HTMLButtonElement).disabled).toBe(true);

    // Verify Save button is disabled and displays Historical Read-Only
    const saveBtn = screen.getByRole("button", { name: /historical read-only/i });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);
  });
});

