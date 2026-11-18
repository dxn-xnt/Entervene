import { describe, expect, it } from "vitest";
import { eligibleRemediationLessonIds, type RemediationGenerationEligibility } from "./teacher-interventions-api";

const eligibility: RemediationGenerationEligibility = {
  original_evidence_cutoff_at: "2026-11-18T12:09:44.114810+00:00",
  active_remediation_cutoff_at: "2026-11-18T12:09:44.114810+00:00",
  refresh_available: true,
  eligible_taught_lessons: [{ lesson_id: 37, title: "Eligible" }],
  blocked_lessons: [{ lesson_id: 36, title: "Blocked", reason_code: "REMEDIATION_EVIDENCE_REFRESH_REQUIRED" }],
  evidence_version: 0,
  evidence_provenance: "VERSIONED_VERIFIED_LESSON_DELIVERY",
};

describe("eligibleRemediationLessonIds", () => {
  it("submits only backend-authorized lessons and excludes blocked lessons", () => {
    expect(eligibleRemediationLessonIds(eligibility)).toEqual([37]);
  });

  it("disables generation when the backend reports no eligible lessons", () => {
    expect(eligibleRemediationLessonIds({ ...eligibility, eligible_taught_lessons: [] })).toEqual([]);
  });
});
