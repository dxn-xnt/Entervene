import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronLeft, FileEdit, CheckCircle2, XCircle, Clock, AlertCircle, Loader2, Award, RotateCcw } from "lucide-react";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { routes } from "@/../routes";
import AppLayout from "@/layouts/app-layout";
import { getQuizAttempt, type QuizAttemptResponse } from "@/lib/quiz-api";

const StudentQuizResult = () => {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();
  const aid = Number(assignmentId);

  const [quiz, setQuiz] = useState<QuizAttemptResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) {
    return (
      <AppLayout>
        <div className="flex flex-1 items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-black/50" />
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
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            <header className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" />
              <Breadcrumb>
                <Breadcrumb.List>
                  <Breadcrumb.Item>
                    <Breadcrumb.Link
                      onClick={() => navigate(routes.student.todo)}
                      className="text-xl md:text-2xl text-black/50 hover:text-black cursor-pointer"
                    >
                      To-Do
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator />
                  <Breadcrumb.Item>
                    <Breadcrumb.Page className="text-xl md:text-2xl font-bold">
                      {quiz.title} Results
                    </Breadcrumb.Page>
                  </Breadcrumb.Item>
                </Breadcrumb.List>
              </Breadcrumb>
            </header>

            <div className="-mx-4 md:-mx-6 border-b border-gray-300" />

            <main className="flex flex-1 flex-col gap-6 py-3 max-w-4xl w-full mx-auto">
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
              <Card className="bg-[#F6E9B2] border-2 border-black p-8 flex flex-col items-center justify-center text-center shadow-md">
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
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                      <Award className="w-5 h-5" />
                      Question Breakdown
                    </h2>
                    <span className="text-xs font-semibold text-black/60">
                      {quiz.questions.length} Items
                    </span>
                  </div>

                  <div className="flex flex-col gap-3">
                    {quiz.questions.map((q, idx) => {
                      const isCorrect = q.is_correct === true;
                      const isIncorrect = q.is_correct === false;
                      const isNeedsGrading = q.is_correct == null && q.points_awarded == null;

                      return (
                        <Card
                          key={q.quiz_question_id}
                          className="bg-white border-2 border-black p-5 flex flex-col gap-3"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-2">
                              <span className="font-bold text-sm text-black/50 shrink-0 mt-0.5">
                                #{idx + 1}
                              </span>
                              <div>
                                <p className="font-semibold text-base">{q.question_text}</p>
                                <span className="text-xs text-black/50 uppercase font-medium">
                                  {q.question_type === "MULTIPLE_CHOICE" ? "Multiple Choice" : "Short Answer"}
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
                                  Needs Grading ({q.points} pts)
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
                                    className={`px-3 py-2 text-xs border rounded-none flex items-center justify-between ${optStyle}`}
                                  >
                                    <span>{opt.option_text}</span>
                                    {isSelected && (
                                      <span className="text-[10px] uppercase font-bold tracking-wider ml-2">
                                        Your Answer
                                      </span>
                                    )}
                                    {!isSelected && isAnswerCorrect && (
                                      <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-700 ml-2">
                                        Correct
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Short answer text */}
                          {q.question_type === "SHORT_ANSWER" && (
                            <div className="bg-neutral-50 border border-neutral-300 p-3 text-xs">
                              <span className="font-semibold text-black/60 block mb-1">Your Submission:</span>
                              <p className="text-black/90 whitespace-pre-wrap">{q.answer_text || "(No answer provided)"}</p>
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}
            </main>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default StudentQuizResult;
