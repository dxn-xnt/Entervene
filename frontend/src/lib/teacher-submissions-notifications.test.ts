import { describe, expect, it } from "vitest";
import {
  formatSubmissionDate,
  formatSubmissionDescription,
  formatSubmissionTitle,
  generateInitialMockSubmissions,
  isAllowedSubmissionClassworkType,
  isSubmissionAwaitingGrading,
  upsertSubmissionNotification,
  type IncomingSubmissionPayload,
  type SubmissionNotificationItem,
} from "./teacher-submissions-notifications";

describe("Teacher Submissions Notifications", () => {
  describe("Scope constraint", () => {
    it("allows assignment, activity, and intervention types", () => {
      expect(isAllowedSubmissionClassworkType("assignment")).toBe(true);
      expect(isAllowedSubmissionClassworkType("activity")).toBe(true);
      expect(isAllowedSubmissionClassworkType("intervention")).toBe(true);
      expect(isAllowedSubmissionClassworkType(" Assignment ")).toBe(true);
    });

    it("excludes quizzes, exams, announcements, and materials", () => {
      expect(isAllowedSubmissionClassworkType("quiz")).toBe(false);
      expect(isAllowedSubmissionClassworkType("exam")).toBe(false);
      expect(isAllowedSubmissionClassworkType("announcement")).toBe(false);
      expect(isAllowedSubmissionClassworkType("material")).toBe(false);
      expect(isAllowedSubmissionClassworkType(undefined)).toBe(false);
    });
  });

  describe("Templates constraint", () => {
    it("formats singular title and description when count is 1", () => {
      const title = formatSubmissionTitle("Mathematics 7", "Linear Equations", 1);
      expect(title).toBe("Mathematics 7: Linear Equations - 1 new submission");

      const desc = formatSubmissionDescription(1, "2026-11-21T09:15:00Z");
      expect(desc).toBe("1 new student classwork submission needs to be graded as of Nov 21, 2026");
    });

    it("formats plural title and description when count is greater than 1", () => {
      const title = formatSubmissionTitle("Mathematics 7", "Linear Equations", 3);
      expect(title).toBe("Mathematics 7: Linear Equations - 3 new submissions");

      const desc = formatSubmissionDescription(3, "2026-11-22T14:30:00Z");
      expect(desc).toBe("3 new student classwork submissions needs to be graded as of Nov 22, 2026");
    });

    it("formats dates in MMM D, YYYY format", () => {
      expect(formatSubmissionDate("2026-11-05T00:00:00Z")).toBe("Nov 5, 2026");
      expect(formatSubmissionDate("2026-11-23T12:00:00Z")).toBe("Nov 23, 2026");
    });
  });

  describe("One notification per classwork constraint", () => {
    it("creates a single notification on first submission", () => {
      const initial: SubmissionNotificationItem[] = [];
      const event: IncomingSubmissionPayload = {
        subject: { id: "sub-1", name: "Science 7" },
        classwork: { id: "cw-1", title: "Lab 1", type: "activity" },
        submittedCount: 1,
        gradedCount: 0,
        latestSubmissionAt: "2026-11-20T10:00:00Z",
      };

      const result = upsertSubmissionNotification(initial, event);
      expect(result).toHaveLength(1);
      expect(result[0].classwork.id).toBe("cw-1");
      expect(result[0].title).toBe("Science 7: Lab 1 - 1 new submission");
      expect(result[0].is_read).toBe(false);
    });

    it("updates existing notification instead of creating a duplicate when a new submission arrives", () => {
      const initial: SubmissionNotificationItem[] = [];
      const event1: IncomingSubmissionPayload = {
        subject: { id: "sub-1", name: "Science 7" },
        classwork: { id: "cw-1", title: "Lab 1", type: "activity" },
        submittedCount: 1,
        gradedCount: 0,
        latestSubmissionAt: "2026-11-20T10:00:00Z",
      };

      const step1 = upsertSubmissionNotification(initial, event1);
      expect(step1).toHaveLength(1);

      // Simulate the teacher having read the notification
      step1[0].is_read = true;

      // Second submission arrives for the same classwork cw-1
      const event2: IncomingSubmissionPayload = {
        subject: { id: "sub-1", name: "Science 7" },
        classwork: { id: "cw-1", title: "Lab 1", type: "activity" },
        submittedCount: 2,
        gradedCount: 0,
        latestSubmissionAt: "2026-11-22T14:00:00Z",
      };

      const step2 = upsertSubmissionNotification(step1, event2);
      expect(step2).toHaveLength(1); // STILL EXACTLY ONE NOTIFICATION!
      expect(step2[0].submittedCount).toBe(2);
      expect(step2[0].title).toBe("Science 7: Lab 1 - 2 new submissions");
      expect(step2[0].body).toBe("2 new student classwork submissions needs to be graded as of Nov 22, 2026");
      // Must be marked unread again
      expect(step2[0].is_read).toBe(false);
      expect(step2[0].latestSubmissionAt).toBe("2026-11-22T14:00:00Z");
    });

    it("ignores excluded classwork types during upsert", () => {
      const initial: SubmissionNotificationItem[] = [];
      const event: IncomingSubmissionPayload = {
        subject: { id: "sub-1", name: "Science 7" },
        classwork: { id: "cw-quiz", title: "Quiz 1", type: "quiz" },
        submittedCount: 5,
        gradedCount: 0,
        latestSubmissionAt: "2026-11-20T10:00:00Z",
      };

      const result = upsertSubmissionNotification(initial, event);
      expect(result).toHaveLength(0);
    });
  });

  describe("Removal when no submissions remain to be graded", () => {
    it("reports awaiting grading when ungraded > 0", () => {
      const item: SubmissionNotificationItem = {
        notification_id: "test-1",
        type: "submission",
        notification_type: "submission",
        subject: { id: "sub-1", name: "English" },
        classwork: { id: "cw-1", title: "Essay", type: "assignment" },
        submittedCount: 3,
        gradedCount: 1,
        totalStudents: 30,
        lateCount: 0,
        latestSubmissionAt: "2026-11-20T10:00:00Z",
        title: "English: Essay - 2 new submissions",
        body: "2 new student classwork submissions needs to be graded as of Nov 20, 2026",
        action_url: "/teacher/classworks/cw-1",
        is_read: false,
        created_at: "2026-11-20T10:00:00Z",
        read_at: null,
      };

      expect(isSubmissionAwaitingGrading(item)).toBe(true);
    });

    it("reports not awaiting grading (resolved / removed from tab) when all submitted are graded", () => {
      const item: SubmissionNotificationItem = {
        notification_id: "test-2",
        type: "submission",
        notification_type: "submission",
        subject: { id: "sub-1", name: "English" },
        classwork: { id: "cw-1", title: "Essay", type: "assignment" },
        submittedCount: 3,
        gradedCount: 3,
        totalStudents: 30,
        lateCount: 0,
        latestSubmissionAt: "2026-11-20T10:00:00Z",
        title: "English: Essay - 0 new submissions",
        body: "0 new student classwork submissions needs to be graded as of Nov 20, 2026",
        action_url: "/teacher/classworks/cw-1",
        is_read: false,
        created_at: "2026-11-20T10:00:00Z",
        read_at: null,
      };

      expect(isSubmissionAwaitingGrading(item)).toBe(false);
    });
  });

  describe("Initial mock dataset validation", () => {
    it("generates mock submissions conforming to all constraints", () => {
      const mockList = generateInitialMockSubmissions();

      // cw-104 (quiz) must be filtered out completely
      expect(mockList.find((n) => n.classwork.id === "cw-104")).toBeUndefined();

      // cw-101 received 2 events, but must only have 1 notification with updated count = 3
      const cw101Items = mockList.filter((n) => n.classwork.id === "cw-101");
      expect(cw101Items).toHaveLength(1);
      expect(cw101Items[0].submittedCount).toBe(3);
      expect(cw101Items[0].title).toBe("Mathematics 7: Linear Equations Worksheet - 3 new submissions");

      // cw-102 (activity) must have count = 1 singular
      const cw102 = mockList.find((n) => n.classwork.id === "cw-102");
      expect(cw102).toBeDefined();
      expect(cw102?.title).toBe("Science 7: Plant and Animal Cells Diagram - 1 new submission");

      // cw-103 (intervention) must be present
      const cw103 = mockList.find((n) => n.classwork.id === "cw-103");
      expect(cw103).toBeDefined();
      expect(cw103?.classwork.type).toBe("intervention");

      // Items awaiting grading
      const active = mockList.filter(isSubmissionAwaitingGrading);
      // cw-105 is fully graded, so it must not be in active
      expect(active.find((n) => n.classwork.id === "cw-105")).toBeUndefined();
    });
  });
});
