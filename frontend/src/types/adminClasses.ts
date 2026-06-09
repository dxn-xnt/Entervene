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

export type ClassListAdviser = AdviserOption;

export type ClassListAcademicLevel = AcademicLevelOption;

export type ClassListAcademicYear = AcademicYearOption;

export type ClassListItem = {
  class_id: number;
  section_name: string;
  class_status: string;
  academic_year: ClassListAcademicYear;
  academic_level: ClassListAcademicLevel;
  adviser: ClassListAdviser | null;
  student_count: number;
  subject_count: number;
};

export type ClassListSummary = {
  total_classes: number;
  active_classes: number;
  archived_classes: number;
  students_assigned: number;
};

export type GetClassesResponse = {
  summary: ClassListSummary;
  classes: ClassListItem[];
};

export type ClassDetailStatistics = {
  student_count: number;
  subject_count: number;
  schedule_count: number;
};

export type ClassDetailResponse = {
  class_id: number;
  section_name: string;
  class_status: string;
  created_at: string | null;
  academic_year: AcademicYearOption;
  academic_level: AcademicLevelOption;
  adviser: AdviserOption | null;
  statistics: ClassDetailStatistics;
};

export type ArchiveClassResponse = {
  class_id: number;
  section_name: string;
  class_status: string;
  message: string;
};

export type UpdateClassRequest = {
  section_name?: string;
  adviser_staff_id?: string | null;
};

export type ClassStudentListItem = {
  student_id: string;
  full_name: string;
  gender: string;
  avatar_initial: string;
};

export type ClassStudentGenderCounts = {
  female: number;
  male: number;
  other: number;
  unspecified: number;
};

export type ClassStudentListResponse = {
  class_id: number;
  section_name: string;
  academic_level: {
    academic_level_id: number;
    level_name: string;
  };
  summary: {
    total_students: number;
    gender_counts: ClassStudentGenderCounts;
  };
  students: ClassStudentListItem[];
  pagination: {
    page: number;
    page_size: number;
    total_items: number;
    total_pages: number;
  };
};

export type ClassTransferOption = {
  class_id: number;
  section_name: string;
};

export type ClassTransferOptionsResponse = {
  current_class_id: number;
  academic_level: {
    academic_level_id: number;
    level_name: string;
  };
  available_sections: ClassTransferOption[];
};

export type PendingStudentRemoval = {
  student_id: string;
};

export type PendingStudentTransfer = {
  student_id: string;
  target_class_id: number;
};

export type UpdateClassStudentListRequest = {
  removals: PendingStudentRemoval[];
  transfers: PendingStudentTransfer[];
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

export type BatchCreateSectionRequest = {
  section_name: string;
  adviser_staff_id: string;
  student_ids: string[];
};

export type BatchCreateClassesRequest = {
  academic_level_id: number;
  sections: BatchCreateSectionRequest[];
};

export type CreatedClassItem = {
  class_id: number;
  section_name: string;
  adviser_staff_id: string;
  student_count: number;
};

export type BatchCreateClassesResponse = {
  message: string;
  academic_level_id: number;
  academic_year_id: number;
  summary: {
    class_count: number;
    student_assignment_count: number;
  };
  classes: CreatedClassItem[];
};

export type ValidatedImportAcademicLevel = {
  academic_level_id: number;
  level_name: string;
  grade_level: number;
};

export type ValidatedImportAcademicYear = {
  academic_year_id: number;
  year_label: string;
};

export type ValidatedImportAdviser = {
  staff_id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  suffix: string | null;
};

export type ValidatedImportStudent = {
  student_id: string;
  student_lrn: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: string | null;
  academic_level_id: number;
};

export type ValidatedImportSection = {
  section_name: string;
  adviser: ValidatedImportAdviser;
  students: ValidatedImportStudent[];
};

export type ValidateClassImportResponse = {
  academic_level: ValidatedImportAcademicLevel;
  academic_year: ValidatedImportAcademicYear;
  sections: ValidatedImportSection[];
  summary: {
    section_count: number;
    student_count: number;
  };
};

export type ClassImportValidationErrorItem = {
  row?: number | null;
  field?: string | null;
  code: string;
  message: string;
};

export type ClassImportValidationErrorResponse = {
  message: string;
  code: string;
  errors: ClassImportValidationErrorItem[];
};
