import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import {
  Award,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  ClipboardList,
  BookOpen,
  CheckCircle,
  FileText,
  Info,
  CalendarDays,
  Paperclip,
  GraduationCap,
} from "lucide-react";
import AttachmentDisplay from "@/components/attachment-display";
import SubmissionForm from "@/components/submission-form";
import SubmissionViewer from "@/components/submission-viewer";
import { StudentLessonDetailScreen } from "@/components/student-lesson-detail-screen";
import { API_URL, apiFetch } from "@/lib/api";
import { useReadingFocusTracker } from "@/hooks/use-reading-focus-tracker";
import { Card } from "@/components/retroui/Card";
import { EmptyStateCard } from "@/components/empty-state-card";
import { Badge } from "@/components/retroui/Badge";
import { Dialog } from "@/components/retroui/Dialog";
import { SortButton } from "@/components/sort-button";
import { LessonGoalProgress } from "@/components/lesson-goal-progress";
import type { StudentLesson as Lesson } from "@/types/student-subject";

const LOCKED_CLASSWORK_MESSAGE =
  "This classwork is not available yet. Please check back later or contact your teacher for more information.";

// ─── Interfaces ────────────────────────────────────────────────────────────

interface ClassworkAttachment {
  classwork_attachment_id: number;
  file_name: string;
  file_type?: string;
  file_size: number;
  uploaded_at?: string;
}

interface LinkedLessonAttachment {
  lesson_attachment_id: number;
  file_name: string;
  file_type?: string;
  file_size: number;
  uploaded_at?: string;
}

interface LinkedReading {
  classwork_id: number;
  title: string;
  description?: string | null;
  instructions?: string | null;
  activity_mode?: string;
}

interface LinkedLesson {
  lesson_id: number;
  title: string;
  description?: string | null;
  attachments?: LinkedLessonAttachment[];
  readings?: LinkedReading[];
}

interface LessonClasswork {
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

interface ClassworkDetail {
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

  const isReadingActive = Boolean(
    selectedClasswork && isReadingType(selectedClasswork.classwork_type),
  );
  useReadingFocusTracker(
    selectedClasswork?.classwork_assignment_id,
    isReadingActive,
  );
  const [subjectInfo, setSubjectInfo] = useState<{
    subject_name: string;
    teacher_name: string;
  } | null>(null);
  const [subjectAssignments, setSubjectAssignments] = useState<
    ClassworkDetail[]
  >([]);
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedLessonDetail, setSelectedLessonDetail] =
    useState<Lesson | null>(null);
  const [lessonDetailTab, setLessonDetailTab] = useState<
    "classwork" | "suggestions"
  >("classwork");
  const [collapsedCompetencies, setCollapsedCompetencies] = useState<
    Record<string, boolean>
  >({});
  const [isUnassignedExpanded, setIsUnassignedExpanded] = useState(false);

  useEffect(() => {
    if (lessons.length > 0) {
      setCollapsedCompetencies((prev) => {
        const next: Record<string, boolean> = { ...prev };
        let firstFound = false;
        lessons.forEach((l) => {
          if (l.competency_id || l.competency_statement) {
            const key = String(l.competency_id || l.competency_statement);
            if (next[key] === undefined) {
              next[key] = firstFound;
              firstFound = true;
            }
          }
        });
        return next;
      });
      const hasAnyCompetency = lessons.some(
        (l) => l.competency_id || l.competency_statement,
      );
      setIsUnassignedExpanded(!hasAnyCompetency);
    }
  }, [lessons]);

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

      void apiFetch(
        `/api/v1/classwork-assignments/class/${classId}/subject/${subjectId}`,
      )
        .then(async (r) =>
          r.ok ? ((await r.json()) as ClassworkDetail[]) : [],
        )
        .then((cwData) => setSubjectAssignments(cwData || []))
        .catch(() => setSubjectAssignments([]));
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
      setSelectedClasswork((prev) =>
        prev
          ? {
            ...prev,
            submission_status: attempt.status,
          }
          : null,
      );
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

