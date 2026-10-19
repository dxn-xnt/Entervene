import { useEffect, useMemo, useState } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  CheckSquare,
  ClipboardList,
  FileText,
  LockKeyhole,
} from "lucide-react";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import IconContainer from "@/components/icon-container";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/retroui/tooltip";
import { LoadingPanel } from "@/components/loading-panel";
import AttachmentDisplay from "@/components/attachment-display";
import SubmissionForm from "@/components/submission-form";
import SubmissionViewer from "@/components/submission-viewer";
import RubricsScoreBoard from "@/components/rubrics-score-board";
import StudentQuizFullscreen from "./forms/student-quiz-fullscreen";
import { useReadingFocusTracker } from "@/hooks/use-reading-focus-tracker";
import { useToast } from "@/components/retroui/use-toast";
import { API_URL, apiFetch } from "@/lib/api";
import { getQuizAttempt, type QuizAttemptResponse } from "@/lib/quiz-api";
import {
  studentClassworkReturnPath,
  studentClassworkSourceLabel,
} from "@/lib/student-classwork-navigation";
import { quizPathWithContext } from "@/lib/student-quiz-navigation";
import { routes } from "@/../routes";
import type { ClassworkDetail, Submission } from "./subjects-view/types";
import type { ActivityRubricLevel } from "@/types/classwork";

type StudentClassworkDetail = ClassworkDetail & {
  class_id: number;
  subject_id: number;
  subject_name?: string | null;
  section_name?: string | null;
  lock_date?: string | null;
  rubric_levels?: ActivityRubricLevel[];
};

function statusLabel(status?: string | null): string {
  if (!status || status === "not_submitted_yet") return "Not submitted";
  return status.replaceAll("_", " ");
}

function ClassworkTypeIcon({ type }: { type?: string | null }) {
  switch (type?.toUpperCase()) {
    case "QUIZ":
      return <ClipboardList />;
    case "ASSIGNMENT":
      return <BookOpen />;
    case "ACTIVITY":
      return <CheckSquare />;
    default:
      return <FileText />;
  }
}

