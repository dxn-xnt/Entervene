// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SetupYearWizard from "./forms/classes/setup-year-wizard";
import AddClassModal from "./forms/add-class";
import { Dialog } from "@/components/retroui/Dialog";
import { invalidateReusableSetupCache } from "@/lib/academic-year-chronology";

const mocks = vi.hoisted(() => ({
  selectedYearId: 3 as number | null,
  selectedYear: {
    academic_year_id: 3,
    year_label: "AY 2026-2027",
    start_date: "2026-08-01",
    end_date: "2027-05-31",
    is_active: false,
  },
  academicYears: [
    {
      academic_year_id: 1,
      year_label: "AY 2024-2025",
      start_date: "2024-08-01",
      end_date: "2025-05-31",
      is_active: false,
    },
    {
      academic_year_id: 2,
      year_label: "AY 2025-2026",
      start_date: "2025-08-01",
      end_date: "2026-05-31",
      is_active: true,
    },
    {
      academic_year_id: 3,
      year_label: "AY 2026-2027",
      start_date: "2026-08-01",
      end_date: "2027-05-31",
      is_active: false,
    },
    {
      academic_year_id: 4,
      year_label: "AY 2027-2028",
      start_date: "2027-08-01",
      end_date: "2028-05-31",
      is_active: false,
    },
  ],
  setupAcademicYearClasses: vi.fn(),
  getClasses: vi.fn(),
  getOfficialSections: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/context/AcademicPeriodContext", () => ({
  useAcademicPeriod: () => ({
    selectedYearId: mocks.selectedYearId,
    selectedYear: mocks.selectedYear,
    academicYears: mocks.academicYears,
  }),
}));

vi.mock("@/lib/api", () => ({
  setupAcademicYearClasses: (...args: unknown[]) => mocks.setupAcademicYearClasses(...args),
  getClasses: (...args: unknown[]) => mocks.getClasses(...args),
  getOfficialSections: (...args: unknown[]) => mocks.getOfficialSections(...args),
  getManualClassOptions: vi.fn().mockResolvedValue({
    academic_year: mocks.selectedYear,
    academic_levels: [],
    eligible_advisers: [],
  }),
  createClassesBatch: vi.fn(),
}));

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({
    success: mocks.toastSuccess,
    error: mocks.toastError,
  }),
}));

