// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import StudentSubmissionView from "./student-submission-view";
import * as feedbackApi from "@/lib/submission-feedback-api";

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
});

afterEach(() => {
  cleanup();
});

vi.mock("@/lib/submission-feedback-api", () => ({
  deleteSubmissionFeedback: vi.fn(),
  getSubmissionFeedbackDraft: vi.fn().mockResolvedValue({ status: "NONE" }),
  discardSubmissionFeedbackDraft: vi.fn(),
  publishSubmissionFeedback: vi.fn(),
  getSubmissionFeedbackEligibility: vi.fn().mockResolvedValue({ eligible: false }),
}));

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockStudent = {
  student_id: "s-1",
  student_name: "Juan Dela Cruz",
  student_lrn: "123456789012",
  avatar: null,
  status: "submitted",
  grade: 85,
  submitted_at: "2026-11-01T10:00:00Z",
};

const mockClasswork: any = {
  classwork_id: 1,
  title: "Essay Assignment",
  classwork_type: "ASSIGNMENT",
  activity_mode: "ONLINE",
  total_points: 100,
  is_published: true,
  show_scores: true,
  auto_ai_feedback_enabled: false,
};

const mockSubmissionDetail: any = {
  submission_id: 101,
  student_id: "s-1",
  classwork_assignment_id: 1,
  classwork_title: "Essay Assignment",
  status: "graded",
  grade: 85,
  feedback: "Well done on this essay!",
  feedback_fingerprint: "a".repeat(64),
  attachments: [],
  links: [],
};

function renderView(props: any) {
  return render(
    <MemoryRouter>
      <SidebarProvider>
        <StudentSubmissionView {...props} />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe("StudentSubmissionView — Delete Feedback", () => {
  it("renders the Delete Feedback button when published feedback exists", () => {
    renderView({
      selectedStudent: mockStudent,
      selected: mockClasswork,
      selectedSubmissionDetail: mockSubmissionDetail,
      isSubmissionLoading: false,
      submissionDetailError: "",
      gradeDraft: "85",
      feedbackDraft: "Well done on this essay!",
      gradeError: "",
      isPostingGrade: false,
      onClose: vi.fn(),
      onGradeChange: vi.fn(),
      onFeedbackChange: vi.fn(),
      onPostGrade: vi.fn(),
      onOpenQuizGrading: vi.fn(),
      onAiFeedbackPublished: vi.fn(),
      onAiPublishingChange: vi.fn(),
      onAiConflictReload: vi.fn(),
    });

    const deleteBtn = screen.getByTestId("delete-feedback-button");
    expect(deleteBtn).toBeDefined();
    expect(deleteBtn.textContent).toContain("Delete Feedback");
  });

  it("does not render the Delete Feedback button when feedback is null", () => {
    const detailWithoutFeedback = {
      ...mockSubmissionDetail,
      feedback: null,
    };

    renderView({
      selectedStudent: mockStudent,
      selected: mockClasswork,
      selectedSubmissionDetail: detailWithoutFeedback,
      isSubmissionLoading: false,
      submissionDetailError: "",
      gradeDraft: "85",
      feedbackDraft: "",
      gradeError: "",
      isPostingGrade: false,
      onClose: vi.fn(),
      onGradeChange: vi.fn(),
      onFeedbackChange: vi.fn(),
      onPostGrade: vi.fn(),
      onOpenQuizGrading: vi.fn(),
      onAiFeedbackPublished: vi.fn(),
      onAiPublishingChange: vi.fn(),
      onAiConflictReload: vi.fn(),
    });

    expect(screen.queryByTestId("delete-feedback-button")).toBeNull();
  });

  it("opens confirmation dialog and executes deleteSubmissionFeedback on confirm", async () => {
    const onFeedbackChange = vi.fn();
    const onFeedbackDeleted = vi.fn();

    vi.mocked(feedbackApi.deleteSubmissionFeedback).mockResolvedValueOnce({
      submission_id: 101,
      message: "Feedback deleted successfully",
      feedback: null,
      feedback_fingerprint: "0".repeat(64),
    });

    renderView({
      selectedStudent: mockStudent,
      selected: mockClasswork,
      selectedSubmissionDetail: mockSubmissionDetail,
      isSubmissionLoading: false,
      submissionDetailError: "",
      gradeDraft: "85",
      feedbackDraft: "Well done on this essay!",
      gradeError: "",
      isPostingGrade: false,
      onClose: vi.fn(),
      onGradeChange: vi.fn(),
      onFeedbackChange: onFeedbackChange,
      onPostGrade: vi.fn(),
      onOpenQuizGrading: vi.fn(),
      onAiFeedbackPublished: vi.fn(),
      onAiPublishingChange: vi.fn(),
      onAiConflictReload: vi.fn(),
      onFeedbackDeleted: onFeedbackDeleted,
    });

    const deleteBtn = screen.getByTestId("delete-feedback-button");
    fireEvent.click(deleteBtn);

    // Dialog should appear
    expect(screen.getByText("Delete Published Feedback")).toBeDefined();
    expect(
      screen.getByText(/The student's score and grade will remain unchanged/),
    ).toBeDefined();

    // Click confirm in the dialog
    const confirmBtn = screen.getByRole("button", { name: "Delete Feedback" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(feedbackApi.deleteSubmissionFeedback).toHaveBeenCalledWith(
        101,
        "a".repeat(64),
      );
      expect(onFeedbackChange).toHaveBeenCalledWith("");
      expect(onFeedbackDeleted).toHaveBeenCalled();
    });
  });
});
