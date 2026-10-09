export interface ClassworkAttachment {
  classwork_attachment_id: number;
  file_name: string;
  file_type?: string;
  file_size: number;
  uploaded_at?: string;
}

export interface LinkedLessonAttachment {
  lesson_attachment_id: number;
  file_name: string;
  file_type?: string;
  file_size: number;
  uploaded_at?: string;
}

export interface LinkedReading {
  classwork_id: number;
  title: string;
  description?: string | null;
  instructions?: string | null;
  activity_mode?: string;
}

export interface LinkedLesson {
  lesson_id: number;
  title: string;
  description?: string | null;
  attachments?: LinkedLessonAttachment[];
  readings?: LinkedReading[];
}

export interface LessonClasswork {
  classwork_assignment_id: number;
  classwork_id: number;
  title: string;
  classwork_type?: string | null;
  classwork_category?: string | null;
  is_graded?: boolean;
  total_points?: number | null;
  due_date?: string | null;
  allow_late_submissions?: boolean;
  submission_status?: string | null;
}

export interface ClassworkDetail {
  classwork_assignment_id: number;
  classwork_id: number;
  title: string;
  description?: string | null;
  instructions?: string | null;
  classwork_type?: string | null;
  classwork_category?: string | null;
  is_graded?: boolean;
  total_points?: number | null;
  due_date?: string | null;
  allow_late_submissions?: boolean;
  is_published: boolean;
  show_scores?: boolean;
  is_locked?: boolean;
  max_attempts?: number;
  teacher_name?: string | null;
  submission_status?: string | null;
  attachments: ClassworkAttachment[];
  linked_lessons?: LinkedLesson[];
}

export interface SubmissionAttachment {
  submission_attachment_id: number;
  file_name: string;
  file_type?: string;
  file_size: number;
  uploaded_at?: string;
}

export interface Submission {
  submission_id: number;
  classwork_assignment_id?: number;
  status: string;
  submitted_at?: string;
  grade?: number;
  feedback?: string;
  attempt_count: number;
  attachments: SubmissionAttachment[];
}

export interface QuizAttemptOption {
  option_id: number;
  option_text: string;
  option_order: number;
  is_correct?: boolean | null;
}

export interface QuizAttemptQuestion {
  quiz_question_id: number;
  question_text: string;
  question_type: "MULTIPLE_CHOICE" | "SHORT_ANSWER" | string;
  points: number;
  display_order: number;
  options: QuizAttemptOption[];
  answer_text?: string | null;
  selected_option_id?: number | null;
  points_awarded?: number | null;
  is_correct?: boolean | null;
}

export interface QuizAttempt {
  quiz_id: number;
  classwork_assignment_id: number;
  classwork_id: number;
  title: string;
  instructions?: string | null;
  total_points?: number | null;
  duration_minutes?: number | null;
  max_attempts: number;
  attempt_count: number;
  status: string;
  started_at?: string | null;
  server_time?: string | null;
  submitted_at?: string | null;
  grade?: number | null;
  can_submit: boolean;
  summary_available: boolean;
  summary_release_mode:
    | "IMMEDIATE"
    | "SCHEDULED"
    | "AFTER_DUE_DATE"
    | "NEVER"
    | string;
  summary_release_at?: string | null;
  summary_message?: string | null;
  questions: QuizAttemptQuestion[];
}

export type SubjectLessonTabProps = {
  classId?: number;
  subjectId?: number;
  subject?: string;
  subjectName?: string;
  teacherName?: string;
  onLessonSelect?: (lessonId: number) => void;
};
