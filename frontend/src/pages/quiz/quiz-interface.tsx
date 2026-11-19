import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, ArrowRight, Flag, Loader2, AlertCircle } from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { QuizTextAnswerInput } from "@/components/quiz/student-quiz-answer";
import { useToast } from "@/components/retroui/Toast";
import { routes } from "@/../routes";
import { quizPathWithContext } from "@/lib/student-quiz-navigation";
import {
  getQuizAttempt,
  startQuizAttempt,
  submitQuizAttempt,
  type QuizAttemptResponse,
  type QuizAnswerInput,
} from "@/lib/quiz-api";

// ---------------------------------------------------------------------------
// Timer helper — formats remaining seconds as "M:SS"
// ---------------------------------------------------------------------------
function formatTime(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0:00";
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const COMPLETED_QUIZ_STATUSES = new Set(["submitted", "late", "graded"]);

function isCompletedQuizStatus(status?: string | null): boolean {
  return COMPLETED_QUIZ_STATUSES.has((status || "").toLowerCase());
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const StudentQuizTake = () => {
  const toast = useToast();
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const aid = Number(assignmentId);

  // Data state
  const [quiz, setQuiz] = useState<QuizAttemptResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  // Answer tracking: quiz_question_id -> selected_option_id or answer_text
  const [answers, setAnswers] = useState<Map<number, { selected_option_id?: number | null; answer_text?: string | null }>>(new Map());

  // Timer
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --------------------------------------------------
  // Fetch or start quiz attempt
  // --------------------------------------------------
  useEffect(() => {
    if (!aid) return;

    let cancelled = false;

    async function init() {
      setLoading(true);
      setError(null);
      try {
        // Try fetching existing attempt first
        let data = await getQuizAttempt(aid);
        if (cancelled) return;

        const normalizedStatus = (data.status || "").toLowerCase();
        const completed = isCompletedQuizStatus(normalizedStatus);

        // Already submitted or passed and no further attempts permitted -> go directly to results
        if (!data.can_submit && (completed || data.is_passed)) {
          navigate(
            quizPathWithContext(routes.student.quizResult.replace(":assignmentId", String(aid)), location.search),
            { replace: true, state: { submittedAttempt: data } },
          );
          return;
        }

        if (!data.can_submit) {
          setError("This quiz is closed and can no longer be taken.");
          return;
        }

        // Start a fresh attempt only when not started or beginning a permitted retake
        if (normalizedStatus === "not_started" || completed) {
          data = await startQuizAttempt(aid);
        }

        if (cancelled) return;
        setQuiz(data);

        // Pre-fill saved answers if resuming
        const saved = new Map<number, { selected_option_id?: number | null; answer_text?: string | null }>();
        for (const q of data.questions) {
          if (q.selected_option_id != null || q.answer_text) {
            saved.set(q.quiz_question_id, {
              selected_option_id: q.selected_option_id,
              answer_text: q.answer_text,
            });
          }
        }
        setAnswers(saved);

        // Calculate remaining time from server
        if (data.duration_minutes && data.started_at && data.server_time) {
          const startMs = new Date(data.started_at).getTime();
          const serverMs = new Date(data.server_time).getTime();
          const durationMs = data.duration_minutes * 60 * 1000;
          const remaining = Math.max(0, Math.floor((startMs + durationMs - serverMs) / 1000));
          setSecondsLeft(remaining);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load quiz.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, [aid, location.search, navigate]);

  // --------------------------------------------------
  // Countdown timer
  // --------------------------------------------------
  useEffect(() => {
    if (secondsLeft == null || secondsLeft <= 0) return;

    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev == null || prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [secondsLeft != null && secondsLeft > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-submit on timer expiry
  useEffect(() => {
    if (secondsLeft === 0 && quiz && quiz.can_submit && !submitting) {
      handleSubmit();
    }
  }, [secondsLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  // --------------------------------------------------
  // Answer handlers
  // --------------------------------------------------
  const selectOption = useCallback((questionId: number, optionId: number) => {
    setAnswers((prev) => {
      const next = new Map(prev);
      next.set(questionId, { selected_option_id: optionId, answer_text: null });
      return next;
    });
  }, []);

  const setAnswerText = useCallback((questionId: number, text: string) => {
    setAnswers((prev) => {
      const next = new Map(prev);
      next.set(questionId, { selected_option_id: null, answer_text: text });
      return next;
    });
  }, []);

  const toggleFlag = useCallback((index: number) => {
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  // --------------------------------------------------
  // Submit
  // --------------------------------------------------
  const handleSubmit = useCallback(async () => {
    if (!quiz || submitting || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);

    try {
      const payload: QuizAnswerInput[] = quiz.questions.map((q) => {
        const ans = answers.get(q.quiz_question_id);
        return {
          quiz_question_id: q.quiz_question_id,
          selected_option_id: ans?.selected_option_id ?? null,
          answer_text: ans?.answer_text ?? null,
        };
      });

      const submitted = await submitQuizAttempt(aid, payload);
      toast.success({ title: "Quiz submitted" });

      // Navigate to result page with the saved attempt while result page verifies canonical state
      navigate(
        quizPathWithContext(routes.student.quizResult.replace(":assignmentId", String(aid)), location.search),
        { replace: true, state: { submittedAttempt: submitted } },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit quiz.");
      toast.error({ title: "Failed to submit quiz", description: err instanceof Error ? err.message : undefined });
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [quiz, answers, aid, navigate, location.search, submitting, toast]);

  // --------------------------------------------------
  // Derived values
  // --------------------------------------------------
  const questions = quiz?.questions ?? [];
  const totalQuestions = questions.length;
  const currentQuestion = questions[currentIndex];
  const answeredCount = questions.filter((q) => answers.has(q.quiz_question_id)).length;

  // --------------------------------------------------
  // Loading / Error states
  // --------------------------------------------------
  if (loading) {
    return (
      <div className="retro-squares-bg min-h-screen flex items-center justify-center px-4">
        <LoadingPanel label="Loading quiz..." className="w-full max-w-3xl" />
      </div>
    );
  }

  if (error || !quiz || !currentQuestion) {
    return (
      <div className="retro-squares-bg min-h-screen flex flex-col items-center justify-center gap-3 px-4">
        <AlertCircle className="w-10 h-10 text-red-500" />
        <p className="text-lg font-bold text-center">{error || "Quiz not available."}</p>
        <Button autoIcon={false} onClick={() => navigate(-1)}>Go Back</Button>
      </div>
    );
  }

  return (
    <div className="retro-squares-bg min-h-dvh min-w-0">
      <header className="border-b-2 border-black bg-card px-4 py-3 sm:px-6">
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
        <Button
          type="button"
          size="headerIcon"
          variant="outline"
          autoIcon={false}
          onClick={() => navigate(-1)}
          className="rounded-full"
          aria-label="Go back"
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div className="text-center">
          {secondsLeft != null ? (
            <>
              <p className={`text-2xl font-bold ${secondsLeft <= 60 ? "text-red-600 animate-pulse" : ""}`}>
                {formatTime(secondsLeft)}
              </p>
              <p className="text-xs text-black/60">
                {secondsLeft <= 60 ? "hurry up!" : "minutes left"}
              </p>
            </>
          ) : (
            <p className="text-sm text-black/60">No time limit</p>
          )}
        </div>
        <Button
          autoIcon={false}
          size="header"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Submitting...</>
          ) : (
            "Finish Quiz"
          )}
        </Button>
        </div>
      </header>

      <main className="px-3 py-4 sm:px-4 md:px-6">

      {/* Quiz header + question navigator */}
      <Card className="flex flex-col">
        <div className="text-center mb-4">
          <Card.Title className="text-xl font-bold">{quiz.title}</Card.Title>
          <p className="text-sm text-black/60">
            {answeredCount} of {totalQuestions} answered
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {questions.map((q, i) => {
            const isAnswered = answers.has(q.quiz_question_id);
            const isFlagged = flagged.has(i);
            const isCurrent = i === currentIndex;
            return (
              <Button
                autoIcon={false}
                key={q.quiz_question_id}
                onClick={() => setCurrentIndex(i)}
                variant="outline"
                className={`size-8 border-2 border-black text-sm font-semibold cursor-pointer relative hover:translate-y-0 active:translate-y-0 active:translate-x-0 ${isCurrent
                  ? "bg-[#F6E9B2] hover:bg-[#F6E9B2] active:bg-[#F6E9B2] shadow-sm"
                  : isAnswered
                    ? "bg-emerald-100 hover:bg-emerald-100 active:bg-emerald-100"
                    : "bg-white hover:bg-white active:bg-white"
                  }`}
              >
                {i + 1}
                {isFlagged && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full" />
                )}
              </Button>
            );
          })}
        </div>
      </Card>

      {/* Prev / Flag / Next controls */}
      <div className="flex items-center justify-between px-3 py-4 sm:px-6 md:px-24">
        <Button
          type="button"
          autoIcon={false}
          variant="outline"
          onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
          disabled={currentIndex === 0}
          className="size-11 rounded-full p-0"
          aria-label="Previous question"
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div className="flex items-center gap-4">
          <Button
            autoIcon={false}
            variant="ghost"
            onClick={() => toggleFlag(currentIndex)}
            className={`border rounded flex items-center gap-2 hover:bg-gray-100 transition-all cursor-pointer ${flagged.has(currentIndex) ? "bg-red-50" : "bg-white"
              }`}
          >
            <Flag size={14} className={flagged.has(currentIndex) ? "fill-red-500 text-red-500" : "text-gray-400"} />
            {flagged.has(currentIndex) ? "Flagged" : "Flag Question"}
          </Button>

          <Button
            type="button"
            autoIcon={false}
            variant="outline"
            onClick={() => setCurrentIndex((i) => Math.min(totalQuestions - 1, i + 1))}
            disabled={currentIndex === totalQuestions - 1}
            className="size-11 rounded-full p-0"
            aria-label="Next question"
          >
            <ArrowRight className="size-5" />
          </Button>
        </div>
      </div>

      {/* Question card */}
      <div className="px-12 md:px-24">
        <Card className="bg-white flex flex-col justify-center items-center p-6 text-center shadow-none hover:shadow-none">
          <p className="text-sm text-black/50 mb-1">
            Question {currentIndex + 1} of {totalQuestions}
            {currentQuestion.points > 0 && (
              <span className="ml-2 font-semibold">
                ({currentQuestion.points} {currentQuestion.points === 1 ? "pt" : "pts"})
              </span>
            )}
          </p>
          <p className="text-center text-lg font-semibold whitespace-normal break-words [overflow-wrap:anywhere] max-w-full">
            {currentQuestion.question_text}
          </p>
        </Card>
      </div>

      {/* Answer options */}
      {currentQuestion.question_type === "MULTIPLE_CHOICE" ? (
        <div className="grid grid-cols-1 gap-4 px-3 py-4 sm:px-6 sm:py-6 md:grid-cols-2 md:px-24">
          {currentQuestion.options
            .sort((a, b) => a.option_order - b.option_order)
            .map((opt) => {
              const selected = answers.get(currentQuestion.quiz_question_id)?.selected_option_id === opt.option_id;
              return (
                <Button
                  autoIcon={false}
                  key={opt.option_id}
                  onClick={() => selectOption(currentQuestion.quiz_question_id, opt.option_id)}
                  className={`w-full min-w-0 h-full min-h-[5rem] cursor-pointer flex items-center justify-center p-4 sm:p-6 text-center text-base sm:text-lg font-semibold transition-all hover:shadow-none whitespace-normal break-words [overflow-wrap:anywhere] ${selected ? "bg-primary text-primary-foreground border-black" : "bg-white text-black hover:bg-black/5"
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
        <div className="px-12 py-6 md:px-24">
          <QuizTextAnswerInput
            question={currentQuestion}
            value={answers.get(currentQuestion.quiz_question_id)?.answer_text ?? ""}
            onChange={(text) => setAnswerText(currentQuestion.quiz_question_id, text)}
          />
        </div>
      )}
      </main>
    </div>
  );
};

export default StudentQuizTake;
