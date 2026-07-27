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
import type {
  PredictionDetail,
  PredictionSuggestionItem,
  TeacherReview,
} from "@/lib/prediction-api";
import { useAuth } from "@/context/AuthContext";
import {
  assignPredictionIntervention,
  fetchPredictionDetail,
  fetchPredictionSuggestions,
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
  const { user } = useAuth();
  const isTeacher = user?.role === "teacher";

  const [detail, setDetail] = useState<PredictionDetail | null>(null);
  const [suggestions, setSuggestions] = useState<PredictionSuggestionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [reviewDecision, setReviewDecision] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reviewSuccess, setReviewSuccess] = useState(false);

  // Intervention assignment state
  const [interventionTitle, setInterventionTitle] = useState("");
  const [interventionPriority, setInterventionPriority] = useState<"LOW" | "NORMAL" | "HIGH" | "URGENT">("HIGH");
  const [assigningIntervention, setAssigningIntervention] = useState(false);
  const [interventionSuccess, setInterventionSuccess] = useState(false);
  const [interventionError, setInterventionError] = useState<string | null>(null);

  useEffect(() => {
    if (!predictionId || !open) return;
    setLoading(true);
    setReviewSuccess(false);
    setInterventionSuccess(false);
    setInterventionError(null);
    
    Promise.all([
      fetchPredictionDetail(predictionId),
      fetchPredictionSuggestions(predictionId).catch(() => []),
    ])
      .then(([detailRes, suggestionsRes]) => {
        setDetail(detailRes);
        setSuggestions(suggestionsRes);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [predictionId, open]);

  const handleAssignIntervention = async () => {
    if (!predictionId || !interventionTitle.trim()) return;
    setAssigningIntervention(true);
    setInterventionError(null);
    try {
      await assignPredictionIntervention(predictionId, {
        resource_type: "LESSON",
        title: interventionTitle.trim(),
        priority: interventionPriority,
      });
      setInterventionSuccess(true);
      setInterventionTitle("");
      // Refresh detail and suggestions
      const [updatedDetail, updatedSuggestions] = await Promise.all([
        fetchPredictionDetail(predictionId),
        fetchPredictionSuggestions(predictionId),
      ]);
      setDetail(updatedDetail);
      setSuggestions(updatedSuggestions);
    } catch (err: any) {
      console.error(err);
      setInterventionError(err.message || "Failed to assign intervention");
    } finally {
      setAssigningIntervention(false);
    }
  };

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

              {/* ── Section: Assigned Interventions ── */}
              <div className="space-y-3 border-t-2 border-black pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-extrabold uppercase tracking-wide text-black flex items-center gap-1.5">
                    <Sparkles size={16} className="text-yellow-500 fill-yellow-400" />
                    Assigned Interventions ({suggestions.length})
                  </h3>
                </div>

                {suggestions.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {suggestions.map((s) => (
                      <div
                        key={s.student_suggestion_id}
                        className="rounded-none border-2 border-black bg-yellow-50/50 p-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-extrabold text-xs text-black uppercase">
                            {s.title}
                          </span>
                          <Badge
                            className={`border-2 border-black text-[10px] uppercase font-bold px-2 ${
                              s.status === "ACTIVE"
                                ? "bg-amber-300 text-black"
                                : "bg-emerald-400 text-black"
                            }`}
                          >
                            {s.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-gray-700 font-medium mt-1">
                          Priority: <strong className="text-black">{s.priority}</strong>
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 font-semibold italic">
                    No persistent interventions assigned yet for this prediction.
                  </p>
                )}

                {/* Assign New Intervention Box */}
                {isTeacher ? (
                  <div className="border-2 border-black p-3 bg-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-2.5 mt-2">
                    <span className="text-xs font-black uppercase text-black">
                      Quick Assign AI Intervention
                    </span>
                    {interventionSuccess && (
                      <div className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 size={14} /> Intervention assigned successfully!
                      </div>
                    )}
                    {interventionError && (
                      <div className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 p-2 rounded">
                        {interventionError}
                      </div>
                    )}
                    <input
                      type="text"
                      placeholder="Intervention title (e.g. Remedial Algebra Review)..."
                      value={interventionTitle}
                      onChange={(e) => setInterventionTitle(e.target.value)}
                      className="w-full text-xs font-semibold p-2 border-2 border-black bg-white focus:outline-none shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                    />
                    <div className="flex items-center gap-2">
                      <Select
                        value={interventionPriority}
                        onValueChange={(v: any) => setInterventionPriority(v)}
                      >
                        <Select.Trigger className="w-[140px] h-8 text-xs font-bold border-2 border-black bg-white shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                          <Select.Value placeholder="Priority" />
                        </Select.Trigger>
                        <Select.Content className="border-2 border-black bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                          <Select.Item value="NORMAL">NORMAL</Select.Item>
                          <Select.Item value="HIGH">HIGH</Select.Item>
                          <Select.Item value="URGENT">URGENT</Select.Item>
                        </Select.Content>
                      </Select>
                      <Button
                        size="sm"
                        disabled={!interventionTitle.trim() || assigningIntervention}
                        onClick={handleAssignIntervention}
                        className="h-8 flex-1 bg-yellow-300 hover:bg-yellow-400 text-black border-2 border-black font-extrabold text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                      >
                        {assigningIntervention ? (
                          <Loader2 size={14} className="animate-spin mr-1" />
                        ) : (
                          <Send size={12} className="mr-1 stroke-[2.5]" />
                        )}
                        Assign Intervention
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="border-2 border-black p-3 bg-sky-50 text-sky-900 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] mt-2">
                    🔒 Read-Only (Admin View): Assigning interventions is reserved for assigned subject teachers.
                  </div>
                )}
              </div>

              <Separator />

              {/* ── Section: Teacher Review ── */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                  <MessageSquare size={16} className="text-indigo-500" />
                  Teacher Review History
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
              {isTeacher ? (
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
              ) : (
                <div className="border-2 border-black p-3 bg-indigo-50 text-indigo-900 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                  🔒 Read-Only (Admin View): Reviewing predictions is reserved for assigned subject teachers.
                </div>
              )}
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
