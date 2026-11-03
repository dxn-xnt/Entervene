// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import SubjectDetails from "@/pages/teacher/subject-view";
import * as apiModule from "@/lib/api";

// ── Mock AppLayout & UI ──
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
    dialogHeaderCloseButtonClassName: "mock-close-btn",
  };
});

vi.mock("@/components/subject-class-header", () => ({
  SubjectClassHeader: () => <div data-testid="subject-class-header" />,
}));

vi.mock("@/pages/teacher/subject-details/subject-lesson-list", () => ({
  default: ({ filteredLessons = [], isReadOnly = false }: { filteredLessons?: any[]; isReadOnly?: boolean }) => (
    <div data-testid="subject-lesson-list" data-read-only={String(isReadOnly)}>
      {filteredLessons.map((l) => (
        <span key={l.lesson_id} data-testid={`lesson-${l.lesson_id}`}>{l.title}</span>
      ))}
    </div>
  ),
}));

vi.mock("@/pages/teacher/subject-details/subject-classwork-tab", () => ({
  default: () => <div data-testid="subject-classwork-tab" />,
}));

vi.mock("@/pages/teacher/lesson-view", () => ({
  default: () => <div data-testid="lesson-view" />,
}));

vi.mock("@/pages/teacher/subject-details/tos-generator-screen", () => ({
  default: () => <div data-testid="tos-generator-screen" />,
}));

vi.mock("@/components/teacher/repost-modal", () => ({
  RepostModal: () => null,
}));

vi.mock("@/pages/teacher/forms/lesson-delivery-correction-modal", () => ({
  default: () => null,
}));

vi.mock("@/pages/teacher/forms/create-lesson", () => ({
  default: () => null,
}));

vi.mock("@/pages/teacher/forms/create-classwork", () => ({
  default: () => null,
}));

vi.mock("@/pages/teacher/forms/create-classwork-quiz", () => ({
  default: () => null,
}));

vi.mock("@/pages/teacher/forms/classwork-preview-modal", () => ({
  default: () => null,
}));

vi.mock("@/pages/teacher/forms/competency-modal", () => ({
  default: () => null,
}));

vi.mock("@/pages/teacher/forms/manage-lesson", () => ({
  default: () => null,
}));

vi.mock("@/components/confirm-dialog", () => ({
  ConfirmDialog: () => null,
}));

vi.mock("@/components/dialogue-select", () => ({
  DialogueSelect: () => null,
}));

vi.mock("@/lib/lesson-delivery-api", () => ({
  fetchClassSubjectDeliveries: vi.fn().mockResolvedValue([]),
  confirmLessonDelivery: vi.fn(),
  correctLessonDelivery: vi.fn(),
}));

vi.mock("@/lib/student-record-api", () => ({
  getTeacherRecordPeriods: vi.fn().mockResolvedValue({ default_academic_period_id: 10, periods: [] }),
  getTeacherStudentRoster: vi.fn().mockResolvedValue({ students: [] }),
}));

// Mutable context state for AcademicPeriodContext
let mockPeriodContext = {
  selectedPeriodId: "1804",
  selectedYearId: "804",
  periods: [
    { id: 1804, name: "1st Quarter", is_active: true, academic_year_id: 804 },
    { id: 1806, name: "2nd Quarter", is_active: false, academic_year_id: 804 },
  ],
};

vi.mock("@/context/AcademicPeriodContext", () => ({
  useAcademicPeriod: () => ({
    ...mockPeriodContext,
    selectedPeriod: mockPeriodContext.periods.find(
      (period) => period.id === Number(mockPeriodContext.selectedPeriodId),
    ) ?? null,
    selectedYear: {
      academic_year_id: Number(mockPeriodContext.selectedYearId),
      is_active: mockPeriodContext.periods.some(
        (period) =>
          period.academic_year_id === Number(mockPeriodContext.selectedYearId) &&
          period.is_active,
      ),
    },
  }),
}));

