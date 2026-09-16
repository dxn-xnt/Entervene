import type {
  CurrentProjectionAction,
  CurrentProjectionSummary,
  DualPurposeRosterStudentItem,
  PeriodOutcome,
} from "@/lib/prediction-api";

export function formatGrade(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toFixed(2);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function readinessLabel(level: string | null | undefined): string {
  switch (level) {
    case "STANDARD_READY":
      return "Enough academic evidence is available";
    case "HIGH_EVIDENCE":
      return "More complete academic evidence is available";
    case "EARLY_PRIOR_READY":
      return "Previous official grade is available for an early projection";
    case "LIMITED_EVIDENCE":
      return "Some academic evidence is available";
    case "INSUFFICIENT_EVIDENCE":
      return "More graded activities are needed";
    default:
      return "Evidence status unavailable";
  }
}

export function freshnessLabel(status: string | null | undefined): string {
  switch (status) {
    case "NO_PROJECTION":
      return "No current projection yet";
    case "CURRENT":
      return "Projection is current";
    case "SOURCE_EVIDENCE_CHANGED":
      return "New grades have been recorded since this projection";
    case "MODEL_UPDATE_AVAILABLE":
      return "A newer prediction model is available";
    case "FRESHNESS_UNAVAILABLE":
    case "UNKNOWN":
      return "This older projection cannot be fully compared with current evidence";
    case "FINALIZED":
      return "This grading period is already finalized";
    default:
      return "Projection status unavailable";
  }
}

export function modelCurrencyLabel(status: string | null | undefined): string {
  switch (status) {
    case "CURRENT":
      return "Model version is current";
    case "MODEL_UPDATE_AVAILABLE":
      return "A newer prediction model is available";
    case "MODEL_UNAVAILABLE":
      return "The current prediction model is temporarily unavailable";
    default:
      return "Model status unavailable";
  }
}

export function generationStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "CREATED":
      return "Projection generated";
    case "REPLAYED":
      return "Projection request replayed";
    case "UNCHANGED":
      return "Projection is already current";
    case "EXISTING_PROJECTION":
      return "A current projection already exists";
    case "NOT_READY":
      return "More graded activities are needed";
    case "DOMAIN_INCOMPATIBLE":
    case "OUT_OF_DOMAIN":
    case "DOMAIN_UNSUPPORTED":
      return "The available data is outside this model's supported conditions";
    case "FINALIZED":
      return "This grading period is already finalized";
    case "MODEL_UNAVAILABLE":
      return "The current prediction model is temporarily unavailable";
    default:
      return status ? status.replaceAll("_", " ") : "Action completed";
  }
}

export function riskLabel(level: string | null | undefined): string {
  switch (level) {
    case "HIGH_RISK":
      return "High Risk";
    case "MODERATE_RISK":
      return "Moderate Risk";
    case "NEEDS_MONITORING":
      return "Needs Monitoring";
    case "LOW_RISK":
      return "Low Risk";
    case "INSUFFICIENT_DATA":
      return "Insufficient Data";
    default:
      return level ? level.replaceAll("_", " ") : "Risk not evaluated";
  }
}

export function getCurrentProjectionAction(
  currentProjection: CurrentProjectionSummary,
  periodOutcome: PeriodOutcome
): CurrentProjectionAction {
  if (periodOutcome.status === "FINALIZED") return "NONE";

  const freshness = currentProjection.projection_freshness?.status;
  const latestPredictionId = currentProjection.latest_prediction_id;
  const eligible = currentProjection.refresh_eligibility?.eligible === true;

  if (
    latestPredictionId == null &&
    freshness === "NO_PROJECTION" &&
    eligible
  ) {
    return "GENERATE";
  }

  if (latestPredictionId != null && eligible) {
    return "REFRESH";
  }

  return "NONE";
}

export function sortedPredictionPanels(item: DualPurposeRosterStudentItem): Array<"current" | "baseline"> {
  if (item.primary_display === "CURRENT_PROJECTION") return ["current", "baseline"];
  if (item.primary_display === "BASELINE_FORECAST") return ["baseline", "current"];
  return ["current", "baseline"];
}
