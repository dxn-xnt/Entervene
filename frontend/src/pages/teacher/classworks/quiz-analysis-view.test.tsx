// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import QuizAnalysisView, {
  ACCURACY_THRESHOLD_HIGH,
  ACCURACY_THRESHOLD_MEDIUM,
  getAccuracyColorClass,
} from "./quiz-analysis-view";
import type { QuizAnalysis } from "./quiz-builder-types";
import type { TeacherClasswork } from "@/types/classwork";

async function expectNavigatorTooltip(button: HTMLElement, text: string) {
  act(() => button.focus());
  // The custom Base UI popup has a data slot, not a native title or tooltip role.
  await waitFor(() => expect(document.querySelector(
    '[data-slot="tooltip-content"][data-open]',
  )?.textContent).toBe(text));
  act(() => button.blur());
  await waitFor(() => expect(document.querySelector(
    '[data-slot="tooltip-content"][data-open]',
  )).toBeNull());
}

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
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
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

describe("QuizAnalysisView - Questions tab numbered navigator", () => {
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
      question_text: `Question ${i + 1} content text`,
      question_type: "MULTIPLE_CHOICE",
      points: 1,
      answered_count: 20,
      correct_count: 15,
      accuracy_percent: 75,
      needs_grading_count: 0,
      option_distribution: [
        { option_id: (i + 1) * 10 + 1, option_text: "Option A", is_correct: true, selected_count: 15 },
        { option_id: (i + 1) * 10 + 2, option_text: "Option B", is_correct: false, selected_count: 5 },
      ],
    }));

    return {
      quiz_id: 1,
      classwork_id: 10,
      title: "Exam Analysis",
      total_points: questionCount,
      total_students: 20,
      submitted_count: 20,
      missing_count: 0,
      graded_count: 20,
      needs_grading_count: 0,
      class_accuracy_percent: 75,
      questions,
      students: [],
    };
  };

  it("renders 60-question quiz with sticky numbered navigator and scrolls to clicked question", () => {
    const scrollSpy = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollSpy;

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

    // Switch to Questions tab
    const questionsTab = screen.getByRole("tab", { name: /questions/i });
    fireEvent.click(questionsTab);

    // Verify Navigator header title with question count
    expect(screen.getByText("Question Navigator (60 Questions)")).toBeTruthy();

    // Verify grid container has max-height and overflow-y-auto
    const grid = screen.getByTestId("question-navigator-grid");
    expect(grid).toBeTruthy();
    expect(grid.className).toContain("overflow-y-auto");

    // Verify sticky positioning on outer wrapper with offset to clear sticky header
    const stickyWrapper = grid.closest(".sticky");
    expect(stickyWrapper).not.toBeNull();
    expect(stickyWrapper?.className).toContain("top-[58px]");
    expect(stickyWrapper?.className).toContain("z-20");

    // Verify all 60 buttons are rendered
    for (let i = 1; i <= 60; i++) {
      const btn = screen.getByTestId(`navigator-btn-${i}`);
      expect(btn).toBeTruthy();
      expect(btn.textContent).toBe(String(i));
    }

    // Verify target question card has correct ID and scroll margin to clear sticky navigator
    const targetCard = document.getElementById("quiz-question-card-42");
    expect(targetCard).not.toBeNull();
    expect(targetCard?.className).toContain("scroll-mt-[260px]");

    // Click question 42 button
    const btn42 = screen.getByTestId("navigator-btn-42");
    fireEvent.click(btn42);

    // Verify smooth scrolling was called with { behavior: "smooth", block: "start" }
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("renders 5-question quiz with numbered navigator without overflow or broken layout", () => {
    const scrollSpy = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollSpy;

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

    // Switch to Questions tab
    const questionsTab = screen.getByRole("tab", { name: /questions/i });
    fireEvent.click(questionsTab);

    // Verify Navigator header
    expect(screen.getByText("Question Navigator (5 Questions)")).toBeTruthy();

    // Verify exactly 5 buttons exist
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByTestId(`navigator-btn-${i}`)).toBeTruthy();
    }
    expect(screen.queryByTestId("navigator-btn-6")).toBeNull();

    // Click question 3
    const btn3 = screen.getByTestId("navigator-btn-3");
    fireEvent.click(btn3);

    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("applies accuracy-tiered colors, legend, and shows accuracy percentage in tooltips", async () => {
    const tieredAnalysis: QuizAnalysis = {
      quiz_id: 1,
      classwork_id: 10,
      title: "Tiered Exam Analysis",
      total_points: 4,
      total_students: 20,
      submitted_count: 20,
      missing_count: 0,
      graded_count: 20,
      needs_grading_count: 0,
      class_accuracy_percent: 60,
      questions: [
        {
          quiz_question_id: 101,
          question_text: "High accuracy question",
          question_type: "MULTIPLE_CHOICE",
          points: 1,
          answered_count: 20,
          correct_count: 18,
          accuracy_percent: 90, // >= 80% -> High (green)
          needs_grading_count: 0,
          option_distribution: [],
        },
        {
          quiz_question_id: 102,
          question_text: "Medium accuracy question",
          question_type: "MULTIPLE_CHOICE",
          points: 1,
          answered_count: 20,
          correct_count: 12,
          accuracy_percent: 60, // 50-79% -> Medium (yellow)
          needs_grading_count: 0,
          option_distribution: [],
        },
        {
          quiz_question_id: 103,
          question_text: "Low accuracy question",
          question_type: "MULTIPLE_CHOICE",
          points: 1,
          answered_count: 20,
          correct_count: 6,
          accuracy_percent: 30, // < 50% -> Low (red)
          needs_grading_count: 0,
          option_distribution: [],
        },
        {
          quiz_question_id: 104,
          question_text: "Unattempted question",
          question_type: "MULTIPLE_CHOICE",
          points: 1,
          answered_count: 0,
          correct_count: 0,
          accuracy_percent: null, // No attempts -> Neutral (gray)
          needs_grading_count: 0,
          option_distribution: [],
        },
      ],
      students: [],
    };

    render(
      <QuizAnalysisView
        quizAnalysis={tieredAnalysis}
        isQuizAnalysisLoading={false}
        quizAnalysisError=""
        selected={mockClasswork}
        setSelectedGradingSubmissionId={vi.fn()}
      />
    );

    // Switch to Questions tab
    const questionsTab = screen.getByRole("tab", { name: /questions/i });
    fireEvent.click(questionsTab);

    // Verify legend indicators
    expect(screen.getByText(new RegExp(`≥${ACCURACY_THRESHOLD_HIGH}%`))).toBeTruthy();
    expect(screen.getByText(new RegExp(`${ACCURACY_THRESHOLD_MEDIUM}-${ACCURACY_THRESHOLD_HIGH - 1}%`))).toBeTruthy();
    expect(screen.getByText(new RegExp(`<${ACCURACY_THRESHOLD_MEDIUM}%`))).toBeTruthy();

    // Verify button 1 (High accuracy >= 80%)
    const btn1 = screen.getByTestId("navigator-btn-1");
    expect(btn1.className).toContain("bg-[#8BCB88]");
    await expectNavigatorTooltip(btn1, "Question 1: 90% accuracy");
    expect(btn1.getAttribute("aria-label")).toBe("Jump to question 1 (90% Accuracy)");

    // Verify button 2 (Medium accuracy 50-79%)
    const btn2 = screen.getByTestId("navigator-btn-2");
    expect(btn2.className).toContain("bg-[#FFD08A]");
    await expectNavigatorTooltip(btn2, "Question 2: 60% accuracy");
    expect(btn2.getAttribute("aria-label")).toBe("Jump to question 2 (60% Accuracy)");

    // Verify button 3 (Low accuracy < 50%)
    const btn3 = screen.getByTestId("navigator-btn-3");
    expect(btn3.className).toContain("bg-[#FF6B6B]");
    await expectNavigatorTooltip(btn3, "Question 3: 30% accuracy");
    expect(btn3.getAttribute("aria-label")).toBe("Jump to question 3 (30% Accuracy)");

    // Verify button 4 (Unattempted)
    const btn4 = screen.getByTestId("navigator-btn-4");
    expect(btn4.className).toContain("bg-gray-100");
    await expectNavigatorTooltip(btn4, "Question 4: no attempts");

    // Test getAccuracyColorClass helper directly with boundary cases
    expect(getAccuracyColorClass(80)).toBe("bg-[#8BCB88] text-black");
    expect(getAccuracyColorClass(79.9)).toBe("bg-[#FFD08A] text-black");
    expect(getAccuracyColorClass(50)).toBe("bg-[#FFD08A] text-black");
    expect(getAccuracyColorClass(49.9)).toBe("bg-[#FF6B6B] text-black");
    expect(getAccuracyColorClass(0)).toBe("bg-[#FF6B6B] text-black");
    expect(getAccuracyColorClass(null)).toBe("bg-gray-100 text-black");
    expect(getAccuracyColorClass(90, 0)).toBe("bg-gray-100 text-black");
  });
});

