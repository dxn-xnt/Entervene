import { describe, expect, it } from "vitest";
import {
  getTeacherRiskDisplay,
  getTeacherRiskFilterCount,
  getTeacherRiskDisplaySummary,
  getTeacherRiskPercentage,
  matchesTeacherRiskFilter,
  TEACHER_RISK_FILTER_OPTIONS,
} from "./teacher-risk-display";

describe("teacher risk display", () => {
  it.each([
    ["HIGH_RISK", "HIGH_RISK", "High Risk"],
    ["MODERATE_RISK", "MODERATE_RISK", "Moderate Risk"],
    ["NEEDS_MONITORING", "ON_TRACK", "On Track"],
    ["LOW_RISK", "ON_TRACK", "On Track"],
    ["INSUFFICIENT_DATA", "INSUFFICIENT_DATA", "Insufficient Data"],
    ["INTERVENTION_NOT_ASSESSED", "NOT_ASSESSED", "Not Assessed"],
  ])("maps %s to %s / %s", (raw, level, label) => {
    expect(getTeacherRiskDisplay(raw)).toEqual({ level, label });
  });

  it("exposes only the simplified assessed options plus insufficient data", () => {
    expect(TEACHER_RISK_FILTER_OPTIONS).toEqual([
      { value: "HIGH_RISK", label: "High Risk" },
      { value: "MODERATE_RISK", label: "Moderate Risk" },
      { value: "ON_TRACK", label: "On Track" },
      { value: "INSUFFICIENT_DATA", label: "Insufficient Data" },
    ]);
  });

  it("matches both original on-track classifications without changing exact filters", () => {
    expect(matchesTeacherRiskFilter("LOW_RISK", "ON_TRACK")).toBe(true);
    expect(matchesTeacherRiskFilter("NEEDS_MONITORING", "ON_TRACK")).toBe(true);
    expect(matchesTeacherRiskFilter("MODERATE_RISK", "ON_TRACK")).toBe(false);
    expect(matchesTeacherRiskFilter("HIGH_RISK", "HIGH_RISK")).toBe(true);
  });

  it("combines only low-risk and monitoring counts", () => {
    const summary = {
      HIGH_RISK: 1,
      MODERATE_RISK: 2,
      NEEDS_MONITORING: 3,
      LOW_RISK: 4,
      INSUFFICIENT_DATA: 5,
      total: 15,
    };
    expect(getTeacherRiskFilterCount(summary, "ON_TRACK")).toBe(7);
    expect(getTeacherRiskFilterCount(summary, "HIGH_RISK")).toBe(1);
    expect(getTeacherRiskFilterCount(summary, "INSUFFICIENT_DATA")).toBe(5);
    expect(getTeacherRiskDisplaySummary(summary)).toEqual({
      MODERATE_RISK: 2,
      HIGH_RISK: 1,
      ON_TRACK: 7,
      NOT_ASSESSED: 5,
      assessedTotal: 10,
      total: 15,
    });
    expect(getTeacherRiskPercentage(7, 10)).toBe(70);
    expect(getTeacherRiskPercentage(0, 0)).toBe(0);
  });
});
