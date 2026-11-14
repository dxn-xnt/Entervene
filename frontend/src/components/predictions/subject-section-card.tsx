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
  navigationEnabled?: boolean;
  predictionBasePath?: string;
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
  navigationEnabled = true,
  predictionBasePath = "/teacher/predictions",
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
  ].map((risk) => ({
    ...risk,
    percentage: getTeacherRiskPercentage(risk.count, displaySummary.assessedTotal),
  }));

  const targetUrl = `${predictionBasePath}/subject/${subjectId}/section/${classId}`;

  const content = (
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
            <div className="mt-1 flex w-full flex-row gap-2">
              {riskList.map((risk) => (
                <Card
                  key={risk.key}
                  className="p-2 px-3 shadow-none gap-2 w-full flex flex-row items-center justify-center bg-white"
                >
                  <Progress
                    variant="circular"
                    value={risk.percentage}
                    className="size-20 shrink-0"
                  />
                  <div className="flex flex-col items-center justify-center text-center gap-1">
                    <span className="font-head text-3xl font-black text-foreground leading-none">{risk.count}</span>
                    <span className="text-sm font-medium text-foreground leading-tight whitespace-nowrap text-center">{risk.label}</span>
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
  );

  return (
    <RetroCard className={`group relative flex flex-col justify-between shadow-none p-3 transition-transform min-w-[320px] max-w-full bg-primary ${navigationEnabled ? "hover:-translate-y-1" : ""}`}>
      {navigationEnabled ? (
        <Link
          to={targetUrl}
          className="min-w-0 flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1 rounded"
          aria-label={`View ${name} predictions`}
        >
          {content}
        </Link>
      ) : (
        <div className="min-w-0 flex-1">{content}</div>
      )}
    </RetroCard>
  );
}
