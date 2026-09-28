import type { RemediationFocus } from "@/lib/teacher-interventions-api";

export function categoryFromFocus(focus: RemediationFocus | null): string {
  if (focus?.component === "EXAMINATION") return "QUARTERLY_ASSESSMENT";
  return focus?.component || "WRITTEN_WORK";
}

export function supportedRemediationCompetencies<T extends { competency_id: number }>(items: T[], focus: RemediationFocus | null): T[] {
  return focus ? items.filter((item) => focus.competency_ids.includes(item.competency_id)) : items;
}

export function focusGuidance(focus: RemediationFocus): string {
  const lessons = focus.lessons.map((lesson) => lesson.title).filter(Boolean);
  const competencies = focus.competencies.map((item) => item.label).filter(Boolean);
  if (focus.evidence_level === "QUESTION_SCORE" || focus.evidence_level === "SCORED_COMPETENCY") {
    return [...competencies, ...lessons].join("; ") || "Use the saved scored evidence.";
  }
  if (focus.evidence_level === "ACTIVITY_COVERAGE") {
    return `Assessment coverage for teacher review only: ${[...competencies, ...lessons].join("; ")}. No individual topic score is available.`;
  }
  return `Only ${focus.component?.replaceAll("_", " ") || "component"} level evidence is available. No specific topic or competency weakness is supported.`;
}
