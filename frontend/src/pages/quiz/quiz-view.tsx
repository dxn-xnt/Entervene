import { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Clock, HelpCircle, Award, AlertCircle, RotateCcw } from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card } from "@/components/retroui/Card";
import { routes } from "@/../routes";
import AppLayout from "@/layouts/app-layout";
import {
  getQuizAttempt,
  STUDY_SUPPORT_QUIZ_PASSED_MESSAGE,
  type QuizAttemptResponse,
} from "@/lib/quiz-api";
import {
  quizPathWithContext,
  quizReturnContext,
} from "@/lib/student-quiz-navigation";

const StudentQuizView = () => {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const aid = Number(assignmentId);
  const origin = quizReturnContext(location.search);

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
          setError(
            err instanceof Error ? err.message : "Failed to load quiz details.",
          );
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

  const isCompleted =
    quiz?.status === "submitted" ||
    quiz?.status === "graded" ||
    quiz?.status === "late";
  const isPending = quiz?.status === "pending";

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
                      {quiz?.title || "Quiz Overview"}
                    </Breadcrumb.Page>
                  </Breadcrumb.Item>
                </Breadcrumb.List>
              </Breadcrumb>
            </header>

            <div className="-mt-[1px] flex min-w-0 flex-1 flex-col gap-4 border-t-2 border-border px-3 py-2 sm:px-4 md:px-6">
              {loading ? (
                <LoadingPanel label="Loading quiz..." />
              ) : error || !quiz ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20">
                  <AlertCircle className="w-10 h-10 text-red-500" />
                  <p className="text-lg font-bold text-center text-red-600">
                    {error || "Quiz not found."}
                  </p>
                  <Button onClick={() => navigate(origin.path)}>Go Back</Button>
                </div>
              ) : (
                <>
                  <div className="flex flex-1 flex-col gap-3">
                    {/* Instructions Card */}
                    {quiz.instructions && (
                      <Card className="bg-white">
                        <h3 className="font-bold text-sm text-black/70 uppercase tracking-wide mb-1">
                          Instructions
                        </h3>
                        <p className="text-sm text-black/80 whitespace-pre-wrap">
                          {quiz.instructions}
                        </p>
                      </Card>
                    )}

                    {(isCompleted || isPending) && (
                      <div className="flex items-center justify-end">
                        {isCompleted && (
                          <Badge
                            variant="outline"
                            size="md"
                            className="bg-white px-3 py-1.5 text-sm"
                          >
                            Completed
                          </Badge>
                        )}
                        {isPending && (
                          <Badge
                            variant="outline"
                            size="md"
                            className="bg-white px-3 py-1.5 text-sm"
                          >
                            In Progress
                          </Badge>
                        )}
                      </div>
                    )}

                    {/* Stats Overview Grid */}
                    <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 md:grid-cols-4 md:gap-4">
                      <Card className="flex min-h-48 w-full flex-col items-center justify-center rounded-lg bg-white p-6 text-center shadow-md hover:shadow-md">
                        <HelpCircle className="mb-3 size-7 text-black/65" />
                        <span className="text-3xl font-extrabold">
                          {quiz.questions.length}
                        </span>
                        <span className="mt-2 text-xs font-semibold uppercase tracking-wider text-black/65">
                          {quiz.questions.length === 1
                            ? "Question"
                            : "Questions"}
                        </span>
                      </Card>

                      <Card className="flex min-h-48 w-full flex-col items-center justify-center rounded-lg bg-white p-6 text-center shadow-md hover:shadow-md">
                        <Clock className="mb-3 size-7 text-black/65" />
                        <span className="text-3xl font-extrabold">
                          {quiz.duration_minutes
                            ? `${quiz.duration_minutes}m`
                            : "∞"}
                        </span>
                        <span className="mt-2 text-xs font-semibold uppercase tracking-wider text-black/65">
                          {quiz.duration_minutes
                            ? "Time Limit"
                            : "No Time Limit"}
                        </span>
                      </Card>

                      <Card className="flex min-h-48 w-full flex-col items-center justify-center rounded-lg bg-white p-6 text-center shadow-md hover:shadow-md">
                        <Award className="mb-3 size-7 text-black/65" />
                        <span className="text-3xl font-extrabold">
                          {quiz.total_points != null
                            ? quiz.total_points
                            : quiz.questions.reduce(
                                (sum, q) => sum + (q.points || 1),
                                0,
                              )}
                        </span>
                        <span className="mt-2 text-xs font-semibold uppercase tracking-wider text-black/65">
                          Total Points
                        </span>
                      </Card>

                      <Card className="flex min-h-48 w-full flex-col items-center justify-center rounded-lg bg-white p-6 text-center shadow-md hover:shadow-md">
                        <RotateCcw className="mb-3 size-7 text-black/65" />
                        <span className="text-3xl font-extrabold">
                          {quiz.is_passed
                            ? quiz.attempts_used ?? quiz.attempt_count
                            : `${quiz.attempts_used ?? quiz.attempt_count} / ${quiz.max_attempts}`}
                        </span>
                        <span className="mt-2 text-xs font-semibold uppercase tracking-wider text-black/65">
                          {quiz.is_passed ? "Passed" : "Attempts Used"}
                        </span>
                      </Card>
                    </div>

                    {quiz.is_passed && (
                      <Alert status="success" className="mt-4">
                        <Alert.Title>Passed</Alert.Title>
                        <Alert.Description>
                          {STUDY_SUPPORT_QUIZ_PASSED_MESSAGE}
                        </Alert.Description>
                      </Alert>
                    )}

                    <div className="mt-6 flex w-full flex-wrap items-center justify-center gap-3 sm:mt-8 lg:mt-12">
                      {isCompleted && (
                        <Button
                          variant="outline"
                          onClick={() =>
                            navigate(
                              quizPathWithContext(
                                routes.student.quizResult.replace(
                                  ":assignmentId",
                                  String(aid),
                                ),
                                location.search,
                              ),
                            )
                          }
                          className="hover:shadow-none transition-all cursor-pointer font-bold"
                        >
                          View Results
                        </Button>
                      )}

                      {quiz.can_submit ? (
                        <Button
                          autoIcon={false}
                          onClick={() =>
                            navigate(
                              quizPathWithContext(
                                routes.student.quizTake.replace(
                                  ":assignmentId",
                                  String(aid),
                                ),
                                location.search,
                              ),
                            )
                          }
                          className="hover:shadow-none transition-all cursor-pointer font-bold mt-24"
                        >
                          {isPending
                            ? "Resume Quiz"
                            : isCompleted
                              ? "Retake Quiz"
                              : "Take Quiz"}
                        </Button>
                      ) : !isCompleted ? (
                        <Button
                          disabled
                          className="opacity-50 cursor-not-allowed"
                        >
                          Quiz Closed
                        </Button>
                      ) : null}
                    </div>

                    {/* Previous Result Summary Banner if graded */}
                    {isCompleted && (quiz.grade != null || quiz.show_scores === false) && (
                      <Card className="bg-white p-6 flex flex-col md:flex-row items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-lg">
                              Your Latest Score
                            </h3>
                            {quiz.is_passed && (
                              <Badge variant="success" size="sm">
                                Passed
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-black/60">
                            Submitted on{" "}
                            {quiz.submitted_at
                              ? new Date(quiz.submitted_at).toLocaleString(
                                  undefined,
                                  { dateStyle: "medium", timeStyle: "short" },
                                )
                              : "N/A"}
                          </p>
                          {quiz.show_scores !== false &&
                            quiz.is_intervention_quiz &&
                            quiz.passing_threshold != null && (
                              <p className="text-sm font-medium text-black/70 mt-1">
                                Passing score: {quiz.passing_threshold}%
                              </p>
                            )}
                        </div>
                        <div className="flex items-center gap-3">
                          {quiz.show_scores === false || quiz.grade == null ? (
                            <Badge variant="outline" size="sm">
                              Score hidden
                            </Badge>
                          ) : (
                            <span className="text-4xl font-extrabold">
                              {quiz.grade}
                              <span className="text-xl text-black/50 font-normal">
                                {" "}
                                /{" "}
                                {quiz.total_points ??
                                  quiz.questions.reduce(
                                    (sum, q) => sum + (q.points || 1),
                                    0,
                                  )}{" "}
                                pts
                              </span>
                            </span>
                          )}
                        </div>
                      </Card>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default StudentQuizView;
