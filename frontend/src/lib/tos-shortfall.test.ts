import { describe, expect, it } from "vitest";
import { computeTOSShortfall } from "./tos-shortfall";

describe("computeTOSShortfall", () => {
  it("sums blueprint rows and counts produced items by their own type", () => {
    expect(computeTOSShortfall([
      { type_counts: { MULTIPLE_CHOICE: 2, TRUE_FALSE: 1 } },
      { type_counts: { MULTIPLE_CHOICE: 1, IDENTIFICATION: 2 } },
    ], [{ question_type: "MULTIPLE_CHOICE" }, { question_type: "IDENTIFICATION" }])).toEqual({
      requested: 6, produced: 2, missing: 4,
      perType: [
        { type: "MULTIPLE_CHOICE", requested: 3, produced: 1, missing: 2 },
        { type: "TRUE_FALSE", requested: 1, produced: 0, missing: 1 },
        { type: "IDENTIFICATION", requested: 2, produced: 1, missing: 1 },
      ],
    });
  });
  it("does not let surplus or unexpected types conceal a shortfall", () => {
    const result = computeTOSShortfall([{ type_counts: { TRUE_FALSE: 1, MULTIPLE_CHOICE: 1 } }], [
      { question_type: "MULTIPLE_CHOICE" }, { question_type: "MULTIPLE_CHOICE" }, { question_type: "UNKNOWN" },
    ]);
    expect(result).toMatchObject({ requested: 2, produced: 3, missing: 1 });
    expect(result.perType.at(-1)).toEqual({ type: "UNKNOWN", requested: 0, produced: 1, missing: 0 });
  });
  it("reports no shortfall for complete or empty exams", () => {
    expect(computeTOSShortfall([], [])).toEqual({ requested: 0, produced: 0, missing: 0, perType: [] });
    expect(computeTOSShortfall([{ type_counts: { ESSAY: 1 } }], [{ question_type: "ESSAY" }]).missing).toBe(0);
  });
});
