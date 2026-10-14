import { createPortal } from "react-dom";
import {
  BookOpen,
  CalendarDays,
  CheckCircle,
  ClipboardList,
  FileText,
  GraduationCap,
  Paperclip,
} from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Dialog } from "@/components/retroui/Dialog";
import AttachmentDisplay from "@/components/attachment-display";
import SubmissionForm from "@/components/submission-form";
import SubmissionViewer from "@/components/submission-viewer";
import { API_URL } from "@/lib/api";
import type {
  ClassworkDetail,
  QuizAttempt,
  Submission,
} from "../subjects-view/types";
import StudentQuizFullscreen from "./student-quiz-fullscreen";

interface StudentClassworkDetailModalProps {
  selectedClasswork: ClassworkDetail | null;
  detailLoadingId: number | null;
  detailError: string;
  selectedSubmission: Submission | null;
  selectedQuizAttempt: QuizAttempt | null;
  quizAnswers: Record<
    number,
    { selected_option_id?: number; answer_text?: string }
  >;
  setQuizAnswers: React.Dispatch<
    React.SetStateAction<
      Record<number, { selected_option_id?: number; answer_text?: string }>
    >
  >;
  isQuizLoading: boolean;
  isQuizSubmitting: boolean;
  quizError: string;
  isQuizFullscreen: boolean;
  setIsQuizFullscreen: (val: boolean) => void;
  quizCurrentIndex: number;
  setQuizCurrentIndex: React.Dispatch<React.SetStateAction<number>>;
  quizReviewMode: boolean;
  setQuizReviewMode: (val: boolean) => void;
  flaggedQuizQuestionIds: Set<number>;
  toggleQuizFlag: (questionId: number) => void;
  quizRemainingSeconds: number | null;
  submittingId: number | null;
  deletingId: number | null;
  isMarkingRead: boolean;
  onClose: () => void;
  onStartQuiz: () => Promise<void>;
  onSubmitQuiz: (autoSubmit?: boolean) => Promise<void>;
  onSubmitFiles: (assignmentId: number, files: File[]) => Promise<void>;
  onCompleteReading: (assignmentId: number) => Promise<void>;
  onDeleteSubmission: (assignmentId: number) => Promise<void>;
  onFetchSubmission: (assignmentId: number) => Promise<Submission | null>;
  setSelectedSubmission: (sub: Submission | null) => void;
}

function isReadingType(value?: string | null) {
  return value?.toUpperCase() === "READING";
}

function isQuizType(value?: string | null) {
  return value?.toUpperCase() === "QUIZ";
}

function statusLabel(s?: string | null) {
  if (!s) return "Not submitted";
  return s.replace(/_/g, " ");
}

function formatExamTimer(seconds: number | null) {
  if (seconds === null) return "No timer";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDateTime(dateStr?: string | null) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString();
}

