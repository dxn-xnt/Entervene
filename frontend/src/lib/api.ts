import type {
  ArchiveClassResponse,
  BatchCreateClassesRequest,
  BatchCreateClassesResponse,
  ClassDetailResponse,
  ClassFormOptions,
  ClassStudentListResponse,
  ClassTransferOptionsResponse,
  GetClassesResponse,
  TeacherAdvisoryClassDetailResponse,
  TeacherAdvisoryClassListItem,
  UpdateClassStudentListRequest,
  UpdateClassRequest,
  UnassignedClassStudentsResponse,
  ValidateClassImportResponse,
} from "@/types/adminClasses";
import { startProgress, doneProgress } from "@/hooks/use-navigation-progress";

export const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");

export type UserRole = "admin" | "teacher" | "student";

export type User = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at: string;
  account_status: string;
  subjects?: string[];
  class_count?: number;
  section?: string | null;
  grade_level?: number | null;
  average?: number | null;
};

export type UserDetail = User & {
  staff_id?: string;
  student_id?: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  contact_number?: string;
  address?: string;
  employment_status?: string;
  student_status?: string;
  graduation_year?: number | null;
  last_grade_level?: number | null;
  last_section?: string | null;
};

export type UpdateUserPayload = {
  first_name: string;
  middle_name?: string;
  last_name: string;
  email: string;
  account_status: string;
  contact_number?: string;
  address?: string;
  employment_status?: string;
  grade_level?: number | null;
  section?: string | null;
};

export type InviteUserPayload = {
  first_name: string;
  middle_name?: string;
  last_name: string;
  email: string;
  role: "Teacher" | "Student" | "Admin";
  suffix?: string;
  dob?: string;
  gender?: string;
  contact_number?: string;
  address?: string;
  hired_date?: string;
  employment_status?: string;
  student_lrn?: string;
  grade_level?: number | null;
};

export type UserAnalytics = {
  summary: Record<string, number | string | null> | null;
  subject_mastery: Array<Record<string, number | string>>;
  score_trend: Array<Record<string, number | string>>;
  historical_performance: Array<Record<string, number | string>>;
  period_performance: Array<Record<string, number | string>>;
  quarterly_performance: Array<Record<string, number | string>>;
  subject_breakdown: Array<Record<string, number | string>>;
  activity_feed: Array<Record<string, string>>;
  classwork: Array<Record<string, number | string | null>>;
  lms_behavior: Record<string, number | string | null> | null;
};

export type StudentMyClassSummary = {
  class_id: number;
  grade_level: string;
  section_name: string;
  academic_year: string;
  adviser_name: string | null;
  classmate_count: number;
};

export type StudentClassmateItem = {
  student_id: string;
  full_name: string;
  gender?: string | null;
  avatar_initial?: string | null;
};

export type StudentClassmatesResponse = {
  class_id: number;
  section_name: string;
  classmates: StudentClassmateItem[];
};

export type TodoItem = {
  assignment_id: number;
  class_id: number;
  classwork_id: number;
  title: string;
  subject: string;
  subject_id: number;
  due_date: string | null;
  deadline: string;
  type: string;
  category: string | null;
  total_points?: number;
  status: "pending" | "pastdue" | "completed";
  is_submitted: boolean;
  submission_status: string | null;
  grade: number | null;
  show_scores?: boolean;
};

export type StudentTodosResponse = {
  pending: TodoItem[];
  pastdue: TodoItem[];
  completed: TodoItem[];
  all: TodoItem[];
};

export type ActivePeriodResponse = {
  period_id: number | null;
  period_name: string;
  period_type: "TERM" | "QUARTER" | "SEMESTER" | null;
  period_sequence: number | null;
  total_periods_in_year: number | null;
  period_progress_ratio: string | null;
  is_active: boolean;
  year_label: string;
};

export type SubjectStatus = "active" | "archived";
export type SubjectAcademicLevel = {
  academic_level_id: number;
  level_name: string;
  grade_level: number;
};
export type SubjectGroupInline = {
  subject_group_id: number;
  name: string;
  passing_threshold: number;
};
export type SubjectListItem = {
  subject_id: number;
  subject_name: string;
  subject_codename: string | null;
  subject_group: SubjectGroupInline | null;
  hours: number | null;
  default_grading_template: string | null;
  description: string | null;
  status: SubjectStatus;
  academic_level: SubjectAcademicLevel;
  is_math_or_science: boolean;
  created_at: string | null;
  updated_at: string | null;
};
export type SubjectResponse = SubjectListItem;
export type SubjectListResponse = {
  summary: {
    total_subjects: number;
    active_subjects: number;
    archived_subjects: number;
  };
  subjects: SubjectListItem[];
};
export type SubjectFormOptions = {
  academic_levels: SubjectAcademicLevel[];
  subject_groups: SubjectGroupInline[];
  statuses: SubjectStatus[];
  default_status: SubjectStatus;
  grading_templates: string[];
};
export type SubjectImportResult = {
  total_rows: number;
  created_count: number;
  skipped_count: number;
  error_count: number;
  errors: Array<{ row: number | null; message: string }>;
  warnings?: string[];
};
export type SubjectCreatePayload = {
  subject_name: string;
  subject_codename?: string | null;
  subject_group_id: number;
  hours?: number | null;
  default_grading_template?: string | null;
  description?: string | null;
  academic_level_id: number;
  status?: SubjectStatus;
  is_math_or_science?: boolean;
};
export type SubjectUpdatePayload = Partial<SubjectCreatePayload>;

