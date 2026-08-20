import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Save, X } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { apiFetch } from "@/lib/api";
import type { TeacherQuizSubmissionDetail } from "@/pages/teacher/classworks/quiz-builder-types";

interface QuizGradingModalProps {
  submissionId: number;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type QuestionGradingStatus = "correct" | "incorrect" | "needs_grading" | "neutral";

export default function QuizGradingModal({
  submissionId,
  isOpen,
  onClose,
  onSuccess,
}: QuizGradingModalProps) {
  const [detail, setDetail] = useState<TeacherQuizSubmissionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [scores, setScores] = useState<Record<number, string>>({});
  const [feedback, setFeedback] = useState("");
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"single" | "all">("single");

  useEffect(() => {
    if (!isOpen || !submissionId) return;
    setLoading(true);
    setError("");
    setActiveQuestionIndex(0);
    setViewMode("single");
    apiFetch(`/api/v1/quizzes/submission/${submissionId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Unable to fetch submission details.");
        return res.json();
      })
      .then((data: TeacherQuizSubmissionDetail) => {
        setDetail(data);
        setFeedback(data.feedback || "");
        const initialScores: Record<number, string> = {};
        data.answers.forEach((ans) => {
          initialScores[ans.quiz_question_id] =
            ans.points_awarded !== null && ans.points_awarded !== undefined
              ? String(ans.points_awarded)
              : "";
        });
        setScores(initialScores);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load submission.");
      })
      .finally(() => setLoading(false));
  }, [isOpen, submissionId]);

  if (!isOpen) return null;

  const calculateTotal = () => {
    if (!detail) return 0;
    return detail.answers.reduce((sum, ans) => {
      const val = parseFloat(scores[ans.quiz_question_id] || "0");
      return sum + (isNaN(val) ? 0 : val);
    }, 0);
  };

  const getQuestionStatus = (quizQuestionId: number, maxPoints: number, isAutoCorrect?: boolean | null): QuestionGradingStatus => {
    const rawVal = scores[quizQuestionId];
    if (rawVal === undefined || rawVal === "") {
      return "needs_grading";
    }
    const num = parseFloat(rawVal);
    if (isNaN(num)) return "needs_grading";
    if (num >= maxPoints) return "correct";
    if (num === 0) return "incorrect";
    return "correct";
  };

  const handleScoreChange = (quizQuestionId: number, val: string) => {
    setScores((prev) => ({
      ...prev,
      [quizQuestionId]: val,
    }));
  };

  const handleSaveGrade = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!detail) return;
    setSaving(true);
    setError("");

    try {
      const answerPayload = detail.answers.map((ans) => {
        const inputVal = scores[ans.quiz_question_id];
        const numVal = parseFloat(inputVal || "0");
        const finalVal = isNaN(numVal) ? 0 : Math.min(Math.max(0, numVal), ans.max_points);
        return {
          quiz_question_id: ans.quiz_question_id,
          points_awarded: finalVal,
          is_correct: finalVal === ans.max_points ? true : finalVal === 0 ? false : null,
        };
      });

      const response = await apiFetch(`/api/v1/quizzes/submission/${submissionId}/grade`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: answerPayload,
          feedback: feedback.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Failed to save grades.");
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save grades.");
    } finally {
      setSaving(false);
    }
  };

  const renderQuestionCard = (ans: TeacherQuizSubmissionDetail["answers"][0], idx: number) => {
    const maxPts = ans.max_points;
    const currentScoreStr = scores[ans.quiz_question_id] ?? "";
    const isUngraded = ans.points_awarded === null || ans.points_awarded === undefined;
    const status = getQuestionStatus(ans.quiz_question_id, maxPts, ans.is_correct);

    return (
      <div
        key={ans.quiz_question_id}
        id={`quiz-question-card-${idx}`}
        className={`rounded-lg border-2 border-black p-5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-all ${isUngraded && currentScoreStr === "" ? "bg-[#FFD08A]/10 border-[#FFD08A]" : "bg-white"
          }`}
      >
        {/* Question Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-black/10 pb-3">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-extrabold text-black">
                Q{idx + 1}. {ans.question_text}
              </span>
              <Badge size="sm" className="border border-black bg-gray-100 text-xs font-bold text-black">
                {ans.question_type === "MULTIPLE_CHOICE" ? "Multiple Choice" : "Essay / Short Answer"}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              size="sm"
              className={`border border-black font-bold text-xs ${status === "correct"
                  ? "bg-[#8BCB88] text-black"
                  : status === "incorrect"
                    ? "bg-[#FF6B6B] text-black"
                    : "bg-[#FFD08A] text-black"
                }`}
            >
              {status === "correct" ? "Correct" : status === "incorrect" ? "Incorrect" : "Needs Grading"}
            </Badge>
            <span className="text-xs font-bold text-gray-700">
              Max: {maxPts} pts
            </span>
          </div>
        </div>

        {/* Options Comparison for Multiple Choice */}
        {ans.options && ans.options.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-bold text-gray-600 uppercase">
              Answer Choices:
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {ans.options.map((opt) => {
                const isSelected =
                  opt.option_id === ans.selected_option_id ||
                  opt.option_text === ans.answer_text;
                const isCorrect = opt.is_correct === true;

                return (
                  <div
                    key={opt.option_id}
                    className={`rounded-lg border-2 p-3 text-sm font-semibold transition-all ${isCorrect
                        ? "border-[#3A6D38] bg-[#8BCB88]/25 text-black"
                        : isSelected && !isCorrect
                          ? "border-red-500 bg-red-50 text-black"
                          : isSelected
                            ? "border-black bg-[#F6E9B2] text-black"
                            : "border-gray-200 bg-gray-50 text-gray-700"
                      }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 break-words">{opt.option_text}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        {isCorrect && (
                          <span className="rounded bg-[#8BCB88] border border-black px-1.5 py-0.5 text-[10px] font-black text-black">
                            Correct Key
                          </span>
                        )}
                        {isSelected && (
                          <span className="rounded bg-black px-1.5 py-0.5 text-[10px] font-bold text-white">
                            Student Answer
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Student's Response Text & Answer Key for Short Answer / Identification */}
        {ans.question_type !== "MULTIPLE_CHOICE" && (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border-2 border-black bg-gray-50 p-4">
              <p className="text-xs font-bold text-gray-600 uppercase mb-1">
                Student's Written Response:
              </p>
              <p className="text-sm font-semibold text-black whitespace-pre-wrap">
                {ans.answer_text ? (
                  ans.answer_text
                ) : (
                  <span className="italic text-gray-500">No response provided</span>
                )}
              </p>
            </div>

            {ans.options && ans.options.length > 0 && (
              <div className="rounded-lg border-2 border-[#3A6D38] bg-[#8BCB88]/20 p-3">
                <p className="text-xs font-bold uppercase text-[#1d461c] mb-1.5 flex items-center gap-1">
                  <span>✓ Expected Answer Key / Acceptable Spellings:</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {ans.options.map((opt) => (
                    <span
                      key={opt.option_id}
                      className="rounded bg-white border border-black px-2 py-1 text-xs font-black text-black shadow-xs"
                    >
                      {opt.option_text}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Score Controls */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t-2 border-black/10 pt-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase text-gray-600">Quick Score:</span>
            <button
              type="button"
              onClick={() => handleScoreChange(ans.quiz_question_id, "0")}
              className="rounded border border-black bg-white px-2 py-1 text-xs font-bold hover:bg-gray-100"
            >
              0 pts
            </button>
            {maxPts > 1 && (
              <button
                type="button"
                onClick={() => handleScoreChange(ans.quiz_question_id, String(maxPts / 2))}
                className="rounded border border-black bg-white px-2 py-1 text-xs font-bold hover:bg-gray-100"
              >
                Half ({maxPts / 2} pts)
              </button>
            )}
            <button
              type="button"
              onClick={() => handleScoreChange(ans.quiz_question_id, String(maxPts))}
              className="rounded border border-black bg-[#8BCB88] px-2 py-1 text-xs font-bold hover:bg-[#7aba78]"
            >
              Full ({maxPts} pts)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm font-bold text-black">
              Award Score:
            </label>
            <input
              type="number"
              step="0.5"
              min="0"
              max={maxPts}
              value={currentScoreStr}
              onChange={(e) => handleScoreChange(ans.quiz_question_id, e.target.value)}
              placeholder="0"
              className="w-24 rounded border-2 border-black px-3 py-1.5 text-sm font-bold text-black focus:outline-none focus:ring-2 focus:ring-black"
            />
            <span className="text-sm font-bold text-gray-700">/ {maxPts} pts</span>
          </div>
        </div>
      </div>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <Card className="block max-h-[92vh] w-full max-w-4xl overflow-hidden bg-white shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-black bg-[#F6E9B2] px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-black">
              Grade Quiz Answers: {detail?.student_name || "Student"}
            </h2>
            <p className="text-xs font-semibold text-gray-700">
              Review responses, inspect auto-graded answers, and manually score subjective items.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-black font-bold hover:bg-black/10"
            aria-label="Close grading modal"
          >
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm font-semibold text-gray-600">
            Loading student submission answers...
          </div>
        ) : error ? (
          <div className="p-6">
            <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {error}
            </div>
            <div className="mt-4 flex justify-end">
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : detail ? (
          <form onSubmit={handleSaveGrade} className="flex flex-col max-h-[calc(92vh-80px)]">
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Submission Summary Banner */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-black bg-[#F8F6ED] p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <div>
                  <p className="text-xs font-bold text-gray-600 uppercase">Student Name</p>
                  <p className="text-lg font-extrabold text-black">{detail.student_name}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-600 uppercase">Status</p>
                  <Badge
                    size="sm"
                    className={`border border-black font-bold ${detail.needs_grading
                        ? "bg-amber-200 text-black"
                        : "bg-[#7ABA78] text-black"
                      }`}
                  >
                    {detail.needs_grading ? "Needs Grading" : detail.status.toUpperCase()}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-600 uppercase">Total Score</p>
                  <p className="text-lg font-black text-black">
                    {calculateTotal()} / {detail.total_points} pts
                  </p>
                </div>
                {/* View Mode Toggle */}
                <div className="flex items-center gap-1 rounded-lg border-2 border-black bg-white p-1">
                  <button
                    type="button"
                    onClick={() => setViewMode("single")}
                    className={`rounded px-3 py-1 text-xs font-bold transition-all ${viewMode === "single"
                        ? "bg-[#7ABA78] text-black shadow-sm"
                        : "text-gray-600 hover:text-black"
                      }`}
                  >
                    Single Question
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("all")}
                    className={`rounded px-3 py-1 text-xs font-bold transition-all ${viewMode === "all"
                        ? "bg-[#7ABA78] text-black shadow-sm"
                        : "text-gray-600 hover:text-black"
                      }`}
                  >
                    View All ({detail.answers.length})
                  </button>
                </div>
              </div>

              {/* Question Navigation Chips */}
              <div className="rounded-lg border-2 border-black bg-white p-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold uppercase text-gray-700">
                    Question Navigator ({detail.answers.length} Questions)
                  </span>
                  <div className="flex items-center gap-3 text-[11px] font-bold text-gray-600">
                    <span className="flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#8BCB88] border border-black" /> Correct
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#FF6B6B] border border-black" /> Incorrect
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#FFD08A] border border-black" /> Needs Grading
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {detail.answers.map((ans, idx) => {
                    const status = getQuestionStatus(ans.quiz_question_id, ans.max_points, ans.is_correct);
                    const isActive = activeQuestionIndex === idx;

                    return (
                      <button
                        key={ans.quiz_question_id}
                        type="button"
                        onClick={() => {
                          setActiveQuestionIndex(idx);
                          if (viewMode === "all") {
                            const el = document.getElementById(`quiz-question-card-${idx}`);
                            el?.scrollIntoView({ behavior: "smooth", block: "center" });
                          }
                        }}
                        className={`relative flex h-8 min-w-8 items-center justify-center rounded border-2 px-2 text-xs font-black transition-all ${status === "correct"
                            ? "bg-[#8BCB88] text-black border-black"
                            : status === "incorrect"
                              ? "bg-[#FF6B6B] text-black border-black"
                              : "bg-[#FFD08A] text-black border-black"
                          } ${isActive
                            ? "ring-2 ring-black ring-offset-2 scale-110 z-10 shadow-md"
                            : "opacity-90 hover:opacity-100"
                          }`}
                        title={`Q${idx + 1}: ${status.replace("_", " ")}`}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Question View Mode Container */}
              {viewMode === "single" ? (
                <div className="space-y-4">
                  {/* Previous / Next Bar */}
                  <div className="flex items-center justify-between">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveQuestionIndex((prev) => Math.max(0, prev - 1))}
                      disabled={activeQuestionIndex === 0}
                      className="gap-1 border-2 border-black font-bold disabled:opacity-40"
                    >
                      <ChevronLeft size={16} />
                      Previous Question
                    </Button>
                    <span className="text-sm font-extrabold text-black">
                      Question {activeQuestionIndex + 1} of {detail.answers.length}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveQuestionIndex((prev) => Math.min(detail.answers.length - 1, prev + 1))}
                      disabled={activeQuestionIndex === detail.answers.length - 1}
                      className="gap-1 border-2 border-black font-bold disabled:opacity-40"
                    >
                      Next Question
                      <ChevronRight size={16} />
                    </Button>
                  </div>

                  {/* Active Question Card */}
                  {detail.answers[activeQuestionIndex] &&
                    renderQuestionCard(detail.answers[activeQuestionIndex], activeQuestionIndex)}
                </div>
              ) : (
                /* View All Mode */
                <div className="space-y-4">
                  {detail.answers.map((ans, idx) => renderQuestionCard(ans, idx))}
                </div>
              )}

              {/* Overall Feedback Box */}
              <div className="rounded-lg border-2 border-black bg-white p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <label className="text-xs font-bold uppercase text-gray-700 block mb-1">
                  Teacher Feedback / Notes for Student (Optional)
                </label>
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows={2}
                  placeholder="Add feedback on this attempt..."
                  className="w-full rounded border-2 border-black px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-black"
                />
              </div>
            </div>

            {/* Sticky Footer */}
            <div className="flex items-center justify-between border-t-2 border-black bg-gray-100 px-6 py-4">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={saving}
                className="border-2 border-black font-bold"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="default"
                disabled={saving}
                className="gap-2 border-2 border-black bg-[#7ABA78] font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-[#68a966]"
              >
                <Save size={16} />
                {saving ? "Saving Grade..." : `Save Grade (${calculateTotal()} pts)`}
              </Button>
            </div>
          </form>
        ) : null}
      </Card>
    </div>,
    document.body
  );
}
