import { useEffect, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  FileText,
  Paperclip,
  X,
} from "lucide-react";
import AttachmentDisplay from "@/components/AttachmentDisplay";
import SubmissionForm from "@/components/SubmissionForm";
import SubmissionViewer from "@/components/SubmissionViewer";
import { apiFetch } from "@/lib/api";

interface LessonAttachment {
  lesson_attachment_id: number;
  file_name: string;
  file_type?: string;
  file_size: number;
  uploaded_at?: string;
}

interface Lesson {
  lesson_id: number;
  title: string;
  description?: string;
  content?: string;
  subject_name?: string;
  teacher_name?: string;
  is_published: boolean;
  created_at?: string;
  updated_at?: string;
  attachments: LessonAttachment[];
}

interface ClassworkAttachment {
  classwork_attachment_id: number;
  file_name: string;
  file_type?: string;
  file_size: number;
  uploaded_at?: string;
}

interface LessonClasswork {
  classwork_assignment_id: number;
  classwork_id: number;
  title: string;
  classwork_type?: string | null;
  total_points?: number | null;
  due_date?: string | null;
  submission_status?: string | null;
}

interface ClassworkDetail {
  classwork_assignment_id: number;
  classwork_id: number;
  title: string;
  description?: string | null;
  instructions?: string | null;
  classwork_type?: string | null;
  classwork_category?: string | null;
  total_points?: number | null;
  due_date?: string | null;
  is_published: boolean;
  is_locked?: boolean;
  max_attempts?: number;
  teacher_name?: string | null;
  submission_status?: string | null;
  attachments: ClassworkAttachment[];
}

interface Submission {
  submission_id: number;
  classwork_assignment_id?: number;
  status: string;
  submitted_at?: string;
  grade?: number;
  feedback?: string;
  attempt_count: number;
  attachments: Array<{
    submission_attachment_id: number;
    file_name: string;
    file_type?: string;
    file_size: number;
    uploaded_at?: string;
  }>;
}

type SubjectLessonTabProps = {
  classId?: number;
  subjectId?: number;
  subject?: string;
};