export type SubjectOfferingPathway = "general" | "both" | "stem_medical" | "stem_engineering";
export type SubjectOfferingSubject = {
  subject_id: number;
  subject_name: string;
  subject_codename: string | null;
  subject_group: SubjectGroupInline | null;
  default_grading_template?: string | null;
};
export type SubjectOfferingAcademicYear = {
  academic_year_id: number;
  year_label: string;
  is_active: boolean;
};
export type SubjectOfferingAcademicPeriod = {
  academic_period_id: number;
  period_name: string;
  period_type: "TERM" | "QUARTER" | "SEMESTER";
  period_sequence: number;
  academic_year_id: number;
};
export type SubjectOfferingListItem = {
  subject_offering_id: number;
  subject: SubjectOfferingSubject;
  academic_year: SubjectOfferingAcademicYear;
  academic_level: SubjectAcademicLevel;
  academic_period: SubjectOfferingAcademicPeriod;
  pathway: SubjectOfferingPathway;
  status: SubjectStatus;
  created_at: string | null;
  updated_at: string | null;
};
export type SubjectOfferingResponse = SubjectOfferingListItem;
export type SubjectOfferingListResponse = {
  summary: {
    total_offerings: number;
    active_offerings: number;
    archived_offerings: number;
  };
  subject_offerings: SubjectOfferingListItem[];
};
export type AcademicPathwayItem = {
  id: number;
  code: string;
  name: string;
  is_enabled: boolean;
  sort_order: number | null;
  deped_cluster_id: number | null;
};

export type SubjectOfferingFormOptions = {
  academic_years: Array<SubjectOfferingAcademicYear & { start_date: string; end_date: string }>;
  academic_levels: SubjectAcademicLevel[];
  academic_periods: SubjectOfferingAcademicPeriod[];
  pathways: AcademicPathwayItem[];
  statuses: SubjectStatus[];
  default_status: SubjectStatus;
  active_subjects: Array<SubjectOfferingSubject & { academic_level_id: number }>;
};
export type SubjectOfferingImportResult = {
  total_rows: number;
  created_count: number;
  skipped_count: number;
  error_count: number;
  errors: Array<{ row: number | null; message: string }>;
};
export type SubjectOfferingCopyAcademicYearPayload = {
  source_academic_year_id: number;
  target_academic_year_id: number;
  overwrite_existing?: boolean;
};
export type SubjectOfferingCopyAcademicYearResult = {
  source_academic_year_id: number;
  target_academic_year_id: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  skipped: Array<{
    subject_id: number | null;
    source_subject_offering_id: number | null;
    reason: string;
  }>;
};
export type SubjectOfferingCreatePayload = {
  subject_id: number;
  academic_year_id: number;
  academic_level_id: number;
  academic_period_id: number;
  pathway: SubjectOfferingPathway;
  status?: SubjectStatus;
};
export type SubjectOfferingUpdatePayload = Partial<SubjectOfferingCreatePayload>;

export type GradingTemplateComponentPayload = {
  component_name: string;
  weight: number;
  display_order?: number | null;
};
export type GradingTemplateComponent = {
  component_id: number;
  component_name: string;
  weight: number;
  display_order: number;
  created_at: string | null;
  updated_at: string | null;
};
export type GradingTemplateSubject = {
  subject_id: number;
  subject_name: string;
  subject_codename: string | null;
};
export type GradingTemplateSubjectOption = GradingTemplateSubject & {
  academic_level_id: number;
};
export type GradingTemplateListItem = {
  grading_template_id: number;
  template_name: string;
  description: string | null;
  academic_level: SubjectAcademicLevel | null;
  subject: GradingTemplateSubject | null;
  assigned_subjects?: GradingTemplateSubject[];
  assigned_subject_count?: number;
  is_locked?: boolean;
  lock_reason?: string | null;
  status: SubjectStatus;
  total_weight: number;
  component_count: number;
  components: GradingTemplateComponent[];
  created_at: string | null;
  updated_at: string | null;
};
export type GradingTemplateResponse = GradingTemplateListItem;
export type GradingTemplateListResponse = {
  summary: {
    total_templates: number;
    active_templates: number;
    archived_templates: number;
  };
  grading_templates: GradingTemplateListItem[];
};
export type GradingTemplateFormOptions = {
  academic_levels: SubjectAcademicLevel[];
  subjects: GradingTemplateSubjectOption[];
  statuses: SubjectStatus[];
  default_status: SubjectStatus;
  default_components: GradingTemplateComponentPayload[];
};
export type GradingTemplateCreatePayload = {
  template_name: string;
  description?: string | null;
  academic_level_id?: number | null;
  subject_id?: number | null;
  subject_ids?: number[] | null;
  status?: SubjectStatus;
  components: GradingTemplateComponentPayload[];
};
export type GradingTemplateUpdatePayload = Partial<GradingTemplateCreatePayload>;

