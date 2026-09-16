import type { PredictionRosterStudentItem } from "@/lib/prediction-api";
import { OfficialOutcomePanel } from "./official-outcome-panel";
import { ProjectedFinalGradePanel } from "./projected-final-grade-panel";

interface PredictionStudentCardProps {
  item: PredictionRosterStudentItem;
  actionPending?: boolean;
  onGenerate: (item: PredictionRosterStudentItem) => void;
  onRefresh: (item: PredictionRosterStudentItem) => void;
  onOpenDetail: (predictionId: number) => void;
}

export function PredictionStudentCard({
  item,
  actionPending = false,
  onGenerate,
  onRefresh,
  onOpenDetail,
}: PredictionStudentCardProps) {
  const finalized = item.period_outcome.status === "FINALIZED";

  return (
    <article className="flex flex-col gap-3 rounded border-2 border-black bg-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <div className="flex flex-col gap-2 border-b-2 border-black/20 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-black text-black">{item.student.student_name}</h3>
          <p className="font-mono text-xs font-semibold text-gray-500">LRN: {item.student.student_lrn || "—"}</p>
        </div>
        <div className="text-xs font-extrabold uppercase text-gray-500 sm:text-right">
          {finalized ? "Official outcome available" : "Projected final grade"}
        </div>
      </div>

      <OfficialOutcomePanel outcome={item.period_outcome} />

      <div className="grid grid-cols-1 gap-3">
        <ProjectedFinalGradePanel
          currentProjection={item.current_projection}
          periodOutcome={item.period_outcome}
          emphasized={!finalized && item.current_projection.latest_prediction_id != null}
          pending={actionPending}
          onGenerate={() => onGenerate(item)}
          onRefresh={() => onRefresh(item)}
          onOpenDetail={onOpenDetail}
        />
      </div>
    </article>
  );
}
