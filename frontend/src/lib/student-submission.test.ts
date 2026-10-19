import { describe, expect, it } from "vitest";
import { isDisplayableSubmission } from "./student-submission";
import type { Submission } from "@/pages/student/subjects-view/types";

const submission = {
  submission_id: 1,
  status: "submitted",
  attempt_count: 1,
  attachments: [],
} satisfies Submission;

describe("isDisplayableSubmission", () => {
  it("hides an empty pending record after deletion", () => {
    expect(isDisplayableSubmission({ ...submission, status: "pending" })).toBe(false);
  });

  it("keeps submitted work and drafts with files visible", () => {
    expect(isDisplayableSubmission(submission)).toBe(true);
    expect(isDisplayableSubmission({
      ...submission,
      status: "pending",
      attachments: [{ submission_attachment_id: 2, file_name: "work.pdf", file_size: 12 }],
    })).toBe(true);
  });
});
