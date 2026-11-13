// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Subjects from "./subjects";
import StudentSubjectDetail from "./subject-detail";

const mocks = vi.hoisted(() => ({
  selectedPeriodId: 1 as number | null,
  getMySubjects: vi.fn(),
  getStudentTodos: vi.fn(),
  apiFetch: vi.fn(),
}));

vi.mock("@/context/AcademicPeriodContext", () => ({
  useAcademicPeriod: () => ({ selectedPeriodId: mocks.selectedPeriodId }),
}));

vi.mock("@/lib/api", () => ({
  getMySubjects: mocks.getMySubjects,
  getStudentTodos: mocks.getStudentTodos,
  apiFetch: mocks.apiFetch,
}));

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => null,
}));

vi.mock("@/components/student/student-subject-section-card", () => ({
  StudentSubjectSectionCard: ({
    subjectName,
    classworks,
  }: {
    subjectName: string;
    classworks: unknown[] | null;
  }) => <div>{subjectName}:{classworks?.length ?? "loading"}</div>,
}));

vi.mock("@/components/subject-class-header", () => ({
  SubjectClassHeader: ({
    currentSubject,
    detail,
  }: {
    currentSubject: { subject_name: string };
    detail: { academic_level?: string };
  }) => <div>{currentSubject.subject_name}|{detail.academic_level}</div>,
}));

vi.mock("./subjects-view/tabs/subject-lesson-tab", () => ({
  default: () => <div>Lesson tab</div>,
}));

vi.mock("./subjects-view/tabs/subject-classwork-tab", () => ({
  default: () => <div>Classwork tab</div>,
}));

vi.mock("./subjects-view/tabs/subject-suggestions-tab", () => ({
  default: ({ classId, subjectId }: { classId: number; subjectId: number }) =>
    <div>Suggestions for {classId}/{subjectId}</div>,
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

function subject(periodId: number, name: string) {
  return {
    subject_load_id: periodId * 10,
    class_id: 7,
    subject_id: 5,
    subject_name: name,
    subject_codename: "SUBJ",
    teacher_name: "Teacher One",
    teacher_avatar: null,
    period_id: periodId,
    period_name: `Term ${periodId}`,
    is_current_period: periodId === 2,
    is_current_quarter: periodId === 2,
    section_name: "Rizal",
    year_label: periodId === 1 ? "2025-2026" : "2026-2027",
  };
}

function renderSubjects() {
  return render(
    <MemoryRouter>
      <Subjects />
    </MemoryRouter>,
  );
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/student/subjects/7/5"]}>
      <Routes>
        <Route
          path="/student/subjects/:classId/:subjectId"
          element={<StudentSubjectDetail />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.selectedPeriodId = 1;
  mocks.getMySubjects.mockReset();
  mocks.getStudentTodos.mockReset();
  mocks.apiFetch.mockReset();
  mocks.getStudentTodos.mockResolvedValue({
    pending: [],
    pastdue: [],
    completed: [],
    all: [],
  });
});

afterEach(() => {
  cleanup();
});

describe("Student Subjects period synchronization", () => {
  it("requests subjects and classwork for the selected term and refreshes on year/term switch", async () => {
    mocks.getMySubjects.mockImplementation(async (periodId?: number) => [
      subject(periodId ?? 0, periodId === 2 ? "Future Science" : "Current Science"),
    ]);

    const view = renderSubjects();
    expect(await screen.findByText("Current Science:0")).toBeTruthy();
    expect(mocks.getMySubjects).toHaveBeenLastCalledWith(1);
    expect(mocks.getStudentTodos).toHaveBeenLastCalledWith(1);

    mocks.selectedPeriodId = 2;
    view.rerender(
      <MemoryRouter>
        <Subjects />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Future Science:0")).toBeTruthy();
    expect(mocks.getMySubjects).toHaveBeenLastCalledWith(2);
    expect(mocks.getStudentTodos).toHaveBeenLastCalledWith(2);
  });

  it("preserves the legitimate unscoped contract when no period is selected", async () => {
    mocks.selectedPeriodId = null;
    mocks.getMySubjects.mockResolvedValue([subject(1, "All-period Science")]);

    renderSubjects();

    expect(await screen.findByText("All-period Science:0")).toBeTruthy();
    expect(mocks.getMySubjects).toHaveBeenCalledWith(undefined);
    expect(mocks.getStudentTodos).toHaveBeenCalledWith(undefined);
  });

  it("clears old cards immediately and ignores a stale response after switching", async () => {
    const next = deferred<ReturnType<typeof subject>[]>();
    mocks.getMySubjects.mockImplementation((periodId?: number) =>
      periodId === 1
        ? Promise.resolve([subject(1, "Old Science")])
        : next.promise,
    );

    const view = renderSubjects();
    expect(await screen.findByText("Old Science:0")).toBeTruthy();

    mocks.selectedPeriodId = 2;
    view.rerender(
      <MemoryRouter>
        <Subjects />
      </MemoryRouter>,
    );
    expect(screen.queryByText("Old Science:0")).toBeNull();

    await act(async () => {
      next.resolve([subject(2, "New Science")]);
    });
    expect(await screen.findByText("New Science:0")).toBeTruthy();
  });
});

describe("Student Subject Details period synchronization", () => {
  it("mounts the existing Suggestions tab for the selected subject", async () => {
    mocks.getMySubjects.mockResolvedValue([subject(1, "Science")]);
    renderDetail();
    expect(await screen.findByText(/Science\|2025-2026/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
    expect(screen.getByText("Suggestions for 7/5")).toBeTruthy();
  });

  it("supports direct historical navigation using only the selected period", async () => {
    mocks.selectedPeriodId = 1;
    mocks.getMySubjects.mockResolvedValue([subject(1, "Historical Science")]);

    renderDetail();

    expect(await screen.findByText("Historical Science|2025-2026 · Rizal")).toBeTruthy();
    expect(mocks.getMySubjects).toHaveBeenCalledTimes(1);
    expect(mocks.getMySubjects).toHaveBeenCalledWith(1);
  });

  it("does not fall back to another term when the routed subject is absent", async () => {
    mocks.selectedPeriodId = 2;
    mocks.getMySubjects.mockImplementation(async (periodId?: number) =>
      periodId === undefined ? [subject(1, "Leaked Historical Science")] : [],
    );

    renderDetail();

    expect(await screen.findByText("Subject unavailable for this term")).toBeTruthy();
    expect(screen.queryByText(/Leaked Historical Science/)).toBeNull();
    expect(mocks.getMySubjects).toHaveBeenCalledTimes(1);
    expect(mocks.getMySubjects).toHaveBeenCalledWith(2);
  });

  it("does not display stale metadata while a new period request is pending", async () => {
    const next = deferred<ReturnType<typeof subject>[]>();
    mocks.getMySubjects.mockImplementation((periodId?: number) =>
      periodId === 1
        ? Promise.resolve([subject(1, "Old Detail")])
        : next.promise,
    );

    const view = renderDetail();
    expect(await screen.findByText("Old Detail|2025-2026 · Rizal")).toBeTruthy();

    mocks.selectedPeriodId = 2;
    view.rerender(
      <MemoryRouter initialEntries={["/student/subjects/7/5"]}>
        <Routes>
          <Route
            path="/student/subjects/:classId/:subjectId"
            element={<StudentSubjectDetail />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByText(/Old Detail/)).toBeNull();

    await act(async () => {
      next.resolve([subject(2, "New Detail")]);
    });
    expect(await screen.findByText("New Detail|2026-2027 · Rizal")).toBeTruthy();
  });
});
