// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudentSuggestionHistoryModal } from "./student-suggestion-history-modal";
import type { SuggestionResponse } from "@/types/suggestion";
import type { TeacherAdvisoryStudentItem } from "@/types/adminClasses";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  dismiss: vi.fn(),
  approve: vi.fn(),
  archive: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/suggestion-api", () => ({
  getTeacherSuggestions: api.list,
  dismissSuggestion: api.dismiss,
  approveSuggestion: api.approve,
  archiveSuggestion: api.archive,
}));

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({ success: api.toastSuccess, error: vi.fn() }),
}));

const mockStudent: TeacherAdvisoryStudentItem = {
  student_id: "stud-123",
  student_lrn: "123456789012",
  full_name: "Maria Santos",
  gender: "Female",
  avatar_initial: "M",
  email: "maria@example.com",
  account_status: "ACTIVE",
};

function makeSuggestion(overrides: Partial<SuggestionResponse>): SuggestionResponse {
  return {
    student_suggestion_id: 1,
    suggestion_type: "MANUAL",
    resource_type: "LINK",
    title: "Grammar Practice",
    description: "Read chapter 2",
    priority: "NORMAL",
    status: "ACTIVE",
    is_viewed: false,
    student_id: "stud-123",
    subject_id: 10,
    is_historical: false,
    can_manage: true,
    origin_academic_period_id: 1,
    origin_period_label: "2026-2027 · Q1",
    resource: {
      resource_type: "LINK",
      title: "English Handbook",
      subject_id: 10,
      is_available: true,
      external_url: "https://example.org/english",
    },
    ...overrides,
  };
}

describe("StudentSuggestionHistoryModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue({
      suggestions: [
        makeSuggestion({ student_suggestion_id: 1, title: "Current Grammar", is_historical: false, origin_academic_period_id: 1, can_manage: true, status: "ACTIVE" }),
        makeSuggestion({ student_suggestion_id: 2, title: "Historical Vocabulary", is_historical: true, origin_academic_period_id: 99, can_manage: false, status: "COMPLETED" }),
      ],
    });
    api.dismiss.mockResolvedValue({});
    api.approve.mockResolvedValue({});
    api.archive.mockResolvedValue({});
  });

  afterEach(cleanup);

  it("fetches and displays suggestions grouped by current and previous periods", async () => {
    render(
      <StudentSuggestionHistoryModal
        isOpen={true}
        onClose={vi.fn()}
        classId={5}
        student={mockStudent}
      />,
    );

    expect(await screen.findByText("Suggestion History")).toBeTruthy();
    expect(screen.getByText(/Maria Santos/)).toBeTruthy();
    expect(screen.getByText(/LRN 123456789012/)).toBeTruthy();

    expect(await screen.findByText(/Current Period/i)).toBeTruthy();
    expect(screen.getByText("Current Grammar")).toBeTruthy();

    expect(screen.getByText(/Previous Periods/i)).toBeTruthy();
    expect(screen.getByText("Historical Vocabulary")).toBeTruthy();
    expect(screen.getByText("Read-only")).toBeTruthy();
  });

  it("allows teacher to dismiss an active manageable suggestion", async () => {
    render(
      <StudentSuggestionHistoryModal
        isOpen={true}
        onClose={vi.fn()}
        classId={5}
        student={mockStudent}
      />,
    );

    const dismissBtn = await screen.findByRole("button", { name: /Dismiss/i });
    fireEvent.click(dismissBtn);

    await waitFor(() => {
      expect(api.dismiss).toHaveBeenCalledWith(1);
      expect(api.toastSuccess).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/dismissed/i) }));
    });
  });

  it("allows teacher to approve a draft suggestion", async () => {
    api.list.mockResolvedValue({
      suggestions: [
        makeSuggestion({ student_suggestion_id: 10, title: "Draft Reading", status: "DRAFT", can_manage: true }),
      ],
    });

    render(
      <StudentSuggestionHistoryModal
        isOpen={true}
        onClose={vi.fn()}
        classId={5}
        student={mockStudent}
      />,
    );

    const approveBtn = await screen.findByRole("button", { name: /Approve/i });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(api.approve).toHaveBeenCalledWith(10);
      expect(api.toastSuccess).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/approved/i) }));
    });
  });

  it("renders empty state when student has no suggestions", async () => {
    api.list.mockResolvedValue({ suggestions: [] });

    render(
      <StudentSuggestionHistoryModal
        isOpen={true}
        onClose={vi.fn()}
        classId={5}
        student={mockStudent}
      />,
    );

    expect(await screen.findByText("No Suggestions Yet")).toBeTruthy();
  });
});
