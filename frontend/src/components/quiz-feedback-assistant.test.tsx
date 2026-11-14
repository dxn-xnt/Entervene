// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import QuizFeedbackAssistant from "./quiz-feedback-assistant";
import {
  discardSubmissionFeedbackDraft,
  getSubmissionFeedbackDraft,
  publishSubmissionFeedback,
  SubmissionFeedbackApiError,
  type FeedbackDraft,
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
    getSubmissionFeedbackDraft: vi.fn(),
    discardSubmissionFeedbackDraft: vi.fn(),
    publishSubmissionFeedback: vi.fn(),
  };
});

const getDraftMock = vi.mocked(getSubmissionFeedbackDraft);
const discardDraftMock = vi.mocked(discardSubmissionFeedbackDraft);
const publishMock = vi.mocked(publishSubmissionFeedback);

const readyDraft: FeedbackDraft = {
  submission_id: 41,
  status: "READY",
  draft_feedback: "Review the lesson concept, then explain each step in your own words.",
  evidence_fingerprint: "a".repeat(64),
  feedback_fingerprint: "b".repeat(64),
  detail_level: "GENERAL",
  auto_ai_feedback_enabled: true,
  error_message: null,
  created_at: "2026-11-15T00:00:00Z",
  updated_at: "2026-11-15T00:00:00Z",
};

const noneDraft: FeedbackDraft = {
  submission_id: 41,
  status: "NONE",
  draft_feedback: null,
  evidence_fingerprint: null,
  feedback_fingerprint: null,
  detail_level: "GENERAL",
  auto_ai_feedback_enabled: false,
  error_message: null,
  created_at: null,
  updated_at: null,
};

type HarnessOptions = {
  submissionId?: number;
  fullyGraded?: boolean;
  savedFeedback?: string;
  initialDraft?: string;
  classworkKind?: "QUIZ" | "ASSIGNMENT" | "ACTIVITY";
  onConflictReload?: (submissionId: number) => Promise<void>;
  onPublished?: (feedback: string, fingerprint: string) => void;
  onReviewChange?: (reviewing: boolean) => void;
};

/** Mirrors a host: one Teacher Feedback editor owned by the page. */
function TeacherFeedbackHarness(options: HarnessOptions) {
  const saved = options.savedFeedback ?? "";
  const [draft, setDraft] = useState(options.initialDraft ?? saved);
  return (
    <div>
      <label htmlFor="teacher-feedback">Teacher Feedback</label>
      <textarea id="teacher-feedback" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <QuizFeedbackAssistant
        submissionId={options.submissionId ?? 41}
        fullyGraded={options.fullyGraded ?? true}
        existingFeedback={saved}
        feedbackDraft={draft}
        onFeedbackDraftChange={setDraft}
        onPublished={options.onPublished ?? vi.fn()}
        classworkKind={options.classworkKind}
        onConflictReload={options.onConflictReload}
        onReviewChange={options.onReviewChange}
      />
    </div>
  );
}

function renderAssistant(options: HarnessOptions = {}) {
  const onPublished = options.onPublished ?? vi.fn();
  const onReviewChange = options.onReviewChange ?? vi.fn();
  const view = render(<TeacherFeedbackHarness {...options} onPublished={onPublished} onReviewChange={onReviewChange} />);
  return { onPublished, onReviewChange, view };
}

const editor = () => screen.getByLabelText("Teacher Feedback") as HTMLTextAreaElement;

