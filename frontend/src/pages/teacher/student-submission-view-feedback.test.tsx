// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import StudentSubmissionView from "./student-submission-view";
import type { TeacherClasswork, TeacherSubmissionDetail, TrackingStudent } from "@/types/classwork";

const assistantProps = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock("@/components/quiz-feedback-assistant", () => ({
  default: (props: Record<string, unknown>) => {
    assistantProps.current = props;
    return <div data-testid="shared-ai-assistant">AI Feedback Assistant</div>;
  },
}));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("@/components/rubrics-score-board", () => ({ default: () => <div>Original score controls</div> }));
vi.mock("@/components/attachment-display", () => ({ default: () => <div>Original file display</div> }));
vi.mock("@/components/submission-link-list", () => ({ default: () => <div>Original link display</div> }));

const student: TrackingStudent = { student_id: "student-1", student_name: "Demo Learner", status: "graded", submission_id: 41 };
const detail: TeacherSubmissionDetail = {
  submission_id: 41,
  student_id: "student-1",
  classwork_assignment_id: 12,
  status: "graded",
  grade: 0,
  feedback: "Saved teacher comment.",
  feedback_fingerprint: "a".repeat(64),
  submitted_at: "2026-11-14T08:00:00Z",
  attachments: [],
  links: [],
  total_points: 25,
};

function renderView(
  kind: "ASSIGNMENT" | "ACTIVITY" | "READING",
  mode = "ONLINE",
  feedbackDraft = detail.feedback ?? "",
  focusPointsDraft: string[] = [],
  onFocusPointsChange = vi.fn(),
) {
  const onFeedbackChange = vi.fn();
  const onPostGrade = vi.fn();
  const onAiFeedbackPublished = vi.fn();
  const selected = {
    classwork_id: 5,
    title: "Scored classwork",
    classwork_type: kind,
    activity_mode: mode,
    total_points: 25,
    is_published: true,
    show_scores: true,
    is_locked: false,
    is_archived: false,
    subject_id: 2,
    attachments: [],
  } as TeacherClasswork;
  render(
    <MemoryRouter>
      <StudentSubmissionView
        selectedStudent={student}
        selected={selected}
        selectedSubmissionDetail={detail}
        isSubmissionLoading={false}
        submissionDetailError=""
        gradeDraft="0"
        feedbackDraft={feedbackDraft}
        focusPointsDraft={focusPointsDraft}
        onFocusPointsChange={onFocusPointsChange}
        gradeError=""
        isPostingGrade={false}
        onClose={vi.fn()}
        onGradeChange={vi.fn()}
        onFeedbackChange={onFeedbackChange}
        onPostGrade={onPostGrade}
        onOpenQuizGrading={vi.fn()}
        onAiFeedbackPublished={onAiFeedbackPublished}
        onAiPublishingChange={vi.fn()}
        onAiConflictReload={vi.fn().mockResolvedValue(undefined)}
      />
    </MemoryRouter>,
  );
  return { onFeedbackChange, onPostGrade, onAiFeedbackPublished, onFocusPointsChange };
}

afterEach(() => {
  cleanup();
  assistantProps.current = null;
});

