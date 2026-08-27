import React, { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Save, X } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import { apiFetch } from "@/lib/api";
import type { TeacherQuizSubmissionDetail } from "@/pages/teacher/classworks/quiz-builder-types";
import { Card } from "./retroui/Card";

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

  const calculateTotal = () => {
    if (!detail) return 0;
    return detail.answers.reduce((sum, ans) => {
      const val = parseFloat(scores[ans.quiz_question_id] || "0");
      return sum + (isNaN(val) ? 0 : val);
    }, 0);
  };

  const getQuestionStatus = (quizQuestionId: number, maxPoints: number, _isAutoCorrect?: boolean | null): QuestionGradingStatus => {
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
    const qType = (ans.question_type || "").toLowerCase();
    const studentAnswerText = ans.student_answer_text ?? ans.answer_text ?? "";
    const correctAnswerText =
      ans.correct_answer_text ??
      ans.options?.filter((opt) => opt.is_correct).map((opt) => opt.option_text).join(" / ") ??
      "";

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
              <span className="rounded border border-black bg-gray-100 px-2 py-0.5 text-xs font-bold capitalize text-gray-700">
                {ans.question_type.replace("_", " ")}
              </span>
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
            <span className="text-xs font-bold text-gray-600">Max: {maxPts} pts</span>
          </div>
        </div>

        {/* Answer Options / Responses Breakdown */}
        <div className="mt-4 space-y-3">
          {(qType === "multiple_choice" || qType === "multiplechoice") && ans.options && (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase text-gray-600">Answer Choices:</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {ans.options.map((opt) => {
                  const isSelected =
                    opt.option_id === ans.selected_option_id ||
                    (studentAnswerText && opt.option_text === studentAnswerText);
                  const isCorrect = opt.is_correct;

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
                        <span>{opt.option_text}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isCorrect && (
                            <span className="rounded bg-[#8BCB88] px-1.5 py-0.5 text-[10px] font-black uppercase text-black">
                              Correct Key
                            </span>
                          )}
                          {isSelected && (
                            <span className="rounded bg-black px-1.5 py-0.5 text-[10px] font-black uppercase text-white">
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

          {qType === "true_false" && (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase text-gray-600">Student Response:</p>
              <div className="flex flex-wrap items-center gap-3">
                <div
                  className={`rounded-lg border-2 px-4 py-2 text-sm font-bold ${studentAnswerText.toLowerCase() === "true"
                    ? "border-black bg-[#F6E9B2] text-black"
                    : "border-gray-200 bg-gray-50 text-gray-400"
                    }`}
                >
                  True {studentAnswerText.toLowerCase() === "true" && "(Student Selected)"}
                </div>
                <div
                  className={`rounded-lg border-2 px-4 py-2 text-sm font-bold ${studentAnswerText.toLowerCase() === "false"
                    ? "border-black bg-[#F6E9B2] text-black"
                    : "border-gray-200 bg-gray-50 text-gray-400"
                    }`}
                >
                  False {studentAnswerText.toLowerCase() === "false" && "(Student Selected)"}
                </div>
                {correctAnswerText && (
                  <span className="text-xs font-bold text-gray-600">
                    Correct Key: <span className="font-extrabold text-black uppercase">{correctAnswerText}</span>
                  </span>
                )}
              </div>
            </div>
          )}

          {(qType === "identification" || qType === "fill_in_the_blank") && (
            <div className="space-y-2">
              <div className="rounded-lg border-2 border-black bg-gray-50 p-3">
                <p className="text-xs font-bold uppercase text-gray-600">Student Written Answer:</p>
                <p className="mt-1 text-sm font-bold text-black">
                  {studentAnswerText || <span className="italic text-gray-400 font-normal">No answer submitted</span>}
                </p>
              </div>
              {correctAnswerText && (
                <div className="rounded-lg border-2 border-dashed border-[#8BCB88] bg-[#8BCB88]/10 p-3">
                  <p className="text-xs font-bold uppercase text-[#3A6D38]">Expected Key Answer:</p>
                  <p className="mt-1 text-sm font-bold text-black">{correctAnswerText}</p>
                </div>
              )}
            </div>
          )}

          {(qType === "essay" || qType === "short_answer" || qType === "shortanswer") && (
            <div className="space-y-2">
              <div className="rounded-lg border-2 border-black bg-gray-50 p-4">
                <p className="text-xs font-bold uppercase text-gray-600">Student Response:</p>
                <p className="mt-2 whitespace-pre-wrap text-sm font-medium text-black">
                  {studentAnswerText || <span className="italic text-gray-400">No response written</span>}
                </p>
              </div>
              {correctAnswerText && (
                <div className="rounded-lg border-2 border-dashed border-[#8BCB88] bg-[#8BCB88]/10 p-3">
                  <p className="text-xs font-bold uppercase text-[#3A6D38]">Expected Key / Reference Answer:</p>
                  <p className="mt-1 text-sm font-bold text-black">{correctAnswerText}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Manual Scoring Control */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t-2 border-black/10 pt-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase text-gray-700">Quick Score:</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleScoreChange(ans.quiz_question_id, String(maxPts))}
              className="border-2 border-black bg-[#8BCB88] px-2.5 py-1 text-xs font-bold text-black hover:bg-[#7ABA78]"
            >
              Full ({maxPts} pts)
            </Button>
            {maxPts > 1 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleScoreChange(ans.quiz_question_id, String(Math.round(maxPts / 2)))}
                className="border-2 border-black bg-[#FFD08A] px-2.5 py-1 text-xs font-bold text-black hover:bg-amber-300"
              >
                Half ({Math.round(maxPts / 2)} pts)
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleScoreChange(ans.quiz_question_id, "0")}
              className="border-2 border-black bg-[#FF6B6B] px-2.5 py-1 text-xs font-bold text-black hover:bg-red-400"
            >
              Zero (0 pts)
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor={`score-input-${ans.quiz_question_id}`} className="text-xs font-bold text-gray-700 uppercase">
              Awarded Points:
            </label>
            <input
              id={`score-input-${ans.quiz_question_id}`}
              type="number"
              min="0"
              max={maxPts}
              step="0.5"
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

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !saving) {
          onClose();
        }
      }}
    >
      <Dialog.Content size="3xl" className="max-h-[92vh] flex flex-col border-2 border-black">
        {/* Header */}
        <Dialog.Header position="fixed" asChild>
          <div className="flex items-center justify-between w-full py-4 px-2">
            <div>
              <h2 className="text-xl font-bold text-black">
                Grade Quiz Answers: {detail?.student_name || "Student"}
              </h2>
              <p className="text-xs font-normal">
                Review responses, inspect auto-graded answers, and manually score subjective items.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded p-1 text-black font-bold hover:bg-black/10 cursor-pointer"
              aria-label="Close grading modal"
            >
              <X size={20} />
            </button>
          </div>
        </Dialog.Header>

        {loading ? (
          <div className="text-center text-sm font-semibold text-gray-600 flex-1">
            Loading student submission answers...
          </div>
        ) : error ? (
          <div className="p-6 flex-1">
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
          <form onSubmit={handleSaveGrade} className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Submission Summary Banner */}
              <Card className="font-sans flex flex-wrap items-center justify-between shadow-none">
                <div>
                  <p className="text-sm text-semibold">Student Name</p>
                  <p className="text-lg font-extrabold text-black">{detail.student_name}</p>
                </div>
                <div>
                  <p className="text-sm text-semibold">Status</p>
                  <Badge
                    size="sm"
                    variant={detail.needs_grading ? "secondary" : "surface"}
                  >
                    {detail.needs_grading ? "Needs Grading" : detail.status.toUpperCase()}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-semibold">Total Score</p>
                  <p className="text-lg font-black text-black">
                    {calculateTotal()} / {detail.total_points} pts
                  </p>
                </div>
                {/* View Mode Toggle */}
                <div className="flex items-center gap-1  border-2 border-black bg-white p-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={viewMode === "single" ? "default" : "ghost"}
                    onClick={() => setViewMode("single")}
                    className="shadow-none hover:translate-y-0"
                  >
                    Single Question
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={viewMode === "all" ? "default" : "ghost"}
                    onClick={() => setViewMode("all")}
                    className="shadow-none hover:translate-y-0"
                  >
                    View All ({detail.answers.length})
                  </Button>
                </div>
              </Card>

              {/* Question Navigation Chips */}
              <Card className="shadow-none w-full">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold uppercase text-gray-700">
                    Question Navigator ({detail.answers.length} Questions)
                  </span>
                  <div className="flex items-center gap-3 text-[11px] font-bold text-gray-600">
                    <span className="flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-full bg-primary border border-black" /> Correct
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-full bg-destructive border border-black" /> Incorrect
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-full bg-muted border border-black" /> Needs Grading
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
                        className={`relative flex h-8 min-w-8 items-center justify-center rounded border-2 px-2 text-xs font-black transition-all cursor-pointer ${status === "correct"
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
              </Card>

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

            {/* Dialog Footer */}
            <Dialog.Footer position="fixed">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="default"
                disabled={saving}
                className="gap-2 border-black bg-[#7ABA78] font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-[#68a966]"
              >
                <Save size={16} />
                {saving ? "Saving Grade..." : `Save Grade (${calculateTotal()} pts)`}
              </Button>
            </Dialog.Footer>
          </form>
        ) : null}
      </Dialog.Content>
    </Dialog>
  );
}
