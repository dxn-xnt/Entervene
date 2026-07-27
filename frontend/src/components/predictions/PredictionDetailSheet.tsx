import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Select } from "@/components/retroui/Select";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Lightbulb,
  Loader2,
  MessageSquare,
  Minus,
  Send,
  Sparkles,
} from "lucide-react";
import type { PredictionDetail, TeacherReview } from "@/lib/prediction-api";
import {
  fetchPredictionDetail,
  submitTeacherReview,
} from "@/lib/prediction-api";

interface PredictionDetailSheetProps {
  predictionId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const RISK_BADGE_STYLES: Record<string, string> = {
  HIGH_RISK: "bg-red-500 text-white",
  MODERATE_RISK: "bg-amber-500 text-white",
  NEEDS_MONITORING: "bg-yellow-400 text-gray-900",
  LOW_RISK: "bg-emerald-500 text-white",
  INSUFFICIENT_DATA: "bg-gray-400 text-white",
};

const RISK_LABELS: Record<string, string> = {
  HIGH_RISK: "High Risk",
  MODERATE_RISK: "Moderate",
  NEEDS_MONITORING: "Monitoring",
  LOW_RISK: "Low Risk",
  INSUFFICIENT_DATA: "No Data",
};

const SEVERITY_COLORS: Record<string, string> = {
  HIGH: "text-red-600",
  MODERATE: "text-amber-600",
  LOW: "text-gray-500",
};

const DIRECTION_ICONS: Record<string, typeof ArrowUp> = {
  INCREASES_RISK: ArrowUp,
  DECREASES_RISK: ArrowDown,
  NEUTRAL: Minus,
};

const DECISION_OPTIONS = [
  { value: "CONFIRMED_RISK", label: "Confirm Risk" },
  { value: "DISMISSED_RISK", label: "Dismiss Risk" },
  { value: "NEEDS_MORE_DATA", label: "Needs More Data" },
  { value: "INTERVENTION_ASSIGNED", label: "Intervention Assigned" },
  { value: "ESCALATED", label: "Escalated" },
];

const DECISION_LABELS: Record<string, string> = {
  CONFIRMED_RISK: "Confirmed Risk",
  DISMISSED_RISK: "Dismissed Risk",
  NEEDS_MORE_DATA: "Needs More Data",
  INTERVENTION_ASSIGNED: "Intervention Assigned",
  ESCALATED: "Escalated",
};

export default function PredictionDetailSheet({
  predictionId,
  open,
  onOpenChange,
}: PredictionDetailSheetProps) {
  const [detail, setDetail] = useState<PredictionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [reviewDecision, setReviewDecision] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reviewSuccess, setReviewSuccess] = useState(false);