describe("QuizAnalysisView - Questions tab high-wrong-answer flags", () => {
  const mockClasswork: TeacherClasswork = {
    classwork_id: 10,
    title: "Flagging Test Quiz",
    classwork_type: "quiz",
    status: "published",
    total_points: 3,
    created_at: new Date().toISOString(),
  } as unknown as TeacherClasswork;

  it("correctly displays high-wrong flag for low accuracy with attempts, and omits it for 0 attempts and high accuracy", () => {
    const analysisWithCases: QuizAnalysis = {
      quiz_id: 1,
      classwork_id: 10,
      title: "Flagging Test Quiz",
      total_points: 3,
      total_students: 20,
      submitted_count: 20,
      missing_count: 0,
      graded_count: 20,
      needs_grading_count: 0,
      class_accuracy_percent: 50,
      questions: [
        {
          quiz_question_id: 201,
          question_text: "Question below threshold with attempts (should flag)",
          question_type: "MULTIPLE_CHOICE",
          points: 1,
          answered_count: 20,
          correct_count: 6,
          accuracy_percent: 30, // < ACCURACY_THRESHOLD_MEDIUM (50%) with answered_count > 0 -> should flag
          needs_grading_count: 0,
          option_distribution: [],
        },
        {
          quiz_question_id: 202,
          question_text: "Question below threshold with 0 attempts (should NOT flag)",
          question_type: "MULTIPLE_CHOICE",
          points: 1,
          answered_count: 0,
          correct_count: 0,
          accuracy_percent: 0, // < 50% but answered_count == 0 -> should NOT flag
          needs_grading_count: 0,
          option_distribution: [],
        },
        {
          quiz_question_id: 203,
          question_text: "Question above threshold (should NOT flag)",
          question_type: "MULTIPLE_CHOICE",
          points: 1,
          answered_count: 20,
          correct_count: 18,
          accuracy_percent: 90, // >= 50% -> should NOT flag
          needs_grading_count: 0,
          option_distribution: [],
        },
      ],
      students: [],
    };

    render(
      <QuizAnalysisView
        quizAnalysis={analysisWithCases}
        isQuizAnalysisLoading={false}
        quizAnalysisError=""
        selected={mockClasswork}
        setSelectedGradingSubmissionId={vi.fn()}
      />
    );

    // Switch to Questions tab
    const questionsTab = screen.getByRole("tab", { name: /questions/i });
    fireEvent.click(questionsTab);

    // Case 1: Question below threshold with attempts (should flag)
    const flag201 = screen.getByTestId("high-wrong-flag-201");
    expect(flag201).toBeTruthy();
    expect(flag201.className).toContain("bg-[#FF6B6B]");
    expect(flag201.textContent).toContain("70% of students got this wrong");

    // Case 2: Question below threshold with 0 attempts (should NOT flag)
    expect(screen.queryByTestId("high-wrong-flag-202")).toBeNull();
    expect(screen.queryByText("100% of students got this wrong")).toBeNull();

    // Case 3: Question above threshold (should NOT flag)
    expect(screen.queryByTestId("high-wrong-flag-203")).toBeNull();
    expect(screen.queryByText("10% of students got this wrong")).toBeNull();
  });

  it("correctly renders navigator colors, high-wrong flags, and answer displays for mixed question types across all positions", async () => {
    const mixedAnalysis: QuizAnalysis = {
      quiz_id: 1,
      classwork_id: 10,
      title: "Mixed Question Types Quiz",
      total_points: 15,
      total_students: 20,
      submitted_count: 20,
      missing_count: 0,
      graded_count: 20,
      needs_grading_count: 0,
      class_accuracy_percent: 65,
      questions: [
        // Q1: Short Answer in first 10 with low accuracy (<50%) -> should flag and be RED
        {
          quiz_question_id: 301,
          question_text: "What process converts light energy into chemical energy?",
          question_type: "SHORT_ANSWER",
          points: 1,
          answered_count: 20,
          correct_count: 5,
          accuracy_percent: 25,
          needs_grading_count: 0,
          option_distribution: [
            { option_id: 3011, option_text: "Photosynthesis", is_correct: true, selected_count: 5 },
          ],
        },
        // Q2: Short Answer in first 10 with high accuracy (>=80%) -> no flag and GREEN
        {
          quiz_question_id: 302,
          question_text: "What organelle is the powerhouse of the cell?",
          question_type: "SHORT_ANSWER",
          points: 1,
          answered_count: 20,
          correct_count: 18,
          accuracy_percent: 90,
          needs_grading_count: 0,
          option_distribution: [
            { option_id: 3021, option_text: "Mitochondria", is_correct: true, selected_count: 18 },
          ],
        },
        // Q3-Q10: Filler MC questions
        ...Array.from({ length: 8 }, (_, i) => ({
          quiz_question_id: 303 + i,
          question_text: `Multiple choice question ${3 + i}`,
          question_type: "MULTIPLE_CHOICE",
          points: 1,
          answered_count: 20,
          correct_count: 16,
          accuracy_percent: 80,
          needs_grading_count: 0,
          option_distribution: [
            { option_id: (303 + i) * 10 + 1, option_text: "Option A", is_correct: true, selected_count: 16 },
            { option_id: (303 + i) * 10 + 2, option_text: "Option B", is_correct: false, selected_count: 4 },
          ],
        })),
        // Q11: Multiple Choice after position 10 with low accuracy (<50%) -> should flag and be RED
        {
          quiz_question_id: 311,
          question_text: "Which of the following elements has the atomic number 1?",
          question_type: "MULTIPLE_CHOICE",
          points: 1,
          answered_count: 20,
          correct_count: 6,
          accuracy_percent: 30,
          needs_grading_count: 0,
          option_distribution: [
            { option_id: 3111, option_text: "Hydrogen", is_correct: true, selected_count: 6 },
            { option_id: 3112, option_text: "Helium", is_correct: false, selected_count: 14 },
          ],
        },
        // Q12: Multiple Choice after position 10 with high accuracy (>=80%) -> no flag and GREEN
        {
          quiz_question_id: 312,
          question_text: "What is H2O commonly known as?",
          question_type: "MULTIPLE_CHOICE",
          points: 1,
          answered_count: 20,
          correct_count: 19,
          accuracy_percent: 95,
          needs_grading_count: 0,
          option_distribution: [
            { option_id: 3121, option_text: "Water", is_correct: true, selected_count: 19 },
            { option_id: 3122, option_text: "Hydrogen Peroxide", is_correct: false, selected_count: 1 },
          ],
        },
      ],
      students: [],
    };

    render(
      <QuizAnalysisView
        quizAnalysis={mixedAnalysis}
        isQuizAnalysisLoading={false}
        quizAnalysisError=""
        selected={mockClasswork}
        setSelectedGradingSubmissionId={vi.fn()}
      />
    );

    // Switch to Questions tab
    const questionsTab = screen.getByRole("tab", { name: /questions/i });
    fireEvent.click(questionsTab);

    // 1. Verify Navigator color-coding for mixed types across positions
    // Q1 (Short Answer, 25%) -> RED
    const btn1 = screen.getByTestId("navigator-btn-1");
    expect(btn1.className).toContain("bg-[#FF6B6B]");
    await expectNavigatorTooltip(btn1, "Question 1: 25% accuracy");

    // Q2 (Short Answer, 90%) -> GREEN
    const btn2 = screen.getByTestId("navigator-btn-2");
    expect(btn2.className).toContain("bg-[#8BCB88]");
    await expectNavigatorTooltip(btn2, "Question 2: 90% accuracy");

    // Q11 (Multiple Choice after 10, 30%) -> RED
    const btn11 = screen.getByTestId("navigator-btn-11");
    expect(btn11.className).toContain("bg-[#FF6B6B]");
    await expectNavigatorTooltip(btn11, "Question 11: 30% accuracy");

    // Q12 (Multiple Choice after 10, 95%) -> GREEN
    const btn12 = screen.getByTestId("navigator-btn-12");
    expect(btn12.className).toContain("bg-[#8BCB88]");
    await expectNavigatorTooltip(btn12, "Question 12: 95% accuracy");

    // 2. Verify High-Wrong Flags
    // Q1 (Short Answer, 25%) -> flagged with 75%
    const flag301 = screen.getByTestId("high-wrong-flag-301");
    expect(flag301).toBeTruthy();
    expect(flag301.textContent).toContain("75% of students got this wrong");

    // Q2 (Short Answer, 90%) -> not flagged
    expect(screen.queryByTestId("high-wrong-flag-302")).toBeNull();

    // Q11 (Multiple Choice, 30%) -> flagged with 70%
    const flag311 = screen.getByTestId("high-wrong-flag-311");
    expect(flag311).toBeTruthy();
    expect(flag311.textContent).toContain("70% of students got this wrong");

    // Q12 (Multiple Choice, 95%) -> not flagged
    expect(screen.queryByTestId("high-wrong-flag-312")).toBeNull();

    // 3. Verify Answer / Option Displays
    // Q1 Short Answer expected key answer displayed
    expect(screen.getByText("Photosynthesis")).toBeTruthy();
    expect(screen.getByText(/What process converts light energy into chemical energy\?/)).toBeTruthy();

    // Q2 Short Answer expected key answer displayed
    expect(screen.getByText("Mitochondria")).toBeTruthy();
    expect(screen.getByText(/What organelle is the powerhouse of the cell\?/)).toBeTruthy();

    // Q11 Multiple Choice options displayed
    expect(screen.getByText("Hydrogen")).toBeTruthy();
    expect(screen.getByText("Helium")).toBeTruthy();

    // Q12 Multiple Choice options displayed
    expect(screen.getByText("Water")).toBeTruthy();
    expect(screen.getByText("Hydrogen Peroxide")).toBeTruthy();
  });
});




