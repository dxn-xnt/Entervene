// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeacherAttendancePage from "./attendance";
import { AttendanceApiError } from "@/lib/attendance-api";
import {
  classifyAttendanceSaveError,
  getAttendanceDateIssue,
  isPeriodEndedBeforeDate,
  resolveInitialAttendanceDateForPeriod,
} from "./attendance-utils";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  getClassAttendanceLogs: vi.fn(),
  recordBatchAttendance: vi.fn(),
  exportClassAttendanceCSV: vi.fn(),
  scanQRAttendance: vi.fn(),
  toastLoading: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  selectedPeriod: {
    id: 1,
    period: "Term 1",
    period_sequence: 1,
    total_periods: 3,
    academicyear: "2025-2026",
    academic_year_id: 1,
    startDate: "2025-06-02",
    endDate: "2025-08-22",
    is_active: true,
    status: "Active",
  },
  selectedYear: {
    academic_year_id: 1,
    year_label: "2025-2026",
    start_date: "2025-06-02",
    end_date: "2026-03-31",
    is_active: true,
  },
}));

vi.mock("@/lib/api", () => ({
  apiFetch: mocks.apiFetch,
}));

vi.mock("@/lib/attendance-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/attendance-api")>();
  return {
    ...actual,
    getClassAttendanceLogs: mocks.getClassAttendanceLogs,
    recordBatchAttendance: mocks.recordBatchAttendance,
    exportClassAttendanceCSV: mocks.exportClassAttendanceCSV,
    scanQRAttendance: mocks.scanQRAttendance,
  };
});

vi.mock("sonner", () => ({
  toast: {
    loading: mocks.toastLoading,
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: mocks.toastInfo,
  },
}));

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button type="button">Sidebar</button>,
}));

vi.mock("@/components/retroui/DatePicker", () => ({
  DatePicker: ({
    value,
    onValueChange,
    min,
    max,
    "aria-label": ariaLabel,
    "aria-invalid": ariaInvalid,
  }: {
    value: string;
    onValueChange: (val: string) => void;
    min?: string;
    max?: string;
    "aria-label"?: string;
    "aria-invalid"?: boolean;
  }) => (
    <input
      type="date"
      aria-label={ariaLabel || "Attendance date"}
      aria-invalid={ariaInvalid}
      value={value}
      min={min}
      max={max}
      onChange={(e) => onValueChange(e.target.value)}
    />
  ),
}));