describe("SetupYearWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateReusableSetupCache();
    mocks.selectedYearId = 3;
    mocks.selectedYear = {
      academic_year_id: 3,
      year_label: "AY 2026-2027",
      start_date: "2026-08-01",
      end_date: "2027-05-31",
      is_active: false,
    };
    mocks.getClasses.mockImplementation(async (_status, yearId) => {
      if (yearId === 2) {
        return {
          summary: { total_classes: 2, active_classes: 2, archived_classes: 0, students_assigned: 50 },
          classes: [{ class_id: 1 }],
        };
      }
      return { summary: { total_classes: 0, active_classes: 0, archived_classes: 0, students_assigned: 0 }, classes: [] };
    });
    mocks.getOfficialSections.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders setup modes and excludes target year and future years from source selection", () => {
    render(
      <SetupYearWizard
        onBack={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Retain Classes and Advisers")).toBeTruthy();
    expect(screen.getByText("Retain Classes Without Advisers")).toBeTruthy();
    expect(screen.getByText("Sections Only")).toBeTruthy();
    expect(screen.getByText("AY 2026-2027")).toBeTruthy();

    // Future year AY 2027-2028 should never appear
    expect(screen.queryByText(/AY 2027-2028/)).toBeNull();
  });

  it("navigates to summary and calls setup API on confirmation", async () => {
    const onClassesCreated = vi.fn();
    const onClose = vi.fn();

    mocks.setupAcademicYearClasses.mockResolvedValueOnce({
      source_academic_year_id: 2,
      target_academic_year_id: 3,
      mode: "retain_classes_and_advisers",
      sections_created: 4,
      sections_reused: 0,
      classes_created: 4,
      classes_reused: 0,
      sections: [],
      classes: [],
      adviser_conflicts: [],
    });

    render(
      <SetupYearWizard
        onBack={vi.fn()}
        onClose={onClose}
        onClassesCreated={onClassesCreated}
      />
    );

    // Continue to summary
    const continueBtn = screen.getByRole("button", { name: /continue to summary/i });
    fireEvent.click(continueBtn);

    // Verify summary step
    expect(screen.getByText("Data Safety Guarantees")).toBeTruthy();
    expect(screen.getByText(/Student enrollments and grades are never copied/i)).toBeTruthy();

    // Confirm & Set Up
    const confirmBtn = screen.getByRole("button", { name: /confirm & set up/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mocks.setupAcademicYearClasses).toHaveBeenCalledWith({
        source_academic_year_id: 2,
        target_academic_year_id: 3,
        mode: "retain_classes_and_advisers",
      });
      expect(onClassesCreated).toHaveBeenCalled();
    });

    // Check success view
    expect(screen.getByText("Setup Completed Successfully")).toBeTruthy();
    expect(screen.getAllByText("4")).toHaveLength(2);
  });

  it("displays conflict error when setup fails", async () => {
    mocks.setupAcademicYearClasses.mockRejectedValueOnce(
      new Error("Adviser is already assigned to an active class in the target academic year.")
    );

    render(
      <SetupYearWizard
        onBack={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /continue to summary/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm & set up/i }));

    await waitFor(() => {
      expect(screen.getByText(/Adviser is already assigned to an active class/i)).toBeTruthy();
    });
  });

  it("disables continue button and shows notice when no chronologically earlier years exist", () => {
    render(
      <SetupYearWizard
        sourceYears={[]}
        onBack={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(
      screen.getByText("No chronologically earlier academic years exist with reusable sections or classes.")
    ).toBeTruthy();
    const continueBtn = screen.getByRole("button", { name: /continue to summary/i });
    expect((continueBtn as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AddClassModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateReusableSetupCache();
    mocks.selectedYearId = 3;
    mocks.selectedYear = {
      academic_year_id: 3,
      year_label: "AY 2026-2027",
      start_date: "2026-08-01",
      end_date: "2027-05-31",
      is_active: false,
    };
    mocks.getClasses.mockImplementation(async (_status, yearId) => {
      if (yearId === 2) {
        return {
          summary: { total_classes: 2, active_classes: 2, archived_classes: 0, students_assigned: 50 },
          classes: [{ class_id: 1 }],
        };
      }
      return { summary: { total_classes: 0, active_classes: 0, archived_classes: 0, students_assigned: 0 }, classes: [] };
    });
    mocks.getOfficialSections.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows Set Up from Previous Year option when chronologically earlier year has reusable setup", async () => {
    render(
      <Dialog open={true}>
        <AddClassModal onClose={vi.fn()} />
      </Dialog>
    );

    const setupCard = await screen.findByText("Set Up from Previous Year");
    expect(setupCard).toBeTruthy();

    fireEvent.click(setupCard);

    expect(screen.getByText("Continue to Summary")).toBeTruthy();
  });

  it("does NOT show Set Up from Previous Year option for earliest academic year (AY 2025-2026)", async () => {
    mocks.selectedYearId = 2;
    mocks.selectedYear = {
      academic_year_id: 2,
      year_label: "AY 2025-2026",
      start_date: "2025-08-01",
      end_date: "2026-05-31",
      is_active: true,
    };

    render(
      <Dialog open={true}>
        <AddClassModal onClose={vi.fn()} />
      </Dialog>
    );

    // Wait a tick for async checks
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByText("Set Up from Previous Year")).toBeNull();
    expect(screen.getByText("Import from File")).toBeTruthy();
    expect(screen.getByText("Create Manually")).toBeTruthy();
  });

  it("does NOT show Set Up from Previous Year option when earlier years have 0 classes and 0 sections", async () => {
    // Both AY 2024-2025 and AY 2025-2026 return 0 classes and 0 sections
    mocks.getClasses.mockResolvedValue({
      summary: { total_classes: 0, active_classes: 0, archived_classes: 0, students_assigned: 0 },
      classes: [],
    });

    render(
      <Dialog open={true}>
        <AddClassModal onClose={vi.fn()} />
      </Dialog>
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByText("Set Up from Previous Year")).toBeNull();
  });
});
