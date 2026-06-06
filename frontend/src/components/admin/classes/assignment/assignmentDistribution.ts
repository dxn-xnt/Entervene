import type { ClassAssignmentStudent, ManualSectionDraft, StudentAssignmentsBySection } from "@/types/adminClasses";
import { assignmentGenderGroup, sortAssignmentStudents, type AssignmentGenderGroup } from "./studentSorting";

export function recommendedTargets(totalStudentCount: number, sections: ManualSectionDraft[]) {
  const baseTarget = sections.length ? Math.floor(totalStudentCount / sections.length) : 0;
  const extraSlots = sections.length ? totalStudentCount % sections.length : 0;
  return Object.fromEntries(sections.map((section, index) => [section.localId, baseTarget + (index < extraSlots ? 1 : 0)]));
}

export function distributeUnassignedStudents(
  unassignedStudents: ClassAssignmentStudent[],
  assignmentsBySection: StudentAssignmentsBySection,
  sections: ManualSectionDraft[],
): StudentAssignmentsBySection {
  const result = Object.fromEntries(sections.map((section) => [
    section.localId,
    sortAssignmentStudents(assignmentsBySection[section.localId] ?? []),
  ]));

  (["male", "female"] as AssignmentGenderGroup[]).forEach((group) => {
    sortAssignmentStudents(unassignedStudents)
      .filter((student) => assignmentGenderGroup(student.gender) === group)
      .forEach((student) => {
        const target = sections.reduce((best, section) => {
          if (!best) return section;
          const sectionStudents = result[section.localId];
          const bestStudents = result[best.localId];
          const sectionGenderCount = sectionStudents.filter((item) => assignmentGenderGroup(item.gender) === group).length;
          const bestGenderCount = bestStudents.filter((item) => assignmentGenderGroup(item.gender) === group).length;
          if (sectionGenderCount !== bestGenderCount) return sectionGenderCount < bestGenderCount ? section : best;
          return sectionStudents.length < bestStudents.length ? section : best;
        }, null as ManualSectionDraft | null);
        if (target) result[target.localId] = sortAssignmentStudents([...result[target.localId], student]);
      });
  });

  return result;
}