vi.mock("@/hooks/use-teacher-classes", () => ({
  useTeacherClasses: () => ({
    classes: [],
    advisoryClasses: [
      {
        class_id: 10,
        section_name: "Diamond",
        academic_level: "Grade 9",
      },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    selectedPeriodId: mocks.selectedPeriod.id,
    selectedYearId: mocks.selectedYear.academic_year_id,
  }),
}));

vi.mock("@/context/AcademicPeriodContext", () => ({
  useAcademicPeriod: () => ({
    selectedPeriodId: mocks.selectedPeriod.id,
    selectedYearId: mocks.selectedYear.academic_year_id,
    selectedPeriod: mocks.selectedPeriod,
    selectedYear: mocks.selectedYear,
    periods: [mocks.selectedPeriod],
    academicYears: [mocks.selectedYear],
    years: [mocks.selectedYear],
    isLoading: false,
    setSelectedPeriodId: vi.fn(),
    setSelectedYearId: vi.fn(),
    refetch: vi.fn(),
    registerDirtyGuard: () => () => {},
  }),
  useRegisterDirtyGuard: vi.fn(),
}));

describe("attendance-utils", () => {
  it("does not silently preselect an old historical date when today is outside the selected term", () => {
    expect(
      resolveInitialAttendanceDateForPeriod(
        "2026-11-21",
        { period: "Term 1", startDate: "2025-06-02", endDate: "2025-08-22" },
        "2026-11-21",
      ),
    ).toBe("");

    expect(
      resolveInitialAttendanceDateForPeriod(
        "",
        { period: "Term 1", startDate: "2025-06-02", endDate: "2025-08-22" },
        "2025-07-10",
      ),
    ).toBe("2025-07-10");
  });

  it("identifies ended periods and distinguishes warning (unselected) vs error (out of range)", () => {
    const term1 = {
      period: "Term 1",
      startDate: "2025-06-02",
      endDate: "2025-08-22",
    };

    expect(isPeriodEndedBeforeDate(term1, "2026-11-21")).toBe(true);
    expect(isPeriodEndedBeforeDate(term1, "2025-08-15")).toBe(false);

    const unselected = getAttendanceDateIssue("", term1, "2026-11-21");
    expect(unselected?.severity).toBe("warning");
    expect(unselected?.message).toContain("No date was preselected");
    expect(unselected?.message).toContain("2025-06-02 to 2025-08-22");

    const outOfRange = getAttendanceDateIssue("2026-11-21", term1, "2026-11-21");
    expect(outOfRange?.severity).toBe("error");
    expect(outOfRange?.message).toContain("2026-11-21");
    expect(outOfRange?.message).toContain("Term 1");

    expect(getAttendanceDateIssue("2025-08-15", term1, "2026-11-21")).toBeNull();
  });

  it("distinguishes validation, authorization, and server errors", () => {
    expect(
      classifyAttendanceSaveError(
        new AttendanceApiError(
          400,
          "Attendance date must fall within the selected academic period.",
        ),
      ).title,
    ).toBe("Cannot save attendance");

    expect(
      classifyAttendanceSaveError(
        new AttendanceApiError(
          403,
          "Academic period is closed. Historical records are read-only.",
        ),
      ).title,
    ).toBe("Not authorized to save attendance");

    expect(
      classifyAttendanceSaveError(
        new AttendanceApiError(500, "Database unavailable"),
      ).title,
    ).toBe("Server error while saving attendance");
  });
});

describe("TeacherAttendancePage CSV export & save flows", () => {
  const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectedPeriod = {
      id: 1,
      period: "Term 1",
      period_sequence: 1,
      total_periods: 3,
      academicyear: "2025-2026",
      academic_year_id: 1,
      startDate: "2025-06-02",
      endDate: "2025-08-22",
      is_active: true,
      status: "Active",
    };
    mocks.selectedYear = {
      academic_year_id: 1,
      year_label: "2025-2026",
      start_date: "2025-06-02",
      end_date: "2026-03-31",
      is_active: true,
    };
    mocks.toastLoading.mockReturnValue("attendance-csv-export");
    mocks.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          student_id: "student-1",
          student_lrn: "100000000001",
          full_name: "Juan Dela Cruz",
          gender: "Male",
        },
      ],
    });
    mocks.getClassAttendanceLogs.mockResolvedValue([]);
    URL.createObjectURL = vi.fn(() => "blob:attendance-csv");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    cleanup();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("uses a single loading -> started toast lifecycle for CSV export and blocks duplicate clicks", async () => {
    let resolveExport!: (value: { blob: Blob; filename: string }) => void;
    mocks.exportClassAttendanceCSV.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExport = resolve;
        }),
    );

    render(
      <MemoryRouter>
        <TeacherAttendancePage />
      </MemoryRouter>,
    );

    await screen.findByText("Juan Dela Cruz");
    const exportBtn = screen.getByTestId("export-attendance-csv-button");

    fireEvent.click(exportBtn);
    fireEvent.click(exportBtn);

    expect(mocks.exportClassAttendanceCSV).toHaveBeenCalledTimes(1);
    expect(mocks.toastInfo).not.toHaveBeenCalled();
    expect(mocks.toastLoading).toHaveBeenCalledTimes(1);
    expect(mocks.toastLoading).toHaveBeenCalledWith(
      "Preparing attendance CSV export...",
      { id: "attendance-csv-export" },
    );

    resolveExport({
      blob: new Blob(["Date,Student LRN\r\n"], { type: "text/csv" }),
      filename: "Attendance_Diamond_Term_1.csv",
    });

    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Attendance CSV download started.",
        expect.objectContaining({
          id: "attendance-csv-export",
          description: expect.stringContaining("Attendance_Diamond_Term_1.csv"),
        }),
      );
    });
  });

  it("replaces loading toast with error toast when CSV export fails", async () => {
    mocks.exportClassAttendanceCSV.mockRejectedValue(
      new AttendanceApiError(
        403,
        "You do not have access to view attendance records for this class.",
      ),
    );

    render(
      <MemoryRouter>
        <TeacherAttendancePage />
      </MemoryRouter>,
    );

    await screen.findByText("Juan Dela Cruz");
    fireEvent.click(screen.getByTestId("export-attendance-csv-button"));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "You do not have access to view attendance records for this class.",
        { id: "attendance-csv-export" },
      );
    });
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("blocks accidental save when today is outside Term 1 until a valid date is explicitly selected, then saves once", async () => {
    let resolveSave!: (value: unknown[]) => void;
    mocks.recordBatchAttendance.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );

    render(
      <MemoryRouter>
        <TeacherAttendancePage />
      </MemoryRouter>,
    );

    await screen.findByText("Juan Dela Cruz");

    // Past term dates badge & explicit warning are shown; no old date was silently preselected
    expect(screen.getByText("Past Term Dates")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "No date was preselected to prevent saving to the wrong day",
    );

    const dateInput = screen.getByLabelText("Attendance date") as HTMLInputElement;
    expect(dateInput.value).toBe("");
    expect(dateInput.min).toBe("2025-06-02");
    expect(dateInput.max).toBe("2025-08-22");

    const saveBtn = screen.getByRole("button", {
      name: /save attendance log/i,
    }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    // Explicitly select a valid date inside Term 1
    fireEvent.change(dateInput, { target: { value: "2025-08-15" } });

    await waitFor(() => {
      expect(saveBtn.disabled).toBe(false);
    });

    // Rapid double click triggers only one save
    fireEvent.click(saveBtn);
    fireEvent.click(saveBtn);

    expect(mocks.recordBatchAttendance).toHaveBeenCalledTimes(1);
    expect(mocks.recordBatchAttendance).toHaveBeenCalledWith(
      expect.objectContaining({
        class_id: 10,
        academic_period_id: 1,
        date: "2025-08-15",
      }),
    );

    resolveSave([
      {
        attendance_id: 1,
        student_id: "student-1",
        student_name: "Juan Dela Cruz",
        class_id: 10,
        subject_id: null,
        date: "2025-08-15",
        status: "present",
        remarks: "",
        recorded_by_staff_id: "TCH-001",
        created_at: null,
        updated_at: null,
      },
    ]);

    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Attendance log saved.",
        expect.objectContaining({
          id: "attendance-save",
          description: expect.stringContaining("2025-08-15"),
        }),
      );
    });
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("shows categorized toast instead of native alert when backend rejects save", async () => {
    mocks.recordBatchAttendance.mockRejectedValue(
      new AttendanceApiError(
        400,
        "Attendance date must fall within the selected academic period (Term 1: 2025-06-02 to 2025-08-22).",
      ),
    );

    render(
      <MemoryRouter>
        <TeacherAttendancePage />
      </MemoryRouter>,
    );

    await screen.findByText("Juan Dela Cruz");
    fireEvent.change(screen.getByLabelText("Attendance date"), {
      target: { value: "2025-08-15" },
    });
    const saveBtn = screen.getByRole("button", { name: /save attendance log/i });
    await waitFor(() => {
      expect((saveBtn as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("Cannot save attendance", {
        id: "attendance-save",
        description:
          "Attendance date must fall within the selected academic period (Term 1: 2025-06-02 to 2025-08-22).",
      });
    });
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("marks closed historical periods as read-only and keeps saving disabled", async () => {
    mocks.selectedPeriod = {
      ...mocks.selectedPeriod,
      is_active: false,
      status: "Passed",
    };

    render(
      <MemoryRouter>
        <TeacherAttendancePage />
      </MemoryRouter>,
    );

    await screen.findByText("Juan Dela Cruz");
    expect(screen.getByText("Historical · Read-Only")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: /historical read-only/i,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