export default function StudentClassworkDetailModal({
  selectedClasswork,
  detailLoadingId,
  detailError,
  selectedSubmission,
  selectedQuizAttempt,
  quizAnswers,
  setQuizAnswers,
  isQuizLoading,
  isQuizSubmitting,
  quizError,
  isQuizFullscreen,
  setIsQuizFullscreen,
  quizCurrentIndex,
  setQuizCurrentIndex,
  quizReviewMode,
  setQuizReviewMode,
  flaggedQuizQuestionIds,
  toggleQuizFlag,
  quizRemainingSeconds,
  submittingId,
  deletingId,
  isMarkingRead,
  onClose,
  onStartQuiz,
  onSubmitQuiz,
  onSubmitFiles,
  onCompleteReading,
  onDeleteSubmission,
  onFetchSubmission,
  setSelectedSubmission,
}: StudentClassworkDetailModalProps) {
  const isOpen =
    !isQuizFullscreen &&
    Boolean(selectedClasswork || detailLoadingId !== null || detailError);

  return (
    <>
      {isQuizFullscreen && selectedClasswork && selectedQuizAttempt
        ? createPortal(
            <StudentQuizFullscreen
              selectedQuizAttempt={selectedQuizAttempt}
              selectedClasswork={selectedClasswork}
              quizAnswers={quizAnswers}
              setQuizAnswers={setQuizAnswers}
              quizCurrentIndex={quizCurrentIndex}
              setQuizCurrentIndex={setQuizCurrentIndex}
              quizReviewMode={quizReviewMode}
              setQuizReviewMode={setQuizReviewMode}
              quizRemainingSeconds={quizRemainingSeconds}
              flaggedQuizQuestionIds={flaggedQuizQuestionIds}
              toggleQuizFlag={toggleQuizFlag}
              quizError={quizError}
              isQuizSubmitting={isQuizSubmitting}
              onExit={() => {
                setIsQuizFullscreen(false);
                setQuizReviewMode(false);
              }}
              onSubmit={onSubmitQuiz}
            />,
            document.body,
          )
        : null}

      {isOpen && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) onClose();
          }}
        >
          <Dialog.Content size="3xl" className="max-h-[90vh] p-0">
            {/* Modal header */}
            <Dialog.Header
              position="fixed"
              className="bg-primary text-primary-foreground"
            >
              <h2 className="text-xl font-bold">
                {selectedClasswork?.title || "Classwork"}
              </h2>
            </Dialog.Header>

            {/* Modal body */}
            {detailLoadingId !== null ? (
              <Card className="m-5 block p-6 text-center text-sm font-semibold text-gray-600 shadow-none">
                Loading classwork details...
              </Card>
            ) : detailError ? (
              <Card className="m-5 block border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-none">
                {detailError}
              </Card>
            ) : selectedClasswork ? (
              <div className="flex min-w-0 flex-col gap-5 overflow-x-hidden p-5">
                {/* Left: details */}
                <div className="min-w-0 space-y-4">
                  {/* Status + title card */}
                  <Card className="block w-full border-black bg-white shadow-none hover:shadow-none">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="surface"
                        size="sm"
                        className="border border-black bg-[#7ABA78] text-black"
                      >
                        {selectedClasswork.classwork_type || "Classwork"}
                      </Badge>
                      <Badge
                        variant="outline"
                        size="sm"
                        className="border border-gray-300 capitalize"
                      >
                        {statusLabel(
                          selectedQuizAttempt?.status ??
                            selectedSubmission?.status ??
                            selectedClasswork.submission_status,
                        )}
                      </Badge>
                    </div>
                    <h3 className="mt-4 break-words text-3xl font-bold">
                      {selectedClasswork.title}
                    </h3>
                    <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                      <Card className="block w-full border-black bg-gray-50 p-3 shadow-none hover:shadow-none">
                        <div className="mb-1 flex items-center gap-1 font-semibold text-gray-600">
                          <CalendarDays size={14} />
                          Due
                        </div>
                        <p className="font-bold">
                          {selectedClasswork.due_date
                            ? new Date(
                                selectedClasswork.due_date,
                              ).toLocaleString()
                            : "No due date"}
                        </p>
                      </Card>
                      <Card className="block w-full border-black bg-gray-50 p-3 shadow-none hover:shadow-none">
                        <p className="font-semibold text-gray-600">Points</p>
                        <p className="font-bold">
                          {selectedClasswork.total_points ?? "Not set"}
                        </p>
                      </Card>
                      <Card className="block w-full border-black bg-gray-50 p-3 shadow-none hover:shadow-none">
                        <p className="font-semibold text-gray-600">Teacher</p>
                        <p className="font-bold">
                          {selectedClasswork.teacher_name || "Teacher"}
                        </p>
                      </Card>
                    </div>
                  </Card>

                  {/* Description + instructions */}
                  {(selectedClasswork.description ||
                    selectedClasswork.instructions) && (
                    <Card className="block w-full border-black bg-white shadow-none hover:shadow-none">
                      {selectedClasswork.description && (
                        <div>
                          <h4 className="font-bold">Description</h4>
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-700">
                            {selectedClasswork.description}
                          </p>
                        </div>
                      )}
                      {selectedClasswork.instructions && (
                        <div className="mt-4">
                          <h4 className="font-bold">Instructions</h4>
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-700">
                            {selectedClasswork.instructions}
                          </p>
                        </div>
                      )}
                    </Card>
                  )}

                  {/* Coverage Section (Linked Lessons, Topics & Reading Classworks) - Exclusive to Quizzes */}
                  {isQuizType(selectedClasswork.classwork_type) &&
                    selectedClasswork.linked_lessons &&
                    selectedClasswork.linked_lessons.length > 0 && (
                      <Card className="block w-full border-black bg-primary shadow-none hover:shadow-none">
                        <div className="mb-2 flex items-center gap-2">
                          <GraduationCap size={18} className="text-black" />
                          <h4 className="font-bold text-black">Coverage</h4>
                        </div>
                        <div className="space-y-3">
                          {selectedClasswork.linked_lessons.map((lesson) => (
                            <Card
                              key={lesson.lesson_id}
                              className="block w-full border-black bg-white p-3.5 shadow-none hover:shadow-none"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold uppercase text-gray-500">
                                  Lesson:
                                </span>
                                <p className="text-sm font-extrabold text-black">
                                  {lesson.title}
                                </p>
                              </div>
                              {lesson.description && (
                                <div className="mt-1 flex items-start gap-2 text-xs">
                                  <span className="shrink-0 font-bold uppercase text-gray-500">
                                    Topic:
                                  </span>
                                  <p className="text-gray-700">
                                    {lesson.description}
                                  </p>
                                </div>
                              )}

                              {/* Specific Reading Classworks under this Lesson */}
                              {lesson.readings &&
                                lesson.readings.length > 0 && (
                                  <div className="mt-3 border-t border-black/10 pt-2.5">
                                    <div className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase text-gray-600">
                                      <BookOpen
                                        size={13}
                                        className="text-black"
                                      />
                                      <span>
                                        Reading Materials (
                                        {lesson.readings.length})
                                      </span>
                                    </div>
                                    <div className="space-y-1.5">
                                      {lesson.readings.map((reading) => (
                                        <div
                                          key={reading.classwork_id}
                                          className="flex items-center gap-2 border border-black/15 bg-[#F6E9B2]/40 px-2.5 py-1.5 text-xs"
                                        >
                                          <BookOpen
                                            size={13}
                                            className="text-black shrink-0"
                                          />
                                          <span className="font-bold text-black">
                                            {reading.title}
                                          </span>
                                          {reading.description && (
                                            <span className="text-gray-600 truncate text-[11px]">
                                              — {reading.description}
                                            </span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                              {/* Lesson Study File Attachments if any */}
                              {lesson.attachments &&
                                lesson.attachments.length > 0 && (
                                  <div className="mt-3 border-t border-black/10 pt-2.5">
                                    <div className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase text-gray-600">
                                      <Paperclip
                                        size={13}
                                        className="text-black"
                                      />
                                      <span>
                                        Lesson Files (
                                        {lesson.attachments.length})
                                      </span>
                                    </div>
                                    <AttachmentDisplay
                                      attachments={lesson.attachments}
                                      type="lesson"
                                      downloadUrl={(attachmentId) =>
                                        `${API_URL}/api/v1/lessons/${lesson.lesson_id}/attachments/${attachmentId}/download`
                                      }
                                    />
                                  </div>
                                )}
                            </Card>
                          ))}
                        </div>
                      </Card>
                    )}

                  {/* Classwork File Attachments (Only shown when files are directly attached) */}
                  {selectedClasswork.attachments &&
                    selectedClasswork.attachments.length > 0 && (
                      <Card className="block w-full border-black bg-white shadow-none hover:shadow-none">
                        <div className="mb-3 flex items-center gap-2">
                          <Paperclip size={18} />
                          <h4 className="font-bold">Attached Files</h4>
                        </div>
                        <AttachmentDisplay
                          attachments={selectedClasswork.attachments}
                          type="classwork"
                          downloadUrl={(attachmentId) =>
                            `${API_URL}/api/v1/classwork-assignments/classwork/${selectedClasswork.classwork_id}/attachments/${attachmentId}/download`
                          }
                        />
                      </Card>
                    )}
                </div>

                {/* Right: submission or quiz attempt */}
                <Card className="block w-full border-black bg-white shadow-none hover:shadow-none">
                  <div className="mb-3 flex items-center gap-2">
                    {isQuizType(selectedClasswork.classwork_type) ? (
                      <ClipboardList size={18} />
                    ) : selectedSubmission ? (
                      <FileText size={18} />
                    ) : (
                      <BookOpen size={18} />
                    )}
                    <h3 className="font-bold">
                      {isReadingType(selectedClasswork.classwork_type)
                        ? "Reading Material"
                        : isQuizType(selectedClasswork.classwork_type)
                          ? "Take Quiz"
                          : selectedSubmission
                            ? "Your Submission"
                            : "Submit Your Work"}
                    </h3>
                  </div>
                  {isReadingType(selectedClasswork.classwork_type) ? (
                    <div className="space-y-3">
                      {selectedSubmission?.status === "submitted" ||
                      selectedSubmission?.status === "graded" ||
                      selectedClasswork.submission_status === "submitted" ||
                      selectedClasswork.submission_status === "graded" ||
                      selectedClasswork.submission_status === "completed" ? (
                        <div className="rounded border border-green-300 bg-green-50 p-3 text-sm font-semibold text-green-800 flex items-center gap-2">
                          <CheckCircle className="size-5 text-green-600 shrink-0" />
                          <span>You have completed this reading material.</span>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-sm text-gray-600 font-medium">
                            Review the content and reference files above. When
                            finished, mark it as completed to update your
                            progress.
                          </p>
                          <Button
                            type="button"
                            onClick={() =>
                              onCompleteReading(
                                selectedClasswork.classwork_assignment_id,
                              )
                            }
                            disabled={isMarkingRead}
                            className="w-full disabled:opacity-50"
                          >
                            {isMarkingRead
                              ? "Marking as completed..."
                              : "Mark as Completed"}
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : isQuizType(selectedClasswork.classwork_type) ? (
                    <div className="space-y-3">
                      {isQuizLoading ? (
                        <p className="rounded border border-dashed border-black bg-white px-4 py-6 text-center text-sm font-semibold">
                          Loading quiz...
                        </p>
                      ) : quizError ? (
                        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                          {quizError}
                        </div>
                      ) : selectedQuizAttempt ? (
                        <>
                          <Card className="block w-full border-black bg-white p-3 text-sm shadow-none hover:shadow-none">
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-bold capitalize">
                                {statusLabel(selectedQuizAttempt.status)}
                              </span>
                              <span className="font-semibold">
                                Attempts {selectedQuizAttempt.attempt_count}/
                                {selectedQuizAttempt.max_attempts}
                              </span>
                            </div>
                            <Card className="mt-2 flex w-full flex-wrap gap-2 border-black bg-white p-2 text-xs font-semibold text-gray-600 shadow-none hover:shadow-none">
                              <span>
                                {selectedQuizAttempt.questions.length} questions
                              </span>
                              <span>
                                {selectedQuizAttempt.total_points ??
                                  selectedClasswork.total_points ??
                                  0}{" "}
                                pts
                              </span>
                              {selectedQuizAttempt.duration_minutes ? (
                                <span>
                                  {selectedQuizAttempt.duration_minutes} minutes
                                </span>
                              ) : null}
                            </Card>
                            {selectedQuizAttempt.grade !== null &&
                            selectedQuizAttempt.grade !== undefined ? (
                              <p className="mt-2 text-sm font-bold">
                                {selectedClasswork.show_scores ? (
                                  <>
                                    Score: {selectedQuizAttempt.grade}/
                                    {selectedQuizAttempt.total_points ??
                                      selectedClasswork.total_points ??
                                      0}
                                  </>
                                ) : (
                                  <span className="rounded-full bg-gray-200 px-2 py-1 text-xs text-gray-700">
                                    Score hidden
                                  </span>
                                )}
                              </p>
                            ) : null}
                          </Card>

                          {selectedQuizAttempt.status !== "pending" ? (
                            <div className="space-y-2">
                              {selectedQuizAttempt.summary_message ? (
                                <div className="rounded border border-black bg-white px-3 py-2 text-xs font-semibold text-gray-700">
                                  {selectedQuizAttempt.summary_release_at
                                    ? `Your quiz has been submitted successfully. Your quiz summary will be available on ${formatDateTime(selectedQuizAttempt.summary_release_at)}.`
                                    : selectedQuizAttempt.summary_message}
                                </div>
                              ) : null}
                              {selectedQuizAttempt.status !== "not_started" ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setQuizReviewMode(true);
                                    setQuizCurrentIndex(0);
                                    setIsQuizFullscreen(true);
                                  }}
                                  disabled={
                                    !selectedQuizAttempt.summary_available
                                  }
                                  className="w-full rounded border-black bg-white text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {selectedQuizAttempt.summary_available
                                    ? "View Summary"
                                    : selectedQuizAttempt.summary_release_mode ===
                                        "NEVER"
                                      ? "Summary Not Available"
                                      : "Summary Scheduled"}
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                onClick={onStartQuiz}
                                disabled={
                                  !selectedQuizAttempt.can_submit ||
                                  isQuizSubmitting
                                }
                                className="w-full rounded border-black bg-success text-sm font-bold text-black hover:bg-success/80 hover:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {selectedQuizAttempt.status === "not_started"
                                  ? "Start Quiz"
                                  : "Retake Quiz"}
                              </Button>
                            </div>
                          ) : (
                            <>
                              <Card className="block w-full border-black bg-white p-3 text-sm font-semibold shadow-none hover:shadow-none">
                                <p>Your quiz attempt is in progress.</p>
                                <p className="mt-1 text-gray-600">
                                  Time left:{" "}
                                  {formatExamTimer(quizRemainingSeconds)}
                                </p>
                              </Card>
                              <Button
                                type="button"
                                onClick={() => setIsQuizFullscreen(true)}
                                disabled={
                                  !selectedQuizAttempt.can_submit ||
                                  isQuizSubmitting
                                }
                                className="w-full rounded border-black bg-success text-sm font-bold text-black shadow-none hover:bg-success/80 hover:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Continue Exam
                              </Button>
                            </>
                          )}
                        </>
                      ) : (
                        <p className="rounded border border-dashed border-black bg-white px-4 py-6 text-center text-sm font-semibold">
                          Quiz details unavailable.
                        </p>
                      )}
                    </div>
                  ) : selectedSubmission ? (
                    <SubmissionViewer
                      submission={selectedSubmission}
                      dueDate={selectedClasswork.due_date ?? undefined}
                      isLocked={selectedClasswork.is_locked}
                      allowLateSubmissions={
                        selectedClasswork.allow_late_submissions
                      }
                      maxAttempts={selectedClasswork.max_attempts}
                      showScores={selectedClasswork.show_scores}
                      onDeleteSubmission={() =>
                        onDeleteSubmission(
                          selectedClasswork.classwork_assignment_id,
                        )
                      }
                      onResubmit={async () => {
                        const sub = await onFetchSubmission(
                          selectedClasswork.classwork_assignment_id,
                        );
                        setSelectedSubmission(sub);
                      }}
                      isDeleting={
                        deletingId === selectedClasswork.classwork_assignment_id
                      }
                    />
                  ) : (
                    <SubmissionForm
                      assignmentId={selectedClasswork.classwork_assignment_id}
                      maxAttempts={selectedClasswork.max_attempts}
                      currentAttempt={0}
                      isLoading={
                        submittingId ===
                        selectedClasswork.classwork_assignment_id
                      }
                      onSubmit={(files) =>
                        onSubmitFiles(
                          selectedClasswork.classwork_assignment_id,
                          files,
                        )
                      }
                    />
                  )}
                </Card>
              </div>
            ) : null}
          </Dialog.Content>
        </Dialog>
      )}
    </>
  );
}
