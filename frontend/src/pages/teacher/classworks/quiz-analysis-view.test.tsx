// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import QuizAnalysisView from "./quiz-analysis-view";
import type { QuizAnalysis } from "./quiz-builder-types";
import type { TeacherClasswork } from "@/types/classwork";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  class MockIntersectionObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  window.IntersectionObserver = MockIntersectionObserver as any;
});


afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});


describe("QuizAnalysisView - Question options wrapping and layout", () => {
  const mockClasswork: TeacherClasswork = {
    classwork_id: 10,
    title: "Cybersecurity Exam Analysis",
    classwork_type: "quiz",
    status: "published",
    total_points: 100,
    created_at: new Date().toISOString(),
  } as unknown as TeacherClasswork;

  const longAnswerQ51 =
    "Weigh mission impact of isolation vs. continued compromise, and inform command authority before the mission-impacting decision. This ensures operational goals are balanced against immediate containment needs.";
  const shortAnswerA = "Isolate immediately without warning";
  const shortAnswerC = "Only the IT helpdesk needs to know";
  const shortAnswerD = "Wait indefinitely until the attacker leaves voluntarily";

  const mockAnalysis: QuizAnalysis = {
    quiz_id: 2,
    classwork_id: 10,
    title: "Cybersecurity Exam Analysis",
    total_points: 100,
    total_students: 25,
    submitted_count: 24,
    missing_count: 1,
    graded_count: 24,
    needs_grading_count: 0,
    class_accuracy_percent: 88,
    questions: [
      {
        quiz_question_id: 51,
        question_text:
          "Scenario: Isolating a compromised server would stop an attack, but take down an ongoing military air tasking operation. What should the cyber defense team do first?",
        question_type: "MULTIPLE_CHOICE",
        points: 2,
        answered_count: 24,
        correct_count: 20,
        accuracy_percent: 83.33,
        needs_grading_count: 0,
        option_distribution: [
          {
            option_id: 511,
            option_text: shortAnswerA,
            is_correct: false,
            selected_count: 2,
          },
          {
            option_id: 512,
            option_text: longAnswerQ51,
            is_correct: true,
            selected_count: 20,
          },
          {
            option_id: 513,
            option_text: shortAnswerC,
            is_correct: false,
            selected_count: 1,
          },
          {
            option_id: 514,
            option_text: shortAnswerD,
            is_correct: false,
            selected_count: 1,
          },
        ],
      },
    ],
    students: [],
  };

  it("renders 2+ sentence options in full and applies wrapping classes", () => {
    render(
      <QuizAnalysisView
        quizAnalysis={mockAnalysis}
        isQuizAnalysisLoading={false}
        quizAnalysisError=""
        selected={mockClasswork}
        setSelectedGradingSubmissionId={vi.fn()}
      />
    );

    // Switch to Questions tab
    const questionsTab = screen.getByRole("tab", { name: /questions/i });
    fireEvent.click(questionsTab);

    // Verify full multi-sentence option text is rendered
    const longTextElement = screen.getByText(longAnswerQ51);
    expect(longTextElement).toBeTruthy();
    expect(longTextElement.className).toContain("whitespace-normal");
    expect(longTextElement.className).toContain("break-words");
    expect(longTextElement.className).toContain("[overflow-wrap:anywhere]");
    expect(longTextElement.className).toContain("flex-1");
    expect(longTextElement.className).toContain("min-w-0");

    // Verify option container is full width, not constrained to max-w-2xl
    const optionsContainer = longTextElement.closest(".space-y-3");
    expect(optionsContainer).toBeTruthy();
    expect(optionsContainer?.className).toContain("w-full");
    expect(optionsContainer?.className).not.toContain("max-w-2xl");

    // Verify answered count displays correctly
    expect(screen.getByText("20 answered")).toBeTruthy();
    expect(screen.getByText("2 answered")).toBeTruthy();

    // Verify right-aligned stats group maintains shrink-0 and fixed width
    const answeredBar = screen.getByText("20 answered").closest(".border-black");
    expect(answeredBar).not.toBeNull();
    expect(answeredBar?.className).toContain("shrink-0");
  });
});

