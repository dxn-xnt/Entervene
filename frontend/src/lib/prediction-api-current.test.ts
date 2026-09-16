import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";
import {
  fetchDualPurposeRosterStatus,
  generateCurrentProjection,
  refreshPrediction,
} from "./prediction-api";

vi.mock("./api", () => ({
  apiFetch: vi.fn(),
}));

const mockedApiFetch = vi.mocked(apiFetch);

function okJson(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  } as Response);
}

function roster(current: Record<string, unknown>) {
  return {
    class_context: {
      class_id: 1,
      class_name: "8-Plato",
      subject_id: 3,
      subject_name: "Creative Technology",
      academic_period_id: 2,
      period_label: "Term 2",
      academic_year_id: 1,
      next_period_status: "AVAILABLE",
      teacher: null,
    },
    total: 1,
    students: [
      {
        student: {
          student_id: "00000000-0000-0000-0000-000000000001",
          student_name: "Learner One",
          student_lrn: "LRN-1",
        },
        period_outcome: { status: "IN_PROGRESS", actual_grade: null },
        baseline_forecast: {
          purpose: "NEXT_PERIOD_BASELINE_FORECAST",
          status: "NO_BASELINE",
          latest_prediction_id: null,
          predicted_grade: null,
          risk_assessment_status: null,
        },
        current_projection: {
          purpose: "CURRENT_PERIOD_FINAL_GRADE_PROJECTION",
          domain_warnings: [],
          ...current,
        },
        primary_display: current.latest_prediction_id ? "CURRENT_PROJECTION" : "NONE",
      },
    ],
  };
}

describe("current projection API lifecycle", () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it("supports roster NO_PROJECTION -> generate -> roster current -> stale -> refresh -> successor revision", async () => {
    mockedApiFetch
      .mockImplementationOnce(() =>
        okJson(
          roster({
            latest_prediction_id: null,
            predicted_grade: null,
            projection_freshness: { status: "NO_PROJECTION", reasons: [] },
            refresh_eligibility: { status: "ELIGIBLE", eligible: true, reasons: [] },
            evidence_readiness: { level: "STANDARD_READY", ready: true, reasons: [] },
          })
        )
      )
      .mockImplementationOnce(() =>
        okJson({
          generation_status: "CREATED",
          ready: true,
          readiness_level: "STANDARD_READY",
          prediction_mode: "CURRENT_PERIOD_FINAL_GRADE_PROJECTION",
          prediction_id: 101,
          latest_prediction_id: 101,
          revision: 1,
          predicted_period_grade: 86,
          risk_level: null,
          risk_score: null,
          data_status: null,
          risk_assessment_status: "NOT_EVALUATED_FOR_CURRENT_PERIOD_MODEL",
          reasons: [],
          warnings: [],
        })
      )
      .mockImplementationOnce(() =>
        okJson(
          roster({
            latest_prediction_id: 101,
            revision: 1,
            predicted_grade: 86,
            projection_freshness: { status: "CURRENT", reasons: [] },
            refresh_eligibility: { status: "NOT_ELIGIBLE", eligible: false, reasons: [] },
            evidence_readiness: { level: "STANDARD_READY", ready: true, reasons: [] },
          })
        )
      )
      .mockImplementationOnce(() =>
        okJson(
          roster({
            latest_prediction_id: 101,
            revision: 1,
            predicted_grade: 86,
            projection_freshness: { status: "SOURCE_EVIDENCE_CHANGED", reasons: [] },
            refresh_eligibility: { status: "ELIGIBLE", eligible: true, reasons: [] },
            evidence_readiness: { level: "HIGH_EVIDENCE", ready: true, reasons: [] },
          })
        )
      )
      .mockImplementationOnce(() =>
        okJson({
          generation_status: "CREATED",
          ready: true,
          readiness_level: "HIGH_EVIDENCE",
          prediction_mode: "CURRENT_PERIOD_FINAL_GRADE_PROJECTION",
          prediction_id: 102,
          latest_prediction_id: 102,
          revision: 2,
          predicted_period_grade: 87.5,
          risk_level: null,
          risk_score: null,
          data_status: null,
          risk_assessment_status: "NOT_EVALUATED_FOR_CURRENT_PERIOD_MODEL",
          reasons: [],
          warnings: [],
        })
      )
      .mockImplementationOnce(() =>
        okJson(
          roster({
            latest_prediction_id: 102,
            revision: 2,
            predicted_grade: 87.5,
            projection_freshness: { status: "CURRENT", reasons: [] },
            refresh_eligibility: { status: "NOT_ELIGIBLE", eligible: false, reasons: [] },
            evidence_readiness: { level: "HIGH_EVIDENCE", ready: true, reasons: [] },
          })
        )
      );

    const firstRoster = await fetchDualPurposeRosterStatus({
      class_id: 1,
      subject_id: 3,
      academic_period_id: 2,
    });
    expect(firstRoster.students[0].current_projection.latest_prediction_id).toBeNull();
    expect(firstRoster.students[0].current_projection.projection_freshness?.status).toBe("NO_PROJECTION");

    const created = await generateCurrentProjection({
      student_id: "00000000-0000-0000-0000-000000000001",
      class_id: 1,
      subject_id: 3,
      academic_period_id: 2,
      generation_request_id: "generate-key-1",
    });
    expect(created.generation_status).toBe("CREATED");
    expect(created.revision).toBe(1);

    const currentRoster = await fetchDualPurposeRosterStatus({
      class_id: 1,
      subject_id: 3,
      academic_period_id: 2,
    });
    expect(currentRoster.students[0].current_projection.latest_prediction_id).toBe(101);
    expect(currentRoster.students[0].current_projection.projection_freshness?.status).toBe("CURRENT");

    const staleRoster = await fetchDualPurposeRosterStatus({
      class_id: 1,
      subject_id: 3,
      academic_period_id: 2,
    });
    expect(staleRoster.students[0].current_projection.projection_freshness?.status).toBe("SOURCE_EVIDENCE_CHANGED");

    const refreshed = await refreshPrediction(101, { generation_request_id: "refresh-key-1" });
    expect(refreshed.generation_status).toBe("CREATED");
    expect(refreshed.revision).toBe(2);

    const successorRoster = await fetchDualPurposeRosterStatus({
      class_id: 1,
      subject_id: 3,
      academic_period_id: 2,
    });
    expect(successorRoster.students[0].current_projection.latest_prediction_id).toBe(102);
    expect(successorRoster.students[0].current_projection.revision).toBe(2);

    expect(mockedApiFetch).toHaveBeenNthCalledWith(
      2,
      "/api/v1/predictions/unified/generate",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("generate-key-1"),
      })
    );
    expect(mockedApiFetch).toHaveBeenNthCalledWith(
      5,
      "/api/v1/predictions/101/refresh",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("refresh-key-1"),
      })
    );
  });
});
