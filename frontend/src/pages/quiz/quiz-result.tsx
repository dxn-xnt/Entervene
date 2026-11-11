import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  AlertCircle,
  Award,
  BookOpen,
  CheckCircle2,
  Clock,
  MessageSquare,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Switch } from "@/components/retroui/Switch";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { routes } from "@/../routes";
import AppLayout from "@/layouts/app-layout";
import { getQuizAttempt, type QuizAttemptResponse, type QuizAttemptQuestion } from "@/lib/quiz-api";
import { quizPathWithContext, quizReturnContext } from "@/lib/student-quiz-navigation";

type QuestionStatus = "correct" | "incorrect" | "partial" | "reviewed" | "pending";

function getQuestionStatus(question: QuizAttemptQuestion): QuestionStatus {
  if (question.is_correct === true) return "correct";
  if (question.is_correct === false) return "incorrect";
  if (question.points_awarded == null) return "pending";
  if (question.points_awarded > 0 && question.points_awarded < question.points) {
    return "partial";
  }
  return "reviewed";
}

function questionStatusClass(status: QuestionStatus): string {
  switch (status) {
    case "correct":
      return "bg-[#8BCB88] text-black";
    case "incorrect":
      return "bg-[#FF6B6B] text-black";
    case "partial":
      return "bg-[#FFD08A] text-black";
    case "reviewed":
      return "bg-[#B8D8FF] text-black";
    default:
      return "bg-[#F6E9B2] text-black";
  }
}

