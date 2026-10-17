import type { BatchCreateClassesRequest, ManualAssignmentWorkspaceState, ManualClassSetup } from "@/types/adminClasses";

export function buildBatchCreatePayload(setup: ManualClassSetup, assignmentState: ManualAssignmentWorkspaceState): { ok: true; payload: BatchCreateClassesRequest } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!setup.academicLevelId) errors.push("Select an academic level.");
  if (!setup.sections.length) errors.push("Add at least one section.");

  const sectionNames = new Map<string, string>();
  const adviserIds = new Set<string>();
  const studentIds = new Set<string>();
  const sections = setup.sections.map((section) => {
    const sectionName = section.sectionName.trim();
    const normalizedSectionName = sectionName.toLocaleLowerCase();
    const adviserStaffId = section.adviserStaffId.trim();
    const assignedStudents = assignmentState.assignmentsBySection[section.localId] ?? [];

    if (!sectionName) errors.push("Every section must have a section name.");
    else if (sectionNames.has(normalizedSectionName)) errors.push(`Section name "${sectionName}" is duplicated.`);
    else sectionNames.set(normalizedSectionName, sectionName);

    if (!adviserStaffId) errors.push(`Select an adviser for ${sectionName || "each section"}.`);
    else if (adviserIds.has(adviserStaffId)) errors.push("Each adviser can only be assigned to one submitted section.");
    else adviserIds.add(adviserStaffId);

    const submittedStudentIds = assignedStudents.map((student) => {
      if (!isUuid(student.student_id) || student.student_id === student.student_lrn) {
        errors.push(`${student.first_name} ${student.last_name} is missing a valid student UUID.`);
      }
      if (studentIds.has(student.student_id)) errors.push(`${student.first_name} ${student.last_name} is assigned to more than one section.`);
      studentIds.add(student.student_id);
      return student.student_id;
    });

    return {
      section_name: sectionName,
      adviser_staff_id: adviserStaffId,
      pathway: section.pathway || "general",
      student_ids: submittedStudentIds,
    };
  });

  return errors.length ? { ok: false, errors: [...new Set(errors)] } : { ok: true, payload: { academic_year_id: setup.academicYear.academic_year_id, academic_level_id: setup.academicLevelId, sections } };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
