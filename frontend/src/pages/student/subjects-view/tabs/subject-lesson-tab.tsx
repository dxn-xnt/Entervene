import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { studentClassworkPath } from "@/lib/student-classwork-navigation";
import {
  BookOpen,
  ClipboardList,
  ChevronRight,
  FileText,
  GraduationCap,
} from "lucide-react";
import { StudentLessonDetailScreen } from "@/pages/student/lesson-view";
import { apiFetch, getLessonGoals, getStudentTodos, type LessonGoalItemResponse, type TodoItem } from "@/lib/api";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import { useReadingFocusTracker } from "@/hooks/use-reading-focus-tracker";
import { Card } from "@/components/retroui/Card";
import IconContainer from "@/components/icon-container";
import { Empty } from "@/components/retroui/Empty";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Select } from "@/components/retroui/Select";
import { LessonGoalProgress } from "@/components/lesson-goal-progress";
import { StudentLessonMastery } from "@/components/student-lesson-mastery";
import { LoadingPanel } from "@/components/loading-panel";
import type { StudentLesson as Lesson } from "@/types/student-subject";
import StudentClassworkDetailModal from "@/pages/student/forms/student-classwork-detail-modal";
import type {
  ClassworkDetail,
  LessonClasswork,
  QuizAttempt,
  Submission,
  SubjectLessonTabProps,
} from "../types";

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

// ─── Component ─────────────────────────────────────────────────────────────

