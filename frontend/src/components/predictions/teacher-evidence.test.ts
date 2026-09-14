import { describe, expect, it } from "vitest";
import { EVIDENCE_GROUPS, evidenceRowsForGroup } from "./teacher-evidence";
import type { TeacherPredictionEvidence } from "@/lib/prediction-api";

const completion: TeacherPredictionEvidence = {
  feature_name: "assessment_completion_rate", display_name: "Activities completed", description: "",
  category: "ACTIVITY_PROGRESS", value: 0, unit: "PERCENTAGE", value_scale: "ZERO_TO_ONE",
  evidence_state: "AVAILABLE", numerator: 0, denominator: 10, formatted_value: "0 of 10 · 0%",
  source_description: "Classwork — Term 1", usage_description: "Used to check whether enough evidence was available.",
};

describe("teacher evidence grouping", () => {
  it("keeps a genuine zero as provided by the API", () => {
    const group = EVIDENCE_GROUPS.find((item) => item.title === "Activities & submissions")!;
    expect(evidenceRowsForGroup([completion], group)[0].formatted_value).toBe("0 of 10 · 0%");
  });

  it("does not place internal or prediction-output fields into a teacher group", () => {
    const internal = { ...completion, feature_name: "subject_SCIENCE", category: "GRADE" as const };
    const visible = [completion];
    expect(EVIDENCE_GROUPS.flatMap((group) => evidenceRowsForGroup(visible, group))).toEqual(visible);
    expect(internal.feature_name).not.toBe("predicted_period_grade");
  });
});
