import { Table } from "@/components/retroui/Table";
import { useState } from "react";
import { Check, X, Pencil, BarChart3, HelpCircle, Users, AlertTriangle } from "lucide-react";
import type { QuizAnalysis } from "./quiz-builder-types";
import type { TeacherClasswork } from "@/types/classwork";
import { Select } from "@/components/retroui/Select";
import { OverviewCard } from "@/components/overview-cards";
import { Tabs, type TabItem } from "@/components/retroui/Tabs";
import { Card } from "@/components/retroui/Card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
import { Badge } from "@/components/retroui/Badge";
import { Avatar } from "@/components/retroui/Avatar";
import { Button } from "@/components/retroui/Button";

const QUIZ_TABS: Array<TabItem<"overview" | "questions" | "students">> = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "questions", label: "Questions", icon: HelpCircle },
  { id: "students", label: "Students", icon: Users },
];

/**
 * Accuracy tier thresholds (in percent) for question analysis and navigation.
 * Tune these constants directly to adjust grading bands without modifying JSX logic.
 */
export const ACCURACY_THRESHOLD_HIGH = 80;    // >= 80%: High mastery (green)
export const ACCURACY_THRESHOLD_MEDIUM = 50;  // 50% - 79%: Moderate difficulty (yellow); < 50%: Low accuracy / high-wrong (red)

export function getAccuracyColorClass(accuracy: number | null | undefined, answeredCount?: number): string {
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
  setSelectedGradingSubmissionId: (id: number) => void;
}

