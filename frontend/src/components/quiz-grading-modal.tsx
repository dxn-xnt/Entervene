import { useEffect, useState } from "react";
import { Save, X } from "lucide-react";
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

  useEffect(() => {
    if (!isOpen || !submissionId) return;
    setLoading(true);
    setError("");
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

  const handleScoreChange = (quizQuestionId: number, val: string) => {
    setScores((prev) => ({
      ...prev,
      [quizQuestionId]: val,
    }));
  };

  const handleSaveGrade = async (e: React.FormEvent) => {
    e.preventDefault();
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="block max-h-[90vh] w-full max-w-3xl overflow-hidden bg-white shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black bg-[#F6E9B2] px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-black">
              Grade Quiz Answers: {detail?.student_name || "Student"}
            </h2>
            <p className="text-xs font-semibold text-gray-700">
              Review responses and manually assign scores (e.g. for essays or short answers)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-black font-bold hover:bg-black/10"
          >
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm font-semibold text-gray-600">
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
          <form onSubmit={handleSaveGrade} className="flex flex-col max-h-[calc(90vh-80px)]">
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Submission Summary Banner */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-black bg-[#F8F6ED] p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <div>
                  <p className="text-xs font-bold text-gray-600 uppercase">Student Name</p>
                  <p className="text-lg font-bold text-black">{detail.student_name}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-600 uppercase">Status</p>
                  <Badge
                    size="sm"
                    className={`border border-black font-bold ${
                      detail.needs_grading
                        ? "bg-amber-200 text-black"
                        : "bg-[#7ABA78] text-black"
                    }`}
                  >
                    {detail.needs_grading ? "Needs Grading" : detail.status.toUpperCase()}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-600 uppercase">Total Score</p>
                  <p className="text-lg font-extrabold text-black">
                    {calculateTotal()} / {detail.total_points} pts
                  </p>
                </div>
              </div>

              {/* Questions List */}
              <div className="space-y-4">
                {detail.answers.map((ans, idx) => {
                  const maxPts = ans.max_points;
                  const currentScoreStr = scores[ans.quiz_question_id] ?? "";
                  const isUngraded = ans.points_awarded === null || ans.points_awarded === undefined;

                  return (
                    <div
                      key={ans.quiz_question_id}
                      className={`rounded-lg border-2 border-black p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] ${
                        isUngraded ? "bg-amber-50/60" : "bg-white"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-black text-base">
                              Q{idx + 1}. {ans.question_text}
                            </span>
                            <Badge size="sm" className="border border-black bg-gray-100 text-xs font-bold text-black">
                              {ans.question_type === "MULTIPLE_CHOICE" ? "Multiple Choice" : "Essay / Short Answer"}
                            </Badge>
                          </div>
                        </div>
                        <span className="text-xs font-bold text-gray-700">
                          Max: {maxPts} pts
                        </span>
                      </div>

                      {/* Student's Answer */}
                      <div className="mt-3 rounded border border-black bg-gray-50 p-3">
                        <p className="text-xs font-bold text-gray-600 uppercase mb-1">
                          Student's Response:
                        </p>
                        <p className="text-sm font-semibold text-black whitespace-pre-wrap">
                          {ans.answer_text ? (
                            ans.answer_text
                          ) : (
                            <span className="italic text-gray-500">No response provided</span>
                          )}
                        </p>
                      </div>

                      {/* Score Input */}
                      <div className="mt-3 flex items-center justify-between gap-4 border-t border-gray-200 pt-3">
                        <label className="text-sm font-bold text-black flex items-center gap-2">
                          Award Score:
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max={maxPts}
                            value={currentScoreStr}
                            onChange={(e) => handleScoreChange(ans.quiz_question_id, e.target.value)}
                            placeholder="0"
                            className="w-24 rounded border-2 border-black px-3 py-1 text-sm font-bold text-black focus:outline-none focus:ring-2 focus:ring-black"
                          />
                          <span className="text-sm font-bold text-gray-700">/ {maxPts} pts</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Overall Feedback */}
              <div className="space-y-1 pt-2">
                <label className="text-sm font-bold text-black block">Teacher Feedback (Optional)</label>
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows={2}
                  placeholder="Provide comments or notes for the student..."
                  className="w-full rounded border-2 border-black px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-black"
                />
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-between border-t border-black bg-gray-100 px-6 py-4">
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
    </div>
  );
}
