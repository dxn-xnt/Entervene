import type { TeacherInterventionSummary } from "@/lib/teacher-interventions-api";

export function InterventionPredictionHistory({
  item,
}: {
  item: TeacherInterventionSummary;
}) {
  if (item.current_prediction_status === "UNAVAILABLE" && item.current_predicted_grade == null) {
    return <span className="font-semibold tabular-nums">Unavailable</span>;
  }

  const currentGrade = item.current_predicted_grade ?? item.triggering_predicted_grade;

  return (
    <span className="font-semibold tabular-nums">{currentGrade.toFixed(2)}</span>
  );
}
