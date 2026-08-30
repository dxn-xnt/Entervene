import { Eye } from "lucide-react";
import AttachmentDisplay from "@/components/attachment-display";
import { API_URL } from "@/lib/api";
import { Button } from "@/components/retroui/Button";
import {
  isQuizType,
  scoreBand,
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
  return (
    <>
      <div className="overflow-hidden rounded-lg border border-black bg-white shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
        <div className="flex items-center justify-between gap-3 border-b border-black bg-[#F6E9B2] px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold">
              {selectedStudent.student_name} Submission
            </h2>
            <span className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium">
              {submissionStatusLabel(selectedStudent.status)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-black px-2 py-1 text-xs font-bold"
          >
            Back
          </button>
        </div>
        <div className="min-h-48 p-5">
          {isSubmissionLoading ? (
            <p className="text-center text-sm font-semibold text-gray-500">
              Loading submission...
            </p>
          ) : submissionDetailError ? (
            <p className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {submissionDetailError}
            </p>
          ) : selectedSubmissionDetail ? (
            isQuizType(selected.classwork_type) ? (
              <div className="flex flex-col items-start gap-3 rounded-lg border border-black bg-[#F6E9B2]/60 p-4">
                <div>
                  <p className="text-sm font-bold text-black">
                    Quiz Attempt Responses
                  </p>
                  <p className="text-xs font-medium text-gray-700">
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
            ) : selectedSubmissionDetail.attachments.length > 0 ? (
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
              <p className="text-sm font-medium text-gray-500">
                No submitted files attached.
              </p>
            )
          ) : (
            <p className="text-sm font-medium text-gray-500">
              This student has not submitted work yet.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-black bg-white p-4 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold">Score & Feedback</h2>
          <div className="flex items-center gap-1 rounded border border-black px-2 py-1">
            <input
              type="number"
              min="0"
              max={selected.total_points ?? undefined}
              value={gradeDraft}
              onChange={(event) => onGradeChange(event.target.value)}
              disabled={!selectedSubmissionDetail || isPostingGrade}
              className="w-12 bg-transparent text-right text-lg font-bold outline-none"
              placeholder="0"
            />
            <span className="text-sm">
              /{selected.total_points ?? 0}
            </span>
          </div>
        </div>
        <div className="mb-4 grid gap-3 md:grid-cols-5">
          {[
            [
              "Excellent",
              scoreBand(selected.total_points, 1),
              "Displays all required components clearly and accurately.",
            ],
            [
              "Good",
              scoreBand(selected.total_points, 0.8),
              "Most components are present with minor errors.",
            ],
            [
              "Fair",
              scoreBand(selected.total_points, 0.6),
              "Some required parts are missing or unclear.",
            ],
            [
              "Needs Improvement",
              scoreBand(selected.total_points, 0.4),
              "Many required elements are missing.",
            ],
            [
              "Poor",
              scoreBand(selected.total_points, 0.2),
              "Work is incomplete or not submitted.",
            ],
          ].map(([label, points, description]) => {
            const ptsNum = Number(points);
            const currentScore = gradeDraft !== "" ? Number(gradeDraft) : null;
            const isSelected = currentScore !== null && !isNaN(currentScore) && currentScore === ptsNum;
            return (
              <div
                key={label}
                onClick={() => {
                  if (selectedSubmissionDetail && !isPostingGrade) {
                    onGradeChange(String(ptsNum));
                  }
                }}
                className={`cursor-pointer rounded-lg border border-black p-3 transition-all hover:bg-gray-50 ${
                  isSelected ? "!bg-[#8BCB88] font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]" : "bg-white"
                }`}
                title={`Click to set score to ${points} pts`}
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="font-bold">{label}</p>
                  <p className="text-sm font-bold">{points} pts</p>
                </div>
                <p className="text-xs text-gray-700">{description}</p>
              </div>
            );
          })}
        </div>
        <label className="block text-sm font-bold">
          Comments
          <textarea
            value={feedbackDraft}
            onChange={(event) => onFeedbackChange(event.target.value)}
            disabled={!selectedSubmissionDetail || isPostingGrade}
            className="mt-2 min-h-20 w-full rounded-lg border border-black px-3 py-2 text-sm outline-none"
            placeholder="Write feedback for the student."
          />
        </label>
        {gradeSuccess && (
          <p className="mt-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm font-semibold text-green-700">
            {gradeSuccess}
          </p>
        )}
        {gradeError && (
          <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            {gradeError}
          </p>
        )}
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onPostGrade}
            disabled={!selectedSubmissionDetail || isPostingGrade}
            className="rounded-lg border border-black bg-white px-4 py-2 text-sm font-bold disabled:opacity-50"
          >
            {isPostingGrade
              ? "Saving..."
              : selectedSubmissionDetail?.status === "graded"
                ? "Update"
                : "Post"}
          </button>
        </div>
      </div>
    </>
  );
}
