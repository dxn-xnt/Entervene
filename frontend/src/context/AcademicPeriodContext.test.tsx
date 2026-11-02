// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AcademicPeriodProvider,
  useAcademicPeriod,
  useRegisterDirtyGuard,
  getAcademicYearStorageKey,
  getAcademicPeriodStorageKey,
} from "./AcademicPeriodContext";
import { AuthProvider } from "./AuthContext";

const mockApiFetch = vi.fn();

vi.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockYears = [
  {
    academic_year_id: 1,
    year_label: "2024-2025",
    start_date: "2024-08-01",
    end_date: "2025-05-31",
    is_active: false,
  },
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
];

const mockPeriodsYear1 = [
  {
    id: 101,
    period: "Term 1",
    period_sequence: 1,
    period_type: "Quarter",
    total_periods: 4,
    academicyear: "2024-2025",
    academic_year_id: 1,
    startDate: "2024-08-01",
    endDate: "2024-10-31",
    is_active: false,
    status: "Passed",
  },
  {
    id: 102,
    period: "Term 2",
    period_sequence: 2,
    period_type: "Quarter",
    total_periods: 4,
    academicyear: "2024-2025",
    academic_year_id: 1,
    startDate: "2024-11-01",
    endDate: "2025-01-31",
    is_active: false,
    status: "Passed",
  },
];

const mockPeriodsYear2 = [
  {
    id: 201,
    period: "Term 1",
    period_sequence: 1,
    period_type: "Quarter",
    total_periods: 4,
    academicyear: "2025-2026",
    academic_year_id: 2,
    startDate: "2025-08-01",
    endDate: "2025-10-31",
    is_active: false,
    status: "Passed",
  },
  {
    id: 202,
    period: "Term 2",
    period_sequence: 2,
    period_type: "Quarter",
    total_periods: 4,
    academicyear: "2025-2026",
    academic_year_id: 2,
    startDate: "2025-11-01",
    endDate: "2026-01-31",
    is_active: true,
    status: "Active",
  },
];

const mockPeriodsYear3 = [
  {
    id: 301,
    period: "Term 1",
    period_sequence: 1,
    period_type: "Quarter",
    total_periods: 4,
    academicyear: "2026-2027",
    academic_year_id: 3,
    startDate: "2026-08-01",
    endDate: "2026-10-31",
    is_active: false,
    status: "Upcoming",
  },
];

function setupApiFetch(options?: {
  delayYear3?: number;
}) {
  mockApiFetch.mockImplementation(async (url: string) => {
    if (url === "/api/v1/settings/academic-years") {
      return {
        ok: true,
        json: async () => ({ years: mockYears }),
      };
    }
    if (url === "/api/v1/settings/academic-periods?academic_year_id=1") {
      return {
        ok: true,
        json: async () => ({ periods: mockPeriodsYear1 }),
      };
    }
    if (
      url === "/api/v1/settings/academic-periods?academic_year_id=2" ||
      url === "/api/v1/settings/academic-periods"
    ) {
      return {
        ok: true,
        json: async () => ({ periods: mockPeriodsYear2 }),
      };
    }
    if (url === "/api/v1/settings/academic-periods?academic_year_id=3") {
      if (options?.delayYear3) {
        await new Promise((resolve) => setTimeout(resolve, options.delayYear3));
      }
      return {
        ok: true,
        json: async () => ({ periods: mockPeriodsYear3 }),
      };
    }
    if (url === "/api/v1/auth/me") {
      return {
        ok: false,
        status: 401,
      };
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({}),
    };
  });
}

function TestConsumer({
  onRender,
}: {
  onRender?: (ctx: ReturnType<typeof useAcademicPeriod>) => void;
}) {
  const ctx = useAcademicPeriod();
  onRender?.(ctx);
  return (
    <div>
      <div data-testid="year-id">{ctx.selectedYearId ?? "none"}</div>
      <div data-testid="period-id">{ctx.selectedPeriodId ?? "none"}</div>
      <div data-testid="year-label">{ctx.selectedYear?.year_label ?? "none"}</div>
      <div data-testid="period-label">{ctx.selectedPeriod?.period ?? "none"}</div>
      <div data-testid="loading">{ctx.isLoading ? "loading" : "ready"}</div>
      <button
        data-testid="btn-year-1"
        onClick={() => ctx.setSelectedYearId(1)}
      >
        Select Year 1
      </button>
      <button
        data-testid="btn-year-3"
        onClick={() => ctx.setSelectedYearId(3)}
      >
        Select Year 3
      </button>
      <button
        data-testid="btn-period-201"
        onClick={() => ctx.setSelectedPeriodId(201)}
      >
        Select Period 201
      </button>
    </div>
  );
}

