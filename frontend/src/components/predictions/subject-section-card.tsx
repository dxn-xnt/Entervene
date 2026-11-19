import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { Card, Card as RetroCard } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Empty } from "@/components/retroui/Empty";
import { Progress } from "@/components/retroui/Progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { cn } from "@/lib/utils";
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
    <div className="flex flex-col items-start justify-between gap-1 w-full h-full">
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
        <div className="mt-1 flex w-full flex-row gap-2 flex-1 min-w-0">
          {riskList.map((risk) => (
            <Card
              key={risk.key}
              className="p-2 px-2.5 shadow-none gap-2 flex-1 min-w-0 flex flex-row items-center justify-center bg-white"
            >
              <Progress
                variant="circular"
                value={risk.percentage}
                className="size-16 sm:size-20 shrink-0"
              />
              <div className="flex flex-col items-center justify-center text-center gap-0.5 min-w-0">
                <span className="font-head text-2xl sm:text-3xl font-black text-foreground leading-none">{risk.count}</span>
                <span className="text-xs sm:text-sm font-medium text-foreground leading-tight whitespace-normal sm:whitespace-nowrap text-center">{risk.label}</span>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Empty className="mt-1 w-full flex-1 border-2 border-black bg-white py-4 px-3 md:p-4 shadow-none hover:shadow-none justify-center">
          <Empty.Content className="gap-1">
            <Empty.Icon className="size-6 text-muted-foreground flex items-center justify-center">
              <Sparkles className="size-5 text-muted-foreground" />
            </Empty.Icon>
            <Empty.Title className="text-base! font-bold text-foreground">
              {totalPredictions === 0 ? "No Predictions Yet" : "No Assessed Predictions"}
            </Empty.Title>
            <Empty.Description className="text-xs text-muted-foreground">
              {totalPredictions === 0
                ? "Projections will appear once grades are recorded"
                : "Predictions need assessed evidence to display risk"}
            </Empty.Description>
          </Empty.Content>
        </Empty>
      )}
    </div>
  );

  return (
    <RetroCard
      className={cn(
        "group relative flex flex-col justify-between shadow-none p-3 transition-transform min-w-[320px] sm:w-[420px] max-w-full bg-primary overflow-hidden",
        navigationEnabled && "hover:-translate-y-1",
      )}
    >
      {navigationEnabled ? (
        <Link
          to={targetUrl}
          className="min-w-0 flex-1 flex flex-col justify-between focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1 rounded"
          aria-label={`View ${name} predictions`}
        >
          {content}
        </Link>
      ) : (
        <div className="min-w-0 flex-1 flex flex-col justify-between">{content}</div>
      )}
    </RetroCard>
  );
}
