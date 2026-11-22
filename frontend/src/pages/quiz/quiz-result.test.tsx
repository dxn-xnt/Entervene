// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import StudentQuizResult from "./quiz-result";
import { STUDY_SUPPORT_QUIZ_PASSED_MESSAGE, type QuizAttemptResponse } from "@/lib/quiz-api";

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="app-layout">{children}</div>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button type="button" aria-label="Toggle sidebar" />,
}));

const mockGetQuizAttempt = vi.fn();
vi.mock("@/lib/quiz-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/quiz-api")>("@/lib/quiz-api");
  return {
    ...actual,
    getQuizAttempt: (...args: unknown[]) => mockGetQuizAttempt(...args),
  };
});

function buildAttemptResponse(overrides: Partial<QuizAttemptResponse> = {}): QuizAttemptResponse {
  return {
    quiz_id: 10,
    submission_id: 20,
    classwork_assignment_id: 42,
    classwork_id: 30,
    title: "Curated Study Support Quiz",
    instructions: "Answer all questions.",
    total_points: 20,
    duration_minutes: 30,
    max_attempts: 3,
    attempt_count: 2,
    attempts_used: 2,
    attempts_remaining: 0,
    status: "graded",
    started_at: "2026-11-20T08:00:00Z",
    server_time: "2026-11-20T08:30:00Z",
    submitted_at: "2026-11-20T08:25:00Z",
    grade: 14,
    can_submit: false,
    is_intervention_quiz: true,
    is_passed: true,
    needs_teacher_review: false,
    passing_threshold: 65,
    show_scores: true,
    summary_available: true,
    summary_release_mode: "IMMEDIATE",
    summary_release_at: null,
    summary_message: null,
    feedback: null,
    questions: [
      {
        quiz_question_id: 1,
        question_text: "Sample question",
        question_type: "MULTIPLE_CHOICE",
        points: 20,
        display_order: 1,
        options: [
          { option_id: 1, option_text: "A", option_order: 1, is_correct: true },
          { option_id: 2, option_text: "B", option_order: 2, is_correct: false },
        ],
        selected_option_id: 1,
        answer_text: "A",
        is_correct: true,
        points_awarded: 14,
      },
    ],
    ...overrides,
  };
}

function renderResultPage() {
  return render(
    <MemoryRouter initialEntries={["/student/quizzes/42/result"]}>
      <Routes>
        <Route path="/student/quizzes/:assignmentId/result" element={<StudentQuizResult />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("StudentQuizResult curated remediation passing threshold", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("displays configured 65% passing score and Passed status when student scores 70% on attempt 2 of 3", async () => {
    mockGetQuizAttempt.mockResolvedValue(
      buildAttemptResponse({
        grade: 14,
        total_points: 20,
        passing_threshold: 65,
        is_passed: true,
        attempt_count: 2,
        attempts_used: 2,
        attempts_remaining: 0,
        can_submit: false,
      }),
    );

    renderResultPage();

    await waitFor(() => {
      expect(screen.getByText("Passing score: 65%")).toBeTruthy();
    });

    expect(screen.getByLabelText("Final score 70%")).toBeTruthy();
    expect(screen.getByText("Study Support Assessment Passed")).toBeTruthy();
    expect(screen.getByText("Completed in 2 attempts")).toBeTruthy();
    expect(screen.getByText(STUDY_SUPPORT_QUIZ_PASSED_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Retake Quiz/i })).toBeNull();
    expect(screen.queryByText("Passing score not reached yet")).toBeNull();
  });

  it("displays configured 85% passing score and Retake Quiz when student scores 70%", async () => {
    mockGetQuizAttempt.mockResolvedValue(
      buildAttemptResponse({
        grade: 14,
        total_points: 20,
        passing_threshold: 85,
        is_passed: false,
        attempt_count: 2,
        attempts_used: 2,
        attempts_remaining: 1,
        can_submit: true,
      }),
    );

    renderResultPage();

    await waitFor(() => {
      expect(screen.getByText("Passing score: 85%")).toBeTruthy();
    });

    expect(screen.getByLabelText("Final score 70%")).toBeTruthy();
    expect(screen.getByText("Attempt 2 of 3")).toBeTruthy();
    expect(screen.getByText("Passing score not reached yet")).toBeTruthy();
    expect(screen.getByText(/You need at least 85% to pass this Study Support assessment/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Retake Quiz/i })).toBeTruthy();
  });

  it("does not display score or passing threshold when teacher hides scores", async () => {
    mockGetQuizAttempt.mockResolvedValue(
      buildAttemptResponse({
        grade: null,
        passing_threshold: null,
        show_scores: false,
        is_passed: true,
        can_submit: false,
      }),
    );

    renderResultPage();

    await waitFor(() => {
      expect(screen.getByText("Assessment Completed")).toBeTruthy();
    });

    expect(screen.queryByText(/Passing score:/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Retake Quiz/i })).toBeNull();
  });
});
