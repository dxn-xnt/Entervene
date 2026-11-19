import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "@/components/retroui/Dialog";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import { Alert } from "@/components/retroui/Alert";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/retroui/Toast";
import { QuizTextAnswerInput } from "@/components/quiz/student-quiz-answer";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Lightbulb,
  Loader2,
  RotateCcw,
  Save,
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
  const [, setHasUnsavedChanges] = useState(false);
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
    if (viewMode === "taking" && activeAttempt) {
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

  if (!isOpen) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[99999] flex flex-col bg-background">
        <header className="shrink-0 border-b-2 border-black bg-card px-4 py-3 sm:px-6">
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
            <Button
              type="button"
              size="headerIcon"
              variant="outline"
              onClick={handleCloseRequest}
              className="rounded-full"
              aria-label="Exit practice assessment"
            >
              <ArrowLeft className="size-5" />
            </Button>

            <div className="min-w-0 text-center">
              <h1 className="truncate text-xl font-black">
                {metadata?.title || "Practice Assessment"}
              </h1>
              <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                <Badge variant="surface" size="sm">Ungraded Practice</Badge>
                <Badge variant="outline" size="sm">
                  Attempt #{viewMode === "taking" ? activeAttempt?.attempt_number || 1 : feedback?.attempt_number || 1}
                </Badge>
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

            {viewMode === "taking" && activeAttempt && currentQuestion ? (
              <Button
                type="button"
                size="header"
                variant="default"
                autoIcon={false}
                disabled={isSubmitting || isSavingDraft}
                onClick={() => setShowConfirmSubmit(true)}
              >
                Finish Practice
              </Button>
            ) : (
              <Button
                type="button"
                size="header"
                variant="default"
                onClick={handleTryAgain}
              >
                <RotateCcw className="size-4" /> Try Again
              </Button>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto max-w-7xl space-y-4">
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
              {/* Question Navigator */}
              <div className="space-y-2.5 bg-muted/30 p-3 sm:p-4 rounded border-2 border-border">
                <div className="text-xs font-semibold text-muted-foreground">
                  Question {currentQuestionIndex + 1} of {questions.length}
                </div>

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

              {/* Previous and Next Question Controls */}
              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={currentQuestionIndex === 0 || isSubmitting}
                  onClick={() => setCurrentQuestionIndex((prev) => Math.max(0, prev - 1))}
                  className="size-11 rounded-full p-0"
                  aria-label="Previous question"
                >
                  <ArrowLeft className="size-5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={currentQuestionIndex === questions.length - 1 || isSubmitting}
                  onClick={() => setCurrentQuestionIndex((prev) => Math.min(questions.length - 1, prev + 1))}
                  className="size-11 rounded-full p-0"
                  aria-label="Next question"
                >
                  <ArrowRight className="size-5" />
                </Button>
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

            </div>
          ) : viewMode === "feedback" && feedback ? (
            /* ============================================================ */
            /* VIEW MODE: COMPREHENSIVE SUBMITTED FEEDBACK & DIAGNOSTICS   */
            /* ============================================================ */
            <div className="space-y-5">
              {/* Top Score & Result Banner */}
              <Card
                className="block w-full border-2 border-border bg-card p-5 space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-2xl font-black">
                          {feedback.total_score} / {feedback.max_score} pts
                        </h2>
                      </div>
                      <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                        Score: <strong>{Number(feedback.score_percentage).toFixed(1)}%</strong> • Required Passing:{" "}
                        <strong>{Number(feedback.passing_percentage).toFixed(0)}%</strong>
                        {feedback.completed_at && ` • Completed ${formatDate(feedback.completed_at)}`}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant={feedback.is_passed ? "success" : "destructive"}
                    size="sm"
                    className="shrink-0"
                  >
                    {feedback.is_passed ? "PASSED" : "BELOW PASSING"}
                  </Badge>

                </div>

                {/* Eligibility Explanatory Box */}
                <Alert status={feedback.eligible_for_remediation ? "success" : "warning"} className="p-3">
                  <div className="flex items-start gap-2">
                    {feedback.eligible_for_remediation ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    )}
                    <div>
                      <Alert.Title className="text-sm font-bold">
                        {feedback.eligible_for_remediation
                          ? "Remediation activity unlocked"
                          : "Passing score still required"}
                      </Alert.Title>
                      <Alert.Description className="mt-0.5 text-xs sm:text-sm text-current/80">
                        {feedback.eligible_for_remediation
                          ? "You have satisfied the practice requirement and can now open the curated remediation activity."
                          : `Earn at least ${feedback.passing_percentage}% to unlock the curated remediation activity. Review your answers below, then try again.`}
                      </Alert.Description>
                    </div>
                  </div>
                </Alert>
              </Card>

              {/* Historical Attempt Selector */}
              {allAttempts.filter((a) => a.status === "SUBMITTED").length > 1 && (
                <div className="space-y-2">
                  <p className="text-sm font-bold text-foreground">
                    Review Previous Attempt Feedback:
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {allAttempts
                      .filter((a) => a.status === "SUBMITTED")
                      .map((att) => {
                        const isSelected = (selectedAttemptId ?? feedback.attempt_id) === att.attempt_id;
                        return (
                          <Button
                            autoIcon={false}
                            key={att.attempt_id}
                            type="button"
                            onClick={() => handleSelectHistoricalAttempt(att.attempt_id)}
                            size="sm"
                            variant={isSelected ? "default" : "outline"}
                            className="font-mono text-xs font-bold shadow-none hover:shadow-none"
                          >
                            Attempt #{att.attempt_number} ({Number(att.score_percentage).toFixed(0)}%)
                            {att.is_passed ? " ✓" : ""}
                          </Button>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Diagnostic Question List with Mandatory Complete Correct Answers */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
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
                        className="block w-full border-2 border-border bg-card p-4 space-y-3.5"
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
        </main>

      </div>

      <Dialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
        <Dialog.Content
          size="md"
          style={{ zIndex: 100001 }}
          overlay={{
            forceRender: true,
            style: {
              zIndex: 100000,
              backgroundColor: "rgb(0 0 0 / 0.6)",
              pointerEvents: "auto",
            },
          }}
        >
          <Dialog.Header position="static">
            <Dialog.Title className="font-sans text-xl font-bold">
              Leave Practice Assessment?
            </Dialog.Title>
          </Dialog.Header>
          <div className="space-y-3 px-5 pb-2 pt-5">
            <div className="space-y-1">
              <p className="text-base font-bold">Save your practice progress?</p>
              <p className="text-sm text-muted-foreground">
                Save your answers to resume later, or discard them and leave this attempt.
              </p>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                autoIcon={false}
                onClick={() => setShowCloseConfirm(false)}
                disabled={isSavingDraft}
              >
                Continue Practice
              </Button>
            </div>
          </div>
          <Dialog.Footer position="static" className="flex-wrap justify-end">
            <Button
              type="button"
              variant="outline"
              className="text-destructive"
              disabled={isSavingDraft}
              onClick={() => {
                setHasUnsavedChanges(false);
                setShowCloseConfirm(false);
                onClose();
              }}
            >
              Discard & Exit
            </Button>
            <Button
              type="button"
              variant="default"
              disabled={isSavingDraft}
              onClick={handleSaveDraftAndExit}
            >
              {isSavingDraft ? (
                <><Loader2 className="size-4 mr-1.5 animate-spin" /> Saving...</>
              ) : (
                <><Save className="size-4 mr-1.5" /> Save Draft & Exit</>
              )}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>

      <ConfirmDialog
        open={showConfirmSubmit}
        onOpenChange={setShowConfirmSubmit}
        style={{ zIndex: 100001 }}
        overlay={{
          style: {
            zIndex: 100000,
            backgroundColor: "rgb(0 0 0 / 0.6)",
            pointerEvents: "auto",
          },
        }}
        title="Submit Practice Assessment?"
        confirmationTitle={
          unansweredCount > 0
            ? `${unansweredCount} unanswered question${unansweredCount === 1 ? "" : "s"}`
            : "All questions answered"
        }
        description={
          unansweredCount > 0
            ? `You have answered ${answeredCount} of ${questions.length} questions. Unanswered questions will receive 0 points. You cannot change your answers after submitting.`
            : "Your answers will be submitted for scoring. You cannot change them after submitting."
        }
        confirmLabel={isSubmitting ? "Submitting..." : "Confirm & Submit"}
        cancelLabel="Back to Questions"
        confirmVariant="default"
        isLoading={isSubmitting}
        onConfirm={handleSubmit}
      />
    </>,
    document.body,
  );
}
