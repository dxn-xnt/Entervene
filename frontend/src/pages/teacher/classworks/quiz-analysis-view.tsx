import { Table } from "@/components/retroui/Table";
import { useState } from "react";
import {
  Check,
  X,
  Pencil,
  BarChart3,
  HelpCircle,
  Users,
  AlertTriangle,
} from "lucide-react";
import type { QuizAnalysis } from "./quiz-builder-types";
import type { TeacherClasswork } from "@/types/classwork";
import { Select } from "@/components/retroui/Select";
import { OverviewCard } from "@/components/overview-cards";
import { Tabs, type TabItem } from "@/components/retroui/Tabs";
import { Card } from "@/components/retroui/Card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/retroui/Tooltip";
import { Badge } from "@/components/retroui/Badge";
import { Avatar } from "@/components/retroui/Avatar";
import { Button } from "@/components/teacher/button";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import {
  compareTrackingStudentsBySurname,
  formatStudentRosterName,
  isTrackingStudentGraded,
  type GradingStatusFilter,
} from "@/lib/classwork-utils";
import type { QuizStudentScore } from "./quiz-builder-types";

const QUIZ_TABS: Array<TabItem<"overview" | "questions">> = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "questions", label: "Questions", icon: HelpCircle },
];

type QuizSubmissionStatus =
  | "on_time"
  | "late"
  | "in_progress"
  | "not_submitted";
type QuizSubmissionStatusFilter = "all" | QuizSubmissionStatus;

/**
 * Accuracy tier thresholds (in percent) for question analysis and navigation.
 * Tune these constants directly to adjust grading bands without modifying JSX logic.
 */
const ACCURACY_THRESHOLD_HIGH = 80; // >= 80%: High mastery (green)
const ACCURACY_THRESHOLD_MEDIUM = 50; // 50% - 79%: Moderate difficulty (yellow); < 50%: Low accuracy / high-wrong (red)

function getAccuracyColorClass(
  accuracy: number | null | undefined,
  answeredCount?: number,
): string {
  if (answeredCount === 0 || accuracy === null || accuracy === undefined) {
    return "bg-gray-100 text-black";
  }
  if (accuracy >= ACCURACY_THRESHOLD_HIGH) {
    return "bg-[#8BCB88] text-black";
  }
  if (accuracy >= ACCURACY_THRESHOLD_MEDIUM) {
    return "bg-[#FFD08A] text-black";
  }
  return "bg-[#FF6B6B] text-black";
}

interface QuizAnalysisViewProps {
  quizAnalysis: QuizAnalysis | null;
  isQuizAnalysisLoading: boolean;
  quizAnalysisError: string;
  selected: TeacherClasswork;
  selectedAssignmentId?: number | "all";
  setSelectedGradingSubmissionId: (id: number) => void;
}

