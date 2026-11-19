import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import {
  eligibleRemediationLessonIds,
  preflightRemediationDraft,
  createRemediationAssessment,
  generateRemediationDraft,
  type RemediationDraftGenerationRequest,
  type RemediationGenerationEligibility,
} from "./teacher-interventions-api";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

const mockedApiFetch = vi.mocked(apiFetch);

beforeEach(() => mockedApiFetch.mockReset());

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

describe("remediation API routes", () => {
  it("uses the backend's canonical draft-generation endpoint", async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({ title: "Draft" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const payload = {
      draft_format: "QUIZ",
      target_component: "WRITTEN_WORK",
      grade_treatment: "PRACTICE_ONLY",
    } satisfies RemediationDraftGenerationRequest;

    await generateRemediationDraft(42, payload);

    expect(mockedApiFetch).toHaveBeenCalledWith(
      "/api/v1/teacher/interventions/42/remediation/generate-draft",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
  });

  it("sends the explicit original target through AI preflight and creation", async () => {
    mockedApiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ is_valid: true }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ is_published: false }), {
        status: 201, headers: { "Content-Type": "application/json" },
      }));
    const draft = { draft_format: "QUIZ" } as never;

    await preflightRemediationDraft(42, 77, draft);
    await createRemediationAssessment(42, "request-1", 77, draft);

    expect(JSON.parse(String(mockedApiFetch.mock.calls[0][1]?.body))).toMatchObject({
      target_assignment_id: 77,
      validation_stage: "SAVE_DRAFT",
    });
    expect(JSON.parse(String(mockedApiFetch.mock.calls[1][1]?.body))).toMatchObject({
      remediation_request_id: "request-1",
      target_assignment_id: 77,
    });
  });
});
