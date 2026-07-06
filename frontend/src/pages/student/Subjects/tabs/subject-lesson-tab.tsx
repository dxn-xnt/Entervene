import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ChevronRight,
  ChevronDown,
  ChevronLeft,
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
import SubjectSuggestionsTab from "./subject-suggestions-tab";
import { Card } from "@/components/retroui/Card";
import { SortButton } from "@/components/SortButton";

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
  allow_late_submissions?: boolean;
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
  allow_late_submissions?: boolean;
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

interface QuizAttemptOption {
  option_id: number;
  option_text: string;
  option_order: number;
  is_correct?: boolean | null;
}

interface QuizAttemptQuestion {
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

interface QuizAttempt {
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

type SubjectLessonTabProps = {
  classId?: number;
  subjectId?: number;
  subject?: string;
  subjectName?: string;
  teacherName?: string;
  onLessonSelect?: (lessonId: number) => void;
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function getStatusBadge(status?: string | null, dueDate?: string | null) {
  if (status === "graded" || status === "submitted") {
    return {
      label: "Done",
      cls: "bg-gray-200 text-gray-600 border border-gray-300",
    };
  }
  if (status === "late") {
    return { label: "Late", cls: "bg-[#FF4B4B] text-white" };
  }
  if (!dueDate) return null;
  const diffDays = Math.ceil(
    (new Date(dueDate).getTime() - Date.now()) / 86_400_000,
  );
  if (diffDays < 0)
    return {
      label: `${Math.abs(diffDays)} days late`,
      cls: "bg-[#E47171] text-black",
    };
  if (diffDays === 0)
    return { label: "Due today", cls: "bg-orange-400 text-white" };
  return { label: `Due in ${diffDays} days`, cls: "bg-[#7ABA78] text-white" };
}

function isCompletedClasswork(status?: string | null) {
  return ["graded", "submitted"].includes(status ?? "");
}

function classworkGoalScore(cw: LessonClasswork) {
  if (isCompletedClasswork(cw.submission_status))
    return Number.MAX_SAFE_INTEGER;
  if (!cw.due_date) return Number.MAX_SAFE_INTEGER - 1;
  return new Date(cw.due_date).getTime();
}

function isReadingType(value?: string | null) {
  return value?.toUpperCase() === "READING";
}

function isQuizType(value?: string | null) {
  return value?.toUpperCase() === "QUIZ";
}

function ClassworkIcon({
  type,
  size = 16,
}: {
  type?: string | null;
  size?: number;
}) {
  switch (type?.toLowerCase()) {
    case "quiz":
      return <ClipboardList size={size} />;
    case "assignment":
      return <BookOpen size={size} />;
    default:
      return <FileText size={size} />;
  }
}

function fmtDate(dateStr?: string | null) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function statusLabel(s?: string | null) {
  if (!s) return "Not submitted";
  return s.replace(/_/g, " ");
}

function formatExamTimer(seconds: number | null) {
  if (seconds === null) return "No timer";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDateTime(dateStr?: string | null) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString();
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function SubjectLessonTab({
  classId,
  subjectId,
  subjectName: propSubjectName,
  teacherName: propTeacherName,
  onLessonSelect,
}: SubjectLessonTabProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [classworksByLesson, setClassworksByLesson] = useState<
    Record<number, LessonClasswork[]>
  >({});
  const [classworkLoadingId, setClassworkLoadingId] = useState<number | null>(
    null,
  );
  const [selectedClasswork, setSelectedClasswork] =
    useState<ClassworkDetail | null>(null);
  const [selectedSubmission, setSelectedSubmission] =
    useState<Submission | null>(null);
  const [selectedQuizAttempt, setSelectedQuizAttempt] =
    useState<QuizAttempt | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<
    Record<number, { selected_option_id?: number; answer_text?: string }>
  >({});
  const [isQuizLoading, setIsQuizLoading] = useState(false);
  const [isQuizSubmitting, setIsQuizSubmitting] = useState(false);
  const [quizError, setQuizError] = useState("");
  const [isQuizFullscreen, setIsQuizFullscreen] = useState(false);
  const [quizCurrentIndex, setQuizCurrentIndex] = useState(0);
  const [quizReviewMode, setQuizReviewMode] = useState(false);
  const [flaggedQuizQuestionIds, setFlaggedQuizQuestionIds] = useState<
    Set<number>
  >(new Set());
  const [quizRemainingSeconds, setQuizRemainingSeconds] = useState<
    number | null
  >(null);
  const autoSubmitRef = useRef(false);
  const submitQuizAttemptRef = useRef<
    ((autoSubmit?: boolean) => Promise<void>) | null
  >(null);
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [detailError, setDetailError] = useState("");
  const [subjectInfo, setSubjectInfo] = useState<{
    subject_name: string;
    teacher_name: string;
  } | null>(null);
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedLessonDetail, setSelectedLessonDetail] =
    useState<Lesson | null>(null);
  const [lessonDetailTab, setLessonDetailTab] = useState<
    "classwork" | "suggestions"
  >("classwork");

  useEffect(() => {
    if (classId && subjectId) {
      fetchLessons();
      if (!propSubjectName) fetchSubjectInfo();
    } else {
      setIsLoading(false);
    }
  }, [classId, subjectId]);

  useEffect(() => {
    const targetId = Number(searchParams.get("lessonId"));
    if (!targetId || lessons.length === 0) return;
    const targetLesson = lessons.find(
      (lesson) => lesson.lesson_id === targetId,
    );
    if (!targetLesson) return;
    setExpandedId(targetId);
    setSelectedLessonDetail(targetLesson);
    setLessonDetailTab("classwork");
    onLessonSelect?.(targetId);
    if (classId && classworksByLesson[targetId] === undefined) {
      void apiFetch(
        `/api/v1/lessons/${targetId}/classwork-assignments?class_id=${classId}`,
      )
        .then(async (res) =>
          res.ok ? ((await res.json()) as LessonClasswork[]) : [],
        )
        .then((data) => {
          setClassworksByLesson((prev) => ({
            ...prev,
            [targetId]: prev[targetId] ?? data,
          }));
        })
        .catch(() => {
          setClassworksByLesson((prev) => ({
            ...prev,
            [targetId]: prev[targetId] ?? [],
          }));
        });
    }
    window.setTimeout(() => {
      document.getElementById(`student-lesson-${targetId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 80);
  }, [classId, classworksByLesson, lessons, onLessonSelect, searchParams]);

  const fetchSubjectInfo = async () => {
    try {
      const res = await apiFetch("/api/v1/students/me/subjects");
      if (!res.ok) return;
      const data = await res.json();
      const match = data.find(
        (s: {
          class_id: number;
          subject_id: number;
          subject_name: string;
          teacher_name: string;
        }) => s.class_id === classId && s.subject_id === subjectId,
      );
      if (match)
        setSubjectInfo({
          subject_name: match.subject_name,
          teacher_name: match.teacher_name,
        });
    } catch {
      // The lesson list remains usable when optional subject metadata is unavailable.
    }
  };

  const fetchLessons = async () => {
    if (!classId || !subjectId) return;
    setIsLoading(true);
    setError("");
    try {
      const res = await apiFetch(
        `/api/v1/lessons/class/${classId}/subject/${subjectId}`,
      );
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
      const res = await apiFetch(
        `/api/v1/lessons/${lessonId}/classwork-assignments?class_id=${classId}`,
      );
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
    if (next) onLessonSelect?.(lessonId);
    if (next) await fetchLessonClassworks(lessonId);
  };

  const openLessonDetail = async (lesson: Lesson) => {
    setSelectedLessonDetail(lesson);
    setLessonDetailTab("classwork");
    onLessonSelect?.(lesson.lesson_id);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("lessonId", String(lesson.lesson_id));
    nextParams.delete("classworkAssignmentId");
    setSearchParams(nextParams, { replace: true });
    await fetchLessonClassworks(lesson.lesson_id);
  };

  const closeLessonDetail = () => {
    setSelectedLessonDetail(null);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("lessonId");
    nextParams.delete("classworkAssignmentId");
    setSearchParams(nextParams, { replace: true });
  };

  const fetchSubmissionForAssignment = async (assignmentId: number) => {
    const res = await apiFetch("/api/v1/submissions/my-submissions");
    if (!res.ok) return null;
    const subs = (await res.json()) as Submission[];
    return subs.find((s) => s.classwork_assignment_id === assignmentId) ?? null;
  };

  const hydrateQuizAnswers = (attempt: QuizAttempt) => {
    const next: Record<
      number,
      { selected_option_id?: number; answer_text?: string }
    > = {};
    attempt.questions.forEach((question) => {
      next[question.quiz_question_id] = {
        selected_option_id: question.selected_option_id ?? undefined,
        answer_text: question.answer_text ?? "",
      };
    });
    setQuizAnswers(next);
  };

  const loadQuizAttempt = async (assignmentId: number) => {
    setIsQuizLoading(true);
    setQuizError("");
    try {
      const res = await apiFetch(
        `/api/v1/quizzes/assignment/${assignmentId}/attempt`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Unable to load quiz.");
      }
      const attempt = (await res.json()) as QuizAttempt;
      setSelectedQuizAttempt(attempt);
      hydrateQuizAnswers(attempt);
    } catch (err) {
      setQuizError(err instanceof Error ? err.message : "Unable to load quiz.");
    } finally {
      setIsQuizLoading(false);
    }
  };

  const startQuizAttempt = async () => {
    if (!selectedClasswork) return;
    setIsQuizSubmitting(true);
    setQuizError("");
    try {
      const res = await apiFetch(
        `/api/v1/quizzes/assignment/${selectedClasswork.classwork_assignment_id}/start`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Unable to start quiz.");
      }
      const attempt = (await res.json()) as QuizAttempt;
      setSelectedQuizAttempt(attempt);
      hydrateQuizAnswers(attempt);
      autoSubmitRef.current = false;
      setQuizCurrentIndex(0);
      setQuizReviewMode(false);
      setFlaggedQuizQuestionIds(new Set());
      setIsQuizFullscreen(attempt.status === "pending");
      updateClassworkStatus(
        selectedClasswork.classwork_assignment_id,
        attempt.status,
      );
    } catch (err) {
      setQuizError(
        err instanceof Error ? err.message : "Unable to start quiz.",
      );
    } finally {
      setIsQuizSubmitting(false);
    }
  };

  const submitQuizAttempt = async (autoSubmit = false) => {
    if (!selectedClasswork || !selectedQuizAttempt) return;
    if (autoSubmit && autoSubmitRef.current) return;
    if (autoSubmit) autoSubmitRef.current = true;
    setIsQuizSubmitting(true);
    setQuizError(
      autoSubmit ? "Time is up. Submitting your current answers..." : "",
    );
    try {
      const answers = selectedQuizAttempt.questions.map((question) => ({
        quiz_question_id: question.quiz_question_id,
        selected_option_id:
          quizAnswers[question.quiz_question_id]?.selected_option_id,
        answer_text: quizAnswers[question.quiz_question_id]?.answer_text,
      }));
      const res = await apiFetch(
        `/api/v1/quizzes/assignment/${selectedClasswork.classwork_assignment_id}/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Unable to submit quiz.");
      }
      const attempt = (await res.json()) as QuizAttempt;
      setSelectedQuizAttempt(attempt);
      hydrateQuizAnswers(attempt);
      setIsQuizFullscreen(false);
      setQuizReviewMode(false);
      setQuizCurrentIndex(0);
      setFlaggedQuizQuestionIds(new Set());
      setQuizError("");
      autoSubmitRef.current = false;
      updateClassworkStatus(
        selectedClasswork.classwork_assignment_id,
        attempt.status,
      );
    } catch (err) {
      setQuizError(
        err instanceof Error ? err.message : "Unable to submit quiz.",
      );
      autoSubmitRef.current = false;
    } finally {
      setIsQuizSubmitting(false);
    }
  };
  submitQuizAttemptRef.current = submitQuizAttempt;

  useEffect(() => {
    if (
      selectedQuizAttempt?.status !== "pending" ||
      !selectedQuizAttempt.duration_minutes
    ) {
      setQuizRemainingSeconds(null);
      return;
    }

    const startedAt = selectedQuizAttempt.started_at
      ? new Date(selectedQuizAttempt.started_at).getTime()
      : Date.now();
    const serverNow = selectedQuizAttempt.server_time
      ? new Date(selectedQuizAttempt.server_time).getTime()
      : Date.now();
    // Use server time to keep the countdown stable even if the device clock is off.
    const clientServerOffset = serverNow - Date.now();
    const totalSeconds = selectedQuizAttempt.duration_minutes * 60;

    const tick = () => {
      const now = Date.now() + clientServerOffset;
      const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
      const remaining = Math.max(0, totalSeconds - elapsed);
      setQuizRemainingSeconds(remaining);
      if (remaining <= 0) {
        void submitQuizAttemptRef.current?.(true);
      }
    };

    tick();
    const timerId = window.setInterval(tick, 1000);
    return () => window.clearInterval(timerId);
  }, [
    quizAnswers,
    selectedClasswork?.classwork_assignment_id,
    selectedQuizAttempt?.status,
    selectedQuizAttempt?.started_at,
    selectedQuizAttempt?.server_time,
    selectedQuizAttempt?.duration_minutes,
  ]);

  useEffect(() => {
    if (!isQuizFullscreen && !selectedClasswork) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isQuizFullscreen, selectedClasswork]);

  const openClassworkDetail = async (cw: LessonClasswork) => {
    setDetailLoadingId(cw.classwork_assignment_id);
    setDetailError("");
    try {
      const res = await apiFetch(
        `/api/v1/classwork-assignments/assignment/${cw.classwork_assignment_id}`,
      );
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
      const submission = isQuizType(detail.classwork_type)
        ? null
        : await fetchSubmissionForAssignment(cw.classwork_assignment_id);
      setSelectedClasswork(detail);
      setSelectedSubmission(submission);
      setSelectedQuizAttempt(null);
      setQuizAnswers({});
      setIsQuizFullscreen(false);
      setQuizReviewMode(false);
      setQuizCurrentIndex(0);
      setFlaggedQuizQuestionIds(new Set());
      autoSubmitRef.current = false;
      if (isQuizType(detail.classwork_type)) {
        await loadQuizAttempt(cw.classwork_assignment_id);
      }
    } catch (err) {
      setDetailError(
        err instanceof Error
          ? err.message
          : "Unable to load classwork details.",
      );
    } finally {
      setDetailLoadingId(null);
    }
  };

  const closeClassworkDetail = () => {
    setSelectedClasswork(null);
    setSelectedSubmission(null);
    setSelectedQuizAttempt(null);
    setQuizAnswers({});
    setIsQuizFullscreen(false);
    setQuizReviewMode(false);
    setQuizCurrentIndex(0);
    setFlaggedQuizQuestionIds(new Set());
    setQuizRemainingSeconds(null);
    autoSubmitRef.current = false;
    setQuizError("");
    setDetailError("");
  };

  const updateClassworkStatus = (assignmentId: number, status: string) => {
    setClassworksByLesson((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((lid) => {
        next[Number(lid)] = next[Number(lid)].map((cw) =>
          cw.classwork_assignment_id === assignmentId
            ? { ...cw, submission_status: status }
            : cw,
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
      const res = await apiFetch(
        `/api/v1/submissions/assignment/${assignmentId}/submit`,
        { method: "POST", body: fd },
      );
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
      const res = await apiFetch(
        `/api/v1/submissions/assignment/${assignmentId}/submit`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to delete.");
      setSelectedSubmission(null);
      updateClassworkStatus(assignmentId, "not_submitted_yet");
    } finally {
      setDeletingId(null);
    }
  };

  const hasQuizAnswer = (question: QuizAttemptQuestion) => {
    const answer = quizAnswers[question.quiz_question_id];
    return Boolean(answer?.selected_option_id || answer?.answer_text?.trim());
  };

  const toggleQuizFlag = (questionId: number) => {
    setFlaggedQuizQuestionIds((current) => {
      const next = new Set(current);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  };

  const renderFullscreenQuiz = () => {
    if (!selectedQuizAttempt || !selectedClasswork) return null;
    const questions = selectedQuizAttempt.questions;
    const currentQuestion = questions[quizCurrentIndex] ?? questions[0];
    const answeredCount = questions.filter(hasQuizAnswer).length;
    const isSummaryMode =
      selectedQuizAttempt.status !== "pending" &&
      selectedQuizAttempt.summary_available;
    const totalPoints =
      selectedQuizAttempt.total_points ?? selectedClasswork.total_points ?? 0;

    return (
      <div className="fixed inset-0 z-[80] flex flex-col bg-[#F8F6ED]">
        <header className="border-b border-black px-4 py-3">
          <div className="grid grid-cols-[auto_1fr_auto] items-start gap-3">
            <button
              type="button"
              onClick={() => {
                setIsQuizFullscreen(false);
                setQuizReviewMode(false);
              }}
              className="rounded p-1 hover:bg-black/5"
              aria-label="Exit fullscreen quiz"
            >
              <ChevronLeft size={22} />
            </button>
            <div className="text-center">
              <p className="text-xl font-black leading-none">
                {isSummaryMode
                  ? `${selectedQuizAttempt.grade ?? 0}/${totalPoints}`
                  : formatExamTimer(quizRemainingSeconds)}
              </p>
              <p className="text-xs font-semibold text-gray-700">
                {isSummaryMode ? "score" : "time left"}
              </p>
            </div>
            {isSummaryMode ? (
              <button
                type="button"
                onClick={() => setIsQuizFullscreen(false)}
                className="rounded-lg border border-black bg-white px-4 py-1.5 text-sm font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-[#FFFBEE]"
              >
                Close Summary
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setQuizReviewMode(true)}
                className="rounded-lg border border-black bg-white px-4 py-1.5 text-sm font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-[#FFFBEE]"
              >
                Finish Quiz
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-4">
          <div className="mx-auto max-w-6xl space-y-4">
            <section className="rounded-lg border border-black bg-white p-4 text-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <h1 className="text-2xl font-bold">
                {selectedQuizAttempt.title}
              </h1>
              <p className="mt-1 text-sm font-semibold italic text-gray-700">
                {selectedClasswork.description
                  ? `Lessons: ${selectedClasswork.description}`
                  : "Review each question carefully before submitting."}
              </p>
              {isSummaryMode ? (
                <div className="mt-4">
                  <p className="text-sm font-semibold">Quiz Summary</p>
                  <p className="text-xs text-gray-600">
                    Review your recorded answers and item scores.
                  </p>
                </div>
              ) : !quizReviewMode ? (
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {questions.map((question, index) => (
                    <button
                      key={question.quiz_question_id}
                      type="button"
                      onClick={() => {
                        setQuizCurrentIndex(index);
                        setQuizReviewMode(false);
                      }}
                      className={`relative h-8 min-w-8 rounded border border-black px-2 text-xs font-bold ${
                        index === quizCurrentIndex
                          ? "bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                          : hasQuizAnswer(question)
                            ? "bg-[#F6E9B2]"
                            : "bg-white"
                      }`}
                    >
                      {flaggedQuizQuestionIds.has(question.quiz_question_id) ? (
                        <span className="absolute -top-2 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-red-500" />
                      ) : null}
                      {index + 1}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>

            {quizError ? (
              <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                {quizError}
              </p>
            ) : null}

            {isSummaryMode ? (
              <section className="mx-auto max-w-4xl space-y-3">
                {questions.map((question, index) => {
                  const selectedOption = question.options.find(
                    (option) =>
                      option.option_id === question.selected_option_id,
                  );
                  const correctOption = question.options.find(
                    (option) => option.is_correct,
                  );
                  const revealsCorrectKey = question.options.some(
                    (option) =>
                      option.is_correct !== null &&
                      option.is_correct !== undefined,
                  );
                  return (
                    <article
                      key={question.quiz_question_id}
                      className="rounded-lg border border-black bg-white p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h2 className="min-w-0 flex-1 break-words text-base font-bold">
                          {index + 1}. {question.question_text}
                        </h2>
                        <span className="shrink-0 rounded-full border border-gray-300 px-3 py-1 text-xs font-bold">
                          {question.points_awarded ?? 0}/{question.points} pts
                        </span>
                      </div>
                      {question.question_type === "MULTIPLE_CHOICE" ? (
                        <div className="mt-3 grid gap-2">
                          {question.options.map((option) => {
                            const isSelected =
                              option.option_id === question.selected_option_id;
                            const isCorrect = option.is_correct === true;
                            const isKnownWrongSelection =
                              revealsCorrectKey && isSelected && !isCorrect;
                            return (
                              <div
                                key={option.option_id}
                                className={`rounded-lg border px-3 py-2 text-sm ${
                                  isCorrect
                                    ? "border-green-500 bg-green-50"
                                    : isKnownWrongSelection
                                      ? "border-red-400 bg-red-50"
                                      : isSelected
                                        ? "border-[#E0C15A] bg-[#FFFBEE]"
                                        : "border-gray-200 bg-white"
                                }`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="min-w-0 break-words">
                                    {option.option_text}
                                  </span>
                                  <span className="text-xs font-bold">
                                    {isCorrect && isSelected
                                      ? "Your answer / Correct answer"
                                      : isCorrect
                                        ? "Correct answer"
                                        : isSelected
                                          ? "Your answer"
                                          : ""}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                          {!selectedOption && (
                            <p className="text-xs font-semibold text-red-700">
                              No answer recorded.
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="mt-3 space-y-2 text-sm">
                          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                            <p className="text-xs font-bold uppercase text-gray-500">
                              Your answer
                            </p>
                            <p className="mt-1 whitespace-pre-wrap break-words">
                              {question.answer_text?.trim() ||
                                "No answer recorded."}
                            </p>
                          </div>
                          {correctOption ? (
                            <p className="rounded-lg border border-green-500 bg-green-50 px-3 py-2 font-semibold">
                              Expected answer: {correctOption.option_text}
                            </p>
                          ) : null}
                          {question.is_correct !== null &&
                          question.is_correct !== undefined ? (
                            <p
                              className={
                                question.is_correct
                                  ? "font-bold text-green-700"
                                  : "font-bold text-red-700"
                              }
                            >
                              {question.is_correct
                                ? "Marked correct"
                                : "Needs review"}
                            </p>
                          ) : null}
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>
            ) : quizReviewMode ? (
              <section className="mx-auto max-w-3xl">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-lg font-bold">Review answers</h2>
                  <p className="text-sm font-semibold text-gray-600">
                    {answeredCount}/{questions.length} answered
                  </p>
                </div>
                <div className="overflow-hidden rounded-lg border border-black bg-white">
                  {questions.map((question, index) => (
                    <button
                      key={question.quiz_question_id}
                      type="button"
                      onClick={() => {
                        setQuizCurrentIndex(index);
                        setQuizReviewMode(false);
                      }}
                      className="flex w-full items-center justify-between border-b border-gray-300 px-4 py-2 text-left last:border-b-0 hover:bg-[#FFFBEE]"
                    >
                      <span className="font-semibold">
                        Question {index + 1}
                      </span>
                      <span className="rounded-full border border-gray-300 px-3 py-1 text-[11px] font-semibold">
                        {hasQuizAnswer(question)
                          ? "Answer Recorded"
                          : "No Answer"}
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => submitQuizAttempt(false)}
                  disabled={!selectedQuizAttempt.can_submit || isQuizSubmitting}
                  className="mt-4 float-right rounded-lg border border-black bg-[#7ABA78] px-5 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isQuizSubmitting ? "Submitting..." : "Submit"}
                </button>
              </section>
            ) : currentQuestion ? (
              <section className="mx-auto max-w-3xl space-y-4">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() =>
                      setQuizCurrentIndex((index) => Math.max(0, index - 1))
                    }
                    disabled={quizCurrentIndex === 0}
                    className="rounded-full border border-black bg-white p-2 disabled:opacity-40"
                    aria-label="Previous question"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      toggleQuizFlag(currentQuestion.quiz_question_id)
                    }
                    className={`rounded-lg border border-black px-4 py-2 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${
                      flaggedQuizQuestionIds.has(
                        currentQuestion.quiz_question_id,
                      )
                        ? "bg-[#F6E9B2]"
                        : "bg-white"
                    }`}
                  >
                    Flag Question
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setQuizCurrentIndex((index) =>
                        Math.min(questions.length - 1, index + 1),
                      )
                    }
                    disabled={quizCurrentIndex === questions.length - 1}
                    className="rounded-full border border-black bg-white p-2 disabled:opacity-40"
                    aria-label="Next question"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>

                <div className="rounded-lg border border-black bg-[#F6E9B2] px-6 py-12 text-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <p className="text-lg font-bold">
                    {currentQuestion.question_text}
                  </p>
                </div>

                {currentQuestion.question_type === "MULTIPLE_CHOICE" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {currentQuestion.options.map((option) => (
                      <button
                        key={option.option_id}
                        type="button"
                        onClick={() =>
                          setQuizAnswers((current) => ({
                            ...current,
                            [currentQuestion.quiz_question_id]: {
                              ...current[currentQuestion.quiz_question_id],
                              selected_option_id: option.option_id,
                            },
                          }))
                        }
                        disabled={isQuizSubmitting}
                        className={`min-h-24 rounded-lg border border-black px-4 py-3 text-lg font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${
                          quizAnswers[currentQuestion.quiz_question_id]
                            ?.selected_option_id === option.option_id
                            ? "bg-[#F6E9B2]"
                            : "bg-white"
                        }`}
                      >
                        {option.option_text}
                      </button>
                    ))}
                  </div>
                ) : (
                  <textarea
                    value={
                      quizAnswers[currentQuestion.quiz_question_id]
                        ?.answer_text ?? ""
                    }
                    onChange={(event) =>
                      setQuizAnswers((current) => ({
                        ...current,
                        [currentQuestion.quiz_question_id]: {
                          ...current[currentQuestion.quiz_question_id],
                          answer_text: event.target.value,
                        },
                      }))
                    }
                    disabled={isQuizSubmitting}
                    className="min-h-32 w-full rounded-lg border border-black bg-white px-4 py-4 text-center text-lg font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                    placeholder="Type answer"
                  />
                )}
              </section>
            ) : null}
          </div>
        </main>
      </div>
    );
  };

  // Derived values
  const displaySubjectName =
    propSubjectName ?? subjectInfo?.subject_name ?? "—";
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

  const sortedGoalLessons = [...sortedLessons].sort((a, b) => {
    const aClassworks = classworksByLesson[a.lesson_id] ?? [];
    const bClassworks = classworksByLesson[b.lesson_id] ?? [];
    const aScore = Math.min(
      ...aClassworks.map(classworkGoalScore),
      Number.MAX_SAFE_INTEGER,
    );
    const bScore = Math.min(
      ...bClassworks.map(classworkGoalScore),
      Number.MAX_SAFE_INTEGER,
    );
    return aScore - bScore;
  });

  const classworkLessonCounts = allClassworks.reduce((counts, classwork) => {
    counts.set(
      classwork.classwork_assignment_id,
      (counts.get(classwork.classwork_assignment_id) ?? 0) + 1,
    );
    return counts;
  }, new Map<number, number>());

  const multiLessonClassworks = Array.from(
    new Map(
      allClassworks
        .filter(
          (classwork) =>
            isQuizType(classwork.classwork_type) &&
            (classworkLessonCounts.get(classwork.classwork_assignment_id) ??
              0) > 1,
        )
        .map((classwork) => [classwork.classwork_assignment_id, classwork]),
    ).values(),
  );

  const renderLessonClassworkCards = (lesson: Lesson) => {
    const classworks = classworksByLesson[lesson.lesson_id] ?? [];

    if (classworkLoadingId === lesson.lesson_id) {
      return (
        <div className="text-center py-4 text-sm text-gray-400">
          Loading classworks...
        </div>
      );
    }

    if (classworks.length === 0) {
      return (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-400">
          No classworks linked to this lesson.
        </div>
      );
    }

    return classworks.map((cw) => {
      const badge = getStatusBadge(cw.submission_status, cw.due_date);
      const isLoading = detailLoadingId === cw.classwork_assignment_id;
      return (
        <button
          key={cw.classwork_assignment_id}
          onClick={() => openClassworkDetail(cw)}
          disabled={isLoading}
          className="w-full rounded-lg border border-black bg-white px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-black bg-[#F6E9B2]">
            <ClassworkIcon type={cw.classwork_type} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{cw.title}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {cw.due_date
                ? `Scheduled ${fmtDate(cw.due_date)}`
                : "No due date"}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {badge && (
              <span
                className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${badge.cls}`}
              >
                {badge.label}
              </span>
            )}
            {isLoading && (
              <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            )}
          </div>
        </button>
      );
    });
  };

  const renderLessonDetailScreen = (lesson: Lesson) => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 pb-3 text-sm font-semibold">
        <button
          type="button"
          onClick={closeLessonDetail}
          className="flex items-center gap-1 rounded-md border border-black bg-white px-3 py-1.5 hover:bg-[#FFFBEE]"
        >
          <ChevronLeft size={16} />
          Back to lessons
        </button>
        <span className="text-gray-500">{displaySubjectName}</span>
        <ChevronRight size={15} className="text-gray-400" />
        <span>{lesson.title}</span>
      </div>

      <section className="rounded-lg border border-black bg-[#F6E9B2] p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <h2 className="text-2xl font-bold">{lesson.title}</h2>
        <p className="mt-1 text-sm font-semibold text-gray-800">
          {lesson.description || "No lesson description provided."}
        </p>
        {lesson.content ? (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-800">
            {lesson.content}
          </p>
        ) : null}
        <p className="mt-2 text-xs font-semibold text-gray-600">
          {lesson.updated_at
            ? `Updated ${fmtDate(lesson.updated_at)}`
            : lesson.created_at
              ? `Created ${fmtDate(lesson.created_at)}`
              : ""}
        </p>
      </section>

      <div className="flex flex-wrap gap-2 border-b border-black">
        <button
          type="button"
          onClick={() => setLessonDetailTab("classwork")}
          className={`rounded-t-lg border border-b-0 border-black px-4 py-2 text-sm font-bold ${
            lessonDetailTab === "classwork" ? "bg-white" : "bg-[#FFFBEE]"
          }`}
        >
          Classwork
        </button>
        <button
          type="button"
          onClick={() => setLessonDetailTab("suggestions")}
          className={`rounded-t-lg border border-b-0 border-black px-4 py-2 text-sm font-bold ${
            lessonDetailTab === "suggestions" ? "bg-white" : "bg-[#FFFBEE]"
          }`}
        >
          Recommended Materials
        </button>
      </div>

      {lessonDetailTab === "classwork" ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold">Classwork</h3>
              <span className="text-xs font-semibold text-gray-500">
                See all
              </span>
            </div>
            {renderLessonClassworkCards(lesson)}
          </section>
          <aside className="space-y-3">
            <section className="rounded-lg border border-black bg-white p-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
              <h3 className="font-bold">Lesson Mastery</h3>
              <p className="mt-2 text-xs text-gray-700">
                Review the classwork and recommended materials for this lesson
                to strengthen mastery.
              </p>
            </section>
            <section className="rounded-lg border border-black bg-white p-3 text-center text-sm font-semibold italic shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
              Setting a goal is about achieving it and staying with that plan.
            </section>
          </aside>
        </div>
      ) : classId && subjectId ? (
        <SubjectSuggestionsTab
          classId={classId}
          subjectId={subjectId}
          selectedLessonId={lesson.lesson_id}
          hideIntro
        />
      ) : null}
    </div>
  );

  // ─── Loading skeleton ──────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-20 rounded-lg border border-black bg-[#F6E9B2] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
        <div className="h-12 rounded-lg border border-black bg-pink-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 rounded-lg border border-black bg-[#F6E9B2] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
          />
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
    <div className="flex flex-col gap-4">
      {isQuizFullscreen && selectedClasswork && selectedQuizAttempt
        ? renderFullscreenQuiz()
        : null}
      {/* ── Subject info card ── */}
      {selectedLessonDetail ? (
        renderLessonDetailScreen(selectedLessonDetail)
      ) : (
        <>
          <Card className="flex justify-between bg-[#F6E9B2]">
            <div>
              <Card.Title className="text-2xl font-bold">
                {displaySubjectName}
              </Card.Title>
              <p className="text-sm">{displayTeacherName}</p>
            </div>
            <button className="hover:text-gray-800 transition-colors">
              <Info size={18} />
            </button>
          </Card>

          {/* ── Activity overdue banner ── */}
          {hasOverdue && (
            <Card className="bg-[#F4B8C1] flex flex-col">
              <Card.Description>Activity Overdue</Card.Description>
              <p className="text-sm">
                You still have pending activities. Complete them as soon as
                possible.
              </p>
            </Card>
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
              <div className="flex-2 min-w-0">
                {/* Lessons header row */}
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xl font-bold tracking-tight">Lessons</h3>
                  <SortButton onClick={() => setSortAsc((v) => !v)}>
                    Sort By
                  </SortButton>
                </div>

                <div className="space-y-2">
                  {multiLessonClassworks.map((classwork) => {
                    const badge = getStatusBadge(
                      classwork.submission_status,
                      classwork.due_date,
                    );
                    const isLoading =
                      detailLoadingId === classwork.classwork_assignment_id;
                    return (
                      <button
                        key={`multi-lesson-${classwork.classwork_assignment_id}`}
                        type="button"
                        onClick={() => openClassworkDetail(classwork)}
                        disabled={isLoading}
                        className="w-full rounded-lg border border-black bg-white px-5 py-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center gap-3 hover:bg-[#FFFBEE] transition-colors text-left"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-black bg-[#F6E9B2]">
                          <ClipboardList size={18} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-bold text-lg leading-tight">
                              {classwork.title}
                            </h4>
                            <span className="rounded-full border border-black bg-[#7ABA78] px-2 py-0.5 text-[10px] font-bold">
                              Multi-lesson exam
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 mt-0.5">
                            {classwork.due_date
                              ? `Scheduled ${fmtDate(classwork.due_date)}`
                              : "No due date"}
                          </p>
                        </div>
                        {badge ? (
                          <span
                            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.cls}`}
                          >
                            {badge.label}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                  {sortedLessons.map((lesson) => {
                    const isExpanded = expandedId === lesson.lesson_id;
                    const classworks = (
                      classworksByLesson[lesson.lesson_id] ?? []
                    ).filter(
                      (classwork) =>
                        !isQuizType(classwork.classwork_type) ||
                        (classworkLessonCounts.get(
                          classwork.classwork_assignment_id,
                        ) ?? 0) <= 1,
                    );

                    return (
                      <div
                        key={lesson.lesson_id}
                        id={`student-lesson-${lesson.lesson_id}`}
                      >
                        {/* ── Lesson card ── */}
                        <Card className="w-full bg-[#F6E9B2] flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => openLessonDetail(lesson)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex flex-wrap items-center">
                              <Card.Title className="font-bold text-lg leading-tight hover:underline">
                                {lesson.title}
                              </Card.Title>
                              {lesson.attachments.length > 0 && (
                                <span className="rounded-full border border-black bg-[#7ABA78] px-2 py-0.5 text-[10px] font-bold">
                                  {lesson.attachments.length} material
                                  {lesson.attachments.length === 1 ? "" : "s"}
                                </span>
                              )}
                            </div>
                            <p className="text-xs">
                              {lesson.description ||
                                (lesson.updated_at
                                  ? `Updated ${fmtDate(lesson.updated_at)}`
                                  : lesson.created_at
                                    ? `Created ${fmtDate(lesson.created_at)}`
                                    : "")}
                            </p>
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleLesson(lesson.lesson_id)}
                            className="cursor-pointer"
                            aria-label={
                              isExpanded ? "Collapse lesson" : "Expand lesson"
                            }
                          >
                            {isExpanded ? (
                              <ChevronDown size={20} className="shrink-0" />
                            ) : (
                              <ChevronRight size={20} className="shrink-0" />
                            )}
                          </button>
                        </Card>

                        {/* ── Inline classwork items (expanded) ── */}
                        {isExpanded && (
                          <div className="mt-2 space-y-2 pl-3">
                            <div className="flex items-center">
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
                                const badge = getStatusBadge(
                                  cw.submission_status,
                                  cw.due_date,
                                );
                                const isLoading =
                                  detailLoadingId ===
                                  cw.classwork_assignment_id;
                                return (
                                  <button
                                    key={cw.classwork_assignment_id}
                                    onClick={() => openClassworkDetail(cw)}
                                    disabled={isLoading}
                                    className="w-full rounded-lg border-2 border-black bg-white p-4 flex items-center text-left gap-3 shadow-md transition-all hover:shadow-none"
                                  >
                                    {/* Icon */}
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center min-w-0">
                                          <div className="flex h-9 w-9 items-center justify-center">
                                            <ClassworkIcon
                                              type={cw.classwork_type}
                                            />
                                          </div>
                                          <p className="font-semibold text-lg truncate">
                                            {cw.title}
                                          </p>
                                        </div>
                                      </div>
                                      <p className="text-xs ">
                                        {cw.due_date
                                          ? `Scheduled ${fmtDate(cw.due_date)}`
                                          : "No due date"}
                                      </p>
                                    </div>
                                    {/* Badge + spinner */}
                                    <div className="flex items-center gap-2 shrink-0">
                                      {badge && (
                                        <span
                                          className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${badge.cls}`}
                                        >
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
              <div className="flex-1 min-w-0">
                <h3 className="text-xl font-bold mb-3">Weekly Goals</h3>
                <Card className="w-full">
                  {sortedGoalLessons.map((lesson) => {
                    const cws = classworksByLesson[lesson.lesson_id];
                    const orderedClassworks = cws
                      ? [...cws].sort(
                          (a, b) =>
                            classworkGoalScore(a) - classworkGoalScore(b),
                        )
                      : [];
                    // const isHighlighted = expandedId === lesson.lesson_id;
                    const isLoadingCws = cws === undefined;

                    return (
                      <div
                        key={lesson.lesson_id}
                        className="flex flex-col gap-4"
                      >
                        {/* Lesson header - plain text, no box */}
                        <Card.Description>{lesson.title}</Card.Description>

                        {/* Timeline */}
                        {isLoadingCws ? (
                          <div className="flex items-center gap-2 pl-4 py-1">
                            <div className="w-3 h-3 rounded-full border-2 border-gray-300 bg-gray-200 animate-pulse shrink-0" />
                            <p className="text-xs text-gray-400">Loading...</p>
                          </div>
                        ) : (
                          <div className="relative">
                            {/* Lesson Completion */}
                            <TimelineItem
                              isLast={orderedClassworks.length === 0}
                              dot="filled"
                            >
                              <div className="rounded-sm text-center border px-3 py-2">
                                <p className="text-md">Lesson Completion</p>
                              </div>
                            </TimelineItem>

                            {/* Classwork items */}
                            {orderedClassworks.length === 0 ? (
                              <p className="text-[11px] text-gray-400 pl-6 mt-1">
                                No classworks linked
                              </p>
                            ) : (
                              orderedClassworks.map((cw, idx) => {
                                const badge = getStatusBadge(
                                  cw.submission_status,
                                  cw.due_date,
                                );
                                return (
                                  <TimelineItem
                                    key={cw.classwork_assignment_id}
                                    isLast={
                                      idx === orderedClassworks.length - 1
                                    }
                                    dot="empty"
                                  >
                                    <div className="flex items-center justify-between gap-2 w-full rounded-sm border px-3 py-2">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="shrink-0">
                                          <ClassworkIcon
                                            type={cw.classwork_type}
                                            size={13}
                                          />
                                        </span>
                                        <p className="text-md truncate">
                                          {cw.title}
                                        </p>
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
                </Card>
              </div>
            </div>
          )}

          {/* ════════════════ Classwork Detail Modal ════════════════ */}
        </>
      )}

      {(selectedClasswork || detailLoadingId !== null || detailError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/50 px-4 py-6">
          <Card className="block w-full p-0">
            {/* Modal header */}
            <div className="sticky top-0 flex items-center justify-between rounded-t-lg border-b border-black bg-[#F6E9B2] px-5 py-4">
              <div>
                <p className="text-xs">
                  Student classwork detail
                </p>
                <h2 className="text-xl font-bold">
                  {selectedClasswork?.title || "Classwork"}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeClassworkDetail}
                className="cursor-pointer"
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
              <div className="grid max-h-[calc(90vh-88px)] min-w-0 gap-5 overflow-y-auto overflow-x-hidden p-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,1fr)]">
                {/* Left: details */}
                <div className="min-w-0 space-y-4">
                  {/* Status + title card */}
                  <Card className="block w-full shadow-none">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-black bg-[#7ABA78] px-3 py-1 text-xs font-bold">
                        {selectedClasswork.classwork_type || "Classwork"}
                      </span>
                      <span className="rounded-full border border-gray-300 px-3 py-1 text-xs font-semibold capitalize">
                        {statusLabel(
                          selectedQuizAttempt?.status ??
                            selectedSubmission?.status ??
                            selectedClasswork.submission_status,
                        )}
                      </span>
                    </div>
                    <h3 className="mt-4 break-words text-3xl font-bold">
                      {selectedClasswork.title}
                    </h3>
                    <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="mb-1 flex items-center gap-1 font-semibold text-gray-600">
                          <CalendarDays size={14} />
                          Due
                        </div>
                        <p className="font-bold">
                          {selectedClasswork.due_date
                            ? new Date(
                                selectedClasswork.due_date,
                              ).toLocaleString()
                            : "No due date"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3">
                        <p className="font-semibold text-gray-600">Points</p>
                        <p className="font-bold">
                          {selectedClasswork.total_points ?? "Not set"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3">
                        <p className="font-semibold text-gray-600">Teacher</p>
                        <p className="font-bold">
                          {selectedClasswork.teacher_name || "Teacher"}
                        </p>
                      </div>
                    </div>
                  </Card>

                  {/* Description + instructions */}
                  {(selectedClasswork.description ||
                    selectedClasswork.instructions) && (
                    <Card className="block w-full shadow-none">
                      {selectedClasswork.description && (
                        <div>
                          <h4 className="font-bold">Description</h4>
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-700">
                            {selectedClasswork.description}
                          </p>
                        </div>
                      )}
                      {selectedClasswork.instructions && (
                        <div className="mt-4">
                          <h4 className="font-bold">Instructions</h4>
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-700">
                            {selectedClasswork.instructions}
                          </p>
                        </div>
                      )}
                    </Card>
                  )}

                  {/* Attachments */}
                  <Card className="block w-full shadow-none">
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
                      <p className="text-sm text-gray-600">
                        No reference files attached.
                      </p>
                    )}
                  </Card>
                </div>

                {/* Right: submission or quiz attempt */}
                <Card className="block w-full shadow-none">
                  <div className="mb-3 flex items-center gap-2">
                    {isQuizType(selectedClasswork.classwork_type) ? (
                      <ClipboardList size={18} />
                    ) : selectedSubmission ? (
                      <FileText size={18} />
                    ) : (
                      <BookOpen size={18} />
                    )}
                    <h3 className="font-bold">
                      {isReadingType(selectedClasswork.classwork_type)
                        ? "Reading Material"
                        : isQuizType(selectedClasswork.classwork_type)
                          ? "Take Quiz"
                          : selectedSubmission
                            ? "Your Submission"
                            : "Submit Your Work"}
                    </h3>
                  </div>
                  {isReadingType(selectedClasswork.classwork_type) ? (
                    <p className="text-sm font-medium">
                      Review the content and reference files. No submission is
                      required.
                    </p>
                  ) : isQuizType(selectedClasswork.classwork_type) ? (
                    <div className="space-y-3">
                      {isQuizLoading ? (
                        <p className="rounded-lg border border-dashed border-black bg-white px-4 py-6 text-center text-sm font-semibold">
                          Loading quiz...
                        </p>
                      ) : quizError ? (
                        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                          {quizError}
                        </div>
                      ) : selectedQuizAttempt ? (
                        <>
                          <div className="rounded-lg border border-black bg-white p-3 text-sm">
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-bold capitalize">
                                {statusLabel(selectedQuizAttempt.status)}
                              </span>
                              <span className="font-semibold">
                                Attempts {selectedQuizAttempt.attempt_count}/
                                {selectedQuizAttempt.max_attempts}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-gray-600">
                              <span>
                                {selectedQuizAttempt.questions.length} questions
                              </span>
                              <span>
                                {selectedQuizAttempt.total_points ??
                                  selectedClasswork.total_points ??
                                  0}{" "}
                                pts
                              </span>
                              {selectedQuizAttempt.duration_minutes ? (
                                <span>
                                  {selectedQuizAttempt.duration_minutes} minutes
                                </span>
                              ) : null}
                            </div>
                            {selectedQuizAttempt.grade !== null &&
                            selectedQuizAttempt.grade !== undefined ? (
                              <p className="mt-2 text-sm font-bold">
                                Score: {selectedQuizAttempt.grade}/
                                {selectedQuizAttempt.total_points ??
                                  selectedClasswork.total_points ??
                                  0}
                              </p>
                            ) : null}
                          </div>

                          {selectedQuizAttempt.status !== "pending" ? (
                            <div className="space-y-2">
                              {selectedQuizAttempt.summary_message ? (
                                <div className="rounded-lg border border-black bg-white px-3 py-2 text-xs font-semibold text-gray-700">
                                  {selectedQuizAttempt.summary_release_at
                                    ? `Your quiz has been submitted successfully. Your quiz summary will be available on ${formatDateTime(selectedQuizAttempt.summary_release_at)}.`
                                    : selectedQuizAttempt.summary_message}
                                </div>
                              ) : null}
                              {selectedQuizAttempt.status !== "not_started" ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setQuizReviewMode(true);
                                    setQuizCurrentIndex(0);
                                    setIsQuizFullscreen(true);
                                  }}
                                  disabled={
                                    !selectedQuizAttempt.summary_available
                                  }
                                  className="w-full rounded-lg border border-black bg-white px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {selectedQuizAttempt.summary_available
                                    ? "View Summary"
                                    : selectedQuizAttempt.summary_release_mode ===
                                        "NEVER"
                                      ? "Summary Not Available"
                                      : "Summary Scheduled"}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={startQuizAttempt}
                                disabled={
                                  !selectedQuizAttempt.can_submit ||
                                  isQuizSubmitting
                                }
                                className="w-full rounded-lg border border-black bg-[#7ABA78] px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {selectedQuizAttempt.status === "not_started"
                                  ? "Start Quiz"
                                  : "Retake Quiz"}
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className="rounded-lg border border-black bg-white p-3 text-sm font-semibold">
                                <p>Your quiz attempt is in progress.</p>
                                <p className="mt-1 text-gray-600">
                                  Time left:{" "}
                                  {formatExamTimer(quizRemainingSeconds)}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setIsQuizFullscreen(true)}
                                disabled={
                                  !selectedQuizAttempt.can_submit ||
                                  isQuizSubmitting
                                }
                                className="w-full rounded-lg border border-black bg-[#7ABA78] px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Continue Exam
                              </button>
                            </>
                          )}
                        </>
                      ) : (
                        <p className="rounded-lg border border-dashed border-black bg-white px-4 py-6 text-center text-sm font-semibold">
                          Quiz details unavailable.
                        </p>
                      )}
                    </div>
                  ) : selectedSubmission ? (
                    <SubmissionViewer
                      submission={selectedSubmission}
                      dueDate={selectedClasswork.due_date ?? undefined}
                      isLocked={selectedClasswork.is_locked}
                      allowLateSubmissions={
                        selectedClasswork.allow_late_submissions
                      }
                      maxAttempts={selectedClasswork.max_attempts}
                      onDeleteSubmission={() =>
                        handleDeleteSubmission(
                          selectedClasswork.classwork_assignment_id,
                        )
                      }
                      onResubmit={async () => {
                        const sub = await fetchSubmissionForAssignment(
                          selectedClasswork.classwork_assignment_id,
                        );
                        setSelectedSubmission(sub);
                      }}
                      isDeleting={
                        deletingId === selectedClasswork.classwork_assignment_id
                      }
                    />
                  ) : (
                    <SubmissionForm
                      assignmentId={selectedClasswork.classwork_assignment_id}
                      maxAttempts={selectedClasswork.max_attempts}
                      currentAttempt={0}
                      isLoading={
                        submittingId ===
                        selectedClasswork.classwork_assignment_id
                      }
                      onSubmit={(files) =>
                        handleSubmit(
                          selectedClasswork.classwork_assignment_id,
                          files,
                        )
                      }
                    />
                  )}
                </Card>
              </div>
            ) : null}
          </Card>
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
        {!isLast && (
          <div
            className="w-px bg-gray-200 flex-1 mt-1 mb-1"
            style={{ minHeight: "24px" }}
          />
        )}
      </div>
      {/* Content */}
      <div className={`flex-1 min-w-0 ${isLast ? "pb-0" : "pb-3"}`}>
        {children}
      </div>
    </div>
  );
}
