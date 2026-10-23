import { Link } from "react-router-dom";
import { Card, Card as RetroCard } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Progress } from "@/components/retroui/Progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";

export interface SubjectSectionCardProps {
  subjectId: number;
  classId: number;
  name: string;
  gradeLevel?: number | null;
  totalPredictions?: number;
  highRisk?: number;
  moderateRisk?: number;
  needsMonitoring?: number;
  lowRisk?: number;
}

export function SubjectSectionCard({
  subjectId,
  classId,
  name,
  gradeLevel: _gradeLevel,
  totalPredictions = 0,
  highRisk = 0,
  moderateRisk = 0,
  needsMonitoring = 0,
  lowRisk = 0,
}: SubjectSectionCardProps) {
  const riskList: {
    key: string;
    label: string;
    count: number;
    percentage: number;
    priority: number;
  }[] = [];

  if (highRisk > 0) {
    riskList.push({
      key: "high_risk",
      label: highRisk === 1 ? "High Risk" : "High Risks",
      count: highRisk,
      percentage: totalPredictions > 0 ? (highRisk / totalPredictions) * 100 : 0,
      priority: 1,
    });
  }

  if (moderateRisk > 0) {
    riskList.push({
      key: "moderate_risk",
      label: "Moderate Risk",
      count: moderateRisk,
      percentage: totalPredictions > 0 ? (moderateRisk / totalPredictions) * 100 : 0,
      priority: 2,
    });
  }

  if (needsMonitoring > 0) {
    riskList.push({
      key: "needs_monitoring",
      label: "Monitoring",
      count: needsMonitoring,
      percentage: totalPredictions > 0 ? (needsMonitoring / totalPredictions) * 100 : 0,
      priority: 3,
    });
  }

  if (lowRisk > 0) {
    riskList.push({
      key: "low_risk",
      label: "Low Risk",
      count: lowRisk,
      percentage: totalPredictions > 0 ? (lowRisk / totalPredictions) * 100 : 0,
      priority: 4,
    });
  }

  const topRisks = riskList
    .sort((a, b) => b.count - a.count || a.priority - b.priority)
    .slice(0, 2);

  const targetUrl = `/teacher/predictions/subject/${subjectId}/section/${classId}`;

  return (
    <RetroCard className="group relative flex flex-col justify-between shadow-none p-3 hover:-translate-y-1 transition-transform min-w-[200px] max-w-full">
      <Link
        to={targetUrl}
        className="min-w-0 flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1 rounded"
        aria-label={`View ${name} predictions`}
      >
        <div className="flex flex-col items-start justify-between gap-1">
          <div className="flex flex-row w-full justify-between items-center gap-2">
            <div className="min-w-0 flex-1">
              <Tooltip>
                <TooltipTrigger render={<p className="text-lg font-bold leading-tight truncate">{name}</p>} />
                <TooltipContent>{name}</TooltipContent>
              </Tooltip>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Badge size="sm" variant="solid">
                {totalPredictions} {totalPredictions === 1 ? "Prediction" : "Predictions"}
              </Badge>
            </div>
          </div>
          {topRisks.length > 0 ? (
            <div className="flex flex-row w-full gap-2">
              {topRisks.map((risk) => (
                <Card
                  key={risk.key}
                  className="p-2 px-2 shadow-none gap-2 flex-1 flex flex-row items-center bg-white min-w-0"
                >
                  <Progress
                    variant="circular"
                    value={risk.percentage}
                    className="size-20 shrink-0"
                  />
                  <div className="flex flex-col items-center justify-center min-w-0">
                    <span className="font-head text-xl font-black text-foreground">{risk.count}</span>
                    <span className="text-xs font-semibold whitespace-nowrap">{risk.label}</span>
                  </div>
                </Card>
              ))}
            </div>
          ) : totalPredictions === 0 ? (
            <div className="w-full py-2.5 px-3 bg-gray-100 border border-black text-center shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                No Predictions Yet
              </span>
            </div>
          ) : (
            <div className="w-full py-2.5 px-3 bg-emerald-100/70 border border-black text-center shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
              <span className="text-xs font-bold text-emerald-950 uppercase tracking-wide">
                No At-Risk Students
              </span>
            </div>
          )}
        </div>
      </Link>
    </RetroCard>
  );
}
