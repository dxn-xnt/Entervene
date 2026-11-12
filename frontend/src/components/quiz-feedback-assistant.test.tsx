// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import QuizFeedbackAssistant from "./quiz-feedback-assistant";
import {
  generateSubmissionFeedbackSuggestion,
  getSubmissionFeedbackEligibility,
  publishSubmissionFeedback,
  SubmissionFeedbackApiError,
} from "@/lib/submission-feedback-api";

const toastSuccess = vi.fn();

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn() }),
}));

vi.mock("@/lib/submission-feedback-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/submission-feedback-api")>(
    "@/lib/submission-feedback-api",
  );
  return {
    ...actual,
    getSubmissionFeedbackEligibility: vi.fn(),
    generateSubmissionFeedbackSuggestion: vi.fn(),
    publishSubmissionFeedback: vi.fn(),
  };
});

const getEligibilityMock = vi.mocked(getSubmissionFeedbackEligibility);
const generateMock = vi.mocked(generateSubmissionFeedbackSuggestion);
const publishMock = vi.mocked(publishSubmissionFeedback);

const eligible = {
  submission_id: 41,
  eligible: true,
  answer_release_authorized: true,
  code: null,
  message: null,
};

const suggestion = {
  submission_id: 41,
  feedback: "Review the lesson concept, then explain each step in your own words.",
  detail_level: "DETAILED" as const,
  answer_release_authorized: true,
  attempt_count: 1,
  evidence_item_count: 4,
  included_item_count: 4,
  evidence_fingerprint: "a".repeat(64),
  feedback_fingerprint: "b".repeat(64),
  generated_at: "2026-11-09T09:00:00Z",
};

function renderAssistant(options: { fullyGraded?: boolean; existingFeedback?: string } = {}) {
  const onPublished = vi.fn();
  render(
    <QuizFeedbackAssistant
      submissionId={41}
      fullyGraded={options.fullyGraded ?? true}
      existingFeedback={options.existingFeedback ?? ""}
      onPublished={onPublished}
    />,
  );
  return { onPublished };
}

async function generateSuggestion() {
  await screen.findByRole("button", { name: "Generate Feedback" });
  fireEvent.click(screen.getByRole("button", { name: "Generate Feedback" }));
  await screen.findByText(suggestion.feedback);
}

