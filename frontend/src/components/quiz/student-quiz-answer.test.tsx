// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import {
  QuizTextAnswerInput,
  QuizTextAnswerSummary,
  IDENTIFICATION_PLACEHOLDER,
  SHORT_ANSWER_PLACEHOLDER,
} from "./student-quiz-answer";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("QuizTextAnswerInput", () => {
  it("renders a single-line input with 'Type your answer' for IDENTIFICATION", () => {
    const onChange = vi.fn();
    const q = { question_type: "IDENTIFICATION" };

    render(<QuizTextAnswerInput question={q} value="test" onChange={onChange} />);

    const input = screen.getByPlaceholderText(IDENTIFICATION_PLACEHOLDER);
    expect(input.tagName).toBe("INPUT");
    expect((input as HTMLInputElement).value).toBe("test");

    fireEvent.change(input, { target: { value: "new answer" } });
    expect(onChange).toHaveBeenCalledWith("new answer");
  });

  it("renders a textarea with 'Write your response' for pure SHORT_ANSWER", () => {
    const onChange = vi.fn();
    const q = { question_type: "SHORT_ANSWER", options: [] };

    render(<QuizTextAnswerInput question={q} value="essay" onChange={onChange} />);

    const textarea = screen.getByPlaceholderText(SHORT_ANSWER_PLACEHOLDER);
    expect(textarea.tagName).toBe("TEXTAREA");
    expect((textarea as HTMLTextAreaElement).value).toBe("essay");

    fireEvent.change(textarea, { target: { value: "updated response" } });
    expect(onChange).toHaveBeenCalledWith("updated response");
  });

  it("treats legacy SHORT_ANSWER with options/keys as IDENTIFICATION via normalization", () => {
    const onChange = vi.fn();
    // Legacy question stored as SHORT_ANSWER but having options/keys
    const legacyQ = {
      question_type: "SHORT_ANSWER",
      options: [{ option_text: "Accepted Answer" }],
    };

    render(<QuizTextAnswerInput question={legacyQ} value="" onChange={onChange} />);

    // Should render single-line input with "Type your answer", NOT textarea
    const input = screen.getByPlaceholderText(IDENTIFICATION_PLACEHOLDER);
    expect(input.tagName).toBe("INPUT");
    expect(screen.queryByPlaceholderText(SHORT_ANSWER_PLACEHOLDER)).toBeNull();
  });

  it("respects the disabled prop", () => {
    const onChange = vi.fn();
    const q = { question_type: "IDENTIFICATION" };

    render(<QuizTextAnswerInput question={q} value="" onChange={onChange} disabled={true} />);

    const input = screen.getByPlaceholderText(IDENTIFICATION_PLACEHOLDER) as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });
});

describe("QuizTextAnswerSummary", () => {
  it("renders 'Expected answer: ...' for IDENTIFICATION when key is revealed and marked correct", () => {
    const q = {
      question_type: "IDENTIFICATION",
      answer_text: "mitochondria",
      is_correct: true,
      points_awarded: 1,
      options: [{ option_text: "Mitochondria", is_correct: true }],
    };

    render(<QuizTextAnswerSummary question={q} />);

    expect(screen.getByText("mitochondria")).toBeTruthy();
    expect(screen.getByText("Expected answer: Mitochondria")).toBeTruthy();
    expect(screen.getByText("Marked correct")).toBeTruthy();
  });

  it("never shows expected answer or leaks sample answer/rubric for SHORT_ANSWER", () => {
    const q = {
      question_type: "SHORT_ANSWER",
      answer_text: "My student essay on photosynthesis.",
      is_correct: null,
      points_awarded: null,
      explanation: "Teacher-only rubric: must mention chlorophyll and ATP.",
      options: [],
    };

    render(<QuizTextAnswerSummary question={q} />);

    expect(screen.getByText("My student essay on photosynthesis.")).toBeTruthy();
    expect(screen.queryByText(/Expected answer/i)).toBeNull();
    expect(screen.queryByText(/Teacher-only rubric/i)).toBeNull();
    expect(screen.queryByText(/chlorophyll/i)).toBeNull();
    expect(screen.getByText("Pending teacher review")).toBeTruthy();
  });

  it("displays 'Graded by teacher' when points_awarded is present for reviewed short answer", () => {
    const q = {
      question_type: "SHORT_ANSWER",
      answer_text: "Student response here",
      is_correct: null,
      points_awarded: 5,
      options: [],
    };

    render(<QuizTextAnswerSummary question={q} />);

    expect(screen.getByText("Graded by teacher")).toBeTruthy();
    expect(screen.queryByText(/Expected answer/i)).toBeNull();
  });

  it("displays 'Incorrect' when an auto-graded question is marked false", () => {
    const q = {
      question_type: "IDENTIFICATION",
      answer_text: "wrong answer",
      is_correct: false,
      points_awarded: 0,
      options: [{ option_text: "Correct Key", is_correct: false }], // not revealed
    };

    render(<QuizTextAnswerSummary question={q} />);

    expect(screen.getByText("Incorrect")).toBeTruthy();
    // Because is_correct is not true on option, expected answer is not leaked
    expect(screen.queryByText(/Expected answer/i)).toBeNull();
  });
});