function getCookie(name: string): string | null {
  const value = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`))
    ?.split("=")[1];

  return value ? decodeURIComponent(value) : null;
}

let refreshRequest: Promise<boolean> | null = null;

function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  const csrfToken = getCookie("entervene_csrf");

  if (csrfToken && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  const url = /^https?:\/\//i.test(path) ? path : `${API_URL}${path}`;

  return fetch(url, {
    ...init,
    headers,
    credentials: "include",
  });
}

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshRequest) {
    refreshRequest = request("/api/v1/auth/refresh", { method: "POST" })
      .then((response) => response.ok)
      .finally(() => {
        refreshRequest = null;
      });
  }
  return refreshRequest;
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  startProgress();
  try {
    const response = await request(path, init);
    const isAuthRequest = path.startsWith("/api/v1/auth/");

    if (response.status === 401 && !isAuthRequest && await refreshAccessToken()) {
      const retryResponse = await request(path, init);
      doneProgress();
      return retryResponse;
    }

    doneProgress();
    return response;
  } catch (error) {
    doneProgress();
    throw error;
  }
}

export async function getUsers(params: { role?: UserRole; search?: string; status?: string } = {}) {
  const query = new URLSearchParams();

  if (params.role) {
    query.set("role", params.role);
  }

  if (params.search?.trim()) {
    query.set("search", params.search.trim());
  }

  if (params.status?.trim()) {
    query.set("status", params.status.trim());
  }

  const response = await apiFetch(`/api/v1/users${query.toString() ? `?${query.toString()}` : ""}`);

  if (!response.ok) {
    throw new Error("Unable to load users. Please try again.");
  }

  return (await response.json()) as User[];
}

export async function getUserDetail(userId: string) {
  const response = await apiFetch(`/api/v1/users/${encodeURIComponent(userId)}`);

  if (!response.ok) {
    throw new Error("Unable to load user details. Please try again.");
  }

  return (await response.json()) as UserDetail;
}

export async function getUserAnalytics(userId: string) {
  const response = await apiFetch(`/api/v1/users/${encodeURIComponent(userId)}/analytics`);

  if (!response.ok) {
    throw new Error("Unable to load user analytics. Please try again.");
  }

  return (await response.json()) as UserAnalytics;
}

export async function getMyClass(): Promise<StudentMyClassSummary | null> {
  const response = await apiFetch("/api/v1/students/me/class");

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Unable to load your section. Please try again.");
  }

  return (await response.json()) as StudentMyClassSummary;
}

export async function getMyClassmates(): Promise<StudentClassmatesResponse> {
  const response = await apiFetch("/api/v1/students/me/classmates");

  if (!response.ok) {
    throw new Error("Unable to load classmates. Please try again.");
  }

  return (await response.json()) as StudentClassmatesResponse;
}

export async function getStudentTodos(): Promise<StudentTodosResponse> {
  const response = await apiFetch("/api/v1/students/me/todos");

  if (!response.ok) {
    throw new Error("Unable to load your to-do items. Please try again.");
  }

  return (await response.json()) as StudentTodosResponse;
}

export async function getActivePeriod(): Promise<ActivePeriodResponse> {
  const response = await apiFetch("/api/v1/students/me/active-period");

  if (!response.ok) {
    throw new Error("Unable to load active period. Please try again.");
  }

  return (await response.json()) as ActivePeriodResponse;
}

// Backward-compatible alias. Prefer getActivePeriod in new code.
export const getActiveQuarter = getActivePeriod;

export type StudentSubjectItem = {
  subject_load_id: number;
  class_id: number;
  subject_id: number;
  subject_name: string;
  subject_codename: string | null;
  teacher_name: string;
  period_id: number;
  period_name: string;
  is_current_period: boolean;
  is_current_quarter: boolean;
  section_name: string;
  year_label: string;
};

export async function getMySubjects(): Promise<StudentSubjectItem[]> {
  const response = await apiFetch("/api/v1/students/me/subjects");

  if (!response.ok) {
    throw new Error("Unable to load your subjects. Please try again.");
  }

  return (await response.json()) as StudentSubjectItem[];
}

export type TeacherClassItem = {
  class_id: number;
  subject_id: number;
  section_name: string;
  subject_name: string;
  grade_level?: string;
};

export async function getTeacherClasses(): Promise<TeacherClassItem[]> {
  const response = await apiFetch("/api/v1/classwork-assignments/teacher/classes");

  if (!response.ok) {
    throw new Error("Unable to load teacher classes. Please try again.");
  }

  return (await response.json()) as TeacherClassItem[];
}

export type GradebookCategoryHeader = {
  id: number;
  title: string;
  maxScore: number;
};

export type GradebookCategoryHeaderGroup = {
  writtenWork: GradebookCategoryHeader[];
  performanceTask: GradebookCategoryHeader[];
  quarterlyAssessment: GradebookCategoryHeader[];
};

export type StudentGradebookRow = {
  student_id: string;
  name: string;
  writtenWork: (number | null)[];
  performanceTask: (number | null)[];
  quarterlyAssessment: (number | null)[];
  ps_written?: number | null;
  ps_performance?: number | null;
  ps_quarterly?: number | null;
  initial_grade?: number | null;
  transmuted_grade?: number | null;
  total: string;
};

export type StudentGradebookResponse = {
  scope: any;
  classwork: GradebookCategoryHeaderGroup[];
  studentGrades: StudentGradebookRow[];
};

export async function getTeacherGradebook(classId: number | string, subjectId: number | string): Promise<StudentGradebookResponse> {
  const response = await apiFetch(`/api/v1/student-records/teacher/classes/${encodeURIComponent(String(classId))}/subjects/${encodeURIComponent(String(subjectId))}/gradebook`);

  if (!response.ok) {
    throw new Error("Unable to load gradebook data. Please try again.");
  }

  return (await response.json()) as StudentGradebookResponse;
}

export type ActivityCreatePayload = {
  title: string;
  classwork_category: string;
  total_points: number;
  class_id: number;
  subject_id: number;
  activity_mode?: string;
  description?: string;
  due_date?: string;
  lesson_ids?: number[];
};

export type StudentActivityScoreItem = {
  student_id: string;
  name: string;
  score: number | null;
};

export type ActivityScoresResponse = {
  activity_id: number;
  classwork_assignment_id: number;
  title: string;
  max_score: number;
  activity_mode: string;
  students: StudentActivityScoreItem[];
};

export type BulkScoreItem = {
  student_id: string;
  score: number | null;
};

export type BulkScoreUpdatePayload = {
  class_id: number;
  scores: BulkScoreItem[];
};

export async function createActivity(payload: ActivityCreatePayload) {
  const response = await apiFetch("/api/v1/activities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail ?? "Failed to create activity.");
  }

  return await response.json();
}

export async function getActivityScores(activityId: number | string, classId: number | string): Promise<ActivityScoresResponse> {
  const response = await apiFetch(`/api/v1/activities/${encodeURIComponent(String(activityId))}/scores?class_id=${encodeURIComponent(String(classId))}`);

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail ?? "Failed to fetch activity scores.");
  }

  return (await response.json()) as ActivityScoresResponse;
}

export async function bulkUpdateActivityScores(activityId: number | string, payload: BulkScoreUpdatePayload): Promise<ActivityScoresResponse> {
  const response = await apiFetch(`/api/v1/activities/${encodeURIComponent(String(activityId))}/scores`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail ?? "Failed to save scores.");
  }

  return (await response.json()) as ActivityScoresResponse;
}

export async function deleteActivity(activityId: number | string) {
  const response = await apiFetch(`/api/v1/activities/${encodeURIComponent(String(activityId))}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail ?? "Failed to delete activity.");
  }

  return await response.json();
}