export default function QuizAnalysisView({
  quizAnalysis,
  isQuizAnalysisLoading,
  quizAnalysisError,
  selected,
  setSelectedGradingSubmissionId,
}: QuizAnalysisViewProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "questions" | "students">("overview");
  const [studentSort, setStudentSort] = useState<"accuracy" | "name">("accuracy");
  const [questionSort, setQuestionSort] = useState<"order" | "accuracy">("order");

  if (isQuizAnalysisLoading) {
    return (
      <p className="rounded border border-dashed border-gray-300 px-4 py-6 text-center text-sm font-semibold text-gray-500">
        Loading quiz analysis...
      </p>
    );
  }

  if (quizAnalysisError) {
    return (
      <p className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
        {quizAnalysisError}
      </p>
    );
  }

  if (!quizAnalysis) {
    return (
      <p className="rounded border border-dashed border-gray-300 px-4 py-6 text-center text-sm font-semibold text-gray-500">
        Quiz analysis is not available yet.
      </p>
    );
  }

  const sortedStudents = [...quizAnalysis.students].sort((a, b) => {
    if (studentSort === "accuracy") {
      const aScore = a.score_percent ?? 0;
      const bScore = b.score_percent ?? 0;
      return bScore - aScore;
    }
    return a.student_name.localeCompare(b.student_name);
  });

  const sortedQuestions = [...quizAnalysis.questions].sort((a, b) => {
    if (questionSort === "accuracy") {
      const aAcc = a.accuracy_percent ?? 0;
      const bAcc = b.accuracy_percent ?? 0;
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
          count={`${quizAnalysis.class_accuracy_percent ?? 0}%`}
          statDescription="Average correct rate"
        />
        <OverviewCard
          className="shadow-none"
          title="Participation"
          count={`${quizAnalysis.submitted_count} of ${quizAnalysis.total_students}`}
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
            students: quizAnalysis.students.length,
          }}
        />
        <div className="-mx-4 px-4 pb-4">
          <Card className="mt-4 w-full border-0 p-0 shadow-none">
            {activeTab === "overview" && (
              <div className="overflow-x-auto">
                <Table className="w-full text-left text-sm border-collapse">
                  <Table.Header>
                    <Table.Row className="border-b border-border">
                      <Table.Head className="font-head text-primary-foreground whitespace-nowrap pr-4">Learner's Name</Table.Head>
                      <Table.Head className="font-head text-primary-foreground text-center px-4">Points</Table.Head>
                      {quizAnalysis.questions.map((q, i) => (
                        <Table.Head key={q.quiz_question_id} className="font-head text-center px-2">
                          <div className="text-xs font-normal text-foreground pr-2">Q{i + 1}</div>
                          <div className="text-sm font-bold whitespace-nowrap text-foreground">{q.accuracy_percent ?? 0}%</div>
                        </Table.Head>
                      ))}
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {sortedStudents.map((student) => (
                      <Table.Row key={student.student_id} className="border-b border-border last:border-0">
                        <Table.Cell className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            <Avatar variant="student" className="size-8 shrink-0">
                              <Avatar.Image
                                src={student.avatar || "/avatars/student-avatars/1.svg"}
                                alt={student.student_name}
                              />
                              <Avatar.Fallback>
                                {student.student_name.slice(0, 1).toUpperCase()}
                              </Avatar.Fallback>
                            </Avatar>
                            <span className="font-bold whitespace-nowrap">{student.student_name}</span>
                          </div>
                        </Table.Cell>
                        <Table.Cell className="py-3 px-4 text-center font-bold">
                          {student.grade ?? 0} <span className="text-gray-500 font-normal">({student.score_percent ?? 0}%)</span>
                        </Table.Cell>
                        {quizAnalysis.questions.map((q) => {
                          const ans = student.answers?.find((a) => a.quiz_question_id === q.quiz_question_id);
                          const isCorrect = ans?.is_correct;
                          return (
                            <Table.Cell key={q.quiz_question_id} className="py-3 px-2 text-center">
                              <div className="flex justify-center">
                                {isCorrect === true ? (
                                  <div className="h-6 w-8 bg-[#8BCB88] border-2 border-black rounded flex items-center justify-center">
                                    <Check size={14} className="text-black" />
                                  </div>
                                ) : isCorrect === false ? (
                                  <div className="h-6 w-8 bg-[#FF6B6B] border-2 border-black rounded flex items-center justify-center">
                                    <X size={14} className="text-black" />
                                  </div>
                                ) : (
                                  <div className="h-6 w-8 bg-gray-100 border-2 border-black rounded" />
                                )}
                              </div>
                            </Table.Cell>
                          );
                        })}
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </div>
            )}

            {activeTab === "questions" && (
              <div>
                {/* Sticky Question Navigator */}
                {quizAnalysis.questions.length > 0 && (
                  <div className="sticky top-[200px] sm:top-[80px] z-20">
                    <Card className="shadow-none w-full bg-white border-2 border-black p-3 sm:p-4 mb-2">
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-xl font-extrabold text-foreground">
                            Question Navigator
                          </span>
                        </div>

                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-medium text-gray-600 text-xs">Sort By:</span>
                          <Select value={questionSort} onValueChange={(v) => setQuestionSort(v as any)}>
                            <Select.Trigger className="h-8 border-2 border-black text-xs font-bold w-36">
                              <Select.Value />
                            </Select.Trigger>
                            <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                              <Select.Item value="order">Question Order</Select.Item>
                              <Select.Item value="accuracy">Accuracy</Select.Item>
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
                          const accuracy = q.accuracy_percent ?? 0;
                          const colorClass = getAccuracyColorClass(q.accuracy_percent, q.answered_count);
                          return (
                            <Tooltip key={q.quiz_question_id}>
                              <TooltipTrigger render={<button
                                type="button"
                                data-testid={`navigator-btn-${displayNum}`}
                                onClick={() => {
                                  const el = document.getElementById(`quiz-question-card-${q.quiz_question_id}`);
                                  el?.scrollIntoView?.({ behavior: "smooth", block: "start" });
                                }}
                                className={`relative flex h-8 min-w-8 items-center justify-center rounded border-2 border-black px-2 text-xs font-black transition cursor-pointer ${colorClass} hover:opacity-90 hover:translate-y-1 active:translate-y-2 focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1`}
                                aria-label={`Jump to question ${displayNum} (${accuracy}% Accuracy)`}
                              >
                                {displayNum}
                              </button>} />
                              <TooltipContent>{q.answered_count === 0 ? `Question ${displayNum}: no attempts` : `Question ${displayNum}: ${accuracy}% accuracy`}</TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-2.5 text-xs font-normal text-foreground">
                        <span className="flex items-center gap-1">
                          <span className="h-4 w-4 rounded-sm bg-[#8BCB88] border-2 border-black" /> More than or equal to <span className="font-bold text-foreground">{ACCURACY_THRESHOLD_HIGH}%</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="h-4 w-4 rounded-sm bg-[#FFD08A] border-2 border-black" /> In between <span className="font-bold text-foreground">{ACCURACY_THRESHOLD_MEDIUM}%-{ACCURACY_THRESHOLD_HIGH - 1}%</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="h-4 w-4 rounded-sm bg-[#FF6B6B] border-2 border-black" /> Less than or equal to <span className="font-bold text-foreground">{ACCURACY_THRESHOLD_MEDIUM}%</span>
                        </span>
                      </div>
                    </Card>
                  </div>
                )}

                <div className="space-y-3">
                  {sortedQuestions.map((q, i) => {
                    const originalIndex = quizAnalysis.questions.findIndex((orig) => orig.quiz_question_id === q.quiz_question_id);
                    const questionNumber = originalIndex !== -1 ? originalIndex + 1 : i + 1;
                    const isHighWrong = (q.answered_count ?? 0) > 0 && (q.accuracy_percent ?? 0) < ACCURACY_THRESHOLD_MEDIUM;
                    const wrongPercent = Math.round(100 - (q.accuracy_percent ?? 0));
                    return (
                      <div
                        key={q.quiz_question_id}
                        id={`quiz-question-card-${q.quiz_question_id}`}
                        className="rounded border-2 border-black p-4 bg-white scroll-mt-[260px] sm:scroll-mt-[280px]"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="flex flex-row text-sm items-center gap-2">
                              <Badge variant="solid" size="sm" className="p-1 px-2 rounded!">
                                {q.question_type === "MULTIPLE_CHOICE"
                                  ? "Multiple Choice"
                                  : q.question_type === "IDENTIFICATION"
                                    ? "Identification (Auto-graded)"
                                    : "Short Answer (Manual)"}
                              </Badge>
                            </div>
                            <div className="flex flex-row text-sm items-center gap-2">
                              <Badge variant="secondary" size="sm" className="font-regular">
                                <span className="font-bold mr-1">
                                  {q.points}
                                </span>
                                points
                              </Badge>
                            </div>

                            {isHighWrong && (
                              <div
                                data-testid={`high-wrong-flag-${q.quiz_question_id}`}
                                className="inline-flex items-center gap-1.5 rounded border border-black bg-[#FF6B6B] px-2.5 py-1.5 text-xs font-bold text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                              >
                                <AlertTriangle size={14} className="text-black shrink-0" />
                                <span>{wrongPercent}% of students got this wrong</span>
                              </div>
                            )}
                          </div>

                          <div className="flex gap-4">
                            <div className="flex flex-row text-sm items-center gap-2">
                              <span className="text-muted-foreground">Correct answer:</span>
                              <Badge variant="secondary" size="sm">{q.correct_count}/{q.answered_count}</Badge>
                            </div>
                            <div className="flex flex-row text-sm items-center gap-2">
                              <span className="text-muted-foreground">Accuracy:</span>
                              <Badge variant="secondary" size="sm">{q.accuracy_percent ?? 0}%</Badge>
                            </div>
                          </div>
                        </div>
                        <p className="text-lg font-bold mb-4 whitespace-normal break-words [overflow-wrap:anywhere] leading-snug">
                          {questionNumber}. {q.question_text}
                        </p>
                        {q.question_type === "MULTIPLE_CHOICE" ? (
                          <div className="space-y-3 w-full">
                            {q.option_distribution.map((opt, idx) => {
                              const percent = q.answered_count > 0 ? (opt.selected_count / q.answered_count) * 100 : 0;
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
                                          correct <Check size={12} className="inline shrink-0" />
                                        </span>
                                      ) : (
                                        <span className="text-[#B42323] inline-flex items-center gap-1 font-bold">
                                          incorrect <X size={12} className="inline shrink-0" />
                                        </span>
                                      )}
                                    </div>

                                    <div className="w-56 sm:w-64 h-7 rounded border-2 bg-white relative overflow-hidden flex items-center shrink-0">
                                      <div
                                        className={`absolute top-0 left-0 h-full ${opt.is_correct ? 'bg-[#8BCB88]' : 'bg-[#FF6B6B]'}`}
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
                                  const percent = q.answered_count > 0 ? (opt.selected_count / q.answered_count) * 100 : 0;
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
                                            correct <Check size={12} className="inline shrink-0" />
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
                                {q.needs_grading_count} response{q.needs_grading_count === 1 ? "" : "s"} need manual grading.
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

            {activeTab === "students" && (
              <div>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex gap-4 text-xs font-bold">
                    <div className="flex items-center font-medium gap-1"><div className="w-4 h-4 bg-[#8BCB88] border-2 border-black rounded-sm" /> Correct</div>
                    <div className="flex items-center font-medium gap-1"><div className="w-4 h-4 bg-[#FF6B6B] border-2 border-black rounded-sm" /> Incorrect</div>
                    <div className="flex items-center font-medium gap-1"><div className="w-4 h-4 bg-white border-2 border-black rounded-sm" /> Unattempted</div>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-gray-600">Sort By:</span>
                    <Select value={studentSort} onValueChange={(v) => setStudentSort(v as any)}>
                      <Select.Trigger className="h-8 bg-white border-2 border-black font-bold w-32">
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                        <Select.Item value="accuracy">Accuracy</Select.Item>
                        <Select.Item value="name">Name</Select.Item>
                      </Select.Content>
                    </Select>
                  </div>
                </div>
                <div className="w-full">
                  <Table className="w-full text-left text-sm border-spacing-0" wrapperClassName="shadow-none">
                    <Table.Header>
                      <Table.Row className="border-b-2 border-black">
                        <Table.Head className="font-head text-primary-foreground whitespace-nowrap pl-4 w-52 sm:w-60 shrink-0">Learner's Name</Table.Head>
                        <Table.Head className="font-head text-primary-foreground min-w-[160px]"></Table.Head>
                        <Table.Head className="font-head text-primary-foreground text-center px-4 sticky  w-[90px] min-w-[90px] max-w-[90px] bg-primary border-l-2 text-sm">Accuracy</Table.Head>
                        <Table.Head className="font-head text-primary-foreground text-center px-4 sticky  w-[90px] min-w-[90px] max-w-[90px] bg-primary text-sm">Points</Table.Head>
                        <Table.Head className="font-head text-primary-foreground text-center px-4 sticky  w-[80px] min-w-[80px] max-w-[80px] bg-primary text-sm">Score</Table.Head>
                        <Table.Head className="font-head text-primary-foreground text-right pr-4 sticky right-0 z-20 w-[80px] bg-primary text-sm text-right">Action</Table.Head>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {sortedStudents.map((student) => {
                        const corrects = student.answers?.filter(a => a.is_correct === true).length || 0;
                        return (
                          <Table.Row key={student.student_id} className="group border-b border-border last:border-0 transition-colors">
                            <Table.Cell className="py-4 pl-4 pr-2 w-52 sm:w-60 shrink-0">
                              <div className="flex items-center gap-2">
                                <Avatar variant="student" className="size-8 shrink-0">
                                  <Avatar.Image
                                    src={student.avatar || "/avatars/student-avatars/1.svg"}
                                    alt={student.student_name}
                                  />
                                  <Avatar.Fallback>
                                    {student.student_name.slice(0, 1).toUpperCase()}
                                  </Avatar.Fallback>
                                </Avatar>
                                {student.submission_id ? (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedGradingSubmissionId(student.submission_id!)}
                                    className="font-bold whitespace-nowrap hover:underline text-left"
                                  >
                                    {student.student_name}
                                  </button>
                                ) : (
                                  <span className="font-bold whitespace-nowrap text-gray-700">
                                    {student.student_name}
                                  </span>
                                )}
                              </div>
                            </Table.Cell>
                            <Table.Cell className="py-4 px-2 min-w-0 max-w-0 w-full">
                              <div className="flex items-center gap-2 min-w-0 w-full">
                                <div
                                  data-testid="dot-strip-scroll-container"
                                  className="overflow-x-auto min-w-0 flex-1 py-1 px-1 scrollbar-thin"
                                >
                                  <div className="flex items-center gap-[2px] w-max pr-3">
                                    {quizAnalysis.questions.map((q) => {
                                      const ans = student.answers?.find(a => a.quiz_question_id === q.quiz_question_id);
                                      return (
                                        <div
                                          key={q.quiz_question_id}
                                          data-testid={`question-dot-${q.quiz_question_id}`}
                                          className={`w-[14px] h-[18px] border-2 border-black rounded-sm shrink-0 ${ans?.is_correct === true ? 'bg-[#8BCB88]' : ans?.is_correct === false ? 'bg-[#FF6B6B]' : 'bg-gray-100'
                                            }`}
                                        />
                                      );
                                    })}
                                  </div>
                                </div>
                                <span className="text-xs font-bold text-[#3A6D38] ml-2 shrink-0 whitespace-nowrap">
                                  {corrects} corrects <Check size={12} className="inline" />
                                </span>
                              </div>
                            </Table.Cell>
                            <Table.Cell className="py-4 px-4 text-center font-bold text-lg w-[90px] min-w-[90px] max-w-[90px] border-l-2 border-border">
                              {student.score_percent ?? 0}<span className="text-xs font-normal text-gray-500">%</span>
                            </Table.Cell>
                            <Table.Cell className="py-4 px-4 text-center font-bold text-lg w-[90px] min-w-[90px] max-w-[90px]">
                              {student.grade ?? 0}<span className="text-xs font-normal text-gray-500">/{totalPoints}</span>
                            </Table.Cell>
                            <Table.Cell className="py-4 px-4 text-center font-bold text-lg w-[80px] min-w-[80px] max-w-[80px]">
                              {student.grade ?? 0}
                            </Table.Cell>
                            <Table.Cell className="py-4 pr-4 text-right">
                              {student.submission_id ? (
                                <div className="flex justify-end">
                                  <Button
                                    size="sm"
                                    className="p-1.5 shadow-none"
                                    onClick={() => setSelectedGradingSubmissionId(student.submission_id!)}
                                  >
                                    <Pencil size={14} />
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-xs italic text-gray-400">No attempt</span>
                              )}
                            </Table.Cell>
                          </Table.Row>
                        );
                      })}
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
