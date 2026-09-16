import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import { Loader2, Sparkles } from "lucide-react";
import type {
  PredictionDetail,
  PredictionHistoryResponse,
  PredictionStatusEnvelope,
} from "@/lib/prediction-api";
import {
  fetchPredictionDetail,
  fetchPredictionHistory,
  fetchPredictionStatus,
} from "@/lib/prediction-api";
import { EVIDENCE_GROUPS, evidenceRowsForGroup } from "./teacher-evidence";
import { formatDateTime, formatGrade, riskLabel } from "./prediction-status-copy";

interface PredictionDetailSheetProps {
  predictionId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const RISK_BADGE_STYLES: Record<string, string> = {
  HIGH_RISK: "bg-destructive text-foreground border-border",
  MODERATE_RISK: "bg-foreground text-background border-border",
  NEEDS_MONITORING: "bg-primary text-foreground border-border",
  LOW_RISK: "bg-background text-foreground border-border",
  INSUFFICIENT_DATA: "bg-muted text-muted-foreground border-none",
};

export default function PredictionDetailSheet({
  predictionId,
  open,
  onOpenChange,
}: PredictionDetailSheetProps) {
  const [detail, setDetail] = useState<PredictionDetail | null>(null);
  const [statusEnvelope, setStatusEnvelope] = useState<PredictionStatusEnvelope | null>(null);
  const [history, setHistory] = useState<PredictionHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!predictionId || !open) return;
    setLoading(true);
    setLoadError(null);

