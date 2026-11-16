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

const AI_FEEDBACK_MAX_LENGTH = 1200;

const INITIAL_POLL_INTERVALS_MS = [1000, 1500, 2000, 3000, 4000, 5000];
const STEADY_POLL_INTERVAL_MS = 5000;
const MAX_TOTAL_POLL_ATTEMPTS = 18; // ~76.5 seconds total coverage for delayed periodic worker sweeps

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
  /** Reports whether an AI-generated draft or score template is under review in the host editor. */
  onReviewChange?: (reviewing: boolean, isTemplate?: boolean, isPolicyFallback?: boolean) => void;
  onConflictReload?: (submissionId: number) => Promise<void>;
  disabled?: boolean;
  showScores?: boolean;
  autoAiFeedbackEnabled?: boolean;
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
  showScores = true,
  autoAiFeedbackEnabled,
}: QuizFeedbackAssistantProps) {
  const toast = useToast();
  const [draft, setDraft] = useState<FeedbackDraft | null>(null);
  const [fetchingDraft, setFetchingDraft] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [previousDraft, setPreviousDraft] = useState<string>("");
  const previousDraftRef = useRef<string>("");
  previousDraftRef.current = previousDraft;
  const [promptPending, setPromptPending] = useState<{ aiText: string; manualText: string } | null>(null);
  const [notice, setNotice] = useState<{ status: "error" | "warning"; message: string } | null>(null);
  const [pollingExpired, setPollingExpired] = useState(false);
  const [isTakingLonger, setIsTakingLonger] = useState(false);

  const mountedRef = useRef(true);
  const activeSubmissionIdRef = useRef(submissionId);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIndexRef = useRef(0);
  const networkErrorsRef = useRef(0);
  const inFlightRef = useRef(false);

  const feedbackDraftRef = useRef(feedbackDraft);
  feedbackDraftRef.current = feedbackDraft;
  const onReviewChangeRef = useRef(onReviewChange);
  onReviewChangeRef.current = onReviewChange;
  const onFeedbackDraftChangeRef = useRef(onFeedbackDraftChange);
  onFeedbackDraftChangeRef.current = onFeedbackDraftChange;
  const existingFeedbackRef = useRef(existingFeedback);
  existingFeedbackRef.current = existingFeedback;

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPolling();
      onReviewChangeRef.current?.(false);
    };
  }, [stopPolling]);

  const isTemplate = Boolean(draft?.is_template || draft?.detail_level === "TEMPLATE" || draft?.detail_level === "POLICY_FALLBACK");
  const isPolicyFallback = Boolean(draft?.is_policy_fallback || draft?.detail_level === "POLICY_FALLBACK");

  useEffect(() => {
    if (isTemplate) {
      if (isPolicyFallback) {
        onReviewChangeRef.current?.(reviewing, true, true);
      } else {
        onReviewChangeRef.current?.(reviewing, true);
      }
    } else {
      onReviewChangeRef.current?.(reviewing);
    }
  }, [reviewing, isTemplate, isPolicyFallback]);

  const fetchDraft = useCallback(
    async (isPollingAttempt = false) => {
      if (!fullyGraded) {
        stopPolling();
        setDraft(null);
        setReviewing(false);
        return;
      }

      const requestedSubmissionId = submissionId;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setFetchingDraft(true);
      if (!isPollingAttempt) {
        setNotice(null);
      }

      try {
        const result = await getSubmissionFeedbackDraft(requestedSubmissionId);
        if (!mountedRef.current || activeSubmissionIdRef.current !== requestedSubmissionId) return;

        networkErrorsRef.current = 0;
        setDraft(result);

        if (!result.auto_ai_feedback_enabled) {
          stopPolling();
          setReviewing(false);
          return;
        }

        if (result.status === "READY" && result.draft_feedback) {
          stopPolling();
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
          return;
        }

        if (result.status === "FAILED") {
          stopPolling();
          setReviewing(false);
          return;
        }

        if (
          result.status === "DISCARDED" ||
          result.status === "APPROVED" ||
          result.status === "STALE" ||
          result.status === "NOT_ELIGIBLE"
        ) {
          stopPolling();
          setReviewing(false);
          return;
        }

        const isPending =
          result.status === "PENDING" ||
          (result.status as string) === "QUEUED" ||
          (result.status as string) === "CLAIMED";

        if (isPending) {
          setReviewing(false);
          const nextIndex = pollIndexRef.current;
          if (nextIndex >= 3) {
            setIsTakingLonger(true);
          }
          if (nextIndex < MAX_TOTAL_POLL_ATTEMPTS) {
            const delay =
              nextIndex < INITIAL_POLL_INTERVALS_MS.length
                ? INITIAL_POLL_INTERVALS_MS[nextIndex]
                : STEADY_POLL_INTERVAL_MS;
            pollIndexRef.current = nextIndex + 1;
            stopPolling();
            pollTimerRef.current = setTimeout(() => {
              void fetchDraft(true);
            }, delay);
          } else {
            stopPolling();
            setPollingExpired(true);
          }
          return;
        }

        // result.status === "NONE" or unhandled
        stopPolling();
        setReviewing(false);
      } catch (error) {
        if (!mountedRef.current || activeSubmissionIdRef.current !== requestedSubmissionId) return;
        networkErrorsRef.current += 1;
        if (networkErrorsRef.current < 3) {
          stopPolling();
          pollTimerRef.current = setTimeout(() => {
            void fetchDraft(true);
          }, 2000);
        } else {
          stopPolling();
          setPollingExpired(true);
          const message = error instanceof Error ? error.message : "Unable to load feedback draft.";
          setNotice({ status: "error", message });
          setReviewing(false);
        }
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current && activeSubmissionIdRef.current === requestedSubmissionId) {
          setFetchingDraft(false);
        }
      }
    },
    [fullyGraded, stopPolling, submissionId],
  );

  useEffect(() => {
    activeSubmissionIdRef.current = submissionId;
    stopPolling();
    pollIndexRef.current = 0;
    networkErrorsRef.current = 0;
    setPollingExpired(false);
    setIsTakingLonger(false);
    setDraft(null);
    setReviewing(false);
    setPromptPending(null);
    setNotice(null);

    if (fullyGraded) {
      void fetchDraft(false);
    }

    return () => {
      stopPolling();
    };
  }, [eligibilityRevision, fullyGraded, fetchDraft, stopPolling, submissionId]);

  const resumePolling = useCallback(() => {
    pollIndexRef.current = 0;
    networkErrorsRef.current = 0;
    setPollingExpired(false);
    setIsTakingLonger(false);
    setNotice(null);
    void fetchDraft(false);
  }, [fetchDraft]);

  const handleDiscard = async () => {
    if (discarding || publishing) return;
    setDiscarding(true);
    setNotice(null);
    const requestedSubmissionId = submissionId;
    try {
      await discardSubmissionFeedbackDraft(requestedSubmissionId);
      if (!mountedRef.current || activeSubmissionIdRef.current !== requestedSubmissionId) return;
      onFeedbackDraftChange(previousDraft || existingFeedback);
      setReviewing(false);
      setDraft(null);
      toast.success({ title: isTemplate ? "Feedback template discarded" : "AI feedback draft discarded" });
    } catch (error) {
      if (!mountedRef.current || activeSubmissionIdRef.current !== requestedSubmissionId) return;
      const message = error instanceof Error ? error.message : "Unable to discard draft.";
      setNotice({ status: "error", message });
    } finally {
      if (mountedRef.current && activeSubmissionIdRef.current === requestedSubmissionId) {
        setDiscarding(false);
      }
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
      if (!mountedRef.current || activeSubmissionIdRef.current !== requestedSubmissionId) return;
      onPublished(saved.feedback, saved.feedback_fingerprint);
      setReviewing(false);
      setDraft(null);
      toast.success({
        title: showScores === false ? "Approved feedback saved privately" : "Teacher feedback posted",
      });
    } catch (error) {
      if (!mountedRef.current || activeSubmissionIdRef.current !== requestedSubmissionId) return;
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
        await fetchDraft(false);
      }
      setNotice({ status: "error", message });
    } finally {
      if (mountedRef.current && activeSubmissionIdRef.current === requestedSubmissionId) {
        setPublishing(false);
      }
      onPublishingChange?.(false);
    }
  };

  // 1. Not fully graded state
  if (!fullyGraded) {
    if (autoAiFeedbackEnabled === false) {
      return (
        <p className="text-xs text-muted-foreground italic py-1" data-testid="ai-feedback-disabled">
          Automatic AI Feedback is disabled for this classwork.
        </p>
      );
    }
    return (
      <p className="text-xs text-muted-foreground italic py-1" data-testid="ai-feedback-not-graded">
        AI feedback will be prepared after grading is finalized.
      </p>
    );
  }

  // 2. Disabled state
  const isDisabled = autoAiFeedbackEnabled === false || (draft !== null && draft.auto_ai_feedback_enabled === false);
  if (isDisabled) {
    return (
      <p className="text-xs text-muted-foreground italic py-1" data-testid="ai-feedback-disabled">
        Automatic AI Feedback is disabled for this classwork.
      </p>
    );
  }

  const isPending =
    draft?.status === "PENDING" ||
    (draft?.status as string) === "QUEUED" ||
    (draft?.status as string) === "CLAIMED" ||
    (fetchingDraft && !draft) ||
    pollTimerRef.current !== null ||
    pollingExpired;

  return (
    <div className="space-y-2 pt-1" data-testid="teacher-feedback-ai-controls">
      {notice && (
        <Alert status={notice.status} onClose={() => setNotice(null)}>
          <Alert.Description>{notice.message}</Alert.Description>
        </Alert>
      )}

      {promptPending && (
        <Alert status="warning">
          <Alert.Title>
            {isPolicyFallback
              ? "Score-based feedback template ready (AI disabled by policy)"
              : isTemplate
                ? "Score-based feedback template ready"
                : "AI feedback draft ready"}
          </Alert.Title>
          <Alert.Description>
            {isPolicyFallback
              ? "Contextual AI generation is currently not authorized by policy. A standard score-based template has been prepared. Would you like to review it or keep your current notes?"
              : isTemplate
                ? "A standard feedback template based on the overall score has been prepared. Would you like to review it or keep your current notes?"
                : "An AI-generated draft has been automatically prepared. Would you like to review it or keep your current notes?"}
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
              {isTemplate ? "Review Template" : "Review AI Draft"}
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

      {!reviewing && draft?.status === "READY" && !promptPending && feedbackDraft.trim() !== "" && feedbackDraft.trim() !== existingFeedback.trim() && (
        <div className="flex flex-wrap items-center justify-between gap-2 py-1 text-xs text-muted-foreground" data-testid="ai-feedback-notes-preserved">
          <span>Teacher edits preserved in editor.</span>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={() => {
                setPreviousDraft(feedbackDraft);
                onFeedbackDraftChange(draft.draft_feedback || "");
                setReviewing(true);
              }}
            >
              {isTemplate ? "Review Template" : "Review AI Draft"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={() => {
                onFeedbackDraftChange(existingFeedback);
                setDraft(null);
              }}
            >
              Discard Edits
            </Button>
          </div>
        </div>
      )}

      {draft?.status === "FAILED" && (
        <p className="text-xs text-muted-foreground italic py-1" data-testid="ai-feedback-failed">
          AI feedback couldn't be prepared. You can still write feedback manually.
        </p>
      )}

      {!reviewing && isPending && (
        <div className="flex flex-wrap items-center gap-2 py-1 text-xs text-muted-foreground" data-testid="ai-feedback-preparing">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
          <span>
            {isTemplate
              ? "Preparing score-based feedback template..."
              : isTakingLonger
                ? "AI feedback is still being prepared. You can continue grading while it finishes."
                : "Preparing AI-generated feedback..."}
          </span>
          {pollingExpired && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={resumePolling}
              disabled={fetchingDraft}
            >
              Check Status
            </Button>
          )}
        </div>
      )}

      {reviewing && (
        <div className="space-y-2 pt-1" data-testid="ai-feedback-review-actions">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {isPolicyFallback
                ? "Contextual AI generation is disabled by policy. Standard score-based template under review — click and edit text directly above."
                : isTemplate
                  ? "Score-based template under review — click and edit text directly above."
                  : "AI-generated draft under review — click and edit text directly above."}
            </span>
            <span className={`text-xs ${overLimit ? "font-bold text-destructive" : "text-muted-foreground"}`}>
              {finalText.length}/{AI_FEEDBACK_MAX_LENGTH} characters
            </span>
          </div>
          {showScores === false && (
            <p className="text-xs text-muted-foreground italic" data-testid="ai-feedback-private-note">
              Approved feedback is saved privately and will become visible to the student once scores are released.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void handleDiscard()}
              disabled={publishing || discarding || disabled}
            >
              {discarding ? "Discarding..." : isTemplate ? "Discard Template" : "Discard Draft"}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handlePublish()}
              disabled={publishing || discarding || disabled || !finalText || overLimit}
            >
              {publishing
                ? (showScores === false ? "Saving Feedback..." : "Posting Feedback...")
                : (showScores === false ? "Save Approved Feedback" : "Post Feedback")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
