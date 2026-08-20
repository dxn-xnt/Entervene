import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import {
  BookOpen,
  CalendarDays,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  GraduationCap,
  Paperclip,
  Search,
} from "lucide-react";
import SubmissionForm from "@/components/submission-form";
import SubmissionViewer from "@/components/submission-viewer";
import AttachmentDisplay from "@/components/attachment-display";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Card } from "@/components/retroui/Card";
import { Alert } from "@/components/retroui/Alert";
import { Dialog } from "@/components/retroui/Dialog";
import { Badge } from "@/components/retroui/Badge";
import { API_URL, apiFetch } from "@/lib/api";
import { useReadingFocusTracker } from "@/hooks/use-reading-focus-tracker";

interface Attachment {
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

interface LinkedLesson {
  lesson_id: number;
  title: string;
  description?: string | null;
  attachments?: LinkedLessonAttachment[];
}

interface Submission {
  submission_id: number;
  classwork_assignment_id: number;
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

interface ClassworkAssignment {
  classwork_assignment_id: number;
  classwork_id: number;
  title: string;
  description?: string;
  instructions?: string;
  classwork_type?: string;
  classwork_category?: string;
  is_graded?: boolean;
  total_points?: number;
  due_date?: string;
  lock_date?: string;
  allow_late_submissions?: boolean;
  is_published: boolean;
  is_locked?: boolean;
  max_attempts?: number;
  show_scores?: boolean;
  teacher_name?: string;
  attachments: Attachment[];
  linked_lessons?: LinkedLesson[];
  submission_status?: string;
}

interface ClassworkDetail extends ClassworkAssignment {}

interface QuizAttemptOption {
  option_id: number;
  option_text: string;
  is_correct?: boolean | null;
}

interface QuizAttemptQuestion {
  quiz_question_id: number;
  question_text: string;
  question_type: string;
  points: number;
  points_awarded?: number | null;
  selected_option_id?: number | null;
  answer_text?: string | null;
  is_correct?: boolean | null;
  options: QuizAttemptOption[];
}

interface QuizAttempt {
  submission_id?: number;
  attempt_count: number;
  max_attempts: number;
  status: "not_started" | "pending" | "submitted" | "graded" | "late";
  started_at?: string;
  server_time?: string;
  duration_minutes?: number;
  can_submit: boolean;
  total_points?: number;
  grade?: number | null;
  summary_available?: boolean;
  summary_release_mode?: string;
  summary_release_at?: string | null;
  summary_message?: string | null;
  title: string;
  description?: string;
  questions: QuizAttemptQuestion[];
}

type SubjectClassworkTabProps = {
  classId?: number;
  subjectId?: number;
};

type SortMode = "due" | "newest" | "title";
type Notice = {
  status: "success" | "error";
  title: string;
  description: string;
};

const LOCKED_CLASSWORK_MESSAGE =
  "This classwork is published but locked until the unlock time. You can view the title now, but files and submissions open after it unlocks.";

function isReadingType(value?: string | null) {
  return value?.toUpperCase() === "READING";
}

function isQuizType(value?: string | null) {
  return value?.toUpperCase() === "QUIZ";
}

function classworkIcon(type?: string | null) {
  switch (type?.toUpperCase()) {
    case "READING":
      return BookOpen;
    case "QUIZ":
      return ClipboardList;
    default:
      return FileText;
  }
}

function statusBadge(
  status?: string | null,
  dueDate?: string,
  locked?: boolean,
  classworkType?: string,
) {
  if (locked)
    return {
      label: "Locked",
      cls: "bg-yellow-100 text-yellow-800 border-yellow-300",
    };
  if (status === "graded")
    return {
      label: "Graded",
      cls: "bg-green-100 text-green-800 border-green-300",
    };
  if (status === "submitted" || status === "completed") {
    if (classworkType?.toUpperCase() === "READING") {
      return {
        label: "Completed",
        cls: "bg-green-100 text-green-800 border-green-300",
      };
    }
    return {
      label: "Submitted",
      cls: "bg-blue-100 text-blue-800 border-blue-300",
    };
  }
  if (status === "late")
    return { label: "Late", cls: "bg-red-100 text-red-800 border-red-300" };
  if (dueDate && new Date() > new Date(dueDate))
    return { label: "Missing", cls: "bg-red-100 text-red-800 border-red-300" };
  return {
    label: "Pending",
    cls: "bg-orange-100 text-orange-800 border-orange-300",
  };
}

function dueBadge(dueDate?: string) {
  if (!dueDate) return null;
  const diffDays = Math.ceil(
    (new Date(dueDate).getTime() - Date.now()) / 86_400_000,
  );
  if (diffDays < 0)
    return {
      label: `${Math.abs(diffDays)} days late`,
      cls: "bg-[#FF4B4B] text-white",
    };
  if (diffDays === 0)
    return { label: "Due today", cls: "bg-orange-400 text-white" };
  return { label: `Due in ${diffDays} days`, cls: "bg-[#7ABA78] text-white" };
}

function statusLabel(status?: string | null) {
  switch (status?.toLowerCase()) {
    case "submitted":
      return "Submitted";
    case "graded":
      return "Graded";
    case "late":
      return "Late";
    case "pending":
      return "In progress";
    default:
      return "Not submitted yet";
  }
}

function formatExamTimer(remainingSeconds: number | null) {
  if (remainingSeconds === null) return "--:--";
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function urgencyScore(cw: ClassworkAssignment, submission?: Submission) {
  if (submission?.status === "graded" || submission?.status === "submitted")
    return Number.MAX_SAFE_INTEGER;
  if (!cw.due_date) return Number.MAX_SAFE_INTEGER - 1;
  return new Date(cw.due_date).getTime();
}

export default function SubjectClassworkTab({
  classId,
  subjectId,
}: SubjectClassworkTabProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const autoOpenedAssignmentRef = useRef<number | null>(null);
  const [classworks, setClassworks] = useState<ClassworkAssignment[]>([]);
  const [submissions, setSubmissions] = useState<Record<number, Submission>>(
    {},
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("due");
  const [notice, setNotice] = useState<Notice | null>(null);

  // Selected Detail Modal & Quiz State
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
  const [detailError, setDetailError] = useState("");

  const isReadingActive = Boolean(
    selectedClasswork && isReadingType(selectedClasswork.classwork_type),
  );
  useReadingFocusTracker(
    selectedClasswork?.classwork_assignment_id,
    isReadingActive,
  );

  const fetchClassworks = useCallback(async () => {
    if (!classId || !subjectId) return;

    setIsLoading(true);
    setError("");
    setNotice(null);

    try {
      const response = await apiFetch(
        `/api/v1/classwork-assignments/class/${classId}/subject/${subjectId}`,
      );

      if (!response.ok) {
        throw new Error("Failed to fetch classworks");
      }

      const data = await response.json();
      setClassworks(data);

      const submissionsData: Record<number, Submission> = {};
      const submissionsResponse = await apiFetch(
        "/api/v1/submissions/my-submissions",
      );
      const allSubmissions = submissionsResponse.ok
        ? ((await submissionsResponse.json()) as Submission[])
        : [];
      for (const cw of data as ClassworkAssignment[]) {
        const sub = allSubmissions.find(
          (submission) =>
            submission.classwork_assignment_id === cw.classwork_assignment_id,
        );
        if (sub) {
          submissionsData[cw.classwork_assignment_id] = sub;
        }
      }
      setSubmissions(submissionsData);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch classworks",
      );
    } finally {
      setIsLoading(false);
    }
  }, [classId, subjectId]);

  useEffect(() => {
    if (classId && subjectId) {
      fetchClassworks();
    }
  }, [classId, subjectId, fetchClassworks]);

  useEffect(() => {
    const rawTarget = searchParams.get("classworkAssignmentId");
    if (!rawTarget || classworks.length === 0) return;
    const targetId = Number(rawTarget);
    if (!targetId || autoOpenedAssignmentRef.current === targetId) return;

    const targetCw = classworks.find(
      (cw) => cw.classwork_assignment_id === targetId,
    );
    if (!targetCw) return;

    autoOpenedAssignmentRef.current = targetId;

    // Clean classworkAssignmentId from URL so state updates and future clicks don't re-open stale classwork
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("classworkAssignmentId");
    setSearchParams(nextParams, { replace: true });

    void openClassworkDetail(targetCw);
  }, [classworks, searchParams, setSearchParams]);

  const updateClassworkStatus = (assignmentId: number, status: string) => {
    setClassworks((prev) =>
      prev.map((cw) =>
        cw.classwork_assignment_id === assignmentId
          ? { ...cw, submission_status: status }
          : cw,
      ),
    );
    setSubmissions((prev) => {
      const existing = prev[assignmentId];
      if (!existing) return prev;
      return { ...prev, [assignmentId]: { ...existing, status } };
    });
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

  const openClassworkDetail = async (cw: ClassworkAssignment) => {
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
    if (searchParams.get("classworkAssignmentId")) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("classworkAssignmentId");
      setSearchParams(nextParams, { replace: true });
    }
  };

  const handleSubmit = async (assignmentId: number, files: File[]) => {
    setSubmittingId(assignmentId);
    try {
      const formData = new FormData();
      files.forEach((file) => {
        formData.append("files", file);
      });

      const response = await apiFetch(
        `/api/v1/submissions/assignment/${assignmentId}/submit`,
        {
          method: "POST",
          body: formData,
        },
      );

      if (!response.ok) {
        throw new Error("Failed to submit assignment");
      }

      const submission = (await response.json()) as Submission;
      setSelectedSubmission(submission);
      updateClassworkStatus(assignmentId, submission.status);

      setNotice({
        status: "success",
        title: "Assignment submitted",
        description: "Your work was submitted successfully.",
      });
    } catch (err) {
      setNotice({
        status: "error",
        title: "Submission failed",
        description:
          err instanceof Error ? err.message : "Failed to submit assignment",
      });
    } finally {
      setSubmittingId(null);
    }
  };

  const [isMarkingRead, setIsMarkingRead] = useState(false);

  const handleCompleteReading = async (assignmentId: number) => {
    setIsMarkingRead(true);
    try {
      const response = await apiFetch(
        `/api/v1/submissions/assignment/${assignmentId}/complete-reading`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        throw new Error("Failed to complete reading");
      }

      const submission = (await response.json()) as Submission;
      setSelectedSubmission(submission);
      setSelectedClasswork((prev) =>
        prev
          ? {
              ...prev,
              submission_status: submission.status,
            }
          : null,
      );
      updateClassworkStatus(assignmentId, submission.status);

      setNotice({
        status: "success",
        title: "Reading completed",
        description: "You have marked this reading material as completed.",
      });
    } catch (err) {
      setNotice({
        status: "error",
        title: "Failed to update reading status",
        description:
          err instanceof Error ? err.message : "Failed to mark reading as completed.",
      });
    } finally {
      setIsMarkingRead(false);
    }
  };

  const handleDeleteSubmission = async (assignmentId: number) => {
    setDeletingId(assignmentId);
    try {
      const response = await apiFetch(
        `/api/v1/submissions/assignment/${assignmentId}/submit`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        throw new Error("Failed to delete submission");
      }

      setSelectedSubmission(null);
      updateClassworkStatus(assignmentId, "not_submitted_yet");
      setNotice({
        status: "success",
        title: "Submission deleted",
        description: "You can now resubmit your work.",
      });
    } catch (err) {
      setNotice({
        status: "error",
        title: "Delete failed",
        description:
          err instanceof Error ? err.message : "Failed to delete submission",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateString?: string): string => {
    if (!dateString) return "No due date";
    return new Date(dateString).toLocaleDateString();
  };

  const formatDateTime = (dateString?: string): string => {
    if (!dateString) return "the unlock time";
    return new Date(dateString).toLocaleString();
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

  const visibleClassworks = useMemo(() => {
    const term = search.trim().toLowerCase();
    return classworks
      .filter((cw) => {
        if (!term) return true;
        return [
          cw.title,
          cw.description,
          cw.instructions,
          cw.classwork_type,
          cw.teacher_name,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));
      })
      .sort((a, b) => {
        if (sortMode === "title") return a.title.localeCompare(b.title);
        if (sortMode === "newest")
          return b.classwork_assignment_id - a.classwork_assignment_id;
        const urgent =
          urgencyScore(a, submissions[a.classwork_assignment_id]) -
          urgencyScore(b, submissions[b.classwork_assignment_id]);
        return urgent || a.title.localeCompare(b.title);
      });
  }, [classworks, search, sortMode, submissions]);

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
                      className={`relative h-8 min-w-8 rounded border border-black px-2 text-xs font-bold ${
                        index === quizCurrentIndex
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
                    className={`rounded-lg border border-black px-4 py-2 text-xs font-bold shadow-md ${
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
                        className={`min-h-24 rounded-lg border border-black px-4 py-3 text-lg font-bold shadow-md ${
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
                    placeholder="Type your answer here..."
                    className="min-h-36 w-full rounded-lg border border-black bg-white p-3 text-sm outline-none shadow-md"
                  />
                )}
              </section>
            ) : null}
          </div>
        </main>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="py-8 text-center">
        <p className="text-gray-500">Loading classworks...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-10 text-center">
        <p className="mb-4 text-red-500">{error}</p>
        <button
          onClick={fetchClassworks}
          className="rounded-lg bg-black px-4 py-2 font-semibold text-white transition-colors hover:bg-gray-800"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <Alert status={notice.status}>
          <Alert.Title>{notice.title}</Alert.Title>
          <Alert.Description>{notice.description}</Alert.Description>
        </Alert>
      ) : null}

      <div className="grid gap-3 py-2 md:grid-cols-[1fr_160px]">
        <label className="relative shadow-md transition-shadow hover:shadow-none">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search classwork..."
            className="h-10 w-full border-black pl-9 pr-3 shadow-none"
          />
        </label>
        <div className="shadow-md transition-shadow hover:shadow-none">
          <Select
            value={sortMode}
            onValueChange={(value) => setSortMode(value as SortMode)}
          >
            <Select.Trigger className="w-full shadow-none">
              <Select.Value placeholder="Sort By" />
            </Select.Trigger>
            <Select.Content>
              <Select.Group>
                <Select.Item value="due">Nearest Due</Select.Item>
                <Select.Item value="newest">Newest</Select.Item>
                <Select.Item value="title">Title</Select.Item>
              </Select.Group>
            </Select.Content>
          </Select>
        </div>
      </div>

      {visibleClassworks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-5 py-10 text-center text-gray-500">
          {classworks.length === 0
            ? "No classworks assigned yet."
            : "No classworks match your search."}
        </div>
      ) : (
        visibleClassworks.map((cw) => {
          const submission = submissions[cw.classwork_assignment_id];
          const badge = statusBadge(
            submission?.status ?? cw.submission_status,
            cw.due_date,
            cw.is_locked,
            cw.classwork_type,
          );
          const deadline = dueBadge(cw.due_date);
          const Icon = classworkIcon(cw.classwork_type);
          const isItemLoading = detailLoadingId === cw.classwork_assignment_id;

          return (
            <Card
              key={cw.classwork_assignment_id}
              id={`student-classwork-${cw.classwork_assignment_id}`}
              onClick={() => !isItemLoading && openClassworkDetail(cw)}
              className="flex cursor-pointer flex-col border-black hover:border-gray-800 transition-colors"
            >
              <div className="flex w-full items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon size={20} className="shrink-0" />
                    <span className="font-semibold text-base text-black line-clamp-2 break-words [overflow-wrap:anywhere]">
                      {cw.title}
                    </span>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs font-bold shrink-0 ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                    {deadline && (
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-bold shrink-0 ${deadline.cls}`}
                      >
                        {deadline.label}
                      </span>
                    )}
                  </div>

                  <p className="mt-2 text-left text-xs text-gray-600">
                    {[
                      cw.classwork_type,
                      formatDate(cw.due_date),
                      cw.total_points ? `${cw.total_points} pts` : null,
                    ]
                      .filter(Boolean)
                      .join(" | ")}
                  </p>
                </div>

                {isItemLoading && (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent shrink-0 mt-1" />
                )}
              </div>
            </Card>
          );
        })
      )}

