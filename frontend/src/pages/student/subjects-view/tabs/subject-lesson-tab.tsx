import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Award,
  BookOpen,
  ClipboardList,
  FileText,
  GraduationCap,
  Info,
} from "lucide-react";
import { StudentLessonDetailScreen } from "@/pages/student/lesson-view";
import { apiFetch, getLessonGoals, type LessonGoalItemResponse } from "@/lib/api";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import { useReadingFocusTracker } from "@/hooks/use-reading-focus-tracker";
import { Card } from "@/components/retroui/Card";
import { Accordion } from "@/components/retroui/Accordion";
import { EmptyStateCard } from "@/components/empty-state-card";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Select } from "@/components/retroui/Select";
import { LessonGoalProgress } from "@/components/lesson-goal-progress";
import { LoadingPanel } from "@/components/loading-panel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
import type { StudentLesson as Lesson } from "@/types/student-subject";
import StudentClassworkDetailModal from "@/pages/student/forms/student-classwork-detail-modal";
import type {
  ClassworkDetail,
  LessonClasswork,
  QuizAttempt,
  Submission,
  SubjectLessonTabProps,
} from "../types";

const LOCKED_CLASSWORK_MESSAGE =
  "This classwork is not available yet. Please check back later or contact your teacher for more information.";

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
  teacherName: propTeacherName,
  onLessonSelect,
}: SubjectLessonTabProps) {
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

  const renderStudentLessonItem = (lesson: Lesson) => {
    const isExpanded = expandedId === lesson.lesson_id;
    const classworks = (classworksByLesson[lesson.lesson_id] ?? []).filter(
      (classwork) =>
        classwork.classwork_category !== "QUARTERLY_ASSESSMENT" &&
        (!isQuizType(classwork.classwork_type) ||
          (classworkLessonCounts.get(classwork.classwork_assignment_id) ?? 0) <=
            1),
    );

    return (
      <Accordion
        key={lesson.lesson_id}
        value={isExpanded ? [String(lesson.lesson_id)] : []}
        onValueChange={() => toggleLesson(lesson.lesson_id)}
        className="w-full"
        id={`student-lesson-${lesson.lesson_id}`}
      >
        <Accordion.Item
          value={String(lesson.lesson_id)}
          className="border-2 border-black bg-primary shadow-md hover:shadow-none"
        >
          <Accordion.Header className="items-center p-3 sm:p-4">
            <div className="flex flex-1 flex-col items-start gap-1 min-w-0 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    openLessonDetail(lesson);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      openLessonDetail(lesson);
                    }
                  }}
                  className="font-bold text-lg leading-tight cursor-pointer text-left"
                >
                  {lesson.title}
                </span>
                {lesson.attachments.length > 0 && (
                  <Badge
                    variant="secondary"
                    size="sm"
                    className="rounded border border-black bg-success px-2 py-0.5 text-[10px] font-bold text-black"
                  >
                    {lesson.attachments.length} material
                    {lesson.attachments.length === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
              <p className="text-xs font-normal text-foreground mt-0.5">
                {lesson.description ||
                  (lesson.updated_at
                    ? `Updated ${fmtDate(lesson.updated_at)}`
                    : lesson.created_at
                      ? `Created ${fmtDate(lesson.created_at)}`
                      : "")}
              </p>
            </div>
          </Accordion.Header>

          <Accordion.Content className="p-3 border-t-2 border-black bg-white space-y-2">
            {classworkLoadingId === lesson.lesson_id ? (
              <div className="text-center py-4 text-sm text-gray-400">
                Loading classworks...
              </div>
            ) : classworks.length === 0 ? (
              <Card className="block w-full border-0 bg-muted px-4 py-3 text-sm text-muted-foreground shadow-none">
                No classworks linked to this lesson.
              </Card>
            ) : (
              classworks.map((cw) => {
                const badge = getStatusBadge(cw.submission_status, cw.due_date);
                const isLoading =
                  detailLoadingId === cw.classwork_assignment_id;
                return (
                  <Card
                    key={cw.classwork_assignment_id}
                    onClick={() => !isLoading && openClassworkDetail(cw)}
                    className="block w-full cursor-pointer border-black"
                  >
                    <Card.Content className="flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <ClassworkIcon type={cw.classwork_type} size={18} />
                          <Card.Title className="mb-0 truncate text-base font-bold">
                            {cw.title}
                          </Card.Title>
                        </div>
                        <p className="mt-0.5 text-xs text-gray-600">
                          {cw.due_date
                            ? `Scheduled ${fmtDate(cw.due_date)}`
                            : "No due date"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {badge && (
                          <Badge
                            size="sm"
                            variant="secondary"
                            className={badge.cls}
                          >
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
          </Accordion.Content>
        </Accordion.Item>
      </Accordion>
    );
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
          lessonDetailTab={lessonDetailTab}
          setLessonDetailTab={setLessonDetailTab}
          renderLessonClassworkCards={renderLessonClassworkCards}
          classId={classId}
          subjectId={subjectId}
          fmtDate={fmtDate}
        />
      ) : (
        <>
          <Card className="flex min-w-0 justify-between gap-3 border-black bg-primary shadow-md hover:shadow-none">
            <div className="min-w-0">
              <Card.Title className="break-words text-xl font-bold sm:text-2xl">
                {displaySubjectName}
              </Card.Title>
              <p className="text-sm">{displayTeacherName}</p>
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="rounded shadow-none hover:bg-transparent hover:shadow-none"
                      aria-label="Subject information"
                    >
                      <Info size={18} />
                    </Button>
                  </span>
                }
              />
              <TooltipContent>Subject information</TooltipContent>
            </Tooltip>
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
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-black bg-[#F6E9B2]">
                          <ClipboardList size={20} />
                        </div>
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
            <EmptyStateCard
              icon={<BookOpen size={24} />}
              title="No lessons available for this subject."
            />
          ) : (
            <div className="flex min-w-0 flex-col items-start gap-4 lg:flex-row">
              {/* ════════════════ LEFT: Lessons list ════════════════ */}
              <div className="w-full min-w-0 lg:flex-[2]">
                {/* Lessons header row */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xl font-bold tracking-tight">Lessons</h3>
                  <Select
                    value={sortAsc ? "oldest" : "newest"}
                    onValueChange={(value) => setSortAsc(value === "oldest")}
                  >
                    <Select.Trigger className="w-36 border-black bg-white shadow-md hover:shadow-none sm:w-40">
                      <Select.Value placeholder="Sort by" />
                    </Select.Trigger>
                    <Select.Content className="border-2 border-black bg-white shadow-md">
                      <Select.Item value="newest">Newest first</Select.Item>
                      <Select.Item value="oldest">Oldest first</Select.Item>
                    </Select.Content>
                  </Select>
                </div>

                <div className="space-y-3">
                  {competencyGroups.map((group) => {
                    const isCollapsed =
                      collapsedCompetencies[group.key] ?? false;

                    return (
                      <Card
                        key={group.key}
                        className="flex w-full flex-col overflow-hidden bg-white p-0 shadow-md hover:shadow-none"
                      >
                        {/* ── Competency Header Accordion Bar ── */}
                        <Card.Header
                          role="button"
                          tabIndex={0}
                          aria-expanded={!isCollapsed}
                          onClick={() => toggleStudentCompCollapse(group.key)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleStudentCompCollapse(group.key);
                            }
                          }}
                          className="mb-0 flex-row items-center justify-between border-b-2 border-black bg-primary px-4 py-3.5 text-left cursor-pointer"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2.5">
                            <div className="min-w-0 flex-1">
                              <div className="mb-0.5 flex flex-wrap justify-between items-center gap-2">
                                <div className="flex items-center gap-1">
                                  <Award
                                    size={18}
                                    className="text-black shrink-0"
                                  />
                                  <Card.Title className="truncate text-base font-bold text-gray-950 md:text-lg">
                                    {group.competency_code ||
                                      group.competency_statement}
                                  </Card.Title>
                                </div>

                                <Badge
                                  variant="secondary"
                                  size="sm"
                                  className="rounded border border-black bg-white text-xs font-bold text-black"
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
                        </Card.Header>
                      </Card>
                    );
                  })}

                  {/* ── Standalone / Unassigned Lessons Section ── */}
                  {unassignedLessons.length > 0 && (
                    <div className="flex w-full flex-col overflow-hidden pr-1 pb-1">
                      {competencyGroups.length > 0 ? (
                        <>
                          <Card.Header
                            role="button"
                            tabIndex={0}
                            aria-expanded={isUnassignedExpanded}
                            onClick={() =>
                              setIsUnassignedExpanded((prev) => !prev)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setIsUnassignedExpanded((prev) => !prev);
                              }
                            }}
                            className="mb-0 flex-row items-center justify-between border-b-2 border-black bg-primary px-4 py-3.5 text-left cursor-pointer"
                          >
                            <div className="flex items-center gap-2">
                              <BookOpen
                                size={16}
                                className="text-black shrink-0"
                              />
                              <Card.Title className="text-sm font-bold text-black">
                                Unassigned Lessons
                              </Card.Title>
                              <Badge
                                variant="secondary"
                                size="sm"
                                className="rounded border border-black bg-white text-xs font-bold text-black"
                              >
                                {unassignedLessons.length}
                              </Badge>
                            </div>
                          </Card.Header>
                        </>
                      ) : (
                        <Card.Content className="flex flex-col gap-3">
                          {unassignedLessons.map(renderStudentLessonItem)}
                        </Card.Content>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ════════════════ RIGHT: Weekly Goals ════════════════ */}
              <LessonGoalProgress
                goalItems={curatedGoals}
                className="w-full min-w-0 lg:max-w-md lg:flex-1"
                onClassworkClick={(_cwId, asgnId) => {
                  if (asgnId) {
                    openClassworkDetail({
                      classwork_assignment_id: asgnId,
                    } as any);
                  }
                }}
              />
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
