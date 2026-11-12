// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import QuizGradingModal from "./quiz-grading-modal";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), toastSuccess: vi.fn(), toastError: vi.fn() }));

vi.mock("@/lib/api", () => ({ apiFetch: mocks.apiFetch }));
vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({ success: mocks.toastSuccess, error: mocks.toastError }),
}));
vi.mock("@/components/retroui/Dialog", async () => {
  const React = await import("react");
  const Open = React.createContext(false);
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Object.assign(
      ({ children, open }: { children: ReactNode; open: boolean }) => (
        <Open.Provider value={open}>{children}</Open.Provider>
      ),
      {
        Content: ({ children }: { children: ReactNode }) => (
          React.useContext(Open) ? <section role="dialog">{children}</section> : null
        ),
        Header: Part,
        Footer: Part,
      },
    ),
  };
});
vi.mock("@/components/quiz-feedback-assistant", () => ({
  default: ({ onPublished }: {
    onPublished: (feedback: string, feedbackFingerprint: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => onPublished("Authoritative approved feedback.", "c".repeat(64))}
    >
      Simulate AI post
    </button>
  ),
}));

function detail(submissionId: number, studentName: string, fingerprint = "b".repeat(64)) {
  return {
    submission_id: submissionId,
    classwork_id: 10,
    student_id: `student-${submissionId}`,
    student_name: studentName,
    avatar: null,
    status: "graded",
    attempt_count: 1,
    total_points: 5,
    grade: 5,
    feedback: "Original teacher feedback.",
    feedback_fingerprint: fingerprint,
    submitted_at: "2026-11-09T08:00:00Z",
    graded_at: "2026-11-09T08:05:00Z",
    needs_grading: false,
    answers: [{
      answer_id: 1,
      quiz_question_id: 101,
      question_text: "What is a variable?",
      question_type: "SHORT_ANSWER",
      max_points: 5,
      answer_text: "A named value.",
      is_correct: true,
      points_awarded: 5,
      options: [],
    }],
  };
}

describe("QuizGradingModal feedback integration", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
  });

  afterEach(cleanup);

  it("uses the authoritative AI-posted feedback and fingerprint in the next grade save", async () => {
    const initial = detail(41, "First Student");
    mocks.apiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(initial), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...initial,
        feedback: "Authoritative approved feedback.",
        feedback_fingerprint: "c".repeat(64),
      }), { status: 200 }));

    render(
      <QuizGradingModal
        submissionId={41}
        isOpen
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const feedbackEditor = await screen.findByPlaceholderText("Add feedback on this attempt...") as HTMLTextAreaElement;
    expect(feedbackEditor.value).toBe("Original teacher feedback.");
    fireEvent.click(screen.getByRole("button", { name: "Simulate AI post" }));
    expect(feedbackEditor.value).toBe("Authoritative approved feedback.");

    fireEvent.click(screen.getByRole("button", { name: /Save Grade/ }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(2));
    const [, request] = mocks.apiFetch.mock.calls[1] as [string, RequestInit];
    const payload = JSON.parse(String(request.body));
    expect(payload.feedback).toBe("Authoritative approved feedback.");
    expect(payload.expected_feedback_fingerprint).toBe("c".repeat(64));
  });

  it("ignores a late detail response after the selected submission changes", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    mocks.apiFetch
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(detail(42, "Second Student")), { status: 200 }));
    const view = render(
      <QuizGradingModal
        submissionId={41}
        isOpen
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    view.rerender(
      <QuizGradingModal
        submissionId={42}
        isOpen
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(await screen.findByText("Second Student")).toBeDefined();
    resolveFirst?.(new Response(JSON.stringify(detail(41, "First Student")), { status: 200 }));

    await waitFor(() => expect(screen.queryByText("First Student")).toBeNull());
    expect(screen.getByText("Second Student")).toBeDefined();
  });
});
