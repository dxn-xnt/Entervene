import type { ManualSectionDraft } from "@/types/adminClasses";

export function recommendedTargets(totalStudentCount: number, sections: ManualSectionDraft[]) {
  const baseTarget = sections.length ? Math.floor(totalStudentCount / sections.length) : 0;
  const extraSlots = sections.length ? totalStudentCount % sections.length : 0;
  return Object.fromEntries(sections.map((section, index) => [section.localId, baseTarget + (index < extraSlots ? 1 : 0)]));
}