export async function updateUser(userId: string, payload: UpdateUserPayload) {
  const response = await apiFetch(`/api/v1/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail ?? "Unable to update user. Please try again.");
  }

  return (await response.json()) as UserDetail;
}

export async function archiveUser(userId: string) {
  const response = await apiFetch(`/api/v1/users/${encodeURIComponent(userId)}/archive`, {
    method: "PATCH",
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail ?? "Unable to archive user. Please try again.");
  }

  return (await response.json()) as { message: string };
}

function classOptionsErrorMessage(data: unknown): string {
  if (!data || typeof data !== "object") return "Unable to load class options.";
  if ("message" in data && typeof data.message === "string") return data.message;
  if ("detail" in data && typeof data.detail === "string") return data.detail;
  return "Unable to load class options.";
}

function apiErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  if ("message" in data && typeof data.message === "string") return data.message;
  if ("detail" in data && typeof data.detail === "string") return data.detail;
  return fallback;
}

export class ApiRequestError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.data = data;
  }
}

export async function getClassFormOptions(): Promise<ClassFormOptions> {
  const response = await apiFetch("/api/v1/classes/form-options");

  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new Error(classOptionsErrorMessage(data));
  }

  return (await response.json()) as ClassFormOptions;
}

export async function getSubjectFormOptions(): Promise<SubjectFormOptions> {
  const response = await apiFetch("/api/v1/subjects/form-options");
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new Error(apiErrorMessage(data, "Unable to load subject options."));
  }
  return (await response.json()) as SubjectFormOptions;
}

export async function getSubjects(params: {
  status?: SubjectStatus;
  academic_level_id?: number;
  subject_group_id?: number;
  search?: string;
} = {}): Promise<SubjectListResponse> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.academic_level_id) query.set("academic_level_id", String(params.academic_level_id));
  if (params.subject_group_id) query.set("subject_group_id", String(params.subject_group_id));
  if (params.search?.trim()) query.set("search", params.search.trim());
  const response = await apiFetch(`/api/v1/subjects${query.toString() ? `?${query.toString()}` : ""}`);
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new Error(apiErrorMessage(data, "Unable to load subjects."));
  }
  return (await response.json()) as SubjectListResponse;
}

export async function getSubjectDetail(subjectId: string | number): Promise<SubjectResponse> {
  const response = await apiFetch(`/api/v1/subjects/${encodeURIComponent(String(subjectId))}`);
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new Error(apiErrorMessage(data, "Unable to load subject details."));
  }
  return (await response.json()) as SubjectResponse;
}

export async function createSubject(payload: SubjectCreatePayload): Promise<SubjectResponse> {
  const response = await apiFetch("/api/v1/subjects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(apiErrorMessage(data, "Unable to create subject."), response.status, data);
  }
  return (await response.json()) as SubjectResponse;
}

export async function updateSubject(subjectId: string | number, payload: SubjectUpdatePayload): Promise<SubjectResponse> {
  const response = await apiFetch(`/api/v1/subjects/${encodeURIComponent(String(subjectId))}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(apiErrorMessage(data, "Unable to update subject."), response.status, data);
  }
  return (await response.json()) as SubjectResponse;
}

export async function archiveSubject(subjectId: string | number): Promise<SubjectResponse> {
  const response = await apiFetch(`/api/v1/subjects/${encodeURIComponent(String(subjectId))}/archive`, {
    method: "PATCH",
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(apiErrorMessage(data, "Unable to archive subject."), response.status, data);
  }
  return (await response.json()) as SubjectResponse;
}

export async function restoreSubject(subjectId: string | number): Promise<SubjectResponse> {
  const response = await apiFetch(`/api/v1/subjects/${encodeURIComponent(String(subjectId))}/restore`, {
    method: "PATCH",
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(apiErrorMessage(data, "Unable to restore subject."), response.status, data);
  }
  return (await response.json()) as SubjectResponse;
}

export async function downloadSubjectImportTemplate(): Promise<Blob> {
  const response = await apiFetch("/api/v1/subjects/import-template");
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new Error(apiErrorMessage(data, "Unable to download subject import template."));
  }
  return response.blob();
}

export async function uploadSubjectImportCsv(file: File): Promise<SubjectImportResult> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await apiFetch("/api/v1/subjects/import", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(apiErrorMessage(data, "Unable to import subjects."), response.status, data);
  }
  return (await response.json()) as SubjectImportResult;
}

export async function getSubjectOfferingFormOptions(): Promise<SubjectOfferingFormOptions> {
  const response = await apiFetch("/api/v1/subject-offerings/form-options");
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new Error(apiErrorMessage(data, "Unable to load subject offering options."));
  }
  return (await response.json()) as SubjectOfferingFormOptions;
}

export async function getSubjectOfferings(params: {
  academic_year_id?: number;
  academic_level_id?: number;
  academic_period_id?: number;
  pathway?: SubjectOfferingPathway;
  status?: SubjectStatus;
  search?: string;
} = {}): Promise<SubjectOfferingListResponse> {
  const query = new URLSearchParams();
  if (params.academic_year_id) query.set("academic_year_id", String(params.academic_year_id));
  if (params.academic_level_id) query.set("academic_level_id", String(params.academic_level_id));
  if (params.academic_period_id) query.set("academic_period_id", String(params.academic_period_id));
  if (params.pathway) query.set("pathway", params.pathway);
  if (params.status) query.set("status", params.status);
  if (params.search?.trim()) query.set("search", params.search.trim());
  const response = await apiFetch(`/api/v1/subject-offerings${query.toString() ? `?${query.toString()}` : ""}`);
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new Error(apiErrorMessage(data, "Unable to load subject offerings."));
  }
  return (await response.json()) as SubjectOfferingListResponse;
}

