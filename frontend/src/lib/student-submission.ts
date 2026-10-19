import type { Submission } from "@/pages/student/subjects-view/types";

export function isDisplayableSubmission(submission: Submission): boolean {
  return submission.status !== "pending" || submission.attachments.length > 0;
}
