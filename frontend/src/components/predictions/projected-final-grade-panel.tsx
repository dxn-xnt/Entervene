import { AlertTriangle, Clock, RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import type { CurrentProjectionAction, CurrentProjectionSummary, PeriodOutcome } from "@/lib/prediction-api";
import {
  formatDateTime,
  formatGrade,
  getCurrentProjectionAction,
} from "./prediction-status-copy";

interface ProjectedFinalGradePanelProps {
  currentProjection: CurrentProjectionSummary;
  periodOutcome: PeriodOutcome;
  emphasized?: boolean;
  pending?: boolean;
  onGenerate?: () => void;
  onRefresh?: () => void;
  onOpenDetail?: (predictionId: number) => void;
}

export type UnifiedDisplayStatus =
  | "Ready"
  | "Insufficient Evidence"
  | "Unsupported"
  | "Finalized"
  | "Update Available";

export function resolveUnifiedStatus(
  currentProjection: CurrentProjectionSummary,
  periodOutcome: PeriodOutcome
): {
  status: UnifiedDisplayStatus;
  explanation: string;
  isUnsupported: boolean;
} {
  if (periodOutcome.status === "FINALIZED") {
    return {
      status: "Finalized",
      explanation: "This grading period is finalized. The official final grade is the primary academic result.",
      isUnsupported: false,
    };
  }

  const domainWarnings = currentProjection.domain_warnings || [];
  const isUnsupported = domainWarnings.some(
    (w) =>
      w.code === "DOMAIN_UNSUPPORTED" ||
      w.code === "UNSUPPORTED_SUBJECT" ||
      w.code === "UNSUPPORTED_WEIGHT_PATTERN"
  );
  if (isUnsupported) {
    return {
      status: "Unsupported",
      explanation: "Prediction is currently unavailable for this subject.",
      isUnsupported: true,
    };
  }

  const freshness = currentProjection.projection_freshness?.status;
  if (
    currentProjection.latest_prediction_id != null &&
    (freshness === "SOURCE_EVIDENCE_CHANGED" || freshness === "MODEL_UPDATE_AVAILABLE")
  ) {
    return {
      status: "Update Available",
      explanation: "New academic evidence is available. Refresh to update the projection.",
      isUnsupported: false,
    };
  }

  const hasPrediction = currentProjection.latest_prediction_id != null;
  if (hasPrediction && currentProjection.predicted_grade != null) {
    return {
      status: "Ready",
      explanation: "Based on available academic evidence.",
      isUnsupported: false,
    };
  }

  const readiness = currentProjection.evidence_readiness;
  if (readiness?.ready) {
    return {
      status: "Ready",
      explanation: "Based on available academic evidence.",
      isUnsupported: false,
    };
  }

  return {
    status: "Insufficient Evidence",
    explanation: "More graded activities are needed before a projection can be generated.",
    isUnsupported: false,
  };
}

const STATUS_BADGE_STYLES: Record<UnifiedDisplayStatus, string> = {
  Ready: "border-green-600 bg-green-100 text-green-900",
  "Insufficient Evidence": "border-gray-400 bg-gray-100 text-gray-800",
  Unsupported: "border-amber-500 bg-amber-100 text-amber-900",
  Finalized: "border-blue-500 bg-blue-100 text-blue-900",
  "Update Available": "border-amber-600 bg-amber-200 text-amber-950",
};

export function ProjectedFinalGradePanel({
  currentProjection,
  periodOutcome,
  emphasized = false,
  pending = false,
  onGenerate,
  onRefresh,
  onOpenDetail,
}: ProjectedFinalGradePanelProps) {
  const action: CurrentProjectionAction = getCurrentProjectionAction(currentProjection, periodOutcome);
  const latestPredictionId = currentProjection.latest_prediction_id ?? null;
  const hasPrediction = latestPredictionId !== null && currentProjection.predicted_grade != null;
  const isFinalized = periodOutcome.status === "FINALIZED";

  const { status, explanation, isUnsupported } = resolveUnifiedStatus(currentProjection, periodOutcome);

  return (
    <Card
      className={[
        "flex flex-col gap-3 border-2 border-black p-4",
        emphasized ? "bg-yellow-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" : "bg-white shadow-none",
      ].join(" ")}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-extrabold uppercase text-gray-500">Projected Final Grade</p>
          <p className="text-sm font-semibold text-gray-700">{explanation}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            size="sm"
            className={`w-fit border font-bold ${STATUS_BADGE_STYLES[status]}`}
          >
            {status}
          </Badge>
          {hasPrediction && currentProjection.revision != null && (
            <Badge size="sm" className="w-fit border border-black bg-white text-black">
              Revision {currentProjection.revision}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-3xl font-black text-black">
            {hasPrediction && !isFinalized ? formatGrade(currentProjection.predicted_grade) : "—"}
          </p>
        </div>
        {hasPrediction && currentProjection.generated_at && (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 sm:text-right">
            <Clock className="size-3.5 text-gray-400" />
            <span>Last updated {formatDateTime(currentProjection.generated_at)}</span>
          </div>
        )}
      </div>

      {isUnsupported && (
        <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs font-semibold text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>Prediction is currently unavailable for this subject.</span>
        </div>
      )}

      {isFinalized && (
        <p className="rounded border border-gray-200 bg-gray-50 p-2 text-xs font-semibold text-gray-600">
          Official outcome takes precedence.
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {action === "GENERATE" && !isUnsupported && (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={onGenerate}
            className="border-2 border-black bg-yellow-300 font-extrabold text-black hover:bg-yellow-400"
          >
            {pending ? <RefreshCw className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
            Generate Projection
          </Button>
        )}
        {action === "REFRESH" && !isUnsupported && (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={onRefresh}
            className="border-2 border-black bg-yellow-300 font-extrabold text-black hover:bg-yellow-400"
          >
            <RefreshCw className={["mr-2 size-4", pending ? "animate-spin" : ""].join(" ")} />
            Refresh Projection
          </Button>
        )}
        {hasPrediction && onOpenDetail && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onOpenDetail(latestPredictionId)}
            className="border-2 border-black font-bold"
          >
            View Details
          </Button>
        )}
      </div>
    </Card>
  );
}
