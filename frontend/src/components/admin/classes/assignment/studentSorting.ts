import type { ClassAssignmentStudent } from "@/types/adminClasses";

function normalized(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() ?? "";
}

export type AssignmentGenderGroup = "male" | "female";

export function assignmentGenderGroup(gender: string | null): AssignmentGenderGroup {
  const value = normalized(gender);
  if (["male", "m", "boy"].includes(value)) return "male";
  return "female";
}

function genderPriority(gender: string | null) {
  return { male: 0, female: 1 }[assignmentGenderGroup(gender)];
}

export function compareAssignmentStudents(left: ClassAssignmentStudent, right: ClassAssignmentStudent) {
  return genderPriority(left.gender) - genderPriority(right.gender)
    || normalized(left.last_name).localeCompare(normalized(right.last_name))
    || normalized(left.first_name).localeCompare(normalized(right.first_name))
    || normalized(left.middle_name).localeCompare(normalized(right.middle_name))
    || left.student_id.localeCompare(right.student_id);
}

export function sortAssignmentStudents(students: ClassAssignmentStudent[]) {
  return [...students].sort(compareAssignmentStudents);
}

function titleCase(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/(^|[\s'-])\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

export function assignmentStudentName(student: ClassAssignmentStudent) {
  const givenNames = [student.first_name, student.middle_name].filter((value) => value?.trim()).map((value) => titleCase(value!)).join(" ");
  return `${titleCase(student.last_name)}, ${givenNames}`;
}

export function compactAssignmentStudentName(student: ClassAssignmentStudent) {
  const firstInitial = titleCase(student.first_name).charAt(0);
  return `${titleCase(student.last_name)}, ${firstInitial}.`;
}

export function matchesStudentSearch(student: ClassAssignmentStudent, search: string) {
  const query = normalized(search);
  if (!query) return true;
  return [student.first_name, student.middle_name, student.last_name, student.student_lrn]
    .some((value) => normalized(value).includes(query));
}
