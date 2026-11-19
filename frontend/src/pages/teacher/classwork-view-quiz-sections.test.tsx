// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import type { TeacherClasswork } from "@/types/classwork";
import type { QuizAnalysis } from "./classworks/quiz-builder-types";
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

const quizClasswork: TeacherClasswork = {
  classwork_id: 55,
  title: "Constructing Parallel & Perpendicular Lines Quiz",
  description: null,
  instructions: null,
  classwork_type: "QUIZ",
  classwork_category: "WRITTEN_WORK",
  total_points: 10,
  is_published: true,
  show_scores: true,
  is_locked: false,
  is_archived: false,
  subject_id: 9,
  subject_name: "Enhanced Mathematics 9",
  attachments: [],
  assignments: [
    {
      classwork_assignment_id: 101,
      classwork_id: 55,
      class_id: 10,
      title: "Archimedes",
      due_date: "2026-11-25T08:00:00Z",
      lock_date: null,
      allow_late_submissions: true,
      max_attempts: 1,
      is_published: true,
      show_scores: true,
    },
    {
      classwork_assignment_id: 102,
      classwork_id: 55,
      class_id: 11,
      title: "Copernicus",
      due_date: "2026-11-26T08:00:00Z",
      lock_date: null,
      allow_late_submissions: true,
      max_attempts: 1,
      is_published: true,
      show_scores: true,
    },
  ],
  linked_lessons: [],
  rubric_levels: [],
};

const allSectionsAnalysis: QuizAnalysis = {
  quiz_id: 7,
  classwork_id: 55,
  title: quizClasswork.title,
  total_points: 10,
  total_students: 33,
  submitted_count: 1,
  missing_count: 32,
  graded_count: 1,
  needs_grading_count: 0,
  questions: [],
  students: [
    {
      student_id: "s-arch",
      student_name: "Alice Santos",
      first_name: "Alice",
      last_name: "Santos",
      submission_id: null,
      status: "not_submitted",
      attempt_count: 0,
      grade: null,
      score_percent: null,
      needs_grading: false,
      answers: [],
    },
    {
      student_id: "s-cop",
      student_name: "Ben Cruz",
      first_name: "Ben",
      last_name: "Cruz",
      submission_id: 901,
      status: "graded",
      attempt_count: 1,
      grade: 8,
      score_percent: 80,
      needs_grading: false,
      answers: [],
    },
  ],
};

const archimedesAnalysis: QuizAnalysis = {
  quiz_id: 7,
  classwork_id: 55,
  title: quizClasswork.title,
  total_points: 10,
  total_students: 17,
  submitted_count: 0,
  missing_count: 17,
  graded_count: 0,
  needs_grading_count: 0,
  questions: [],
  students: [allSectionsAnalysis.students[0]],
};

const copernicusAnalysis: QuizAnalysis = {
  quiz_id: 7,
  classwork_id: 55,
  title: quizClasswork.title,
  total_points: 10,
  total_students: 16,
  submitted_count: 1,
  missing_count: 15,
  graded_count: 1,
  needs_grading_count: 0,
  questions: [],
  students: [allSectionsAnalysis.students[1]],
};

describe("Teacher quiz classwork section filter", () => {
  it("filters Quiz Analysis participation, accuracy, and students when clicking section buttons", async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url === "/api/v1/submissions/classwork/55/tracking") {
        return {
          ok: true,
          json: async () => ({
            classwork_id: 55,
            total_students: 33,
            submitted_count: 1,
            missing_count: 32,
            submitted: [],
            missing: [],
          }),
        };
      }
      if (url === "/api/v1/submissions/assignment/101/tracking") {
        return {
          ok: true,
          json: async () => ({
            classwork_assignment_id: 101,
            classwork_id: 55,
            total_students: 17,
            submitted_count: 0,
            missing_count: 17,
            submitted: [],
            missing: [],
          }),
        };
      }
      if (url === "/api/v1/submissions/assignment/102/tracking") {
        return {
          ok: true,
          json: async () => ({
            classwork_assignment_id: 102,
            classwork_id: 55,
            total_students: 16,
            submitted_count: 1,
            missing_count: 15,
            submitted: [],
            missing: [],
          }),
        };
      }
      if (url === "/api/v1/quizzes/classwork/55/analysis") {
        return { ok: true, json: async () => allSectionsAnalysis };
      }
      if (url === "/api/v1/quizzes/classwork/55/analysis?assignment_id=101") {
        return { ok: true, json: async () => archimedesAnalysis };
      }
      if (url === "/api/v1/quizzes/classwork/55/analysis?assignment_id=102") {
        return { ok: true, json: async () => copernicusAnalysis };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(
      <MemoryRouter>
        <SidebarProvider>
          <ClassworkView classwork={quizClasswork} />
        </SidebarProvider>
      </MemoryRouter>,
    );

    // Initially All Sections: 1 of 33, both students shown
    expect(await screen.findByText("1 of 33")).toBeTruthy();
    expect(screen.getByText("Santos, Alice")).toBeTruthy();
    expect(screen.getByText("Cruz, Ben")).toBeTruthy();

    // Click Archimedes -> fetches assignment_id=101, updates Participation to 0 of 17, shows only Alice
    fireEvent.click(screen.getByRole("button", { name: "Archimedes" }));
    expect(await screen.findByText("0 of 17")).toBeTruthy();
    expect(screen.getByText("No results yet")).toBeTruthy();
    expect(screen.getByText("Santos, Alice")).toBeTruthy();
    expect(screen.queryByText("Cruz, Ben")).toBeNull();
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/quizzes/classwork/55/analysis?assignment_id=101",
    );

    // Click Copernicus -> fetches assignment_id=102, updates Participation to 1 of 16, shows only Ben
    fireEvent.click(screen.getByRole("button", { name: "Copernicus" }));
    expect(await screen.findByText("1 of 16")).toBeTruthy();
    expect(screen.getByText("Cruz, Ben")).toBeTruthy();
    expect(screen.queryByText("Santos, Alice")).toBeNull();
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/quizzes/classwork/55/analysis?assignment_id=102",
    );

    // Click All Sections -> back to unfiltered analysis (1 of 33)
    fireEvent.click(screen.getByRole("button", { name: "All Sections" }));
    await waitFor(() => {
      expect(screen.getByText("1 of 33")).toBeTruthy();
    });
    expect(screen.getByText("Santos, Alice")).toBeTruthy();
    expect(screen.getByText("Cruz, Ben")).toBeTruthy();
  });
});
