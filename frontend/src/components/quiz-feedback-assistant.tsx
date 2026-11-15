import { useCallback, useEffect, useRef, useState } from "react";

import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/retroui/Button";
import { useToast } from "@/components/retroui/Toast";
import {
  discardSubmissionFeedbackDraft,
  getSubmissionFeedbackDraft,
  publishSubmissionFeedback,
  SubmissionFeedbackApiError,
  type FeedbackDraft,
} from "@/lib/submission-feedback-api";

export const AI_FEEDBACK_MAX_LENGTH = 1200;

type QuizFeedbackAssistantProps = {
  submissionId: number;
  fullyGraded: boolean;
  /** The currently saved teacher feedback. */
  existingFeedback: string;
  /** The value of the host Teacher Feedback editor. */
  feedbackDraft: string;
  onFeedbackDraftChange: (value: string) => void;
  onPublished: (feedback: string, feedbackFingerprint: string) => void;
  classworkKind?: "QUIZ" | "ASSIGNMENT" | "ACTIVITY";
  /** Increment or change when classwork/quiz settings are saved to refresh eligibility. */
  eligibilityRevision?: string | number;
  onPublishingChange?: (publishing: boolean) => void;
  /** Reports whether an AI-generated draft is under review in the host editor. */
  onReviewChange?: (reviewing: boolean) => void;
  onConflictReload?: (submissionId: number) => Promise<void>;
  disabled?: boolean;
};

function publicationConflictMessage(error: SubmissionFeedbackApiError, classworkKind: string): string {
  switch (error.code) {
    case "FEEDBACK_EVIDENCE_STALE":
    case "FEEDBACK_SUBMISSION_CHANGED":
      return classworkKind === "QUIZ"
        ? "Quiz scores or answers changed. Reloading submission for an updated draft."
        : "The saved score or classwork settings changed. Reloading submission for an updated draft.";
    case "FEEDBACK_COMMENT_STALE":
      return classworkKind === "QUIZ"
        ? "Saved teacher feedback changed elsewhere. Reload before posting so it is not overwritten."
        : "Saved teacher feedback changed elsewhere. The latest comment was reloaded.";
    case "FEEDBACK_ANSWER_RELEASE_PENDING":
    case "FEEDBACK_ANSWER_RELEASE_NEVER":
    case "FEEDBACK_ANSWER_RELEASE_INVALID":
    case "FEEDBACK_CORRECT_ANSWERS_DISABLED":
      return error.message;
    default:
      return error.message || "The approved feedback could not be posted.";
  }
}

