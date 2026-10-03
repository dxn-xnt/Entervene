import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronLeft, FileEdit, CheckCircle2, XCircle, Clock, AlertCircle, Award, RotateCcw } from "lucide-react";
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

const StudentQuizResult = () => {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();
  const aid = Number(assignmentId);

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

  const getQuestionStatus = (q: QuizAttemptQuestion): "correct" | "incorrect" | "unattempted" => {
    if (q.is_correct === true) return "correct";
    if (q.is_correct === false) return "incorrect";
    return "unattempted";
  };

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

  const hasUnattemptedOrNeedsGrading = useMemo(() => {
    if (!quiz?.questions) return false;
    return quiz.questions.some((q) => q.is_correct == null);
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
          <Button onClick={() => navigate(routes.student.todo)}>Go to To-Do</Button>
        </div>
      </AppLayout>
    );
  }

  const maxPoints = quiz.total_points ?? quiz.questions.reduce((sum, q) => sum + (q.points || 1), 0);
  const grade = quiz.grade != null ? quiz.grade : null;
  const scorePercent = grade != null && maxPoints > 0 ? Math.round((grade / maxPoints) * 100) : null;
  const isPendingGrading = quiz.status === "submitted" || quiz.status === "late";

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
                      onClick={() => navigate(routes.student.todo)}
                      className="cursor-pointer whitespace-nowrap text-lg text-black/50 hover:text-black sm:text-2xl md:text-4xl"
                    >
                      To-Do
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

            <div className="-mt-[1px] mx-auto flex w-full min-w-0 max-w-4xl flex-1 flex-col gap-4 border-t-2 border-border px-3 py-3 sm:gap-6 sm:px-4 sm:py-4 md:px-6">
              {/* Header Actions */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigate(routes.student.todo)}
                    className="text-black/70 hover:text-black cursor-pointer p-1"
                    aria-label="Go to To-Do"
                  >
                    <ChevronLeft size={22} />
                  </button>
                  <FileEdit size={20} />
                  <h1 className="text-xl md:text-2xl font-bold">{quiz.title}</h1>
                </div>

                <div className="flex items-center gap-2">
                  {quiz.can_submit && (
                    <Button
                      onClick={() => navigate(routes.student.quizTake.replace(":assignmentId", String(aid)))}
                      className="hover:shadow-none transition-all cursor-pointer font-bold"
                    >
                      <RotateCcw className="w-4 h-4 inline mr-1.5" />
                      Retake Quiz
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => navigate(routes.student.todo)}
                    className="cursor-pointer"
                  >
                    Back to To-Do
                  </Button>
                </div>
              </div>

              {/* Score Hero Card */}
              <Card className="bg-[#F6E9B2] p-8 flex flex-col items-center justify-center text-center">
                <span className="text-sm font-bold uppercase tracking-wider text-black/70 mb-1">
                  {isPendingGrading ? "Quiz Submitted" : "Score Result"}
                </span>

                {scorePercent != null ? (
                  <>
                    <p className="text-6xl md:text-7xl font-extrabold my-2">
                      {scorePercent}
                      <span className="text-3xl font-bold">%</span>
                    </p>
                    <p className="text-lg font-bold mt-1 text-black/80">
                      {grade} / {maxPoints} Total Points
                    </p>
                  </>
                ) : (
                  <div className="my-4 flex flex-col items-center gap-2">
                    <Clock className="w-12 h-12 text-amber-600" />
                    <p className="text-xl font-bold text-black/80">Grading in Progress</p>
                    <p className="text-sm text-black/60 max-w-md">
                      Your open-ended answers are currently being reviewed by your instructor.
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-2 mt-4">
                  <Badge
                    variant="surface"
                    className={`font-bold px-3 py-1 text-xs border ${
                      quiz.status === "graded"
                        ? "bg-emerald-100 text-emerald-800 border-emerald-400"
                        : quiz.status === "late"
                          ? "bg-amber-100 text-amber-800 border-amber-400"
                          : "bg-blue-100 text-blue-800 border-blue-400"
                    }`}
                  >
                    Status: {quiz.status.toUpperCase()}
                  </Badge>

                  <span className="text-xs text-black/60 font-medium">
                    Attempt {quiz.attempt_count} of {quiz.max_attempts}
                  </span>
                </div>
              </Card>

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
                        <span className="text-xs font-extrabold uppercase text-gray-700">
                          Question Navigator ({quiz.questions.length} Questions)
                        </span>
                        <div className="flex items-center gap-3 text-[11px] font-bold text-gray-600">
                          <span className="flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-full bg-[#8BCB88] border border-black" /> Correct
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-full bg-[#FF6B6B] border border-black" /> Incorrect
                          </span>
                          {hasUnattemptedOrNeedsGrading && (
                            <span className="flex items-center gap-1.5">
                              <span className="h-2.5 w-2.5 rounded-full bg-[#FFD08A] border border-black" /> Unattempted / Needs Grading
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
                              className={`relative flex h-8 min-w-8 items-center justify-center rounded border-2 border-black px-2 text-xs font-black transition-all cursor-pointer ${
                                status === "correct"
                                  ? "bg-[#8BCB88] text-black"
                                  : status === "incorrect"
                                    ? "bg-[#FF6B6B] text-black"
                                    : "bg-[#FFD08A] text-black"
                              } hover:scale-105 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-1`}
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
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 mt-2.5 border-t border-black/10">
                        <label
                          htmlFor="show-incorrect-only"
                          className={`flex items-center gap-2 select-none text-xs font-bold ${
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
                          <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300">
                            Perfect score! No incorrect questions.
                          </span>
                        )}
                        {showIncorrectOnly && incorrectCount > 0 && (
                          <span className="text-[11px] font-semibold text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-300">
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
                    <span className="text-xs font-semibold text-black/60">
                      {showIncorrectOnly
                        ? `Showing ${displayedQuestions.length} of ${quiz.questions.length} Items`
                        : `${quiz.questions.length} Items`}
                    </span>
                  </div>

                  <div className="flex flex-col gap-3">
                    {displayedQuestions.map(({ question: q, originalIndex }) => {
                      const isCorrect = q.is_correct === true;
                      const isIncorrect = q.is_correct === false;
                      const isNeedsGrading = q.is_correct == null && q.points_awarded == null;

                      return (
                        <Card
                          key={q.quiz_question_id}
                          id={`quiz-question-card-${originalIndex}`}
                          className="bg-white border-2 border-black p-5 flex flex-col gap-3 scroll-mt-48 sm:scroll-mt-40"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-2">
                              <span className="font-bold text-sm text-black/50 shrink-0 mt-0.5">
                                #{originalIndex + 1}
                              </span>
                              <div>
                                <p className="font-semibold text-base">{q.question_text}</p>
                                <span className="text-xs text-black/50 uppercase font-medium">
                                  {q.question_type === "MULTIPLE_CHOICE" ? "Multiple Choice" : q.question_type === "IDENTIFICATION" ? "Identification" : "Short Answer (Essay)"}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {isCorrect && (
                                <Badge variant="surface" className="bg-emerald-100 text-emerald-800 border-emerald-400 font-bold text-xs flex items-center gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  +{q.points_awarded ?? q.points} pts
                                </Badge>
                              )}
                              {isIncorrect && (
                                <Badge variant="surface" className="bg-red-100 text-red-800 border-red-400 font-bold text-xs flex items-center gap-1">
                                  <XCircle className="w-3.5 h-3.5" />
                                  0 / {q.points} pts
                                </Badge>
                              )}
                              {isNeedsGrading && (
                                <Badge variant="surface" className="bg-amber-100 text-amber-800 border-amber-400 font-bold text-xs flex items-center gap-1">
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
                                    className={`px-3 py-2 text-xs border rounded flex items-start justify-between gap-2 min-w-0 h-full ${optStyle}`}
                                  >
                                    <span className="min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere] leading-snug">
                                      {opt.option_text}
                                    </span>
                                    {isSelected && (
                                      <span className="text-[10px] uppercase font-bold tracking-wider shrink-0 mt-0.5">
                                        Your Answer
                                      </span>
                                    )}
                                    {!isSelected && isAnswerCorrect && (
                                      <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-700 shrink-0 mt-0.5">
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
                            <div className="bg-neutral-50 border border-neutral-300 p-3 text-xs">
                              <span className="font-semibold text-black/60 block mb-1">Your Submission:</span>
                              <p className="text-black/90 whitespace-pre-wrap">{q.answer_text || "(No answer provided)"}</p>
                            </div>
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
