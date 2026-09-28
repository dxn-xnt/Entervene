import { expect, it } from "vitest";
import { categoryFromFocus, focusGuidance, supportedRemediationCompetencies } from "./remediation-authoring";
import type { RemediationFocus } from "./teacher-interventions-api";

const focus = (component: RemediationFocus["component"], exam_subtype: RemediationFocus["exam_subtype"] = null): RemediationFocus => ({
  basis: "FROZEN_TRIGGER_DIAGNOSIS", evidence_level: "COMPONENT_ONLY", component,
  exam_subtype, exam_subtype_requires_confirmation: component === "EXAMINATION" && !exam_subtype,
  lesson_ids: [], lessons: [], competency_ids: [], competencies: [], topics: [],
  source_classwork_ids: [], question_evidence: [], coverage_is_context_only: false,
});

it("maps only the evidence-derived component and never invents a subtype", () => {
  expect(categoryFromFocus(focus("WRITTEN_WORK"))).toBe("WRITTEN_WORK");
  expect(categoryFromFocus(focus("PERFORMANCE_TASK"))).toBe("PERFORMANCE_TASK");
  expect(categoryFromFocus(focus("EXAMINATION"))).toBe("QUARTERLY_ASSESSMENT");
  expect(focus("EXAMINATION").exam_subtype).toBeNull();
  expect(focus("EXAMINATION", "TERM_EXAM").exam_subtype).toBe("TERM_EXAM");
});

it("uses only supported detail in Quiz, TOS, and Classwork guidance", () => {
  expect(focusGuidance(focus("EXAMINATION"))).toMatch(/No specific topic or competency weakness/);
  const scored = { ...focus("WRITTEN_WORK"), evidence_level: "QUESTION_SCORE" as const,
    lessons: [{ id: 3, title: "Fractions" }], competencies: [{ id: 4, label: "Add fractions" }] };
  expect(focusGuidance(scored)).toContain("Add fractions; Fractions");
  const coverage = { ...scored, evidence_level: "ACTIVITY_COVERAGE" as const };
  expect(focusGuidance(coverage)).toContain("No individual topic score is available");
});

it("limits TOS prefilled competencies to scored evidence, including an empty focus", () => {
  const items = [{ competency_id: 1 }, { competency_id: 2 }];
  expect(supportedRemediationCompetencies(items, focus("EXAMINATION"))).toEqual([]);
  expect(supportedRemediationCompetencies(items, { ...focus("WRITTEN_WORK"), competency_ids: [2] })).toEqual([items[1]]);
  expect(supportedRemediationCompetencies(items, null)).toEqual(items);
});