describe("teacher scored-classwork grading view", () => {
  it.each(["ASSIGNMENT", "ACTIVITY"] as const)("mounts the shared assistant for a graded %s, including zero", (kind) => {
    const handlers = renderView(kind);
    expect(screen.getByTestId("shared-ai-assistant")).toBeDefined();
    expect(assistantProps.current?.classworkKind).toBe(kind);
    expect(assistantProps.current?.fullyGraded).toBe(true);
    expect(screen.getByText("Original score controls")).toBeDefined();
    expect((screen.getByPlaceholderText("Write constructive feedback for the student...") as HTMLTextAreaElement).value).toBe("Saved teacher comment.");
    fireEvent.click(screen.getByRole("button", { name: "Update Grade" }));
    expect(handlers.onPostGrade).toHaveBeenCalledOnce();
  });

  it("wires the shared AI controls to the single Teacher Feedback editor", () => {
    const handlers = renderView("ASSIGNMENT", "ONLINE", "Unsaved edit.");
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(assistantProps.current?.feedbackDraft).toBe("Unsaved edit.");
    expect(assistantProps.current?.existingFeedback).toBe("Saved teacher comment.");
    act(() => {
      (assistantProps.current?.onFeedbackDraftChange as (value: string) => void)("AI draft text.");
    });
    expect(handlers.onFeedbackChange).toHaveBeenCalledWith("AI draft text.");
  });

  it("keeps grade saving enabled while an AI-generated draft is under review", () => {
    const handlers = renderView("ASSIGNMENT");
    act(() => {
      (assistantProps.current?.onReviewChange as (reviewing: boolean) => void)(true);
    });
    const updateButton = screen.getByRole("button", { name: "Update Grade" }) as HTMLButtonElement;
    expect(updateButton.disabled).toBe(false);
    fireEvent.click(updateButton);
    expect(handlers.onPostGrade).toHaveBeenCalled();
  });

  it.each([["ACTIVITY", "MANUAL"], ["READING", "ONLINE"]] as const)("does not mount for %s in %s mode", (kind, mode) => {
    renderView(kind, mode);
    expect(screen.queryByTestId("shared-ai-assistant")).toBeNull();
  });

  it("renders FeedbackFocusSelector for Assignment and propagates chip toggles", () => {
    const handlers = renderView("ASSIGNMENT", "ONLINE", "", ["STRUCTURE"]);
    expect(screen.getByText("Feedback Focus Points")).toBeDefined();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDefined();

    // Verify Clear Structure chip is checked
    const structureChip = screen.getByRole("checkbox", { name: "Clear Structure" });
    expect(structureChip.getAttribute("aria-checked")).toBe("true");

    // Toggle another strength
    const analysisChip = screen.getByRole("checkbox", { name: "Thorough Analysis" });
    fireEvent.click(analysisChip);
    expect(handlers.onFocusPointsChange).toHaveBeenCalledWith(["STRUCTURE", "ANALYSIS"]);
  });

  it("renders AI-generated draft badge and italicizes textarea when an AI draft is under review", () => {
    renderView("ASSIGNMENT");
    const textarea = screen.getByPlaceholderText("Write constructive feedback for the student...") as HTMLTextAreaElement;
    expect(screen.queryByTestId("feedback-provenance-badge")).toBeNull();
    expect(textarea.className).not.toContain("italic");

    act(() => {
      (assistantProps.current?.onReviewChange as (reviewing: boolean, isTemplate?: boolean) => void)(true, false);
    });

    const badge = screen.getByTestId("feedback-provenance-badge");
    expect(badge.textContent).toContain("AI-generated draft");
    expect(textarea.className).toContain("italic");

    act(() => {
      (assistantProps.current?.onReviewChange as (reviewing: boolean) => void)(false);
    });
    expect(screen.queryByTestId("feedback-provenance-badge")).toBeNull();
    expect(textarea.className).not.toContain("italic");
  });

  it("renders Score-based template badge with standard font when a template draft is under review", () => {
    renderView("ASSIGNMENT");
    const textarea = screen.getByPlaceholderText("Write constructive feedback for the student...") as HTMLTextAreaElement;

    act(() => {
      (assistantProps.current?.onReviewChange as (reviewing: boolean, isTemplate?: boolean) => void)(true, true);
    });

    const badge = screen.getByTestId("feedback-provenance-badge");
    expect(badge.textContent).toBe("Score-based template");
    expect(badge.textContent).not.toContain("AI-generated draft");
    expect(textarea.className).not.toContain("italic");
  });

  it("renders Score-based template badge with policy fallback explanation note", () => {
    renderView("ASSIGNMENT");

    act(() => {
      (assistantProps.current?.onReviewChange as (reviewing: boolean, isTemplate?: boolean, isPolicyFallback?: boolean) => void)(true, true, true);
    });

    const badge = screen.getByTestId("feedback-provenance-badge");
    expect(badge.textContent).toBe("Score-based template");
    const note = screen.getByTestId("policy-fallback-note");
    expect(note.textContent).toContain("Contextual AI disabled by policy");
  });
});