function DirtyConsumer({ isDirty }: { isDirty: boolean }) {
  const ctx = useAcademicPeriod();
  useRegisterDirtyGuard(isDirty, {
    message: "Guard message: unsaved edits in test",
  });
  return (
    <div>
      <div data-testid="dirty-period-id">{ctx.selectedPeriodId ?? "none"}</div>
      <div data-testid="dirty-year-id">{ctx.selectedYearId ?? "none"}</div>
      <button
        data-testid="dirty-btn-year-1"
        onClick={() => ctx.setSelectedYearId(1)}
      >
        Switch to Year 1
      </button>
      <button
        data-testid="dirty-btn-period-201"
        onClick={() => ctx.setSelectedPeriodId(201)}
      >
        Switch to Period 201
      </button>
    </div>
  );
}

describe("AcademicPeriodContext (H3A.1)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockApiFetch.mockReset();
    setupApiFetch();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads academic years and initializes with active year and active period", async () => {
    render(
      <AcademicPeriodProvider>
        <TestConsumer />
      </AcademicPeriodProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("ready");
    });

    // Active year in mockYears is Year 2 (2025-2026)
    expect(screen.getByTestId("year-id").textContent).toBe("2");
    expect(screen.getByTestId("year-label").textContent).toBe("2025-2026");

    // Active period in Year 2 is 202 (Term 2)
    expect(screen.getByTestId("period-id").textContent).toBe("202");
    expect(screen.getByTestId("period-label").textContent).toBe("Term 2");
  });

  it("switches academic year and ensures selected period belongs to the new year", async () => {
    render(
      <AcademicPeriodProvider>
        <TestConsumer />
      </AcademicPeriodProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("year-id").textContent).toBe("2");
    });

    // Switch to Year 1 (2024-2025)
    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-year-1"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("year-id").textContent).toBe("1");
    });

    expect(screen.getByTestId("year-label").textContent).toBe("2024-2025");
    // Year 1 has no active period, so it falls back to first period in Year 1 (id: 101)
    expect(screen.getByTestId("period-id").textContent).toBe("101");
    expect(screen.getByTestId("period-label").textContent).toBe("Term 1");
  });

  it("persists selections per user to prevent cross-account leakage", async () => {
    const userA = "usr-alpha-123";
    const userB = "usr-beta-456";

    // Set saved preferences for userA
    localStorage.setItem(getAcademicYearStorageKey(userA), "1");
    localStorage.setItem(getAcademicPeriodStorageKey(userA, 1), "102");

    // Mock auth returning userA
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === "/api/v1/auth/me") {
        return {
          ok: true,
          json: async () => ({
            role: "teacher",
            user_id: userA,
            email: "alpha@example.com",
          }),
        };
      }
      if (url === "/api/v1/settings/academic-years") {
        return { ok: true, json: async () => ({ years: mockYears }) };
      }
      if (url === "/api/v1/settings/academic-periods?academic_year_id=1") {
        return { ok: true, json: async () => ({ periods: mockPeriodsYear1 }) };
      }
      if (url === "/api/v1/settings/academic-periods?academic_year_id=2") {
        return { ok: true, json: async () => ({ periods: mockPeriodsYear2 }) };
      }
      return { ok: false, status: 404 };
    });

    const { unmount } = render(
      <AuthProvider>
        <AcademicPeriodProvider>
          <TestConsumer />
        </AcademicPeriodProvider>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("year-id").textContent).toBe("1");
      expect(screen.getByTestId("period-id").textContent).toBe("102");
    });

    unmount();

    // Now userB logs in. userB has NO saved preferences.
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === "/api/v1/auth/me") {
        return {
          ok: true,
          json: async () => ({
            role: "student",
            user_id: userB,
            email: "beta@example.com",
          }),
        };
      }
      if (url === "/api/v1/settings/academic-years") {
        return { ok: true, json: async () => ({ years: mockYears }) };
      }
      if (url === "/api/v1/settings/academic-periods?academic_year_id=1") {
        return { ok: true, json: async () => ({ periods: mockPeriodsYear1 }) };
      }
      if (url === "/api/v1/settings/academic-periods?academic_year_id=2") {
        return { ok: true, json: async () => ({ periods: mockPeriodsYear2 }) };
      }
      return { ok: false, status: 404 };
    });

    render(
      <AuthProvider>
        <AcademicPeriodProvider>
          <TestConsumer />
        </AcademicPeriodProvider>
      </AuthProvider>
    );

    // userB must NOT leak userA's Year 1 / Term 2! userB defaults to active Year 2 / Term 202.
    await waitFor(() => {
      expect(screen.getByTestId("year-id").textContent).toBe("2");
      expect(screen.getByTestId("period-id").textContent).toBe("202");
    });
  });

  it("blocks year switch when dirty guard is active and allows discard upon confirmation", async () => {
    render(
      <AcademicPeriodProvider>
        <DirtyConsumer isDirty={true} />
      </AcademicPeriodProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("dirty-year-id").textContent).toBe("2");
    });

    // Attempt to switch to Year 1
    fireEvent.click(screen.getByTestId("dirty-btn-year-1"));

    // Confirmation dialog should appear
    await waitFor(() => {
      expect(screen.getByText("Unsaved Changes in Academic Context")).toBeTruthy();
      expect(
        screen.getByText("Guard message: unsaved edits in test")
      ).toBeTruthy();
    });

    // Year must still be 2 (switch prevented!)
    expect(screen.getByTestId("dirty-year-id").textContent).toBe("2");

    // Click "Stay Here" (cancel)
    fireEvent.click(screen.getByText("Stay Here"));

    await waitFor(() => {
      expect(screen.queryByText("Unsaved Changes in Academic Context")).toBeNull();
    });
    expect(screen.getByTestId("dirty-year-id").textContent).toBe("2");

    // Now click Switch to Year 1 again, but confirm discard
    fireEvent.click(screen.getByTestId("dirty-btn-year-1"));
    await waitFor(() => {
      expect(screen.getByText("Discard & Switch")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Discard & Switch"));

    await waitFor(() => {
      expect(screen.getByTestId("dirty-year-id").textContent).toBe("1");
      expect(screen.getByTestId("dirty-period-id").textContent).toBe("101");
    });
  });

  it("prevents stale responses during rapid year switching", async () => {
    // Make Year 3 respond after 100ms, whereas Year 1 responds immediately
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === "/api/v1/settings/academic-years") {
        return { ok: true, json: async () => ({ years: mockYears }) };
      }
      if (url === "/api/v1/settings/academic-periods?academic_year_id=2") {
        return { ok: true, json: async () => ({ periods: mockPeriodsYear2 }) };
      }
      if (url === "/api/v1/settings/academic-periods?academic_year_id=3") {
        await new Promise((r) => setTimeout(r, 80));
        return { ok: true, json: async () => ({ periods: mockPeriodsYear3 }) };
      }
      if (url === "/api/v1/settings/academic-periods?academic_year_id=1") {
        await new Promise((r) => setTimeout(r, 10));
        return { ok: true, json: async () => ({ periods: mockPeriodsYear1 }) };
      }
      return { ok: false, status: 404 };
    });

    render(
      <AcademicPeriodProvider>
        <TestConsumer />
      </AcademicPeriodProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("year-id").textContent).toBe("2");
    });

    // Trigger switch to Year 3 (slow request) followed immediately by switch to Year 1 (fast request)
    act(() => {
      fireEvent.click(screen.getByTestId("btn-year-3"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("btn-year-1"));
    });

    // Wait for everything to settle
    await waitFor(
      () => {
        expect(screen.getByTestId("year-id").textContent).toBe("1");
        expect(screen.getByTestId("period-id").textContent).toBe("101");
      },
      { timeout: 500 }
    );

    // Wait extra time to ensure Year 3's delayed response does not overwrite Year 1
    await new Promise((r) => setTimeout(r, 120));

    expect(screen.getByTestId("year-id").textContent).toBe("1");
    expect(screen.getByTestId("period-id").textContent).toBe("101");
  });
});
