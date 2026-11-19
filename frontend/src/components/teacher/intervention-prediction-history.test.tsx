// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TeacherInterventionSummary } from "@/lib/teacher-interventions-api";
import { InterventionPredictionHistory } from "./intervention-prediction-history";
import { getTeacherRiskDisplay } from "@/components/predictions/teacher-risk-display";

const item = {
  triggering_predicted_grade: 82.69,
  triggering_intervention_level: "MODERATE_RISK",
  current_predicted_grade: 85.33,
  current_intervention_level: "NEEDS_MONITORING",
  passing_threshold: 85,
} as TeacherInterventionSummary;

afterEach(cleanup);

describe("InterventionPredictionHistory", () => {
  it("shows only the latest prediction state", () => {
    render(<InterventionPredictionHistory item={item} />);

    expect(screen.getByText("85.33")).toBeDefined();
    expect(screen.queryByText("Current:")).toBeNull();
    expect(screen.queryByText("On Track")).toBeNull();
    expect(screen.queryByText("Started:")).toBeNull();
    expect(screen.queryByText("82.69")).toBeNull();
    expect(screen.queryByText(/passing threshold/i)).toBeNull();
  });

  it("does not display passing-threshold messages", () => {
    const below = { ...item, passing_threshold: 87 };
    render(<InterventionPredictionHistory item={below} />);

    expect(screen.getByText("85.33")).toBeDefined();
    expect(screen.queryByText(/passing threshold/i)).toBeNull();
  });
});

describe("teacher risk labels", () => {
  it("maps projected-grade bands at 85 and above to On Track", () => {
    expect(getTeacherRiskDisplay("NEEDS_MONITORING")).toEqual({
      level: "ON_TRACK",
      label: "On Track",
    });
    expect(getTeacherRiskDisplay("LOW_RISK")).toEqual({
      level: "ON_TRACK",
      label: "On Track",
    });
  });
});
