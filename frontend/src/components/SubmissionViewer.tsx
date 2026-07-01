import { useState } from "react";
import { Trash2, AlertCircle } from "lucide-react";
import AttachmentDisplay from "./AttachmentDisplay";
import { API_URL } from "@/lib/api";

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
  onResubmit?: () => void;
  onDeleteSubmission?: (submissionId: number) => Promise<void>;
  isDeleting?: boolean;
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
}: SubmissionViewerProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const allowResubmit = canResubmit(dueDate, isLocked, allowLateSubmissions);
  const statusColor = getStatusColor(submission.status);
  const submittedDate = submission.submitted_at
    ? new Date(submission.submitted_at).toLocaleString()
    : "N/A";

  return (
    <div className="space-y-4">
      {/* Status Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">Submission Status</h3>
            <div className={`inline-flex items-center px-3 py-1 rounded-full border text-sm font-medium ${statusColor}`}>
              {submission.status.charAt(0).toUpperCase() +
                submission.status.slice(1)}
            </div>
          </div>
          {submission.grade !== undefined && submission.grade !== null && (
            <div className="text-right">
              <p className="text-sm text-gray-600 mb-1">Grade</p>
              <p className="text-2xl font-bold text-green-600">
                {submission.grade}
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
        <div className="bg-white border border-gray-200 rounded-lg p-4">
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
        <div className="bg-white border border-blue-200 rounded-lg p-4">
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
            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-2 px-3 py-2 text-red-600 border border-red-300 rounded hover:bg-red-50 transition-colors text-sm font-medium"
                disabled={isDeleting}
              >
                <Trash2 size={16} />
                Delete & Resubmit
              </button>
            ) : (
              <div className="space-y-2 min-w-[200px]">
                <p className="text-sm font-medium text-gray-900">
                  Delete submission?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (onDeleteSubmission) {
                        await onDeleteSubmission(submission.submission_id);
                        setShowDeleteConfirm(false);
                        onResubmit?.();
                      }
                    }}
                    disabled={isDeleting}
                    className="flex-1 px-3 py-1 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {isDeleting ? "Deleting..." : "Delete"}
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isDeleting}
                    className="flex-1 px-3 py-1 bg-gray-200 text-gray-900 rounded text-sm font-medium hover:bg-gray-300 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
