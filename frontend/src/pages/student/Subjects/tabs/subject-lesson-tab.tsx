import { useEffect, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  ArrowUpDown,
  ClipboardList,
  BookOpen,
  FileText,
  Info,
  X,
  CalendarDays,
  Paperclip,
} from "lucide-react";
import AttachmentDisplay from "@/components/AttachmentDisplay";
import SubmissionForm from "@/components/SubmissionForm";
import SubmissionViewer from "@/components/SubmissionViewer";
import { API_URL, apiFetch } from "@/lib/api";

const LOCKED_CLASSWORK_MESSAGE =
  "This classwork is not available yet. Please check back later or contact your teacher for more information.";

// ─── Interfaces ────────────────────────────────────────────────────────────

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
  description?: string | null;
  content?: string | null;
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
  subjectName?: string;
  teacherName?: string;
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function getStatusBadge(status?: string | null, dueDate?: string | null) {
  if (status === "graded" || status === "submitted") {
    return { label: "Done", cls: "bg-gray-200 text-gray-600 border border-gray-300" };
  }
  if (status === "late") {
    return { label: "Late", cls: "bg-[#FF4B4B] text-white" };
  }
  if (!dueDate) return null;
  const diffDays = Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86_400_000);
  if (diffDays < 0) return { label: `${Math.abs(diffDays)} days late`, cls: "bg-[#FF4B4B] text-white" };
  if (diffDays === 0) return { label: "Due today", cls: "bg-orange-400 text-white" };
  return { label: `Due in ${diffDays} days`, cls: "bg-[#7ABA78] text-white" };
}

function isReadingType(value?: string | null) {
  return value?.toUpperCase() === "READING";
}

function ClassworkIcon({ type, size = 16 }: { type?: string | null; size?: number }) {
  switch (type?.toLowerCase()) {
    case "quiz": return <ClipboardList size={size} />;
    case "assignment": return <BookOpen size={size} />;
    default: return <FileText size={size} />;
  }
}

function fmtDate(dateStr?: string | null) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
}

