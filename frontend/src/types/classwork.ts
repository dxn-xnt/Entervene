export type ClassworkType = "READING" | "ACTIVITY" | "ASSIGNMENT" | "QUIZ" | string;
export type ClassworkKind = "READING" | "ACTIVITY" | "ASSIGNMENT" | "QUIZ";
export type TabId = "all" | "readings" | "activities" | "assignments" | "quizzes";
export type SortMode = "newest" | "oldest" | "title";
export type CreateStep = "type" | "quiz-source" | "details" | "quiz" | "assign";

export type ClassworkAttachment = {
  classwork_attachment_id: number;
  file_name: string;
  file_type?: string;
  file_size: number;
  uploaded_at?: string | null;
};

export type ClassworkAssignment = {
  classwork_assignment_id: number;
  classwork_id: number;
  class_id: number;
  title?: string | null;
  due_date?: string | null;
  lock_date?: string | null;
  allow_late_submissions?: boolean;
  max_attempts?: number | null;
  is_published: boolean;
  is_locked?: boolean | null;
};

export type TeacherClasswork = {
  classwork_id: number;
  title: string;
  description?: string | null;
  instructions?: string | null;
  classwork_type: ClassworkType;
  classwork_category?: string | null;
  total_points?: number | null;
  is_published: boolean;
  is_locked: boolean;
  is_archived: boolean;
  subject_id: number;
  subject_name?: string | null;
  attachments: ClassworkAttachment[];
  assignments?: ClassworkAssignment[] | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type TeacherClassLoad = {
  subject_load_id: number;
  subject_id: number;
  subject_name: string;
  subject_codename?: string | null;
  class_id: number;
  section_name: string;
};

export type TeacherLesson = {
  lesson_id: number;
  title: string;
  order_index?: number;
  is_published: boolean;
  is_draft: boolean;
  subject_id: number;
};

export type TrackingStudent = {
  student_id: string;
  student_name: string;
  status: string;
  submission_id?: number | null;
  grade?: number | null;
  attachment_count?: number;
};

export type AssignmentTracking = {
  classwork_assignment_id: number;
  classwork_id: number;
  classwork_title?: string | null;
  total_students: number;
  submitted_count: number;
  missing_count: number;
  submitted: TrackingStudent[];
  missing: TrackingStudent[];
};

export type SubmissionAttachment = {
  submission_attachment_id: number;
  file_name: string;
  file_type?: string | null;
  file_size: number;
  uploaded_at?: string | null;
};

export type TeacherSubmissionDetail = {
  submission_id: number;
  student_id: string;
  student_name?: string | null;
  classwork_assignment_id: number;
  status: string;
  grade?: number | null;
  feedback?: string | null;
  submitted_at?: string | null;
  attachments: SubmissionAttachment[];
  total_points?: number | null;
};

export type CreateDraft = {
  subject_id: string;
  title: string;
  description: string;
  instructions: string;
  classwork_category: string;
  total_points: string;
  due_date: string;
  lock_date: string;
  allow_late_submissions: boolean;
  max_attempts: string;
  is_published: boolean;
};

export type EditDraft = {
  title: string;
  description: string;
  instructions: string;
  classwork_type: string;
  classwork_category: string;
  total_points: string;
  due_date: string;
  lock_date: string;
  allow_late_submissions: boolean;
  max_attempts: string;
  is_published: boolean;
};
