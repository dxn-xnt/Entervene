// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SubmissionViewer from "./submission-viewer";

vi.mock("./attachment-display", () => ({ default: () => <div>Submitted file remains visible</div> }));
vi.mock("./submission-link-list", () => ({ default: () => <div>Submitted link remains visible</div> }));

const submission = {
  submission_id: 12,
  status: "graded",
  grade: 21,
  feedback: "Approved score-based teacher feedback.",
  attempt_count: 1,
  attachments: [{ submission_attachment_id: 3, file_name: "work.pdf", file_size: 5 }],
  links: [{ submission_link_id: 4, url: "https://example.test/work", title: "Work", position: 1 }],
};

afterEach(cleanup);

describe("scored non-quiz feedback visibility", () => {
  it("withholds feedback with hidden scores while keeping submitted files and links", () => {
    render(<SubmissionViewer submission={submission} showScores={false} hideFeedbackWithScores />);
    expect(screen.getByText("Hidden")).toBeDefined();
    expect(screen.queryByText(submission.feedback)).toBeNull();
    expect(screen.getByText("Submitted file remains visible")).toBeDefined();
    expect(screen.getByText("Submitted link remains visible")).toBeDefined();
  });

  it("restores approved feedback when scores are released", () => {
    render(<SubmissionViewer submission={submission} showScores hideFeedbackWithScores />);
    expect(screen.getByText(submission.feedback)).toBeDefined();
  });

  it("preserves the existing visibility behavior when the non-quiz policy is not requested", () => {
    render(<SubmissionViewer submission={submission} showScores={false} />);
    expect(screen.getByText(submission.feedback)).toBeDefined();
  });
});
