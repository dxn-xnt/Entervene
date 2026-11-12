import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api";
import {
  generateSubmissionFeedbackSuggestion,
  getSubmissionFeedbackEligibility,
  publishSubmissionFeedback,
  SubmissionFeedbackApiError,
} from "./submission-feedback-api";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

const apiFetchMock = vi.mocked(apiFetch);

describe("submission feedback API", () => {
  beforeEach(() => apiFetchMock.mockReset());

  it("uses the server eligibility endpoint before generation", async () => {
    apiFetchMock.mockResolvedValue(new Response(JSON.stringify({
      submission_id: 41,
      eligible: true,
      answer_release_authorized: true,
      code: null,
      message: null,
    }), { status: 200 }));

    await getSubmissionFeedbackEligibility(41);

    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/submissions/41/feedback/eligibility");
  });

  it("generates through the suggestion endpoint without a grade payload", async () => {
    apiFetchMock.mockResolvedValue(new Response(JSON.stringify({ feedback: "Suggestion" }), { status: 200 }));

    await generateSubmissionFeedbackSuggestion(41);

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/v1/submissions/41/feedback/suggestion",
      { method: "POST" },
    );
  });

  it("publishes only approved feedback and the two server fingerprints", async () => {
    const payload = {
      feedback: "Teacher-approved wording.",
      expected_evidence_fingerprint: "a".repeat(64),
      expected_feedback_fingerprint: "b".repeat(64),
    };
    apiFetchMock.mockResolvedValue(new Response(JSON.stringify({
      submission_id: 41,
      feedback: payload.feedback,
      evidence_fingerprint: payload.expected_evidence_fingerprint,
      feedback_fingerprint: "c".repeat(64),
    }), { status: 200 }));

    await publishSubmissionFeedback(41, payload);

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/v1/submissions/41/feedback",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    expect(JSON.parse(String(apiFetchMock.mock.calls[0][1]?.body))).not.toHaveProperty("grade");
  });

  it("preserves structured 409 codes for release and stale-state UX", async () => {
    apiFetchMock.mockResolvedValue(new Response(JSON.stringify({
      detail: { code: "FEEDBACK_COMMENT_STALE", message: "Existing feedback changed" },
    }), { status: 409 }));

    await expect(publishSubmissionFeedback(41, {
      feedback: "Approved",
      expected_evidence_fingerprint: "a".repeat(64),
      expected_feedback_fingerprint: "b".repeat(64),
    })).rejects.toMatchObject<Partial<SubmissionFeedbackApiError>>({
      status: 409,
      code: "FEEDBACK_COMMENT_STALE",
      message: "Existing feedback changed",
    });
  });
});
