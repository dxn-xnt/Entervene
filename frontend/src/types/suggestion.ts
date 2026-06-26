export type SuggestionResourceType = "LESSON" | "CLASSWORK";
export type SuggestionPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type SuggestionStatus = "DRAFT" | "ACTIVE" | "COMPLETED" | "DISMISSED" | "ARCHIVED";

export type SuggestionResourceSummary = {
  resource_type: SuggestionResourceType;
  title: string;
  subject_id: number;
  is_available: boolean;
  unavailable_reason?: string | null;
  lesson_id?: number | null;
  classwork_id?: number | null;
  classwork_assignment_id?: number | null;
  classwork_type?: string | null;
  class_id?: number | null;
};

export type SuggestionClassworkResponse = {
  suggestion_classwork_id: number;
  classwork_assignment_id: number;
  is_completed: boolean;
  completed_at?: string | null;
  score_before?: number | null;
  score_after?: number | null;
};

export type SuggestionResponse = {
  student_suggestion_id: number;
  suggestion_type: string;
  resource_type: SuggestionResourceType;
  title: string;
  description?: string | null;
  priority: SuggestionPriority;
  status: SuggestionStatus;
  is_viewed: boolean;
  viewed_at?: string | null;
  created_at?: string | null;
  student_id: string;
  subject_id: number;
  lesson_id?: number | null;
  created_by_staff_id?: string | null;
  resource: SuggestionResourceSummary;
  classwork_link?: SuggestionClassworkResponse | null;
  source_metrics?: Record<string, unknown> | null;
};

export type SuggestionListResponse = {
  suggestions: SuggestionResponse[];
};

export type ManualSuggestionCreate = {
  student_id: string;
  subject_id: number;
  resource_type: SuggestionResourceType;
  title: string;
  description?: string | null;
  priority: SuggestionPriority;
  lesson_id?: number | null;
  classwork_assignment_id?: number | null;
};

export type RecommendationDraftRequest = {
  class_id: number;
  subject_id: number;
  low_score_threshold?: number;
  limit?: number;
};