    Promise.all([
      fetchPredictionDetail(predictionId),
      fetchPredictionStatus(predictionId).catch(() => null),
      fetchPredictionHistory(predictionId).catch(() => null),
    ])
      .then(([detailRes, statusRes, historyRes]) => {
        setDetail(detailRes);
        setStatusEnvelope(statusRes);
        setHistory(historyRes);
      })
      .catch((error: unknown) => {
        console.error(error);
        setDetail(null);
        setStatusEnvelope(null);
        setHistory(null);
        setLoadError("Unable to load this prediction detail. Please try again.");
      })
      .finally(() => setLoading(false));
  }, [predictionId, open]);

  const modelPurpose = detail?.model_purpose ?? statusEnvelope?.model_purpose ?? null;
  const isUnified = modelPurpose === "UNIFIED_CURRENT_TERM_PROJECTION";
  const isCurrentProjection = modelPurpose === "CURRENT_PERIOD_FINAL_GRADE_PROJECTION" || isUnified;
  const isBaseline = modelPurpose === "NEXT_PERIOD_BASELINE_FORECAST";
  const hasEvaluatedRisk = !isCurrentProjection && detail?.risk_assessment_status === "EVALUATED";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="pb-0">
          <SheetTitle className="text-lg">Prediction Detail</SheetTitle>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-gray-400" size={28} />
          </div>
        ) : loadError ? (
          <div className="px-4 py-20 text-center text-sm text-destructive" role="alert">
            {loadError}
          </div>
        ) : detail ? (
          <div className="flex flex-col gap-5 p-4">
            <Card className="flex flex-col gap-3 border-2 border-black bg-yellow-50/60 p-4 shadow-none">
              <div className="flex items-start justify-between gap-2 border-b border-black/20 pb-2">
                <div>
                  <h2 className="text-base font-black text-black">{detail.student_name || "Unknown Student"}</h2>
                  <p className="font-mono text-xs font-semibold text-gray-600">LRN: {detail.student_lrn || "—"}</p>
                </div>
                <Badge variant="solid" size="sm" className="shrink-0 bg-black font-bold text-white">
                  {detail.level_name || (detail.grade_level ? `Grade ${detail.grade_level}` : "—")}
                  {detail.class_name ? ` · ${detail.class_name}` : ""}
                </Badge>
              </div>
              <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                <div>
                  <p className="font-extrabold uppercase text-gray-500">Subject</p>
                  <p className="text-sm font-bold text-black">{detail.subject_name || "—"}</p>
                </div>
                <div>
                  <p className="font-extrabold uppercase text-gray-500">Teacher</p>
                  <p className="text-sm font-bold text-black">{detail.teacher_name || "—"}</p>
                </div>
              </div>
            </Card>

            <Card className="border-2 border-black bg-white p-4 shadow-none">
              <div className="mb-3 flex items-center justify-between gap-3">
                <Badge
                  size="sm"
                  variant="surface"
                  className={`${hasEvaluatedRisk ? (RISK_BADGE_STYLES[detail.risk_level ?? ""] ?? "bg-gray-300") : "border border-gray-300 bg-gray-100 text-gray-800"} font-medium`}
                >
                  {hasEvaluatedRisk ? riskLabel(detail.risk_level) : "Academic Estimate"}
                </Badge>
                <span className="text-xs text-gray-400">
                  #{detail.prediction_id}{detail.revision ? ` · Revision ${detail.revision}` : ""}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-gray-500">
                    {isUnified
                      ? "Projected Final Grade"
                      : isCurrentProjection
                      ? "Current-Term Projected Grade"
                      : "Baseline Predicted Grade"}
                  </p>
                  <p className="text-2xl font-black text-gray-900">{formatGrade(detail.predicted_period_grade)}</p>
                </div>
                <div>
                  <p className="text-gray-500">{isCurrentProjection ? "Risk Assessment" : "Risk Score"}</p>
                  <p className="text-2xl font-black text-gray-900">
                    {hasEvaluatedRisk && detail.risk_score !== null ? detail.risk_score.toFixed(1) : "Not evaluated"}
                  </p>
                </div>
              </div>

              <div className="mt-3 space-y-2 text-xs font-semibold text-gray-600">
                {isUnified && (
                  <p>
                    Projected final grades are academic estimates based on available evidence. They are not failure probabilities, risk scores, or AI confidence.
                  </p>
                )}
                {isCurrentProjection && !isUnified && (
                  <p>
                    Current-term projections are academic estimates. They are not failure probabilities, risk scores, or AI confidence.
                  </p>
                )}
                {isBaseline && hasEvaluatedRisk && (
                  <p>Baseline risk is evaluated separately from current-term projections.</p>
                )}
                {detail.generated_at && <p>Generated {formatDateTime(detail.generated_at)}</p>}
              </div>
            </Card>

            {hasEvaluatedRisk && detail.interpretations.length > 0 && (
              <section aria-labelledby="risk-indicators-title" className="space-y-2">
                <h3 id="risk-indicators-title" className="text-sm font-semibold text-gray-700">
                  Why this baseline forecast needs attention
                </h3>
                {detail.interpretations.map((interpretation) => (
                  <p key={interpretation} className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-gray-700">
                    {interpretation}
                  </p>
                ))}
              </section>
            )}

            <section aria-labelledby="prediction-evidence-title" className="space-y-3">
              <h3 id="prediction-evidence-title" className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <Sparkles size={16} className="text-purple-500" aria-hidden="true" />
                Evidence saved with this prediction
              </h3>
              {detail.evidence.length > 0 ? (
                EVIDENCE_GROUPS.map((group) => {
                  const rows = evidenceRowsForGroup(detail.evidence, group);
                  if (!rows.length) return null;
                  return (
                    <div key={group.title} className="space-y-2">
                      <h4 className="text-[11px] font-extrabold uppercase tracking-wide text-gray-500">{group.title}</h4>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {rows.map((item) => (
                          <article key={item.feature_name} className="min-w-0 rounded border border-gray-200 bg-white p-3">
                            <p className="break-words text-sm font-semibold text-gray-900">{item.display_name}</p>
                            <p className="mt-1 break-words text-base font-bold text-gray-900">{item.formatted_value}</p>
                            <p className="mt-1 break-words text-xs text-gray-600">{item.source_description}</p>
                            <p className="mt-1 break-words text-xs text-gray-500">{item.usage_description}</p>
                          </article>
                        ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  Source details unavailable for this saved prediction.
                </p>
              )}
            </section>

            {history && history.items.length > 0 && (
              <section aria-labelledby="prediction-history-title" className="space-y-3">
                <h3 id="prediction-history-title" className="text-sm font-semibold text-gray-700">
                  Prediction History
                </h3>
                <div className="flex flex-col gap-2">
                  {history.items.map((item) => (
                    <div key={`${item.prediction_id}:${item.revision}`} className="rounded border border-gray-200 bg-white p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-bold text-gray-900">
                          Revision {item.revision}{item.is_latest ? " · Latest" : ""}
                        </p>
                        <span className="text-xs text-gray-500">#{item.prediction_id}</span>
                      </div>
                      <p className="text-xs text-gray-600">
                        {item.source_period_label || `Period ${item.source_period_id}`} ? {item.target_period_label || `Period ${item.target_period_id}`}
                      </p>
                      <p className="text-xs text-gray-500">Generated {formatDateTime(item.generated_at)}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="py-20 text-center text-gray-400">No prediction selected.</div>
        )}
      </SheetContent>
    </Sheet>
  );
}
