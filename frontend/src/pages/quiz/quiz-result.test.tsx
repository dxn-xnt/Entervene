// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import StudentQuizResult from "./quiz-result";
import * as quizApi from "@/lib/quiz-api";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ assignmentId: "42" }),
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

    expect(btn3.getAttribute("data-status")).toBe("unattempted");
    expect(btn3.className).toContain("bg-[#FFD08A]");
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
});
