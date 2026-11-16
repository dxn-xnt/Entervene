import { useState } from "react";
import { Eye, FileText, Sparkles } from "lucide-react";
import AttachmentDisplay from "@/components/attachment-display";
import SubmissionLinkList from "@/components/submission-link-list";
import { API_URL } from "@/lib/api";
import { Button } from "@/components/teacher/button";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { PageBreadcrumb as Breadcrumb } from "@/components/page-breadcrumb";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Avatar } from "@/components/retroui/Avatar";
import { Alert } from "@/components/retroui/Alert";
import { useNavigate } from "react-router-dom";
import RubricsScoreBoard from "@/components/rubrics-score-board";
import FeedbackFocusSelector from "@/components/feedback-focus-selector";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import QuizFeedbackAssistant from "@/components/quiz-feedback-assistant";
import {
  formatDate,
  isQuizType,
  submissionStatusLabel,
} from "@/lib/classwork-utils";
import type {
  TeacherClasswork,
  TeacherSubmissionDetail,
  TrackingStudent,
} from "@/types/classwork";

export type StudentSubmissionViewProps = {
  selectedStudent: TrackingStudent;
  selected: TeacherClasswork;
  selectedSubmissionDetail: TeacherSubmissionDetail | null;
  isSubmissionLoading: boolean;
  submissionDetailError: string;
  gradeDraft: string;
  feedbackDraft: string;
  gradeError: string;
  isPostingGrade: boolean;
  onClose: () => void;
  onGradeChange: (value: string) => void;
  onFeedbackChange: (value: string) => void;
  onPostGrade: () => void;
  onOpenQuizGrading: (submissionId: number) => void;
  onAiFeedbackPublished: (feedback: string, fingerprint: string) => void;
  onAiPublishingChange: (publishing: boolean) => void;
  onAiConflictReload: (submissionId: number) => Promise<void>;
  isReadOnly?: boolean;
  focusPointsDraft?: string[];
  onFocusPointsChange?: (codes: string[]) => void;
};

