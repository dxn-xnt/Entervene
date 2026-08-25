import { describe, expect, it } from "vitest";
import {
  allocateByLargestRemainder,
  buildBloomDrift,
  buildBloomSummary,
  computeTOS,
  validateTOS,
  validateTOSRow,
  type TOSDraft,
} from "./tos-calculator";

describe("tos-calculator: Largest Remainder Method (LRM)", () => {
  it("allocates exactly 40 items across 3 competencies [3, 4, 5 days]", () => {
    // total days = 12, quotas: 3/12*40 = 10, 4/12*40 = 13.3333, 5/12*40 = 16.6666
    const quotas = [(3 / 12) * 40, (4 / 12) * 40, (5 / 12) * 40];
    const alloc = allocateByLargestRemainder(quotas, 40);
    expect(alloc).toEqual([10, 13, 17]);
    expect(alloc.reduce((a, b) => a + b, 0)).toBe(40);
  });

  it("handles the hand-verified edge case: 17 items, 60/30/10 difficulty -> [10, 5, 2]", () => {
    // Easy: 17 * 0.6 = 10.2 -> floor 10, fraction 0.2
    // Average: 17 * 0.3 = 5.1 -> floor 5, fraction 0.1
    // Difficult: 17 * 0.1 = 1.7 -> floor 1, fraction 0.7 (highest remainder)
    // Remainder pool = 1 -> goes to Difficult -> [10, 5, 2] (not 10, 4, 2 or 10, 5, 1)
    const quotas = [10.2, 5.1, 1.7];
    const alloc = allocateByLargestRemainder(quotas, 17);
    expect(alloc).toEqual([10, 5, 2]);
    expect(alloc.reduce((a, b) => a + b, 0)).toBe(17);
  });

  it("breaks ties in favor of earlier listed indices (or priority)", () => {
    // All have equal fractional remainder 0.5
    // Remainder pool = 1 -> goes to index 0
    const quotas = [1.5, 1.5, 1.5];
    const alloc = allocateByLargestRemainder(quotas, 4);
    expect(alloc).toEqual([2, 1, 1]);
  });
});

describe("tos-calculator: computeTOS full pipeline", () => {
  const draft: Omit<TOSDraft, "rows" | "grand_total"> = {
    subject_id: 1,
    subject_name: "Mathematics 10",
    title: "1st Quarter Exam",
    quarter: "Q1",
    test_parts: [
      { type: "MULTIPLE_CHOICE", count: 20 },
      { type: "TRUE_FALSE", count: 10 },
      { type: "IDENTIFICATION", count: 10 },
    ],
    total_items: 40,
    competencies: [
      { label: "Competency A", code: "M10-A", days: 3 },
      { label: "Competency B", code: "M10-B", days: 4 },
      { label: "Competency C", code: "M10-C", days: 5 },
    ],
    difficulty_ratio: {
      easy: 0.6,
      average: 0.3,
      difficult: 0.1,
    },
  };

  it("computes row allocations and grand totals accurately", () => {
    const { rows, grand_total } = computeTOS(draft);

    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.items)).toEqual([10, 13, 17]);
    expect(grand_total.items).toBe(40);

    // Grand total difficulty: 40 * 0.6 = 24, 40 * 0.3 = 12, 40 * 0.1 = 4
    expect(grand_total.easy).toBe(24);
    expect(grand_total.average).toBe(12);
    expect(grand_total.difficult).toBe(4);

    // Sum of row difficulties matches grand totals
    const sumEasy = rows.reduce((s, r) => s + r.easy, 0);
    const sumAvg = rows.reduce((s, r) => s + r.average, 0);
    const sumDiff = rows.reduce((s, r) => s + r.difficult, 0);
    expect(sumEasy).toBe(24);
    expect(sumAvg).toBe(12);
    expect(sumDiff).toBe(4);

    // Placement is sequential and cumulative
    expect(rows[0].item_start).toBe(1);
    expect(rows[0].item_end).toBe(10);
    expect(rows[1].item_start).toBe(11);
    expect(rows[1].item_end).toBe(23);
    expect(rows[2].item_start).toBe(24);
    expect(rows[2].item_end).toBe(40);

    // Step I: Type allocation sums across rows match test part totals
    const sumMC = rows.reduce((s, r) => s + (r.type_counts.MULTIPLE_CHOICE || 0), 0);
    const sumTF = rows.reduce((s, r) => s + (r.type_counts.TRUE_FALSE || 0), 0);
    const sumID = rows.reduce((s, r) => s + (r.type_counts.IDENTIFICATION || 0), 0);
    expect(sumMC).toBe(20);
    expect(sumTF).toBe(10);
    expect(sumID).toBe(10);
  });

  it("splits Bloom taxonomy levels correctly (odd leftovers go to earlier levels)", () => {
    const { rows } = computeTOS(draft);

    for (const r of rows) {
      expect(r.remember + r.understand).toBe(r.easy);
      expect(r.apply + r.analyze).toBe(r.average);
      expect(r.evaluate + r.create_).toBe(r.difficult);

      if (r.easy % 2 !== 0) {
        expect(r.remember).toBe(r.understand + 1);
      } else {
        expect(r.remember).toBe(r.understand);
      }
    }
  });

  it("validates valid draft with 0 errors", () => {
    const { rows, grand_total } = computeTOS(draft);
    const fullDraft: TOSDraft = {
      ...draft,
      rows,
      grand_total,
    };
    const val = validateTOS(fullDraft);
    expect(val.valid).toBe(true);
    expect(val.errors).toHaveLength(0);
  });
});

describe("tos-calculator: validateTOSRow and Bloom drift", () => {
  it("validates row against reconciled targets", () => {
    const draft: Omit<TOSDraft, "rows" | "grand_total"> = {
      subject_id: 1,
      subject_name: "Science 9",
      title: "Quarterly Exam",
      quarter: "Q1",
      test_parts: [{ type: "MULTIPLE_CHOICE", count: 10 }],
      total_items: 10,
      competencies: [{ label: "Comp 1", days: 5 }],
      difficulty_ratio: { easy: 0.6, average: 0.3, difficult: 0.1 },
    };

    const { rows } = computeTOS(draft);
    const row = rows[0];

    const resultValid = validateTOSRow(row);
    expect(resultValid.isValid).toBe(true);
    expect(resultValid.band_errors).toHaveLength(0);

    // Mismatched edit
    const alteredRow = { ...row, easy: row.easy + 1 };
    const resultInvalid = validateTOSRow(alteredRow);
    expect(resultInvalid.isValid).toBe(false);
    expect(resultInvalid.band_errors.length).toBeGreaterThan(0);
  });

  it("builds Bloom summary and drift correctly", () => {
    const questions = [
      { cognitive_level: "REMEMBER" },
      { cognitive_level: "REMEMBER" },
      { cognitive_level: "APPLY" },
    ];
    const summary = buildBloomSummary(questions);
    expect(summary).toEqual({
      REMEMBER: 2,
      UNDERSTAND: 0,
      APPLY: 1,
      ANALYZE: 0,
      EVALUATE: 0,
      CREATE: 0,
    });

    const target = {
      REMEMBER: 1,
      UNDERSTAND: 1,
      APPLY: 1,
      ANALYZE: 0,
      EVALUATE: 0,
      CREATE: 0,
    };

    const drift = buildBloomDrift(summary, target);
    expect(drift.REMEMBER).toBe(1);
    expect(drift.UNDERSTAND).toBe(-1);
    expect(drift.APPLY).toBe(0);
  });
});
