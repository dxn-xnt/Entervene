import type {
  InterventionRecipientScopes,
  ResourceRecipientScope,
} from "@/lib/teacher-interventions-api";

export const pluralizeCount = (
  count: number,
  singular: string,
  plural: string,
) => `${count} ${count === 1 ? singular : plural}`;

export function formatRecipientScopeSummary(
  scope: ResourceRecipientScope,
  scopes: InterventionRecipientScopes | null | undefined,
  fallbackStudentName: string,
  fallbackClassName: string,
  fallbackSubjectName: string,
): string {
  const studentName = scopes?.this_student.student_name || fallbackStudentName;
  const className = scopes?.entire_class.class_name || fallbackClassName;
  const subjectName =
    scopes?.all_subject_students.subject_name || fallbackSubjectName;

  if (scope === "THIS_STUDENT") {
    return `Assigned to: 1 student (${studentName} in ${className})`;
  }
  if (scope === "ENTIRE_CLASS") {
    if (scopes?.entire_class) {
      return `Assigned to: ${pluralizeCount(scopes.entire_class.student_count, "student", "students")} in ${className}`;
    }
    return `Assigned to: eligible enrolled students in ${className}`;
  }
  if (scopes?.all_subject_students) {
    const { student_count, section_count, class_names } =
      scopes.all_subject_students;
    const sectionDetail =
      class_names.length > 0 ? ` (${class_names.join(", ")})` : "";
    return `Assigned to: ${pluralizeCount(student_count, "student", "students")} across ${pluralizeCount(section_count, "section", "sections")}${sectionDetail}`;
  }
  return `Assigned to: eligible enrolled students across your ${subjectName} sections`;
}

export function formatResourceScopeBadgeLabel(
  scope?: string | null,
): string | null {
  switch (scope) {
    case "THIS_STUDENT":
      return "This student";
    case "ENTIRE_CLASS":
      return null;
    case "ALL_SUBJECT_STUDENTS":
      return "All subject sections";
    case "UNASSIGNED":
      return "Unassigned";
    case "OTHER_RECIPIENTS":
      return "Other recipients";
    default:
      return null;
  }
}