export default function QuizAnalysisView({
  quizAnalysis,
  isQuizAnalysisLoading,
  quizAnalysisError,
  selected,
  selectedAssignmentId = "all",
  setSelectedGradingSubmissionId,
}: QuizAnalysisViewProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "questions">(
    "overview",
  );
  const [studentSort, setStudentSort] = useState<"accuracy" | "name">("name");
  const [submissionStatusFilter, setSubmissionStatusFilter] =
    useState<QuizSubmissionStatusFilter>("all");
  const [gradingStatusFilter, setGradingStatusFilter] =
    useState<GradingStatusFilter>("all");
  const [questionSort, setQuestionSort] = useState<"order" | "accuracy">(
    "order",
  );

  if (isQuizAnalysisLoading) {
    return (
      <p className="rounded border border-dashed border-gray-300 px-4 py-6 text-center text-sm font-semibold text-gray-500">
        Loading quiz analysis...
      </p>
    );
  }

  if (quizAnalysisError) {
    if (quizAnalysisError === "Quiz has not been created") {
      return (
        <TeacherEmptyState
          compact
          className="rounded! bg-card shadow-none hover:shadow-none"
          icon={<HelpCircle />}
          title="No quiz created yet"
          description="Quiz analysis will appear after a quiz is created and students answer it."
        />
      );
    }
    return (
      <p className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
        {quizAnalysisError}
      </p>
    );
  }

  if (!quizAnalysis) {
    return (
      <TeacherEmptyState
        compact
        className="rounded! bg-card shadow-none hover:shadow-none"
        icon={<BarChart3 />}
        title="No quiz analysis yet"
        description="Analysis will appear when quiz results are available."
      />
    );
  }

  const selectedAssignment =
    selectedAssignmentId !== "all"
      ? selected.assignments?.find(
          (assignment) =>
            assignment.classwork_assignment_id === selectedAssignmentId,
        )
      : undefined;
  const dueDate =
    selectedAssignment?.due_date ??
    selected.assignments?.find((assignment) => assignment.due_date)?.due_date ??
    selected.due_date;
  const getQuizSubmissionStatus = (
    student: QuizStudentScore,
  ): QuizSubmissionStatus => {
    const status = student.status.trim().toLowerCase();
    if (
      !student.submission_id ||
      status === "not_submitted" ||
      status === "missed"
    ) {
      return "not_submitted";
    }
    if (status === "pending") return "in_progress";
    if (status === "late") return "late";
    if (
      student.submitted_at &&
      dueDate &&
      new Date(student.submitted_at).getTime() > new Date(dueDate).getTime()
    ) {
      return "late";
    }
    if (["submitted", "graded"].includes(status)) return "on_time";
    return "in_progress";
  };
  const isCompletedGradedResult = (student: QuizStudentScore) => {
    const status = getQuizSubmissionStatus(student);
    return (
      (status === "on_time" || status === "late") &&
      isTrackingStudentGraded(student)
    );
  };

  const completedStudents = quizAnalysis.students.filter((student) => {
    const status = getQuizSubmissionStatus(student);
    return status === "on_time" || status === "late";
  });
  const completedScoredStudents = completedStudents.filter(
    (student) =>
      student.score_percent !== null && student.score_percent !== undefined,
  );
  const classAccuracy =
    completedScoredStudents.length > 0
      ? Math.round(
          (completedScoredStudents.reduce(
            (sum, student) => sum + Number(student.score_percent),
            0,
          ) /
            completedScoredStudents.length) *
            100,
        ) / 100
      : null;
  const getCompletedQuestionStats = (questionId: number) => {
    const evaluatedAnswers = completedStudents
      .map((student) =>
        student.answers?.find(
          (answer) => answer.quiz_question_id === questionId,
        ),
      )
      .filter(
        (answer) => answer?.is_correct === true || answer?.is_correct === false,
      );
    const correctCount = evaluatedAnswers.filter(
      (answer) => answer?.is_correct === true,
    ).length;
    return {
      evaluatedCount: evaluatedAnswers.length,
      correctCount,
      accuracy:
        evaluatedAnswers.length > 0
          ? Math.round((correctCount / evaluatedAnswers.length) * 10000) / 100
          : null,
    };
  };

  const sortedStudents = [...quizAnalysis.students].sort((a, b) => {
    if (studentSort === "accuracy") {
      const aScore = a.score_percent;
      const bScore = b.score_percent;
      if (aScore === null || aScore === undefined) {
        if (bScore !== null && bScore !== undefined) return 1;
      } else if (bScore === null || bScore === undefined) {
        return -1;
      } else if (bScore !== aScore) {
        return bScore - aScore;
      }
    }
    return compareTrackingStudentsBySurname(a, b);
  });

  const filteredStudents = sortedStudents.filter((student) => {
    const status = getQuizSubmissionStatus(student);
    const matchesSubmission =
      submissionStatusFilter === "all" || status === submissionStatusFilter;
    const graded = isCompletedGradedResult(student);
    const matchesGrading =
      gradingStatusFilter === "all" ||
      (gradingStatusFilter === "graded" ? graded : !graded);
    return matchesSubmission && matchesGrading;
  });

  const submissionStatusLabel = (status: QuizSubmissionStatus) =>
    ({
      on_time: "On Time",
      late: "Late",
      in_progress: "In Progress",
      not_submitted: "Not Submitted",
    })[status];

  const sortedQuestions = [...quizAnalysis.questions].sort((a, b) => {
    if (questionSort === "accuracy") {
      const aAcc = getCompletedQuestionStats(a.quiz_question_id).accuracy;
      const bAcc = getCompletedQuestionStats(b.quiz_question_id).accuracy;
      if (aAcc === null) return bAcc === null ? 0 : 1;
      if (bAcc === null) return -1;
      return bAcc - aAcc;
    }
    return 0; // maintain original display_order which is already sorted
  });

  const totalPoints = quizAnalysis.total_points ?? selected.total_points ?? 0;

  return (
    <div className="space-y-4">
      {/* Top 3 Cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <OverviewCard
          className="shadow-none"
          title="Class Accuracy"
          count={
            classAccuracy === null ? "No results yet" : `${classAccuracy}%`
          }
          statDescription="Average completed score"
        />
        <OverviewCard
          className="shadow-none"
          title="Participation"
          count={`${completedStudents.length} of ${quizAnalysis.total_students}`}
          statDescription="Students submitted"
        />
        <OverviewCard
          className="shadow-none"
          title="Questions"
          count={String(quizAnalysis.questions.length)}
          statDescription="Total quiz questions"
        />
      </div>

      <div className="-mx-4 w-[calc(100%+2rem)] gap-2 px-4 ">
        <Tabs
          tabs={QUIZ_TABS}
          activeTab={activeTab}
          className="-mt-2 -mx-4!"
          onTabChange={(tab) => setActiveTab(tab)}
          counts={{
            questions: quizAnalysis.questions.length,
          }}
        />
        <div className="-mx-4 px-4 pb-4">
          <Card className="mt-4 w-full border-0 p-0 shadow-none">
            {activeTab === "questions" && (
              <div>
                {/* Question Navigator */}
                {quizAnalysis.questions.length > 0 && (
                  <div>
                    <Card className="shadow-none w-full bg-white border-2 border-black p-3 sm:p-4 mb-2">
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-xl font-extrabold text-foreground">
                            Question Navigator
                          </span>
                        </div>

                        <div className="flex w-full items-center gap-2 text-sm sm:w-auto">
                          <span className="shrink-0 text-xs font-medium text-gray-600">
                            Sort By:
                          </span>
                          <Select
                            value={questionSort}
                            onValueChange={(value) =>
                              setQuestionSort(value as "order" | "accuracy")
                            }
                          >
                            <Select.Trigger className="h-9 min-w-0 flex-1 border-2 border-black sm:w-48 sm:flex-none">
                              <Select.Value />
                            </Select.Trigger>
                            <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                              <Select.Item value="order">
                                Question Order
                              </Select.Item>
                              <Select.Item value="accuracy">
                                Accuracy
                              </Select.Item>
                            </Select.Content>
                          </Select>
                        </div>
                      </div>
                      <div
                        data-testid="question-navigator-grid"
                        className="mb-2 pl-1 flex flex-wrap gap-2 max-h-36 sm:max-h-40 overflow-y-auto py-1 pr-1 scrollbar-thin"
                      >
                        {quizAnalysis.questions.map((q, idx) => {
                          const displayNum = idx + 1;
                          const stats = getCompletedQuestionStats(
                            q.quiz_question_id,
                          );
                          const accuracyLabel =
                            stats.accuracy === null
                              ? "No results yet"
                              : `${stats.accuracy}% accuracy`;
                          const colorClass = getAccuracyColorClass(
                            stats.accuracy,
                            stats.evaluatedCount,
                          );
                          return (
                            <Tooltip key={q.quiz_question_id}>
                              <TooltipTrigger
                                render={
                                  <button
                                    type="button"
                                    data-testid={`navigator-btn-${displayNum}`}
                                    onClick={() => {
                                      const el = document.getElementById(
                                        `quiz-question-card-${q.quiz_question_id}`,
                                      );
                                      el?.scrollIntoView?.({
                                        behavior: "smooth",
                                        block: "start",
                                      });
                                    }}
                                    className={`relative flex h-8 min-w-8 items-center justify-center rounded border-2 border-black px-2 text-xs font-black transition cursor-pointer ${colorClass} hover:opacity-90 hover:translate-y-1 active:translate-y-2 focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1`}
                                    aria-label={`Jump to question ${displayNum} (${accuracyLabel})`}
                                  >
                                    {displayNum}
                                  </button>
                                }
                              />
                              <TooltipContent>
                                Question {displayNum}: {accuracyLabel}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-2.5 text-xs font-normal text-foreground">
                        <span className="flex items-center gap-1">
                          <span className="h-4 w-4 rounded-sm bg-[#8BCB88] border-2 border-black" />{" "}
                          More than or equal to{" "}
                          <span className="font-bold text-foreground">
                            {ACCURACY_THRESHOLD_HIGH}%
                          </span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="h-4 w-4 rounded-sm bg-[#FFD08A] border-2 border-black" />{" "}
                          In between{" "}
                          <span className="font-bold text-foreground">
                            {ACCURACY_THRESHOLD_MEDIUM}%-
                            {ACCURACY_THRESHOLD_HIGH - 1}%
                          </span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="h-4 w-4 rounded-sm bg-[#FF6B6B] border-2 border-black" />{" "}
                          Less than or equal to{" "}
                          <span className="font-bold text-foreground">
                            {ACCURACY_THRESHOLD_MEDIUM}%
                          </span>
                        </span>
                      </div>
                    </Card>
                  </div>
                )}

                <div className="space-y-3">
                  {sortedQuestions.map((q, i) => {
                    const originalIndex = quizAnalysis.questions.findIndex(
                      (orig) => orig.quiz_question_id === q.quiz_question_id,
                    );
                    const questionNumber =
                      originalIndex !== -1 ? originalIndex + 1 : i + 1;
                    const stats = getCompletedQuestionStats(q.quiz_question_id);
                    const isHighWrong =
                      stats.accuracy !== null &&
                      stats.accuracy < ACCURACY_THRESHOLD_MEDIUM;
                    const wrongPercent =
                      stats.accuracy === null
                        ? null
                        : Math.round(100 - stats.accuracy);
                    return (
                      <div
                        key={q.quiz_question_id}
                        id={`quiz-question-card-${q.quiz_question_id}`}
                        className="scroll-mt-24 rounded border-2 border-black bg-white p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="flex flex-row text-sm items-center gap-2">
                              <Badge
                                variant="solid"
                                size="sm"
                                className="p-1 px-2 rounded!"
                              >
                                {q.question_type === "MULTIPLE_CHOICE"
                                  ? "Multiple Choice"
                                  : q.question_type === "IDENTIFICATION"
                                    ? "Identification (Auto-graded)"
                                    : "Short Answer (Manual)"}
                              </Badge>
                            </div>
                            <div className="flex flex-row text-sm items-center gap-2">
                              <Badge
                                variant="secondary"
                                size="sm"
                                className="font-regular"
                              >
                                <span className="font-bold mr-1">
                                  {q.points}
                                </span>
                                points
                              </Badge>
                            </div>

                            {isHighWrong && (
                              <Badge
                                data-testid={`high-wrong-flag-${q.quiz_question_id}`}
                                variant="destructive"
                                size="sm"
                                className="max-w-full gap-1.5 whitespace-normal leading-tight"
                              >
                                <AlertTriangle
                                  size={14}
                                  className="text-black shrink-0"
                                />
                                <span>
                                  {wrongPercent}% of students got this wrong
                                </span>
                              </Badge>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            <div className="flex flex-row text-sm items-center gap-2">
                              <span className="text-muted-foreground">
                                Correct answer:
                              </span>
                              <Badge variant="secondary" size="sm">
                                {stats.evaluatedCount > 0
                                  ? `${stats.correctCount}/${stats.evaluatedCount}`
                                  : "No results yet"}
                              </Badge>
                            </div>
                            <div className="flex flex-row text-sm items-center gap-2">
                              <span className="text-muted-foreground">
                                Accuracy:
                              </span>
                              <Badge variant="secondary" size="sm">
                                {stats.accuracy === null
                                  ? "No results yet"
                                  : `${stats.accuracy}%`}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <p className="text-lg font-bold mb-4 whitespace-normal break-words [overflow-wrap:anywhere] leading-snug">
                          {questionNumber}. {q.question_text}
                        </p>
                        {q.question_type === "MULTIPLE_CHOICE" ? (
                          <div className="space-y-3 w-full">
                            {q.option_distribution.map((opt, idx) => {
                              const percent =
                                q.answered_count > 0
                                  ? (opt.selected_count / q.answered_count) *
                                    100
                                  : 0;
                              return (
                                <div
                                  key={opt.option_id}
                                  className="flex items-start justify-between pl-4"
                                >
                                  <div className="flex items-center gap-3 flex-1 min-w-0 pr-2">
                                    <span className="w-5 shrink-0 font-bold text-sm">
                                      {String.fromCharCode(65 + idx)}.
                                    </span>
                                    <div className="flex-1 min-w-0 text-sm whitespace-normal break-words [overflow-wrap:anywhere] leading-relaxed text-gray-800">
                                      {opt.option_text}
                                    </div>
                                  </div>
                                  <div className="shrink-0 flex items-center justify-end ml-auto gap-2">
                                    <div className="w-24 shrink-0 text-right text-xs font-bold flex items-center justify-end gap-1">
                                      {opt.is_correct ? (
                                        <span className="text-[#3A6D38] inline-flex items-center gap-1 font-bold">
                                          correct{" "}
                                          <Check
                                            size={12}
                                            className="inline shrink-0"
                                          />
                                        </span>
                                      ) : (
                                        <span className="text-[#B42323] inline-flex items-center gap-1 font-bold">
                                          incorrect{" "}
                                          <X
                                            size={12}
                                            className="inline shrink-0"
                                          />
                                        </span>
                                      )}
                                    </div>

                                    <div className="w-56 sm:w-64 h-7 rounded border-2 bg-white relative overflow-hidden flex items-center shrink-0">
                                      <div
                                        className={`absolute top-0 left-0 h-full ${opt.is_correct ? "bg-[#8BCB88]" : "bg-[#FF6B6B]"}`}
                                        style={{ width: `${percent}%` }}
                                      />
                                      <span className="relative z-10 px-2.5 text-xs font-bold text-black whitespace-nowrap">
                                        {opt.selected_count} answered
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="space-y-3 w-full">
                            {q.option_distribution.length > 0 ? (
                              <div className="space-y-2">
                                <span className="text-xs font-bold uppercase text-gray-500 block">
                                  Expected Key / Correct Answer:
                                </span>
                                {q.option_distribution.map((opt) => {
                                  const percent =
                                    q.answered_count > 0
                                      ? (opt.selected_count /
                                          q.answered_count) *
                                        100
                                      : 0;
                                  return (
                                    <div
                                      key={opt.option_id}
                                      className="flex items-start justify-between gap-4 py-2"
                                    >
                                      <div className="flex items-start gap-3 flex-1 min-w-0 pr-2">
                                        <div className="flex-1 min-w-0 text-sm font-semibold whitespace-normal break-words [overflow-wrap:anywhere] leading-relaxed text-gray-800 pt-0.5">
                                          {opt.option_text}
                                        </div>
                                      </div>
                                      <div className="shrink-0 flex items-center justify-end gap-3 pt-0.5 ml-auto">
                                        <div className="w-24 shrink-0 text-right text-xs font-bold flex items-center justify-end gap-1">
                                          <span className="text-[#3A6D38] inline-flex items-center gap-1 font-bold">
                                            correct{" "}
                                            <Check
                                              size={12}
                                              className="inline shrink-0"
                                            />
                                          </span>
                                        </div>
                                        <div className="w-56 sm:w-64 h-7 rounded bg-white relative overflow-hidden flex items-center shrink-0">
                                          <div
                                            className="absolute top-0 left-0 h-full bg-[#8BCB88]"
                                            style={{ width: `${percent}%` }}
                                          />
                                          <span className="relative z-10 text-xs px-2.5 font-bold whitespace-nowrap text-black">
                                            {opt.selected_count} answered
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="rounded bg-gray-50 p-3 text-xs text-gray-500 italic">
                                {q.question_type === "SHORT_ANSWER"
                                  ? "Open-ended response (graded manually by teacher)."
                                  : "No reference answer key provided."}
                              </div>
                            )}
                            {q.needs_grading_count > 0 && (
                              <div className="mt-2 text-sm text-gray-600">
                                {q.needs_grading_count} response
                                {q.needs_grading_count === 1 ? "" : "s"} need
                                manual grading.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === "overview" && (
              <div>
                <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div className="flex gap-4 text-xs font-bold">
                    <div className="flex items-center font-medium gap-1">
                      <div className="w-4 h-4 bg-[#8BCB88] border-2 border-black rounded-sm" />{" "}
                      Correct
                    </div>
                    <div className="flex items-center font-medium gap-1">
                      <div className="w-4 h-4 bg-[#FF6B6B] border-2 border-black rounded-sm" />{" "}
                      Incorrect
                    </div>
                    <div className="flex items-center font-medium gap-1">
                      <div className="w-4 h-4 bg-white border-2 border-black rounded-sm" />{" "}
                      Unattempted
                    </div>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex min-w-40 flex-col gap-1">
                      <label
                        htmlFor="quiz-submission-status-filter"
                        className="text-xs font-semibold text-muted-foreground"
                      >
                        Submission Status
                      </label>
                      <Select
                        value={submissionStatusFilter}
                        onValueChange={(value) =>
                          setSubmissionStatusFilter(
                            value as QuizSubmissionStatusFilter,
                          )
                        }
                      >
                        <Select.Trigger
                          id="quiz-submission-status-filter"
                          className="h-8 min-w-40 bg-white shadow-none"
                        >
                          <Select.Value />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="all">All</Select.Item>
                          <Select.Item value="on_time">On Time</Select.Item>
                          <Select.Item value="late">Late</Select.Item>
                          <Select.Item value="in_progress">
                            In Progress
                          </Select.Item>
                          <Select.Item value="not_submitted">
                            Not Submitted
                          </Select.Item>
                        </Select.Content>
                      </Select>
                    </div>
                    <div className="flex min-w-40 flex-col gap-1">
                      <label
                        htmlFor="quiz-grading-status-filter"
                        className="text-xs font-semibold text-muted-foreground"
                      >
                        Grading Status
                      </label>
                      <Select
                        value={gradingStatusFilter}
                        onValueChange={(value) =>
                          setGradingStatusFilter(value as GradingStatusFilter)
                        }
                      >
                        <Select.Trigger
                          id="quiz-grading-status-filter"
                          className="h-8 min-w-40 bg-white shadow-none"
                        >
                          <Select.Value />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="all">All</Select.Item>
                          <Select.Item value="graded">Graded</Select.Item>
                          <Select.Item value="not_graded">
                            Not Graded
                          </Select.Item>
                        </Select.Content>
                      </Select>
                    </div>
                    <div className="flex min-w-40 flex-col gap-1">
                      <label
                        htmlFor="quiz-student-sort"
                        className="text-xs font-semibold text-muted-foreground"
                      >
                        Sort By
                      </label>
                      <Select
                        value={studentSort}
                        onValueChange={(value) =>
                          setStudentSort(value as "accuracy" | "name")
                        }
                      >
                        <Select.Trigger
                          id="quiz-student-sort"
                          className="h-8 min-w-40 bg-white shadow-none"
                        >
                          <Select.Value />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="name">Name</Select.Item>
                          <Select.Item value="accuracy">Accuracy</Select.Item>
                        </Select.Content>
                      </Select>
                    </div>
                  </div>
                </div>
                <div className="w-full">
                  <Table
                    data-testid="quiz-overview-student-table"
                    className="min-w-[960px] text-left text-sm"
                    wrapperClassName="shadow-none"
                    containerClassName="max-w-full overflow-x-auto"
                  >
                    <Table.Header>
                      <Table.Row className="border-b-2 border-black">
                        <Table.Head className="w-[260px] min-w-[260px] whitespace-nowrap pl-4 text-sm">
                          Student Name
                        </Table.Head>
                        <Table.Head className="w-[140px] min-w-[140px] whitespace-nowrap text-sm">
                          Submission Status
                        </Table.Head>
                        <Table.Head className="min-w-[240px] whitespace-nowrap text-sm">
                          Question Indicators
                        </Table.Head>
                        <Table.Head className="w-[100px] min-w-[100px] border-l-2 px-4 text-center text-sm">
                          Accuracy
                        </Table.Head>
                        <Table.Head className="w-[110px] min-w-[110px] px-4 text-center text-sm">
                          Score
                        </Table.Head>
                        <Table.Head className="w-[90px] min-w-[90px] pr-4 text-right text-sm">
                          Action
                        </Table.Head>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {filteredStudents.map((student) => {
                        const displayName = formatStudentRosterName(student);
                        const submissionStatus =
                          getQuizSubmissionStatus(student);
                        const isCompletedAttempt =
                          submissionStatus === "on_time" ||
                          submissionStatus === "late";
                        const evaluatedAnswers = isCompletedAttempt
                          ? (student.answers?.filter(
                              (answer) =>
                                answer.is_correct === true ||
                                answer.is_correct === false,
                            ) ?? [])
                          : [];
                        const corrects = evaluatedAnswers.filter(
                          (answer) => answer.is_correct === true,
                        ).length;
                        const hasGrade =
                          isCompletedAttempt &&
                          student.grade !== null &&
                          student.grade !== undefined;
                        const hasScorePercent =
                          isCompletedAttempt &&
                          student.score_percent !== null &&
                          student.score_percent !== undefined;
                        return (
                          <Table.Row
                            key={student.student_id}
                            className="group border-b border-border last:border-0 transition-colors"
                          >
                            <Table.Cell className="w-[260px] min-w-[260px] py-4 pl-4 pr-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <Avatar
                                  variant="student"
                                  className="size-8 shrink-0"
                                >
                                  <Avatar.Image
                                    src={
                                      student.avatar ||
                                      "/avatars/student-avatars/1.svg"
                                    }
                                    alt={displayName}
                                  />
                                  <Avatar.Fallback>
                                    {displayName.slice(0, 1).toUpperCase()}
                                  </Avatar.Fallback>
                                </Avatar>
                                {student.submission_id ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSelectedGradingSubmissionId(
                                        student.submission_id!,
                                      )
                                    }
                                    className="min-w-0 whitespace-normal text-left font-bold leading-tight hover:underline"
                                  >
                                    {displayName}
                                  </button>
                                ) : (
                                  <span className="min-w-0 whitespace-normal font-bold leading-tight text-gray-700">
                                    {displayName}
                                  </span>
                                )}
                              </div>
                            </Table.Cell>
                            <Table.Cell className="w-[140px] min-w-[140px] py-4">
                              <Badge
                                variant={
                                  submissionStatus === "on_time"
                                    ? "success"
                                    : submissionStatus === "late"
                                      ? "destructive"
                                      : "outline"
                                }
                                size="sm"
                                className="shrink-0 whitespace-nowrap"
                              >
                                {submissionStatusLabel(submissionStatus)}
                              </Badge>
                            </Table.Cell>
                            <Table.Cell className="min-w-[240px] py-4">
                              <div
                                data-testid={`question-indicators-${student.student_id}`}
                                role="img"
                                aria-label={
                                  isCompletedAttempt
                                    ? `${corrects} correct out of ${evaluatedAnswers.length} evaluated answers`
                                    : `${submissionStatusLabel(submissionStatus)} attempt indicators`
                                }
                                className="flex w-max min-w-[216px] items-center gap-[3px] py-1 pr-3"
                              >
                                {quizAnalysis.questions.length > 0 ? (
                                  quizAnalysis.questions.map((q, index) => {
                                    const ans = student.answers?.find(
                                      (a) =>
                                        a.quiz_question_id ===
                                        q.quiz_question_id,
                                    );
                                    return (
                                      <div
                                        key={q.quiz_question_id}
                                        title={`Question ${index + 1}`}
                                        className={`h-[18px] w-[14px] shrink-0 rounded-sm border-2 border-black ${ans?.is_correct === true ? "bg-[#8BCB88]" : ans?.is_correct === false ? "bg-[#FF6B6B]" : "bg-gray-100"}`}
                                      />
                                    );
                                  })
                                ) : (
                                  <span className="text-muted-foreground">
                                    —
                                  </span>
                                )}
                              </div>
                            </Table.Cell>
                            <Table.Cell className="w-[100px] min-w-[100px] border-l-2 border-border px-4 py-4 text-center text-lg font-bold">
                              {hasScorePercent ? (
                                <>
                                  {student.score_percent}
                                  <span className="text-xs font-normal text-gray-500">
                                    %
                                  </span>
                                </>
                              ) : (
                                <span className="font-normal text-muted-foreground">
                                  —
                                </span>
                              )}
                            </Table.Cell>
                            <Table.Cell className="w-[110px] min-w-[110px] px-4 py-4 text-center text-lg font-bold">
                              {hasGrade ? (
                                <>
                                  {student.grade}
                                  <span className="text-xs font-normal text-gray-500">
                                    /{totalPoints}
                                  </span>
                                </>
                              ) : (
                                <span className="font-normal text-muted-foreground">
                                  —
                                </span>
                              )}
                            </Table.Cell>
                            <Table.Cell className="w-[90px] min-w-[90px] py-4 pr-4 text-right">
                              {student.submission_id ? (
                                <div className="flex justify-end">
                                  <Button
                                    size="sm"
                                    className="p-1.5 shadow-none"
                                    onClick={() =>
                                      setSelectedGradingSubmissionId(
                                        student.submission_id!,
                                      )
                                    }
                                  >
                                    <Pencil size={14} />
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-xs italic text-gray-400">
                                  No attempt
                                </span>
                              )}
                            </Table.Cell>
                          </Table.Row>
                        );
                      })}
                      {filteredStudents.length === 0 && (
                        <Table.Row className="hover:bg-transparent">
                          <Table.Cell
                            colSpan={7}
                            className="p-0 whitespace-normal"
                          >
                            <TeacherEmptyState
                              compact
                              className="rounded! border-0 bg-card shadow-none hover:shadow-none"
                              icon={<Users />}
                              title="No matching students"
                              description="No students match the selected submission and grading filters."
                            />
                          </Table.Cell>
                        </Table.Row>
                      )}
                    </Table.Body>
                  </Table>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
