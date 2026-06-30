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
  const response = await request(path, init);
  const isAuthRequest = path.startsWith("/api/v1/auth/");

  if (response.status === 401 && !isAuthRequest && await refreshAccessToken()) {
    return request(path, init);
  }

  return response;
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

export async function getActivePeriod(): Promise<ActivePeriodResponse> {
  const response = await apiFetch("/api/v1/students/me/active-period");

  if (!response.ok) {
    throw new Error("Unable to load active period. Please try again.");
  }

  return (await response.json()) as ActivePeriodResponse;
}

// Backward-compatible alias. Prefer getActivePeriod in new code.
export const getActiveQuarter = getActivePeriod;

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
