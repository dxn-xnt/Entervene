import { describe, expect, it } from "vitest";
import { formSnapshot, optionalNumber, unorderedValues } from "./form-changes";

describe("persisted form comparisons", () => {
  it("ignores object property order and equivalent empty optional values", () => {
    expect(formSnapshot({ name: "Math", notes: undefined })).toBe(formSnapshot({ notes: "", name: "Math" }));
    expect(formSnapshot({ notes: null })).toBe(formSnapshot({ notes: "" }));
  });
  it("compares numbers after API normalization", () => {
    expect(formSnapshot(optionalNumber("20.00"))).toBe(formSnapshot(optionalNumber(20)));
    expect(optionalNumber(0)).toBe(0);
    expect(optionalNumber(" ")).toBeNull();
  });
  it("ignores selection order only when explicitly requested", () => {
    expect(formSnapshot(unorderedValues([2, 1]))).toBe(formSnapshot(unorderedValues([1, 2])));
    expect(formSnapshot([2, 1])).not.toBe(formSnapshot([1, 2]));
  });
  it("detects changes and reversions, including removals and additions", () => {
    const baseline = formSnapshot({ title: "Math", files: [1] });
    expect(formSnapshot({ title: "Maths", files: [1] })).not.toBe(baseline);
    expect(formSnapshot({ title: "Math", files: [] })).not.toBe(baseline);
    expect(formSnapshot({ title: "Math", files: [1, 2] })).not.toBe(baseline);
    expect(formSnapshot({ title: "Math", files: [1] })).toBe(baseline);
  });
});
