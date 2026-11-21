// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuizResult from "./quiz-result";
import { STUDY_SUPPORT_QUIZ_PASSED_MESSAGE } from "@/lib/quiz-api";

const getQuizAttemptMock = vi.fn();

vi.mock("@/lib/quiz-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/quiz-api")>();
  return {
    ...actual,
    getQuizAttempt: (...args: unknown[]) => getQuizAttemptMock(...args),
  };
});

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button type="button" aria-label="Toggle sidebar" />,
}));

function renderQuizResult(submittedAttempt?: Record<string, unknown>) {
  return render(
    <MemoryRouter initialEntries={[{
      pathname: "/student/quiz/42/result",
      state: submittedAttempt ? { submittedAttempt } : undefined,
    }]}>
      <Routes>
        <Route path="/student/quiz/:assignmentId/result" element={<QuizResult />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("QuizResult Study Support stop-after-pass behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows Passed status, score, passing threshold, completion message, and hides Retake Quiz after passing", async () => {
    getQuizAttemptMock.mockResolvedValue({
      quiz_id: 9,
      classwork_assignment_id: 42,
      classwork_id: 100,
      title: "Geometry Support Quiz",
      total_points: 20,
      duration_minutes: 30,
      max_attempts: 3,
      attempt_count: 2,
      attempts_used: 2,
      attempts_remaining: 0,
      status: "graded",
      grade: 17,
      can_submit: false,
      is_intervention_quiz: true,
      is_passed: true,
      passing_threshold: 80,
      show_scores: true,
      summary_available: true,
      summary_release_mode: "IMMEDIATE",
      questions: [],
    });

    renderQuizResult();

    expect(await screen.findByText(STUDY_SUPPORT_QUIZ_PASSED_MESSAGE)).toBeTruthy();
    expect(screen.getAllByText("Passed").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/17 \/ 20 Total Points/)).toBeTruthy();
    expect(screen.getByText("Passing score: 80%")).toBeTruthy();
    expect(screen.getByText("Completed in 2 attempts")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Retake Quiz/i })).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/\bintervention\b/i);
  });

  it("respects hidden scores while still showing Passed completion state and hiding Retake Quiz", async () => {
    getQuizAttemptMock.mockResolvedValue({
      quiz_id: 9,
      classwork_assignment_id: 42,
      classwork_id: 100,
      title: "Geometry Support Quiz",
      total_points: 20,
      duration_minutes: 30,
      max_attempts: 3,
      attempt_count: 1,
      attempts_used: 1,
      attempts_remaining: 0,
      status: "graded",
      grade: null,
      can_submit: false,
      is_intervention_quiz: true,
      is_passed: true,
      passing_threshold: null,
      show_scores: false,
      summary_available: false,
      summary_release_mode: "NEVER",
      questions: [],
    });

    renderQuizResult();

    expect(await screen.findByText(STUDY_SUPPORT_QUIZ_PASSED_MESSAGE)).toBeTruthy();
    expect(screen.getByText("Assessment Completed")).toBeTruthy();
    expect(screen.getByText(/Your teacher has hidden quiz scores/i)).toBeTruthy();
    expect(screen.queryByText(/Passing score:/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Retake Quiz/i })).toBeNull();
  });

  it("keeps Retake Quiz available when a Study Support quiz attempt failed with remaining attempts", async () => {
    getQuizAttemptMock.mockResolvedValue({
      quiz_id: 9,
      classwork_assignment_id: 42,
      classwork_id: 100,
      title: "Geometry Support Quiz",
      total_points: 20,
      duration_minutes: 30,
      max_attempts: 3,
      attempt_count: 1,
      attempts_used: 1,
      attempts_remaining: 2,
      status: "graded",
      grade: 15,
      can_submit: true,
      is_intervention_quiz: true,
      is_passed: false,
      passing_threshold: 80,
      show_scores: true,
      summary_available: false,
      summary_release_mode: "IMMEDIATE",
      questions: [],
    });

    renderQuizResult();

    expect(await screen.findByRole("button", { name: /Retake Quiz/i })).toBeTruthy();
    expect(screen.getByText("Attempt 1 of 3")).toBeTruthy();
    expect(screen.getByText("Passing score not reached yet")).toBeTruthy();
    expect(screen.getByText(/You need at least 80% to pass this Study Support assessment/i)).toBeTruthy();
    expect(screen.getByText(/2 attempts remaining/i)).toBeTruthy();
    expect(screen.queryByText(STUDY_SUPPORT_QUIZ_PASSED_MESSAGE)).toBeNull();
  });

  it("shows the graded score instead of Grading in Progress when per-item evaluation is withheld before a retake", async () => {
    getQuizAttemptMock.mockResolvedValue({
      quiz_id: 9,
      classwork_assignment_id: 42,
      classwork_id: 100,
      title: "Geometry Support Quiz",
      total_points: 10,
      duration_minutes: 30,
      max_attempts: 3,
      attempt_count: 1,
      attempts_used: 1,
      attempts_remaining: 2,
      status: "graded",
      grade: 5,
      can_submit: true,
      is_intervention_quiz: true,
      is_passed: false,
      passing_threshold: 80,
      show_scores: true,
      summary_available: true,
      summary_release_mode: "IMMEDIATE",
      questions: [
        {
          quiz_question_id: 1,
          question_text: "Which geometric figure represents an exact location with no size?",
          question_type: "MULTIPLE_CHOICE",
          points: 1,
          display_order: 1,
          options: [
            { option_id: 11, option_text: "Point", option_order: 1, is_correct: null },
            { option_id: 12, option_text: "Line", option_order: 2, is_correct: null },
          ],
          selected_option_id: 12,
          answer_text: "Line",
          points_awarded: null,
          is_correct: null,
          explanation: null,
        },
      ],
    });

    renderQuizResult();

    expect(await screen.findByText(/5 \/ 10 Total Points/)).toBeTruthy();
    expect(screen.getByText("Passing score: 80%")).toBeTruthy();
    expect(screen.getByText("Answer Recorded (1 pts)")).toBeTruthy();
    expect(screen.queryByText("Grading in Progress")).toBeNull();
    expect(screen.queryByText(/Pending Teacher Review/i)).toBeNull();
  });

  it("hides all grading outcomes and answer breakdowns when quiz results are disabled", async () => {
    getQuizAttemptMock.mockResolvedValue({
      quiz_id: 9,
      classwork_assignment_id: 42,
      classwork_id: 100,
      title: "Hidden Results Quiz",
      total_points: 1,
      max_attempts: 1,
      attempt_count: 1,
      attempts_used: 1,
      attempts_remaining: 0,
      status: "graded",
      grade: null,
      can_submit: false,
      show_scores: false,
      summary_available: true,
      summary_release_mode: "IMMEDIATE",
      questions: [
        {
          quiz_question_id: 1,
          question_text: "Which option is correct?",
          question_type: "MULTIPLE_CHOICE",
          points: 1,
          display_order: 1,
          options: [
            { option_id: 11, option_text: "Secret answer", option_order: 1, is_correct: true },
            { option_id: 12, option_text: "Student choice", option_order: 2, is_correct: false },
          ],
          selected_option_id: 12,
          answer_text: "Student choice",
          points_awarded: 0,
          is_correct: false,
          explanation: "Private answer explanation",
        },
      ],
    });

    renderQuizResult({
      classwork_assignment_id: 42,
      show_scores: true,
      grade: 1,
      questions: [{ is_correct: true, points_awarded: 1 }],
    });

    expect(await screen.findByText("Score Hidden")).toBeTruthy();
    expect(getQuizAttemptMock).toHaveBeenCalledWith(42);
    expect(screen.getByText("Submission recorded")).toBeTruthy();
    expect(screen.queryByText(/Show incorrect only/i)).toBeNull();
    expect(screen.queryByText("Question Breakdown")).toBeNull();
    expect(screen.queryByText("Secret answer")).toBeNull();
    expect(screen.queryByText("Student choice")).toBeNull();
    expect(screen.queryByText("Private answer explanation")).toBeNull();
    expect(document.body.textContent).not.toContain("0 / 1 pts");
  });
});
