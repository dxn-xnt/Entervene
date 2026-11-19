import type { TeacherInterventionSummary } from "@/lib/teacher-interventions-api";

export function InterventionPredictionHistory({
  item,
}: {
  item: TeacherInterventionSummary;
}) {
  const currentGrade = item.current_predicted_grade ?? item.triggering_predicted_grade;

  return (
    <span className="font-semibold tabular-nums">{currentGrade.toFixed(2)}</span>
  );
}