export async function getSubjectOfferingDetail(subjectOfferingId: string | number): Promise<SubjectOfferingResponse> {
  const response = await apiFetch(`/api/v1/subject-offerings/${encodeURIComponent(String(subjectOfferingId))}`);
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new Error(apiErrorMessage(data, "Unable to load subject offering details."));
  }
  return (await response.json()) as SubjectOfferingResponse;
}

export async function createSubjectOffering(payload: SubjectOfferingCreatePayload): Promise<SubjectOfferingResponse> {
  const response = await apiFetch("/api/v1/subject-offerings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(apiErrorMessage(data, "Unable to create subject offering."), response.status, data);
  }
  return (await response.json()) as SubjectOfferingResponse;
}

export async function updateSubjectOffering(subjectOfferingId: string | number, payload: SubjectOfferingUpdatePayload): Promise<SubjectOfferingResponse> {
  const response = await apiFetch(`/api/v1/subject-offerings/${encodeURIComponent(String(subjectOfferingId))}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(apiErrorMessage(data, "Unable to update subject offering."), response.status, data);
  }
  return (await response.json()) as SubjectOfferingResponse;
}

export async function archiveSubjectOffering(subjectOfferingId: string | number): Promise<SubjectOfferingResponse> {
  const response = await apiFetch(`/api/v1/subject-offerings/${encodeURIComponent(String(subjectOfferingId))}/archive`, {
    method: "PATCH",
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(apiErrorMessage(data, "Unable to archive subject offering."), response.status, data);
  }
  return (await response.json()) as SubjectOfferingResponse;
}

export async function restoreSubjectOffering(subjectOfferingId: string | number): Promise<SubjectOfferingResponse> {
  const response = await apiFetch(`/api/v1/subject-offerings/${encodeURIComponent(String(subjectOfferingId))}/restore`, {
    method: "PATCH",
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(apiErrorMessage(data, "Unable to restore subject offering."), response.status, data);
  }
  return (await response.json()) as SubjectOfferingResponse;
}

export async function downloadSubjectOfferingImportTemplate(): Promise<Blob> {
  const response = await apiFetch("/api/v1/subject-offerings/import-template");
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new Error(apiErrorMessage(data, "Unable to download subject offering import template."));
  }
  return response.blob();
}

export async function uploadSubjectOfferingImportCsv(file: File): Promise<SubjectOfferingImportResult> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await apiFetch("/api/v1/subject-offerings/import", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(apiErrorMessage(data, "Unable to import subject offerings."), response.status, data);
  }
  return (await response.json()) as SubjectOfferingImportResult;
}

export async function copySubjectOfferingsFromAcademicYear(
  payload: SubjectOfferingCopyAcademicYearPayload
): Promise<SubjectOfferingCopyAcademicYearResult> {
  const response = await apiFetch("/api/v1/subject-offerings/copy-academic-year", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(apiErrorMessage(data, "Unable to copy previous year setup."), response.status, data);
  }
  return (await response.json()) as SubjectOfferingCopyAcademicYearResult;
}

export async function getGradingTemplateFormOptions(): Promise<GradingTemplateFormOptions> {
  const response = await apiFetch("/api/v1/grading-templates/form-options");
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new Error(apiErrorMessage(data, "Unable to load grading template options."));
  }
  return (await response.json()) as GradingTemplateFormOptions;
}

export async function getGradingTemplates(params: {
  status?: SubjectStatus;
  academic_level_id?: number;
  subject_id?: number;
  search?: string;
} = {}): Promise<GradingTemplateListResponse> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.academic_level_id) query.set("academic_level_id", String(params.academic_level_id));
  if (params.subject_id) query.set("subject_id", String(params.subject_id));
  if (params.search?.trim()) query.set("search", params.search.trim());
  const response = await apiFetch(`/api/v1/grading-templates${query.toString() ? `?${query.toString()}` : ""}`);
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new Error(apiErrorMessage(data, "Unable to load grading templates."));
  }
  return (await response.json()) as GradingTemplateListResponse;
}

export async function getGradingTemplateDetail(gradingTemplateId: string | number): Promise<GradingTemplateResponse> {
  const response = await apiFetch(`/api/v1/grading-templates/${encodeURIComponent(String(gradingTemplateId))}`);
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new Error(apiErrorMessage(data, "Unable to load grading template details."));
  }
  return (await response.json()) as GradingTemplateResponse;
}

export async function createGradingTemplate(payload: GradingTemplateCreatePayload): Promise<GradingTemplateResponse> {
  const response = await apiFetch("/api/v1/grading-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(apiErrorMessage(data, "Unable to create grading template."), response.status, data);
  }
  return (await response.json()) as GradingTemplateResponse;
}

export async function updateGradingTemplate(
  gradingTemplateId: string | number,
  payload: GradingTemplateUpdatePayload
): Promise<GradingTemplateResponse> {
  const response = await apiFetch(`/api/v1/grading-templates/${encodeURIComponent(String(gradingTemplateId))}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(apiErrorMessage(data, "Unable to update grading template."), response.status, data);
  }
  return (await response.json()) as GradingTemplateResponse;
}

