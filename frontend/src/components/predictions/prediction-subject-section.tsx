import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { SubjectSectionCard } from "./subject-section-card";
import type { DashboardSubjectGroupSummary } from "./current-term-dashboard-adapter";
import { getTeacherRiskDisplaySummary } from "./teacher-risk-display";
import { getRiskBadgeMeta } from "@/lib/formatters";

interface PredictionSubjectSectionProps {
  group: DashboardSubjectGroupSummary;
  navigationEnabled?: boolean;
  predictionBasePath?: string;
}

export function PredictionSubjectSection({
  group,
  navigationEnabled = true,
  predictionBasePath = "/teacher/predictions",
}: PredictionSubjectSectionProps) {
  const displaySummary = getTeacherRiskDisplaySummary({
    HIGH_RISK: group.high_risk_count,
    MODERATE_RISK: group.moderate_risk_count,
    NEEDS_MONITORING: group.needs_monitoring_count,
    LOW_RISK: group.low_risk_count,
    INSUFFICIENT_DATA: Math.max(
      0,
      group.total_predictions
        - group.high_risk_count
        - group.moderate_risk_count
        - group.needs_monitoring_count
        - group.low_risk_count,
    ),
    total: group.total_predictions,
  });

  return (
    <Card className="flex flex-col bg-primary">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold">{group.display_name}</h2>
        </div>
        <div className="flex flex-row flex-wrap gap-2 items-center">
          <Badge size="sm" className={getRiskBadgeMeta("MODERATE_RISK").bg}>
            {displaySummary.MODERATE_RISK} Moderate Risk
          </Badge>
          <Badge size="sm" className={getRiskBadgeMeta("HIGH_RISK").bg}>
            {displaySummary.HIGH_RISK} High Risk
          </Badge>
          {navigationEnabled && <Tooltip>
            <TooltipTrigger render={
              <Button
                asChild
                size="sm"
                variant="secondary"
                className="shadow-none p-1"
                aria-label={`View ${group.display_name} predictions`}
              >
                <Link to={`${predictionBasePath}/subject/${group.subject_id}`}>
                  <ArrowUpRight className="size-3" />
                </Link>
              </Button>
            } />
            <TooltipContent>View all {group.display_name} predictions</TooltipContent>
          </Tooltip>}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 pt-2">
        {group.sections.length > 0 ? (
          group.sections.map((sec) => (
            <SubjectSectionCard
              key={sec.class_id}
              subjectId={group.subject_id}
              classId={sec.class_id}
              name={sec.section_name}
              gradeLevel={sec.grade_level}
              totalPredictions={sec.total_predictions}
              highRisk={sec.high_risk_count}
              moderateRisk={sec.moderate_risk_count}
              needsMonitoring={sec.needs_monitoring_count}
              lowRisk={sec.low_risk_count}
              navigationEnabled={navigationEnabled}
              predictionBasePath={predictionBasePath}
            />
          ))
        ) : (
          <p className="text-xs text-muted-foreground italic py-2">
            No sections assigned in this subject.
          </p>
        )}
      </div>
    </Card>
  );
}
