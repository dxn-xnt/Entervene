import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("./api", () => ({ apiFetch: mocks.apiFetch }));

import {
  CurrentTermPredictionLoadError,
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

  it.each([404, 503])("reports unavailable for a stable read response %s", async (status) => {
    vi.stubEnv("DEV", false);
    mocks.apiFetch.mockResolvedValue({ ok: false, status, json: async () => ({}) });

    const error = await fetchCurrentTermPredictions(params, "teacher").catch((cause) => cause);

    expect(error).toBeInstanceOf(CurrentTermPredictionLoadError);
    expect(error.kind).toBe("unavailable");
  });
});