export default function SubjectLessonTab({ classId, subjectId }: SubjectLessonTabProps) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [classworksByLesson, setClassworksByLesson] = useState<Record<number, LessonClasswork[]>>({});
  const [classworkLoadingId, setClassworkLoadingId] = useState<number | null>(null);
  const [selectedClasswork, setSelectedClasswork] = useState<ClassworkDetail | null>(null);
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    if (classId && subjectId) {
      fetchLessons();
    } else {
      setIsLoading(false);
    }
  }, [classId, subjectId]);

  const fetchLessons = async () => {
    if (!classId || !subjectId) return;

    setIsLoading(true);
    setError("");

    try {
      const response = await apiFetch(`/api/v1/lessons/class/${classId}/subject/${subjectId}`);

      if (!response.ok) {
        throw new Error("Failed to fetch lessons");
      }

      const data = await response.json();
      setLessons(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch lessons");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchLessonClassworks = async (lessonId: number) => {
    if (!classId || classworksByLesson[lessonId]) return;

    setClassworkLoadingId(lessonId);
    setError("");

    try {
      const response = await apiFetch(
        `/api/v1/lessons/${lessonId}/classwork-assignments?class_id=${classId}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch classworks for this lesson");
      }

      const data = (await response.json()) as LessonClasswork[];
      setClassworksByLesson((current) => ({ ...current, [lessonId]: data }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch classworks");
    } finally {
      setClassworkLoadingId(null);
    }
  };

  const toggleLesson = async (lessonId: number) => {
    const nextExpandedId = expandedId === lessonId ? null : lessonId;
    setExpandedId(nextExpandedId);

    if (nextExpandedId) {
      await fetchLessonClassworks(lessonId);
    }
  };

  const fetchSubmissionForAssignment = async (assignmentId: number) => {
    const response = await apiFetch("/api/v1/submissions/my-submissions");
    if (!response.ok) return null;

    const submissions = (await response.json()) as Submission[];
    return submissions.find((submission) => submission.classwork_assignment_id === assignmentId) ?? null;
  };

  const openClassworkDetail = async (classwork: LessonClasswork) => {
    setDetailLoadingId(classwork.classwork_assignment_id);
    setDetailError("");

    try {
      const detailResponse = await apiFetch(
        `/api/v1/classwork-assignments/assignment/${classwork.classwork_assignment_id}`
      );

      if (!detailResponse.ok) {
        throw new Error("Unable to load classwork details.");
      }

      const detail = (await detailResponse.json()) as ClassworkDetail;
      const submission = await fetchSubmissionForAssignment(classwork.classwork_assignment_id);
      setSelectedClasswork(detail);
      setSelectedSubmission(submission);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Unable to load classwork details.");
    } finally {
      setDetailLoadingId(null);
    }
  };

  const closeClassworkDetail = () => {
    setSelectedClasswork(null);
    setSelectedSubmission(null);
    setDetailError("");
  };

  const updateClassworkStatus = (assignmentId: number, status: string) => {
    setClassworksByLesson((current) => {
      const next = { ...current };
      Object.keys(next).forEach((lessonId) => {
        next[Number(lessonId)] = next[Number(lessonId)].map((classwork) =>
          classwork.classwork_assignment_id === assignmentId
            ? { ...classwork, submission_status: status }
            : classwork
        );
      });
      return next;
    });
  };

  const handleSubmit = async (assignmentId: number, files: File[]) => {
    setSubmittingId(assignmentId);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));

      const response = await apiFetch(`/api/v1/submissions/assignment/${assignmentId}/submit`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to submit classwork.");
      }

      const submission = (await response.json()) as Submission;
      setSelectedSubmission(submission);
      updateClassworkStatus(assignmentId, submission.status);
    } finally {
      setSubmittingId(null);
    }
  };

  const handleDeleteSubmission = async (assignmentId: number) => {
    setDeletingId(assignmentId);
    try {
      const response = await apiFetch(`/api/v1/submissions/assignment/${assignmentId}/submit`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete submission.");
      }

      setSelectedSubmission(null);
      updateClassworkStatus(assignmentId, "not_submitted_yet");
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateString?: string | null) => {
    return dateString ? new Date(dateString).toLocaleDateString() : "No due date";
  };

  const statusLabel = (status?: string | null) => {
    if (!status) return "Not submitted";
    return status.replace(/_/g, " ");
  };

  if (isLoading) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Loading lessons...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-500 mb-4">{error}</p>
        <button
          onClick={fetchLessons}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (lessons.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">No lessons available for this subject</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-semibold text-gray-900">Lessons</h3>

      {lessons.map((lesson) => {
        const isExpanded = expandedId === lesson.lesson_id;
        const classworks = classworksByLesson[lesson.lesson_id] ?? [];

        return (
          <div
            key={lesson.lesson_id}
            className="border border-gray-200 rounded-lg overflow-hidden bg-white"
          >
            <button
              onClick={() => toggleLesson(lesson.lesson_id)}
              className="w-full px-4 py-4 flex items-start justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex-1 text-left">
                <h4 className="font-semibold text-gray-900 mb-2">{lesson.title}</h4>
                <div className="text-sm text-gray-600 space-y-1">
                  {lesson.teacher_name && (
                    <p>
                      <span className="font-medium">Teacher:</span> {lesson.teacher_name}
                    </p>
                  )}
                  {lesson.attachments?.length > 0 && (
                    <p>
                      <span className="font-medium">Files:</span> {lesson.attachments.length} attachment(s)
                    </p>
                  )}
                  {classworks.length > 0 && (
                    <p>
                      <span className="font-medium">Classworks:</span> {classworks.length} linked
                    </p>
                  )}
                </div>
              </div>

              <div className="ml-4">
                {isExpanded ? (
                  <ChevronUp className="text-gray-500" />
                ) : (
                  <ChevronDown className="text-gray-500" />
                )}
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-gray-200 px-4 py-4 bg-gray-50 space-y-4">
                {lesson.description && (
                  <div>
                    <h5 className="font-medium text-gray-900 mb-1">Description</h5>
                    <p className="text-sm text-gray-700">{lesson.description}</p>
                  </div>
                )}

                {lesson.content && (
                  <div>
                    <h5 className="font-medium text-gray-900 mb-1">Content</h5>
                    <div className="text-sm text-gray-700 whitespace-pre-wrap bg-white p-3 rounded border border-gray-200 max-h-64 overflow-y-auto">
                      {lesson.content}
                    </div>
                  </div>
                )}

                {lesson.attachments?.length > 0 && (
                  <div>
                    <h5 className="font-medium text-gray-900 mb-2">Attachments</h5>
                    <AttachmentDisplay attachments={lesson.attachments} type="lesson" />
                  </div>
                )}

                <div>
                  <h5 className="font-medium text-gray-900 mb-2">Classworks linked to this lesson</h5>
                  {classworkLoadingId === lesson.lesson_id ? (
                    <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600">
                      Loading classworks...
                    </div>
                  ) : classworks.length > 0 ? (
                    <div className="grid gap-2">
                      {classworks.map((classwork) => (
                        <button
                          key={classwork.classwork_assignment_id}
                          type="button"
                          onClick={() => openClassworkDetail(classwork)}
                          className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left transition-colors hover:bg-gray-50"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-[#F6E9B2]">
                              <ClipboardList size={18} />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-gray-900">{classwork.title}</p>
                              <p className="text-xs text-gray-600">
                                {classwork.classwork_type || "Classwork"} | Due {formatDate(classwork.due_date)}
                              </p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium capitalize text-blue-700">
                              {statusLabel(classwork.submission_status)}
                            </span>
                            <ChevronRight size={16} className="text-gray-500" />
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
                      No classworks linked to this lesson.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {(selectedClasswork || detailLoadingId || detailError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <section className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <div className="sticky top-0 flex items-center justify-between border-b border-black bg-[#F6E9B2] px-5 py-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-gray-700">
                  Student classwork detail
                </p>
                <h2 className="text-xl font-bold">{selectedClasswork?.title || "Classwork"}</h2>
              </div>
              <button type="button" onClick={closeClassworkDetail} className="rounded p-1 hover:bg-white/60">
                <X size={18} />
              </button>
            </div>

            {detailLoadingId ? (
              <div className="p-8 text-center text-sm font-semibold text-gray-600">
                Loading classwork details...
              </div>
            ) : detailError ? (
              <div className="m-5 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                {detailError}
              </div>
            ) : selectedClasswork ? (
              <div className="grid gap-5 p-5 lg:grid-cols-[1.2fr_1fr]">
                <div className="space-y-4">
                  <div className="rounded-lg border border-black bg-white p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-black bg-[#7ABA78] px-3 py-1 text-xs font-bold">
                        {selectedClasswork.classwork_type || "Classwork"}
                      </span>
                      <span className="rounded-full border border-gray-300 px-3 py-1 text-xs font-semibold capitalize">
                        {statusLabel(selectedSubmission?.status ?? selectedClasswork.submission_status)}
                      </span>
                    </div>
                    <h3 className="mt-4 text-3xl font-bold">{selectedClasswork.title}</h3>
                    <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="mb-1 flex items-center gap-1 font-semibold text-gray-600">
                          <CalendarDays size={14} />
                          Due
                        </div>
                        <p className="font-bold">
                          {selectedClasswork.due_date
                            ? new Date(selectedClasswork.due_date).toLocaleString()
                            : "No due date"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3">
                        <p className="font-semibold text-gray-600">Points</p>
                        <p className="font-bold">{selectedClasswork.total_points ?? "Not set"}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3">
                        <p className="font-semibold text-gray-600">Teacher</p>
                        <p className="font-bold">{selectedClasswork.teacher_name || "Teacher"}</p>
                      </div>
                    </div>
                  </div>

                  {(selectedClasswork.description || selectedClasswork.instructions) && (
                    <div className="rounded-lg border border-black bg-white p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                      {selectedClasswork.description && (
                        <div>
                          <h4 className="font-bold">Description</h4>
                          <p className="mt-1 text-sm text-gray-700">{selectedClasswork.description}</p>
                        </div>
                      )}
                      {selectedClasswork.instructions && (
                        <div className="mt-4">
                          <h4 className="font-bold">Instructions</h4>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
                            {selectedClasswork.instructions}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="rounded-lg border border-black bg-white p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                    <div className="mb-3 flex items-center gap-2">
                      <Paperclip size={18} />
                      <h4 className="font-bold">Reference Files</h4>
                    </div>
                    {selectedClasswork.attachments?.length ? (
                      <AttachmentDisplay attachments={selectedClasswork.attachments} type="classwork" />
                    ) : (
                      <p className="text-sm text-gray-600">No reference files attached.</p>
                    )}
                  </div>
                </div>

                <aside className="rounded-lg border border-black bg-[#F6E9B2] p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                  <div className="mb-3 flex items-center gap-2">
                    {selectedSubmission ? <FileText size={18} /> : <BookOpen size={18} />}
                    <h3 className="font-bold">
                      {selectedSubmission ? "Your Submission" : "Submit Your Work"}
                    </h3>
                  </div>
                  {selectedSubmission ? (
                    <SubmissionViewer
                      submission={selectedSubmission}
                      dueDate={selectedClasswork.due_date ?? undefined}
                      isLocked={selectedClasswork.is_locked}
                      maxAttempts={selectedClasswork.max_attempts}
                      onDeleteSubmission={() =>
                        handleDeleteSubmission(selectedClasswork.classwork_assignment_id)
                      }
                      onResubmit={async () => {
                        const submission = await fetchSubmissionForAssignment(selectedClasswork.classwork_assignment_id);
                        setSelectedSubmission(submission);
                      }}
                      isDeleting={deletingId === selectedClasswork.classwork_assignment_id}
                    />
                  ) : (
                    <SubmissionForm
                      assignmentId={selectedClasswork.classwork_assignment_id}
                      maxAttempts={selectedClasswork.max_attempts}
                      currentAttempt={0}
                      isLoading={submittingId === selectedClasswork.classwork_assignment_id}
                      onSubmit={(files) => handleSubmit(selectedClasswork.classwork_assignment_id, files)}
                    />
                  )}
                </aside>
              </div>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
