import React, { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Save, X } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { useToast } from "@/components/retroui/Toast";
import { Dialog } from "@/components/retroui/Dialog";
import { apiFetch } from "@/lib/api";
import type { TeacherQuizSubmissionDetail } from "@/pages/teacher/classworks/quiz-builder-types";
import { Card } from "./retroui/Card";
import { SegmentedControl } from "@/components/retroui/SegmentedControl";
import { formatDate, formatToTitleCase } from "@/lib/formatters";
import { Avatar } from "@/components/retroui/Avatar";

interface QuizGradingModalProps {
  submissionId: number;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type QuestionGradingStatus = "correct" | "incorrect" | "needs_grading" | "neutral";

function formatQuestionType(type?: string): string {
  if (!type) return "";
  return type
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default function QuizGradingModal({
  submissionId,
  isOpen,
  onClose,
  onSuccess,
}: QuizGradingModalProps) {
  const toast = useToast();
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

      toast.success({ title: "Quiz grades saved" });
      onSuccess();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save grades.";
      setError(message);
      toast.error({ title: "Unable to save quiz grades", description: message });
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
      <Card
        key={ans.quiz_question_id}
        id={`quiz-question-card-${idx}`}
        className={`block w-full p-5 ${isUngraded && currentScoreStr === "" ? "bg-[#FFD08A]/10 border-[#FFD08A]" : "bg-card"
          }`}
      >
        {/* Question Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-extrabold text-black">
                Q{idx + 1}. {ans.question_text}
              </span>
              <Badge variant="solid" size="sm">
                {formatQuestionType(ans.question_type)}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge size="sm" variant={status === "correct" ? "success" : status === "incorrect" ? "destructive" : "secondary"}>
              {status === "correct" ? "Correct" : status === "incorrect" ? "Incorrect" : "Needs Grading"}
            </Badge>

            <Badge size="sm" variant="secondary" className="font-medium!">
              Max: <span className="text-xs font-bold text-black ml-1">{maxPts} pts</span>
            </Badge>
          </div>
        </div>

        {/* Answer Options / Responses Breakdown */}
        <div className="mt-4 space-y-3">
          {(qType === "multiple_choice" || qType === "multiplechoice") && ans.options && (
            <div className="space-y-2">
              <div className="flex flex-col gap-2">
                {ans.options.map((opt) => {
                  const isSelected =
                    opt.option_id === ans.selected_option_id ||
                    (studentAnswerText && opt.option_text === studentAnswerText);
                  const isCorrect = opt.is_correct;

                  return (
                    <Card
                      key={opt.option_id}
                      className={`rounded border-2! p-3 text-sm font-semibold transition-all ${isCorrect
                        ? "border-success/100! bg-success/40 text-black"
                        : isSelected && !isCorrect
                          ? "border-destructive bg-destructive/40 text-black"
                          : isSelected
                            ? "border-black bg-[#F6E9B2] text-black"
                            : "border-muted-border text-gray-700"
                        }`}
                    >
                      <div className="flex items-start justify-between gap-2 min-w-0">
                        <span className="min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere] leading-snug">
                          {opt.option_text}
                        </span>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {qType === "true_false" && (
            <div className="space-y-2">
              <p className="text-xs font-bold    text-gray-600">Student Response:</p>
              <div className="flex flex-wrap items-center gap-3">
                <div
                  className={`rounded border-2 px-4 py-2 text-sm font-bold ${studentAnswerText.toLowerCase() === "true"
                    ? "border-black bg-[#F6E9B2] text-black"
                    : "border-gray-200 bg-gray-50 text-gray-400"
                    }`}
                >
                  True {studentAnswerText.toLowerCase() === "true" && "(Student Selected)"}
                </div>
                <div
                  className={`rounded border-2 px-4 py-2 text-sm font-bold ${studentAnswerText.toLowerCase() === "false"
                    ? "border-black bg-[#F6E9B2] text-black"
                    : "border-gray-200 bg-gray-50 text-gray-400"
                    }`}
                >
                  False {studentAnswerText.toLowerCase() === "false" && "(Student Selected)"}
                </div>
                {correctAnswerText && (
                  <span className="text-xs font-bold text-gray-600">
                    Correct Key: <span className="font-extrabold text-black   ">{correctAnswerText}</span>
                  </span>
                )}
              </div>
            </div>
          )}

          {(qType === "identification" || qType === "fill_in_the_blank") && (
            <div className="space-y-2">
              <div className="rounded border-2 border-black bg-gray-50 p-3">
                <p className="text-xs font-bold    text-gray-600">Student Written Answer:</p>
                <p className="mt-1 text-sm font-bold text-black">
                  {studentAnswerText || <span className="italic text-gray-400 font-normal">No answer submitted</span>}
                </p>
              </div>
              {correctAnswerText && (
                <div className="rounded border-2 border-dashed border-[#8BCB88] bg-[#8BCB88]/10 p-3">
                  <p className="text-xs font-bold    text-[#3A6D38]">Expected Key Answer:</p>
                  <p className="mt-1 text-sm font-bold text-black">{correctAnswerText}</p>
                </div>
              )}
            </div>
          )}

          {(qType === "essay" || qType === "short_answer" || qType === "shortanswer") && (
            <div className="space-y-2">
              <div className="rounded border-2 border-black bg-gray-50 p-4">
                <p className="text-xs font-bold    text-gray-600">Student Response:</p>
                <p className="mt-2 whitespace-pre-wrap text-sm font-medium text-black">
                  {studentAnswerText || <span className="italic text-gray-400">No response written</span>}
                </p>
              </div>
              {correctAnswerText && (
                <div className="rounded border-2 border-dashed border-[#8BCB88] bg-[#8BCB88]/10 p-3">
                  <p className="text-xs font-bold    text-[#3A6D38]">Expected Key / Reference Answer:</p>
                  <p className="mt-1 text-sm font-bold text-black">{correctAnswerText}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Manual Scoring Control */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-700">Quick Score:</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              autoIcon={false}
              onClick={() => handleScoreChange(ans.quiz_question_id, String(maxPts))}
              className="bg-success/80 px-2.5 py-1 text-xs text-black hover:bg-success"
            >
              Full <span className="font-bold ml-1">({maxPts} pts)</span>
            </Button>
            {maxPts > 1 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                autoIcon={false}
                onClick={() => handleScoreChange(ans.quiz_question_id, String(Math.round(maxPts / 2)))}
                className="bg-primary/80 px-2.5 py-1 text-xs text-black hover:bg-primary"
              >
                Half <span className="font-bold ml-1">({Math.round(maxPts / 2)} pts)</span>
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              autoIcon={false}
              onClick={() => handleScoreChange(ans.quiz_question_id, "0")}
              className="bg-destructive/70 px-2.5 py-1 text-xs text-black hover:bg-destructive/80"
            >
              Zero <span className="font-bold ml-1">(0 pts)</span>
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor={`score-input-${ans.quiz_question_id}`} className="text-xs font-bold text-gray-700   ">
              Points:
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
              className="w-24 rounded! border-2 border-black px-3 py-1.5 text-sm font-bold text-black focus:outline-none focus:ring-2 focus:ring-black"
            />
            <span className="text-sm font-bold text-gray-700">/ {maxPts} pts</span>
          </div>
        </div>
      </Card>
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
          <div className="flex w-full items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-black">
                Grade Quiz Answers: {detail?.student_name || "Student"}
              </h2>
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
            <div className="rounded border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-700">
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
              <Card className="font-sans bg-primary flex flex-wrap items-center justify-between shadow-none">
                <div className="flex items-center gap-3">
                  <Avatar variant="student" className="size-10 shrink-0">
                    <Avatar.Image
                      src={detail.avatar || "/avatars/student-avatars/1.svg"}
                      alt={detail.student_name}
                    />
                    <Avatar.Fallback>
                      {detail.student_name.slice(0, 1).toUpperCase()}
                    </Avatar.Fallback>
                  </Avatar>
                  <div className="flex flex-col">
                    <p className="text-lg font-extrabold text-black">{detail.student_name}</p>
                    {detail.submitted_at && (
                      <p className="text-xs font-normal text-foreground">
                        Submitted on {formatDate(detail.submitted_at)}
                      </p>
                    )}
                  </div>
                </div>
                <div>
                  <Badge
                    size="sm"
                    className="text-sm"
                    variant={detail.needs_grading ? "default" : "solid"}
                  >
                    {detail.needs_grading ? "Needs Grading" : formatToTitleCase(detail.status)}
                  </Badge>
                </div>
                <div>
                  <Badge size="sm" variant="outline" className="text-sm font-bold">
                    {calculateTotal()} pts
                  </Badge>
                </div>

              </Card>

              {/* Question Navigation Chips */}
              <Card className="p-0 border-none shadow-none w-full px-2">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap w-full items-center gap-3 justify-between">
                    <span className="text-xl font-extrabold text-foreground">
                      Question Navigator
                    </span>
                    {/* View Mode Toggle */}
                    <SegmentedControl
                      size="sm"
                      value={viewMode}
                      onValueChange={(val) => setViewMode(val as "single" | "all")}
                    >
                      <SegmentedControl.Item value="single">
                        Single Question
                      </SegmentedControl.Item>
                      <SegmentedControl.Item value="all">
                        View All ({detail.answers.length})
                      </SegmentedControl.Item>
                    </SegmentedControl>
                  </div>
                </div>

                <div
                  data-testid="question-navigator-grid"
                  className="pl-1 flex flex-wrap gap-2 max-h-36 sm:max-h-40 overflow-y-auto py-1 pr-1"
                >
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
                        className={`relative flex h-8 min-w-8 items-center rounded! justify-center rounded border-2 border-black px-2 text-xs font-black transition cursor-pointer hover:translate-y-1 active:translate-y-2 ${isActive
                          ? "bg-primary text-black z-10"
                          : status === "correct"
                            ? "bg-success/40 text-black opacity-90 hover:opacity-100"
                            : status === "incorrect"
                              ? "bg-destructive/40 text-black opacity-90 hover:opacity-100"
                              : "bg-primary/40 text-black opacity-90 hover:opacity-100"
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
                  <div className="flex items-center justify-between px-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveQuestionIndex((prev) => Math.max(0, prev - 1))}
                      disabled={activeQuestionIndex === 0}
                      className="gap-1 border-2 border-black font-bold disabled:opacity-40 pl-2"
                    >
                      <ChevronLeft size={16} />
                      Previous Question
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveQuestionIndex((prev) => Math.min(detail.answers.length - 1, prev + 1))}
                      disabled={activeQuestionIndex === detail.answers.length - 1}
                      className="gap-1 border-2 border-black font-bold disabled:opacity-40 pr-2"
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
              <Card className="block w-full p-0 border-none px-1">
                <label className="text-sm font-semibold text-foreground block mb-1">
                  Teacher Feedback
                  <span className="text-xs font-normal text-gray-500 ml-1 pb-1">(Optional)</span>
                </label>
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows={2}
                  placeholder="Add feedback on this attempt..."
                  className="w-full rounded! border-2 border-black px-3 py-2 text-sm focus:outline-none"
                />
              </Card>
            </div>

            {/* Dialog Footer */}
            <Dialog.Footer position="fixed">
              <Button
                type="button"
                size="header"
                variant="outline"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="header"
                variant="default"
                disabled={saving}
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
