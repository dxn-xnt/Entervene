import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("./api", () => ({ apiFetch: mocks.apiFetch }));

import {
  CurrentTermPredictionLoadError,
  exportStudentRiskSummaryCSV,
  fetchAdminCurrentTermScope,
  fetchApprovedCurrentTermPredictions,
  fetchCurrentTermPredictions,
} from "./prediction-api";

const params = { class_id: 7, subject_id: 9, academic_period_id: 3 };
const ok = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [], total: 0 }) });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Current-Term prediction read client", () => {
  it("preserves the development GET when the development surface is enabled", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_ENABLE_DEVELOPMENT_PREDICTIONS", "true");
    mocks.apiFetch.mockImplementation(ok);

    await fetchCurrentTermPredictions(params, "teacher");

    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/v1/development/current-term-predictions?class_id=7&subject_id=9&academic_period_id=3",
    );
  });

  it("uses the stable GET outside the development surface", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_ENABLE_DEVELOPMENT_PREDICTIONS", "true");
    mocks.apiFetch.mockImplementation(ok);

    await fetchCurrentTermPredictions(params, "teacher");

    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/v1/current-term-predictions?class_id=7&subject_id=9&academic_period_id=3",
    );
  });

  it("can explicitly read the approved endpoint even when development is enabled", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_ENABLE_DEVELOPMENT_PREDICTIONS", "true");
    mocks.apiFetch.mockImplementation(ok);

    await fetchApprovedCurrentTermPredictions(params);

    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/v1/current-term-predictions?class_id=7&subject_id=9&academic_period_id=3",
    );
  });

  it.each([404, 503])("reports unavailable for a stable read response %s", async (status) => {
    vi.stubEnv("DEV", false);
    mocks.apiFetch.mockResolvedValue({ ok: false, status, json: async () => ({}) });

    const error = await fetchCurrentTermPredictions(params, "teacher").catch((cause) => cause);

    expect(error).toBeInstanceOf(CurrentTermPredictionLoadError);
    expect(error.kind).toBe("unavailable");
  });

  it("loads the Admin scope through a GET for the selected term", async () => {
    mocks.apiFetch.mockImplementation(ok);

    await fetchAdminCurrentTermScope(12);

    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/v1/current-term-predictions/scope?academic_period_id=12",
    );
  });

  it.each([401, 403])("reports Admin scope authorization failures for %s", async (status) => {
    mocks.apiFetch.mockResolvedValue({ ok: false, status, json: async () => ({}) });

    const error = await fetchAdminCurrentTermScope(12).catch((cause) => cause);

    expect(error).toBeInstanceOf(CurrentTermPredictionLoadError);
    expect(error.kind).toBe("access");
  });
});

describe("Student Risk Summary CSV Export API", () => {
  it("calls predictions export-csv with query parameters", async () => {
    const csvContent = "Student LRN,Student Name,Grade Level,Class / Section,Subject,Academic Term,Risk Level,Risk Score,Projected Grade,Attendance Rate,Submission Rate,Primary Risk Indicator,Projection Date\n";
    const headers = new Headers();
    headers.set("content-disposition", 'attachment; filename="Risk_Summary_Emerald_Quarter_1.csv"');

    mocks.apiFetch.mockResolvedValue(
      new Response(csvContent, {
        status: 200,
        headers,
      }),
    );

    const result = await exportStudentRiskSummaryCSV({
      academicPeriodId: 1,
      classId: 10,
      subjectId: 5,
      gradeLevel: 10,
      riskLevel: "HIGH_RISK",
      search: "Ana",
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/v1/predictions/export-csv?academic_period_id=1&class_id=10&subject_id=5&grade_level=10&risk_level=HIGH_RISK&search=Ana",
    );
    expect(result.filename).toBe("Risk_Summary_Emerald_Quarter_1.csv");
    expect(result.blob).toBeDefined();
  });

  it("falls back to default filename when Content-Disposition is missing", async () => {
    mocks.apiFetch.mockResolvedValue(
      new Response("test-csv-content", {
        status: 200,
      }),
    );

    const result = await exportStudentRiskSummaryCSV();

    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/v1/predictions/export-csv");
    expect(result.filename).toBe("Risk_Summary.csv");
  });

  it("throws error with detail message on failed request", async () => {
    mocks.apiFetch.mockResolvedValue(
      new Response(JSON.stringify({ detail: "Access denied. You are not assigned to this class scope." }), {
        status: 403,
      }),
    );

    await expect(exportStudentRiskSummaryCSV({ classId: 999 })).rejects.toThrow(
      "Access denied. You are not assigned to this class scope.",
    );
  });
});

