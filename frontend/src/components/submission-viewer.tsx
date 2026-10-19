import { useState } from "react";
import { Trash2, AlertCircle } from "lucide-react";
import AttachmentDisplay from "./attachment-display";
import ConfirmDialog from "./confirm-dialog";
import { API_URL } from "@/lib/api";
import { formatDateTime } from "@/lib/formatters";

interface SubmissionAttachment {
  submission_attachment_id: number;
  file_name: string;
  file_type?: string;
  file_size: number;
  uploaded_at?: string;
}

interface SubmissionViewerProps {
  submission: {
    submission_id: number;
    status: string;
    submitted_at?: string;
    grade?: number;
    feedback?: string;
    attempt_count: number;
    attachments: SubmissionAttachment[];
  };
  maxAttempts?: number;
  dueDate?: string;
  isLocked?: boolean;
  allowLateSubmissions?: boolean;
  onResubmit?: () => void | Promise<void>;
  onDeleteSubmission?: (submissionId: number) => Promise<void | boolean>;
  isDeleting?: boolean;
  showScores?: boolean;
  hideGrade?: boolean;
}

function getStatusColor(status: string): string {
  switch (status) {
    case "submitted":
      return "bg-blue-100 text-blue-800 border-blue-300";
    case "late":
      return "bg-orange-100 text-orange-800 border-orange-300";
    case "graded":
      return "bg-green-100 text-green-800 border-green-300";
    case "pending":
      return "bg-gray-100 text-gray-800 border-gray-300";
    default:
      return "bg-gray-100 text-gray-800 border-gray-300";
  }
}

function canResubmit(dueDate?: string, isLocked?: boolean, allowLateSubmissions?: boolean): boolean {
  if (isLocked) return false;
  if (!dueDate) return true;
  return allowLateSubmissions || new Date() < new Date(dueDate);
}

export default function SubmissionViewer({
  submission,
  maxAttempts,
  dueDate,
  isLocked = false,
  allowLateSubmissions = false,
  onResubmit,
  onDeleteSubmission,
  isDeleting = false,
  showScores = true,
  hideGrade = false,
}: SubmissionViewerProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const allowResubmit = canResubmit(dueDate, isLocked, allowLateSubmissions);
  const statusColor = getStatusColor(submission.status);
  const submittedDate = submission.submitted_at
    ? formatDateTime(submission.submitted_at)
    : "N/A";

  return (
    <div className="space-y-4">
      {/* Status Section */}
      <div className="bg-white border border-gray-200 rounded p-4 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">Submission Status</h3>
            <div className={`inline-flex items-center px-3 py-1 rounded-full border text-sm font-medium ${statusColor}`}>
              {submission.status.charAt(0).toUpperCase() +
                submission.status.slice(1)}
            </div>
          </div>
          {!hideGrade && submission.grade !== undefined && submission.grade !== null && (
            <div className="text-right">
              <p className="text-sm text-gray-600 mb-1">Grade</p>
              <p className="text-2xl font-bold text-green-600">
                {showScores ? submission.grade : "Hidden"}
              </p>
            </div>
          )}
        </div>

        {/* Submission Details */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-600">Submitted</p>
            <p className="font-medium">{submittedDate}</p>
          </div>
          {maxAttempts && (
            <div>
              <p className="text-gray-600">Attempt</p>
              <p className="font-medium">
                {submission.attempt_count} of {maxAttempts}
              </p>
            </div>
          )}
        </div>

        {/* Feedback */}
        {submission.feedback && (
          <div className="bg-gray-50 border border-gray-200 rounded p-3">
            <p className="text-sm font-medium text-gray-700 mb-1">Feedback</p>
            <p className="text-sm text-gray-600">{submission.feedback}</p>
          </div>
        )}

        {/* Due Date Warning */}
        {dueDate && !allowResubmit && (
          <div className="flex gap-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <span>
              {isLocked
                ? "This assignment is locked and cannot be resubmitted"
                : "The due date has passed. Resubmission is not allowed."}
            </span>
          </div>
        )}
      </div>

      {/* Attachments */}
      {submission.attachments && submission.attachments.length > 0 && (
        <div className="bg-white border border-gray-200 rounded p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Submitted Files</h3>
          <AttachmentDisplay
            attachments={submission.attachments}
            type="submission"
            downloadUrl={(attachmentId) =>
              `${API_URL}/api/v1/submissions/${submission.submission_id}/attachments/${attachmentId}/download`
            }
          />
        </div>
      )}

      {/* Resubmission Actions */}
      {allowResubmit && (
        <div className="bg-white border border-blue-200 rounded p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">
                Resubmit Assignment
              </h3>
              <p className="text-sm text-gray-600">
                {dueDate && new Date() > new Date(dueDate) && allowLateSubmissions
                  ? "You can resubmit after the due date, but the new submission will be marked late."
                  : "You can delete your current submission and resubmit before the due date."}
              </p>
            </div>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-2 px-3 py-2 text-red-600 border border-red-300 rounded hover:bg-red-50 transition-colors text-sm font-medium"
              disabled={isDeleting}
            >
              <Trash2 size={16} />
              Delete & Resubmit
            </button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete submission?"
        description="This will remove your current submission and its attached files so you can submit again."
        confirmLabel={isDeleting ? "Deleting..." : "Delete & Resubmit"}
        confirmVariant="destructive"
        isLoading={isDeleting}
        onConfirm={async () => {
          if (!onDeleteSubmission) return;
          const deleted = await onDeleteSubmission(submission.submission_id);
          if (deleted === false) return;
          setShowDeleteConfirm(false);
          await onResubmit?.();
        }}
      />
    </div>
  );
}