function statusLabel(s?: string | null) {
  if (!s) return "Not submitted";
  return s.replace(/_/g, " ");
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function SubjectLessonTab({
  classId,
  subjectId,
  subjectName: propSubjectName,
  teacherName: propTeacherName,
}: SubjectLessonTabProps) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [classworksByLesson, setClassworksByLesson] = useState<Record<number, LessonClasswork[]>>({});
  const [classworkLoadingId, setClassworkLoadingId] = useState<number | null>(null);
  const [selectedClasswork, setSelectedClasswork] = useState<ClassworkDetail | null>(null);
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [detailError, setDetailError] = useState("");
  const [subjectInfo, setSubjectInfo] = useState<{ subject_name: string; teacher_name: string } | null>(null);
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    if (classId && subjectId) {
      fetchLessons();
      if (!propSubjectName) fetchSubjectInfo();
    } else {
      setIsLoading(false);
    }
  }, [classId, subjectId]);

  const fetchSubjectInfo = async () => {
    try {
      const res = await apiFetch("/api/v1/students/me/subjects");
      if (!res.ok) return;
      const data = await res.json();
      const match = data.find(
        (s: { class_id: number; subject_id: number; subject_name: string; teacher_name: string }) =>
          s.class_id === classId && s.subject_id === subjectId,
      );
      if (match) setSubjectInfo({ subject_name: match.subject_name, teacher_name: match.teacher_name });
    } catch {
      // The lesson list remains usable when optional subject metadata is unavailable.
    }
  };

  const fetchLessons = async () => {
    if (!classId || !subjectId) return;
    setIsLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/v1/lessons/class/${classId}/subject/${subjectId}`);
      if (!res.ok) throw new Error("Failed to fetch lessons");
      const data: Lesson[] = await res.json();
      setLessons(data);
      // Pre-fetch classworks for all lessons in the background
      fetchAllClassworks(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch lessons");
    } finally {
      setIsLoading(false);
    }
  };

  /** Fetch classworks for every lesson in parallel (background, for Weekly Goals). */
  const fetchAllClassworks = (lessonList: Lesson[]) => {
    if (!classId) return;
    lessonList.forEach(async (lesson) => {
      // Skip if already loaded or being loaded by accordion toggle
      setClassworksByLesson((prev) => {
        if (prev[lesson.lesson_id] !== undefined) return prev;
        // Mark as "in flight" with undefined so we don't double-fetch
        return { ...prev };
      });
      try {
        const res = await apiFetch(
          `/api/v1/lessons/${lesson.lesson_id}/classwork-assignments?class_id=${classId}`,
        );
        const data = res.ok ? ((await res.json()) as LessonClasswork[]) : [];
        setClassworksByLesson((prev) => ({
          ...prev,
          [lesson.lesson_id]: prev[lesson.lesson_id] ?? data,
        }));
      } catch {
        setClassworksByLesson((prev) => ({
          ...prev,
          [lesson.lesson_id]: prev[lesson.lesson_id] ?? [],
        }));
      }
    });
  };

  const fetchLessonClassworks = async (lessonId: number) => {
    if (!classId || classworksByLesson[lessonId] !== undefined) return;
    setClassworkLoadingId(lessonId);
    try {
      const res = await apiFetch(`/api/v1/lessons/${lessonId}/classwork-assignments?class_id=${classId}`);
      const data = res.ok ? ((await res.json()) as LessonClasswork[]) : [];
      setClassworksByLesson((prev) => ({ ...prev, [lessonId]: data }));
    } catch {
      setClassworksByLesson((prev) => ({ ...prev, [lessonId]: [] }));
    } finally {
      setClassworkLoadingId(null);
    }
  };

  const toggleLesson = async (lessonId: number) => {
    const next = expandedId === lessonId ? null : lessonId;
    setExpandedId(next);
    if (next) await fetchLessonClassworks(lessonId);
  };

  const fetchSubmissionForAssignment = async (assignmentId: number) => {
    const res = await apiFetch("/api/v1/submissions/my-submissions");
    if (!res.ok) return null;
    const subs = (await res.json()) as Submission[];
    return subs.find((s) => s.classwork_assignment_id === assignmentId) ?? null;
  };

  const openClassworkDetail = async (cw: LessonClasswork) => {
    setDetailLoadingId(cw.classwork_assignment_id);
    setDetailError("");
    try {
      const res = await apiFetch(`/api/v1/classwork-assignments/assignment/${cw.classwork_assignment_id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const detail = String(body.detail || "");
        throw new Error(
          detail.includes("locked") || detail.includes("not available")
            ? LOCKED_CLASSWORK_MESSAGE
            : "Unable to load classwork details.",
        );
      }
      const detail = (await res.json()) as ClassworkDetail;
      const submission = await fetchSubmissionForAssignment(cw.classwork_assignment_id);
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
    setClassworksByLesson((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((lid) => {
        next[Number(lid)] = next[Number(lid)].map((cw) =>
          cw.classwork_assignment_id === assignmentId ? { ...cw, submission_status: status } : cw,
        );
      });
      return next;
    });
  };

  const handleSubmit = async (assignmentId: number, files: File[]) => {
    setSubmittingId(assignmentId);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      const res = await apiFetch(`/api/v1/submissions/assignment/${assignmentId}/submit`, { method: "POST", body: fd });
      if (!res.ok) throw new Error("Failed to submit.");
      const sub = (await res.json()) as Submission;
      setSelectedSubmission(sub);
      updateClassworkStatus(assignmentId, sub.status);
    } finally {
      setSubmittingId(null);
    }
  };

  const handleDeleteSubmission = async (assignmentId: number) => {
    setDeletingId(assignmentId);
    try {
      const res = await apiFetch(`/api/v1/submissions/assignment/${assignmentId}/submit`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete.");
      setSelectedSubmission(null);
      updateClassworkStatus(assignmentId, "not_submitted_yet");
    } finally {
      setDeletingId(null);
    }
  };

  // Derived values
  const displaySubjectName = propSubjectName ?? subjectInfo?.subject_name ?? "—";
  const displayTeacherName = propTeacherName ?? subjectInfo?.teacher_name ?? "";

  const allClassworks = Object.values(classworksByLesson).flat();
  const hasOverdue = allClassworks.some(
    (cw) =>
      cw.submission_status === "missing" ||
      (cw.due_date &&
        new Date(cw.due_date) < new Date() &&
        !["submitted", "graded"].includes(cw.submission_status ?? "")),
  );

  const sortedLessons = [...lessons].sort((a, b) => {
    const da = new Date(a.created_at ?? 0).getTime();
    const db = new Date(b.created_at ?? 0).getTime();
    return sortAsc ? da - db : db - da;
  });

  // ─── Loading skeleton ──────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-20 rounded-lg border border-black bg-[#F6E9B2] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
        <div className="h-12 rounded-lg border border-black bg-pink-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-lg border border-black bg-[#F6E9B2] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
        ))}
      </div>
    );
  }

  // ─── Error state ───────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="text-center py-10">
        <p className="text-red-500 mb-4">{error}</p>
        <button
          onClick={fetchLessons}
          className="px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors font-semibold"
        >
          Retry
        </button>
      </div>
    );
  }

  // ─── Main render ───────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* ── Subject info card ── */}
      <div className="rounded-lg border border-black bg-[#F6E9B2] px-5 py-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold">{displaySubjectName}</h2>
          <p className="text-sm text-gray-600 mt-0.5">{displayTeacherName}</p>
        </div>
        <button className="text-gray-500 hover:text-gray-800 transition-colors mt-0.5">
          <Info size={18} />
        </button>
      </div>

      {/* ── Activity overdue banner ── */}
      {hasOverdue && (
        <div className="rounded-lg border border-black bg-[#F4B8C1] px-5 py-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <p className="font-bold text-sm">Activity Overdue</p>
          <p className="text-xs text-gray-700 mt-0.5">
            You still have pending activities. Complete them as soon as possible.
          </p>
        </div>
      )}

      {/* ── Empty state ── */}
      {lessons.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-gray-500 gap-2">
          <BookOpen size={40} className="opacity-30" />
          <p>No lessons available for this subject.</p>
        </div>
      ) : (
        <div className="flex gap-4 items-start">
          {/* ════════════════ LEFT: Lessons list ════════════════ */}
          <div className="flex-1 min-w-0">
            {/* Lessons header row */}
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xl font-bold">Lessons</h3>
              <button
                onClick={() => setSortAsc((v) => !v)}
                className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-md px-2.5 py-1.5 transition-colors"
              >
                <ArrowUpDown size={13} />
                Sort By
              </button>
            </div>

            <div className="space-y-2">
              {sortedLessons.map((lesson) => {
                const isExpanded = expandedId === lesson.lesson_id;
                const classworks = classworksByLesson[lesson.lesson_id] ?? [];

                return (
                  <div key={lesson.lesson_id}>
                    {/* ── Lesson card ── */}
                    <button
                      onClick={() => toggleLesson(lesson.lesson_id)}
                      className="w-full rounded-lg border border-black bg-[#F6E9B2] px-5 py-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center justify-between hover:bg-[#f0e09a] transition-colors text-left"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-bold text-lg leading-tight">{lesson.title}</h4>
                          {lesson.attachments.length > 0 && (
                            <span className="rounded-full border border-black bg-[#7ABA78] px-2 py-0.5 text-[10px] font-bold">
                              {lesson.attachments.length} material{lesson.attachments.length === 1 ? "" : "s"}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 mt-0.5">
                          {lesson.description ||
                            (lesson.updated_at
                              ? `Updated ${fmtDate(lesson.updated_at)}`
                              : lesson.created_at
                                ? `Created ${fmtDate(lesson.created_at)}`
                                : "")}
                        </p>
                      </div>
                      {isExpanded ? (
                        <ChevronDown size={20} className="shrink-0 text-gray-700" />
                      ) : (
                        <ChevronRight size={20} className="shrink-0 text-gray-700" />
                      )}
                    </button>

                    {/* ── Inline classwork items (expanded) ── */}
                    {isExpanded && (
                      <div className="mt-2 space-y-2 pl-3">
                        <section className="rounded-lg border border-black bg-white p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                          <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-black bg-[#F6E9B2]">
                              <BookOpen size={19} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h5 className="font-bold">Lesson Overview</h5>
                              {lesson.description ? (
                                <p className="mt-1 text-sm text-gray-700">{lesson.description}</p>
                              ) : (
                                <p className="mt-1 text-sm text-gray-500">No lesson description provided.</p>
                              )}
                            </div>
                          </div>

                          {lesson.content ? (
                            <div className="mt-4 rounded-lg border border-gray-200 bg-[#FFFBEE] p-4">
                              <h5 className="mb-2 text-sm font-bold">Lesson Content</h5>
                              <p className="whitespace-pre-wrap text-sm leading-6 text-gray-800">
                                {lesson.content}
                              </p>
                            </div>
                          ) : (
                            <p className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                              This lesson has no written content yet.
                            </p>
                          )}
                        </section>

                        <section className="rounded-lg border border-black bg-white p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                          <div className="mb-3 flex items-center gap-2">
                            <Paperclip size={18} />
                            <div>
                              <h5 className="font-bold">Lesson Materials</h5>
                              <p className="text-xs text-gray-500">Open or download the teacher-provided study files.</p>
                            </div>
                          </div>
                          {lesson.attachments.length > 0 ? (
                            <AttachmentDisplay
                              attachments={lesson.attachments}
                              type="lesson"
                              downloadUrl={(attachmentId) =>
                                `${API_URL}/api/v1/lessons/${lesson.lesson_id}/attachments/${attachmentId}/download`
                              }
                            />
                          ) : (
                            <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                              No lesson materials attached.
                            </p>
                          )}
                        </section>

                        <div className="flex items-center gap-2 px-1 pt-2">
                          <ClipboardList size={17} />
                          <h5 className="font-bold">Linked Classwork</h5>
                        </div>
                        {classworkLoadingId === lesson.lesson_id ? (
                          <div className="text-center py-4 text-sm text-gray-400">
                            Loading classworks...
                          </div>
                        ) : classworks.length === 0 ? (
                          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-400">
                            No classworks linked to this lesson.
                          </div>
                        ) : (
                          classworks.map((cw) => {
                            const badge = getStatusBadge(cw.submission_status, cw.due_date);
                            const isLoading = detailLoadingId === cw.classwork_assignment_id;
                            return (
                              <button
                                key={cw.classwork_assignment_id}
                                onClick={() => openClassworkDetail(cw)}
                                disabled={isLoading}
                                className="w-full rounded-lg border border-black bg-white px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                              >
                                {/* Icon */}
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-black bg-[#F6E9B2]">
                                  <ClassworkIcon type={cw.classwork_type} />
                                </div>
                                {/* Title + date */}
                                <div className="flex-1 min-w-0">
                                  <p className="font-semibold text-sm truncate">{cw.title}</p>
                                  <p className="text-xs text-gray-500 mt-0.5">
                                    {cw.due_date ? `Scheduled ${fmtDate(cw.due_date)}` : "No due date"}
                                  </p>
                                </div>
                                {/* Badge + spinner */}
                                <div className="flex items-center gap-2 shrink-0">
                                  {badge && (
                                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${badge.cls}`}>
                                      {badge.label}
                                    </span>
                                  )}
                                  {isLoading && (
                                    <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                                  )}
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ════════════════ RIGHT: Weekly Goals ════════════════ */}
          <div className="w-72 shrink-0">
            <h3 className="text-xl font-bold mb-3">Weekly Goals</h3>
            <div className="rounded-lg border border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4 max-h-[70vh] overflow-y-auto space-y-5">
              {sortedLessons.map((lesson) => {
                const cws = classworksByLesson[lesson.lesson_id];
                const isHighlighted = expandedId === lesson.lesson_id;
                const isLoadingCws = cws === undefined;

                return (
                  <div
                    key={lesson.lesson_id}
                    className={`rounded-lg transition-all ${
                      isHighlighted
                        ? "ring-2 ring-black ring-offset-1 bg-[#FFFBEE] p-2"
                        : ""
                    }`}
                  >
                    {/* Lesson header */}
                    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 mb-3">
                      <p className="text-xs font-bold text-gray-700 leading-snug line-clamp-2">
                        {lesson.title}
                      </p>
                    </div>

                    {/* Timeline */}
                    {isLoadingCws ? (
                      <div className="flex items-center gap-2 pl-4 py-1">
                        <div className="w-3 h-3 rounded-full border-2 border-gray-300 bg-gray-200 animate-pulse shrink-0" />
                        <p className="text-xs text-gray-400">Loading...</p>
                      </div>
                    ) : (
                      <div className="relative">
                        {/* Lesson Completion */}
                        <TimelineItem isLast={cws.length === 0} dot="filled">
                          <div className="rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 w-full">
                            Lesson Completion
                          </div>
                        </TimelineItem>

                        {/* Classwork items */}
                        {cws.length === 0 ? (
                          <p className="text-[11px] text-gray-400 pl-6 mt-1">No classworks linked</p>
                        ) : (
                          cws.map((cw, idx) => {
                            const badge = getStatusBadge(cw.submission_status, cw.due_date);
                            return (
                              <TimelineItem
                                key={cw.classwork_assignment_id}
                                isLast={idx === cws.length - 1}
                                dot="empty"
                              >
                                <div className="flex items-center justify-between gap-2 w-full min-w-0">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="text-gray-500 shrink-0">
                                      <ClassworkIcon type={cw.classwork_type} size={13} />
                                    </span>
                                    <p className="text-xs font-medium truncate">{cw.title}</p>
                                  </div>
                                  {badge && (
                                    <span
                                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 whitespace-nowrap ${badge.cls}`}
                                    >
                                      {badge.label}
                                    </span>
                                  )}
                                </div>
                              </TimelineItem>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════ Classwork Detail Modal ════════════════ */}
      {(selectedClasswork || detailLoadingId !== null || detailError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <section className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            {/* Modal header */}
            <div className="sticky top-0 flex items-center justify-between border-b border-black bg-[#F6E9B2] px-5 py-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-gray-700">
                  Student classwork detail
                </p>
                <h2 className="text-xl font-bold">{selectedClasswork?.title || "Classwork"}</h2>
              </div>
              <button
                type="button"
                onClick={closeClassworkDetail}
                className="rounded p-1 hover:bg-white/60"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            {detailLoadingId !== null ? (
              <div className="p-8 text-center text-sm font-semibold text-gray-600">
                Loading classwork details...
              </div>
            ) : detailError ? (
              <div className="m-5 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                {detailError}
              </div>
            ) : selectedClasswork ? (
              <div className="grid gap-5 p-5 lg:grid-cols-[1.2fr_1fr]">
                {/* Left: details */}
                <div className="space-y-4">
                  {/* Status + title card */}
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

                  {/* Description + instructions */}
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

                  {/* Attachments */}
                  <div className="rounded-lg border border-black bg-white p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                    <div className="mb-3 flex items-center gap-2">
                      <Paperclip size={18} />
                      <h4 className="font-bold">Reference Files</h4>
                    </div>
                    {selectedClasswork.attachments?.length ? (
                      <AttachmentDisplay
                        attachments={selectedClasswork.attachments}
                        type="classwork"
                        downloadUrl={(attachmentId) =>
                          `${API_URL}/api/v1/classwork-assignments/classwork/${selectedClasswork.classwork_id}/attachments/${attachmentId}/download`
                        }
                      />
                    ) : (
                      <p className="text-sm text-gray-600">No reference files attached.</p>
                    )}
                  </div>
                </div>

                {/* Right: submission */}
                <aside className="rounded-lg border border-black bg-[#F6E9B2] p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                  <div className="mb-3 flex items-center gap-2">
                    {selectedSubmission ? <FileText size={18} /> : <BookOpen size={18} />}
                    <h3 className="font-bold">
                      {isReadingType(selectedClasswork.classwork_type)
                        ? "Reading Material"
                        : selectedSubmission
                          ? "Your Submission"
                          : "Submit Your Work"}
                    </h3>
                  </div>
                  {isReadingType(selectedClasswork.classwork_type) ? (
                    <p className="text-sm font-medium">
                      Review the content and reference files. No submission is required.
                    </p>
                  ) : selectedSubmission ? (
                    <SubmissionViewer
                      submission={selectedSubmission}
                      dueDate={selectedClasswork.due_date ?? undefined}
                      isLocked={selectedClasswork.is_locked}
                      maxAttempts={selectedClasswork.max_attempts}
                      onDeleteSubmission={() =>
                        handleDeleteSubmission(selectedClasswork.classwork_assignment_id)
                      }
                      onResubmit={async () => {
                        const sub = await fetchSubmissionForAssignment(
                          selectedClasswork.classwork_assignment_id,
                        );
                        setSelectedSubmission(sub);
                      }}
                      isDeleting={deletingId === selectedClasswork.classwork_assignment_id}
                    />
                  ) : (
                    <SubmissionForm
                      assignmentId={selectedClasswork.classwork_assignment_id}
                      maxAttempts={selectedClasswork.max_attempts}
                      currentAttempt={0}
                      isLoading={submittingId === selectedClasswork.classwork_assignment_id}
                      onSubmit={(files) =>
                        handleSubmit(selectedClasswork.classwork_assignment_id, files)
                      }
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

// ─── Timeline item sub-component ────────────────────────────────────────────
function TimelineItem({
  children,
  isLast,
  dot,
}: {
  children: React.ReactNode;
  isLast: boolean;
  dot: "filled" | "empty";
}) {
  return (
    <div className="flex items-start gap-3">
      {/* Dot + vertical line */}
      <div className="flex flex-col items-center pt-1">
        <div
          className={`w-3 h-3 rounded-full border-2 shrink-0 ${
            dot === "filled"
              ? "bg-gray-400 border-gray-500"
              : "bg-white border-gray-400"
          }`}
        />
        {!isLast && <div className="w-px bg-gray-200 flex-1 mt-1 mb-1" style={{ minHeight: "24px" }} />}
      </div>
      {/* Content */}
      <div className={`flex-1 min-w-0 ${isLast ? "pb-0" : "pb-3"}`}>{children}</div>
    </div>
  );
}
