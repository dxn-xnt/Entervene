import { describe, expect, it } from "vitest";
import type { CurrentProjectionSummary, PeriodOutcome } from "@/lib/prediction-api";
import { getCurrentProjectionAction } from "./prediction-status-copy";
import { resolveUnifiedStatus } from "./projected-final-grade-panel";

function currentProjection(overrides: Partial<CurrentProjectionSummary>): CurrentProjectionSummary {
  return {
    purpose: "UNIFIED_CURRENT_TERM_PROJECTION",
    latest_prediction_id: null,
    predicted_grade: null,
    risk_level: null,
    risk_score: null,
    data_status: null,
    risk_assessment_status: "NOT_EVALUATED_FOR_UNIFIED_MODEL",
    evidence_readiness: { level: "STANDARD_READY", ready: true, reasons: [] },
    projection_freshness: { status: "NO_PROJECTION", reasons: [] },
    model_currency: { status: "CURRENT" },
    refresh_eligibility: { status: "ELIGIBLE", eligible: true, reasons: [] },
    domain_warnings: [],
    ...overrides,
  };
}

const inProgress: PeriodOutcome = { status: "IN_PROGRESS", actual_grade: null };
const finalized: PeriodOutcome = { status: "FINALIZED", actual_grade: 88 };

describe("getCurrentProjectionAction", () => {
  it("allows generate only for no projection with backend eligibility", () => {
    expect(getCurrentProjectionAction(currentProjection({}), inProgress)).toBe("GENERATE");
  });

  it("uses refresh for existing projections when backend eligibility is true", () => {
    expect(
      getCurrentProjectionAction(
        currentProjection({
          latest_prediction_id: 10,
          predicted_grade: 86.4,
          projection_freshness: { status: "FRESHNESS_UNAVAILABLE", reasons: [] },
        }),
        inProgress
      )
    ).toBe("REFRESH");
  });

  it("does not allow actions after finalization", () => {
    expect(getCurrentProjectionAction(currentProjection({}), finalized)).toBe("NONE");
  });

  it("does not allow generate when a projection exists even if grade is null", () => {
    expect(
      getCurrentProjectionAction(
        currentProjection({
          latest_prediction_id: 11,
          predicted_grade: null,
          projection_freshness: { status: "CURRENT", reasons: [] },
        }),
        inProgress
      )
    ).toBe("REFRESH");
  });
});

describe("resolveUnifiedStatus", () => {
  it("returns Insufficient Evidence for Term 1 / not ready without projection", () => {
    const res = resolveUnifiedStatus(
      currentProjection({
        latest_prediction_id: null,
        predicted_grade: null,
        evidence_readiness: { level: "INSUFFICIENT_EVIDENCE", ready: false, reasons: ["More graded activities are needed"] },
      }),
      inProgress
    );
    expect(res.status).toBe("Insufficient Evidence");
    expect(res.explanation).toBe("More graded activities are needed before a projection can be generated.");
  });

  it("returns Ready for valid Unified prediction", () => {
    const res = resolveUnifiedStatus(
      currentProjection({
        latest_prediction_id: 42,
        predicted_grade: 88.5,
        projection_freshness: { status: "CURRENT", reasons: [] },
      }),
      inProgress
    );
    expect(res.status).toBe("Ready");
    expect(res.explanation).toBe("Based on available academic evidence.");
  });

  it("returns Update Available when new academic evidence is recorded", () => {
    const res = resolveUnifiedStatus(
      currentProjection({
        latest_prediction_id: 42,
        predicted_grade: 88.5,
        projection_freshness: { status: "SOURCE_EVIDENCE_CHANGED", reasons: [] },
      }),
      inProgress
    );
    expect(res.status).toBe("Update Available");
    expect(res.explanation).toBe("New academic evidence is available. Refresh to update the projection.");
  });

  it("returns Unsupported for MAPEH or unsupported domains", () => {
    const res = resolveUnifiedStatus(
      currentProjection({
        domain_warnings: [{ code: "DOMAIN_UNSUPPORTED", message: "Unified V2 does not support MAPEH." }],
      }),
      inProgress
    );
    expect(res.status).toBe("Unsupported");
    expect(res.explanation).toBe("Prediction is currently unavailable for this subject.");
    expect(res.isUnsupported).toBe(true);
  });

  it("returns Finalized when period outcome is finalized", () => {
    const res = resolveUnifiedStatus(
      currentProjection({
        latest_prediction_id: 42,
        predicted_grade: 88.5,
      }),
      finalized
    );
    expect(res.status).toBe("Finalized");
    expect(res.explanation).toBe("This grading period is finalized. The official final grade is the primary academic result.");
  });
});
