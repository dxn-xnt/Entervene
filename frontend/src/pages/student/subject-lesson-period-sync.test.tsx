// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SubjectLessonTab from "./subjects-view/tabs/subject-lesson-tab";

const mocks = vi.hoisted(() => ({
  selectedPeriodId: 1 as number | null,
  apiFetch: vi.fn(),
  getLessonGoals: vi.fn(),
  getStudentTodos: vi.fn(),
}));

vi.mock("@/context/AcademicPeriodContext", () => ({
  useAcademicPeriod: () => ({ selectedPeriodId: mocks.selectedPeriodId }),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: mocks.apiFetch,
  getLessonGoals: mocks.getLessonGoals,
  getStudentTodos: mocks.getStudentTodos,
}));

vi.mock("@/hooks/use-reading-focus-tracker", () => ({
  useReadingFocusTracker: () => undefined,
}));

vi.mock("@/components/item-line/lesson", () => ({
  default: ({ lesson, children }: { lesson: { title: string }; children: ReactNode }) => (
    <div><span>{lesson.title}</span>{children}</div>
  ),
}));

vi.mock("@/components/item-line/classwork", () => ({
  default: ({ item }: { item: { title: string } }) => <div>{item.title}</div>,
}));

vi.mock("@/pages/student/lesson-view", () => ({
  StudentLessonDetailScreen: () => null,
}));

vi.mock("@/components/lesson-goal-progress", () => ({
  LessonGoalProgress: () => null,
}));

vi.mock("@/components/student-lesson-mastery", () => ({
  StudentLessonMastery: () => null,
}));

vi.mock("@/pages/student/forms/student-classwork-detail-modal", () => ({
  default: () => null,
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function response(data: unknown) {
  return { ok: true, json: async () => data } as Response;
}

function lesson(id: number, title: string) {
  return {
    lesson_id: id,
    title,
    attachments: [],
    created_at: "2025-06-01T00:00:00Z",
    updated_at: "2025-06-01T00:00:00Z",
  };
}

function renderTab() {
  return render(
    <MemoryRouter>
      <SubjectLessonTab
        classId={7}
        subjectId={5}
        subjectName="Science"
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.selectedPeriodId = 1;
  mocks.apiFetch.mockReset();
  mocks.getLessonGoals.mockReset();
  mocks.getStudentTodos.mockReset();
  mocks.getLessonGoals.mockResolvedValue({ items: [] });
  mocks.getStudentTodos.mockResolvedValue({ all: [] });
});

afterEach(() => {
  cleanup();
});

describe("Student lesson period synchronization", () => {
  it("passes the selected period to lesson activity requests and ignores stale responses", async () => {
    const oldLessons = deferred<Response>();
    mocks.apiFetch.mockImplementation((url: string) => {
      if (url === "/api/v1/lessons/class/7/subject/5?academic_period_id=1") {
        return oldLessons.promise;
      }
      if (url === "/api/v1/lessons/class/7/subject/5?academic_period_id=2") {
        return Promise.resolve(response([lesson(2, "New-term lesson")]));
      }
      return Promise.resolve(response([]));
    });

    const view = renderTab();
    await waitFor(() =>
      expect(mocks.apiFetch).toHaveBeenCalledWith(
        "/api/v1/lessons/class/7/subject/5?academic_period_id=1",
      ),
    );

    mocks.selectedPeriodId = 2;
    view.rerender(
      <MemoryRouter>
        <SubjectLessonTab classId={7} subjectId={5} subjectName="Science" />
      </MemoryRouter>,
    );

    expect(await screen.findByText("New-term lesson")).toBeTruthy();
    await waitFor(() => {
      expect(mocks.apiFetch).toHaveBeenCalledWith(
        "/api/v1/lessons/2/classwork-assignments?class_id=7&academic_period_id=2",
      );
      expect(mocks.apiFetch).toHaveBeenCalledWith(
        "/api/v1/classwork-assignments/class/7/subject/5?academic_period_id=2",
      );
    });

    await act(async () => {
      oldLessons.resolve(response([lesson(1, "Old-term lesson")]));
    });

    expect(screen.queryByText("Old-term lesson")).toBeNull();
    expect(screen.getByText("New-term lesson")).toBeTruthy();
  });
});

