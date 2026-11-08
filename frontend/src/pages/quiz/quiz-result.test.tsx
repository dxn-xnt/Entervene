// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import StudentQuizResult from "./quiz-result";
import * as quizApi from "@/lib/quiz-api";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ assignmentId: "42" }),
  useLocation: () => ({ pathname: "/student/quiz/42/result", search: "" }),
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button data-testid="sidebar-trigger" />,
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useSidebar: () => ({ state: "expanded", open: true, setOpen: vi.fn(), isMobile: false }),
}));

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="app-layout">{children}</div>,
}));

describe("StudentQuizResult - Question Navigator & Filter", () => {
  const scrollIntoViewMock = vi.fn();

  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
    scrollIntoViewMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    navigate.mockClear();
  });

  const mockQuizAttempt: quizApi.QuizAttemptResponse = {
    quiz_id: 1,
    classwork_assignment_id: 42,
    classwork_id: 10,
    title: "Midterm Biology Assessment",
    max_attempts: 1,
    attempt_count: 1,
    status: "graded",
    grade: 5,
    total_points: 15,
    can_submit: false,
    summary_available: true,
    summary_release_mode: "IMMEDIATE",
    questions: [
      {
        quiz_question_id: 101,
        question_text: "What is the powerhouse of the cell?",
        question_type: "MULTIPLE_CHOICE",
        points: 5,
        display_order: 1,
        is_correct: true,
        points_awarded: 5,
        selected_option_id: 1,
        options: [
          { option_id: 1, option_text: "Mitochondria", option_order: 1, is_correct: true },
          { option_id: 2, option_text: "Ribosome", option_order: 2, is_correct: false },
        ],
      },
      {
        quiz_question_id: 102,
        question_text: "Which molecule carries genetic information?",
        question_type: "MULTIPLE_CHOICE",
        points: 5,
        display_order: 2,
        is_correct: false,
        points_awarded: 0,
        selected_option_id: 4,
        options: [
          { option_id: 3, option_text: "DNA", option_order: 1, is_correct: true },
          { option_id: 4, option_text: "Lipid", option_order: 2, is_correct: false },
        ],
      },
      {
        quiz_question_id: 103,
        question_text: "Explain the light-dependent reactions.",
        question_type: "SHORT_ANSWER",
        points: 5,
        display_order: 3,
        is_correct: null,
        points_awarded: null,
        answer_text: "It uses sunlight to make ATP and NADPH.",
        options: [],
      },
    ],
  };

  it("renders one button per question with the correct color state in the navigator", async () => {
    vi.spyOn(quizApi, "getQuizAttempt").mockResolvedValue(mockQuizAttempt);

    render(<StudentQuizResult />);

    await waitFor(() => {
      expect(screen.getByText("Question Navigator (3 Questions)")).toBeTruthy();
    });

    const btn1 = screen.getByRole("button", { name: /Question 1/i });
    const btn2 = screen.getByRole("button", { name: /Question 2/i });
    const btn3 = screen.getByRole("button", { name: /Question 3/i });

    expect(btn1).toBeTruthy();
    expect(btn2).toBeTruthy();
    expect(btn3).toBeTruthy();

    expect(btn1.getAttribute("data-status")).toBe("correct");
    expect(btn1.className).toContain("bg-[#8BCB88]");

    expect(btn2.getAttribute("data-status")).toBe("incorrect");
    expect(btn2.className).toContain("bg-[#FF6B6B]");

    expect(btn3.getAttribute("data-status")).toBe("pending");
    expect(btn3.className).toContain("bg-[#F6E9B2]");
  });

  it("clicking a navigator button scrolls to the right card", async () => {
    vi.spyOn(quizApi, "getQuizAttempt").mockResolvedValue(mockQuizAttempt);

    render(<StudentQuizResult />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Question 2/i })).toBeTruthy();
    });

    const card2 = document.getElementById("quiz-question-card-1");
    expect(card2).not.toBeNull();

    const btn2 = screen.getByRole("button", { name: /Question 2/i });
    fireEvent.click(btn2);

    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    });
  });

  it("filters the cards to show only incorrect questions when toggle is clicked, keeping original numbering", async () => {
    vi.spyOn(quizApi, "getQuizAttempt").mockResolvedValue(mockQuizAttempt);

    render(<StudentQuizResult />);

    await waitFor(() => {
      expect(screen.getByText(/Show incorrect only \(1\)/i)).toBeTruthy();
    });

    // Before filter: all 3 questions are rendered
    expect(screen.getByText("What is the powerhouse of the cell?")).toBeTruthy();
    expect(screen.getByText("Which molecule carries genetic information?")).toBeTruthy();
    expect(screen.getByText("Explain the light-dependent reactions.")).toBeTruthy();

    const toggle = screen.getByRole("switch", { name: /Show incorrect only/i });
    expect((toggle as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(toggle);

    // After filter: only incorrect question is displayed
    await waitFor(() => {
      expect(screen.getByText("Which molecule carries genetic information?")).toBeTruthy();
      expect(screen.queryByText("What is the powerhouse of the cell?")).toBeNull();
      expect(screen.queryByText("Explain the light-dependent reactions.")).toBeNull();
    });

    // The single displayed card retains its original question number #2
    expect(screen.getByText("#2")).toBeTruthy();
    expect(screen.queryByText("#1")).toBeNull();

    // Navigator still renders all 3 buttons with original numbers
    expect(screen.getByRole("button", { name: /Question 1/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Question 2/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Question 3/i })).toBeTruthy();
  });

  it("disables the toggle if the student got a perfect score (0 incorrect questions)", async () => {
    const perfectAttempt: quizApi.QuizAttemptResponse = {
      ...mockQuizAttempt,
      grade: 10,
      total_points: 10,
      questions: [
        {
          quiz_question_id: 201,
          question_text: "Question A",
          question_type: "MULTIPLE_CHOICE",
          points: 5,
          display_order: 1,
          is_correct: true,
          options: [],
        },
        {
          quiz_question_id: 202,
          question_text: "Question B",
          question_type: "MULTIPLE_CHOICE",
          points: 5,
          display_order: 2,
          is_correct: true,
          options: [],
        },
      ],
    };

    vi.spyOn(quizApi, "getQuizAttempt").mockResolvedValue(perfectAttempt);

    render(<StudentQuizResult />);

    await waitFor(() => {
      expect(screen.getByText(/Show incorrect only \(0\)/i)).toBeTruthy();
    });

    const toggle = screen.getByRole("switch", { name: /Show incorrect only/i });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Perfect score! No incorrect questions/i)).toBeTruthy();
  });

  it("renders a released explanation and omits missing explanations", async () => {
    const attempt: quizApi.QuizAttemptResponse = {
      ...mockQuizAttempt,
      questions: [
        { ...mockQuizAttempt.questions[0], explanation: "Mitochondria produce usable cellular energy." },
        { ...mockQuizAttempt.questions[1], explanation: null },
      ],
    };
    vi.spyOn(quizApi, "getQuizAttempt").mockResolvedValue(attempt);

    render(<StudentQuizResult />);

    const explanation = await screen.findByLabelText("Explanation");
    expect(within(explanation).getByText("Mitochondria produce usable cellular energy.")).toBeTruthy();
    expect(screen.getAllByLabelText("Explanation")).toHaveLength(1);
  });

  it("does not render an explanation block when the backend withholds it", async () => {
    const hiddenAttempt: quizApi.QuizAttemptResponse = {
      ...mockQuizAttempt,
      questions: mockQuizAttempt.questions.map((question) => ({
        ...question,
        explanation: undefined,
      })),
    };
    vi.spyOn(quizApi, "getQuizAttempt").mockResolvedValue(hiddenAttempt);

    render(<StudentQuizResult />);

    await waitFor(() => expect(screen.getByText("Question Breakdown")).toBeTruthy());
    expect(screen.queryByLabelText("Explanation")).toBeNull();
  });

  it("does not reconstruct correct-answer information when option flags are omitted", async () => {
    const hiddenKeyAttempt: quizApi.QuizAttemptResponse = {
      ...mockQuizAttempt,
      questions: [
        {
          ...mockQuizAttempt.questions[1],
          options: mockQuizAttempt.questions[1].options.map((option) => ({
            ...option,
            is_correct: null,
          })),
        },
      ],
    };
    vi.spyOn(quizApi, "getQuizAttempt").mockResolvedValue(hiddenKeyAttempt);

    render(<StudentQuizResult />);

    const dnaOption = await screen.findByText("DNA");
    expect(dnaOption.parentElement?.textContent).not.toContain("Correct");
    expect(screen.queryByLabelText("Explanation")).toBeNull();
  });

  it("renders exact teacher feedback once and preserves line breaks", async () => {
    const feedback = "Strong first attempt.\nReview question 2 before the retake.";
    vi.spyOn(quizApi, "getQuizAttempt").mockResolvedValue({
      ...mockQuizAttempt,
      feedback,
    });

    render(<StudentQuizResult />);

    const feedbackCard = await screen.findByLabelText("Teacher Feedback");
    expect(within(feedbackCard).getAllByText("Teacher Feedback")).toHaveLength(1);
    expect(feedbackCard.textContent).toContain(feedback);
  });

  it("does not render an empty teacher-feedback card", async () => {
    vi.spyOn(quizApi, "getQuizAttempt").mockResolvedValue({
      ...mockQuizAttempt,
      feedback: "   ",
    });

    render(<StudentQuizResult />);

    await waitFor(() => expect(screen.getByText("Question Breakdown")).toBeTruthy());
    expect(screen.queryByLabelText("Teacher Feedback")).toBeNull();
  });

  it("shows authorized teacher feedback even while item summaries remain unreleased", async () => {
    vi.spyOn(quizApi, "getQuizAttempt").mockResolvedValue({
      ...mockQuizAttempt,
      summary_available: false,
      summary_message: "Your quiz summary is not available.",
      feedback: "Please review the lesson notes.",
    });

    render(<StudentQuizResult />);

    expect(await screen.findByLabelText("Teacher Feedback")).toBeTruthy();
    expect(screen.getByText("Please review the lesson notes.")).toBeTruthy();
    expect(screen.queryByText("Question Breakdown")).toBeNull();
  });

  it("shows pending teacher review without presenting a mixed-quiz subtotal as final", async () => {
    vi.spyOn(quizApi, "getQuizAttempt").mockResolvedValue({
      ...mockQuizAttempt,
      status: "submitted",
      grade: 5,
      total_points: 15,
    });

    render(<StudentQuizResult />);

    expect(await screen.findByText("Grading in Progress")).toBeTruthy();
    expect(screen.getByText("Pending Teacher Review (5 pts)")).toBeTruthy();
    expect(screen.queryByText("33%", { exact: true })).toBeNull();
    expect(screen.queryByText("5 / 15 Total Points")).toBeNull();
  });

  it("classifies a partially graded response without calling it pending", async () => {
    const partialAttempt: quizApi.QuizAttemptResponse = {
      ...mockQuizAttempt,
      status: "graded",
      grade: 2,
      total_points: 5,
      questions: [
        {
          quiz_question_id: 301,
          question_text: "Explain photosynthesis.",
          question_type: "SHORT_ANSWER",
          points: 5,
          display_order: 1,
          is_correct: null,
          points_awarded: 2,
          answer_text: "Plants use light.",
          options: [],
        },
      ],
    };
    vi.spyOn(quizApi, "getQuizAttempt").mockResolvedValue(partialAttempt);

    render(<StudentQuizResult />);

    expect(await screen.findByText("Partially Correct - 2 / 5 pts")).toBeTruthy();
    expect(screen.queryByText(/Pending Teacher Review/)).toBeNull();
    expect(screen.getByLabelText("Final score 40%")).toBeTruthy();
  });

  it("uses a neutral reviewed state when points exist without a correctness decision", async () => {
    const reviewedAttempt: quizApi.QuizAttemptResponse = {
      ...mockQuizAttempt,
      status: "graded",
      grade: 0,
      total_points: 5,
      questions: [
        {
          quiz_question_id: 302,
          question_text: "Describe the process.",
          question_type: "SHORT_ANSWER",
          points: 5,
          display_order: 1,
          is_correct: null,
          points_awarded: 0,
          answer_text: "A reviewed response.",
          options: [],
        },
      ],
    };
    vi.spyOn(quizApi, "getQuizAttempt").mockResolvedValue(reviewedAttempt);

    render(<StudentQuizResult />);

    expect(await screen.findByText("Reviewed - 0 / 5 pts")).toBeTruthy();
    expect(screen.queryByText(/Pending Teacher Review/)).toBeNull();
  });

  it("shows the normal final score for a fully graded quiz", async () => {
    const finalAttempt: quizApi.QuizAttemptResponse = {
      ...mockQuizAttempt,
      status: "graded",
      grade: 10,
      total_points: 10,
      questions: mockQuizAttempt.questions.slice(0, 2).map((question) => ({
        ...question,
        is_correct: true,
        points_awarded: 5,
      })),
    };
    vi.spyOn(quizApi, "getQuizAttempt").mockResolvedValue(finalAttempt);

    render(<StudentQuizResult />);

    expect(await screen.findByLabelText("Final score 100%")).toBeTruthy();
    expect(screen.getByText("10 / 10 Total Points")).toBeTruthy();
    expect(screen.queryByText("Grading in Progress")).toBeNull();
  });

  it("shows an identification response without fabricating accepted answer keys", async () => {
    const identificationAttempt: quizApi.QuizAttemptResponse = {
      ...mockQuizAttempt,
      status: "graded",
      grade: 0,
      total_points: 5,
      questions: [
        {
          quiz_question_id: 303,
          question_text: "Name the scientist.",
          question_type: "IDENTIFICATION",
          points: 5,
          display_order: 1,
          is_correct: false,
          points_awarded: 0,
          answer_text: "Albert Einstein",
          options: [],
          explanation: "Review the scientist discussed in class.",
        },
      ],
    };
    vi.spyOn(quizApi, "getQuizAttempt").mockResolvedValue(identificationAttempt);

    render(<StudentQuizResult />);

    expect(await screen.findByText("Albert Einstein")).toBeTruthy();
    expect(screen.getByText("Review the scientist discussed in class.")).toBeTruthy();
    expect(screen.queryByText("Isaac Newton")).toBeNull();
  });

  it("does not show old evaluation data for an active retake", async () => {
    const activeRetake: quizApi.QuizAttemptResponse = {
      ...mockQuizAttempt,
      status: "pending",
      grade: null,
      summary_available: false,
      questions: mockQuizAttempt.questions.map((question) => ({
        ...question,
        is_correct: null,
        points_awarded: null,
        explanation: null,
        options: question.options.map((option) => ({ ...option, is_correct: null })),
      })),
    };
    vi.spyOn(quizApi, "getQuizAttempt").mockResolvedValue(activeRetake);

    render(<StudentQuizResult />);

    expect((await screen.findAllByText("Quiz in Progress")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Question Breakdown")).toBeNull();
    expect(screen.queryByLabelText("Explanation")).toBeNull();
    expect(screen.queryByText(/Total Points/)).toBeNull();
  });
});
