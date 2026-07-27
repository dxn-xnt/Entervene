export interface StudentLessonAttachment {
  lesson_attachment_id: number;
  file_name: string;
  file_type?: string;
  file_size: number;
  uploaded_at?: string;
}

export interface StudentLesson {
  lesson_id: number;
  title: string;
  description?: string | null;
  content?: string | null;
  subject_name?: string;
  teacher_name?: string;
  is_published: boolean;
  created_at?: string;
  updated_at?: string;
  attachments: StudentLessonAttachment[];
}
