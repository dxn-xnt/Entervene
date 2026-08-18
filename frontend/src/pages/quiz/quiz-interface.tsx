import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronLeft, SkipBack, SkipForward, Flag, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { routes } from "@/../routes";
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const StudentQuizTake = () => {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();
  const aid = Number(assignmentId);

  // Data state
  const [quiz, setQuiz] = useState<QuizAttemptResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);

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

        // If no attempt exists yet (status NOT_STARTED), start one
        if (data.status === "NOT_STARTED" || data.attempt_count === 0) {
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
  }, [aid]);

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
    if (!quiz || submitting) return;
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

      await submitQuizAttempt(aid, payload);

      // Navigate to result page
      navigate(routes.student.quizResult.replace(":assignmentId", String(aid)), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit quiz.");
      setSubmitting(false);
    }
  }, [quiz, answers, aid, navigate, submitting]);

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
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-black/50" />
      </div>
    );
  }

  if (error || !quiz || !currentQuestion) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-4">
        <AlertCircle className="w-10 h-10 text-red-500" />
        <p className="text-lg font-bold text-center">{error || "Quiz not available."}</p>
        <Button onClick={() => navigate(-1)}>Go Back</Button>
      </div>
    );
  }

  // Already submitted
  if (!quiz.can_submit && quiz.status === "SUBMITTED") {
    navigate(routes.student.quizResult.replace(":assignmentId", String(aid)), { replace: true });
    return null;
  }

  return (
    <div className="min-h-screen py-4 md:py-5 px-4 md:px-6">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate(-1)}
          className="hover:text-black/70 cursor-pointer"
          aria-label="Go back"
        >
          <ChevronLeft size={24} />
        </button>
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
          onClick={handleSubmit}
          disabled={submitting}
          className="hover:shadow-none transition-all"
        >
          {submitting ? (
            <><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Submitting...</>
          ) : (
            "Finish Quiz"
          )}
        </Button>
      </div>

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
              <button
                key={q.quiz_question_id}
                onClick={() => setCurrentIndex(i)}
                className={`size-8 border-2 border-black text-sm font-semibold transition-colors cursor-pointer relative ${
                  isCurrent
                    ? "bg-[#F6E9B2] shadow-sm"
                    : isAnswered
                      ? "bg-emerald-100"
                      : "bg-white hover:bg-black/5"
                }`}
              >
                {i + 1}
                {isFlagged && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Prev / Flag / Next controls */}
      <div className="flex items-center justify-between px-12 py-4 md:px-24">
        <button
          onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
          disabled={currentIndex === 0}
          className="flex size-9 items-center justify-center rounded-full border-2 border-black bg-white hover:bg-black/5 cursor-pointer disabled:opacity-40"
          aria-label="Previous question"
        >
          <SkipBack size={16} />
        </button>
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            onClick={() => toggleFlag(currentIndex)}
            className={`border rounded-lg flex items-center gap-2 hover:bg-gray-100 transition-all cursor-pointer ${
              flagged.has(currentIndex) ? "bg-red-50" : "bg-white"
            }`}
          >
            <Flag size={14} className={flagged.has(currentIndex) ? "fill-red-500 text-red-500" : "text-gray-400"} />
            {flagged.has(currentIndex) ? "Flagged" : "Flag Question"}
          </Button>

          <button
            onClick={() => setCurrentIndex((i) => Math.min(totalQuestions - 1, i + 1))}
            disabled={currentIndex === totalQuestions - 1}
            className="flex size-9 items-center justify-center rounded-full border-2 border-black bg-white hover:bg-black/5 cursor-pointer disabled:opacity-40"
            aria-label="Next question"
          >
            <SkipForward size={16} />
          </button>
        </div>
      </div>

      {/* Question card */}
      <div className="px-12 md:px-24">
        <Card className="bg-[#F6E9B2] flex justify-center items-center">
          <p className="text-sm text-black/50 mb-1">
            Question {currentIndex + 1} of {totalQuestions}
            {currentQuestion.points > 0 && (
              <span className="ml-2 font-semibold">
                ({currentQuestion.points} {currentQuestion.points === 1 ? "pt" : "pts"})
              </span>
            )}
          </p>
          <p className="text-center text-lg font-semibold">
            {currentQuestion.question_text}
          </p>
        </Card>
      </div>

      {/* Answer options */}
      {currentQuestion.question_type === "MULTIPLE_CHOICE" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 px-12 py-6 md:px-24">
          {currentQuestion.options
            .sort((a, b) => a.option_order - b.option_order)
            .map((opt) => {
              const selected = answers.get(currentQuestion.quiz_question_id)?.selected_option_id === opt.option_id;
              return (
                <Card
                  key={opt.option_id}
                  onClick={() => selectOption(currentQuestion.quiz_question_id, opt.option_id)}
                  className={`cursor-pointer flex items-center justify-center p-8 text-center text-lg font-semibold transition-all hover:shadow-none ${
                    selected ? "bg-[#F6E9B2] border-black" : "bg-white"
                  }`}
                >
                  {opt.option_text}
                </Card>
              );
            })}
        </div>
      ) : (
        /* SHORT_ANSWER */
        <div className="px-12 py-6 md:px-24">
          <textarea
            value={answers.get(currentQuestion.quiz_question_id)?.answer_text ?? ""}
            onChange={(e) => setAnswerText(currentQuestion.quiz_question_id, e.target.value)}
            placeholder="Type your answer here..."
            rows={4}
            className="w-full border-2 border-black p-4 text-sm focus:outline-none focus:border-[#F6E9B2] resize-none"
          />
        </div>
      )}
    </div>
  );
};

export default StudentQuizTake;
