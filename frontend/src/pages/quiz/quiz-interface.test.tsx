// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import StudentQuizTake from "./quiz-interface";
import * as quizApi from "@/lib/quiz-api";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ assignmentId: "42" }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate.mockClear();
});

describe("StudentQuizTake - Answer choice text wrapping & layout", () => {
  it("renders multi-sentence long answers without truncation and matches heights side by side", async () => {
    const longAnswerText =
      "Photosynthesis is the fundamental biological process by which green plants and certain other organisms transform light energy into chemical energy. During photosynthesis in green plants, light energy is captured and used to convert water, carbon dioxide, and minerals into oxygen and energy-rich organic compounds. This process is crucial for maintaining atmospheric oxygen levels and providing base energy for ecosystems.";
    const shortAnswerText = "Respiration";

    const mockQuizAttempt: quizApi.QuizAttemptResponse = {
      quiz_id: 1,
      classwork_assignment_id: 42,
      classwork_id: 10,
      title: "Cellular Biology Mastery Assessment",
      max_attempts: 1,
      attempt_count: 1,
      status: "IN_PROGRESS",
      can_submit: true,
      summary_available: false,
      summary_release_mode: "IMMEDIATE",
      questions: [
        {
          quiz_question_id: 101,
          question_text: "Which statement best describes the primary role of photosynthesis in terrestrial ecosystems?",
          question_type: "MULTIPLE_CHOICE",
          points: 5,
          display_order: 1,
          options: [
            {
              option_id: 1,
              option_text: longAnswerText,
              option_order: 1,
            },
            {
              option_id: 2,
              option_text: shortAnswerText,
              option_order: 2,
            },
          ],
        },
      ],
    };

    vi.spyOn(quizApi, "getQuizAttempt").mockResolvedValue(mockQuizAttempt);

    render(<StudentQuizTake />);

    // Wait for the quiz to load and display the question
    await waitFor(() => {
      expect(screen.getByText(/Which statement best describes the primary role/i)).toBeTruthy();
    });

    // Check long answer choice is rendered in full
    const longOptionSpan = screen.getByText(longAnswerText);
    expect(longOptionSpan).toBeTruthy();
    const longOptionButton = longOptionSpan.closest("button");
    expect(longOptionButton).not.toBeNull();

    // Check short answer choice is rendered
    const shortOptionSpan = screen.getByText(shortAnswerText);
    expect(shortOptionSpan).toBeTruthy();
    const shortOptionButton = shortOptionSpan.closest("button");
    expect(shortOptionButton).not.toBeNull();

    // 1. Confirm neither button nor span contains truncation CSS
    const longBtnClasses = longOptionButton!.className;
    const longSpanClasses = longOptionSpan.className;

    expect(longBtnClasses).not.toContain("line-clamp");
    expect(longBtnClasses).not.toContain("truncate");
    expect(longBtnClasses).not.toContain("overflow-hidden");
    expect(longBtnClasses).not.toContain("text-ellipsis");
    expect(longBtnClasses).not.toContain("max-h-");

    expect(longSpanClasses).not.toContain("line-clamp");
    expect(longSpanClasses).not.toContain("truncate");
    expect(longSpanClasses).not.toContain("overflow-hidden");
    expect(longSpanClasses).not.toContain("text-ellipsis");

    // 2. Confirm both buttons have wrapping and responsive expanding classes
    expect(longBtnClasses).toContain("whitespace-normal");
    expect(longBtnClasses).toContain("break-words");
    expect(longBtnClasses).toContain("w-full");
    expect(longBtnClasses).toContain("min-w-0");
    expect(longBtnClasses).toContain("h-full");
    expect(longBtnClasses).toContain("min-h-[5rem]");

    expect(longSpanClasses).toContain("whitespace-normal");
    expect(longSpanClasses).toContain("break-words");
    expect(longSpanClasses).toContain("w-full");
    expect(longSpanClasses).toContain("max-w-full");

    // 3. Confirm the short option sibling also has h-full and min-h-[5rem] to stretch with the long option in the grid row
    const shortBtnClasses = shortOptionButton!.className;
    expect(shortBtnClasses).toContain("h-full");
    expect(shortBtnClasses).toContain("min-h-[5rem]");
    expect(shortBtnClasses).toContain("w-full");
    expect(shortBtnClasses).toContain("min-w-0");

    // 4. Test selecting the long answer option
    fireEvent.click(longOptionButton!);
    expect(longOptionButton!.className).toContain("bg-primary");
  });
});
