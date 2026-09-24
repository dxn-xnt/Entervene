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
  DevelopmentCurrentTermListItem,
  PredictionDetail,
  PredictionSuggestionItem,
  TeacherReview,
} from "@/lib/prediction-api";
import { EVIDENCE_GROUPS, evidenceRowsForGroup } from "./teacher-evidence";
import { useAuth } from "@/context/AuthContext";
import {
  assignPredictionIntervention,
  fetchPredictionDetail,
  fetchPredictionSuggestions,
  submitTeacherReview,
} from "@/lib/prediction-api";
import { Card } from "../retroui/Card";

interface PredictionDetailSheetProps {
  predictionId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTermPrediction?: DevelopmentCurrentTermListItem | null;
}

const RISK_BADGE_STYLES: Record<string, string> = {
  HIGH_RISK: "bg-destructive text-foreground border-border",
  MODERATE_RISK: "bg-foreground text-white border-border",
  NEEDS_MONITORING: "bg-primary text-foreground border-border",
  LOW_RISK: "bg-background text-white border-border",
  INSUFFICIENT_DATA: "bg-muted text-muted-foreground border-none",
};

const RISK_LABELS: Record<string, string> = {
  HIGH_RISK: "High Risk",
  MODERATE_RISK: "Moderate",
  NEEDS_MONITORING: "Needs Monitoring",
  LOW_RISK: "Low Risk",
  INSUFFICIENT_DATA: "Insufficient Data",
};

