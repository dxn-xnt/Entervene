import { describe, expect, it } from "vitest";
import { isTeacherSubmissionNotification } from "./notification-formatting";

describe("isTeacherSubmissionNotification", () => {
  it("identifies historical teacher submission alerts", () => {
    expect(isTeacherSubmissionNotification({
      notification_type: "assignment_due",
      title: "Late Submission: Mathematics - Quiz 1",
    })).toBe(true);
    expect(isTeacherSubmissionNotification({
      notification_type: "intervention_assessment_submitted",
      title: "Intervention Assessment Submitted",
    })).toBe(true);
  });

  it("preserves deadline summaries and student classwork notifications", () => {
    expect(isTeacherSubmissionNotification({
      notification_type: "assignment_due",
      title: "Deadline Summary: Quiz 1",
    })).toBe(false);
    expect(isTeacherSubmissionNotification({
      notification_type: "assignment_due",
      title: "Mathematics: New Classwork",
    })).toBe(false);
  });
});