export async function archiveGradingTemplate(gradingTemplateId: string | number): Promise<GradingTemplateResponse> {
  const response = await apiFetch(`/api/v1/grading-templates/${encodeURIComponent(String(gradingTemplateId))}/archive`, {
    method: "PATCH",
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(apiErrorMessage(data, "Unable to archive grading template."), response.status, data);
  }
  return (await response.json()) as GradingTemplateResponse;
}

export async function restoreGradingTemplate(gradingTemplateId: string | number): Promise<GradingTemplateResponse> {
  const response = await apiFetch(`/api/v1/grading-templates/${encodeURIComponent(String(gradingTemplateId))}/restore`, {
    method: "PATCH",
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(apiErrorMessage(data, "Unable to restore grading template."), response.status, data);
  }
  return (await response.json()) as GradingTemplateResponse;
}

export async function getClasses(status: "active" | "archived" = "active"): Promise<GetClassesResponse> {
  const query = new URLSearchParams({ status });
  const response = await apiFetch(`/api/v1/classes?${query.toString()}`);

  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new Error(classListErrorMessage(data, response.status));
  }

  return (await response.json()) as GetClassesResponse;
}

export async function getClassDetail(classId: string | number): Promise<ClassDetailResponse> {
  const response = await apiFetch(`/api/v1/classes/${encodeURIComponent(String(classId))}`);

  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new Error(classDetailErrorMessage(data, response.status));
  }

  return (await response.json()) as ClassDetailResponse;
}