  const openClassworkDetail = async (cw: LessonClasswork | ClassworkDetail) => {
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

  const [isMarkingRead, setIsMarkingRead] = useState(false);

  const handleCompleteReading = async (assignmentId: number) => {
    setIsMarkingRead(true);
    try {
      const res = await apiFetch(
        `/api/v1/submissions/assignment/${assignmentId}/complete-reading`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to complete reading.");
      const sub = (await res.json()) as Submission;
      setSelectedSubmission(sub);
      setSelectedClasswork((prev) =>
        prev
          ? {
            ...prev,
            submission_status: sub.status,
          }
          : null,
      );
      updateClassworkStatus(assignmentId, sub.status);
    } finally {
      setIsMarkingRead(false);
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
      <div className="fixed inset-0 z-[99999] flex flex-col bg-[#F8F6ED]">
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
                  ? selectedClasswork.show_scores
                    ? `${selectedQuizAttempt.grade ?? 0}/${totalPoints}`
                    : "Hidden"
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
                className="rounded-lg border border-black bg-white px-4 py-1.5 text-sm font-bold shadow-md hover:bg-[#FFFBEE]"
              >
                Close Summary
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setQuizReviewMode(true)}
                className="rounded-lg border border-black bg-white px-4 py-1.5 text-sm font-bold shadow-md hover:bg-[#FFFBEE]"
              >
                Finish Quiz
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-4">
          <div className="mx-auto max-w-6xl space-y-4">
            <section className="rounded-lg border border-black bg-white p-4 text-center shadow-md">
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
                      className={`relative h-8 min-w-8 rounded border border-black px-2 text-xs font-bold ${index === quizCurrentIndex
                          ? "bg-white shadow-md"
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
                      className="rounded-lg border border-black bg-white p-4 shadow-md"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h2 className="min-w-0 flex-1 break-words text-base font-bold">
                          {index + 1}. {question.question_text}
                        </h2>
                        <span className="shrink-0 rounded-full border border-gray-300 px-3 py-1 text-xs font-bold">
                          {selectedClasswork.show_scores
                            ? `${question.points_awarded ?? 0}/${question.points} pts`
                            : `${question.points} pts`}
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
                                className={`rounded-lg border px-3 py-2 text-sm ${isCorrect
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
                    className={`rounded-lg border border-black px-4 py-2 text-xs font-bold shadow-md ${flaggedQuizQuestionIds.has(
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

                <div className="rounded-lg border border-black bg-[#F6E9B2] px-6 py-12 text-center shadow-md">
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
                        className={`min-h-24 rounded-lg border border-black px-4 py-3 text-lg font-bold shadow-md ${quizAnswers[currentQuestion.quiz_question_id]
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
                    className="min-h-32 w-full rounded-lg border border-black bg-white px-4 py-4 text-center text-lg font-bold shadow-md"
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

  const { competencyGroups, unassignedLessons } = useMemo(() => {
    const groupsMap = new Map<
      string,
      {
        key: string;
        competency_id?: number | null;
        competency_code?: string | null;
        competency_statement: string;
        lessons: Lesson[];
      }
    >();
    const unassigned: Lesson[] = [];

    sortedLessons.forEach((lesson) => {
      if (lesson.competency_statement || lesson.competency_id) {
        const key = String(lesson.competency_id || lesson.competency_statement);
        if (!groupsMap.has(key)) {
          groupsMap.set(key, {
            key,
            competency_id: lesson.competency_id,
            competency_code: lesson.competency_code,
            competency_statement:
              lesson.competency_statement || "Learning Competency",
            lessons: [],
          });
        }
        groupsMap.get(key)!.lessons.push(lesson);
      } else {
        unassigned.push(lesson);
      }
    });

    return {
      competencyGroups: Array.from(groupsMap.values()),
      unassignedLessons: unassigned,
    };
  }, [sortedLessons]);

  const renderStudentLessonItem = (lesson: Lesson) => {
    const isExpanded = expandedId === lesson.lesson_id;
    const classworks = (classworksByLesson[lesson.lesson_id] ?? []).filter(
      (classwork) =>
        classwork.classwork_category !== "QUARTERLY_ASSESSMENT" &&
        (!isQuizType(classwork.classwork_type) ||
          (classworkLessonCounts.get(classwork.classwork_assignment_id) ?? 0) <= 1),
    );

    return (
      <div key={lesson.lesson_id} id={`student-lesson-${lesson.lesson_id}`}>
        {/* ── Lesson card ── */}
        <Card className="w-full bg-[#F6E9B2] flex items-center justify-between shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] border-black">
          <button
            type="button"
            onClick={() => openLessonDetail(lesson)}
            className="min-w-0 flex-1 text-left cursor-pointer"
          >
            <div className="flex flex-wrap items-center gap-2">
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
            <p className="text-xs text-gray-700 mt-0.5">
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
            className="cursor-pointer p-1 hover:text-black"
            aria-label={isExpanded ? "Collapse lesson" : "Expand lesson"}
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
          <div className="mt-2 space-y-2 pl-3 border-l-2 border-black ml-2 my-1">
            <div className="flex items-center">
              <h5 className="font-bold text-xs uppercase tracking-wider text-gray-700">
                Linked Classwork
              </h5>
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
                  <Card
                    key={cw.classwork_assignment_id}
                    onClick={() => !isLoading && openClassworkDetail(cw)}
                    className="block w-full cursor-pointer border-black bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                  >
                    <Card.Content className="flex items-center justify-between gap-4 py-2.5 px-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <ClassworkIcon type={cw.classwork_type} size={18} />
                          <Card.Title className="mb-0 truncate text-base font-bold">
                            {cw.title}
                          </Card.Title>
                        </div>
                        <p className="mt-0.5 text-xs text-gray-600">
                          {cw.due_date ? `Scheduled ${fmtDate(cw.due_date)}` : "No due date"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {badge && (
                          <Badge size="sm" variant="secondary" className={badge.cls}>
                            {badge.label}
                          </Badge>
                        )}
                        {isLoading && (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                        )}
                      </div>
                    </Card.Content>
                  </Card>
                );
              })
            )}
          </div>
        )}
      </div>
    );
  };

  const classworkLessonCounts = allClassworks.reduce((counts, classwork) => {
    counts.set(
      classwork.classwork_assignment_id,
      (counts.get(classwork.classwork_assignment_id) ?? 0) + 1,
    );
    return counts;
  }, new Map<number, number>());

  const quarterlyAssessments = Array.from(
    new Map<number, ClassworkDetail | LessonClasswork>([
      ...subjectAssignments
        .filter((cw) => cw.classwork_category === "QUARTERLY_ASSESSMENT")
        .map((cw) => [cw.classwork_assignment_id, cw] as const),
      ...allClassworks
        .filter(
          (cw) =>
            cw.classwork_category === "QUARTERLY_ASSESSMENT" ||
            (isQuizType(cw.classwork_type) &&
              (classworkLessonCounts.get(cw.classwork_assignment_id) ?? 0) > 1),
        )
        .map((cw) => [cw.classwork_assignment_id, cw] as const),
    ]).values(),
  );

  const quarterlyAssignmentIds = new Set(
    quarterlyAssessments.map((qa) => qa.classwork_assignment_id),
  );

  const toggleStudentCompCollapse = (key: string) => {
    setCollapsedCompetencies((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const renderLessonClassworkCards = (lesson: Lesson) => {
    const classworks = (classworksByLesson[lesson.lesson_id] ?? []).filter(
      (cw) =>
        cw.classwork_category !== "QUARTERLY_ASSESSMENT" &&
        !quarterlyAssignmentIds.has(cw.classwork_assignment_id) &&
        (!isQuizType(cw.classwork_type) ||
          (classworkLessonCounts.get(cw.classwork_assignment_id) ?? 0) <= 1),
    );

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
        <Card
          key={cw.classwork_assignment_id}
          onClick={() => !isLoading && openClassworkDetail(cw)}
          className="block w-full cursor-pointer border-black"
        >
          <Card.Content className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <ClassworkIcon type={cw.classwork_type} size={22} />

                <Card.Title className="mb-0 truncate text-base">
                  {cw.title}
                </Card.Title>
              </div>

              <p className="mt-1 text-xs font-medium text-gray-600">
                {cw.due_date
                  ? `Scheduled ${fmtDate(cw.due_date)}`
                  : "No due date"}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {badge && (
                <Badge variant="secondary" size="sm" className={badge.cls}>
                  {badge.label}
                </Badge>
              )}

              {isLoading && (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
              )}
            </div>
          </Card.Content>
        </Card>
      );
    });
  };

  // ─── Loading skeleton ──────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-20 rounded-lg border border-black bg-[#F6E9B2] shadow-md" />
        <div className="h-12 rounded-lg border border-black bg-pink-100 shadow-md" />
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 rounded-lg border border-black bg-[#F6E9B2] shadow-md"
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
        ? createPortal(renderFullscreenQuiz(), document.body)
        : null}
      {/* ── Subject info card ── */}
      {selectedLessonDetail ? (
        <StudentLessonDetailScreen
          lesson={selectedLessonDetail}
          displaySubjectName={displaySubjectName}
          closeLessonDetail={closeLessonDetail}
          lessonDetailTab={lessonDetailTab}
          setLessonDetailTab={setLessonDetailTab}
          renderLessonClassworkCards={renderLessonClassworkCards}
          classId={classId}
          subjectId={subjectId}
          fmtDate={fmtDate}
        />
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

          {/* ════════════════ DEDICATED SECTION: Quarterly Assessments ════════════════ */}
          {quarterlyAssessments.length > 0 && (
            <Card className="block">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center border border-black bg-primary shadow-sm">
                    <GraduationCap size={20} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold tracking-tight text-black">
                      Quarterly Assessments
                    </h3>
                    <p className="text-xs font-medium text-gray-600">
                      Periodical exams and summative assessments for this subject.
                    </p>
                  </div>
                </div>
                <Badge
                  variant="secondary"
                  className="px-3 py-1 text-xs font-bold shadow-sm"
                >
                  {quarterlyAssessments.length}{" "}
                  {quarterlyAssessments.length === 1
                    ? "Assessment"
                    : "Assessments"}
                </Badge>
              </div>

              <div className="mt-4 space-y-3">
                {quarterlyAssessments.map((cw) => {
                  const badge = getStatusBadge(
                    cw.submission_status,
                    cw.due_date,
                  );
                  const isLoading =
                    detailLoadingId === cw.classwork_assignment_id;
                  return (
                    <button
                      key={`qa-${cw.classwork_assignment_id}`}
                      type="button"
                      onClick={() => openClassworkDetail(cw)}
                      disabled={isLoading}
                      className="w-full rounded-lg border border-black bg-white px-5 py-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] flex items-center justify-between gap-4 hover:bg-gray-50 transition-all text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-black bg-[#F6E9B2]">
                          <ClipboardList size={20} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-bold text-sm md:text-base leading-tight line-clamp-2 break-words [overflow-wrap:anywhere]">
                              {cw.title}
                            </h4>
                            <span className="rounded-full border border-black bg-[#7ABA78] px-2.5 py-0.5 text-[10px] font-bold text-white shrink-0">
                              Quarterly Assessment
                            </span>
                          </div>
                          <p className="text-xs font-medium text-gray-600 mt-1">
                            {cw.due_date
                              ? `Scheduled ${fmtDate(cw.due_date)}`
                              : "No due date"}
                            {cw.total_points ? ` • ${cw.total_points} pts` : ""}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {badge && (
                          <span
                            className={`rounded-full border px-3 py-1 text-xs font-bold ${badge.cls}`}
                          >
                            {badge.label}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          {/* ── Empty state ── */}
          {lessons.length === 0 ? (
            <EmptyStateCard
              icon={<BookOpen size={24} />}
              title="No lessons available for this subject."
            />
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

                <div className="space-y-3">
                  {competencyGroups.map((group) => {
                    const isCollapsed =
                      collapsedCompetencies[group.key] ?? false;

                    return (
                      <div
                        key={group.key}
                        className="flex flex-col rounded-lg border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] overflow-hidden"
                      >
                        {/* ── Competency Header Accordion Bar ── */}
                        <button
                          type="button"
                          onClick={() => toggleStudentCompCollapse(group.key)}
                          className="flex items-center justify-between border-b-2 border-black bg-[#F6E9B2] px-4 py-3.5 text-left cursor-pointer hover:bg-[#fae498] transition-colors group"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2.5">
                            <div className="rounded border-2 border-black bg-white p-1.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] group-hover:bg-yellow-50 transition-colors">
                              {isCollapsed ? (
                                <ChevronRight size={16} className="text-black" />
                              ) : (
                                <ChevronDown size={16} className="text-black" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="mb-0.5 flex flex-wrap items-center gap-2">
                                <Award size={18} className="text-black shrink-0" />
                                <h4 className="truncate text-base md:text-lg font-bold text-gray-950">
                                  {group.competency_code || group.competency_statement}
                                </h4>
                                <Badge
                                  variant="secondary"
                                  size="sm"
                                  className="border-2 border-black bg-white text-black text-xs font-bold shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                                >
                                  {group.lessons.length} lesson
                                  {group.lessons.length === 1 ? "" : "s"}
                                </Badge>
                              </div>
                              {group.competency_code && (
                                <p className="truncate text-xs font-medium text-gray-700">
                                  {group.competency_statement}
                                </p>
                              )}
                            </div>
                          </div>
                        </button>

                        {/* ── Competency Lessons Body ── */}
                        {!isCollapsed && (
                          <div className="flex flex-col gap-2 p-3 bg-white">
                            {group.lessons.map(renderStudentLessonItem)}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* ── Standalone / Unassigned Lessons Section ── */}
                  {unassignedLessons.length > 0 && (
                    <div className="flex flex-col rounded-lg border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
                      {competencyGroups.length > 0 ? (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setIsUnassignedExpanded((prev) => !prev)
                            }
                            className="flex items-center justify-between border-b-2 border-black bg-[#F6E9B2] px-4 py-3.5 text-left cursor-pointer hover:bg-[#fae498] transition-colors group"
                          >
                            <div className="flex items-center gap-2">
                              <div className="rounded border-2 border-black bg-white p-1.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] group-hover:bg-yellow-50 transition-colors">
                                {isUnassignedExpanded ? (
                                  <ChevronDown size={16} className="text-black" />
                                ) : (
                                  <ChevronRight size={16} className="text-black" />
                                )}
                              </div>
                              <BookOpen size={16} className="text-black shrink-0" />
                              <h4 className="text-sm font-bold text-black">
                                Unassigned Lessons
                              </h4>
                              <Badge
                                variant="secondary"
                                size="sm"
                                className="border-2 border-black bg-white text-black text-xs font-bold shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                              >
                                {unassignedLessons.length}
                              </Badge>
                            </div>
                          </button>

                          {isUnassignedExpanded && (
                            <div className="flex flex-col gap-2 p-3 bg-white">
                              {unassignedLessons.map(renderStudentLessonItem)}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="flex flex-col gap-2 p-3 bg-white/70">
                          {unassignedLessons.map(renderStudentLessonItem)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ════════════════ RIGHT: Weekly Goals ════════════════ */}
              <LessonGoalProgress
                sortedGoalLessons={sortedGoalLessons}
                classworksByLesson={classworksByLesson}
              />
            </div>
          )}

          {/* ════════════════ Classwork Detail Modal ════════════════ */}
        </>
      )}

      {!isQuizFullscreen &&
        (selectedClasswork || detailLoadingId !== null || detailError) && (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) closeClassworkDetail();
            }}
          >
            <Dialog.Content size="3xl" className="max-h-[90vh] p-0">
              {/* Modal header */}
              <Dialog.Header
                position="fixed"
                className="bg-[#F6E9B2] text-black"
              >
                <div>
                  <p className="text-xs">Student classwork detail</p>
                  <h2 className="text-xl font-bold">
                    {selectedClasswork?.title || "Classwork"}
                  </h2>
                </div>
              </Dialog.Header>

              {/* Modal body */}
              {detailLoadingId !== null ? (
                <Card className="m-5 block p-6 text-center text-sm font-semibold text-gray-600 shadow-none">
                  Loading classwork details...
                </Card>
              ) : detailError ? (
                <Card className="m-5 block border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-none">
                  {detailError}
                </Card>
              ) : selectedClasswork ? (
                <div className="grid max-h-[calc(90vh-88px)] min-w-0 gap-5 overflow-y-auto overflow-x-hidden p-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,1fr)]">
                  {/* Left: details */}
                  <div className="min-w-0 space-y-4">
                    {/* Status + title card */}
                    <Card className="block w-full shadow-none">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="surface"
                          size="sm"
                          className="bg-[#7ABA78] text-black"
                        >
                          {selectedClasswork.classwork_type || "Classwork"}
                        </Badge>
                        <Badge
                          variant="outline"
                          size="sm"
                          className="border-gray-300 capitalize"
                        >
                          {statusLabel(
                            selectedQuizAttempt?.status ??
                            selectedSubmission?.status ??
                            selectedClasswork.submission_status,
                          )}
                        </Badge>
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

                    {/* Coverage Section (Linked Lessons, Topics & Reading Classworks) - Exclusive to Quizzes */}
                    {isQuizType(selectedClasswork.classwork_type) &&
                      selectedClasswork.linked_lessons &&
                      selectedClasswork.linked_lessons.length > 0 && (
                        <Card className="block w-full shadow-none border-2 border-black bg-[#F8F6ED]">
                          <div className="mb-2 flex items-center gap-2">
                            <GraduationCap size={18} className="text-black" />
                            <h4 className="font-bold text-black">Coverage</h4>
                          </div>
                          <div className="space-y-3">
                            {selectedClasswork.linked_lessons.map((lesson) => (
                              <div
                                key={lesson.lesson_id}
                                className="rounded-lg border border-black/20 bg-white p-3.5 shadow-sm"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold uppercase text-gray-500">Lesson:</span>
                                  <p className="text-sm font-extrabold text-black">{lesson.title}</p>
                                </div>
                                {lesson.description && (
                                  <div className="mt-1 flex items-start gap-2 text-xs">
                                    <span className="shrink-0 font-bold uppercase text-gray-500">Topic:</span>
                                    <p className="text-gray-700">{lesson.description}</p>
                                  </div>
                                )}

                                {/* Specific Reading Classworks under this Lesson */}
                                {lesson.readings && lesson.readings.length > 0 && (
                                  <div className="mt-3 border-t border-black/10 pt-2.5">
                                    <div className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase text-gray-600">
                                      <BookOpen size={13} className="text-black" />
                                      <span>Reading Materials ({lesson.readings.length})</span>
                                    </div>
                                    <div className="space-y-1.5">
                                      {lesson.readings.map((reading) => (
                                        <div
                                          key={reading.classwork_id}
                                          className="flex items-center gap-2 rounded border border-black/15 bg-[#F6E9B2]/40 px-2.5 py-1.5 text-xs"
                                        >
                                          <BookOpen size={13} className="text-black shrink-0" />
                                          <span className="font-bold text-black">{reading.title}</span>
                                          {reading.description && (
                                            <span className="text-gray-600 truncate text-[11px]">
                                              — {reading.description}
                                            </span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Lesson Study File Attachments if any */}
                                {lesson.attachments && lesson.attachments.length > 0 && (
                                  <div className="mt-3 border-t border-black/10 pt-2.5">
                                    <div className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase text-gray-600">
                                      <Paperclip size={13} className="text-black" />
                                      <span>Lesson Files ({lesson.attachments.length})</span>
                                    </div>
                                    <AttachmentDisplay
                                      attachments={lesson.attachments}
                                      type="lesson"
                                      downloadUrl={(attachmentId) =>
                                        `${API_URL}/api/v1/lessons/${lesson.lesson_id}/attachments/${attachmentId}/download`
                                      }
                                    />
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </Card>
                      )}

                    {/* Classwork File Attachments (Only shown when files are directly attached) */}
                    {selectedClasswork.attachments && selectedClasswork.attachments.length > 0 && (
                      <Card className="block w-full shadow-none">
                        <div className="mb-3 flex items-center gap-2">
                          <Paperclip size={18} />
                          <h4 className="font-bold">Attached Files</h4>
                        </div>
                        <AttachmentDisplay
                          attachments={selectedClasswork.attachments}
                          type="classwork"
                          downloadUrl={(attachmentId) =>
                            `${API_URL}/api/v1/classwork-assignments/classwork/${selectedClasswork.classwork_id}/attachments/${attachmentId}/download`
                          }
                        />
                      </Card>
                    )}
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
                      <div className="space-y-3">
                        {selectedSubmission?.status === "submitted" ||
                          selectedSubmission?.status === "graded" ||
                          selectedClasswork.submission_status === "submitted" ||
                          selectedClasswork.submission_status === "graded" ||
                          selectedClasswork.submission_status === "completed" ? (
                          <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm font-semibold text-green-800 flex items-center gap-2">
                            <CheckCircle className="size-5 text-green-600 shrink-0" />
                            <span>You have completed this reading material.</span>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <p className="text-sm text-gray-600 font-medium">
                              Review the content and reference files above. When finished, mark it as completed to update your progress.
                            </p>
                            <button
                              type="button"
                              onClick={() =>
                                handleCompleteReading(selectedClasswork.classwork_assignment_id)
                              }
                              disabled={isMarkingRead}
                              className="w-full rounded-lg border border-black bg-[#7ABA78] hover:bg-[#68A866] text-black px-4 py-2 text-sm font-bold transition-colors disabled:opacity-50"
                            >
                              {isMarkingRead ? "Marking as completed..." : "Mark as Completed"}
                            </button>
                          </div>
                        )}
                      </div>
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
                                  {selectedClasswork.show_scores ? (
                                    <>
                                      Score: {selectedQuizAttempt.grade}/
                                      {selectedQuizAttempt.total_points ??
                                        selectedClasswork.total_points ??
                                        0}
                                    </>
                                  ) : (
                                    <span className="rounded-full bg-gray-200 px-2 py-1 text-xs text-gray-700">
                                      Score hidden
                                    </span>
                                  )}
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
                        showScores={selectedClasswork.show_scores}
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
            </Dialog.Content>
          </Dialog>
        )}
    </div>
  );
}


