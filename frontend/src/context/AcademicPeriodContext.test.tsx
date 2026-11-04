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
import { AuthProvider, useAuth } from "./AuthContext";

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
      <div data-testid="available-years">
        {ctx.academicYears.map((y) => y.academic_year_id).join(",")}
      </div>
      <button
        data-testid="btn-year-1"
        onClick={() => ctx.setSelectedYearId(1)}
      >
        Select Year 1
      </button>
      <button
        data-testid="btn-year-2"
        onClick={() => ctx.setSelectedYearId(2)}
      >
        Select Year 2
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

function AuthTestConsumer() {
  const auth = useAuth();
  const period = useAcademicPeriod();

  return (
    <div>
      <div data-testid="auth-role">{auth.role ?? "none"}</div>
      <div data-testid="auth-user">{auth.user?.userId ?? "none"}</div>
      <div data-testid="period-year-id">{period.selectedYearId ?? "none"}</div>
      <div data-testid="period-loading">{period.isLoading ? "loading" : "ready"}</div>
      <div data-testid="available-years">
        {period.academicYears.map((y) => y.academic_year_id).join(",")}
      </div>
      <button
        data-testid="btn-login-teacher"
        onClick={() => auth.login("teacher@example.com", "password")}
      >
        Login Teacher
      </button>
      <button
        data-testid="btn-logout"
        onClick={() => auth.logout()}
      >
        Logout
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
      if (url === "/api/v1/auth/me") {
        return {
          ok: true,
          json: async () => ({
            role: "admin",
            user_id: "usr-admin",
            email: "admin@example.com",
          }),
        };
      }
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
      <AuthProvider>
        <AcademicPeriodProvider>
          <TestConsumer />
        </AcademicPeriodProvider>
      </AuthProvider>
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

  describe("H3C.4B.3 Role-Based Context Synchronization", () => {
    it("Admin role: displays historical, active, and prepared future academic years", async () => {
      mockApiFetch.mockImplementation(async (url: string) => {
        if (url === "/api/v1/auth/me") {
          return {
            ok: true,
            json: async () => ({
              role: "admin",
              user_id: "usr-admin-1",
              email: "admin@entervene.test",
            }),
          };
        }
        if (url === "/api/v1/settings/academic-years") {
          return { ok: true, json: async () => ({ years: mockYears }) };
        }
        if (url === "/api/v1/settings/academic-periods?academic_year_id=2") {
          return { ok: true, json: async () => ({ periods: mockPeriodsYear2 }) };
        }
        if (url === "/api/v1/settings/academic-periods?academic_year_id=3") {
          return { ok: true, json: async () => ({ periods: mockPeriodsYear3 }) };
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

      await waitFor(() => {
        expect(screen.getByTestId("loading").textContent).toBe("ready");
        expect(screen.getByTestId("available-years").textContent).toBe("1,2,3");
      });

      // Admin can view and select future year (Year 3)
      act(() => {
        fireEvent.click(screen.getByTestId("btn-year-3"));
      });

      await waitFor(() => {
        expect(screen.getByTestId("year-id").textContent).toBe("3");
        expect(screen.getByTestId("period-id").textContent).toBe("301");
      });
    });

    it("Teacher role: strictly excludes future academic years and displays active + historical only", async () => {
      mockApiFetch.mockImplementation(async (url: string) => {
        if (url === "/api/v1/auth/me") {
          return {
            ok: true,
            json: async () => ({
              role: "teacher",
              user_id: "usr-teacher-1",
              email: "teacher@entervene.test",
            }),
          };
        }
        // Even if raw API response contains future Year 3, defense-in-depth filters it out
        if (url === "/api/v1/settings/academic-years") {
          return { ok: true, json: async () => ({ years: mockYears }) };
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

      await waitFor(() => {
        expect(screen.getByTestId("loading").textContent).toBe("ready");
      });

      // Future Year 3 must NEVER appear for Teacher
      expect(screen.getByTestId("available-years").textContent).toBe("1,2");
      expect(screen.getByTestId("available-years").textContent).not.toContain("3");

      // Attempting to select Year 3 is blocked
      act(() => {
        fireEvent.click(screen.getByTestId("btn-year-3"));
      });

      expect(screen.getByTestId("year-id").textContent).toBe("2");
    });

    it("Student role: strictly excludes future academic years", async () => {
      mockApiFetch.mockImplementation(async (url: string) => {
        if (url === "/api/v1/auth/me") {
          return {
            ok: true,
            json: async () => ({
              role: "student",
              user_id: "usr-student-1",
              email: "student@entervene.test",
            }),
          };
        }
        if (url === "/api/v1/settings/academic-years") {
          return {
            ok: true,
            json: async () => ({
              years: [
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
            }),
          };
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

      await waitFor(() => {
        expect(screen.getByTestId("loading").textContent).toBe("ready");
      });

      // Student only sees active Year 2, never future Year 3
      expect(screen.getByTestId("available-years").textContent).toBe("2");
      expect(screen.getByTestId("year-id").textContent).toBe("2");
    });

    it("synchronizes academic years on login and logout transitions", async () => {
      let isTeacherLoggedIn = false;

      mockApiFetch.mockImplementation(async (url: string) => {
        if (url === "/api/v1/auth/me") {
          if (!isTeacherLoggedIn) {
            return { ok: false, status: 401 };
          }
          return {
            ok: true,
            json: async () => ({
              role: "teacher",
              user_id: "usr-teacher-1",
              email: "teacher@entervene.test",
            }),
          };
        }
        if (url === "/api/v1/auth/login") {
          isTeacherLoggedIn = true;
          return {
            ok: true,
            json: async () => ({
              role: "teacher",
              user_id: "usr-teacher-1",
              email: "teacher@entervene.test",
            }),
          };
        }
        if (url === "/api/v1/auth/logout") {
          isTeacherLoggedIn = false;
          return { ok: true, json: async () => ({}) };
        }
        if (url === "/api/v1/settings/academic-years") {
          // Unauthenticated: active year only. Teacher: active + historical.
          if (!isTeacherLoggedIn) {
            return {
              ok: true,
              json: async () => ({
                years: [
                  {
                    academic_year_id: 2,
                    year_label: "2025-2026",
                    start_date: "2025-08-01",
                    end_date: "2026-05-31",
                    is_active: true,
                  },
                ],
              }),
            };
          } else {
            return {
              ok: true,
              json: async () => ({
                years: [
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
                ],
              }),
            };
          }
        }
        if (url.includes("/api/v1/settings/academic-periods")) {
          return { ok: true, json: async () => ({ periods: mockPeriodsYear2 }) };
        }
        return { ok: false, status: 404 };
      });

      render(
        <AuthProvider>
          <AcademicPeriodProvider>
            <AuthTestConsumer />
          </AcademicPeriodProvider>
        </AuthProvider>
      );

      // Initial state: unauthenticated, only active year 2 is available
      await waitFor(() => {
        expect(screen.getByTestId("period-loading").textContent).toBe("ready");
        expect(screen.getByTestId("available-years").textContent).toBe("2");
      });

      // Login as Teacher
      await act(async () => {
        fireEvent.click(screen.getByTestId("btn-login-teacher"));
      });

      // Context must re-fetch authorized years: now shows 1,2
      await waitFor(() => {
        expect(screen.getByTestId("auth-role").textContent).toBe("teacher");
        expect(screen.getByTestId("available-years").textContent).toBe("1,2");
      });

      // Logout
      await act(async () => {
        fireEvent.click(screen.getByTestId("btn-logout"));
      });

      // Context must re-fetch and revert to active year only: 2
      await waitFor(() => {
        expect(screen.getByTestId("auth-role").textContent).toBe("none");
        expect(screen.getByTestId("available-years").textContent).toBe("2");
      });
    });

    it("resets unauthorized future stored selection to active year when switching from Admin to Teacher", async () => {
      const teacherId = "usr-teacher-99";
      // Teacher has stored Year 3 (future year) in localStorage from before
      localStorage.setItem(getAcademicYearStorageKey(teacherId), "3");

      mockApiFetch.mockImplementation(async (url: string) => {
        if (url === "/api/v1/auth/me") {
          return {
            ok: true,
            json: async () => ({
              role: "teacher",
              user_id: teacherId,
              email: "teacher99@entervene.test",
            }),
          };
        }
        if (url === "/api/v1/settings/academic-years") {
          // Backend returns only authorized active Year 2 and historical Year 1
          return {
            ok: true,
            json: async () => ({
              years: [
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
              ],
            }),
          };
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

      // Context must reject stored Year 3 (unauthorized) and reset to active Year 2
      await waitFor(() => {
        expect(screen.getByTestId("loading").textContent).toBe("ready");
        expect(screen.getByTestId("year-id").textContent).toBe("2");
      });

      // Storage must be overwritten with active year 2
      expect(localStorage.getItem(getAcademicYearStorageKey(teacherId))).toBe("2");
    });

    it("rejects nonexistent or unauthorized stored year (ID 999) and resets to active year", async () => {
      const studentId = "usr-student-42";
      localStorage.setItem(getAcademicYearStorageKey(studentId), "999");

      mockApiFetch.mockImplementation(async (url: string) => {
        if (url === "/api/v1/auth/me") {
          return {
            ok: true,
            json: async () => ({
              role: "student",
              user_id: studentId,
              email: "student42@entervene.test",
            }),
          };
        }
        if (url === "/api/v1/settings/academic-years") {
          return {
            ok: true,
            json: async () => ({
              years: [
                {
                  academic_year_id: 2,
                  year_label: "2025-2026",
                  start_date: "2025-08-01",
                  end_date: "2026-05-31",
                  is_active: true,
                },
              ],
            }),
          };
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

      await waitFor(() => {
        expect(screen.getByTestId("loading").textContent).toBe("ready");
        expect(screen.getByTestId("year-id").textContent).toBe("2");
      });

      // Storage must be sanitized
      expect(localStorage.getItem(getAcademicYearStorageKey(studentId))).toBe("2");
    });

    it("recovers to active authorized year when direct period request returns 403 Forbidden", async () => {
      mockApiFetch.mockImplementation(async (url: string) => {
        if (url === "/api/v1/settings/academic-years") {
          return {
            ok: true,
            json: async () => ({
              years: [
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
              ],
            }),
          };
        }
        if (url === "/api/v1/settings/academic-periods?academic_year_id=1") {
          // Direct request returns 403 Forbidden
          return {
            ok: false,
            status: 403,
            json: async () => ({ detail: "Forbidden: Not authorized" }),
          };
        }
        if (url === "/api/v1/settings/academic-periods?academic_year_id=2") {
          return { ok: true, json: async () => ({ periods: mockPeriodsYear2 }) };
        }
        if (url === "/api/v1/auth/me") {
          return { ok: false, status: 401 };
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

      // Switch to Year 1 (which will return 403)
      act(() => {
        fireEvent.click(screen.getByTestId("btn-year-1"));
      });

      // Context must recover back to active Year 2
      await waitFor(() => {
        expect(screen.getByTestId("year-id").textContent).toBe("2");
        expect(screen.getByTestId("period-id").textContent).toBe("202");
      });
    });
  });
});