export async function updateClass(
  classId: string | number,
  payload: UpdateClassRequest
): Promise<ClassDetailResponse> {
  const response = await apiFetch(`/api/v1/classes/${encodeURIComponent(String(classId))}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(classUpdateErrorMessage(data, response.status), response.status, data);
  }

  return (await response.json()) as ClassDetailResponse;
}

export async function archiveClass(classId: string | number): Promise<ArchiveClassResponse> {
  const response = await apiFetch(`/api/v1/classes/${encodeURIComponent(String(classId))}/archive`, {
    method: "PATCH",
  });

  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(classArchiveErrorMessage(data, response.status), response.status, data);
  }

  return (await response.json()) as ArchiveClassResponse;
}

export async function getClassStudents(
  classId: string | number,
  options: { search?: string; page?: number; pageSize?: number } = {}
): Promise<ClassStudentListResponse> {
  const query = new URLSearchParams();
  if (options.search?.trim()) query.set("search", options.search.trim());
  if (options.page) query.set("page", String(options.page));
  if (options.pageSize) query.set("page_size", String(options.pageSize));
  const response = await apiFetch(
    `/api/v1/classes/${encodeURIComponent(String(classId))}/students${query.toString() ? `?${query.toString()}` : ""}`
  );

  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new Error(classStudentsErrorMessage(data, response.status));
  }

  return (await response.json()) as ClassStudentListResponse;
}

export async function getTeacherAdvisoryClasses(): Promise<TeacherAdvisoryClassListItem[]> {
  const response = await apiFetch("/api/v1/classes/teacher/advisory");

  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new Error(teacherAdvisoryClassErrorMessage(data, response.status, "Unable to load advisory classes."));
  }

  return (await response.json()) as TeacherAdvisoryClassListItem[];
}

export async function getTeacherAdvisoryClassDetail(
  classId: string | number
): Promise<TeacherAdvisoryClassDetailResponse> {
  const response = await apiFetch(`/api/v1/classes/teacher/advisory/${encodeURIComponent(String(classId))}`);

  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new Error(teacherAdvisoryClassErrorMessage(data, response.status, "Unable to load class details."));
  }

  return (await response.json()) as TeacherAdvisoryClassDetailResponse;
}

export async function getClassTransferOptions(classId: string | number): Promise<ClassTransferOptionsResponse> {
  const response = await apiFetch(`/api/v1/classes/${encodeURIComponent(String(classId))}/transfer-options`);

  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new Error(classStudentsErrorMessage(data, response.status));
  }

  return (await response.json()) as ClassTransferOptionsResponse;
}

export async function updateClassStudentList(
  classId: string | number,
  payload: UpdateClassStudentListRequest
): Promise<ClassStudentListResponse> {
  const response = await apiFetch(`/api/v1/classes/${encodeURIComponent(String(classId))}/students`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(classStudentsErrorMessage(data, response.status), response.status, data);
  }

  return (await response.json()) as ClassStudentListResponse;
}

export async function getUnassignedClassStudents(academicLevelId: number): Promise<UnassignedClassStudentsResponse> {
  const query = new URLSearchParams({ academic_level_id: String(academicLevelId) });
  const response = await apiFetch(`/api/v1/classes/unassigned-students?${query.toString()}`);

  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new Error(classOptionsErrorMessage(data).replace("class options", "unassigned students"));
  }

  return (await response.json()) as UnassignedClassStudentsResponse;
}

function classListErrorMessage(data: unknown, status: number): string {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have permission to view classes.";
  if (!data || typeof data !== "object") return "Unable to load classes.";
  if ("message" in data && typeof data.message === "string") return data.message;
  if ("detail" in data && typeof data.detail === "string") return data.detail;
  return "Unable to load classes.";
}

function classDetailErrorMessage(data: unknown, status: number): string {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have permission to view this class.";
  if (status === 404) return "Unable to load class details.";
  if (!data || typeof data !== "object") return "Unable to load class details.";
  if ("message" in data && typeof data.message === "string") return data.message;
  if ("detail" in data && typeof data.detail === "string") return data.detail;
  return "Unable to load class details.";
}

function classUpdateErrorMessage(data: unknown, status: number): string {
  if (status === 400) return safeClassErrorMessage(data, "Unable to update class.");
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have permission to update this class.";
  if (status === 404) return "Class not found.";
  if (status === 409) return safeClassErrorMessage(data, "Unable to update class because it conflicts with existing class data.");
  return safeClassErrorMessage(data, "Unable to update class.");
}

function classArchiveErrorMessage(data: unknown, status: number): string {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have permission to archive this class.";
  if (status === 404) return "Unable to archive class.";
  if (status === 409) return safeClassErrorMessage(data, "Class is already archived.");
  return safeClassErrorMessage(data, "Unable to archive class.");
}

function classStudentsErrorMessage(data: unknown, status: number): string {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have permission to update this class.";
  if (status === 404) return safeClassErrorMessage(data, "Class not found.");
  if (status === 409) return safeClassErrorMessage(data, "Unable to update student list.");
  return safeClassErrorMessage(data, "Unable to update student list.");
}

function teacherAdvisoryClassErrorMessage(data: unknown, status: number, fallback: string): string {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have permission to view this advisory class.";
  if (status === 404) return "Class not found.";
  return safeClassErrorMessage(data, fallback);
}

function safeClassErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  if ("message" in data && typeof data.message === "string") return data.message;
  if ("detail" in data && typeof data.detail === "string") return data.detail;
  return fallback;
}

export async function createClassesBatch(payload: BatchCreateClassesRequest): Promise<BatchCreateClassesResponse> {
  const response = await apiFetch("/api/v1/classes/batch-create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(batchCreateErrorMessage(data, response.status), response.status, data);
  }

  return (await response.json()) as BatchCreateClassesResponse;
}

export async function validateClassImport(file: File, academicLevelId: number): Promise<ValidateClassImportResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("academic_level_id", String(academicLevelId));

  const response = await apiFetch("/api/v1/classes/validate-import", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(classImportErrorMessage(data, response.status), response.status, data);
  }

  return (await response.json()) as ValidateClassImportResponse;
}

function batchCreateErrorMessage(data: unknown, status: number): string {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have permission to create classes.";
  if (!data || typeof data !== "object") return "Unable to save classes. Please try again.";
  if ("message" in data && typeof data.message === "string") return data.message;
  if ("detail" in data && typeof data.detail === "string") return data.detail;
  return "Unable to save classes. Please try again.";
}

function classImportErrorMessage(data: unknown, status: number): string {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have permission to validate class imports.";
  if (!data || typeof data !== "object") return "Unable to validate CSV. Please try again.";
  if ("message" in data && typeof data.message === "string") return data.message;
  if ("detail" in data && typeof data.detail === "string") return data.detail;
  return "Unable to validate CSV. Please try again.";
}

// -------------------------------------------------------------
// SUBJECT LOAD STUDIO TYPES & API CLIENT
// -------------------------------------------------------------

export type SubjectLoadItem = {
  _key?: string;
  subject_load_id?: number | null;
  class_id: number;
  subject_id: number;
  staff_id?: string | null;
  academic_period_id: number;
  start_time?: string | null;
  end_time?: string | null;
  days_of_week: string[];
  status?: string;
  version?: number;
  is_active_version?: boolean;
  is_locked?: boolean;
  published_at?: string | null;
  published_by?: string | null;
  last_modified_by?: string | null;
  continued_from_load_id?: number | null;
  is_math_or_science?: boolean;
};

export type ConflictItem = {
  rule: string;
  severity: "error" | "warning";
  message: string;
  class_id?: number | null;
  subject_id?: number | null;
  staff_id?: string | null;
  day?: string | null;
  affected_key?: string | null;
};

export type TeacherWorkloadItem = {
  staff_id: string;
  staff_name: string;
  daily_hours: Record<string, number>;
  daily_subjects_count: Record<string, number>;
  total_weekly_hours: number;
  has_capacity_warning: boolean;
};

export type ValidationResultResponse = {
  is_valid: boolean;
  conflicts: ConflictItem[];
  teacher_workloads: TeacherWorkloadItem[];
  passed_checks_count?: number;
  total_checks_count?: number;
  can_publish?: boolean;
};

export type SubjectOfferingStudioItem = {
  subject_offering_id: number;
  subject_id: number;
  academic_year_id: number;
  academic_level_id: number;
  academic_period_id: number;
  pathway: string;
};

export type SubjectLoadStudioData = {
  active_period_id: number;
  academic_years: Array<{ academic_year_id: number; year_label: string; is_active: boolean }>;
  academic_periods: Array<{ academic_period_id: number; period_name: string; is_active: boolean }>;
  academic_levels: Array<{ academic_level_id: number; level_name: string; grade_level: number }>;
  classes: Array<{ class_id: number; section_name: string; academic_level_id: number; academic_year_id: number; pathway?: string; paired_class_id?: number | null; period_template_group?: string | null }>;
  subjects: Array<{ subject_id: number; subject_name: string; subject_codename: string; academic_level_id: number; hours: number; subject_group: string; is_math_or_science?: boolean }>;
  subject_offerings?: SubjectOfferingStudioItem[];
  teachers: Array<{ staff_id: string; name: string; department: string; specialization: string }>;
  existing_loads: SubjectLoadItem[];
};

export async function getSubjectLoadStudioData(periodId?: number): Promise<SubjectLoadStudioData> {
  const query = periodId ? `?academic_period_id=${periodId}` : "";
  const response = await apiFetch(`/api/v1/subject-loads/studio-data${query}`);
  if (!response.ok) {
    throw new ApiRequestError("Failed to fetch subject load studio data", response.status, null);
  }
  return (await response.json()) as SubjectLoadStudioData;
}

export type AutoScheduleResponse = {
  is_valid: boolean;
  conflicts: ConflictItem[];
  teacher_workloads: TeacherWorkloadItem[];
  scheduled_loads: SubjectLoadItem[];
};

export async function validateSubjectLoads(periodId: number, loads: SubjectLoadItem[]): Promise<ValidationResultResponse> {
  const response = await apiFetch("/api/v1/subject-loads/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ academic_period_id: periodId, loads }),
  });
  if (!response.ok) {
    throw new ApiRequestError("Failed to validate subject loads", response.status, null);
  }
  return (await response.json()) as ValidationResultResponse;
}

export async function autoScheduleSubjectLoads(
  periodId: number,
  loads: SubjectLoadItem[],
  mode: "standard" | "teacher_swap" = "standard"
): Promise<AutoScheduleResponse> {
  const query = mode === "teacher_swap" ? "?mode=teacher_swap" : "";
  const response = await apiFetch(`/api/v1/subject-loads/auto-schedule${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ academic_period_id: periodId, loads }),
  });
  if (!response.ok) {
    throw new ApiRequestError("Failed to auto-schedule subject loads", response.status, null);
  }
  return (await response.json()) as AutoScheduleResponse;
}