describe("Teacher Feedback inline AI automatic draft controls", () => {
  beforeEach(() => {
    getDraftMock.mockResolvedValue(readyDraft);
    discardDraftMock.mockResolvedValue({ ...readyDraft, status: "DISCARDED" });
    publishMock.mockImplementation(async (_submissionId, payload) => ({
      submission_id: 41,
      feedback: payload.feedback,
      evidence_fingerprint: readyDraft.evidence_fingerprint!,
      feedback_fingerprint: "c".repeat(64),
    }));
    toastSuccess.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders no separate assistant interface, second editor, or manual generate button", async () => {
    renderAssistant();
    await waitFor(() => expect(getDraftMock).toHaveBeenCalledWith(41));
    expect(screen.queryByText("AI Feedback Assistant")).toBeNull();
    expect(screen.queryByRole("button", { name: "Generate AI Feedback" })).toBeNull();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("automatically loads a ready draft into the single Teacher Feedback editor", async () => {
    const { onReviewChange } = renderAssistant();
    await waitFor(() => expect(editor().value).toBe(readyDraft.draft_feedback));
    expect(onReviewChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "Post Feedback" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Discard Draft" })).toBeDefined();
  });

  it("supports direct click-to-edit in the single editor without separate modal or adopt step", async () => {
    renderAssistant();
    await waitFor(() => expect(editor().value).toBe(readyDraft.draft_feedback));

    fireEvent.change(editor(), { target: { value: "Teacher edited text directly in place." } });
    expect(editor().value).toBe("Teacher edited text directly in place.");
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("discards the draft, calls server discard endpoint, and restores previous feedback", async () => {
    const { onReviewChange } = renderAssistant({ savedFeedback: "Original saved feedback." });
    await waitFor(() => expect(editor().value).toBe(readyDraft.draft_feedback));

    fireEvent.click(screen.getByRole("button", { name: "Discard Draft" }));

    await waitFor(() => expect(discardDraftMock).toHaveBeenCalledWith(41));
    expect(editor().value).toBe("Original saved feedback.");
    await waitFor(() => expect(onReviewChange).toHaveBeenLastCalledWith(false));
    expect(toastSuccess).toHaveBeenCalledWith({ title: "AI feedback draft discarded" });
  });

  it("posts approved feedback with evidence and comment fingerprints", async () => {
    const { onPublished, onReviewChange } = renderAssistant();
    await waitFor(() => expect(editor().value).toBe(readyDraft.draft_feedback));

    fireEvent.change(editor(), { target: { value: "Approved feedback with minor edit." } });
    fireEvent.click(screen.getByRole("button", { name: "Post Feedback" }));

    await waitFor(() => expect(publishMock).toHaveBeenCalledWith(41, {
      feedback: "Approved feedback with minor edit.",
      expected_evidence_fingerprint: readyDraft.evidence_fingerprint,
      expected_feedback_fingerprint: readyDraft.feedback_fingerprint,
    }));
    expect(onPublished).toHaveBeenCalledWith("Approved feedback with minor edit.", "c".repeat(64));
    expect(toastSuccess).toHaveBeenCalledWith({ title: "Teacher feedback posted" });
    await waitFor(() => expect(onReviewChange).toHaveBeenLastCalledWith(false));
  });

  it("preserves unsaved manual edits when an AI draft arrives and offers explicit choice", async () => {
    const { onReviewChange } = renderAssistant({
      savedFeedback: "",
      initialDraft: "Teacher's manual draft note already in editor.",
    });

    await waitFor(() => expect(getDraftMock).toHaveBeenCalledWith(41));
    // Manual text is preserved!
    expect(editor().value).toBe("Teacher's manual draft note already in editor.");
    expect(screen.getByText("AI feedback draft ready")).toBeDefined();
    expect(screen.getByRole("button", { name: "Review AI Draft" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Keep My Notes" })).toBeDefined();

    // Teacher decides to review AI draft
    fireEvent.click(screen.getByRole("button", { name: "Review AI Draft" }));
    expect(editor().value).toBe(readyDraft.draft_feedback);
    expect(onReviewChange).toHaveBeenCalledWith(true);
  });

  it("renders nothing when Automatic AI Feedback toggle is OFF", async () => {
    getDraftMock.mockResolvedValue(noneDraft);
    const { onReviewChange } = renderAssistant();

    await waitFor(() => expect(getDraftMock).toHaveBeenCalledWith(41));
    expect(editor().value).toBe("");
    expect(onReviewChange).not.toHaveBeenCalledWith(true);
    expect(screen.queryByRole("button", { name: "Post Feedback" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard Draft" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Generate AI Feedback" })).toBeNull();
  });

  it("does not fetch draft when submission is not fully graded", () => {
    renderAssistant({ fullyGraded: false });
    expect(getDraftMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Generate AI Feedback" })).toBeNull();
  });

  it("blocks posting text over 1200 characters", async () => {
    renderAssistant();
    await waitFor(() => expect(editor().value).toBe(readyDraft.draft_feedback));

    fireEvent.change(editor(), { target: { value: "a".repeat(1201) } });
    expect((screen.getByRole("button", { name: "Post Feedback" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("1201/1200 characters")).toBeDefined();
  });

  it.each([
    ["FEEDBACK_EVIDENCE_STALE", "Quiz scores or answers changed"],
    ["FEEDBACK_COMMENT_STALE", "Saved teacher feedback changed elsewhere"],
  ])("explains publication conflict %s", async (code, expected) => {
    publishMock.mockRejectedValue(new SubmissionFeedbackApiError(409, "Conflict", code));
    renderAssistant();
    await waitFor(() => expect(editor().value).toBe(readyDraft.draft_feedback));

    fireEvent.click(screen.getByRole("button", { name: "Post Feedback" }));
    expect(await screen.findByText(new RegExp(expected))).toBeDefined();
  });
});