export default function SubjectLessonTab({
  classId,
  subjectId,
  subjectName: propSubjectName,
  onLessonSelect,
}: SubjectLessonTabProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedPeriodId } = useAcademicPeriod();
  const [curatedGoals, setCuratedGoals] = useState<
    LessonGoalItemResponse[] | undefined
  >(undefined);

  useEffect(() => {
    if (!classId || !subjectId) return;
    const targetClassId = classId;
    const targetSubjectId = subjectId;
    let isMounted = true;

    async function loadCuratedGoals() {
      try {
        const data = await getLessonGoals(
          targetClassId,
          targetSubjectId,
          selectedPeriodId || undefined,
        );
        if (isMounted) {
          setCuratedGoals(data.items || []);
        }
      } catch {
        if (isMounted) {
          setCuratedGoals([]);
        }
      }
    }

    void loadCuratedGoals();
    return () => {
      isMounted = false;
    };
  }, [classId, subjectId, selectedPeriodId]);

  const [searchParams, setSearchParams] = useSearchParams();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
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
  const [isQuizLoading] = useState(false);
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
  const [detailLoadingId] = useState<number | null>(null);
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
  const [studentClassworks, setStudentClassworks] = useState<TodoItem[]>([]);
  const [sortAsc, setSortAsc] = useState(false);
  const [lessonFilter, setLessonFilter] = useState("all");
  const [selectedLessonDetail, setSelectedLessonDetail] =
    useState<Lesson | null>(null);

  useEffect(() => {
    if (classId && subjectId) {
      fetchLessons();
      if (!propSubjectName) fetchSubjectInfo();
    } else {
      setIsLoading(false);
    }
  }, [classId, subjectId]);

  useEffect(() => {
    if (!classId || !subjectId) return;
    let mounted = true;
    getStudentTodos(selectedPeriodId || undefined)
      .then((data) => {
        if (mounted) setStudentClassworks((data.all ?? []).filter((work) => work.class_id === classId && work.subject_id === subjectId));
      })
      .catch(() => { if (mounted) setStudentClassworks([]); });
    return () => { mounted = false; };
  }, [classId, subjectId, selectedPeriodId]);

  useEffect(() => {
    const targetId = Number(searchParams.get("lessonId"));
    if (!targetId) {
      setSelectedLessonDetail(null);
      return;
    }
    if (lessons.length === 0) return;
    const targetLesson = lessons.find(
      (lesson) => lesson.lesson_id === targetId,
    );
    if (!targetLesson) return;
    setSelectedLessonDetail(targetLesson);
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

  const openLessonDetail = async (lesson: Lesson) => {
    setSelectedLessonDetail(lesson);
    onLessonSelect?.(lesson.lesson_id);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("lessonId", String(lesson.lesson_id));
    nextParams.delete("classworkAssignmentId");
    setSearchParams(nextParams);
    await fetchLessonClassworks(lesson.lesson_id);
  };

  const toggleLesson = (lessonId: number) => {
    const next = expandedId === lessonId ? null : lessonId;
    setExpandedId(next);
    if (next) void fetchLessonClassworks(lessonId);
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

  const openClassworkDetail = (cw: LessonClasswork | ClassworkDetail) => {
    const returnParams = new URLSearchParams(searchParams);
    returnParams.delete("classworkAssignmentId");
    const from = `${location.pathname}${returnParams.toString() ? `?${returnParams}` : ""}`;
    navigate(studentClassworkPath(cw.classwork_assignment_id, from));
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

  const toggleQuizFlag = (questionId: number) => {
    setFlaggedQuizQuestionIds((current) => {
      const next = new Set(current);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  };

  // Derived values
  const displaySubjectName =
    propSubjectName ?? subjectInfo?.subject_name ?? "—";

  const allClassworks = Object.values(classworksByLesson).flat();
  const hasOverdue = allClassworks.some(
    (cw) =>
      cw.submission_status === "missing" ||
      (cw.due_date &&
        new Date(cw.due_date) < new Date() &&
        !["submitted", "graded"].includes(cw.submission_status ?? "")),
  );

  const sortedLessons = lessons.filter((lesson) =>
    lessonFilter === "all" || String(lesson.lesson_id) === lessonFilter,
  ).sort((a, b) => {
    const da = new Date(a.created_at ?? 0).getTime();
    const db = new Date(b.created_at ?? 0).getTime();
    return sortAsc ? da - db : db - da;
  });

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

  const renderStudentLessonItem = (lesson: Lesson) => {
    return (
      <div
        key={lesson.lesson_id}
        className="w-full cursor-pointer overflow-hidden rounded border-2 border-black bg-primary transition-all hover:translate-x-1"
        id={`student-lesson-${lesson.lesson_id}`}
      >
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={() => void openLessonDetail(lesson)}
            className="min-w-0 flex-1 cursor-pointer p-4 text-left"
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-bold leading-tight">{lesson.title}</span>
              {lesson.attachments.length > 0 && (
                <Badge variant="secondary" size="sm" className="rounded border border-black bg-success px-2 py-0.5 text-[10px] font-bold text-black">
                  {lesson.attachments.length} material{lesson.attachments.length === 1 ? "" : "s"}
                </Badge>
              )}
            </span>
            <span className="mt-1 block text-xs text-foreground">
              {lesson.description ||
                (lesson.updated_at
                  ? `Updated ${fmtDate(lesson.updated_at)}`
                  : lesson.created_at
                    ? `Created ${fmtDate(lesson.created_at)}`
                    : "")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => toggleLesson(lesson.lesson_id)}
            aria-label={`${expandedId === lesson.lesson_id ? "Collapse" : "Expand"} ${lesson.title} classwork`}
            aria-expanded={expandedId === lesson.lesson_id}
            className="flex w-12 shrink-0 cursor-pointer items-center justify-center"
          >
            <ChevronRight className={`size-4 transition-transform ${expandedId === lesson.lesson_id ? "rotate-90" : ""}`} aria-hidden="true" />
          </button>
        </div>
        {expandedId === lesson.lesson_id && (
          <div className="flex flex-col gap-2 border-t-2 border-black bg-white p-3">
            {renderLessonClassworkCards(lesson, true)}
          </div>
        )}
      </div>
    );
  };

  const renderLessonClassworkCards = (lesson: Lesson, nested = false) => {
    const classworks = (classworksByLesson[lesson.lesson_id] ?? []).filter(
      (cw) =>
        cw.classwork_category !== "QUARTERLY_ASSESSMENT" &&
        !quarterlyAssignmentIds.has(cw.classwork_assignment_id) &&
        (!isQuizType(cw.classwork_type) ||
          (classworkLessonCounts.get(cw.classwork_assignment_id) ?? 0) <= 1),
    );

    if (classworkLoadingId === lesson.lesson_id) {
      return <LoadingPanel label="Loading classworks..." className="py-6" />;
    }

    if (classworks.length === 0) {
      return (
        <Card className="w-full text-center rounded border-0 bg-muted px-4 py-3 text-sm text-muted-foreground shadow-none">
          No classworks linked to this lesson
        </Card>
      );
    }

    return classworks.map((cw) => {
      const badge = getStatusBadge(cw.submission_status, cw.due_date);
      const isLoading = detailLoadingId === cw.classwork_assignment_id;
      return (
        <Card
          key={cw.classwork_assignment_id}
          onClick={() => !isLoading && openClassworkDetail(cw)}
          className={`block w-full cursor-pointer border-black ${nested ? "shadow-none hover:shadow-none" : ""}`}
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
    return <LoadingPanel label="Loading lessons..." />;
  }

  // ─── Error state ───────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="text-center py-10">
        <p className="text-red-500 mb-4">{error}</p>
        <Button
          type="button"
          size="sm"
          onClick={fetchLessons}
          className="rounded border-black bg-primary font-semibold text-black"
        >
          Retry
        </Button>
      </div>
    );
  }

  // ─── Main render ───────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      {/* ── Subject info card ── */}
      {selectedLessonDetail ? (
        <StudentLessonDetailScreen
          lesson={selectedLessonDetail}
          displaySubjectName={displaySubjectName}
          closeLessonDetail={closeLessonDetail}
          renderLessonClassworkCards={renderLessonClassworkCards}
          classId={classId}
          subjectId={subjectId}
          fmtDate={fmtDate}
        />
      ) : (
        <>
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
                  <IconContainer variant="primary" className="size-9 rounded-none border p-0 shadow-sm [&_svg]:size-5">
                    <GraduationCap />
                  </IconContainer>
                  <div>
                    <h3 className="text-xl font-bold tracking-tight text-black">
                      Exams
                    </h3>
                    <p className="text-xs font-medium text-gray-600">
                      Periodical exams and summative assessments for this
                      subject.
                    </p>
                  </div>
                </div>
                <Badge
                  variant="secondary"
                  className="px-3 py-1 text-xs font-bold shadow-sm"
                >
                  {quarterlyAssessments.length}{" "}
                  {quarterlyAssessments.length === 1 ? "Exam" : "Exams"}
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
                      className="w-full rounded border border-black bg-white px-5 py-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] flex items-center justify-between gap-4 hover:bg-gray-50 transition-all text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <IconContainer variant="primary" className="size-10 border bg-[#F6E9B2] p-0 [&_svg]:size-5">
                          <ClipboardList />
                        </IconContainer>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-bold text-sm md:text-base leading-tight line-clamp-2 break-words [overflow-wrap:anywhere]">
                              {cw.title}
                            </h4>
                            <span className="rounded-full border border-black bg-[#7ABA78] px-2.5 py-0.5 text-[10px] font-bold text-white shrink-0">
                              Exam
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
            <Empty>
              <Empty.Content>
                <Empty.Icon><BookOpen size={24} /></Empty.Icon>
                <Empty.Title>No lessons available for this subject.</Empty.Title>
              </Empty.Content>
            </Empty>
          ) : (
            <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              {/* ════════════════ LEFT: Lessons list ════════════════ */}
              <div className="w-full min-w-0">
                <div className="mb-4 flex w-full flex-wrap items-center justify-end gap-3">
                  <Select value={lessonFilter} onValueChange={setLessonFilter}>
                    <Select.Trigger aria-label="Filter lessons" className="h-10 w-44 text-sm sm:w-48">
                      <Select.Value placeholder="All lessons" />
                    </Select.Trigger>
                    <Select.Content className="max-h-72 overflow-y-auto border-2 border-black">
                      <Select.Item value="all">All lessons</Select.Item>
                      {lessons.map((lesson) => (
                        <Select.Item key={lesson.lesson_id} value={String(lesson.lesson_id)}>
                          {lesson.title}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                  <Select
                    value={sortAsc ? "oldest" : "newest"}
                    onValueChange={(value) => setSortAsc(value === "oldest")}
                  >
                    <Select.Trigger className="h-10 w-44 text-sm sm:w-48">
                      <Select.Value placeholder="Sort by" />
                    </Select.Trigger>
                    <Select.Content className="border-2 border-black">
                      <Select.Item value="newest">Newest first</Select.Item>
                      <Select.Item value="oldest">Oldest first</Select.Item>
                    </Select.Content>
                  </Select>
                </div>

                <div className="space-y-3">
                  {sortedLessons.map(renderStudentLessonItem)}
                </div>
              </div>

              {/* ════════════════ RIGHT: Weekly Goals ════════════════ */}
              <div className="flex w-full min-w-0 flex-col gap-4">
                <LessonGoalProgress
                  goalItems={curatedGoals}
                  className="w-full min-w-0"
                  onClassworkClick={(_cwId, asgnId) => {
                    if (asgnId) {
                      openClassworkDetail({
                        classwork_assignment_id: asgnId,
                      } as LessonClasswork);
                    }
                  }}
                />
                <StudentLessonMastery
                  lessons={sortedLessons}
                  assignmentIdsByLesson={Object.fromEntries(lessons.map((lesson) => [lesson.lesson_id, (classworksByLesson[lesson.lesson_id] ?? []).map((work) => work.classwork_assignment_id)]))}
                  classworks={studentClassworks}
                  onReview={(lesson) => void openLessonDetail(lesson)}
                />
              </div>
            </div>
          )}
        </>
      )}

      {/* ════════════════ Classwork Detail Modal & Fullscreen Quiz ════════════════ */}
      <StudentClassworkDetailModal
        selectedClasswork={selectedClasswork}
        detailLoadingId={detailLoadingId}
        detailError={detailError}
        selectedSubmission={selectedSubmission}
        selectedQuizAttempt={selectedQuizAttempt}
        quizAnswers={quizAnswers}
        setQuizAnswers={setQuizAnswers}
        isQuizLoading={isQuizLoading}
        isQuizSubmitting={isQuizSubmitting}
        quizError={quizError}
        isQuizFullscreen={isQuizFullscreen}
        setIsQuizFullscreen={setIsQuizFullscreen}
        quizCurrentIndex={quizCurrentIndex}
        setQuizCurrentIndex={setQuizCurrentIndex}
        quizReviewMode={quizReviewMode}
        setQuizReviewMode={setQuizReviewMode}
        flaggedQuizQuestionIds={flaggedQuizQuestionIds}
        toggleQuizFlag={toggleQuizFlag}
        quizRemainingSeconds={quizRemainingSeconds}
        submittingId={submittingId}
        deletingId={deletingId}
        isMarkingRead={isMarkingRead}
        onClose={closeClassworkDetail}
        onStartQuiz={startQuizAttempt}
        onSubmitQuiz={submitQuizAttempt}
        onSubmitFiles={handleSubmit}
        onCompleteReading={handleCompleteReading}
        onDeleteSubmission={handleDeleteSubmission}
        onFetchSubmission={fetchSubmissionForAssignment}
        setSelectedSubmission={setSelectedSubmission}
      />
    </div>
  );
}