export async function batchSaveSubjectLoads(
  periodId: number,
  levelId: number,
  action: "draft" | "publish",
  loads: SubjectLoadItem[],
  publishScope: "all" | "level" | "section" = "all",
  targetLevelId?: number | null,
  targetClassId?: number | null
): Promise<{ message: string; saved_count: number; status: string; is_valid: boolean; conflicts: ConflictItem[] }> {
  const response = await apiFetch("/api/v1/subject-loads/batch-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      academic_period_id: periodId,
      academic_level_id: levelId,
      action,
      publish_scope: publishScope,
      target_level_id: targetLevelId ?? (publishScope === "level" ? levelId : null),
      target_class_id: targetClassId ?? null,
      loads,
    }),
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const msg = data && typeof data === "object" && "detail" in data && typeof data.detail === "string"
      ? data.detail
      : "Failed to save subject loads";
    throw new ApiRequestError(msg, response.status, data);
  }
  return (await response.json()) as { message: string; saved_count: number; status: string; is_valid: boolean; conflicts: ConflictItem[] };
}

export interface DynamicScheduleRow {
  type: "class" | "break";
  subject_load_id?: number;
  subject?: string;
  subject_codename?: string;
  teacher?: string;
  section_name?: string;
  time: string;
  start_time?: string;
  end_time?: string;
  days?: string[];
  label?: string;
  slot_type?: "HOMEROOM" | "RECESS" | "LUNCH" | "CLASS";
}

export interface DynamicScheduleResponse {
  is_published: boolean;
  class_id?: number;
  section_name?: string;
  grade_level?: string;
  schedule: DynamicScheduleRow[];
}

export async function getClassSchedule(
  classId: number | string,
  academicPeriodId?: number
): Promise<DynamicScheduleResponse> {
  const query = academicPeriodId ? `?academic_period_id=${academicPeriodId}` : "";
  const response = await apiFetch(`/api/v1/subject-loads/class-schedule/${classId}${query}`);
  if (!response.ok) {
    throw new ApiRequestError("Failed to fetch class schedule", response.status, null);
  }
  return (await response.json()) as DynamicScheduleResponse;
}

export async function getMySchedule(
  academicPeriodId?: number
): Promise<DynamicScheduleResponse> {
  const query = academicPeriodId ? `?academic_period_id=${academicPeriodId}` : "";
  const response = await apiFetch(`/api/v1/subject-loads/my-schedule${query}`);
  if (!response.ok) {
    throw new ApiRequestError("Failed to fetch schedule", response.status, null);
  }
  return (await response.json()) as DynamicScheduleResponse;
}

export interface DepedClusterRead {
  id: number;
  code: string;
  name: string;
  category: string;
  sort_order: number;
}

export interface AcademicPathwayRead {
  id: number;
  code: string;
  name: string;
  is_enabled: boolean;
  sort_order: number;
  deped_cluster_id?: number | null;
  deped_cluster?: DepedClusterRead | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PathwayCreatePayload {
  code: string;
  name: string;
  is_enabled?: boolean;
  sort_order?: number;
  deped_cluster_id?: number | null;
}

export interface PathwayUpdatePayload {
  code?: string;
  name?: string;
  is_enabled?: boolean;
  sort_order?: number;
  deped_cluster_id?: number | null;
}

export interface PathwayListResponse {
  pathways: AcademicPathwayRead[];
}

export async function fetchPathways(isEnabled?: boolean): Promise<PathwayListResponse> {
  const query = isEnabled !== undefined ? `?is_enabled=${isEnabled}` : "";
  const response = await apiFetch(`/api/v1/pathways${query}`);
  if (!response.ok) {
    throw new ApiRequestError("Failed to fetch academic pathways", response.status, null);
  }
  return (await response.json()) as PathwayListResponse;
}

export async function createPathway(payload: PathwayCreatePayload): Promise<AcademicPathwayRead> {
  const response = await apiFetch("/api/v1/pathways", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const msg = data && typeof data === "object" && "detail" in data && typeof data.detail === "string"
      ? data.detail
      : "Failed to create academic pathway";
    throw new ApiRequestError(msg, response.status, data);
  }
  return (await response.json()) as AcademicPathwayRead;
}

export async function updatePathway(id: number, payload: PathwayUpdatePayload): Promise<AcademicPathwayRead> {
  const response = await apiFetch(`/api/v1/pathways/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const msg = data && typeof data === "object" && "detail" in data && typeof data.detail === "string"
      ? data.detail
      : "Failed to update academic pathway";
    throw new ApiRequestError(msg, response.status, data);
  }
  return (await response.json()) as AcademicPathwayRead;
}

export interface PathwayScopeRead {
  id?: number | null;
  academic_year_id: number;
  academic_level_id: number;
  grade_level: number;
  level_name: string;
  requires_pathway: boolean;
}

export interface PathwayScopeItemUpdate {
  academic_level_id: number;
  requires_pathway: boolean;
}

export interface PathwayScopeBatchPayload {
  academic_year_id: number;
  scopes: PathwayScopeItemUpdate[];
}

export interface PathwayScopeListResponse {
  academic_year_id: number;
  scopes: PathwayScopeRead[];
}

export async function fetchPathwayScopes(academicYearId: number): Promise<PathwayScopeListResponse> {
  const response = await apiFetch(`/api/v1/pathways/scopes?academic_year_id=${academicYearId}`);
  if (!response.ok) {
    throw new ApiRequestError("Failed to fetch pathway scopes", response.status, null);
  }
  return (await response.json()) as PathwayScopeListResponse;
}

export async function updatePathwayScopes(payload: PathwayScopeBatchPayload): Promise<PathwayScopeListResponse> {
  const response = await apiFetch("/api/v1/pathways/scopes", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const msg = data && typeof data === "object" && "detail" in data && typeof data.detail === "string"
      ? data.detail
      : "Failed to update pathway scopes";
    throw new ApiRequestError(msg, response.status, data);
  }
  return (await response.json()) as PathwayScopeListResponse;
}



