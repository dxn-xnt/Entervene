export type TeacherClassLoad = {
  subject_load_id: number;
  subject_id: number;
  subject_name: string;
  subject_codename?: string | null;
  class_id: number;
  section_name: string;
};

export type LessonAttachment = {
  lesson_attachment_id: number;
  file_name: string;
  file_type?: string;
  file_size: number;
  uploaded_at?: string;
};

export type Lesson = {
  lesson_id: number;
  title: string;
  description?: string | null;
  content?: string | null;
  order_index: number;
  created_at?: string;
  updated_at?: string;
  is_published: boolean;
  is_draft: boolean;
  is_archived: boolean;
  attachments: LessonAttachment[];
};

export type LessonDraft = {
  title: string;
  description: string;
  content: string;
  order_index: string;
  is_published: boolean;
};

export type LinkedClasswork = {
  classwork_assignment_id: number;
  classwork_id: number;
  title: string;
  classwork_type?: string | null;
  due_date?: string | null;
  attachment_count?: number;
};

export type ClassworkAttachment = {
  classwork_attachment_id: number;
  file_name: string;
  file_type?: string;
  file_size: number;
  uploaded_at?: string;
};

export type ClassworkDetail = {
  classwork_assignment_id: number;
  classwork_id: number;
  class_id: number;
  section_name?: string | null;
  title: string;
  description?: string | null;
  instructions?: string | null;
  classwork_type?: string | null;
  classwork_category?: string | null;
  total_points?: number | null;
  due_date?: string | null;
  is_published: boolean;
  is_locked?: boolean;
  teacher_name?: string | null;
  attachments: ClassworkAttachment[];
};

export type TrackingStudent = {
  student_id: string;
  student_name: string;
  status: string;
  submitted_at?: string | null;
  grade?: number | null;
  attachment_count?: number;
};

export type SubmissionTracking = {
  total_students: number;
  submitted_count: number;
  missing_count: number;
  submitted: TrackingStudent[];
  missing: TrackingStudent[];
};

export type ClassworkDraft = {
  title: string;
  description: string;
  instructions: string;
  classwork_type: string;
  classwork_category: string;
  total_points: string;
  due_date: string;
  allow_late_submissions: boolean;
  is_published: boolean;
};