export default function StudentSubmissionView({
  selectedStudent,
  selected,
  selectedSubmissionDetail,
  isSubmissionLoading,
  submissionDetailError,
  gradeDraft,
  feedbackDraft,
  gradeError,
  isPostingGrade,
  onClose,
  onGradeChange,
  onFeedbackChange,
  onPostGrade,
  onOpenQuizGrading,
  onAiFeedbackPublished,
  onAiPublishingChange,
  onAiConflictReload,
  isReadOnly = false,
  focusPointsDraft = [],
  onFocusPointsChange,
}: StudentSubmissionViewProps) {
  const navigate = useNavigate();
  const classworkKind = selected.classwork_type?.toUpperCase();
  const supportsAiFeedback =
    classworkKind === "ASSIGNMENT"
      ? selected.activity_mode?.toUpperCase() !== "MANUAL"
      : classworkKind === "ACTIVITY" && selected.activity_mode?.toUpperCase() === "ONLINE";
  const savedFocusPoints = selectedSubmissionDetail?.feedback_focus_points ?? [];
  const focusPointsChanged =
    focusPointsDraft.length !== savedFocusPoints.length ||
    focusPointsDraft.some((code) => !savedFocusPoints.includes(code));
  const hasUnsavedGradeChanges =
    selectedSubmissionDetail != null &&
    (gradeDraft !== (selectedSubmissionDetail.grade != null ? String(selectedSubmissionDetail.grade) : "") ||
      focusPointsChanged);
  const [isAiReviewing, setIsAiReviewing] = useState(false);
  const [isReviewTemplate, setIsReviewTemplate] = useState(false);
  const [isReviewPolicyFallback, setIsReviewPolicyFallback] = useState(false);
  const [isAiPublishing, setIsAiPublishing] = useState(false);

  return (
    <main className="flex flex-1 flex-col overflow-x-hidden">
      <div className="@container/main flex flex-1 flex-col">
        <div className="flex flex-1 flex-col">
          {/* Top Bar with Breadcrumbs and Back Button */}
          <header className="flex flex-row gap-3 justify-between items-center bg-background py-4 px-4 md:px-6">
            <div className="flex items-center gap-3 min-w-0">
              <SidebarTrigger className="md:hidden" />
              <Breadcrumb>
                <Breadcrumb.List className="flex-nowrap">
                  <Breadcrumb.Item className="shrink-0">
                    <Breadcrumb.Link
                      onClick={() => navigate("/teacher/classworks")}
                      className="cursor-pointer"
                    >
                      Classworks
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator className="shrink-0" />
                  <Breadcrumb.Item className="shrink-0">
                    <Tooltip>
                      <TooltipTrigger render={<Breadcrumb.Link
                        onClick={onClose}
                        className="cursor-pointer max-w-[200px] truncate sm:max-w-[250px]"
                      >
                        {selected?.title ?? "Classwork"}
                      </Breadcrumb.Link>} />
                      <TooltipContent>{selected?.title ?? "Classwork"}</TooltipContent>
                    </Tooltip>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator className="shrink-0" />
                  <Breadcrumb.Item className="min-w-0">
                    <Tooltip>
                      <TooltipTrigger render={<Breadcrumb.Page
                        className="block max-w-[150px] truncate sm:max-w-[250px] lg:max-w-[350px]"
                        tabIndex={0}
                      >
                        {selectedStudent.student_name}
                      </Breadcrumb.Page>} />
                      <TooltipContent>{selectedStudent.student_name} submission</TooltipContent>
                    </Tooltip>
                  </Breadcrumb.Item>
                </Breadcrumb.List>
              </Breadcrumb>
            </div>
            <div className="flex ">
              <Tooltip>
                <TooltipTrigger render={
                  <span className="inline-flex">
                    <Button
                      type="button"
                      onClick={onPostGrade}
                      disabled={!selectedSubmissionDetail || isPostingGrade || isReadOnly || isAiPublishing}
                      className="whitespace-nowrap"
                    >
                      {selectedSubmissionDetail?.status === "graded"
                        ? "Update Grade"
                        : "Post Grade"}
                    </Button>
                  </span>
                } />
                {isReadOnly ? (
                  <TooltipContent>Historical records are read-only</TooltipContent>
                ) : null}
              </Tooltip>
            </div>
          </header>

          <div className="border-t-2 border-border -mt-[1px] px-3 py-3 sm:px-4 sm:py-4 md:px-6">
            {/* Main Content Area */}
            <Card className="mx-auto w-full space-y-4">
              {/* Student Submission Banner Card */}
              <Card className="block w-full bg-primary shadow-none">
                <Card.Content>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar variant="student" className="size-10 shrink-0">
                        <Avatar.Image
                          src={selectedStudent.avatar || "/avatars/student-avatars/1.svg"}
                          alt={selectedStudent.student_name}
                        />
                        <Avatar.Fallback>
                          {selectedStudent.student_name.slice(0, 1).toUpperCase()}
                        </Avatar.Fallback>
                      </Avatar>
                      <div className="min-w-0">
                        <Card.Title className="text-xl sm:text-2xl font-extrabold truncate mb-0">
                          {selectedStudent.student_name}
                        </Card.Title>
                        {selectedSubmissionDetail?.submitted_at && (
                          <p className="text-xs font-semibold text-gray-800 mt-0.5">
                            Submitted on {formatDate(selectedSubmissionDetail.submitted_at)}
                          </p>
                        )}
                      </div>
                    </div>

                    <Badge
                      variant="outline"
                      size="sm"
                      className="w-fit font-bold rounded bg-white border-black"
                    >
                      {submissionStatusLabel(selectedStudent.status)}
                    </Badge>
                  </div>
                </Card.Content>
              </Card>

              {/* Submission Attachments / Content Card */}
              <Card className="block shadow-none">
                <Card.Content className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Card.Title className="mb-0 text-xl">
                      Submitted Work
                    </Card.Title>
                    {selectedSubmissionDetail && !isQuizType(selected.classwork_type) && (
                      <Badge variant="secondary" size="sm">
                        {selectedSubmissionDetail.attachments?.length ?? 0} Files · {selectedSubmissionDetail.links?.length ?? 0} Links
                      </Badge>
                    )}
                  </div>

                  {isSubmissionLoading ? (
                    <div className="py-10 text-center text-sm font-semibold text-muted-foreground animate-pulse">
                      Loading submission details...
                    </div>
                  ) : submissionDetailError ? (
                    <Alert status="error">
                      <Alert.Description>{submissionDetailError}</Alert.Description>
                    </Alert>
                  ) : selectedSubmissionDetail ? (
                    isQuizType(selected.classwork_type) ? (
                      <div className="flex flex-col items-start gap-3 rounded border-2 border-black bg-[#F6E9B2]/50 p-4">
                        <div>
                          <p className="text-sm font-bold text-black">
                            Quiz Attempt Responses
                          </p>
                          <p className="text-xs font-medium text-gray-700 mt-1">
                            This student submitted answers to the quiz questions. You can review individual question answers, view auto-graded results, and manually assign scores for subjective questions.
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          onClick={() => onOpenQuizGrading(selectedSubmissionDetail.submission_id)}
                          className="gap-2 border-black bg-[#7ABA78] font-bold text-black hover:bg-[#68a966]"
                        >
                          <Eye size={15} />
                          Review &amp; Grade Quiz Questions
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {selectedSubmissionDetail.attachments?.length ? (
                          <AttachmentDisplay
                            attachments={selectedSubmissionDetail.attachments.map((attachment) => ({
                              ...attachment,
                              file_type: attachment.file_type ?? undefined,
                            }))}
                            type="submission"
                            downloadUrl={(attachmentId) =>
                              `${API_URL}/api/v1/submissions/${selectedSubmissionDetail.submission_id}/attachments/${attachmentId}/download`
                            }
                          />
                        ) : null}
                        <SubmissionLinkList links={selectedSubmissionDetail.links ?? []} />
                        {!selectedSubmissionDetail.attachments?.length && !selectedSubmissionDetail.links?.length ? (
                          <div className="py-8 text-center text-sm font-semibold text-muted-foreground">
                            No submitted files or links.
                          </div>
                        ) : null}
                      </div>
                    )
                  ) : (
                    <TeacherEmptyState
                      icon={<FileText />}
                      title="No Work Submitted"
                      description="This student has not submitted work yet."
                      compact
                      className="shadow-none"
                    />
                  )}
                </Card.Content>
              </Card>

              {/* Score & Feedback Rubrics */}
              <RubricsScoreBoard
                title="Scoring Rubric"
                totalPoints={selected.total_points}
                rubricLevels={
                  selected.classwork_type === "ACTIVITY" || selected.classwork_type === "ASSIGNMENT"
                    ? selected.rubric_levels
                    : undefined
                }
                selectedScore={gradeDraft !== "" ? Number(gradeDraft) : null}
                onSelectScore={(points) => {
                  if (selectedSubmissionDetail && !isPostingGrade && !isReadOnly && !isAiPublishing) {
                    onGradeChange(String(points));
                  }
                }}
                rightSlot={
                  <div className="flex items-center rounded border-2 border-black bg-white px-3 font-bold">
                    <input
                      type="number"
                      min="0"
                      max={selected.total_points ?? undefined}
                      value={gradeDraft}
                      onChange={(event) => onGradeChange(event.target.value)}
                      disabled={!selectedSubmissionDetail || isPostingGrade || isReadOnly || isAiPublishing}
                      className="w-12 bg-transparent text-right text-lg font-extrabold outline-none"
                      placeholder="0"
                    />
                    <span className="text-xs font-semibold">
                      / {selected.total_points ?? 0} pts
                    </span>
                  </div>
                }
              />

              {/* Optional Focus Points for Assignments & Online Activities */}
              {!isReadOnly && supportsAiFeedback && selectedSubmissionDetail && onFocusPointsChange && (
                <FeedbackFocusSelector
                  selectedCodes={focusPointsDraft}
                  onChange={onFocusPointsChange}
                  disabled={isPostingGrade || isAiPublishing}
                />
              )}

              {/* Feedback Comment Box & Actions */}
              <div className="block shadow-none">
                {/* Feedback Comment Box — single Teacher Feedback editor with inline AI controls */}
                <div className="space-y-1.5 pt-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="teacher-submission-feedback" className="block text-xl font-bold">
                      Feedback &amp; Comments
                    </label>
                    {isAiReviewing && (
                      <div className="flex items-center gap-1.5">
                        <Badge
                          size="sm"
                          variant="outline"
                          className="gap-1 bg-white font-bold"
                          data-testid="feedback-provenance-badge"
                        >
                          {!isReviewTemplate && <Sparkles aria-hidden="true" className="size-3" />}
                          {isReviewTemplate ? "Score-based template" : "AI-generated draft"}
                        </Badge>
                        {isReviewPolicyFallback && (
                          <span className="text-[11px] text-muted-foreground italic" data-testid="policy-fallback-note">
                            (Contextual AI disabled by policy)
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <textarea
                    id="teacher-submission-feedback"
                    value={feedbackDraft}
                    onChange={(event) => onFeedbackChange(event.target.value)}
                    disabled={!selectedSubmissionDetail || isPostingGrade || isReadOnly || isAiPublishing}
                    className={`min-h-24 w-full border-2 border-black p-3 text-sm outline-none rounded! placeholder:text-muted-foreground disabled:opacity-50 ${isAiReviewing && !isReviewTemplate ? "italic text-black font-sans" : ""}`}
                    placeholder="Write constructive feedback for the student..."
                  />
                  {!isReadOnly && supportsAiFeedback && selectedSubmissionDetail ? (
                    <QuizFeedbackAssistant
                      key={selectedSubmissionDetail.submission_id}
                      classworkKind={classworkKind as "ASSIGNMENT" | "ACTIVITY"}
                      submissionId={selectedSubmissionDetail.submission_id}
                      eligibilityRevision={`${selected.is_published}:${selected.show_scores}:${selected.auto_ai_feedback_enabled}:${selectedSubmissionDetail.grade}:${(selectedSubmissionDetail.feedback_focus_points ?? []).join(",")}`}
                      fullyGraded={selectedSubmissionDetail.status === "graded" && selectedSubmissionDetail.grade != null && !hasUnsavedGradeChanges}
                      existingFeedback={selectedSubmissionDetail.feedback ?? ""}
                      feedbackDraft={feedbackDraft}
                      onFeedbackDraftChange={onFeedbackChange}
                      disabled={isPostingGrade}
                      onReviewChange={(reviewing, isTemplate = false, isPolicyFallback = false) => {
                        setIsAiReviewing(reviewing);
                        setIsReviewTemplate(isTemplate);
                        setIsReviewPolicyFallback(isPolicyFallback);
                      }}
                      onPublished={onAiFeedbackPublished}
                      onPublishingChange={(publishing) => {
                        setIsAiPublishing(publishing);
                        onAiPublishingChange(publishing);
                      }}
                      onConflictReload={onAiConflictReload}
                      showScores={selected.show_scores}
                      autoAiFeedbackEnabled={selected.auto_ai_feedback_enabled}
                    />
                  ) : null}
                </div>

                {gradeError && (
                  <Alert status="error">
                    <Alert.Description>{gradeError}</Alert.Description>
                  </Alert>
                )}

              </div>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