  useEffect(() => {
    if (!predictionId || !open) return;
    setLoading(true);
    setReviewSuccess(false);
    fetchPredictionDetail(predictionId)
      .then(setDetail)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [predictionId, open]);

  const handleSubmitReview = async () => {
    if (!predictionId || !reviewDecision) return;
    setSubmitting(true);
    try {
      const review = await submitTeacherReview(predictionId, {
        decision: reviewDecision,
        teacher_notes: reviewNotes.trim() || undefined,
      });
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              teacher_reviews: [review, ...prev.teacher_reviews],
              current_user_review: review,
            }
          : prev
      );
      setReviewSuccess(true);
      setReviewDecision("");
      setReviewNotes("");
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-lg">Prediction Detail</SheetTitle>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-gray-400" size={28} />
          </div>
        ) : detail ? (
          <div className="flex flex-col gap-5 pb-6">
            {/* ── Summary ── */}
            <div className="rounded-lg border border-gray-200 p-4 bg-gray-50/50">
              <div className="flex items-center justify-between mb-3">
                <Badge
                  size="sm"
                  className={`${RISK_BADGE_STYLES[detail.risk_level] ?? "bg-gray-300"} rounded-full px-3 py-1 text-xs font-medium`}
                >
                  {RISK_LABELS[detail.risk_level] ?? detail.risk_level}
                </Badge>
                <span className="text-xs text-gray-400">
                  #{detail.prediction_id}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-gray-500">Predicted Grade</p>
                  <p className="text-xl font-bold text-gray-900">
                    {detail.predicted_period_grade?.toFixed(2) ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Risk Score</p>
                  <p className="text-xl font-bold text-gray-900">
                    {detail.risk_score?.toFixed(1) ?? "—"}
                  </p>
                </div>
              </div>
              {detail.generated_at && (
                <p className="text-xs text-gray-400 mt-2">
                  Generated{" "}
                  {new Date(detail.generated_at).toLocaleDateString("en-PH", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              )}
            </div>

            {/* ── Causes ── */}
            {detail.causes.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                  <AlertTriangle size={16} className="text-amber-500" />
                  Risk Causes
                </h3>
                <div className="flex flex-col gap-2">
                  {detail.causes.map((cause) => (
                    <div
                      key={cause.code}
                      className="rounded-md border border-gray-100 bg-white px-3 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-800">
                          {cause.label}
                        </span>
                        <span
                          className={`text-xs font-semibold ${SEVERITY_COLORS[cause.severity] ?? "text-gray-500"}`}
                        >
                          {cause.severity}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {cause.explanation}
                      </p>
                      <p className="text-xs font-mono text-gray-400 mt-0.5">
                        Value: {cause.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Recommended Actions ── */}
            {detail.recommended_actions.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                  <Lightbulb size={16} className="text-blue-500" />
                  Recommended Actions
                </h3>
                <div className="flex flex-col gap-2">
                  {detail.recommended_actions.map((action) => (
                    <div
                      key={action.action_code}
                      className="rounded-md border border-blue-100 bg-blue-50/40 px-3 py-2"
                    >
                      <p className="text-sm font-medium text-gray-800">
                        {action.title}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {action.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Feature Evidence ── */}
            {detail.features.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                  <Sparkles size={16} className="text-purple-500" />
                  Feature Evidence
                </h3>
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-left text-xs text-gray-500">
                        <th className="px-3 py-2 font-medium">Feature</th>
                        <th className="px-3 py-2 font-medium">Value</th>
                        <th className="px-3 py-2 font-medium">Direction</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.features.map((f) => {
                        const DirIcon =
                          DIRECTION_ICONS[f.direction] ?? Minus;
                        return (
                          <tr
                            key={f.feature_id}
                            className="border-t border-gray-100"
                          >
                            <td className="px-3 py-2 text-gray-700 font-mono text-xs">
                              {f.feature_name}
                            </td>
                            <td className="px-3 py-2 text-gray-600">
                              {f.feature_value?.toFixed(4) ?? "—"}
                            </td>
                            <td className="px-3 py-2">
                              <DirIcon
                                size={14}
                                className={
                                  f.direction === "INCREASES_RISK"
                                    ? "text-red-500"
                                    : f.direction === "DECREASES_RISK"
                                      ? "text-emerald-500"
                                      : "text-gray-400"
                                }
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <Separator />

            {/* ── Teacher Review Form ── */}
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
                <MessageSquare size={16} className="text-indigo-500" />
                Teacher Review
              </h3>

              {/* Existing reviews */}
              {detail.teacher_reviews.length > 0 && (
                <div className="flex flex-col gap-2 mb-3">
                  {detail.teacher_reviews.map((review: TeacherReview) => (
                    <div
                      key={review.review_id}
                      className="rounded-md border border-gray-100 bg-white px-3 py-2 text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <Badge size="sm" className="bg-indigo-100 text-indigo-700 text-xs rounded-full">
                          {DECISION_LABELS[review.decision] ?? review.decision}
                        </Badge>
                        <span className="text-xs text-gray-400">
                          {new Date(review.reviewed_at).toLocaleDateString(
                            "en-PH",
                            {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            }
                          )}
                        </span>
                      </div>
                      {review.teacher_notes && (
                        <p className="text-xs text-gray-500 mt-1 italic">
                          "{review.teacher_notes}"
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {reviewSuccess && (
                <div className="flex items-center gap-2 text-emerald-600 text-sm mb-3 px-1">
                  <CheckCircle2 size={16} />
                  Review submitted successfully.
                </div>
              )}

              {/* Review form */}
              <div className="flex flex-col gap-4 rounded-lg border-2 border-black p-4 bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                {/* Decision dropdown */}
                <div className="space-y-1">
                  <label className="text-xs font-extrabold uppercase text-gray-800">
                    Review Decision *
                  </label>
                  <Select
                    value={reviewDecision}
                    onValueChange={setReviewDecision}
                  >
                    <Select.Trigger className="w-full bg-white border-2 border-black font-semibold text-sm shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                      <Select.Value placeholder="Select decision..." />
                    </Select.Trigger>
                    <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                      {DECISION_OPTIONS.map((opt) => (
                        <Select.Item key={opt.value} value={opt.value}>
                          {opt.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </div>
                
                <textarea
                  placeholder="Add notes (optional)..."
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  className="w-full rounded-md border-2 border-black bg-white px-3 py-2 text-sm resize-none focus:outline-none shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                  rows={3}
                />
                
                <Button
                  type="submit"
                  size="sm"
                  disabled={!reviewDecision || submitting}
                  onClick={handleSubmitReview}
                  className="w-full bg-yellow-300 hover:bg-yellow-400 text-black border-2 border-black font-extrabold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                >
                  {submitting ? (
                    <Loader2 size={16} className="animate-spin mr-1" />
                  ) : (
                    <Send size={14} className="mr-1 stroke-[2.5]" />
                  )}
                  Submit Review
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center text-gray-400 py-20">
            No prediction selected.
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
