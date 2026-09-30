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

describe("QuizAnalysisView - Students tab layout and sticky columns", () => {
  const mockClasswork: TeacherClasswork = {
    classwork_id: 10,
    title: "Exam Analysis",
    classwork_type: "quiz",
    status: "published",
    total_points: 60,
    created_at: new Date().toISOString(),
  } as unknown as TeacherClasswork;

  const createMockQuizAnalysis = (questionCount: number): QuizAnalysis => {
    const questions = Array.from({ length: questionCount }, (_, i) => ({
      quiz_question_id: i + 1,
      question_text: `Question ${i + 1}`,
      question_type: "MULTIPLE_CHOICE",
      points: 1,
      answered_count: 1,
      correct_count: 1,
      accuracy_percent: 100,
      needs_grading_count: 0,
      option_distribution: [],
    }));

    const answers = Array.from({ length: questionCount }, (_, i) => ({
      quiz_question_id: i + 1,
      is_correct: i % 2 === 0,
      points_awarded: i % 2 === 0 ? 1 : 0,
    }));

    return {
      quiz_id: 1,
      classwork_id: 10,
      title: "Exam Analysis",
      total_points: questionCount,
      total_students: 1,
      submitted_count: 1,
      missing_count: 0,
      graded_count: 1,
      needs_grading_count: 0,
      class_accuracy_percent: 50,
      questions,
      students: [
        {
          student_id: "student-1",
          student_name: "John Doe",
          submission_id: 101,
          status: "submitted",
          attempt_count: 1,
          grade: Math.floor(questionCount / 2),
          score_percent: 50,
          submitted_at: new Date().toISOString(),
          needs_grading: false,
          answers,
        },
      ],
    };
  };

  it("renders 60-question quiz with scrollable dot strip, visual boundary, and sticky summary columns", () => {
    const analysis60 = createMockQuizAnalysis(60);
    render(
      <QuizAnalysisView
        quizAnalysis={analysis60}
        isQuizAnalysisLoading={false}
        quizAnalysisError=""
        selected={mockClasswork}
        setSelectedGradingSubmissionId={vi.fn()}
      />
    );

    // Switch to Students tab
    const studentsTab = screen.getByRole("tab", { name: /students/i });
    fireEvent.click(studentsTab);

    // Verify all 60 question dots exist inside the dot strip container
    const dotStripContainer = screen.getByTestId("dot-strip-scroll-container");
    expect(dotStripContainer).toBeTruthy();
    expect(dotStripContainer.className).toContain("overflow-x-auto");

    for (let i = 1; i <= 60; i++) {
      expect(screen.getByTestId(`question-dot-${i}`)).toBeTruthy();
    }

    // Verify the inner dot strip wrapper has end padding to prevent clipping when scrolled right
    const dotStripInner = dotStripContainer.firstElementChild as HTMLElement;
    expect(dotStripInner).toBeTruthy();
    expect(dotStripInner.className).toContain("pr-3");
    expect(dotStripInner.className).toContain("w-max");

    // Verify correct count summary label is rendered next to the strip
    expect(screen.getByText(/30 corrects/i)).toBeTruthy();

    // Verify sticky headers and their right-aligned offsets
    const accuracyHead = screen.getByRole("columnheader", { name: "Accuracy" });
    const pointsHead = screen.getByRole("columnheader", { name: "Points" });
    const scoreHead = screen.getByRole("columnheader", { name: "Score" });
    const actionHead = screen.getByRole("columnheader", { name: "Action" });

    expect(accuracyHead.className).toContain("sticky");
    expect(accuracyHead.className).toContain("right-[280px]");
    expect(pointsHead.className).toContain("sticky");
    expect(pointsHead.className).toContain("right-[190px]");
    expect(scoreHead.className).toContain("sticky");
    expect(scoreHead.className).toContain("right-[110px]");
    expect(actionHead.className).toContain("sticky");
    expect(actionHead.className).toContain("right-0");

    // Verify visual boundary on the leftmost sticky column (Accuracy)
    expect(accuracyHead.className).toContain("border-l-2");
    expect(accuracyHead.className).toContain("shadow-[-6px_0_10px_-2px_rgba(0,0,0,0.2)]");

    // Verify sticky body cells and visual boundary
    const accuracyCell = screen.getByRole("cell", { name: "50%" });
    const pointsCell = screen.getByRole("cell", { name: "30/60" });
    const scoreCell = screen.getByRole("cell", { name: "30" });
    const actionCell = screen.getByRole("button", { name: /score/i }).closest("td");

    expect(accuracyCell.className).toContain("sticky");
    expect(accuracyCell.className).toContain("right-[280px]");
    expect(accuracyCell.className).toContain("border-l-2");
    expect(accuracyCell.className).toContain("shadow-[-6px_0_10px_-2px_rgba(0,0,0,0.12)]");

    expect(pointsCell.className).toContain("sticky");
    expect(pointsCell.className).toContain("right-[190px]");

    expect(scoreCell.className).toContain("sticky");
    expect(scoreCell.className).toContain("right-[110px]");

    expect(actionCell?.className).toContain("sticky");
    expect(actionCell?.className).toContain("right-0");

    // Scroll the dot strip container to simulate horizontal scrolling
    fireEvent.scroll(dotStripContainer, { target: { scrollLeft: 500 } });

    // Confirm Accuracy, Points, Score, Action remain fully accessible in the viewport
    expect(screen.getByRole("columnheader", { name: "Accuracy" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Points" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Score" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Action" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "50%" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "30/60" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "30" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /score/i })).toBeTruthy();
  });

  it("renders 5-question quiz without empty or broken layout when no scroll is needed", () => {
    const analysis5 = createMockQuizAnalysis(5);
    render(
      <QuizAnalysisView
        quizAnalysis={analysis5}
        isQuizAnalysisLoading={false}
        quizAnalysisError=""
        selected={mockClasswork}
        setSelectedGradingSubmissionId={vi.fn()}
      />
    );

    // Switch to Students tab
    const studentsTab = screen.getByRole("tab", { name: /students/i });
    fireEvent.click(studentsTab);

    // Verify 5 question dots are rendered
    const dotStripContainer = screen.getByTestId("dot-strip-scroll-container");
    expect(dotStripContainer).toBeTruthy();

    for (let i = 1; i <= 5; i++) {
      expect(screen.getByTestId(`question-dot-${i}`)).toBeTruthy();
    }
    expect(screen.queryByTestId("question-dot-6")).toBeNull();

    // Verify summary columns are present and properly positioned
    expect(screen.getByRole("columnheader", { name: "Accuracy" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Points" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Score" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Action" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "50%" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "2/5" })).toBeTruthy();
  });
});