const StudentQuizResult = () => {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const aid = Number(assignmentId);
  const origin = quizReturnContext(location.search);

  const [quiz, setQuiz] = useState<QuizAttemptResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showIncorrectOnly, setShowIncorrectOnly] = useState(false);

  useEffect(() => {
    if (!aid) {
      setError("Invalid quiz assignment ID.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function loadResult() {
      setLoading(true);
      setError(null);
      try {
        const data = await getQuizAttempt(aid);
        if (!cancelled) setQuiz(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load quiz results.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadResult();
    return () => {
      cancelled = true;
    };
  }, [aid]);

  const isQuestionIncorrect = (q: QuizAttemptQuestion) => q.is_correct === false;

  const questionItems = useMemo(() => {
    if (!quiz?.questions) return [];
    return quiz.questions.map((q, originalIndex) => ({
      question: q,
      originalIndex,
    }));
  }, [quiz?.questions]);

  const incorrectCount = useMemo(() => {
    if (!quiz?.questions) return 0;
    return quiz.questions.filter(isQuestionIncorrect).length;
  }, [quiz?.questions]);

  const displayedQuestions = useMemo(() => {
    if (showIncorrectOnly) {
      return questionItems.filter(({ question }) => isQuestionIncorrect(question));
    }
    return questionItems;
  }, [showIncorrectOnly, questionItems]);

  const questionStatuses = useMemo(() => {
    if (!quiz?.questions) return [];
    return quiz.questions.map(getQuestionStatus);
  }, [quiz?.questions]);

  const handleQuestionClick = (originalIndex: number) => {
    if (!quiz) return;
    const target = quiz.questions[originalIndex];
    if (showIncorrectOnly && !isQuestionIncorrect(target)) {
      setShowIncorrectOnly(false);
    }
    setTimeout(() => {
      const el = document.getElementById(`quiz-question-card-${originalIndex}`);
      el?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }, 50);
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex flex-1 items-center justify-center min-h-[60vh] px-4">
          <LoadingPanel label="Loading quiz results..." className="w-full" />
        </div>
      </AppLayout>
    );
  }

  if (error || !quiz) {
    return (
      <AppLayout>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 min-h-[60vh] px-4">
          <AlertCircle className="w-10 h-10 text-red-500" />
          <p className="text-lg font-bold text-center text-red-600">{error || "Results not found."}</p>
          <Button onClick={() => navigate(origin.path)}>Back to {origin.label}</Button>
        </div>
      </AppLayout>
    );
  }

  const maxPoints = quiz.total_points ?? quiz.questions.reduce((sum, q) => sum + (q.points || 1), 0);
  const grade = quiz.grade != null ? quiz.grade : null;
  const scorePercent = grade != null && maxPoints > 0 ? Math.round((grade / maxPoints) * 100) : null;
  const isActiveAttempt = quiz.status === "pending" || quiz.status === "not_started";
  const hasVisiblePendingEvaluation =
    quiz.summary_available && quiz.questions.some((question) => question.points_awarded == null);
  const isPendingGrading =
    quiz.status === "submitted" || quiz.status === "late" ||
    (quiz.status === "graded" && hasVisiblePendingEvaluation);
  const showFinalScore = quiz.status === "graded" && !isPendingGrading && scorePercent != null;
  const teacherFeedback = quiz.feedback?.trim() ? quiz.feedback : null;
  const hasPartial = questionStatuses.includes("partial");
  const hasReviewed = questionStatuses.includes("reviewed");
  const hasPending = questionStatuses.includes("pending");
  const allQuestionsCorrect =
    questionStatuses.length > 0 &&
    questionStatuses.every((status) => status === "correct");

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-clip">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex min-w-0 items-center gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <SidebarTrigger className="shrink-0 md:hidden" />
              <Breadcrumb className="min-w-0">
                <Breadcrumb.List className="flex min-w-0 flex-nowrap items-center gap-1.5 text-lg font-extrabold tracking-tight text-black sm:gap-2 sm:text-2xl md:text-3xl">
                  <Breadcrumb.Item>
                    <Breadcrumb.Link
                      onClick={() => navigate(origin.path)}
                      className="cursor-pointer whitespace-nowrap text-lg text-black/50 hover:text-black sm:text-2xl md:text-4xl"
                    >
                      {origin.label}
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator />
                  <Breadcrumb.Item className="min-w-0">
                    <Breadcrumb.Page className="block truncate text-lg font-bold sm:text-xl md:text-3xl">
                      {quiz.title} Results
                    </Breadcrumb.Page>
                  </Breadcrumb.Item>
                </Breadcrumb.List>
              </Breadcrumb>
            </header>

            <div className="-mt-[1px] flex w-full min-w-0 flex-1 flex-col gap-4 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
              {/* Header Actions */}
              <div className="flex flex-wrap items-center justify-end gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  {quiz.can_submit && (
                    <Button
                      onClick={() => navigate(quizPathWithContext(routes.student.quizTake.replace(":assignmentId", String(aid)), location.search))}
                      className="shrink-0 gap-2 whitespace-nowrap"
                    >
                      <RotateCcw className="w-4 h-4 inline mr-1.5" />
                      Retake Quiz
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => navigate(origin.path)}
                    className="shrink-0 gap-2 whitespace-nowrap"
                  >
                    Back to {origin.label}
                  </Button>
                </div>
              </div>

              {/* Score Hero Card */}
              <Card className="bg-card p-5 flex flex-col items-center justify-center text-center shadow-none hover:shadow-none">
                <span className="text-lg font-bold mb-1">
                  {isActiveAttempt ? "Quiz in Progress" : isPendingGrading ? "Quiz Submitted" : "Score Result"}
                </span>

                {isActiveAttempt ? (
                  <div className="my-4 flex flex-col items-center gap-2">
                    <Clock className="w-12 h-12 text-amber-600" />
                    <p className="text-xl font-bold text-black/80">Quiz in Progress</p>
                    <p className="text-sm text-black/60 max-w-md">
                      Complete and submit this attempt to view released results.
                    </p>
                  </div>
                ) : isPendingGrading ? (
                  <div className="my-4 flex flex-col items-center gap-2">
                    <Clock className="w-12 h-12 text-amber-600" />
                    <p className="text-xl font-bold text-black/80">Grading in Progress</p>
                    <p className="text-sm text-black/60 max-w-md">
                      Your open-ended answers are currently awaiting teacher review.
                    </p>
                  </div>
                ) : showFinalScore ? (
                  <>
                    <p
                      className="text-4xl font-bold my-2"
                      aria-label={`Final score ${scorePercent}%`}
                    >
                      {scorePercent}
                      <span className="text-2xl font-bold">%</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {grade} / {maxPoints} Total Points
                    </p>
                  </>
                ) : (
                  <div className="my-4 flex flex-col items-center gap-2">
                    <Clock className="w-12 h-12 text-amber-600" />
                    <p className="text-xl font-bold text-black/80">Score Unavailable</p>
                    <p className="text-sm text-black/60 max-w-md">
                      A final score is not available for this attempt.
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-2 mt-4">
                  <Badge
                    size="sm"
                    variant={quiz.status === "graded" ? "success" : quiz.status === "late" ? "destructive" : "outline"}
                  >
                    {quiz.status.charAt(0).toUpperCase() + quiz.status.slice(1).toLowerCase()}
                  </Badge>

                  <span className="text-sm text-black/60 font-medium">
                    Attempt {quiz.attempt_count} of {quiz.max_attempts}
                  </span>
                </div>
              </Card>

              {teacherFeedback && (
                <Card
                  className="w-full bg-[#F6E9B2]/40 border-2 border-black p-4 shadow-none hover:shadow-none"
                  aria-label="Teacher Feedback"
                >
                  <div className="flex items-start gap-3">
                    <MessageSquare className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <h2 className="font-bold">Teacher Feedback</h2>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-black/75">
                        {teacherFeedback}
                      </p>
                    </div>
                  </div>
                </Card>
              )}

              {/* Summary Release Notice if restricted */}
              {!quiz.summary_available && quiz.summary_message && (
                <Card className="bg-amber-50 border-2 border-amber-300 p-4 text-sm text-amber-900">
                  <p className="font-semibold">{quiz.summary_message}</p>
                </Card>
              )}

              {/* Item-by-item breakdown if summary is released */}
              {quiz.summary_available && quiz.questions.length > 0 && (
                <div className="flex flex-col gap-4">
                  {/* Sticky Question Navigator */}
                  <div className="sticky top-0 z-20 py-2 -mx-1 px-1 sm:px-0 bg-background/95 backdrop-blur-sm">
                    <Card className="shadow-none w-full bg-white border-2 border-black p-3 sm:p-4">
                      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-extrabold text-gray-700">
                          Question Navigator ({quiz.questions.length} Questions)
                        </span>
                        <div className="flex items-center gap-3 text-sm font-bold text-gray-600">
                          <span className="flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-full bg-[#8BCB88] border border-black" /> Correct
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-full bg-[#FF6B6B] border border-black" /> Incorrect
                          </span>
                          {hasPartial && (
                            <span className="flex items-center gap-1.5">
                              <span className="h-2.5 w-2.5 rounded-full bg-[#FFD08A] border border-black" /> Partial
                            </span>
                          )}
                          {hasReviewed && (
                            <span className="flex items-center gap-1.5">
                              <span className="h-2.5 w-2.5 rounded-full bg-[#B8D8FF] border border-black" /> Reviewed
                            </span>
                          )}
                          {hasPending && (
                            <span className="flex items-center gap-1.5">
                              <span className="h-2.5 w-2.5 rounded-full bg-[#F6E9B2] border border-black" /> Pending Review
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto py-1">
                        {quiz.questions.map((q, idx) => {
                          const status = getQuestionStatus(q);
                          return (
                            <button
                              key={q.quiz_question_id}
                              type="button"
                              onClick={() => handleQuestionClick(idx)}
                              className={`relative flex h-8 min-w-8 items-center justify-center rounded border-2 border-black px-2 text-sm font-black transition-all cursor-pointer ${questionStatusClass(status)} hover:scale-105 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1`}
                              title={`Question ${idx + 1}: ${status}`}
                              aria-label={`Question ${idx + 1} (${status})`}
                              data-question-number={idx + 1}
                              data-status={status}
                            >
                              {idx + 1}
                            </button>
                          );
                        })}
                      </div>

                      {/* Show Incorrect Only Toggle */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 mt-2.5">
                        <label
                          htmlFor="show-incorrect-only"
                          className={`flex items-center gap-2 select-none text-sm font-bold ${
                            incorrectCount === 0
                              ? "opacity-50 cursor-not-allowed text-gray-500"
                              : "cursor-pointer text-gray-800"
                          }`}
                        >
                          <Switch
                            id="show-incorrect-only"
                            checked={showIncorrectOnly}
                            onCheckedChange={setShowIncorrectOnly}
                            disabled={incorrectCount === 0}
                            aria-label={`Show incorrect only (${incorrectCount})`}
                          />
                          <span>Show incorrect only ({incorrectCount})</span>
                        </label>

                        {incorrectCount === 0 && (
                          <span className={`text-sm font-semibold px-2 py-0.5 rounded border ${
                            allQuestionsCorrect
                              ? "text-emerald-700 bg-emerald-50 border-emerald-300"
                              : "text-gray-700 bg-gray-50 border-gray-300"
                          }`}>
                            {allQuestionsCorrect
                              ? "Perfect score! No incorrect questions."
                              : "No incorrect responses to show."}
                          </span>
                        )}
                        {showIncorrectOnly && incorrectCount > 0 && (
                          <span className="text-sm font-semibold text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-300">
                            Showing {displayedQuestions.length} wrong answers
                          </span>
                        )}
                      </div>
                    </Card>
                  </div>

                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                      <Award className="w-5 h-5" />
                      Question Breakdown
                    </h2>
                    <span className="text-sm font-semibold text-black/60">
                      {showIncorrectOnly
                        ? `Showing ${displayedQuestions.length} of ${quiz.questions.length} Items`
                        : `${quiz.questions.length} Items`}
                    </span>
                  </div>

                  <div className="flex flex-col gap-3">
                    {displayedQuestions.map(({ question: q, originalIndex }) => {
                      const status = getQuestionStatus(q);
                      const isCorrect = status === "correct";
                      const isIncorrect = status === "incorrect";
                      const isPartial = status === "partial";
                      const isReviewed = status === "reviewed";
                      const isNeedsGrading = status === "pending";

                      return (
                        <Card
                          key={q.quiz_question_id}
                          id={`quiz-question-card-${originalIndex}`}
                          className="bg-card border-2 border-border p-4 shadow-none hover:shadow-none flex flex-col gap-3 scroll-mt-48 sm:scroll-mt-40"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-2">
                              <span className="font-bold text-sm text-black/50 shrink-0 mt-0.5">
                                #{originalIndex + 1}
                              </span>
                              <div>
                                <p className="font-semibold text-base">{q.question_text}</p>
                                <span className="text-sm text-black/50 font-medium">
                                  {q.question_type === "MULTIPLE_CHOICE" ? "Multiple Choice" : q.question_type === "IDENTIFICATION" ? "Identification" : "Short Answer (Essay)"}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {isCorrect && (
                                <Badge size="sm" variant="success" className="gap-1.5">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  +{q.points_awarded ?? q.points} pts
                                </Badge>
                              )}
                              {isIncorrect && (
                                <Badge size="sm" variant="destructive" className="gap-1.5">
                                  <XCircle className="w-3.5 h-3.5" />
                                  {q.points_awarded ?? 0} / {q.points} pts
                                </Badge>
                              )}
                              {isPartial && (
                                <Badge size="sm" variant="outline" className="gap-1.5 bg-[#FFD08A]/40">
                                  <Award className="w-3.5 h-3.5" />
                                  Partially Correct - {q.points_awarded} / {q.points} pts
                                </Badge>
                              )}
                              {isReviewed && (
                                <Badge size="sm" variant="outline" className="gap-1.5 bg-[#B8D8FF]/40">
                                  <Award className="w-3.5 h-3.5" />
                                  Reviewed - {q.points_awarded} / {q.points} pts
                                </Badge>
                              )}
                              {isNeedsGrading && (
                                <Badge size="sm" variant="default" className="gap-1.5">
                                  <Clock className="w-3.5 h-3.5" />
                                  Pending Teacher Review ({q.points} pts)
                                </Badge>
                              )}
                            </div>
                          </div>

                          {/* Options display for multiple choice */}
                          {q.question_type === "MULTIPLE_CHOICE" && q.options.length > 0 && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                              {q.options.map((opt) => {
                                const isSelected = q.selected_option_id === opt.option_id;
                                const isAnswerCorrect = opt.is_correct === true;

                                let optStyle = "bg-neutral-50 border-neutral-200 text-black/70";
                                if (isSelected && isCorrect) {
                                  optStyle = "bg-emerald-50 border-emerald-500 font-bold text-emerald-900";
                                } else if (isSelected && isIncorrect) {
                                  optStyle = "bg-red-50 border-red-500 font-bold text-red-900 line-through";
                                } else if (isAnswerCorrect) {
                                  optStyle = "bg-emerald-50 border-emerald-400 font-bold text-emerald-900";
                                }

                                return (
                                  <div
                                    key={opt.option_id}
                                    className={`px-3 py-2 text-sm border rounded! flex items-start justify-between gap-2 min-w-0 h-full ${optStyle}`}
                                  >
                                    <span className="min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere] leading-snug">
                                      {opt.option_text}
                                    </span>
                                    {isSelected && (
                                      <span className="text-sm font-bold tracking-wider shrink-0 mt-0.5">
                                        Your Answer
                                      </span>
                                    )}
                                    {!isSelected && isAnswerCorrect && (
                                      <span className="text-sm font-bold tracking-wider text-emerald-700 shrink-0 mt-0.5">
                                        Correct
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Text submission for short answer or identification */}
                          {q.question_type !== "MULTIPLE_CHOICE" && (
                            <div className="bg-neutral-50 border border-neutral-300 p-3 text-sm">
                              <span className="font-semibold text-black/60 block mb-1">Your Submission:</span>
                              <p className="text-black/90 whitespace-pre-wrap">{q.answer_text || "(No answer provided)"}</p>
                            </div>
                          )}

                          {q.explanation?.trim() && (
                            <Card
                              className="block w-full bg-[#FFFBEE] border-2 border-black p-3 shadow-none hover:shadow-none"
                              aria-label="Explanation"
                            >
                              <div className="flex items-start gap-2">
                                <BookOpen className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                                <div className="min-w-0">
                                  <p className="text-sm font-bold">Explanation</p>
                                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-black/75">
                                    {q.explanation}
                                  </p>
                                </div>
                              </div>
                            </Card>
                          )}
                        </Card>
                      );
                    })}
                    {displayedQuestions.length === 0 && (
                      <Card className="bg-white border-2 border-black p-8 text-center">
                        <p className="font-bold text-sm text-black/70">No questions to display.</p>
                      </Card>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default StudentQuizResult;
