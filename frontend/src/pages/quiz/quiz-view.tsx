import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronLeft, FileEdit, Clock, HelpCircle, Award, AlertCircle, RotateCcw } from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card } from "@/components/retroui/Card";
import { routes } from "@/../routes";
import AppLayout from "@/layouts/app-layout";
import { getQuizAttempt, type QuizAttemptResponse } from "@/lib/quiz-api";

const StudentQuizView = () => {
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
    async function loadQuiz() {
      setLoading(true);
      setError(null);
      try {
        const data = await getQuizAttempt(aid);
        if (!cancelled) setQuiz(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load quiz details.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadQuiz();
    return () => {
      cancelled = true;
    };
  }, [aid]);

  const isCompleted = quiz?.status === "submitted" || quiz?.status === "graded" || quiz?.status === "late";
  const isPending = quiz?.status === "pending";

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
                      {quiz?.title || "Quiz Overview"}
                    </Breadcrumb.Page>
                  </Breadcrumb.Item>
                </Breadcrumb.List>
              </Breadcrumb>
            </header>

            <div className="-mx-4 md:-mx-6 border-b border-gray-300" />

            <main className="flex flex-1 flex-col gap-4 py-3">
              {loading ? (
                <LoadingPanel label="Loading quiz..." />
              ) : error || !quiz ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20">
                  <AlertCircle className="w-10 h-10 text-red-500" />
                  <p className="text-lg font-bold text-center text-red-600">{error || "Quiz not found."}</p>
                  <Button onClick={() => navigate(-1)}>Go Back</Button>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigate(-1)}
                        className="text-black/70 hover:text-black cursor-pointer p-1"
                        aria-label="Go back"
                      >
                        <ChevronLeft size={22} />
                      </button>
                      <FileEdit size={20} />
                      <h1 className="text-xl md:text-2xl font-bold">{quiz.title}</h1>
                      {isCompleted && (
                        <Badge variant="surface" className="ml-2 bg-emerald-100 text-emerald-800 border-emerald-300 font-semibold">
                          Completed
                        </Badge>
                      )}
                      {isPending && (
                        <Badge variant="surface" className="ml-2 bg-amber-100 text-amber-800 border-amber-300 font-semibold">
                          In Progress
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {isCompleted && (
                        <Button
                          variant="outline"
                          onClick={() => navigate(routes.student.quizResult.replace(":assignmentId", String(aid)))}
                          className="hover:shadow-none transition-all cursor-pointer font-bold"
                        >
                          View Results
                        </Button>
                      )}

                      {quiz.can_submit ? (
                        <Button
                          onClick={() => navigate(routes.student.quizTake.replace(":assignmentId", String(aid)))}
                          className="hover:shadow-none transition-all cursor-pointer font-bold"
                        >
                          {isPending ? "Resume Quiz" : isCompleted ? "Retake Quiz" : "Take Quiz"}
                        </Button>
                      ) : !isCompleted ? (
                        <Button disabled className="opacity-50 cursor-not-allowed">
                          Quiz Closed
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col gap-6 py-4">
                    {/* Instructions Card */}
                    {quiz.instructions && (
                      <Card className="bg-white border-2 border-black p-4">
                        <h3 className="font-bold text-sm text-black/70 uppercase tracking-wide mb-1">Instructions</h3>
                        <p className="text-sm text-black/80 whitespace-pre-wrap">{quiz.instructions}</p>
                      </Card>
                    )}

                    {/* Stats Overview Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <Card className="bg-[#F6E9B2] border-2 border-black flex flex-col items-center justify-center p-6 text-center">
                        <HelpCircle className="w-6 h-6 mb-2 text-black/70" />
                        <span className="text-3xl font-extrabold">{quiz.questions.length}</span>
                        <span className="text-xs font-semibold text-black/70 uppercase tracking-wider mt-1">
                          {quiz.questions.length === 1 ? "Question" : "Questions"}
                        </span>
                      </Card>

                      <Card className="bg-[#F6E9B2] border-2 border-black flex flex-col items-center justify-center p-6 text-center">
                        <Clock className="w-6 h-6 mb-2 text-black/70" />
                        <span className="text-3xl font-extrabold">
                          {quiz.duration_minutes ? `${quiz.duration_minutes}m` : "∞"}
                        </span>
                        <span className="text-xs font-semibold text-black/70 uppercase tracking-wider mt-1">
                          {quiz.duration_minutes ? "Time Limit" : "No Time Limit"}
                        </span>
                      </Card>

                      <Card className="bg-[#F6E9B2] border-2 border-black flex flex-col items-center justify-center p-6 text-center">
                        <Award className="w-6 h-6 mb-2 text-black/70" />
                        <span className="text-3xl font-extrabold">
                          {quiz.total_points != null ? quiz.total_points : quiz.questions.reduce((sum, q) => sum + (q.points || 1), 0)}
                        </span>
                        <span className="text-xs font-semibold text-black/70 uppercase tracking-wider mt-1">
                          Total Points
                        </span>
                      </Card>

                      <Card className="bg-[#F6E9B2] border-2 border-black flex flex-col items-center justify-center p-6 text-center">
                        <RotateCcw className="w-6 h-6 mb-2 text-black/70" />
                        <span className="text-3xl font-extrabold">
                          {quiz.attempt_count} / {quiz.max_attempts}
                        </span>
                        <span className="text-xs font-semibold text-black/70 uppercase tracking-wider mt-1">
                          Attempts Used
                        </span>
                      </Card>
                    </div>

                    {/* Previous Result Summary Banner if graded */}
                    {isCompleted && quiz.grade != null && (
                      <Card className="bg-white border-2 border-black p-6 flex flex-col md:flex-row items-center justify-between gap-4">
                        <div>
                          <h3 className="font-bold text-lg">Your Latest Score</h3>
                          <p className="text-sm text-black/60">
                            Submitted on {quiz.submitted_at ? new Date(quiz.submitted_at).toLocaleDateString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "N/A"}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-4xl font-extrabold">
                            {quiz.grade}
                            <span className="text-xl text-black/50 font-normal"> / {quiz.total_points ?? quiz.questions.reduce((sum, q) => sum + (q.points || 1), 0)} pts</span>
                          </span>
                        </div>
                      </Card>
                    )}
                  </div>
                </>
              )}
            </main>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default StudentQuizView;
