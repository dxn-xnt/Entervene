import { useState } from "react";
import { AlertCircle, ExternalLink } from "lucide-react";
import AttachmentDisplay from "./attachment-display";
import ConfirmDialog from "./confirm-dialog";
import SubmissionForm, { type SubmissionLinkDraft } from "./submission-form";
import { API_URL } from "@/lib/api";
import { formatDateTime } from "@/lib/formatters";
import {
  STUDY_SUPPORT_NEEDS_TEACHER_REVIEW_MESSAGE,
  STUDY_SUPPORT_QUIZ_PASSED_MESSAGE,
} from "@/lib/quiz-api";
import { Alert } from "@/components/retroui/Alert";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "./retroui/Card";

export type SavedSubmissionLink = {
  submission_link_id: number;
  url: string;
  title?: string | null;
  position: number;
};

function safeHref(value: string): string | null {
  try {
    const url = new URL(value);
    if ((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password) return value;
  } catch {
    // An invalid legacy value must never become a clickable link.
  }
  return null;
}

export function SubmissionLinkList({
  links,
  action,
}: {
  links: SavedSubmissionLink[];
  action?: React.ReactNode;
}) {
  if (links.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-row justify-between items-center">
        <h3 className="font-semibold text-gray-900">Submitted Links</h3>
        {action}
      </div>

      <ul className="space-y-2">
        {[...links].sort((a, b) => a.position - b.position).map((link) => {
          const href = safeHref(link.url);
          return (
            <li key={link.submission_link_id} className="min-w-0 rounded border border-gray-300 bg-white p-2">
              <p className="break-words text-sm font-medium">{link.title || link.url}</p>
              {href ? (
                <Button asChild variant="outline" size="sm" className="mt-2 inline-flex gap-2">
                  <a href={href} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />Open link</a>
                </Button>
              ) : <p className="text-sm text-red-700">This link cannot be opened.</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface SubmissionAttachment {
  submission_attachment_id: number;
  file_name: string;
  file_type?: string;
  file_size: number;
  uploaded_at?: string;
}

interface SubmissionAttemptHistoryItem {
  submission_id: number;
  attempt_count: number;
  status: string;
  submitted_at?: string | null;
  graded_at?: string | null;
  grade?: number | null;
  feedback?: string | null;
}

interface SubmissionViewerProps {
  assignmentId?: number;
  submission: {
    submission_id: number;
    status: string;
    submitted_at?: string;
    grade?: number;
    feedback?: string;
    attempt_count: number;
    attachments: SubmissionAttachment[];
    links?: SavedSubmissionLink[];
    is_intervention_assessment?: boolean;
    max_attempts?: number | null;
    attempts_used?: number | null;
    attempts_remaining?: number | null;
    is_passed?: boolean;
    passing_threshold?: number | null;
    needs_teacher_review?: boolean;
    can_retry?: boolean;
    attempt_history?: SubmissionAttemptHistoryItem[];
  };
  maxAttempts?: number;
  dueDate?: string;
  isLocked?: boolean;
  allowLateSubmissions?: boolean;
  onResubmit?: () => void | Promise<void>;
  onDeleteSubmission?: (submissionId: number) => Promise<void | boolean>;
  onSubmitRetry?: (
    files: File[],
    links: SubmissionLinkDraft[],
    onProgress?: (percent: number) => void,
    signal?: AbortSignal,
  ) => Promise<void>;
  onReconcileAfterCancel?: () => Promise<boolean>;
  isDeleting?: boolean;
  isRetrying?: boolean;
  showScores?: boolean;
  hideFeedbackWithScores?: boolean;
  hideGrade?: boolean;
}

function canResubmit(dueDate?: string, isLocked?: boolean, allowLateSubmissions?: boolean): boolean {
  if (isLocked) return false;
  if (!dueDate) return true;
  return allowLateSubmissions || new Date() < new Date(dueDate);
}

export default function SubmissionViewer({
  assignmentId,
  submission,
  maxAttempts,
  dueDate,
  isLocked = false,
  allowLateSubmissions = false,
  onResubmit,
  onDeleteSubmission,
  onSubmitRetry,
  onReconcileAfterCancel,
  isDeleting = false,
  isRetrying = false,
  showScores = true,
  hideFeedbackWithScores = false,
}: SubmissionViewerProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isRemediation = Boolean(submission.is_intervention_assessment);
  const effectiveMaxAttempts = submission.max_attempts ?? maxAttempts ?? (isRemediation ? 3 : undefined);
  const isGraded = submission.status === "graded";
  const allowResubmit = canResubmit(dueDate, isLocked, allowLateSubmissions);
  const allowDeleteResubmit = allowResubmit && !(isRemediation && isGraded);
  const submittedDate = submission.submitted_at
    ? formatDateTime(submission.submitted_at)
    : "N/A";

  const resubmitButton = allowDeleteResubmit ? (
    <Button
      size="sm"
      variant="outline"
      autoIcon={false}
      onClick={() => setShowDeleteConfirm(true)}
      className="gap-1.5 h-fit shadow-none"
      disabled={isDeleting}
    >
      Resubmit
    </Button>
  ) : null;

  return (
    <div className="space-y-4">
      {/* Attachments & Submitted Links */}
      {((submission.attachments && submission.attachments.length > 0) || Boolean(submission.links?.length)) && (
        <div className="space-y-4">
          {submission.attachments && submission.attachments.length > 0 && (
            <div>
              <div className="flex items-end justify-between mb-3.5">
                <h3 className="font-semibold -mb-2">Submitted</h3>
              </div>

              <AttachmentDisplay
                attachments={submission.attachments}
                type="submission"
                action={resubmitButton}
                downloadUrl={(attachmentId) =>
                  `${API_URL}/api/v1/submissions/${submission.submission_id}/attachments/${attachmentId}/download`
                }
              />
            </div>
          )}

          {Boolean(submission.links?.length) && (
            <SubmissionLinkList
              links={submission.links ?? []}
              action={!submission.attachments?.length ? resubmitButton : undefined}
            />
          )}
          <div className="flex flex-row justify-between px-1 -mt-2">
            <p className="text-sm text-muted-foreground">Submitted on {submittedDate}</p>
            {effectiveMaxAttempts != null && (
              <p className="text-sm text-muted-foreground">
                Attempt {submission.attempt_count} of {effectiveMaxAttempts}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Remediation Attempt Status */}
      {isRemediation && isGraded && (
        <div className="space-y-3">
          {submission.is_passed ? (
            <Alert status="success">
              <Alert.Title>Passed</Alert.Title>
              <Alert.Description>
                {STUDY_SUPPORT_QUIZ_PASSED_MESSAGE}
              </Alert.Description>
            </Alert>
          ) : submission.needs_teacher_review ? (
            <Alert status="error">
              <Alert.Title>Needs Teacher Review</Alert.Title>
              <Alert.Description>
                {STUDY_SUPPORT_NEEDS_TEACHER_REVIEW_MESSAGE}
              </Alert.Description>
            </Alert>
          ) : submission.can_retry ? (
            <div className="space-y-3">
              <Alert status="warning">
                <Alert.Title>Passing score not reached yet</Alert.Title>
                <Alert.Description>
                  {showScores && submission.passing_threshold != null
                    ? `You need at least ${submission.passing_threshold}% to pass this Study Support assessment. `
                    : "You haven't reached the passing score for this Study Support assessment yet. "}
                  {`You have ${submission.attempts_remaining ?? 0} ${(submission.attempts_remaining ?? 0) === 1 ? "attempt" : "attempts"} remaining. Submit a new attempt below — your previous attempt history will be preserved.`}
                </Alert.Description>
              </Alert>
              {onSubmitRetry && allowResubmit && assignmentId != null && (
                <SubmissionForm
                  assignmentId={assignmentId}
                  maxAttempts={effectiveMaxAttempts ?? 3}
                  currentAttempt={submission.attempt_count}
                  isLoading={isRetrying}
                  onSubmit={onSubmitRetry}
                  onReconcileAfterCancel={onReconcileAfterCancel}
                />
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Feedback */}
      {submission.feedback && (showScores || !hideFeedbackWithScores) && (
        <div className="">
          <p className="text-base font-medium mb-1 px-1">Feedback</p>
          <Card className="w-full shadow-none">
            <p className="text-sm">{submission.feedback}</p>
          </Card>
        </div>
      )}

      {/* Preserved Remediation Attempt History */}
      {isRemediation && submission.attempt_history && submission.attempt_history.length > 1 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold px-1">Attempt History</p>
          <div className="space-y-1.5">
            {submission.attempt_history.map((item) => (
              <Card
                key={item.submission_id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs shadow-none"
              >
                <span className="font-semibold">Attempt {item.attempt_count}</span>
                <div className="flex items-center gap-2">
                  {showScores && item.grade != null && (
                    <span className="font-medium">Score: {item.grade}</span>
                  )}
                  <Badge variant="outline" size="sm" className="capitalize">
                    {item.status}
                  </Badge>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {!(isRemediation && isGraded) && (
        <div>
          {allowDeleteResubmit ? (
            <p className="text-sm text-muted-foreground px-1 -mt-2">
              {dueDate && new Date() > new Date(dueDate) && allowLateSubmissions
                ? "You can resubmit after the due date, but the new submission will be marked late."
                : "You can delete your current submission and resubmit before the due date."}
            </p>
          ) : (
            <div className="flex gap-2 text-sm text-red-700 -mt-2">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <span>
                {isLocked
                  ? "This assignment is locked and cannot be resubmitted"
                  : "The due date has passed. Resubmission is not allowed."}
              </span>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete submission?"
        description="This will remove your current submission, files, and links so you can submit again."
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
