import { describe, expect, it } from "vitest";
import { matchingCandidate, type TeacherInterventionSummary } from "./teacher-interventions-api";
import type { DevelopmentCurrentTermListItem } from "./prediction-api";

const candidate = { intervention_id: 12, status: "CANDIDATE", student_id: "s1", class_id: 7, subject_id: 5, academic_period_id: 3, source_prediction_revision: 2 } as TeacherInterventionSummary;
const prediction = { prediction_id: 42, revision: 3, student_id: "s1", class_id: 7, subject_id: 5, academic_period_id: 3, readiness_status: "READY", projected_final_term_grade: 84 } as DevelopmentCurrentTermListItem;

describe("prediction candidate shortcut", () => {
  it("matches exact scope after a later low-grade revision", () => expect(matchingCandidate(prediction, [candidate])?.intervention_id).toBe(12));
  it("rejects unrelated scope and resolved history", () => {
    expect(matchingCandidate(prediction, [{ ...candidate, subject_id: 6 }])).toBeUndefined();
    expect(matchingCandidate(prediction, [{ ...candidate, status: "RESOLVED" }])).toBeUndefined();
  });
  it("rejects non-ready or improved projections and earlier revisions", () => {
    expect(matchingCandidate({ ...prediction, readiness_status: "INSUFFICIENT_EVIDENCE" }, [candidate])).toBeUndefined();
    expect(matchingCandidate({ ...prediction, projected_final_term_grade: 88 }, [candidate])).toBeUndefined();
    expect(matchingCandidate({ ...prediction, revision: 1 }, [candidate])).toBeUndefined();
  });
});
