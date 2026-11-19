// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { canPublishFromClassworkDetail } from "@/lib/classwork-utils";
import type { TeacherClasswork } from "@/types/classwork";
import ClassworkView from "./classwork-view";

const apiFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  API_URL: "http://test",
  apiFetch,
}));

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/context/AcademicPeriodContext", () => ({
  useAcademicPeriod: () => ({
    selectedPeriod: { is_active: true, period_sequence: 1, status: "active" },
    selectedYear: { is_active: true },
    periods: [],
  }),
}));

vi.mock("./forms/edit-classwork", () => ({ default: () => null }));
vi.mock("./student-submission-view", () => ({ default: () => null }));
vi.mock("./classworks/quiz-analysis-view", () => ({ default: () => null }));
vi.mock("@/components/quiz-grading-modal", () => ({ default: () => null }));
vi.mock("@/components/rubrics-score-board", () => ({ default: () => null }));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
});

const draft: TeacherClasswork = {
  classwork_id: 41,
  title: "Draft Assignment",
  description: null,
  instructions: "Complete the task.",
  classwork_type: "ASSIGNMENT",
  classwork_category: "WRITTEN_WORK",
  total_points: 20,
  is_published: false,
  show_scores: true,
  is_locked: false,
  is_archived: false,
  subject_id: 7,
  subject_name: "English",
  attachments: [],
  assignments: [
    {
      classwork_assignment_id: 91,
      classwork_id: 41,
      class_id: 12,
      due_date: "2026-11-25T08:00:00Z",
      lock_date: null,
      allow_late_submissions: true,
      max_attempts: null,
      is_published: false,
      show_scores: true,
    },
  ],
  linked_lessons: [],
  rubric_levels: [],
};

const trackingResponse = {
  ok: true,
  json: async () => ({
    classwork_assignment_id: 91,
    classwork_id: 41,
    total_students: 0,
    submitted_count: 0,
    missing_count: 0,
    submitted: [],
    missing: [],
  }),
};

describe("Teacher classwork detail header", () => {
  it("shows Publish Now only for draft Assignment, Activity, and Quiz details", () => {
    for (const classworkType of ["ASSIGNMENT", "ACTIVITY", "QUIZ"]) {
      expect(
        canPublishFromClassworkDetail({
          classwork_type: classworkType,
          is_published: false,
          is_archived: false,
        }),
      ).toBe(true);
    }

    expect(
      canPublishFromClassworkDetail({
        classwork_type: "READING",
        is_published: false,
        is_archived: false,
      }),
    ).toBe(false);
    expect(
      canPublishFromClassworkDetail({
        classwork_type: "QUIZ",
        is_published: true,
        is_archived: false,
      }),
    ).toBe(false);
    expect(
      canPublishFromClassworkDetail({
        classwork_type: "ACTIVITY",
        is_published: false,
        is_archived: true,
      }),
    ).toBe(false);
  });

  it("publishes through existing APIs, refreshes, and removes the draft action", async () => {
    const published = {
      ...draft,
      is_published: true,
      assignments: draft.assignments?.map((assignment) => ({
        ...assignment,
        is_published: true,
      })),
    };
    apiFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.includes("/submissions/classwork/")) return trackingResponse;
      if (options?.method === "PUT") {
        return { ok: true, json: async () => published };
      }
      if (options?.method === "POST" && url.endsWith("/assign")) {
        return { ok: true, json: async () => ({ updated: [12] }) };
      }
      if (url.endsWith("/classwork/41")) {
        return { ok: true, json: async () => published };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(
      <MemoryRouter>
        <SidebarProvider>
          <ClassworkView classwork={draft} />
        </SidebarProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Publish Now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit Classwork" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive Classwork" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Submission Status" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Grading Status" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Sort By" })).toBeTruthy();
    expect(screen.getByText("Grading Completion")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Publish Now" }));
    expect(await screen.findByText('Publish "Draft Assignment" now?')).toBeTruthy();
    const publishButtons = screen.getAllByRole("button", { name: "Publish Now" });
    fireEvent.click(publishButtons[publishButtons.length - 1]);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Publish Now" })).toBeNull();
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/classwork-assignments/classwork/41",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/classwork-assignments/classwork/41/assign",
      expect.objectContaining({ method: "POST" }),
    );
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/classwork-assignments/classwork/41",
    );
  });
});
