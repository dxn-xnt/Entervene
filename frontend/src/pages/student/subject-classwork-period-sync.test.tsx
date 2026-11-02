// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SubjectClassworkTab from "./subjects-view/tabs/subject-classwork-tab";

const mocks = vi.hoisted(() => ({
  selectedPeriodId: 1 as number | null,
  apiFetch: vi.fn(),
}));

vi.mock("@/context/AcademicPeriodContext", () => ({
  useAcademicPeriod: () => ({ selectedPeriodId: mocks.selectedPeriodId }),
}));

vi.mock("@/lib/api", () => ({
  API_URL: "",
  apiFetch: mocks.apiFetch,
}));

vi.mock("@/hooks/use-reading-focus-tracker", () => ({
  useReadingFocusTracker: () => undefined,
}));

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
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
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

function assignment(id: number, title: string) {
  return {
    classwork_assignment_id: id,
    classwork_id: id,
    title,
    classwork_type: "ASSIGNMENT",
    is_published: true,
    attachments: [],
  };
}

function renderTab() {
  return render(
    <MemoryRouter>
      <SubjectClassworkTab classId={7} subjectId={5} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.selectedPeriodId = 1;
  mocks.apiFetch.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Student Subject Detail classwork period synchronization", () => {
  it("passes the selected period and preserves an unscoped request when none is selected", async () => {
    mocks.apiFetch.mockResolvedValue(response([]));
    const view = renderTab();

    await waitFor(() =>
      expect(mocks.apiFetch).toHaveBeenCalledWith(
        "/api/v1/classwork-assignments/class/7/subject/5?academic_period_id=1",
      ),
    );

    mocks.apiFetch.mockClear();
    mocks.selectedPeriodId = null;
    view.rerender(
      <MemoryRouter>
        <SubjectClassworkTab classId={7} subjectId={5} />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(mocks.apiFetch).toHaveBeenCalledWith(
        "/api/v1/classwork-assignments/class/7/subject/5",
      ),
    );
  });

  it("clears old classwork and ignores a stale response after a period switch", async () => {
    const oldRequest = deferred<Response>();
    mocks.apiFetch.mockImplementation((url: string) => {
      if (url.includes("academic_period_id=1")) return oldRequest.promise;
      if (url.includes("academic_period_id=2")) {
        return Promise.resolve(response([assignment(2, "New-term work")]));
      }
      return Promise.resolve(response([]));
    });

    const view = renderTab();
    await waitFor(() =>
      expect(mocks.apiFetch).toHaveBeenCalledWith(
        "/api/v1/classwork-assignments/class/7/subject/5?academic_period_id=1",
      ),
    );

    mocks.selectedPeriodId = 2;
    view.rerender(
      <MemoryRouter>
        <SubjectClassworkTab classId={7} subjectId={5} />
      </MemoryRouter>,
    );

    expect(await screen.findByText("New-term work")).toBeTruthy();

    await act(async () => {
      oldRequest.resolve(response([assignment(1, "Old-term work")]));
    });

    expect(screen.queryByText("Old-term work")).toBeNull();
    expect(screen.getByText("New-term work")).toBeTruthy();
  });
});