const DIRECTION_ICONS: Record<string, typeof ArrowUp> = {
  INCREASES_RISK: ArrowUp,
  DECREASES_RISK: ArrowDown,
  NEUTRAL: Minus,
};
const showDeprecatedRawFeaturePanel: boolean = false;

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
  currentTermPrediction = null,
}: PredictionDetailSheetProps) {
  const { user } = useAuth();
  const isTeacher = user?.role === "teacher";

  const [detail, setDetail] = useState<PredictionDetail | null>(null);
  const [suggestions, setSuggestions] = useState<PredictionSuggestionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
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
    if (!predictionId || !open || currentTermPrediction) return;
    setLoading(true);
    setLoadError(null);
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
      .catch((error: unknown) => {
        console.error(error);
        setDetail(null);
        setLoadError("Unable to load this prediction detail. Please try again.");
      })
      .finally(() => setLoading(false));
  }, [currentTermPrediction, predictionId, open]);

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
    } catch (err: unknown) {
      console.error(err);
      setInterventionError(err instanceof Error ? err.message : "Failed to assign intervention");
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
        <SheetHeader className="pb-0">
          <SheetTitle className="text-lg">Prediction Detail</SheetTitle>
        </SheetHeader>

        {currentTermPrediction ? (
          <CurrentTermTeacherDetail prediction={currentTermPrediction} />
        ) : loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-gray-400" size={28} />
          </div>
        ) : loadError ? (
          <div className="px-4 py-20 text-center text-sm text-destructive" role="alert">
            {loadError}
          </div>
        ) : detail ? (
          <div className="flex flex-col gap-5 p-4">
            {/* ── Metadata & Student / Teacher Context Card ── */}
            <Card className="shadow-none border-2 border-black p-4 bg-yellow-50/60 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2 border-b border-black/20 pb-2">
                <div>
                  <h2 className="text-base font-black text-black">
                    {detail.student_name || "Unknown Student"}
                  </h2>
                  <p className="text-xs font-semibold text-gray-600 font-mono">
                    LRN: {detail.student_lrn || "—"}
                  </p>
                </div>
                <Badge variant="solid" size="sm" className="bg-black text-white font-bold shrink-0">
                  {detail.level_name || (detail.grade_level ? `Grade ${detail.grade_level}` : "—")}{detail.class_name ? ` • ${detail.class_name}` : ""}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="font-extrabold uppercase text-gray-500">Subject</p>
                  <p className="font-bold text-black text-sm">
                    {detail.subject_name || "—"}
                  </p>
                  {detail.subject_codename && (
                    <p className="font-mono text-[10px] text-gray-500">{detail.subject_codename}</p>
                  )}
                </div>
                <div>
                  <p className="font-extrabold uppercase text-gray-500">Teacher</p>
                  {detail.teacher_status_label === "ASSIGNED" && (
                    <div>
                      <p className="font-bold text-black text-sm">{detail.teacher_name || "Assigned Teacher"}</p>
                      {detail.teacher_staff_id && (
                        <p className="font-mono text-[10px] text-gray-500">{detail.teacher_staff_id}</p>
                      )}
                    </div>
                  )}
                  {detail.teacher_status_label === "SUBSTITUTE_ACTIVE" && (
                    <div>
                      <Badge size="sm" className="bg-amber-400 text-black border border-black font-bold mb-1">
                        Active Substitute
                      </Badge>
                      <p className="font-bold text-black text-sm">{detail.teacher_name}</p>
                      {detail.original_teacher_name && (
                        <p className="text-[10px] text-gray-600 font-medium">
                          Covering for {detail.original_teacher_name}
                        </p>
                      )}
                    </div>
                  )}
                  {detail.teacher_status_label === "NO_CONFIRMED_TEACHER" && (
                    <div>
                      <Badge size="sm" className="bg-orange-100 text-orange-800 border border-orange-400 font-bold">
                        No Confirmed Teacher Assigned
                      </Badge>
                      <p className="text-[10px] text-gray-500 mt-0.5">Schedule is in draft status</p>
                    </div>
                  )}
                  {detail.teacher_status_label === "HISTORICAL_UNMAPPED" && (
                    <div>
                      <Badge size="sm" className="bg-gray-100 text-gray-800 border border-gray-400 font-bold">
                        Historical Record (Unmapped Subject)
                      </Badge>
                      <p className="text-[10px] text-gray-500 mt-0.5">Legacy seeded assessment</p>
                    </div>
                  )}
                  {detail.teacher_status_label === "UNASSIGNED" && (
                    <div>
                      <Badge size="sm" className="bg-rose-100 text-rose-800 border border-rose-400 font-bold">
                        Unassigned Subject Load
                      </Badge>
                      <p className="text-[10px] text-gray-500 mt-0.5">No teacher currently assigned</p>
                    </div>
                  )}
                </div>
              </div>
            </Card>

            {/* ── Summary ── */}
            <Card className="shadow-none">
              <div className="flex items-center justify-between mb-3">
                <Badge
                  size="sm"
                  variant="surface"
                  className={`${RISK_BADGE_STYLES[detail.risk_level] ?? "bg-gray-300"} font-medium`}
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
                    {detail.risk_level === "INSUFFICIENT_DATA" || detail.predicted_period_grade === null
                      ? "—"
                      : detail.predicted_period_grade.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Risk Score</p>
                  <p className="text-xl font-bold text-gray-900">
                    {detail.risk_level === "INSUFFICIENT_DATA" || detail.risk_score === null
                      ? "—"
                      : detail.risk_score.toFixed(1)}
                  </p>
                </div>
              </div>
              {detail.risk_level === "INSUFFICIENT_DATA" && (
                <p className="text-xs text-amber-600 font-semibold mt-2">
                  Prediction unavailable: there was not enough verified evidence to generate a grade prediction.
                </p>
              )}
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
            </Card>

            {/* ── Causes ── */}
            {detail.interpretations.length > 0 && (
              <section aria-labelledby="risk-indicators-title">
                <h3 id="risk-indicators-title" className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                  <AlertTriangle size={16} className="text-amber-500" aria-hidden="true" />
                  Why this prediction needs attention
                </h3>
                <div className="flex flex-col gap-2">
                  {detail.interpretations.map((interpretation) => (
                    <p key={interpretation} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-gray-700">
                      {interpretation}
                    </p>
                  ))}
                </div>
              </section>
            )}

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
                        <span className="text-xs font-semibold text-gray-500">
                          {cause.severity}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {cause.explanation}
                      </p>
                      {cause.value && (
                        <p className="text-xs font-mono text-gray-400 mt-0.5">
                          Value: {cause.value}
                        </p>
                      )}
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
            {detail.features.length > 0 && showDeprecatedRawFeaturePanel && (
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
            <section aria-labelledby="prediction-evidence-title" className="space-y-3">
              <h3 id="prediction-evidence-title" className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <Sparkles size={16} className="text-purple-500" aria-hidden="true" />
                Evidence used for this prediction
              </h3>
              {detail.evidence.length > 0 ? EVIDENCE_GROUPS.map((group) => {
                const rows = evidenceRowsForGroup(detail.evidence, group);
                if (!rows.length) return null;
                return (
                  <div key={group.title} className="space-y-2">
                    <h4 className="text-[11px] font-extrabold uppercase tracking-wide text-gray-500">{group.title}</h4>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {rows.map((item) => (
                        <article key={item.feature_name} className="min-w-0 rounded-lg border border-gray-200 bg-white p-3">
                          <p className="text-sm font-semibold text-gray-900 break-words">{item.display_name}</p>
                          <p className="mt-1 text-base font-bold text-gray-900 break-words">{item.formatted_value}</p>
                          <p className="mt-1 text-xs text-gray-600 break-words">{item.source_description}</p>
                          <p className="mt-1 text-xs text-gray-500 break-words">{item.usage_description}</p>
                          {item.evidence_state !== "AVAILABLE" && (
                            <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                              Evidence status: {item.evidence_state.replaceAll("_", " ")}
                            </p>
                          )}
                        </article>
                      ))}
                    </div>
                  </div>
                );
              }) : (
                <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  {detail.prediction_status === "LEGACY"
                    ? "Source details unavailable for this saved prediction."
                    : "No teacher-visible evidence is available for this prediction."}
                </p>
              )}
            </section>

            {detail.limitations.length > 0 && (
              <section aria-labelledby="evidence-limitations-title">
                <h3 id="evidence-limitations-title" className="text-sm font-semibold text-gray-700 mb-2">Evidence limitations</h3>
                <div className="flex flex-col gap-2">
                  {detail.limitations.map((limitation) => (
                    <p key={limitation} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-gray-700">{limitation}</p>
                  ))}
                </div>
              </section>
            )}

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
                          className={`border-2 border-black text-[10px] uppercase font-bold px-2 ${s.status === "ACTIVE"
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
                      onValueChange={(value: string) => setInterventionPriority(value as "LOW" | "NORMAL" | "HIGH" | "URGENT")}
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

function formatPercent(value: number | null): string {
  return value === null ? "Not yet available" : `${value.toFixed(1)}%`;
}

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function CurrentTermTeacherDetail({ prediction }: { prediction: DevelopmentCurrentTermListItem }) {
  const academic = prediction.academic_evidence;
  const attendance = prediction.participation_context.attendance;
  const submissions = prediction.participation_context.submissions;
  const term = prediction.term_context;
  const risk = RISK_LABELS[prediction.intervention_level] || prediction.intervention_level;

  return <div className="flex flex-col gap-5 p-4 text-sm">
    <section aria-labelledby="student-overview-heading">
      <h2 id="student-overview-heading" className="mb-2 text-base font-black">Student Overview</h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-2 border-black bg-yellow-50 p-3">
        <dt className="text-gray-600">Student</dt><dd className="font-bold">{prediction.student_name || prediction.student_id}</dd>
        <dt className="text-gray-600">Class / Section</dt><dd>{prediction.class_name}</dd>
        <dt className="text-gray-600">Subject</dt><dd>{prediction.subject_name}</dd>
        <dt className="text-gray-600">Academic Term</dt><dd>{prediction.period_name}</dd>
      </dl>
    </section>

    <section aria-labelledby="current-projection-heading">
      <h2 id="current-projection-heading" className="mb-2 text-base font-black">Current Projection</h2>
      <div className="grid grid-cols-2 gap-3">
        <div className="border-2 border-black p-3"><p className="text-xs text-gray-600">Projected Final Term Grade</p><p className="text-2xl font-black">{prediction.projected_final_term_grade?.toFixed(2) ?? "Not available"}</p></div>
        <div className="border-2 border-black p-3"><p className="text-xs text-gray-600">Intervention Level</p><Badge size="sm" variant="surface" className="mt-2 border-2 border-black font-bold">{risk}</Badge></div>
      </div>
      <p className="mt-2 font-semibold">{prediction.readiness_label}</p>
      <p className="mt-1 text-xs text-gray-600">The intervention level is assigned from the projected grade using the school's configured thresholds.</p>
    </section>

    <section aria-labelledby="academic-evidence-heading">
      <h2 id="academic-evidence-heading" className="mb-1 text-base font-black">Academic Evidence Used for Projection</h2>
      <p className="mb-3 text-xs text-gray-600">These graded academic records were available when this projection was generated.</p>
      <div className="space-y-2">
        <EvidenceRow label="Written Works" count={academic.written_works.graded_count} percent={academic.written_works.performance_percent} />
        <EvidenceRow label="Performance Tasks" count={academic.performance_tasks.graded_count} percent={academic.performance_tasks.performance_percent} />
        <EvidenceRow label="Examination" count={academic.examination.graded_count} percent={academic.examination.performance_percent} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 border-t-2 border-black pt-3">
        <div><p className="text-xs text-gray-600">Academic performance so far</p><p className="font-black">{formatPercent(academic.overall.performance_percent)}</p></div>
        <div><p className="text-xs text-gray-600">Grade components observed</p><p className="font-black">{formatPercent(academic.overall.observed_component_weight_percent)}</p></div>
      </div>
    </section>

    <section aria-labelledby="classroom-context-heading" className="border-t-2 border-black pt-4">
      <h2 id="classroom-context-heading" className="mb-1 text-base font-black">Additional Classroom Context</h2>
      <p className="mb-3 text-xs text-gray-600">These participation indicators provide classroom context. They are not inputs to the current grade-projection model.</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="border border-black p-3">
          <p className="font-bold">Attendance</p>
          <p className="text-lg font-black">{formatPercent(attendance.attendance_rate)}</p>
          <p className="text-xs text-gray-600">{attendance.absent} absent, {attendance.late} late across {attendance.recorded_days} recorded days</p>
        </div>
        <div className="border border-black p-3">
          <p className="font-bold">Submissions</p>
          <p className="text-lg font-black">{formatPercent(submissions.completion_rate)}</p>
          <p className="text-xs text-gray-600">{submissions.submitted_count} of {submissions.assigned_count} submitted, {submissions.missing_count} missing, {submissions.late_count} late</p>
        </div>
      </div>
    </section>

    <section aria-labelledby="term-progress-heading" className="border-t-2 border-black pt-4">
      <h2 id="term-progress-heading" className="mb-2 text-base font-black">Term Progress</h2>
      <dl className="grid grid-cols-2 gap-y-2">
        <dt className="text-gray-600">Term dates</dt><dd>{formatDate(term.start_date)} - {formatDate(term.end_date)}</dd>
        <dt className="text-gray-600">Evidence available through</dt><dd>{formatDate(term.evidence_cutoff_date)}</dd>
        <dt className="text-gray-600">Term progress</dt><dd>{term.progress_percent.toFixed(1)}%</dd>
        <dt className="text-gray-600">Days remaining</dt><dd>{term.days_remaining}</dd>
        <dt className="text-gray-600">Still upcoming</dt><dd>{submissions.upcoming_count} assigned item{submissions.upcoming_count === 1 ? "" : "s"}</dd>
      </dl>
    </section>
  </div>;
}

function EvidenceRow({ label, count, percent }: { label: string; count: number; percent: number | null }) {
  return <div className="flex items-center justify-between border border-black px-3 py-2">
    <div><p className="font-bold">{label}</p><p className="text-xs text-gray-600">{count} graded record{count === 1 ? "" : "s"}</p></div>
    <p className="font-black">{formatPercent(percent)}</p>
  </div>;
}
