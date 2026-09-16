import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import type { PeriodOutcome } from "@/lib/prediction-api";
import { formatGrade } from "./prediction-status-copy";

interface OfficialOutcomePanelProps {
  outcome: PeriodOutcome;
}

export function OfficialOutcomePanel({ outcome }: OfficialOutcomePanelProps) {
  if (outcome.status !== "FINALIZED") {
    return (
      <Card className="border-2 border-black bg-white p-3 shadow-none">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase text-gray-500">Official Outcome</p>
            <p className="text-sm font-bold text-gray-800">Grading period in progress</p>
          </div>
          <Badge size="sm" className="border border-black bg-gray-100 text-black">
            In Progress
          </Badge>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-black bg-emerald-100 p-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-extrabold uppercase text-emerald-900">Official Final Grade</p>
          <p className="text-2xl font-black text-black">{formatGrade(outcome.actual_grade)}</p>
        </div>
        <Badge size="sm" className="border border-black bg-white text-black">
          Finalized
        </Badge>
      </div>
    </Card>
  );
}
