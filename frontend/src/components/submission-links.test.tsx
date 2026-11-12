// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import SubmissionForm from "./submission-form";
import SubmissionViewer from "./submission-viewer";
import SubmissionLinkList from "./submission-link-list";
import StudentSubmissionView from "@/pages/teacher/student-submission-view";
import { isDisplayableSubmission } from "@/lib/student-submission";

vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => <button type="button">Menu</button> }));

afterEach(cleanup);

describe("student link submission", () => {
  it("submits a link without files and preserves an optional title", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SubmissionForm assignmentId={1} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit link" }));
    fireEvent.change(screen.getByLabelText("Link 1 URL"), { target: { value: "https://docs.google.com/document/d/work" } });
    fireEvent.change(screen.getByLabelText("Title (optional)"), { target: { value: "My draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Assignment" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith([], [{ url: "https://docs.google.com/document/d/work", title: "My draft" }]));
  });

  it("keeps file-only and mixed submissions available", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<SubmissionForm assignmentId={1} onSubmit={onSubmit} />);
    const file = new File(["%PDF"], "work.pdf", { type: "application/pdf" });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Assignment" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith([file], []));
    rerender(<SubmissionForm assignmentId={1} onSubmit={onSubmit} />);
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Submit link" }));
    fireEvent.change(screen.getByLabelText("Link 1 URL"), { target: { value: "https://github.com/example/work" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Assignment" }));
    await waitFor(() => expect(onSubmit).toHaveBeenLastCalledWith([file], [{ url: "https://github.com/example/work", title: null }]));
  });

  it("adds and removes multiple links and validates unsafe URLs", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SubmissionForm assignmentId={1} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit link" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit link" }));
    expect(screen.getByLabelText("Link 2 URL")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]);
    expect(screen.queryByLabelText("Link 2 URL")).toBeNull();
    fireEvent.change(screen.getByLabelText("Link 1 URL"), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Assignment" }));
    expect(screen.getByRole("alert").textContent).toContain("valid HTTP or HTTPS URL");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows saved link-only work and keeps a pending link draft visible", () => {
    const link = { submission_link_id: 9, url: "https://youtube.com/watch?v=test", title: "Video", position: 0 };
    expect(isDisplayableSubmission({ submission_id: 1, status: "pending", attempt_count: 1, attachments: [], links: [link] })).toBe(true);
    const { container } = render(<SubmissionViewer submission={{ submission_id: 1, status: "submitted", attempt_count: 1, attachments: [], links: [link] }} />);
    expect(screen.getByText("Video")).toBeTruthy();
    const anchor = container.querySelector('a[href="https://youtube.com/watch?v=test"]');
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("never makes an unsafe stored URL clickable", () => {
    const { container } = render(<SubmissionLinkList links={[{ submission_link_id: 1, url: "javascript:alert(1)", position: 0 }]} />);
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText("This link cannot be opened.")).toBeTruthy();
  });

  it("renders a submitted title as text, not HTML", () => {
    const title = '<img src=x onerror=alert(1)>';
    const { container } = render(<SubmissionLinkList links={[{
      submission_link_id: 2, url: "https://example.com/work", title, position: 0,
    }]} />);
    expect(screen.getByText(title)).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });
});

it("shows a teacher link-only submission beside the existing grade action", () => {
  const link = { submission_link_id: 7, url: "https://example.com/work", title: "Project", position: 0 };
  render(<MemoryRouter><StudentSubmissionView
    selectedStudent={{ student_id: "s", student_name: "Demo Student", status: "submitted" } as never}
    selected={{ classwork_id: 1, title: "Assignment", classwork_type: "ASSIGNMENT", total_points: 100 } as never}
    selectedSubmissionDetail={{ submission_id: 2, student_id: "s", classwork_assignment_id: 1, status: "submitted", feedback_fingerprint: "x".repeat(64), attachments: [], links: [link], total_points: 100 }}
    isSubmissionLoading={false}
    submissionDetailError=""
    gradeDraft=""
    feedbackDraft=""
    gradeError=""
    isPostingGrade={false}
    onClose={() => {}}
    onGradeChange={() => {}}
    onFeedbackChange={() => {}}
    onPostGrade={() => {}}
    onOpenQuizGrading={() => {}}
  /></MemoryRouter>);
  expect(screen.getByText("Project")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Post Grade" })).toBeTruthy();
});
