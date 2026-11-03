// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Grades from "./grades";

const mocks = vi.hoisted(() => ({
  selectedPeriodId: 1 as number | null,
  getMySubjects: vi.fn(),
  getStudentTodos: vi.fn(),
}));

vi.mock("@/context/AcademicPeriodContext", () => ({
  useAcademicPeriod: () => ({ selectedPeriodId: mocks.selectedPeriodId }),
}));

vi.mock("@/lib/api", () => ({
  getMySubjects: mocks.getMySubjects,
  getStudentTodos: mocks.getStudentTodos,
}));

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => null,
}));

function subject(periodId: number, name: string) {
  return {
    subject_load_id: periodId * 10,
    class_id: periodId === 1 ? 7 : 8,
    subject_id: 5,
    subject_name: name,
    subject_codename: "MATH",
    teacher_name: "Teacher One",
    period_id: periodId,
    period_name: `Term ${periodId}`,
    is_current_period: periodId === 1,
    is_current_quarter: periodId === 1,
    section_name: "Rizal",
    year_label: "2026-2027",
  };
}

function todo(classId: number, title: string) {
  return {
    assignment_id: classId * 100,
    class_id: classId,
    classwork_id: classId * 10,
    title,
    subject: "Mathematics",
    subject_id: 5,
    due_date: null,
    deadline: "No deadline",
    type: "ASSIGNMENT",
    category: "WRITTEN_WORK",
    is_graded: true,
    total_points: 100,
    status: "completed",
    is_submitted: true,
    grade: 90,
  };
}

beforeEach(() => {
  mocks.selectedPeriodId = 1;
  mocks.getMySubjects.mockReset();
  mocks.getStudentTodos.mockReset();
  mocks.getMySubjects.mockImplementation(async (periodId?: number) => [
    subject(periodId ?? 1, periodId === 2 ? "Future Mathematics" : "Current Mathematics"),
  ]);
  mocks.getStudentTodos.mockImplementation(async (periodId?: number) => {
    const items = periodId === 2
      ? [todo(8, "Future Grade")]
      : [todo(7, "Current Grade"), todo(99, "Other Class Grade")];
    return { pending: [], pastdue: [], completed: items, all: items };
  });
});

afterEach(() => cleanup());

it("scopes student grade details to the selected term and selected class", async () => {
  render(<MemoryRouter><Grades /></MemoryRouter>);

  fireEvent.click(await screen.findByRole("button", { name: "View grades for Current Mathematics" }));

  expect(await screen.findByText("Current Grade")).toBeTruthy();
  expect(screen.queryByText("Other Class Grade")).toBeNull();
  expect(mocks.getStudentTodos.mock.calls.every(([periodId]) => periodId === 1)).toBe(true);
});

it("leaves the old subject detail and requests the new term after a context switch", async () => {
  const view = render(<MemoryRouter><Grades /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "View grades for Current Mathematics" }));
  expect(await screen.findByText("Current Grade")).toBeTruthy();

  mocks.selectedPeriodId = 2;
  view.rerender(<MemoryRouter><Grades /></MemoryRouter>);

  expect(screen.queryByText("Current Grade")).toBeNull();
  expect(await screen.findByRole("button", { name: "View grades for Future Mathematics" })).toBeTruthy();
  await waitFor(() => expect(mocks.getStudentTodos).toHaveBeenCalledWith(2));
});
