import { useEffect, useState } from "react";
import { Dialog } from "@/components/retroui/Dialog";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import { Alert } from "@/components/retroui/Alert";
import { Progress } from "@/components/retroui/Progress";
import { useToast } from "@/components/retroui/Toast";
import { QuizTextAnswerInput } from "@/components/quiz/student-quiz-answer";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  Loader2,
  RotateCcw,
  Save,
  Send,
  XCircle,
} from "lucide-react";
import {
  type PracticeAttemptActiveQuestion,
  type PracticeAttemptFeedbackResponse,
  type PracticeAttemptStartResponse,
  type PracticeAttemptSummary,
  type StudentPracticeAssessmentMetadata,
  getStudentPracticeAssessment,
  getStudentPracticeAttemptFeedback,
  listStudentPracticeAttempts,
  saveStudentPracticeAttemptDraft,
  startStudentPracticeAttempt,
  submitStudentPracticeAttempt,
} from "@/lib/practice-assessment-api";
import { formatDate } from "@/lib/formatters";

interface StudentPracticeAssessmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  interventionId: number;
  initialMode?: "taking" | "feedback";
  onAttemptCompleted?: (feedback: PracticeAttemptFeedbackResponse) => void;
}

export default function StudentPracticeAssessmentModal({
  isOpen,
  onClose,
  interventionId,
  initialMode = "taking",
  onAttemptCompleted,
}: StudentPracticeAssessmentModalProps) {
  const toast = useToast();

  // Primary State
  const [viewMode, setViewMode] = useState<"taking" | "feedback">(initialMode);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Assessment & Attempts State
  const [metadata, setMetadata] = useState<StudentPracticeAssessmentMetadata | null>(null);
  const [allAttempts, setAllAttempts] = useState<PracticeAttemptSummary[]>([]);
  const [selectedAttemptId, setSelectedAttemptId] = useState<number | null>(null);

  // Taking State
  const [activeAttempt, setActiveAttempt] = useState<PracticeAttemptStartResponse | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<
    Record<
      number,
      {
        selected_option_id?: number | null;
        student_answer_text?: string | null;
      }
    >
  >({});
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // Feedback State
  const [feedback, setFeedback] = useState<PracticeAttemptFeedbackResponse | null>(null);
  const [loadingFeedback, setLoadingFeedback] = useState(false);

  // 1. Initial Load when modal opens
  useEffect(() => {
    if (!isOpen) {
      // Reset transient taking state when modal closes
      setShowConfirmSubmit(false);
      setShowCloseConfirm(false);
      setErrorMessage(null);
      setHasUnsavedChanges(false);
      return;
    }

    let isMounted = true;
    const initialize = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const [meta, attempts] = await Promise.all([
          getStudentPracticeAssessment(interventionId),
          listStudentPracticeAttempts(interventionId),
        ]);

        if (!isMounted) return;
        setMetadata(meta);
        setAllAttempts(attempts);

        const completedAttempts = attempts.filter((a) => a.status === "SUBMITTED");

        if (initialMode === "feedback" && completedAttempts.length > 0) {
          // Open directly into feedback for latest completed attempt
          const latestAttempt = completedAttempts[0];
          setSelectedAttemptId(latestAttempt.attempt_id);
          setViewMode("feedback");
          const fb = await getStudentPracticeAttemptFeedback(interventionId, latestAttempt.attempt_id);
          if (isMounted) setFeedback(fb);
        } else {
          // Mode: Taking (start new or resume active attempt)
          setViewMode("taking");
          const startRes = await startStudentPracticeAttempt(interventionId);
          if (isMounted) {
            setActiveAttempt(startRes);
            setCurrentQuestionIndex(0);

            // Restore saved draft answers if resuming!
            const restoredAnswers: Record<
              number,
              { selected_option_id?: number | null; student_answer_text?: string | null }
            > = {};
            if (startRes.saved_answers && Array.isArray(startRes.saved_answers)) {
              for (const sa of startRes.saved_answers) {
                restoredAnswers[sa.practice_question_id] = {
                  selected_option_id: sa.selected_option_id ?? null,
                  student_answer_text: sa.student_answer_text ?? null,
                };
              }
            }
            setAnswers(restoredAnswers);
            setHasUnsavedChanges(false);
          }
        }
      } catch (err) {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : "Unable to load practice assessment.";
        setErrorMessage(msg);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    void initialize();

    return () => {
      isMounted = false;
    };
  }, [isOpen, interventionId, initialMode]);

  // Answer modification handlers
  const handleSelectOption = (questionId: number, optionId: number) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: {
        selected_option_id: optionId,
        student_answer_text: null,
      },
    }));
    setHasUnsavedChanges(true);
  };

  const handleIdentificationInput = (questionId: number, text: string) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: {
        selected_option_id: null,
        student_answer_text: text,
      },
    }));
    setHasUnsavedChanges(true);
  };

  // Save Draft & Exit handler (without finalizing or scoring)
  const handleSaveDraftAndExit = async () => {
    if (!activeAttempt) return;
    setIsSavingDraft(true);
    setErrorMessage(null);

    const formattedAnswers = activeAttempt.questions.map((q) => {
      const recorded = answers[q.practice_question_id];
      return {
        practice_question_id: q.practice_question_id,
        selected_option_id: recorded?.selected_option_id ?? null,
        student_answer_text: recorded?.student_answer_text?.trim() || null,
      };
    });

    try {
      await saveStudentPracticeAttemptDraft(
        interventionId,
        activeAttempt.attempt_id,
        formattedAnswers
      );
      setHasUnsavedChanges(false);
      setShowCloseConfirm(false);
      toast.success({
        title: "Draft Saved",
        description: "Your practice answers have been saved. You can resume at any time.",
      });
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save draft answers.";
      setErrorMessage(msg);
      toast.error({
        title: "Save Failed",
        description: msg,
      });
    } finally {
      setIsSavingDraft(false);
    }
  };

  // Safe closing handler
  const handleCloseRequest = () => {
    if (viewMode === "taking" && hasUnsavedChanges) {
      setShowCloseConfirm(true);
    } else {
      setShowCloseConfirm(false);
      onClose();
    }
  };

  // Submit attempt
  const handleSubmit = async () => {
    if (!activeAttempt) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    const formattedAnswers = activeAttempt.questions.map((q) => {
      const recorded = answers[q.practice_question_id];
      return {
        practice_question_id: q.practice_question_id,
        selected_option_id: recorded?.selected_option_id ?? null,
        student_answer_text: recorded?.student_answer_text?.trim() || null,
      };
    });

    try {
      const response = await submitStudentPracticeAttempt(
        interventionId,
        activeAttempt.attempt_id,
        formattedAnswers
      );

      setFeedback(response);
      setViewMode("feedback");
      setShowConfirmSubmit(false);
      setHasUnsavedChanges(false);
      setShowCloseConfirm(false);

      // Refresh attempts history & metadata
      const [updatedAttempts, updatedMeta] = await Promise.all([
        listStudentPracticeAttempts(interventionId),
        getStudentPracticeAssessment(interventionId),
      ]);
      setAllAttempts(updatedAttempts);
      setMetadata(updatedMeta);
      setSelectedAttemptId(response.attempt_id);

      if (onAttemptCompleted) {
        onAttemptCompleted(response);
      }

      if (response.is_passed) {
        toast.success({
          title: "Practice Passed!",
          description: `Score: ${response.score_percentage}%. You have qualified for the remediation activity.`,
        });
      } else {
        toast.info({
          title: "Attempt Completed",
          description: `Score: ${response.score_percentage}%. Review your complete answers and explanations below.`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to submit practice attempt.";
      setErrorMessage(msg);
      setShowConfirmSubmit(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Load specific historical feedback
  const handleSelectHistoricalAttempt = async (attemptId: number) => {
    setSelectedAttemptId(attemptId);
    setLoadingFeedback(true);
    setErrorMessage(null);
    try {
      const fb = await getStudentPracticeAttemptFeedback(interventionId, attemptId);
      setFeedback(fb);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to load attempt feedback.";
      setErrorMessage(msg);
    } finally {
      setLoadingFeedback(false);
    }
  };

  // Start new attempt (Try Again)
  const handleTryAgain = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setHasUnsavedChanges(false);
    setShowCloseConfirm(false);
    try {
      const newAttempt = await startStudentPracticeAttempt(interventionId);
      setActiveAttempt(newAttempt);
      setCurrentQuestionIndex(0);
      setAnswers({});
      setViewMode("taking");
      setShowConfirmSubmit(false);
      setFeedback(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to start a new practice attempt.";
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const questions = activeAttempt?.questions || [];
  const currentQuestion: PracticeAttemptActiveQuestion | undefined = questions[currentQuestionIndex];

  // Calculate answered count
  const answeredCount = questions.filter((q) => {
    const a = answers[q.practice_question_id];
    if (!a) return false;
    if (q.question_type === "IDENTIFICATION") {
      return Boolean(a.student_answer_text?.trim());
    }
    return a.selected_option_id != null;
  }).length;
  const unansweredCount = Math.max(0, questions.length - answeredCount);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleCloseRequest()}>
      <Dialog.Content
        size="screen"
        className="w-[calc(100vw-1.5rem)] sm:w-[calc(100vw-2.5rem)] max-w-[1700px] h-[calc(100dvh-1.5rem)] max-h-[calc(100dvh-2rem)] flex flex-col p-0 overflow-hidden border-2 border-black bg-background shadow-[6px_6px_0_#000]"
      >
        {/* Modal Header */}
        <Dialog.Header className="px-5 py-4 border-b-2 border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Dialog.Title className="text-xl font-black truncate">
                  {metadata?.title || "Practice Assessment"}
                </Dialog.Title>
                <Badge variant="surface" size="sm">
                  Ungraded Practice
                </Badge>
              </div>
              <Dialog.Description className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                {viewMode === "taking"
                  ? `Attempt #${activeAttempt?.attempt_number || 1} • Questions do not affect your grade`
                  : `Results Review • Required to Pass: ${feedback?.passing_percentage ?? metadata?.passing_percentage ?? 75}%`}
              </Dialog.Description>
            </div>

            <div className="flex items-center gap-2">
              {metadata?.gatekeeper_policy === "REQUIRE_PASS" ? (
                <Badge variant="solid" size="sm">
                  Require Passing ({metadata.passing_percentage}%)
                </Badge>
              ) : metadata?.gatekeeper_policy === "REQUIRE_ATTEMPT" ? (
                <Badge variant="outline" size="sm">
                  Require 1 Attempt
                </Badge>
              ) : metadata?.gatekeeper_policy === "OPTIONAL" ? (
                <Badge variant="surface" size="sm">
                  Optional Practice
                </Badge>
              ) : null}
            </div>
          </div>
        </Dialog.Header>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="text-sm font-semibold text-muted-foreground">Preparing Practice Assessment...</p>
            </div>
          ) : errorMessage ? (
            <Alert status="error" className="border-2 border-destructive">
              <AlertTriangle className="size-4" />
              <Alert.Title className="font-bold">Error</Alert.Title>
              <Alert.Description>{errorMessage}</Alert.Description>
            </Alert>
          ) : viewMode === "taking" && activeAttempt && currentQuestion ? (
            /* ============================================================ */
            /* VIEW MODE: TAKING ACTIVE ATTEMPT                            */
            /* ============================================================ */
            <div className="space-y-5">
              {/* Unsaved Changes Confirmation Prompt */}
              {showCloseConfirm && (
                <Alert status="warning" className="border-2 border-amber-600 bg-amber-50 p-4 space-y-3 shadow-xs">
                  <div className="flex items-start gap-2">
                    <HelpCircle className="size-5 shrink-0 mt-0.5 text-amber-800" />
                    <div className="space-y-1">
                      <Alert.Title className="font-bold text-sm text-amber-950">
                        Unsaved Practice Answers
                      </Alert.Title>
                      <Alert.Description className="text-xs text-amber-900 leading-relaxed">
                        You have answers that have not been saved yet. Would you like to save your draft to resume later, discard your changes, or continue answering?
                      </Alert.Description>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowCloseConfirm(false)}
                    >
                      Continue Answering
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive border-destructive hover:bg-destructive/10"
                      onClick={() => {
                        setHasUnsavedChanges(false);
                        setShowCloseConfirm(false);
                        onClose();
                      }}
                    >
                      Discard & Exit
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      disabled={isSavingDraft}
                      onClick={handleSaveDraftAndExit}
                    >
                      {isSavingDraft ? (
                        <>
                          <Loader2 className="size-3.5 mr-1.5 animate-spin" /> Saving...
                        </>
                      ) : (
                        <>
                          <Save className="size-3.5 mr-1.5" /> Save Draft & Exit
                        </>
                      )}
                    </Button>
                  </div>
                </Alert>
              )}

              {/* Top Progress & Question Navigator */}
              <div className="space-y-2.5 bg-muted/30 p-3 sm:p-4 rounded border-2 border-border">
                <div className="flex flex-wrap items-center justify-between text-xs font-semibold text-muted-foreground">
                  <span>
                    Question {currentQuestionIndex + 1} of {questions.length}
                  </span>
                  <span>
                    {answeredCount} of {questions.length} answered
                    {unansweredCount > 0 && ` (${unansweredCount} remaining)`}
                  </span>
                </div>
                <Progress
                  value={questions.length > 0 ? (answeredCount / questions.length) * 100 : 0}
                  className="h-2"
                />

                {/* Question Bubbles Navigator */}
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1 max-h-28 overflow-y-auto p-1">
                  {questions.map((q, idx) => {
                    const ans = answers[q.practice_question_id];
                    const isAnswered =
                      q.question_type === "IDENTIFICATION"
                        ? Boolean(ans?.student_answer_text?.trim())
                        : ans?.selected_option_id != null;
                    const isCurrent = idx === currentQuestionIndex;

                    return (
                      <Button
                        autoIcon={false}
                        key={q.practice_question_id}
                        type="button"
                        onClick={() => setCurrentQuestionIndex(idx)}
                        variant="outline"
                        aria-label={`Jump to Question ${idx + 1}`}
                        className={`size-8 border-2 border-black text-sm font-semibold cursor-pointer relative hover:translate-y-0 active:translate-y-0 active:translate-x-0 transition-all ${isCurrent
                            ? "bg-[#F6E9B2] hover:bg-[#F6E9B2] active:bg-[#F6E9B2] shadow-sm scale-105"
                            : isAnswered
                              ? "bg-emerald-100 hover:bg-emerald-100 active:bg-emerald-100"
                              : "bg-white hover:bg-white active:bg-white"
                          }`}
                      >
                        {idx + 1}
                      </Button>
                    );
                  })}
                </div>
              </div>

              {/* Active Question Display */}
              <Card className="bg-white flex flex-col justify-center items-center p-6 text-center shadow-none hover:shadow-none border-2 border-black space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-black/60 font-mono">
                    QUESTION #{currentQuestion.display_order || currentQuestionIndex + 1}
                  </span>
                  {Number(currentQuestion.points) > 0 && (
                    <span className="text-sm font-bold text-black/60 font-mono">
                      • ({Number(currentQuestion.points)} {Number(currentQuestion.points) === 1 ? "pt" : "pts"})
                    </span>
                  )}
                  <Badge variant="surface" size="sm" className="ml-2">
                    {currentQuestion.question_type === "MULTIPLE_CHOICE"
                      ? "Multiple Choice"
                      : currentQuestion.question_type === "TRUE_FALSE"
                        ? "True / False"
                        : "Identification"}
                  </Badge>
                </div>

                <h3 className="text-center text-lg sm:text-xl font-bold whitespace-normal break-words [overflow-wrap:anywhere] max-w-full leading-relaxed text-foreground">
                  {currentQuestion.question_text}
                </h3>
              </Card>

              {/* Question Inputs */}
              {currentQuestion.question_type === "MULTIPLE_CHOICE" ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-1">
                  {currentQuestion.options.map((opt) => {
                    const isSelected =
                      answers[currentQuestion.practice_question_id]?.selected_option_id === opt.option_id;

                    return (
                      <Button
                        autoIcon={false}
                        key={opt.option_id}
                        type="button"
                        onClick={() => handleSelectOption(currentQuestion.practice_question_id, opt.option_id)}
                        className={`w-full min-w-0 h-full min-h-[4.5rem] cursor-pointer flex items-center justify-center p-4 sm:p-5 text-center text-base font-semibold transition-all hover:shadow-none whitespace-normal break-words [overflow-wrap:anywhere] border-2 border-black ${isSelected
                            ? "bg-primary text-primary-foreground border-black"
                            : "bg-white text-black hover:bg-black/5"
                          }`}
                      >
                        <span className="w-full max-w-full min-w-0 whitespace-normal break-words [overflow-wrap:anywhere] text-center leading-relaxed">
                          {opt.option_text}
                        </span>
                      </Button>
                    );
                  })}
                </div>
              ) : currentQuestion.question_type === "TRUE_FALSE" ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-1">
                  {currentQuestion.options.map((opt) => {
                    const isSelected =
                      answers[currentQuestion.practice_question_id]?.selected_option_id === opt.option_id;

                    return (
                      <Button
                        autoIcon={false}
                        key={opt.option_id}
                        type="button"
                        onClick={() => handleSelectOption(currentQuestion.practice_question_id, opt.option_id)}
                        className={`w-full min-w-0 h-full min-h-[4.5rem] cursor-pointer flex items-center justify-center p-4 sm:p-5 text-center text-base font-bold transition-all hover:shadow-none whitespace-normal break-words [overflow-wrap:anywhere] border-2 border-black ${isSelected
                            ? "bg-primary text-primary-foreground border-black"
                            : "bg-white text-black hover:bg-black/5"
                          }`}
                      >
                        <span className="w-full max-w-full min-w-0 whitespace-normal break-words [overflow-wrap:anywhere] text-center leading-relaxed">
                          {opt.option_text}
                        </span>
                      </Button>
                    );
                  })}
                </div>
              ) : (
                /* IDENTIFICATION */
                <div className="pt-1">
                  <QuizTextAnswerInput
                    question={currentQuestion}
                    value={answers[currentQuestion.practice_question_id]?.student_answer_text ?? ""}
                    onChange={(text) =>
                      handleIdentificationInput(currentQuestion.practice_question_id, text)
                    }
                    placeholder="Enter exact answer..."
                  />
                </div>
              )}

              {/* Confirm Submission Dialog/Notice */}
              {showConfirmSubmit && (
                <Alert
                  status={unansweredCount > 0 ? "warning" : "info"}
                  className="border-2 border-border bg-card p-4 space-y-3"
                >
                  <div className="flex items-start gap-2">
                    <HelpCircle className="size-5 shrink-0 mt-0.5 text-primary" />
                    <div>
                      <Alert.Title className="font-bold text-sm">
                        {unansweredCount > 0
                          ? `Submit with ${unansweredCount} Unanswered Question(s)?`
                          : "Ready to Submit Practice Assessment?"}
                      </Alert.Title>
                      <Alert.Description className="text-xs text-muted-foreground mt-1">
                        {unansweredCount > 0
                          ? `You have answered ${answeredCount} of ${questions.length} questions. Unanswered questions will receive 0 points. You will see full feedback and correct answers immediately after submitting.`
                          : "All questions answered. Once submitted, you will immediately see your score, complete feedback, and full answer explanations."}
                      </Alert.Description>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-border">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isSubmitting}
                      onClick={() => setShowConfirmSubmit(false)}
                    >
                      Back to Questions
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      disabled={isSubmitting}
                      onClick={handleSubmit}
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="size-3.5 mr-1.5 animate-spin" /> Submitting...
                        </>
                      ) : (
                        <>
                          <Send className="size-3.5 mr-1.5" /> Confirm & Submit
                        </>
                      )}
                    </Button>
                  </div>
                </Alert>
              )}
            </div>
          ) : viewMode === "feedback" && feedback ? (
            /* ============================================================ */
            /* VIEW MODE: COMPREHENSIVE SUBMITTED FEEDBACK & DIAGNOSTICS   */
            /* ============================================================ */
            <div className="space-y-6">
              {/* Top Score & Result Banner */}
              <Card
                className={`border-2 p-5 space-y-3 ${feedback.is_passed
                    ? "border-success/40 bg-success/10"
                    : "border-destructive/40 bg-destructive/10"
                  }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {feedback.is_passed ? (
                      <CheckCircle2 className="size-8 text-success shrink-0" />
                    ) : (
                      <XCircle className="size-8 text-destructive shrink-0" />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-2xl font-black">
                          {feedback.total_score} / {feedback.max_score} pts
                        </h2>
                        <Badge
                          variant={feedback.is_passed ? "success" : "destructive"}
                          size="md"
                        >
                          {feedback.is_passed ? "PASSED" : "BELOW PASSING"}
                        </Badge>
                      </div>
                      <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                        Score: <strong>{Number(feedback.score_percentage).toFixed(1)}%</strong> • Required Passing:{" "}
                        <strong>{Number(feedback.passing_percentage).toFixed(0)}%</strong>
                        {feedback.completed_at && ` • Completed ${formatDate(feedback.completed_at)}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={handleTryAgain}
                    >
                      <RotateCcw className="size-3.5 mr-1.5" /> Try Again
                    </Button>
                  </div>
                </div>

                {/* Eligibility Explanatory Box */}
                <div className="text-xs sm:text-sm rounded border border-border bg-card p-3">
                  {feedback.eligible_for_remediation ? (
                    <p className="text-success font-semibold flex items-center gap-1.5">
                      <CheckCircle2 className="size-4 shrink-0" />
                      Remediation activity requirement satisfied! You are now eligible to open the curated remediation activity.
                    </p>
                  ) : (
                    <p className="text-destructive font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="size-4 shrink-0" />
                      A score of at least {feedback.passing_percentage}% is required before the curated remediation activity unlocks. Review your mistakes below and click "Try Again" to retake.
                    </p>
                  )}
                </div>
              </Card>

              {/* Historical Attempt Selector */}
              {allAttempts.filter((a) => a.status === "SUBMITTED").length > 1 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground">
                    Review Previous Attempt Feedback:
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    {allAttempts
                      .filter((a) => a.status === "SUBMITTED")
                      .map((att) => {
                        const isSelected = (selectedAttemptId ?? feedback.attempt_id) === att.attempt_id;
                        return (
                          <button
                            key={att.attempt_id}
                            type="button"
                            onClick={() => handleSelectHistoricalAttempt(att.attempt_id)}
                            className={`px-3 py-1.5 rounded font-mono text-xs font-bold border-2 transition-all ${isSelected
                                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                                : "border-border bg-card text-foreground hover:bg-muted/40"
                              }`}
                          >
                            Attempt #{att.attempt_number} ({Number(att.score_percentage).toFixed(0)}%)
                            {att.is_passed ? " ✓" : ""}
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Diagnostic Question List with Mandatory Complete Correct Answers */}
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b-2 border-border pb-2">
                  <h3 className="text-base font-bold">Diagnostic Review & Answers</h3>
                  <span className="text-xs text-muted-foreground">
                    {feedback.items.length} Questions Reviewed
                  </span>
                </div>

                {loadingFeedback ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="size-6 animate-spin text-primary" />
                    <span className="ml-2 text-sm text-muted-foreground">Loading attempt results...</span>
                  </div>
                ) : (
                  feedback.items.map((item, idx) => {
                    const isCorrect = item.is_correct;

                    return (
                      <Card
                        key={item.practice_question_id ?? idx}
                        className={`border-2 p-4 space-y-3.5 ${isCorrect ? "border-success/30 bg-card" : "border-destructive/30 bg-card"
                          }`}
                      >
                        {/* Question Header */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-bold text-muted-foreground">
                            QUESTION #{idx + 1}
                          </span>
                          <Badge
                            variant={isCorrect ? "success" : "destructive"}
                            size="sm"
                            className="gap-1"
                          >
                            {isCorrect ? (
                              <>
                                <CheckCircle2 className="size-3" /> Correct (+{Number(item.points_awarded)} pt)
                              </>
                            ) : (
                              <>
                                <XCircle className="size-3" /> Incorrect (0 / {Number(item.points_possible)} pt)
                              </>
                            )}
                          </Badge>
                        </div>

                        {/* Question Text */}
                        <h4 className="text-sm sm:text-base font-bold whitespace-pre-wrap">
                          {item.question_text}
                        </h4>

                        {/* Answers Breakdown */}
                        <div className="space-y-2 pt-1 text-xs sm:text-sm">
                          {/* Options Breakdown for Multiple Choice & True/False */}
                          {item.options && item.options.length > 0 && (
                            <div className="space-y-1.5">
                              {item.options.map((opt) => {
                                const wasSelected = opt.option_id === item.selected_option_id;
                                const isOptionCorrect = opt.is_correct;

                                let rowStyle = "border-border bg-muted/20 text-muted-foreground";
                                if (isOptionCorrect) {
                                  rowStyle = "border-success/60 bg-success/10 text-foreground font-semibold";
                                } else if (wasSelected && !isOptionCorrect) {
                                  rowStyle = "border-destructive/60 bg-destructive/10 text-foreground font-semibold";
                                }

                                return (
                                  <div
                                    key={opt.option_id}
                                    className={`flex items-center justify-between p-2.5 rounded border-2 ${rowStyle}`}
                                  >
                                    <div className="flex items-center gap-2">
                                      {isOptionCorrect ? (
                                        <CheckCircle2 className="size-4 text-success shrink-0" />
                                      ) : wasSelected ? (
                                        <XCircle className="size-4 text-destructive shrink-0" />
                                      ) : (
                                        <div className="size-4 rounded-full border border-border shrink-0" />
                                      )}
                                      <span>{opt.option_text}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      {wasSelected && (
                                        <Badge variant="outline" size="sm">
                                          Your Choice
                                        </Badge>
                                      )}
                                      {isOptionCorrect && (
                                        <Badge variant="success" size="sm">
                                          Correct Answer
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Identification Answers */}
                          {(!item.options || item.options.length === 0) && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                              <div
                                className={`p-2.5 rounded border-2 ${isCorrect
                                    ? "border-success/50 bg-success/10"
                                    : "border-destructive/50 bg-destructive/10"
                                  }`}
                              >
                                <span className="text-xs font-bold block text-muted-foreground">
                                  Your Answer:
                                </span>
                                <span className="font-semibold text-sm">
                                  {item.student_answer ? item.student_answer : "(No answer entered)"}
                                </span>
                              </div>

                              <div className="p-2.5 rounded border-2 border-success/50 bg-success/10">
                                <span className="text-xs font-bold block text-success">
                                  Accepted Correct Answer:
                                </span>
                                <span className="font-semibold text-sm text-foreground">
                                  {item.correct_answer}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Explanation Box (Mandatory when available) */}
                        {item.explanation && (
                          <div className="flex items-start gap-2 bg-primary/5 border border-primary/20 p-3 rounded text-xs text-foreground">
                            <Lightbulb className="size-4 text-primary shrink-0 mt-0.5" />
                            <div>
                              <strong className="block font-bold">Explanation:</strong>
                              <p className="mt-0.5 text-muted-foreground leading-relaxed whitespace-pre-wrap">
                                {item.explanation}
                              </p>
                            </div>
                          </div>
                        )}
                      </Card>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* Modal Footer */}
        <Dialog.Footer className="px-5 py-3 border-t-2 border-border bg-card flex flex-wrap items-center justify-between gap-2">
          {viewMode === "taking" && activeAttempt && currentQuestion ? (
            <>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentQuestionIndex === 0 || isSubmitting}
                  onClick={() => setCurrentQuestionIndex((prev) => Math.max(0, prev - 1))}
                >
                  <ArrowLeft className="size-3.5 mr-1" /> Previous
                </Button>
                {currentQuestionIndex < questions.length - 1 && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isSubmitting}
                    onClick={() => setCurrentQuestionIndex((prev) => Math.min(questions.length - 1, prev + 1))}
                  >
                    Next <ArrowRight className="size-3.5 ml-1" />
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSaveDraftAndExit}
                  disabled={isSubmitting || isSavingDraft}
                >
                  {isSavingDraft ? (
                    <>
                      <Loader2 className="size-3.5 mr-1.5 animate-spin" /> Saving...
                    </>
                  ) : (
                    <>
                      <Save className="size-3.5 mr-1.5" /> Save Draft & Exit
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  disabled={isSubmitting || isSavingDraft}
                  onClick={() => setShowConfirmSubmit(true)}
                >
                  <Send className="size-3.5 mr-1.5" /> Submit Practice
                </Button>
              </div>
            </>
          ) : (
            /* Mode: Feedback Footer */
            <>
              <div className="text-xs text-muted-foreground font-medium">
                Attempts are independent and your best passing qualification is preserved.
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onClose}
                >
                  Close
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  onClick={handleTryAgain}
                >
                  <RotateCcw className="size-3.5 mr-1.5" /> Try Again
                </Button>
              </div>
            </>
          )}
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
