import type { DevelopmentInterventionLevel } from "@/lib/prediction-api";

export const INTERVENTION_LABELS: Record<DevelopmentInterventionLevel, string> = {
  HIGH_RISK: "High Risk",
  MODERATE_RISK: "Moderate Risk",
  NEEDS_MONITORING: "Needs Monitoring",
  LOW_RISK: "Low Risk",
};

export const BLOCKED_MESSAGES: Record<string, string> = {
  INSUFFICIENT_EVIDENCE: "Not enough current-term evidence is available yet.",
  UNSUPPORTED_DEVELOPMENT_DOMAIN: "This subject or grading structure is not supported by the current development model.",
  INVALID_PERIOD_SCOPE: "This projection must use the same current academic term.",
  FINALIZED_GRADE_EXISTS: "A final term grade already exists, so a projection is no longer needed.",
  PERIOD_NOT_ACTIVE: "This academic term is not active. An administrator must select the operational term before generating projections.",
  SCHEMA_CONTRACT_ERROR: "The current evidence could not be assessed by this development model.",
};
