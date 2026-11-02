// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminClasses from "./classes";

const mocks = vi.hoisted(() => ({
  selectedYearId: 2 as number | null,
  selectedYear: {
    academic_year_id: 2,
    year_label: "2025-2026",
    start_date: "2025-08-01",
    end_date: "2026-05-31",
    is_active: true,
  },
  academicYears: [
    {
      academic_year_id: 2,
      year_label: "2025-2026",
      start_date: "2025-08-01",
      end_date: "2026-05-31",
      is_active: true,
    },
    {
      academic_year_id: 3,
      year_label: "2026-2027",
      start_date: "2026-08-01",
      end_date: "2027-05-31",
      is_active: false,
    },
  ],
  getClasses: vi.fn(),
}));

vi.mock("@/context/AcademicPeriodContext", () => ({
  useAcademicPeriod: () => ({
    selectedYearId: mocks.selectedYearId,
    selectedYear: mocks.selectedYear,
    academicYears: mocks.academicYears,
    isLoading: false,
  }),
}));

vi.mock("@/lib/api", () => ({
  getClasses: (...args: unknown[]) => mocks.getClasses(...args),
  archiveClass: vi.fn(),
  getOfficialSections: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => null,
}));

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

const mock2025Response = {
  summary: {
    total_classes: 2,
    active_classes: 2,
    archived_classes: 0,
    students_assigned: 50,
  },
  classes: [
    {
      class_id: 10,
      section_name: "Diamond",
      class_status: "active",
      pathway_id: null,
      pathway: null,
      academic_year: { academic_year_id: 2, year_label: "2025-2026" },
      academic_level: { academic_level_id: 7, level_name: "Grade 7", grade_level: 7, requires_pathway: false },
      adviser: { staff_id: "T-1", first_name: "John", middle_name: null, last_name: "Doe", suffix: null, avatar: null },
      student_count: 25,
      subject_count: 0,
      male_count: 12,
      female_count: 13,
    },
    {
      class_id: 11,
      section_name: "Emerald",
      class_status: "active",
      pathway_id: null,
      pathway: null,
      academic_year: { academic_year_id: 2, year_label: "2025-2026" },
      academic_level: { academic_level_id: 7, level_name: "Grade 7", grade_level: 7, requires_pathway: false },
      adviser: { staff_id: "T-2", first_name: "Jane", middle_name: null, last_name: "Smith", suffix: null, avatar: null },
      student_count: 25,
      subject_count: 0,
      male_count: 10,
      female_count: 15,
    },
  ],
};

const mock2026EmptyResponse = {
  summary: {
    total_classes: 0,
    active_classes: 0,
    archived_classes: 0,
    students_assigned: 0,
  },
  classes: [],
};

