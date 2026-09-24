// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import DeadlineSummaryModal from "./deadline-summary-modal";
import type { AssignmentTracking } from "@/types/classwork";

const mockTracking: AssignmentTracking = {
  classwork_assignment_id: 1,
  classwork_id: 42,
  classwork_title: "Cell Structure Lab",
  total_students: 4,
  submitted_count: 2,
  missing_count: 2,
  submitted: [
    {
      student_id: "s1",
      student_name: "Alice Guo",
      student_lrn: "100000000001",
      status: "submitted",
      submission_id: 101,
      grade: 95,
      attachment_count: 1,
    },
    {
      student_id: "s2",
      student_name: "Bob Ong",
      student_lrn: "100000000002",
      status: "late",
      submission_id: 102,
      grade: null,
      attachment_count: 1,
      submitted_at: "2026-09-21T10:00:00Z",
    },
  ],
  missing: [
    {
      student_id: "s3",
      student_name: "Charlie Brown",
      student_lrn: "100000000003",
      status: "not_submitted",
      submission_id: null,
      grade: null,
    },
    {
      student_id: "s4",
      student_name: "Diana Prince",
      student_lrn: "100000000004",
      status: "not_submitted",
      submission_id: null,
      grade: null,
    },
  ],
};

describe("DeadlineSummaryModal Component", () => {
  afterEach(cleanup);

  it("renders modal header, counts, and missing students by default", () => {
    const handleClose = vi.fn();
    const handleSelect = vi.fn();

    render(
      <DeadlineSummaryModal
        isOpen={true}
        onClose={handleClose}
        tracking={mockTracking}
        classworkTitle="Cell Structure Lab"
        onSelectStudent={handleSelect}
      />
    );

    expect(screen.getByText("Deadline Summary")).toBeDefined();
    expect(screen.getByText("Missing Submissions")).toBeDefined();
    expect(screen.getByText("Submitted Late")).toBeDefined();

    // Default tab shows Missing students (Charlie Brown, Diana Prince)
    expect(screen.getByText("Charlie Brown")).toBeDefined();
    expect(screen.getByText("Diana Prince")).toBeDefined();

    // Ensure "Send Reminder" button is NOT present (per decision)
    expect(screen.queryByText(/Send Reminder/i)).toBeNull();
  });

  it("switches to late tab and shows late students", () => {
    const handleClose = vi.fn();
    const handleSelect = vi.fn();

    render(
      <DeadlineSummaryModal
        isOpen={true}
        onClose={handleClose}
        tracking={mockTracking}
        classworkTitle="Cell Structure Lab"
        onSelectStudent={handleSelect}
      />
    );

    // Click "Submitted Late" tab
    const lateTab = screen.getByText("Submitted Late").closest("button");
    expect(lateTab).toBeDefined();
    fireEvent.click(lateTab!);

    // Late tab should display Bob Ong (status: late) and NOT Alice Guo (on time)
    expect(screen.getByText("Bob Ong")).toBeDefined();
    expect(screen.queryByText("Alice Guo")).toBeNull();
  });

  it("invokes onSelectStudent when clicking a student card", () => {
    const handleClose = vi.fn();
    const handleSelect = vi.fn();

    render(
      <DeadlineSummaryModal
        isOpen={true}
        onClose={handleClose}
        tracking={mockTracking}
        classworkTitle="Cell Structure Lab"
        onSelectStudent={handleSelect}
      />
    );

    // Click Charlie Brown
    const charlieCard = screen.getByText("Charlie Brown").closest('div[role="button"]');
    expect(charlieCard).toBeDefined();
    fireEvent.click(charlieCard!);

    expect(handleSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        student_id: "s3",
        student_name: "Charlie Brown",
      })
    );
  });

  it("invokes onClose when clicking Dismiss button", () => {
    const handleClose = vi.fn();
    const handleSelect = vi.fn();

    render(
      <DeadlineSummaryModal
        isOpen={true}
        onClose={handleClose}
        tracking={mockTracking}
        classworkTitle="Cell Structure Lab"
        onSelectStudent={handleSelect}
      />
    );

    const dismissBtn = screen.getByText("Dismiss / View Full Roster");
    fireEvent.click(dismissBtn);

    expect(handleClose).toHaveBeenCalled();
  });
});
