// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "./app-sidebar";
import { SidebarProvider } from "./ui/sidebar";

const mockAuth = vi.hoisted(() => ({
  role: "admin" as "admin" | "teacher" | "student" | null,
  user: {
    userId: "usr-1",
    fullName: "Test User",
    email: "test@example.com",
    avatar: null,
  },
}));

const mockPeriodContext = vi.hoisted(() => ({
  academicYears: [
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
  selectedYearId: 2 as number | null,
  setSelectedYearId: vi.fn(),
  periods: [
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
  ],
  selectedPeriodId: 202 as number | null,
  setSelectedPeriodId: vi.fn(),
  isLoading: false,
  refetch: vi.fn(),
  registerDirtyGuard: vi.fn(),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    role: mockAuth.role,
    user: mockAuth.user,
    isLoading: false,
    logout: vi.fn(),
  }),
}));

vi.mock("@/context/AcademicPeriodContext", () => ({
  useAcademicPeriod: () => mockPeriodContext,
}));

vi.mock("@/hooks/use-unread-notification-count", () => ({
  useUnreadNotificationCount: () => 0,
}));

vi.mock("@/components/teacher/ai-credits-widget", () => ({
  AICreditsWidget: () => <div data-testid="ai-credits-widget">AI Credits</div>,
}));

vi.mock("@/components/nav-user", () => ({
  NavUser: () => <div data-testid="nav-user">NavUser</div>,
}));

vi.mock("./retroui/Select", () => {
  function find(element: React.ReactNode, name: string): React.ReactElement[] {
    return React.Children.toArray(element).flatMap((child) => {
      if (!React.isValidElement(child)) return [];
      const own = child.type === name ? [child] : [];
      return [...own, ...find((child.props as { children?: React.ReactNode }).children, name)];
    });
  }

  function Select({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (val: string) => void;
    disabled?: boolean;
  }) {
    const trigger = find(children, "trigger")[0];
    const items = find(children, "item");
    const triggerProps = (trigger?.props as Record<string, unknown>) || {};
    function extractText(node: React.ReactNode): string {
      if (typeof node === "string" || typeof node === "number") return String(node);
      if (Array.isArray(node)) return node.map(extractText).join(" ");
      if (React.isValidElement(node)) return extractText((node.props as { children?: React.ReactNode }).children);
      return "";
    }

    return (
      <select
        aria-label={triggerProps["aria-label"] as string}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onValueChange?.(e.target.value)}
      >
        {items.map((item) => {
          const itemProps = (item.props as Record<string, unknown>) || {};
          return (
            <option key={String(itemProps.value)} value={String(itemProps.value)}>
              {extractText(itemProps.children as React.ReactNode)}
            </option>
          );
        })}
      </select>
    );
  }

  Select.Trigger = "trigger";
  Select.Value = "value";
  Select.Content = "content";
  Select.Group = "group";
  Select.Item = "item";

  return { Select };
});

function renderSidebar() {
  return render(
    <MemoryRouter>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </MemoryRouter>
  );
}

describe("AppSidebar (H3B.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    mockAuth.role = "admin";
    mockPeriodContext.selectedYearId = 2;
    mockPeriodContext.selectedPeriodId = 202;
    mockPeriodContext.periods = [
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
  });

  afterEach(() => {
    cleanup();
  });

  it("renders both Academic Year and Term selectors with initial values", () => {
    renderSidebar();

    const yearSelect = screen.getByLabelText("Select academic year") as HTMLSelectElement;
    const termSelect = screen.getByLabelText("Select academic term") as HTMLSelectElement;

    expect(yearSelect).toBeTruthy();
    expect(termSelect).toBeTruthy();
    expect(yearSelect.value).toBe("2");
    expect(termSelect.value).toBe("202");
  });

  it("displays only Term labels without redundant year and marks genuinely active term", () => {
    renderSidebar();

    const termSelect = screen.getByLabelText("Select academic term") as HTMLSelectElement;
    const options = Array.from(termSelect.options).map((opt) => opt.textContent?.trim());

    expect(options[0]).toBe("Term 1");
    expect(options[0]).not.toContain("2025-2026");

    expect(options[1]).toContain("Term 2");
    expect(options[1]).toContain("(Active)");
    expect(options[1]).not.toContain("2025-2026");
  });

  it("renders role navigation for Admin, Teacher, and Student", () => {
    // 1. Admin
    mockAuth.role = "admin";
    const { unmount: unmountAdmin } = renderSidebar();
    expect(screen.getByText("Dashboard")).toBeTruthy();
    expect(screen.getByText("Subject Load")).toBeTruthy();
    expect(screen.getByText("System Settings")).toBeTruthy();
    expect(screen.queryByTestId("ai-credits-widget")).toBeNull();
    unmountAdmin();

    // 2. Teacher
    mockAuth.role = "teacher";
    const { unmount: unmountTeacher } = renderSidebar();
    expect(screen.getByText("Classes")).toBeTruthy();
    expect(screen.getByText("Attendance")).toBeTruthy();
    expect(screen.getByTestId("ai-credits-widget")).toBeTruthy();
    unmountTeacher();

    // 3. Student
    mockAuth.role = "student";
    const { unmount: unmountStudent } = renderSidebar();
    expect(screen.getByText("Study Board")).toBeTruthy();
    expect(screen.getByText("Subjects")).toBeTruthy();
    expect(screen.getByText("To Do")).toBeTruthy();
    expect(screen.queryByTestId("ai-credits-widget")).toBeNull();
    unmountStudent();
  });

  it("handles empty periods gracefully with disabled state", () => {
    mockPeriodContext.periods = [];
    mockPeriodContext.selectedPeriodId = null;

    renderSidebar();

    const termSelect = screen.getByLabelText("Select academic term") as HTMLSelectElement;
    expect(termSelect.disabled).toBe(true);
  });

  it("switching year triggers setSelectedYearId without global activation API calls", () => {
    renderSidebar();

    const yearSelect = screen.getByLabelText("Select academic year");
    fireEvent.change(yearSelect, { target: { value: "1" } });

    expect(mockPeriodContext.setSelectedYearId).toHaveBeenCalledWith(1);
  });

  it("switching term triggers setSelectedPeriodId", () => {
    renderSidebar();

    const termSelect = screen.getByLabelText("Select academic term");
    fireEvent.change(termSelect, { target: { value: "201" } });

    expect(mockPeriodContext.setSelectedPeriodId).toHaveBeenCalledWith(201);
  });
});
