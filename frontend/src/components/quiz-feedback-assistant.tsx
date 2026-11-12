import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

import ConfirmDialog from "@/components/confirm-dialog";
import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { useToast } from "@/components/retroui/Toast";
import {
  generateSubmissionFeedbackSuggestion,
  getSubmissionFeedbackEligibility,
  publishSubmissionFeedback,
  SubmissionFeedbackApiError,
  type FeedbackEligibility,
  type FeedbackSuggestion,
} from "@/lib/submission-feedback-api";

type QuizFeedbackAssistantProps = {
  submissionId: number;
  fullyGraded: boolean;
  existingFeedback: string;
  onPublished: (feedback: string, feedbackFingerprint: string) => void;
};

function publicationConflictMessage(error: SubmissionFeedbackApiError): string {
  switch (error.code) {
    case "FEEDBACK_EVIDENCE_STALE":
    case "FEEDBACK_SUBMISSION_CHANGED":
      return "Quiz scores or answers changed. Generate a new suggestion before posting.";
    case "FEEDBACK_COMMENT_STALE":
      return "Saved teacher feedback changed elsewhere. Reload before posting so it is not overwritten.";
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
  onPublished,
}: QuizFeedbackAssistantProps) {
  const toast = useToast();
  const [eligibility, setEligibility] = useState<FeedbackEligibility | null>(null);
  const [checking, setChecking] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [suggestion, setSuggestion] = useState<FeedbackSuggestion | null>(null);
  const [reviewDraft, setReviewDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ status: "error" | "warning"; message: string } | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const mountedRef = useRef(true);
  const activeContextRef = useRef({ submissionId, fullyGraded });
  activeContextRef.current = { submissionId, fullyGraded };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isActiveContext = useCallback(
    (requestedSubmissionId: number) => {
      const current = activeContextRef.current;
      return mountedRef.current && current.submissionId === requestedSubmissionId && current.fullyGraded;
    },
    [],
  );

  const checkEligibility = useCallback(async () => {
    if (!fullyGraded) return;
    const requestedSubmissionId = submissionId;
    setChecking(true);
    setNotice(null);
    try {
      const result = await getSubmissionFeedbackEligibility(requestedSubmissionId);
      if (!isActiveContext(requestedSubmissionId)) return;
      setEligibility(result);
    } catch (error) {
      if (!isActiveContext(requestedSubmissionId)) return;
      const message = error instanceof Error ? error.message : "Unable to check AI feedback availability.";
      setEligibility(null);
      setNotice({ status: "error", message });
    } finally {
      if (isActiveContext(requestedSubmissionId)) setChecking(false);
    }
  }, [fullyGraded, isActiveContext, submissionId]);

  useEffect(() => {
    setEligibility(null);
    setSuggestion(null);
    setReviewDraft(null);
    setNotice(null);
    setReplaceOpen(false);
    if (fullyGraded) void checkEligibility();
  }, [checkEligibility, fullyGraded, submissionId]);

  const generateSuggestion = async () => {
    if (!eligibility?.eligible || generating) return;
    setGenerating(true);
    setNotice(null);
    setSuggestion(null);
    setReviewDraft(null);
    const requestedSubmissionId = submissionId;
    try {
      const generated = await generateSubmissionFeedbackSuggestion(requestedSubmissionId);
      if (!isActiveContext(requestedSubmissionId)) return;
      setSuggestion(generated);
    } catch (error) {
      if (!isActiveContext(requestedSubmissionId)) return;
      const message = error instanceof Error ? error.message : "Unable to generate an AI feedback suggestion.";
      setNotice({ status: "error", message });
      if (error instanceof SubmissionFeedbackApiError && error.status === 409) {
        await checkEligibility();
      }
    } finally {
      if (isActiveContext(requestedSubmissionId)) setGenerating(false);
    }
  };

  const appendSuggestion = () => {
    if (!suggestion) return;
    const current = existingFeedback.trim();
    setReviewDraft(current ? `${current}\n\n${suggestion.feedback}` : suggestion.feedback);
    setNotice(null);
  };

  const replaceSuggestion = () => {
    if (!suggestion) return;
    setReviewDraft(suggestion.feedback);
    setReplaceOpen(false);
    setNotice(null);
  };

  const discardSuggestion = () => {
    setSuggestion(null);
    setReviewDraft(null);
    setNotice(null);
  };

  const publishFeedback = async () => {
    if (!suggestion || reviewDraft === null || publishing) return;
    const finalText = reviewDraft.trim();
    if (!finalText) {
      setNotice({ status: "error", message: "Enter the final teacher-approved feedback before posting." });
      return;
    }
    setPublishing(true);
    setNotice(null);
    const requestedSubmissionId = submissionId;
    try {
      const saved = await publishSubmissionFeedback(requestedSubmissionId, {
        feedback: finalText,
        expected_evidence_fingerprint: suggestion.evidence_fingerprint,
        expected_feedback_fingerprint: suggestion.feedback_fingerprint,
      });
      if (!isActiveContext(requestedSubmissionId)) return;
      onPublished(saved.feedback, saved.feedback_fingerprint);
      setSuggestion(null);
      setReviewDraft(null);
      toast.success({ title: "Teacher feedback posted" });
      await checkEligibility();
    } catch (error) {
      if (!isActiveContext(requestedSubmissionId)) return;
      const message =
        error instanceof SubmissionFeedbackApiError
          ? publicationConflictMessage(error)
          : error instanceof Error
            ? error.message
            : "Unable to post the approved feedback.";
      if (error instanceof SubmissionFeedbackApiError && error.status === 409) {
        await checkEligibility();
      }
      setNotice({ status: "error", message });
    } finally {
      if (isActiveContext(requestedSubmissionId)) setPublishing(false);
    }
  };

  return (
    <Card className="block w-full space-y-3 border-2 border-black bg-primary/10 p-4 shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles aria-hidden="true" className="size-5" />
            <h3 className="text-base font-extrabold text-black">AI Feedback Assistant</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Generate a private suggestion, review its wording, then post it yourself. Scores are never changed.
          </p>
        </div>
        {fullyGraded && eligibility?.eligible && !suggestion ? (
          <Button
            type="button"
            size="sm"
            onClick={() => void generateSuggestion()}
            disabled={checking || generating || publishing}
          >
            {generating ? "Generating..." : "Generate Feedback"}
          </Button>
        ) : null}
      </div>

      {!fullyGraded ? (
        <Alert status="warning">
          <Alert.Title>Finish manual grading first</Alert.Title>
          <Alert.Description>
            Every quiz question must have an awarded score before an AI suggestion can be generated.
          </Alert.Description>
        </Alert>
      ) : checking ? (
        <p role="status" className="text-sm font-semibold text-muted-foreground">
          Checking feedback availability...
        </p>
      ) : eligibility && !eligibility.eligible ? (
        <Alert status="warning">
          <Alert.Title>AI feedback unavailable</Alert.Title>
          <Alert.Description>{eligibility.message || "This submission is not eligible for AI feedback."}</Alert.Description>
        </Alert>
      ) : null}

      {notice ? (
        <Alert status={notice.status} onClose={() => setNotice(null)}>
          <Alert.Description>{notice.message}</Alert.Description>
        </Alert>
      ) : null}

      {suggestion ? (
        <div className="space-y-3">
          <div className="rounded border-2 border-black bg-background p-3">
            <p className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">AI suggestion — not posted</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-black">{suggestion.feedback}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {!existingFeedback.trim() ? (
              <Button type="button" size="sm" onClick={() => setReviewDraft(suggestion.feedback)}>
                Use Suggestion
              </Button>
            ) : (
              <>
                <Button type="button" size="sm" variant="outline" onClick={appendSuggestion}>
                  Append Suggestion
                </Button>
                <Button type="button" size="sm" variant="destructive" onClick={() => setReplaceOpen(true)}>
                  Replace Existing Feedback
                </Button>
              </>
            )}
            <Button type="button" size="sm" variant="outline" onClick={discardSuggestion}>
              Discard Suggestion
            </Button>
          </div>

          {reviewDraft !== null ? (
            <div className="space-y-2">
              <label htmlFor={`ai-feedback-review-${submissionId}`} className="block text-sm font-bold text-black">
                Final teacher-approved feedback
              </label>
              <textarea
                id={`ai-feedback-review-${submissionId}`}
                value={reviewDraft}
                onChange={(event) => setReviewDraft(event.target.value)}
                maxLength={1200}
                rows={4}
                className="w-full rounded! border-2 border-black px-3 py-2 text-sm focus:outline-none"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{reviewDraft.length}/1200 characters</span>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void publishFeedback()}
                  disabled={publishing || !reviewDraft.trim()}
                >
                  {publishing ? "Posting Feedback..." : "Post Approved Feedback"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={replaceOpen}
        onOpenChange={setReplaceOpen}
        title="Replace Existing Feedback"
        confirmationTitle="Replace the currently saved teacher feedback with this AI suggestion?"
        description="You can still edit the replacement before explicitly posting it. Nothing is saved by this confirmation alone."
        confirmLabel="Use as Replacement"
        confirmVariant="destructive"
        onCancel={() => setReplaceOpen(false)}
        onConfirm={replaceSuggestion}
      />
    </Card>
  );
}
