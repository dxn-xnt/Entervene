import { describe, expect, it } from "vitest";

import {
  legacyQuizReleaseSettings,
  quizResultsReleasePolicyFromLegacy,
} from "./quiz-results-release";

describe("unified quiz results release policy", () => {
  it.each([
    [false, false, "IMMEDIATE"],
    [true, false, "IMMEDIATE"],
    [false, true, "AFTER_DUE_DATE"],
    [true, true, "NEVER"],
  ] as const)("fails legacy visibility closed", (scores, answers, mode) => {
    expect(quizResultsReleasePolicyFromLegacy(scores, answers, mode)).toBe("HIDDEN");
  });

  it("maps every explicit teacher option to compatible legacy fields", () => {
    expect(legacyQuizReleaseSettings("HIDDEN")).toEqual({
      showResults: false,
      mode: "NEVER",
      scheduledAt: "",
    });
    expect(legacyQuizReleaseSettings("IMMEDIATE").showResults).toBe(true);
    expect(legacyQuizReleaseSettings("AFTER_DUE_DATE").mode).toBe("AFTER_DUE_DATE");
    expect(legacyQuizReleaseSettings("SCHEDULED", "2026-11-30T09:00")).toEqual({
      showResults: true,
      mode: "SCHEDULED",
      scheduledAt: "2026-11-30T09:00",
    });
  });

  it("keeps scheduled selected so a missing date can be corrected in the form", () => {
    expect(quizResultsReleasePolicyFromLegacy(true, true, "SCHEDULED", "")).toBe("SCHEDULED");
  });
});