describe("Teacher Lessons Academic Context Synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPeriodContext = {
      selectedPeriodId: "1804",
      selectedYearId: "804",
      periods: [
        { id: 1804, name: "1st Quarter", is_active: true, academic_year_id: 804 },
        { id: 1806, name: "2nd Quarter", is_active: false, academic_year_id: 804 },
      ],
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("fetches lessons and competencies with academic_period_id and academic_year_id query parameters", async () => {
    const apiFetchSpy = vi.spyOn(apiModule, "apiFetch").mockImplementation((url: string) => {
      if (url.includes("/api/v1/classwork-assignments/teacher/classes")) {
        return Promise.resolve(new Response(JSON.stringify([
          { class_id: 104, subject_id: 10, academic_period_id: 1804 }
        ]), { status: 200 }));
      }
      if (url.includes("/api/v1/lessons/my-class/104/subject/10")) {
        return Promise.resolve(new Response(JSON.stringify([
          { lesson_id: 1, title: "Algebra Lesson", is_archived: false }
        ]), { status: 200 }));
      }
      if (url.includes("/api/v1/classwork-assignments/teacher/class/104/subject/10/assignments")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.includes("/api/v1/competencies/subject/10")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    });

    render(
      <MemoryRouter initialEntries={["/teacher/classes/104/subject/10"]}>
        <Routes>
          <Route path="/teacher/classes/:classId/subject/:subjectId" element={<SubjectDetails />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("lesson-1")).toBeDefined();
    });

    // Verify URL parameters in apiFetch calls
    const lessonCalls = apiFetchSpy.mock.calls.filter(([url]) =>
      url.includes("/api/v1/lessons/my-class/104/subject/10")
    );
    expect(lessonCalls.length).toBeGreaterThan(0);
    const lessonUrl = lessonCalls[0][0];
    expect(lessonUrl).toContain("academic_period_id=1804");
    expect(lessonUrl).toContain("academic_year_id=804");

    const compCalls = apiFetchSpy.mock.calls.filter(([url]) =>
      url.includes("/api/v1/competencies/subject/10")
    );
    expect(compCalls.length).toBeGreaterThan(0);
    const compUrl = compCalls[0][0];
    expect(compUrl).toContain("period_id=1804");
  });

  it("refetches lessons and competencies when academic period changes", async () => {
    let callCount = 0;
    const apiFetchSpy = vi.spyOn(apiModule, "apiFetch").mockImplementation((url: string) => {
      if (url.includes("/api/v1/classwork-assignments/teacher/classes")) {
        return Promise.resolve(new Response(JSON.stringify([
          { class_id: 104, subject_id: 10, academic_period_id: 1804 }
        ]), { status: 200 }));
      }
      if (url.includes("/api/v1/lessons/my-class/104/subject/10")) {
        callCount++;
        const title = url.includes("academic_period_id=1806") ? "Geometry Lesson" : "Algebra Lesson";
        return Promise.resolve(new Response(JSON.stringify([
          { lesson_id: callCount, title, is_archived: false }
        ]), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    });

    const { rerender } = render(
      <MemoryRouter initialEntries={["/teacher/classes/104/subject/10"]}>
        <Routes>
          <Route path="/teacher/classes/:classId/subject/:subjectId" element={<SubjectDetails />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Algebra Lesson")).toBeDefined();
    });

    // Simulate user selecting Period 2 (1806)
    mockPeriodContext = {
      selectedPeriodId: "1806",
      selectedYearId: "804",
      periods: [
        { id: 1804, name: "1st Quarter", is_active: false, academic_year_id: 804 },
        { id: 1806, name: "2nd Quarter", is_active: true, academic_year_id: 804 },
      ],
    };

    rerender(
      <MemoryRouter initialEntries={["/teacher/classes/104/subject/10"]}>
        <Routes>
          <Route path="/teacher/classes/:classId/subject/:subjectId" element={<SubjectDetails />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Geometry Lesson")).toBeDefined();
    });

    // Check that apiFetch was called with period 1806
    const period2Calls = apiFetchSpy.mock.calls.filter(([url]) =>
      url.includes("/api/v1/lessons/my-class/104/subject/10") && url.includes("academic_period_id=1806")
    );
    expect(period2Calls.length).toBeGreaterThan(0);
  });

  it("makes historical lesson controls read-only while preserving active-year controls", async () => {
    mockPeriodContext = {
      selectedPeriodId: "1806",
      selectedYearId: "804",
      periods: [
        { id: 1804, name: "1st Quarter", is_active: true, academic_year_id: 804 },
        { id: 1806, name: "2nd Quarter", is_active: false, academic_year_id: 804 },
      ],
    };
    vi.spyOn(apiModule, "apiFetch").mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    render(
      <MemoryRouter initialEntries={["/teacher/classes/104/subject/10"]}>
        <Routes>
          <Route path="/teacher/classes/:classId/subject/:subjectId" element={<SubjectDetails />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("subject-lesson-list").getAttribute("data-read-only")).toBe("true");
    });
    expect((screen.getByRole("button", { name: "Add Lesson" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Repost" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
