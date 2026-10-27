import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMyActiveIntervention,
  getMyResolvedIntervention,
  listInterventionReadingReviews,
  listMyActiveInterventions,
  listMyResolvedInterventions,
  reviewInterventionReading,
  type StudentPersistentIntervention,
  type StudentPreparationProgress,
  type StudentReadingReviewResponse,
  type StudentRequiredReading,
  type StudentRequiredReadingIssue,
  type StudentSupportActivity,
} from "./student-persistent-interventions-api";
import * as apiModule from "@/lib/api";

describe("Student Persistent Interventions API & Contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("TypeScript Contract & Payload Validation", () => {
    it("validates a locked remediation activity contract", () => {
      const lockedActivity: StudentSupportActivity = {
        assignment_id: 101,
        title: "Targeted Remedial Quiz: Quadratic Equations",
        classwork_type: "QUIZ",
        submission_status: null,
        grade: null,
        total_points: 10,
        access_state: "PREPARATION_REQUIRED",
        access_enforced: true,
        prerequisite_code: "PREPARATION_REQUIRED",
        prerequisite_message: "Required Reading preparation is incomplete (0 of 2 completed).",
        preparation: {
          state: "NOT_STARTED",
          is_satisfied: false,
          completed_count: 0,
          required_count: 2,
          accessible_count: 2,
          unavailable_count: 0,
          summary: "0 of 2 completed",
        },
        readings: [
          {
            classwork_id: 201,
            title: "Quadratic Formula Guide",
            assignment_id: 301,
            order: 1,
            completion_status: "NOT_STARTED",
            focused_seconds: 0,
            completed_at: null,
          },
          {
            classwork_id: 202,
            title: "Factoring Review Notes",
            assignment_id: 302,
            order: 2,
            completion_status: "NOT_STARTED",
            focused_seconds: 0,
            completed_at: null,
          },
        ],
      };

      expect(lockedActivity.access_state).toBe("PREPARATION_REQUIRED");
      expect(lockedActivity.access_enforced).toBe(true);
      expect(lockedActivity.preparation?.is_satisfied).toBe(false);
      expect(lockedActivity.readings).toHaveLength(2);
      expect(lockedActivity.readings[0].completion_status).toBe("NOT_STARTED");
      expect(lockedActivity.readings[1].order).toBe(2);
    });

    it("validates a ready remediation activity contract", () => {
      const readyActivity: StudentSupportActivity = {
        assignment_id: 102,
        title: "Targeted Remedial Quiz: Factoring",
        classwork_type: "QUIZ",
        submission_status: null,
        grade: null,
        total_points: 20,
        access_state: "READY",
        access_enforced: true,
        prerequisite_code: "PREPARATION_COMPLETE",
        prerequisite_message: "Required Reading preparation is complete (2 of 2 completed).",
        preparation: {
          state: "COMPLETE",
          is_satisfied: true,
          completed_count: 2,
          required_count: 2,
          accessible_count: 2,
          unavailable_count: 0,
          summary: "2 of 2 completed",
        },
        readings: [
          {
            classwork_id: 201,
            title: "Quadratic Formula Guide",
            assignment_id: 301,
            order: 1,
            completion_status: "COMPLETED",
            focused_seconds: 145,
            completed_at: "2026-10-27T10:00:00Z",
          },
          {
            classwork_id: 202,
            title: "Factoring Review Notes",
            assignment_id: 302,
            order: 2,
            completion_status: "COMPLETED",
            focused_seconds: 210,
            completed_at: "2026-10-27T10:05:00Z",
          },
        ],
      };

      expect(readyActivity.access_state).toBe("READY");
      expect(readyActivity.access_enforced).toBe(true);
      expect(readyActivity.preparation?.is_satisfied).toBe(true);
      expect(readyActivity.readings.every((r) => r.completion_status === "COMPLETED")).toBe(true);
      expect(readyActivity.readings[0].completed_at).toBe("2026-10-27T10:00:00Z");
      expect(readyActivity.readings[1].focused_seconds).toBe(210);
    });

    it("validates a historical activity without snapshot contract", () => {
      const historicalActivity: StudentSupportActivity = {
        assignment_id: 103,
        title: "Legacy Remedial Worksheet",
        classwork_type: "ASSIGNMENT",
        submission_status: "submitted",
        grade: 85,
        total_points: 100,
        access_state: "HISTORICAL",
        access_enforced: false,
        prerequisite_code: "PREREQUISITE_SNAPSHOT_MISSING",
        prerequisite_message: "Historical activity without snapshot.",
        preparation: null,
        readings: [],
      };

      expect(historicalActivity.access_state).toBe("HISTORICAL");
      expect(historicalActivity.access_enforced).toBe(false);
      expect(historicalActivity.prerequisite_code).toBe("PREREQUISITE_SNAPSHOT_MISSING");
      expect(historicalActivity.readings).toEqual([]);
      expect(historicalActivity.preparation).toBeNull();
    });

    it("validates multiple activities under one intervention with independent Readings", () => {
      const intervention: StudentPersistentIntervention = {
        intervention_id: 501,
        status: "ACTIVE",
        subject_id: 12,
        subject_name: "Mathematics",
        class_id: 4,
        class_name: "Grade 10 - Newton",
        teacher_name: "Maria Santos",
        required_readings: [
          {
            classwork_id: 201,
            title: "Plan Reading (Not directly tied to activities)",
            assignment_id: 301,
            order: 1,
            completion_status: "NOT_STARTED",
            focused_seconds: 0,
            completed_at: null,
          },
        ],
        resource_issues: [],
        preparation: {
          state: "NOT_STARTED",
          is_satisfied: false,
          completed_count: 0,
          required_count: 1,
          accessible_count: 1,
          unavailable_count: 0,
          summary: "0 of 1 completed",
        },
        activities: [
          {
            assignment_id: 111,
            title: "Quiz 1: Polynomials",
            classwork_type: "QUIZ",
            submission_status: null,
            grade: null,
            total_points: 15,
            access_state: "READY",
            access_enforced: true,
            prerequisite_code: "PREPARATION_COMPLETE",
            prerequisite_message: "Preparation complete.",
            preparation: {
              state: "COMPLETE",
              is_satisfied: true,
              completed_count: 1,
              required_count: 1,
              accessible_count: 1,
              unavailable_count: 0,
              summary: "1 of 1 completed",
            },
            readings: [
              {
                classwork_id: 210,
                title: "Reading A for Quiz 1",
                assignment_id: 310,
                order: 1,
                completion_status: "COMPLETED",
                focused_seconds: 120,
                completed_at: "2026-10-27T08:00:00Z",
              },
            ],
          },
          {
            assignment_id: 112,
            title: "Quiz 2: Factoring",
            classwork_type: "QUIZ",
            submission_status: null,
            grade: null,
            total_points: 20,
            access_state: "PREPARATION_REQUIRED",
            access_enforced: true,
            prerequisite_code: "PREPARATION_REQUIRED",
            prerequisite_message: "Preparation incomplete.",
            preparation: {
              state: "NOT_STARTED",
              is_satisfied: false,
              completed_count: 0,
              required_count: 2,
              accessible_count: 2,
              unavailable_count: 0,
              summary: "0 of 2 completed",
            },
            readings: [
              {
                classwork_id: 221,
                title: "Reading B for Quiz 2",
                assignment_id: 321,
                order: 1,
                completion_status: "NOT_STARTED",
                focused_seconds: 0,
                completed_at: null,
              },
              {
                classwork_id: 222,
                title: "Reading C for Quiz 2",
                assignment_id: 322,
                order: 2,
                completion_status: "NOT_STARTED",
                focused_seconds: 0,
                completed_at: null,
              },
            ],
          },
        ],
        reviewer_id: 99,
        resolved_at: null,
        resolution_message: null,
      };

      expect(intervention.activities).toHaveLength(2);
      const [act1, act2] = intervention.activities;

      // Activity 1 is READY and has its own readings list
      expect(act1.access_state).toBe("READY");
      expect(act1.readings).toHaveLength(1);
      expect(act1.readings[0].title).toBe("Reading A for Quiz 1");

      // Activity 2 is PREPARATION_REQUIRED and has completely independent readings
      expect(act2.access_state).toBe("PREPARATION_REQUIRED");
      expect(act2.readings).toHaveLength(2);
      expect(act2.readings[0].title).toBe("Reading B for Quiz 2");
      expect(act2.readings[1].title).toBe("Reading C for Quiz 2");

      // Both are separate from intervention.required_readings
      expect(intervention.required_readings).toHaveLength(1);
      expect(intervention.required_readings[0].title).toBe("Plan Reading (Not directly tied to activities)");
    });

    it("validates missing or inaccessible Reading resources contract", () => {
      const issue: StudentRequiredReadingIssue = {
        resource_id: 999,
        order: 2,
        reason: "INACCESSIBLE",
      };

      const blockedPreparation: StudentPreparationProgress = {
        state: "BLOCKED",
        is_satisfied: false,
        completed_count: 0,
        required_count: 2,
        accessible_count: 1,
        unavailable_count: 1,
        summary: "1 of 2 reading resources unavailable.",
      };

      const blockedActivity: StudentSupportActivity = {
        assignment_id: 104,
        title: "Targeted Remedial Activity with Inaccessible Resource",
        classwork_type: "QUIZ",
        submission_status: null,
        grade: null,
        total_points: 10,
        access_state: "PREPARATION_REQUIRED",
        access_enforced: true,
        prerequisite_code: "PREPARATION_BLOCKED",
        prerequisite_message: "Required Reading resources are missing or inaccessible.",
        preparation: blockedPreparation,
        readings: [
          {
            classwork_id: 201,
            title: "Public Available Reading",
            assignment_id: 301,
            order: 1,
            completion_status: "NOT_STARTED",
            focused_seconds: 0,
            completed_at: null,
          },
        ],
      };

      expect(issue.reason).toBe("INACCESSIBLE");
      expect(blockedActivity.preparation?.state).toBe("BLOCKED");
      expect(blockedActivity.preparation?.unavailable_count).toBe(1);
      expect(blockedActivity.readings).toHaveLength(1);
      expect(blockedActivity.readings[0].title).toBe("Public Available Reading");
    });

    it("validates existing resolved intervention data contract", () => {
      const resolvedIntervention: StudentPersistentIntervention = {
        intervention_id: 601,
        status: "RESOLVED",
        subject_id: 15,
        subject_name: "General Chemistry",
        class_id: 5,
        class_name: "Grade 11 - Mendeleev",
        teacher_name: "Albert Einstein",
        required_readings: [],
        resource_issues: [],
        preparation: {
          state: "COMPLETE",
          is_satisfied: true,
          completed_count: 3,
          required_count: 3,
          accessible_count: 3,
          unavailable_count: 0,
          summary: "3 of 3 completed",
        },
        activities: [
          {
            assignment_id: 115,
            title: "Periodic Trends Quiz",
            classwork_type: "QUIZ",
            submission_status: "graded",
            grade: 95,
            total_points: 100,
            access_state: "HISTORICAL",
            access_enforced: false,
            prerequisite_code: "INTERVENTION_RESOLVED",
            prerequisite_message: null,
            preparation: null,
            readings: [],
          },
        ],
        reviewer_id: 12,
        resolved_at: "2026-10-25T16:45:00Z",
        resolution_message: "Learner successfully completed all remediation goals and demonstrated mastery.",
      };

      expect(resolvedIntervention.status).toBe("RESOLVED");
      expect(resolvedIntervention.resolved_at).toBe("2026-10-25T16:45:00Z");
      expect(resolvedIntervention.resolution_message).toContain("mastery");
      expect(resolvedIntervention.activities[0].access_state).toBe("HISTORICAL");
      expect(resolvedIntervention.activities[0].access_enforced).toBe(false);
      expect(resolvedIntervention.activities[0].prerequisite_code).toBe("INTERVENTION_RESOLVED");
      expect(resolvedIntervention.activities[0].readings).toEqual([]);
    });
  });

  describe("API Client Endpoints", () => {
    it("listMyActiveInterventions calls GET /api/v1/student/interventions and returns items", async () => {
      const mockPayload = {
        items: [
          {
            intervention_id: 1,
            status: "ACTIVE",
            subject_id: 10,
            subject_name: "Science",
            class_id: 2,
            class_name: "Class 10-A",
            teacher_name: "Teacher Jane",
            required_readings: [],
            resource_issues: [],
            preparation: {
              state: "NOT_CONFIGURED" as const,
              is_satisfied: false,
              completed_count: 0,
              required_count: 0,
              accessible_count: 0,
              unavailable_count: 0,
              summary: "0 of 0 completed",
            },
            activities: [],
            reviewer_id: null,
            resolved_at: null,
            resolution_message: null,
          },
        ],
      };

      vi.spyOn(apiModule, "apiFetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockPayload,
      } as Response);

      const result = await listMyActiveInterventions();
      expect(apiModule.apiFetch).toHaveBeenCalledWith("/api/v1/student/interventions");
      expect(result.items).toHaveLength(1);
      expect(result.items[0].intervention_id).toBe(1);
    });

    it("getMyActiveIntervention calls GET /api/v1/student/interventions/:id", async () => {
      const mockDetail: StudentPersistentIntervention = {
        intervention_id: 42,
        status: "ACTIVE",
        subject_id: 10,
        subject_name: "Science",
        class_id: 2,
        class_name: "Class 10-A",
        teacher_name: "Teacher Jane",
        required_readings: [],
        resource_issues: [],
        preparation: {
          state: "NOT_CONFIGURED",
          is_satisfied: false,
          completed_count: 0,
          required_count: 0,
          accessible_count: 0,
          unavailable_count: 0,
          summary: "0 of 0 completed",
        },
        activities: [],
        reviewer_id: null,
        resolved_at: null,
        resolution_message: null,
      };

      vi.spyOn(apiModule, "apiFetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockDetail,
      } as Response);

      const result = await getMyActiveIntervention(42);
      expect(apiModule.apiFetch).toHaveBeenCalledWith("/api/v1/student/interventions/42");
      expect(result.intervention_id).toBe(42);
    });

    it("listMyResolvedInterventions calls GET /api/v1/student/interventions/resolved", async () => {
      const mockPayload = { items: [] };

      vi.spyOn(apiModule, "apiFetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockPayload,
      } as Response);

      const result = await listMyResolvedInterventions();
      expect(apiModule.apiFetch).toHaveBeenCalledWith("/api/v1/student/interventions/resolved");
      expect(result.items).toEqual([]);
    });

    it("getMyResolvedIntervention calls GET /api/v1/student/interventions/resolved/:id", async () => {
      const mockResolved: StudentPersistentIntervention = {
        intervention_id: 77,
        status: "RESOLVED",
        subject_id: 10,
        subject_name: "Science",
        class_id: 2,
        class_name: "Class 10-A",
        teacher_name: "Teacher Jane",
        required_readings: [],
        resource_issues: [],
        preparation: {
          state: "COMPLETE",
          is_satisfied: true,
          completed_count: 1,
          required_count: 1,
          accessible_count: 1,
          unavailable_count: 0,
          summary: "1 of 1 completed",
        },
        activities: [],
        reviewer_id: null,
        resolved_at: "2026-10-20T12:00:00Z",
        resolution_message: "Resolved",
      };

      vi.spyOn(apiModule, "apiFetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockResolved,
      } as Response);

      const result = await getMyResolvedIntervention(77);
      expect(apiModule.apiFetch).toHaveBeenCalledWith("/api/v1/student/interventions/resolved/77");
      expect(result.intervention_id).toBe(77);
    });

    it("throws an error when response is not ok", async () => {
      vi.spyOn(apiModule, "apiFetch").mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await expect(listMyActiveInterventions()).rejects.toThrow("Unable to load your active support.");
    });

    it("reviewInterventionReading calls POST /api/v1/student/interventions/:id/readings/:assignId/review", async () => {
      const mockResponse: StudentReadingReviewResponse = {
        review_id: 101,
        intervention_id: 7,
        reading_assignment_id: 16,
        assignment_id: 16,
        student_id: "550e8400-e29b-41d4-a716-446655440000",
        review_status: "REVIEWED",
        reviewed_at: "2026-10-27T12:00:00Z",
        acknowledged_at: "2026-10-27T12:00:00Z",
      };

      vi.spyOn(apiModule, "apiFetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await reviewInterventionReading(7, 16);
      expect(apiModule.apiFetch).toHaveBeenCalledWith(
        "/api/v1/student/interventions/7/readings/16/review",
        { method: "POST" },
      );
      expect(result.review_status).toBe("REVIEWED");
      expect(result.review_id).toBe(101);
    });

    it("reviewInterventionReading throws custom detail when review fails", async () => {
      vi.spyOn(apiModule, "apiFetch").mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ detail: "Reading is not part of this intervention" }),
      } as Response);

      await expect(reviewInterventionReading(7, 999)).rejects.toThrow(
        "Reading is not part of this intervention",
      );
    });

    it("listInterventionReadingReviews calls GET /api/v1/student/interventions/:id/reviews", async () => {
      const mockReviews: StudentReadingReviewResponse[] = [
        {
          review_id: 101,
          intervention_id: 7,
          reading_assignment_id: 16,
          assignment_id: 16,
          student_id: "550e8400-e29b-41d4-a716-446655440000",
          review_status: "REVIEWED",
          reviewed_at: "2026-10-27T12:00:00Z",
          acknowledged_at: "2026-10-27T12:00:00Z",
        },
      ];

      vi.spyOn(apiModule, "apiFetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockReviews,
      } as Response);

      const result = await listInterventionReadingReviews(7);
      expect(apiModule.apiFetch).toHaveBeenCalledWith(
        "/api/v1/student/interventions/7/reviews",
      );
      expect(result).toHaveLength(1);
      expect(result[0].review_status).toBe("REVIEWED");
    });
  });
});
