import { describe, expect, it } from "vitest";
import { computeTOS } from "./tos-calculator";
import { buildTOSGenerationRows, tosGenerationErrorMessage } from "./tos-generation-request";

function blueprint() {
  return computeTOS({
    subject_id: 1, subject_name: "Science", title: "Synthetic", quarter: "Q1", total_items: 2,
    test_parts: [{ type: "MULTIPLE_CHOICE", count: 2 }],
    competencies: [{ label: "A", days: 1 }, { label: "B", days: 5 }, { label: "C", days: 4 }],
    difficulty_ratio: { easy: 0.6, average: 0.3, difficult: 0.1 },
  }).rows;
}
describe("TOS generation request validation", () => {
  it("omits genuinely zero-item rows and preserves all allocated questions", () => {
    const rows = blueprint();
    expect(rows[0].items).toBe(0);
    const request = buildTOSGenerationRows(rows);
    expect(request.map((row) => row.label)).toEqual(["B", "C"]);
    expect(request.reduce((sum, row) => sum + (row.type_counts.MULTIPLE_CHOICE || 0), 0)).toBe(2);
  });
  it("does not silently discard a nonzero row with zero type allocation", () => {
    const row = { ...blueprint()[1], label: "test", items: 2,
      type_counts: { MULTIPLE_CHOICE: 0, TRUE_FALSE: 0, IDENTIFICATION: 0, ESSAY: 0 },
      remember: 1, apply: 1 };
    expect(() => buildTOSGenerationRows([row])).toThrow('Question type counts for "test" total 0, but the blueprint allocates 2 items. Recalculate before generating.');
  });
  it("rejects empty blueprints and retained oversized requests", () => {
    expect(() => buildTOSGenerationRows([])).toThrow("no allocated questions");
    const row = blueprint()[1];
    expect(() => buildTOSGenerationRows([{ ...row, items: 21, type_counts: { MULTIPLE_CHOICE: 21 } }])).toThrow("20 questions per row");
    expect(() => buildTOSGenerationRows(Array.from({ length: 13 }, () => row))).toThrow("12 competency rows");
  });
});
describe("TOS API error formatting", () => {
  it("renders the exact structured 422 shape without [object Object] or raw inputs", () => {
    expect(tosGenerationErrorMessage({ detail: [{ type: "value_error", loc: ["body", "rows", 0],
      msg: "Value error, Each row must request 1 to 20 questions of supported types",
      input: { label: "test" }, ctx: { error: {} } }] })).toBe(
      "body.rows.0: Value error, Each row must request 1 to 20 questions of supported types",
    );
  });
  it("preserves provider errors and combines validation messages", () => {
    expect(tosGenerationErrorMessage({ detail: "AI provider could not complete the request." })).toBe("AI provider could not complete the request.");
    expect(tosGenerationErrorMessage({ detail: [{ msg: "Missing rows" }, { msg: "Invalid label" }] })).toBe("Missing rows; Invalid label");
  });
  it("falls back safely for missing or malformed details", () => {
    for (const data of [null, {}, { detail: {} }, { detail: [] }, { detail: [null, { msg: {} }] }]) {
      expect(tosGenerationErrorMessage(data)).toBe("AI question generation failed. Please retry.");
    }
  });
});