describe("Admin Classes Year Sync & Isolation (H3C.1 / H3C.3C / H3C.3D)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectedYearId = 2;
    mocks.selectedYear = {
      academic_year_id: 2,
      year_label: "2025-2026",
      start_date: "2025-08-01",
      end_date: "2026-05-31",
      is_active: true,
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("requests classes scoped to the selected academic year and renders cards and counts", async () => {
    mocks.getClasses.mockResolvedValueOnce(mock2025Response);

    render(
      <MemoryRouter>
        <AdminClasses />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mocks.getClasses).toHaveBeenCalledWith("active", 2);
    });

    // Check summary statistics
    await waitFor(() => {
      expect(screen.getByText("Diamond")).toBeTruthy();
      expect(screen.getByText("Emerald")).toBeTruthy();
    });

    expect(screen.getByText("50")).toBeTruthy(); // students_assigned
  });

  it("displays proper empty state and zeroed counts when selected academic year has no classes", async () => {
    mocks.selectedYearId = 3;
    mocks.selectedYear = {
      academic_year_id: 3,
      year_label: "2026-2027",
      start_date: "2026-08-01",
      end_date: "2027-05-31",
      is_active: false,
    };
    mocks.getClasses.mockResolvedValueOnce(mock2026EmptyResponse);

    render(
      <MemoryRouter>
        <AdminClasses />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mocks.getClasses).toHaveBeenCalledWith("active", 3);
    });

    // Empty state for 2026-2027
    await waitFor(() => {
      expect(screen.getByText("No classes in 2026-2027")).toBeTruthy();
      expect(
        screen.getByText(
          "There are no classes configured for academic year 2026-2027. Create a class to start organizing students and subjects."
        )
      ).toBeTruthy();
      expect(screen.getAllByRole("button", { name: /new class/i }).length).toBeGreaterThanOrEqual(2);
    });
  });

  it("clears old-year class list immediately and ignores stale out-of-order response when switching academic years", async () => {
    let resolveFirstYear: (value: unknown) => void;
    const firstYearPromise = new Promise((resolve) => {
      resolveFirstYear = resolve;
    });

    // AY 2025-2026 starts loading (slow response)
    mocks.selectedYearId = 2;
    mocks.selectedYear = {
      academic_year_id: 2,
      year_label: "2025-2026",
      start_date: "2025-08-01",
      end_date: "2026-05-31",
      is_active: true,
    };
    mocks.getClasses.mockReturnValueOnce(firstYearPromise);

    const { rerender } = render(
      <MemoryRouter>
        <AdminClasses />
      </MemoryRouter>
    );

    expect(mocks.getClasses).toHaveBeenCalledWith("active", 2);

    // Now user switches to AY 2026-2027 (fast empty response)
    mocks.selectedYearId = 3;
    mocks.selectedYear = {
      academic_year_id: 3,
      year_label: "2026-2027",
      start_date: "2026-08-01",
      end_date: "2027-05-31",
      is_active: false,
    };
    mocks.getClasses.mockResolvedValueOnce(mock2026EmptyResponse);

    rerender(
      <MemoryRouter>
        <AdminClasses />
      </MemoryRouter>
    );

    // Fast response finishes for AY 2026-2027
    await waitFor(() => {
      expect(screen.getByText("No classes in 2026-2027")).toBeTruthy();
    });

    // Now the slow response from AY 2025-2026 arrives late!
    resolveFirstYear!(mock2025Response);

    // Even after resolving, AY 2026-2027 empty state remains and Diamond is NOT shown
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText("No classes in 2026-2027")).toBeTruthy();
    expect(screen.queryByText("Diamond")).toBeNull();
  });

  it("switching 2025-2026 -> 2026-2027 -> 2025-2026 properly isolates 0 classes and restores classes on return", async () => {
    mocks.selectedYearId = 2;
    mocks.selectedYear = {
      academic_year_id: 2,
      year_label: "2025-2026",
      start_date: "2025-08-01",
      end_date: "2026-05-31",
      is_active: true,
    };
    mocks.getClasses.mockResolvedValueOnce(mock2025Response);

    const { rerender } = render(
      <MemoryRouter>
        <AdminClasses />
      </MemoryRouter>
    );

    // 1. Initial 2025-2026 state
    await waitFor(() => {
      expect(screen.getByText("Diamond")).toBeTruthy();
    });
    expect(screen.getByText("50")).toBeTruthy();

    // 2. Switch to 2026-2027 (empty year)
    mocks.selectedYearId = 3;
    mocks.selectedYear = {
      academic_year_id: 3,
      year_label: "2026-2027",
      start_date: "2026-08-01",
      end_date: "2027-05-31",
      is_active: false,
    };
    mocks.getClasses.mockResolvedValueOnce(mock2026EmptyResponse);

    rerender(
      <MemoryRouter>
        <AdminClasses />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("No classes in 2026-2027")).toBeTruthy();
    });
    expect(screen.queryByText("Diamond")).toBeNull();
    expect(screen.queryByText("50")).toBeNull();

    // 3. Switch back to 2025-2026 (restores classes)
    mocks.selectedYearId = 2;
    mocks.selectedYear = {
      academic_year_id: 2,
      year_label: "2025-2026",
      start_date: "2025-08-01",
      end_date: "2026-05-31",
      is_active: true,
    };
    mocks.getClasses.mockResolvedValueOnce(mock2025Response);

    rerender(
      <MemoryRouter>
        <AdminClasses />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Diamond")).toBeTruthy();
      expect(screen.getByText("Emerald")).toBeTruthy();
    });
    expect(screen.getByText("50")).toBeTruthy();
  });

  it("never displays another year's classes or statistics even if API mistakenly returns alien classes", async () => {
    // Current year is AY 2026-2027 (id: 3)
    mocks.selectedYearId = 3;
    mocks.selectedYear = {
      academic_year_id: 3,
      year_label: "2026-2027",
      start_date: "2026-08-01",
      end_date: "2027-05-31",
      is_active: false,
    };

    // Suppose a buggy API or unscoped fallback returned classes from AY 2025-2026 (id: 2)
    mocks.getClasses.mockResolvedValueOnce({
      summary: {
        total_classes: 12,
        active_classes: 12,
        archived_classes: 0,
        students_assigned: 94,
      },
      classes: mock2025Response.classes, // These belong to academic_year_id: 2
    });

    render(
      <MemoryRouter>
        <AdminClasses />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mocks.getClasses).toHaveBeenCalledWith("active", 3);
    });

    // Despite alien classes returned by API, component strictly isolates and rejects them
    await waitFor(() => {
      expect(screen.getByText("No classes in 2026-2027")).toBeTruthy();
    });
    expect(screen.queryByText("Diamond")).toBeNull();
    expect(screen.queryByText("Emerald")).toBeNull();
    expect(screen.queryByText("94")).toBeNull();
    expect(screen.queryByText("50")).toBeNull();
  });
});