export default function StudentClassworkView() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { assignmentId: rawId } = useParams<{ assignmentId: string }>();
  const [searchParams] = useSearchParams();
  const assignmentId = Number(rawId);
  const [detail, setDetail] = useState<StudentClassworkDetail | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [quiz, setQuiz] = useState<QuizAttemptResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [quizError, setQuizError] = useState("");
  const [showQuizSummary, setShowQuizSummary] = useState(false);
  const [quizCurrentIndex, setQuizCurrentIndex] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<
    Record<number, { selected_option_id?: number; answer_text?: string }>
  >({});
  const [quizReviewMode, setQuizReviewMode] = useState(true);

  const isQuiz = detail?.classwork_type?.toUpperCase() === "QUIZ";
  const isReading = detail?.classwork_type?.toUpperCase() === "READING";
  useReadingFocusTracker(assignmentId, Boolean(detail && isReading));

  useEffect(() => {
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
      setError("Invalid classwork link.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await apiFetch(
          `/api/v1/classwork-assignments/assignment/${assignmentId}`,
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(
            response.status === 403 || response.status === 404
              ? "This classwork is unavailable or you do not have access."
              : String(body.detail || "Unable to load classwork."),
          );
        }
        const nextDetail = (await response.json()) as StudentClassworkDetail;
        if (cancelled) return;
        setDetail(nextDetail);
        if (nextDetail.classwork_type?.toUpperCase() === "QUIZ") {
          try {
            const attempt = await getQuizAttempt(assignmentId);
            if (!cancelled) setQuiz(attempt);
          } catch (cause) {
            if (!cancelled)
              setQuizError(
                cause instanceof Error
                  ? cause.message
                  : "Unable to load quiz details.",
              );
          }
        } else {
          const submissionsResponse = await apiFetch(
            "/api/v1/submissions/my-submissions",
          );
          if (!cancelled && submissionsResponse.ok) {
            const submissions =
              (await submissionsResponse.json()) as Submission[];
            setSubmission(
              submissions.find(
                (item) => item.classwork_assignment_id === assignmentId,
              ) ?? null,
            );
          }
        }
      } catch (cause) {
        if (!cancelled)
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load classwork.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [assignmentId]);

  const returnPath = useMemo(
    () =>
      studentClassworkReturnPath(
        searchParams.get("from"),
        detail?.class_id,
        detail?.subject_id,
      ),
    [searchParams, detail?.class_id, detail?.subject_id],
  );
  const sourceLabel = studentClassworkSourceLabel(returnPath);
  const fromSubject = returnPath.startsWith("/student/subjects/");
  const quizLink = quizPathWithContext(
    routes.student.quizView.replace(":assignmentId", String(assignmentId)),
    `?from=${encodeURIComponent(`${location.pathname}${location.search}`)}`,
  );
  const back = () => navigate(returnPath);
  const dueDate = detail?.due_date ? new Date(detail.due_date) : null;
  const overdue = Boolean(dueDate && Date.now() > dueDate.getTime());
  const closed = Boolean(
    detail?.is_locked || (overdue && !detail?.allow_late_submissions),
  );
  const status =
    quiz?.status ?? submission?.status ?? detail?.submission_status;

  const submitFiles = async (files: File[]) => {
    setActionLoading(true);
    try {
      const body = new FormData();
      files.forEach((file) => body.append("files", file));
      const response = await apiFetch(
        `/api/v1/submissions/assignment/${assignmentId}/submit`,
        { method: "POST", body },
      );
      if (!response.ok) throw new Error("Failed to submit assignment.");
      const next = (await response.json()) as Submission;
      setSubmission(next);
      setDetail((current) =>
        current ? { ...current, submission_status: next.status } : current,
      );
      toast.success({
        title: "Assignment submitted",
        description: "Your work was submitted successfully.",
      });
    } catch (cause) {
      toast.error({
        title: "Submission failed",
        description:
          cause instanceof Error
            ? cause.message
            : "Failed to submit assignment.",
      });
      throw cause;
    } finally {
      setActionLoading(false);
    }
  };

  const completeReading = async () => {
    setActionLoading(true);
    try {
      const response = await apiFetch(
        `/api/v1/submissions/assignment/${assignmentId}/complete-reading`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error("Failed to complete reading.");
      const next = (await response.json()) as Submission;
      setSubmission(next);
      setDetail((current) =>
        current ? { ...current, submission_status: next.status } : current,
      );
      toast.success({
        title: "Reading completed",
        description: "Your progress has been updated.",
      });
    } catch (cause) {
      toast.error({
        title: "Failed to update reading status",
        description:
          cause instanceof Error ? cause.message : "Please try again.",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const deleteSubmission = async () => {
    setActionLoading(true);
    try {
      const response = await apiFetch(
        `/api/v1/submissions/assignment/${assignmentId}/submit`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("Failed to delete submission.");
      setSubmission(null);
      setDetail((current) =>
        current
          ? { ...current, submission_status: "not_submitted_yet" }
          : current,
      );
      toast.success({
        title: "Submission deleted",
        description: "You can now resubmit your work.",
      });
    } catch (cause) {
      toast.error({
        title: "Delete failed",
        description:
          cause instanceof Error ? cause.message : "Please try again.",
      });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <>
      <AppLayout>
        <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
          <header
            data-student-detail-header
            className="flex min-w-0 items-center gap-3 bg-background px-3 py-3 sm:px-4 sm:py-4 md:px-6"
          >
            <SidebarTrigger className="shrink-0 md:hidden" />
            <Breadcrumb className="min-w-0 flex-1">
              <Breadcrumb.List className="flex min-w-0 flex-nowrap items-center gap-2 text-lg font-extrabold sm:text-2xl">
                {fromSubject && (
                  <>
                    <Breadcrumb.Item className="shrink-0">
                      <Breadcrumb.Link
                        onClick={() => navigate(routes.student.subjects)}
                        className="cursor-pointer text-muted-foreground"
                      >
                        Subjects
                      </Breadcrumb.Link>
                    </Breadcrumb.Item>
                    <Breadcrumb.Separator />
                  </>
                )}
                <Breadcrumb.Item>
                  <Breadcrumb.Link
                    onClick={back}
                    className="block max-w-32 cursor-pointer truncate text-muted-foreground sm:max-w-56 md:max-w-72"
                  >
                    {fromSubject ? detail?.subject_name || "Subject" : sourceLabel}
                  </Breadcrumb.Link>
                </Breadcrumb.Item>
                <Breadcrumb.Separator />
                <Breadcrumb.Item className="min-w-0">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Breadcrumb.Page
                          className="block max-w-[35vw] truncate font-bold sm:max-w-[45vw]"
                          tabIndex={0}
                        >
                          {detail?.title || "Classwork"}
                        </Breadcrumb.Page>
                      }
                    />
                    <TooltipContent>
                      {detail?.title || "Classwork"}
                    </TooltipContent>
                  </Tooltip>
                </Breadcrumb.Item>
              </Breadcrumb.List>
            </Breadcrumb>
          </header>

          <main className="flex min-w-0 flex-1 flex-col gap-4 px-3 py-3 sm:px-4 sm:py-4 md:px-6">
            {loading ? (
              <LoadingPanel label="Loading classwork..." />
            ) : error || !detail ? (
              <Card className="block w-full p-6 text-center shadow-none">
                <p role="alert" className="text-sm text-destructive">
                  {error || "Classwork not found."}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={back}
                  className="mx-auto mt-4 gap-2"
                >
                  <ArrowLeft />
                  Back
                </Button>
              </Card>
            ) : (
              <div className="flex w-full min-w-0 flex-col gap-3">
                <Card className="mx-auto flex w-full flex-col gap-4 px-5 pt-6">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <IconContainer
                        variant="primary"
                        size="xl"
                        className="size-16 p-0 [&_svg]:size-8"
                      >
                        <ClassworkTypeIcon type={detail.classwork_type} />
                      </IconContainer>
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h1 className="break-words text-2xl font-bold sm:text-3xl">
                            {detail.title}
                          </h1>
                          <Badge
                            variant="secondary"
                            size="sm"
                            className="capitalize"
                          >
                            {detail.classwork_type || "Classwork"}
                          </Badge>
                        </div>
                        {detail.linked_lessons &&
                        detail.linked_lessons.length > 0 ? (
                          <p className="text-sm text-muted-foreground">
                            Linked under{" "}
                            {detail.linked_lessons.length === 1
                              ? "lesson"
                              : "lessons"}{" "}
                            <span className="font-semibold text-foreground">
                              {detail.linked_lessons
                                .map((lesson) => lesson.title)
                                .join(", ")}
                            </span>
                            {detail.subject_name && (
                              <>
                                {" "}
                                in{" "}
                                <span className="font-semibold text-foreground">
                                  {detail.subject_name}
                                </span>
                              </>
                            )}
                          </p>
                        ) : detail.subject_name ? (
                          <p className="text-sm text-muted-foreground">
                            Subject:{" "}
                            <span className="font-semibold text-foreground">
                              {detail.subject_name}
                            </span>
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {detail.classwork_category && (
                        <Badge
                          variant="outline"
                          size="md"
                          className="capitalize"
                        >
                          {detail.classwork_category.replaceAll("_", " ")}
                        </Badge>
                      )}
                      <Badge
                        variant={
                          status === "graded" ||
                          status === "submitted" ||
                          status === "completed"
                            ? "success"
                            : closed
                              ? "destructive"
                              : "outline"
                        }
                        size="md"
                        className="capitalize"
                      >
                        {closed && !submission ? "Closed" : statusLabel(status)}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col gap-4 px-2">
                    <section className="space-y-2">
                      <h2 className="text-lg font-bold">Instructions</h2>
                      <Card className="block w-full p-3 shadow-none">
                        <p className="whitespace-pre-wrap break-words text-sm">
                          {detail.instructions ||
                            detail.description ||
                            "No instructions provided."}
                        </p>
                      </Card>
                    </section>
                    {detail.description && detail.instructions && (
                      <section className="space-y-2">
                        <h2 className="text-lg font-bold">
                          About this classwork
                        </h2>
                        <Card className="block w-full p-3 shadow-none">
                          <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                            {detail.description}
                          </p>
                        </Card>
                      </section>
                    )}
                    {detail.linked_lessons &&
                      detail.linked_lessons.length > 0 && (
                        <Card className="block w-full shadow-none">
                          <h2 className="font-bold">Learning materials</h2>
                          <div className="mt-3 space-y-3">
                            {detail.linked_lessons.map((lesson) => (
                              <Card
                                key={lesson.lesson_id}
                                className="block w-full p-3 shadow-none"
                              >
                                <p className="font-semibold">{lesson.title}</p>
                                {lesson.description && (
                                  <p className="text-sm text-muted-foreground">
                                    {lesson.description}
                                  </p>
                                )}
                                {lesson.readings &&
                                  lesson.readings.length > 0 && (
                                    <div className="mt-3 space-y-2">
                                      <p className="flex items-center gap-2 text-sm font-semibold">
                                        <BookOpen size={16} />
                                        Reading materials
                                      </p>
                                      {lesson.readings.map((reading) => (
                                        <div
                                          key={reading.classwork_id}
                                          className="rounded-md border border-border p-2 text-sm"
                                        >
                                          <p className="font-semibold">
                                            {reading.title}
                                          </p>
                                          {reading.description && (
                                            <p className="text-muted-foreground">
                                              {reading.description}
                                            </p>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                {lesson.attachments &&
                                  lesson.attachments.length > 0 && (
                                    <div className="mt-3">
                                      <AttachmentDisplay
                                        attachments={lesson.attachments}
                                        type="lesson"
                                        downloadUrl={(id) =>
                                          `${API_URL}/api/v1/lessons/${lesson.lesson_id}/attachments/${id}/download`
                                        }
                                      />
                                    </div>
                                  )}
                              </Card>
                            ))}
                          </div>
                        </Card>
                      )}
                    <section className="space-y-2">
                      <h2 className="text-lg font-bold">Attached Files</h2>
                      {detail.attachments.length > 0 ? (
                        <AttachmentDisplay
                          attachments={detail.attachments}
                          type="classwork"
                          downloadUrl={(id) =>
                            `${API_URL}/api/v1/classwork-assignments/classwork/${detail.classwork_id}/attachments/${id}/download`
                          }
                        />
                      ) : (
                        <Card className="block w-full py-4 text-center shadow-none">
                          <p className="text-sm text-muted-foreground">
                            No files attached.
                          </p>
                        </Card>
                      )}
                    </section>
                    <div className="text-sm text-muted-foreground">
                      <p>
                        {dueDate
                          ? `Due on ${dueDate.toLocaleString()}`
                          : "No due date"}
                      </p>
                      {detail.lock_date && (
                        <p>Locks {new Date(detail.lock_date).toLocaleString()}</p>
                      )}
                    </div>
                    {detail.rubric_levels &&
                      detail.rubric_levels.length > 0 && (
                        <RubricsScoreBoard
                          totalPoints={detail.total_points}
                          rubricLevels={detail.rubric_levels}
                        />
                      )}
                  </div>
                </Card>

                <Card className="block w-full">
                  <h2 className="mb-3 flex items-center gap-2 font-bold">
                    <FileText size={18} />
                    {isQuiz
                      ? "Quiz"
                      : isReading
                        ? "Reading Material"
                        : submission
                          ? "Your Submission"
                          : "Submit Your Work"}
                  </h2>
                  {isReading ? (
                    submission ||
                    status === "completed" ||
                    status === "submitted" ||
                    status === "graded" ? (
                      <p className="text-sm font-semibold text-success">
                        You have completed this reading material.
                      </p>
                    ) : closed ? (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <LockKeyhole size={16} />
                        This reading is unavailable.
                      </p>
                    ) : (
                      <>
                        <p className="mb-3 text-sm text-muted-foreground">
                          Review the content and files, then mark this reading
                          as completed.
                        </p>
                        <Button
                          size="sm"
                          className="w-full gap-2"
                          disabled={actionLoading}
                          onClick={() => void completeReading()}
                        >
                          {actionLoading ? "Updating..." : "Mark as Completed"}
                        </Button>
                      </>
                    )
                  ) : isQuiz ? (
                    quizError ? (
                      <p role="alert" className="text-sm text-destructive">
                        {quizError}
                      </p>
                    ) : quiz ? (
                      <div className="space-y-3 text-sm">
                        <p className="capitalize">
                          Status: {statusLabel(quiz.status)}
                        </p>
                        <p>
                          Attempts: {quiz.attempt_count}/{quiz.max_attempts}
                        </p>
                        <p>
                          {quiz.questions.length} questions ·{" "}
                          {quiz.total_points ?? detail.total_points ?? 0} points
                        </p>
                        {quiz.duration_minutes && (
                          <p>{quiz.duration_minutes} minutes</p>
                        )}
                        {quiz.grade != null && (
                          <p className="font-bold">
                            {detail.show_scores
                              ? `Score: ${quiz.grade}/${quiz.total_points ?? detail.total_points ?? 0}`
                              : "Score hidden"}
                          </p>
                        )}
                        {quiz.summary_message && (
                          <p className="text-muted-foreground">
                            {quiz.summary_message}
                          </p>
                        )}
                        {quiz.status !== "pending" &&
                          quiz.status !== "not_started" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full gap-2 bg-primary"
                              disabled={!quiz.summary_available}
                              onClick={() => {
                                setQuizCurrentIndex(0);
                                setShowQuizSummary(true);
                              }}
                            >
                              {quiz.summary_available
                                ? "View Summary"
                                : quiz.summary_release_mode === "NEVER"
                                  ? "Summary Not Available"
                                  : "Summary Scheduled"}
                            </Button>
                          )}
                        {quiz.can_submit && (
                          <Button
                            size="sm"
                            className="w-full gap-2"
                            onClick={() => navigate(quizLink)}
                          >
                            {quiz.status === "pending"
                              ? "Continue Quiz"
                              : quiz.status === "not_started"
                                ? "Start Quiz"
                                : "Retake Quiz"}
                          </Button>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Quiz details unavailable.
                      </p>
                    )
                  ) : submission ? (
                    <SubmissionViewer
                      submission={submission}
                      dueDate={detail.due_date ?? undefined}
                      isLocked={detail.is_locked}
                      allowLateSubmissions={detail.allow_late_submissions}
                      maxAttempts={detail.max_attempts}
                      showScores={detail.show_scores}
                      isDeleting={actionLoading}
                      onDeleteSubmission={deleteSubmission}
                      onResubmit={async () => {
                        const response = await apiFetch(
                          "/api/v1/submissions/my-submissions",
                        );
                        if (response.ok) {
                          const items = (await response.json()) as Submission[];
                          setSubmission(
                            items.find(
                              (item) =>
                                item.classwork_assignment_id === assignmentId,
                            ) ?? null,
                          );
                        }
                      }}
                    />
                  ) : closed ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <LockKeyhole size={16} />
                      Submissions are closed for this classwork.
                    </p>
                  ) : (
                    <SubmissionForm
                      assignmentId={assignmentId}
                      maxAttempts={detail.max_attempts}
                      currentAttempt={0}
                      isLoading={actionLoading}
                      onSubmit={submitFiles}
                    />
                  )}
                </Card>
              </div>
            )}
          </main>
        </div>
      </AppLayout>
      {showQuizSummary && quiz && detail && (
        <StudentQuizFullscreen
          selectedQuizAttempt={quiz}
          selectedClasswork={detail}
          quizAnswers={quizAnswers}
          setQuizAnswers={setQuizAnswers}
          quizCurrentIndex={quizCurrentIndex}
          setQuizCurrentIndex={setQuizCurrentIndex}
          quizReviewMode={quizReviewMode}
          setQuizReviewMode={setQuizReviewMode}
          quizRemainingSeconds={null}
          flaggedQuizQuestionIds={new Set()}
          toggleQuizFlag={() => {}}
          quizError=""
          isQuizSubmitting={false}
          onExit={() => setShowQuizSummary(false)}
          onSubmit={() => {}}
        />
      )}
    </>
  );
}