describe("QuizFeedbackAssistant", () => {
  beforeEach(() => {
    getEligibilityMock.mockResolvedValue(eligible);
    generateMock.mockResolvedValue(suggestion);
    publishMock.mockImplementation(async (_submissionId, payload) => ({
      submission_id: 41,
      feedback: payload.feedback,
      evidence_fingerprint: suggestion.evidence_fingerprint,
      feedback_fingerprint: "c".repeat(64),
    }));
    toastSuccess.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps generation unavailable while manual grading is pending", () => {
    renderAssistant({ fullyGraded: false });

    expect(screen.getByText("Finish manual grading first")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Generate Feedback" })).toBeNull();
    expect(getEligibilityMock).not.toHaveBeenCalled();
  });

  it.each([
    ["FEEDBACK_RETAKE_AVAILABLE", "Feedback can be generated after the final available quiz attempt"],
    ["FEEDBACK_CORRECT_ANSWERS_DISABLED", "Correct-answer display is disabled for this quiz"],
    ["FEEDBACK_AI_UNAVAILABLE", "AI feedback is unavailable in this environment"],
  ])("shows a server-derived unavailable state for %s", async (code, message) => {
    getEligibilityMock.mockResolvedValue({
      ...eligible,
      eligible: false,
      answer_release_authorized: false,
      code,
      message,
    });
    renderAssistant();

    expect(await screen.findByText(message)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Generate Feedback" })).toBeNull();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("generates a private suggestion without posting or overwriting existing feedback", async () => {
    const { onPublished } = renderAssistant({ existingFeedback: "Teacher's original comment." });

    await generateSuggestion();

    expect(generateMock).toHaveBeenCalledWith(41);
    expect(screen.getByText("AI suggestion — not posted")).toBeDefined();
    expect(publishMock).not.toHaveBeenCalled();
    expect(onPublished).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Final teacher-approved feedback")).toBeNull();
  });

  it("uses a suggestion only after the teacher chooses it and allows editing", async () => {
    renderAssistant();
    await generateSuggestion();

    fireEvent.click(screen.getByRole("button", { name: "Use Suggestion" }));
    const editor = screen.getByLabelText("Final teacher-approved feedback") as HTMLTextAreaElement;
    expect(editor.value).toBe(suggestion.feedback);
    fireEvent.change(editor, { target: { value: "Teacher-edited final feedback." } });
    expect(editor.value).toBe("Teacher-edited final feedback.");
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("appends to existing feedback without publishing automatically", async () => {
    renderAssistant({ existingFeedback: "Existing teacher feedback." });
    await generateSuggestion();

    fireEvent.click(screen.getByRole("button", { name: "Append Suggestion" }));

    expect((screen.getByLabelText("Final teacher-approved feedback") as HTMLTextAreaElement).value).toBe(
      `Existing teacher feedback.\n\n${suggestion.feedback}`,
    );
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation before preparing a replacement", async () => {
    renderAssistant({ existingFeedback: "Existing teacher feedback." });
    await generateSuggestion();

    fireEvent.click(screen.getByRole("button", { name: "Replace Existing Feedback" }));
    expect(screen.queryByLabelText("Final teacher-approved feedback")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Use as Replacement" }));

    await waitFor(() => {
      expect((screen.getByLabelText("Final teacher-approved feedback") as HTMLTextAreaElement).value).toBe(
        suggestion.feedback,
      );
    });
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("discards an unposted suggestion", async () => {
    renderAssistant();
    await generateSuggestion();

    fireEvent.click(screen.getByRole("button", { name: "Discard Suggestion" }));

    expect(screen.queryByText(suggestion.feedback)).toBeNull();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("posts only the explicitly approved text with both fingerprints", async () => {
    const { onPublished } = renderAssistant();
    await generateSuggestion();
    fireEvent.click(screen.getByRole("button", { name: "Use Suggestion" }));
    fireEvent.change(screen.getByLabelText("Final teacher-approved feedback"), {
      target: { value: "Teacher-approved final wording." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Post Approved Feedback" }));

    await waitFor(() => expect(publishMock).toHaveBeenCalledWith(41, {
      feedback: "Teacher-approved final wording.",
      expected_evidence_fingerprint: suggestion.evidence_fingerprint,
      expected_feedback_fingerprint: suggestion.feedback_fingerprint,
    }));
    expect(onPublished).toHaveBeenCalledWith("Teacher-approved final wording.", "c".repeat(64));
    expect(toastSuccess).toHaveBeenCalledWith({ title: "Teacher feedback posted" });
  });

  it.each([
    ["FEEDBACK_EVIDENCE_STALE", "Quiz scores or answers changed"],
    ["FEEDBACK_COMMENT_STALE", "Saved teacher feedback changed elsewhere"],
    ["FEEDBACK_ANSWER_RELEASE_PENDING", "Correct answers are not released yet"],
  ])("keeps the draft and explains publication conflict %s", async (code, expected) => {
    publishMock.mockRejectedValue(new SubmissionFeedbackApiError(409, "Correct answers are not released yet", code));
    renderAssistant();
    await generateSuggestion();
    fireEvent.click(screen.getByRole("button", { name: "Use Suggestion" }));

    fireEvent.click(screen.getByRole("button", { name: "Post Approved Feedback" }));

    expect(await screen.findByText(new RegExp(expected))).toBeDefined();
    expect(screen.getByLabelText("Final teacher-approved feedback")).toBeDefined();
  });

  it("shows provider failures without creating a review draft or posting", async () => {
    generateMock.mockRejectedValue(new SubmissionFeedbackApiError(503, "AI provider unavailable", "FEEDBACK_AI_UNAVAILABLE"));
    renderAssistant();

    await screen.findByRole("button", { name: "Generate Feedback" });
    fireEvent.click(screen.getByRole("button", { name: "Generate Feedback" }));

    expect(await screen.findByText("AI provider unavailable")).toBeDefined();
    expect(screen.queryByLabelText("Final teacher-approved feedback")).toBeNull();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("ignores a late suggestion response after the selected submission changes", async () => {
    let resolveSuggestion: ((value: typeof suggestion) => void) | undefined;
    generateMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveSuggestion = resolve;
    }));
    const onPublished = vi.fn();
    const view = render(
      <QuizFeedbackAssistant
        submissionId={41}
        fullyGraded
        existingFeedback=""
        onPublished={onPublished}
      />,
    );
    await screen.findByRole("button", { name: "Generate Feedback" });
    fireEvent.click(screen.getByRole("button", { name: "Generate Feedback" }));

    view.rerender(
      <QuizFeedbackAssistant
        submissionId={42}
        fullyGraded
        existingFeedback="Another student's feedback."
        onPublished={onPublished}
      />,
    );
    resolveSuggestion?.(suggestion);

    await waitFor(() => expect(getEligibilityMock).toHaveBeenCalledWith(42));
    expect(screen.queryByText(suggestion.feedback)).toBeNull();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("does not apply a late publication response to a newly selected submission", async () => {
    let resolvePublication: ((value: {
      submission_id: number;
      feedback: string;
      evidence_fingerprint: string;
      feedback_fingerprint: string;
    }) => void) | undefined;
    publishMock.mockReturnValueOnce(new Promise((resolve) => {
      resolvePublication = resolve;
    }));
    const firstPublished = vi.fn();
    const secondPublished = vi.fn();
    const view = render(
      <QuizFeedbackAssistant
        submissionId={41}
        fullyGraded
        existingFeedback=""
        onPublished={firstPublished}
      />,
    );
    await generateSuggestion();
    fireEvent.click(screen.getByRole("button", { name: "Use Suggestion" }));
    fireEvent.click(screen.getByRole("button", { name: "Post Approved Feedback" }));

    view.rerender(
      <QuizFeedbackAssistant
        submissionId={42}
        fullyGraded
        existingFeedback="Another student's feedback."
        onPublished={secondPublished}
      />,
    );
    resolvePublication?.({
      submission_id: 41,
      feedback: suggestion.feedback,
      evidence_fingerprint: suggestion.evidence_fingerprint,
      feedback_fingerprint: "c".repeat(64),
    });

    await waitFor(() => expect(getEligibilityMock).toHaveBeenCalledWith(42));
    expect(firstPublished).not.toHaveBeenCalled();
    expect(secondPublished).not.toHaveBeenCalled();
    expect(screen.queryByText(suggestion.feedback)).toBeNull();
  });
});
