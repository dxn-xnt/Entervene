import { afterEach, describe, expect, it, vi } from "vitest";
import { developmentPredictionsAvailable, generateDevelopmentCurrentTermPrediction } from "./prediction-api";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ apiFetch }));

const scope = { student_id: "student-1", class_id: 7, subject_id: 5, source_period_id: 3 };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("development prediction API guard", () => {
  it("stays unavailable without the explicit flag or outside development", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_ENABLE_DEVELOPMENT_PREDICTIONS", "false");
    expect(developmentPredictionsAvailable("admin")).toBe(false);
    await expect(generateDevelopmentCurrentTermPrediction(scope, "admin")).rejects.toThrow("unavailable");
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_ENABLE_DEVELOPMENT_PREDICTIONS", "true");
    expect(developmentPredictionsAvailable("admin")).toBe(false);
    await expect(generateDevelopmentCurrentTermPrediction(scope, "admin")).rejects.toThrow("unavailable");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rejects teacher and anonymous callers before HTTP", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_ENABLE_DEVELOPMENT_PREDICTIONS", "true");
    for (const role of ["teacher", null]) {
      expect(developmentPredictionsAvailable(role)).toBe(false);
      await expect(generateDevelopmentCurrentTermPrediction(scope, role)).rejects.toThrow("unavailable");
    }
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("sends only scope IDs for an enabled admin", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_ENABLE_DEVELOPMENT_PREDICTIONS", "true");
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({ persisted: true, projected_final_term_grade: 89.69 }) });
    expect(developmentPredictionsAvailable("admin")).toBe(true);
    const result = await generateDevelopmentCurrentTermPrediction(scope, "admin");
    expect(result.projected_final_term_grade).toBe(89.69);
    expect(apiFetch).toHaveBeenCalledWith("/api/v1/development/current-term-predictions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scope),
    });
  });
});