      {/* Fullscreen Quiz Interface */}
      {isQuizFullscreen && selectedClasswork && selectedQuizAttempt
        ? createPortal(renderFullscreenQuiz(), document.body)
        : null}

      {/* Classwork Detail Modal */}
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
            <Dialog.Header position="fixed" className="bg-[#F6E9B2] px-5 py-4 text-black">
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
                      <Badge variant="surface" size="sm" className="bg-[#7ABA78] text-black">
                        {selectedClasswork.classwork_type || "Classwork"}
                      </Badge>
                      <Badge variant="outline" size="sm" className="border-gray-300 capitalize">
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

                  {/* Coverage Section (Linked Lessons & Topics) */}
                  {selectedClasswork.linked_lessons && selectedClasswork.linked_lessons.length > 0 && (
                    <Card className="block w-full shadow-none border-2 border-black bg-[#F8F6ED]">
                      <div className="mb-2 flex items-center gap-2">
                        <GraduationCap size={18} className="text-black" />
                        <h4 className="font-bold text-black">Coverage</h4>
                      </div>
                      <div className="space-y-3">
                        {selectedClasswork.linked_lessons.map((lesson) => (
                          <div
                            key={lesson.lesson_id}
                            className="rounded-lg border border-black/20 bg-white p-3 shadow-sm"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold uppercase text-gray-500">Lesson:</span>
                              <p className="text-sm font-extrabold text-black">{lesson.title}</p>
                            </div>
                            {lesson.description && (
                              <div className="mt-1.5 flex items-start gap-2 text-xs">
                                <span className="shrink-0 font-bold uppercase text-gray-500">Topic:</span>
                                <p className="text-gray-700">{lesson.description}</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}

                  {/* Reference Materials */}
                  <Card className="block w-full shadow-none">
                    <div className="mb-3 flex items-center gap-2">
                      <Paperclip size={18} />
                      <h4 className="font-bold">Reference Materials</h4>
                    </div>
                    {(() => {
                      const directAttachments = selectedClasswork.attachments || [];
                      const linkedLessonAttachments = (selectedClasswork.linked_lessons || []).flatMap((l) =>
                        (l.attachments || []).map((att) => ({ ...att, lesson_id: l.lesson_id, lesson_title: l.title }))
                      );

                      const uniqueLinkedAttachments = linkedLessonAttachments.filter(
                        (la) => !directAttachments.some((da) => da.file_name === la.file_name && da.file_size === la.file_size)
                      );

                      const totalCount = directAttachments.length + uniqueLinkedAttachments.length;

                      if (totalCount === 0) {
                        return (
                          <p className="text-sm text-gray-600">
                            No reference files attached. Review the linked lesson materials above.
                          </p>
                        );
                      }

                      return (
                        <div className="space-y-4">
                          {directAttachments.length > 0 && (
                            <div>
                              {uniqueLinkedAttachments.length > 0 && (
                                <p className="mb-1 text-xs font-bold uppercase text-gray-600">
                                  Classwork Attachments
                                </p>
                              )}
                              <AttachmentDisplay
                                attachments={directAttachments}
                                type="classwork"
                                downloadUrl={(attachmentId) =>
                                  `${API_URL}/api/v1/classwork-assignments/classwork/${selectedClasswork.classwork_id}/attachments/${attachmentId}/download`
                                }
                              />
                            </div>
                          )}

                          {uniqueLinkedAttachments.length > 0 && (
                            <div>
                              <p className="mb-1 text-xs font-bold uppercase text-gray-600">
                                Linked Lesson Study Materials
                              </p>
                              {selectedClasswork.linked_lessons?.map((lesson) => {
                                const lessonFiles = (lesson.attachments || []).filter(
                                  (la) => !directAttachments.some((da) => da.file_name === la.file_name && da.file_size === la.file_size)
                                );
                                if (lessonFiles.length === 0) return null;
                                return (
                                  <div key={lesson.lesson_id} className="mt-2">
                                    <p className="mb-1 text-[11px] font-semibold text-gray-500">
                                      From {lesson.title}:
                                    </p>
                                    <AttachmentDisplay
                                      attachments={lessonFiles}
                                      type="lesson"
                                      downloadUrl={(attachmentId) =>
                                        `${API_URL}/api/v1/lessons/${lesson.lesson_id}/attachments/${attachmentId}/download`
                                      }
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })()}
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
                                  <span className="rounded-full bg-gray-200 px-2 py-1 text-xs text-gray-700">Score hidden</span>
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
                      onSubmit={(files) =>
                        handleSubmit(selectedClasswork.classwork_assignment_id, files)
                      }
                      isLoading={
                        submittingId === selectedClasswork.classwork_assignment_id
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
