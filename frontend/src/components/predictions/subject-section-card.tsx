import { Link } from "react-router-dom";
import { Card, Card as RetroCard } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Progress } from "@/components/retroui/Progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { getTeacherRiskDisplaySummary, getTeacherRiskPercentage } from "./teacher-risk-display";

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
  totalPredictions = 0,
  highRisk = 0,
  moderateRisk = 0,
  needsMonitoring = 0,
  lowRisk = 0,
}: SubjectSectionCardProps) {
  const displaySummary = getTeacherRiskDisplaySummary({
    HIGH_RISK: highRisk,
    MODERATE_RISK: moderateRisk,
    NEEDS_MONITORING: needsMonitoring,
    LOW_RISK: lowRisk,
    INSUFFICIENT_DATA: Math.max(0, totalPredictions - highRisk - moderateRisk - needsMonitoring - lowRisk),
    total: totalPredictions,
  });
  const riskList = [
    { key: "moderate_risk", label: "Moderate Risk", count: displaySummary.MODERATE_RISK },
    { key: "high_risk", label: "High Risk", count: displaySummary.HIGH_RISK },
    { key: "on_track", label: "On Track", count: displaySummary.ON_TRACK },
  ].map((risk) => ({
    ...risk,
    percentage: getTeacherRiskPercentage(risk.count, displaySummary.assessedTotal),
  }));

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
          {displaySummary.assessedTotal > 0 ? (
            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3">
              {riskList.map((risk) => (
                <Card
                  key={risk.key}
                  className="flex min-w-0 flex-row items-center gap-2 bg-white p-2 shadow-none sm:flex-col sm:justify-center"
                >
                  <Progress
                    variant="circular"
                    value={risk.percentage}
                    className="size-14 shrink-0"
                  />
                  <div className="flex flex-col items-center justify-center min-w-0">
                    <span className="font-head text-xl font-black text-foreground">{risk.count}</span>
                    <span className="text-xs font-semibold whitespace-nowrap">{risk.label}</span>
                  </div>
                </Card>
              ))}
            </div>
          ) : totalPredictions === 0 ? (
            <div className="w-full rounded! py-2.5 px-3 bg-gray-100 border border-black text-center shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                No Predictions Yet
              </span>
            </div>
          ) : (
            <div className="w-full rounded! py-2.5 px-3 bg-gray-100 border border-black text-center shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                No Assessed Predictions
              </span>
            </div>
          )}
        </div>
      </Link>
    </RetroCard>
  );
}
