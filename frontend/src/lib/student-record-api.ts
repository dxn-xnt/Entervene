import { apiFetch } from "@/lib/api";

export type StudentRecordScope = {
  class_id: number;
  subject_id: number;
  academic_year_id: number;
  academic_period_id: number;
  section_name: string;
  subject_name: string;
  period_name: string;
  year_label: string;
};

export type StudentRecordRosterRow = {
  student_id: string;
  lrn: string;
  full_name: string;
  email?: string | null;
  official_period_grade?: number | null;
  running_classwork_percentage?: number | null;
  completion_rate?: number | null;
  submitted_count: number;
  missing_count: number;
  late_count: number;
  ungraded_count: number;
};

export type StudentRecordRosterResponse = {
  scope: StudentRecordScope;
  students: StudentRecordRosterRow[];
};

export type StudentClassworkResult = {
  classwork_id: number;
  assignment_id: number;
  title: string;
  type: string;
  category?: string | null;
  due_date?: string | null;
  status: string;
  score?: number | null;
  total_points?: number | null;
  percentage?: number | null;
  submitted_at?: string | null;
  graded_at?: string | null;
};

export type StudentRecordDetailResponse = {
  student: {
    student_id: string;
    lrn: string;
    full_name: string;
    email?: string | null;
    academic_level?: string | null;
    section_name: string;
  };
  scope: StudentRecordScope;
  summary: {
    official_period_grade?: number | null;
    running_classwork_percentage?: number | null;
    completion_rate?: number | null;
    assigned_count: number;
    submitted_count: number;
    missing_count: number;
    late_count: number;
    graded_count: number;
    ungraded_count: number;
  };
  classwork_results: StudentClassworkResult[];
};

export type StudentRecordPeriodOption = {
  academic_year_id: number;
  academic_period_id: number;
  year_label: string;
  period_name: string;
  is_active: boolean;
  start_date: string;
  end_date: string;
};

export type StudentRecordPeriodOptionsResponse = {
  default_academic_period_id?: number | null;
  periods: StudentRecordPeriodOption[];
};

async function readStudentRecordResponse<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(data?.detail || fallback);
  }
  return (await response.json()) as T;
}

export async function getTeacherRecordPeriods(): Promise<StudentRecordPeriodOptionsResponse> {
  const response = await apiFetch("/api/v1/student-records/teacher/periods");
  return readStudentRecordResponse(response, "Unable to load record periods.");
}

export async function getTeacherStudentRoster(
  classId: string | number,
  subjectId: string | number,
  academicPeriodId?: string | number | null
): Promise<StudentRecordRosterResponse> {
  const query = new URLSearchParams();
  if (academicPeriodId) query.set("academic_period_id", String(academicPeriodId));
  const response = await apiFetch(
    `/api/v1/student-records/teacher/classes/${encodeURIComponent(String(classId))}`
      + `/subjects/${encodeURIComponent(String(subjectId))}/roster`
      + (query.toString() ? `?${query.toString()}` : "")
  );
  return readStudentRecordResponse(response, "Unable to load student records.");
}

export async function getTeacherStudentRecordDetail(
  classId: string | number,
  subjectId: string | number,
  studentId: string,
  academicPeriodId?: string | number | null
): Promise<StudentRecordDetailResponse> {
  const query = new URLSearchParams();
  if (academicPeriodId) query.set("academic_period_id", String(academicPeriodId));
  const response = await apiFetch(
    `/api/v1/student-records/teacher/classes/${encodeURIComponent(String(classId))}`
      + `/subjects/${encodeURIComponent(String(subjectId))}`
      + `/students/${encodeURIComponent(studentId)}`
      + (query.toString() ? `?${query.toString()}` : "")
  );
  return readStudentRecordResponse(response, "Unable to load student record detail.");
}
