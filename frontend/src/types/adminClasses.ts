export type ClassStatus = "Active" | "Archived";
export type WizardMode = "choice" | "manual" | "import";
export type DetailTab = "classes" | "students" | "subjects";
export type GradeFilter = "All" | "Grade 7" | "Grade 8" | "Grade 9" | "Grade 10" | "Grade 11" | "Grade 12";
export type YearFilter = "All" | "2025-2026" | "2024-2025" | "2023-2024";
export type StatusFilter = "All" | ClassStatus;

export type Student = {
  id: string;
  name: string;
  lrn: string;
  gender: "Male" | "Female";
  score: number;
  risk?: boolean;
};

export type AvailableStudent = Pick<Student, "id" | "name" | "lrn" | "gender">;

export type ClassRecord = {
  id: string;
  grade: string;
  section: string;
  adviser: string;
  adviserEmail: string;
  academicYear: string;
  status: ClassStatus;
  students: Student[];
  subjects: { name: string; teacher: string; time: string; progress: number }[];
};

export type AcademicYearOption = {
  academic_year_id: number;
  year_label: string;
};

export type AcademicLevelOption = {
  academic_level_id: number;
  level_name: string;
  grade_level: number;
};

export type AdviserOption = {
  staff_id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  suffix: string | null;
};

export type ClassFormOptions = {
  academic_year: AcademicYearOption;
  academic_levels: AcademicLevelOption[];
  eligible_advisers: AdviserOption[];
};

export type ManualSectionDraft = {
  localId: string;
  sectionName: string;
  adviserStaffId: string;
  adviserName?: string;
};

export type ManualClassSetup = {
  academicLevelId: number;
  academicLevelName: string;
  academicYear: AcademicYearOption;
  sections: ManualSectionDraft[];
};

export type ClassAssignmentStudent = {
  student_id: string;
  student_lrn: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: string | null;
  academic_level_id: number;
};

export type UnassignedClassStudentsResponse = {
  academic_level: AcademicLevelOption;
  academic_year: AcademicYearOption;
  students: ClassAssignmentStudent[];
};

export type StudentAssignmentsBySection = Record<string, ClassAssignmentStudent[]>;

export type ManualAssignmentWorkspaceState = {
  academicLevelId: number;
  unassignedStudents: ClassAssignmentStudent[];
  assignmentsBySection: StudentAssignmentsBySection;
  selectedStudentIds: Set<string>;
};