export default function QuizFeedbackAssistant({
  submissionId,
  fullyGraded,
  existingFeedback,
  feedbackDraft,
  onFeedbackDraftChange,
  onPublished,
  classworkKind = "QUIZ",
  eligibilityRevision,
  onPublishingChange,
  onReviewChange,
  onConflictReload,
  disabled = false,
}: QuizFeedbackAssistantProps) {
  const toast = useToast();
  const [draft, setDraft] = useState<FeedbackDraft | null>(null);
  const [fetchingDraft, setFetchingDraft] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [previousDraft, setPreviousDraft] = useState<string>("");
  const [promptPending, setPromptPending] = useState<{ aiText: string; manualText: string } | null>(null);
  const [notice, setNotice] = useState<{ status: "error" | "warning"; message: string } | null>(null);

  const mountedRef = useRef(true);
  const activeContextRef = useRef({ submissionId, fullyGraded });
  activeContextRef.current = { submissionId, fullyGraded };
  const feedbackDraftRef = useRef(feedbackDraft);
  feedbackDraftRef.current = feedbackDraft;
  const onReviewChangeRef = useRef(onReviewChange);
  onReviewChangeRef.current = onReviewChange;
  const onFeedbackDraftChangeRef = useRef(onFeedbackDraftChange);
  onFeedbackDraftChangeRef.current = onFeedbackDraftChange;
  const existingFeedbackRef = useRef(existingFeedback);
  existingFeedbackRef.current = existingFeedback;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      onReviewChangeRef.current?.(false);
    };
  }, []);

  useEffect(() => {
    onReviewChangeRef.current?.(reviewing);
  }, [reviewing]);

  const isActiveContext = useCallback(
    (requestedSubmissionId: number) => {
      const current = activeContextRef.current;
      return mountedRef.current && current.submissionId === requestedSubmissionId && current.fullyGraded;
    },
    [],
  );

  const loadDraft = useCallback(async () => {
    if (!fullyGraded) {
      setDraft(null);
      setReviewing(false);
      return;
    }
    const requestedSubmissionId = submissionId;
    setFetchingDraft(true);
    setNotice(null);
    try {
      const result = await getSubmissionFeedbackDraft(requestedSubmissionId);
      if (!isActiveContext(requestedSubmissionId)) return;
      setDraft(result);

      if (result.status === "READY" && result.draft_feedback) {
        const currentDraft = feedbackDraftRef.current;
        const currentTrim = currentDraft.trim();
        const existingTrim = existingFeedbackRef.current.trim();
        const aiTrim = result.draft_feedback.trim();

        // If the teacher has typed manual text different from saved feedback and different from the AI text
        if (currentTrim !== "" && currentTrim !== existingTrim && currentTrim !== aiTrim) {
          setPromptPending({ aiText: result.draft_feedback, manualText: currentDraft });
        } else {
          setPreviousDraft(currentDraft || existingFeedbackRef.current);
          onFeedbackDraftChangeRef.current(result.draft_feedback);
          setReviewing(true);
        }
      } else {
        setReviewing(false);
      }
    } catch (error) {
      if (!isActiveContext(requestedSubmissionId)) return;
      const message = error instanceof Error ? error.message : "Unable to load feedback draft.";
      setNotice({ status: "error", message });
      setReviewing(false);
    } finally {
      if (isActiveContext(requestedSubmissionId)) setFetchingDraft(false);
    }
  }, [fullyGraded, isActiveContext, submissionId]);

  useEffect(() => {
    setDraft(null);
    setReviewing(false);
    setPromptPending(null);
    setNotice(null);
    if (fullyGraded) {
      void loadDraft();
    }
  }, [eligibilityRevision, fullyGraded, loadDraft, submissionId]);

  const handleDiscard = async () => {
    if (discarding || publishing) return;
    setDiscarding(true);
    setNotice(null);
    const requestedSubmissionId = submissionId;
    try {
      await discardSubmissionFeedbackDraft(requestedSubmissionId);
      if (!isActiveContext(requestedSubmissionId)) return;
      onFeedbackDraftChange(previousDraft || existingFeedback);
      setReviewing(false);
      setDraft(null);
      toast.success({ title: "AI feedback draft discarded" });
    } catch (error) {
      if (!isActiveContext(requestedSubmissionId)) return;
      const message = error instanceof Error ? error.message : "Unable to discard draft.";
      setNotice({ status: "error", message });
    } finally {
      if (isActiveContext(requestedSubmissionId)) setDiscarding(false);
    }
  };

  const finalText = feedbackDraft.trim();
  const overLimit = finalText.length > AI_FEEDBACK_MAX_LENGTH;

  const handlePublish = async () => {
    if (!draft || publishing || discarding) return;
    if (!finalText) {
      setNotice({ status: "error", message: "Enter teacher feedback before posting." });
      return;
    }
    if (overLimit) {
      setNotice({ status: "error", message: `Teacher feedback must be ${AI_FEEDBACK_MAX_LENGTH} characters or fewer.` });
      return;
    }
    setPublishing(true);
    onPublishingChange?.(true);
    setNotice(null);
    const requestedSubmissionId = submissionId;
    try {
      const saved = await publishSubmissionFeedback(requestedSubmissionId, {
        feedback: finalText,
        expected_evidence_fingerprint: draft.evidence_fingerprint || "",
        expected_feedback_fingerprint: draft.feedback_fingerprint || "",
      });
      if (!isActiveContext(requestedSubmissionId)) return;
      onPublished(saved.feedback, saved.feedback_fingerprint);
      setReviewing(false);
      setDraft(null);
      toast.success({ title: "Teacher feedback posted" });
    } catch (error) {
      if (!isActiveContext(requestedSubmissionId)) return;
      const message =
        error instanceof SubmissionFeedbackApiError
          ? publicationConflictMessage(error, classworkKind)
          : error instanceof Error
            ? error.message
            : "Unable to post the approved feedback.";
      if (error instanceof SubmissionFeedbackApiError && error.status === 409) {
        if (classworkKind !== "QUIZ" && onConflictReload) {
          try {
            await onConflictReload(requestedSubmissionId);
          } catch {
            setNotice({ status: "error", message: "Reload the submission before continuing." });
            return;
          }
        }
        await loadDraft();
      }
      setNotice({ status: "error", message });
    } finally {
      if (isActiveContext(requestedSubmissionId)) setPublishing(false);
      onPublishingChange?.(false);
    }
  };

  if (!fullyGraded) {
    return null;
  }

  return (
    <div className="space-y-2 pt-1" data-testid="teacher-feedback-ai-controls">
      {notice && (
        <Alert status={notice.status} onClose={() => setNotice(null)}>
          <Alert.Description>{notice.message}</Alert.Description>
        </Alert>
      )}

      {promptPending && (
        <Alert status="warning">
          <Alert.Title>AI feedback draft ready</Alert.Title>
          <Alert.Description>
            An AI-generated draft has been automatically prepared. Would you like to review it or keep your current notes?
          </Alert.Description>
          <div className="flex gap-2 mt-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setPreviousDraft(promptPending.manualText);
                onFeedbackDraftChange(promptPending.aiText);
                setReviewing(true);
                setPromptPending(null);
              }}
            >
              Review AI Draft
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setPromptPending(null)}
            >
              Keep My Notes
            </Button>
          </div>
        </Alert>
      )}

      {fetchingDraft && draft?.status === "PENDING" && (
        <p role="status" className="text-xs text-muted-foreground italic">
          Preparing AI feedback...
        </p>
      )}

      {reviewing && (
        <div className="space-y-2 pt-1" data-testid="ai-feedback-review-actions">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              AI-generated draft under review — click and edit text directly above.
            </span>
            <span className={`text-xs ${overLimit ? "font-bold text-destructive" : "text-muted-foreground"}`}>
              {finalText.length}/{AI_FEEDBACK_MAX_LENGTH} characters
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void handleDiscard()}
              disabled={publishing || discarding || disabled}
            >
              {discarding ? "Discarding..." : "Discard Draft"}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handlePublish()}
              disabled={publishing || discarding || disabled || !finalText || overLimit}
            >
              {publishing ? "Posting Feedback..." : "Post Feedback"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
