import { ArrowLeft, Eye } from "lucide-react";
import AttachmentDisplay from "@/components/attachment-display";
import { API_URL } from "@/lib/api";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Avatar } from "@/components/retroui/Avatar";
import { Alert } from "@/components/retroui/Alert";
import { useNavigate } from "react-router-dom";
import RubricsScoreBoard from "@/components/rubrics-score-board";
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
  gradeSuccess: string;
  isPostingGrade: boolean;
  onClose: () => void;
  onGradeChange: (value: string) => void;
  onFeedbackChange: (value: string) => void;
  onPostGrade: () => void;
  onOpenQuizGrading: (submissionId: number) => void;
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
  gradeSuccess,
  isPostingGrade,
  onClose,
  onGradeChange,
  onFeedbackChange,
  onPostGrade,
  onOpenQuizGrading,
}: StudentSubmissionViewProps) {
  const navigate = useNavigate();

  return (
    <main className="flex flex-1 flex-col overflow-x-hidden">
      <div className="@container/main flex flex-1 flex-col">
        <div className="flex flex-1 flex-col gap-3 px-4 py-4 md:px-6 md:py-5">
          {/* Top Bar with Breadcrumbs and Back Button */}
          <div className="flex flex-row gap-3 justify-between items-center">
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
                    <Breadcrumb.Link
                      onClick={onClose}
                      className="cursor-pointer tracking-normal text-xl max-w-[200px] truncate sm:max-w-[250px]"
                      title={selected?.title}
                    >
                      {selected?.title ?? "Classwork"}
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator className="shrink-0" />
                  <Breadcrumb.Item className="min-w-0">
                    <Breadcrumb.Page
                      className="block max-w-[150px] truncate sm:max-w-[250px] lg:max-w-[350px]"
                      title={`${selectedStudent.student_name} Submission`}
                    >
                      {selectedStudent.student_name}
                    </Breadcrumb.Page>
                  </Breadcrumb.Item>
                </Breadcrumb.List>
              </Breadcrumb>
            </div>
            <div className="flex ">
              <Button
                type="button"
                onClick={onPostGrade}
                disabled={!selectedSubmissionDetail || isPostingGrade}
                className="whitespace-nowrap"
              >
                {selectedSubmissionDetail?.status === "graded"
                  ? "Update Grade"
                  : "Post Grade"}
              </Button>
            </div>

            {/* <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="whitespace-nowrap gap-2"
            >
              <ArrowLeft size={16} />
              Back
            </Button> */}
          </div>

          <div className="-mx-4 md:-mx-6 border-b-2 border-border" />

          {/* Main Content Area */}
          <Card className="mx-auto w-full space-y-4">
            {/* Student Submission Banner Card */}
            <Card className="block w-full bg-primary shadow-none">
              <Card.Content>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar variant="student" className="size-12 shrink-0">
                      <Avatar.Image
                        src="/avatars/student-avatars/1.svg"
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
                    className="w-fit font-bold rounded-none bg-white border-black"
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
                      {selectedSubmissionDetail.attachments?.length ?? 0} Attached
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
                    <div className="flex flex-col items-start gap-3 rounded-lg border-2 border-black bg-[#F6E9B2]/50 p-4">
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
                  ) : selectedSubmissionDetail.attachments && selectedSubmissionDetail.attachments.length > 0 ? (
                    <AttachmentDisplay
                      attachments={selectedSubmissionDetail.attachments.map(
                        (attachment) => ({
                          ...attachment,
                          file_type: attachment.file_type ?? undefined,
                        }),
                      )}
                      type="submission"
                      downloadUrl={(attachmentId) =>
                        `${API_URL}/api/v1/submissions/${selectedSubmissionDetail.submission_id}/attachments/${attachmentId}/download`
                      }
                    />
                  ) : (
                    <div className="py-8 text-center text-sm font-semibold text-muted-foreground">
                      No submitted files attached.
                    </div>
                  )
                ) : (
                  <div className="py-8 text-center text-sm font-semibold text-muted-foreground">
                    This student has not submitted work yet.
                  </div>
                )}
              </Card.Content>
            </Card>

            {/* Score & Feedback Rubrics */}
            <RubricsScoreBoard
              title="Score Rubrics"
              totalPoints={selected.total_points}
              selectedScore={gradeDraft !== "" ? Number(gradeDraft) : null}
              onSelectScore={(points) => {
                if (selectedSubmissionDetail && !isPostingGrade) {
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
                    disabled={!selectedSubmissionDetail || isPostingGrade}
                    className="w-12 bg-transparent text-right text-lg font-extrabold outline-none"
                    placeholder="0"
                  />
                  <span className="text-xs font-semibold">
                    / {selected.total_points ?? 0} pts
                  </span>
                </div>
              }
            />

            {/* Feedback Comment Box & Actions */}
            <div className="block shadow-none">
              {/* Feedback Comment Box */}
              <div className="space-y-1.5 pt-2">
                <label className="block text-xl font-bold">
                  Feedback &amp; Comments
                </label>
                <textarea
                  value={feedbackDraft}
                  onChange={(event) => onFeedbackChange(event.target.value)}
                  disabled={!selectedSubmissionDetail || isPostingGrade}
                  className="min-h-24 w-full border-2 border-black p-3 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
                  placeholder="Write constructive feedback for the student..."
                />
              </div>

              {gradeSuccess && (
                <Alert status="success">
                  <Alert.Description>{gradeSuccess}</Alert.Description>
                </Alert>
              )}

              {gradeError && (
                <Alert status="error">
                  <Alert.Description>{gradeError}</Alert.Description>
                </Alert>
              )}

            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
