import type { RiskSummary } from "@/lib/prediction-api";

export type TeacherRiskDisplayLevel =
  | "HIGH_RISK"
  | "MODERATE_RISK"
  | "ON_TRACK"
  | "INSUFFICIENT_DATA"
  | "NOT_ASSESSED";

export const TEACHER_RISK_FILTER_OPTIONS: Array<{
  value: TeacherRiskDisplayLevel;
  label: string;
}> = [
  { value: "HIGH_RISK", label: "High Risk" },
  { value: "MODERATE_RISK", label: "Moderate Risk" },
  { value: "ON_TRACK", label: "On Track" },
  { value: "INSUFFICIENT_DATA", label: "Insufficient Data" },
];

export function getTeacherRiskDisplay(riskLevel?: string | null): {
  level: TeacherRiskDisplayLevel | string;
  label: string;
} {
  switch (riskLevel) {
    case "HIGH_RISK":
      return { level: "HIGH_RISK", label: "High Risk" };
    case "MODERATE_RISK":
      return { level: "MODERATE_RISK", label: "Moderate Risk" };
    case "NEEDS_MONITORING":
    case "LOW_RISK":
      return { level: "ON_TRACK", label: "On Track" };
    case "INSUFFICIENT_DATA":
      return { level: "INSUFFICIENT_DATA", label: "Insufficient Data" };
    case "INTERVENTION_NOT_ASSESSED":
    case "NOT_ASSESSED":
      return { level: "NOT_ASSESSED", label: "Not Assessed" };
    default:
      return { level: riskLevel || "NOT_ASSESSED", label: riskLevel || "Not Assessed" };
  }
}

export function matchesTeacherRiskFilter(
  riskLevel: string,
  filter?: string,
): boolean {
  if (!filter) return true;
  if (filter === "ON_TRACK") {
    return riskLevel === "LOW_RISK" || riskLevel === "NEEDS_MONITORING";
  }
  return riskLevel === filter;
}

export function getTeacherRiskFilterCount(
  summary: RiskSummary,
  filter: string,
): number | undefined {
  if (filter === "ON_TRACK") {
    return summary.LOW_RISK + summary.NEEDS_MONITORING;
  }
  if (filter in summary && filter !== "total") {
    return summary[filter as Exclude<keyof RiskSummary, "total">];
  }
  return undefined;
}

export interface TeacherRiskDisplaySummary {
  MODERATE_RISK: number;
  HIGH_RISK: number;
  ON_TRACK: number;
  NOT_ASSESSED: number;
  assessedTotal: number;
  total: number;
}

export function getTeacherRiskDisplaySummary(
  summary: Pick<
    RiskSummary,
    "HIGH_RISK" | "MODERATE_RISK" | "NEEDS_MONITORING" | "LOW_RISK" | "INSUFFICIENT_DATA" | "total"
  >,
): TeacherRiskDisplaySummary {
  const onTrack = summary.LOW_RISK + summary.NEEDS_MONITORING;
  const assessedTotal = summary.HIGH_RISK + summary.MODERATE_RISK + onTrack;
  return {
    MODERATE_RISK: summary.MODERATE_RISK,
    HIGH_RISK: summary.HIGH_RISK,
    ON_TRACK: onTrack,
    NOT_ASSESSED: summary.INSUFFICIENT_DATA,
    assessedTotal,
    total: summary.total,
  };
}

export function getTeacherRiskPercentage(count: number, assessedTotal: number): number {
  return assessedTotal > 0 ? (count / assessedTotal) * 100 : 0;
}
