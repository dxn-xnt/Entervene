import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { getRiskBadgeMeta } from "@/lib/formatters";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Empty } from "@/components/retroui/Empty";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { cn } from "@/lib/utils";
import { GradeCard } from "./grade-card";
import { getTeacherRiskPercentage } from "./teacher-risk-display";
import type { AdminPredictionGradeSummary } from "./current-term-dashboard-adapter";

interface AdminPredictionGradeCardProps {
  group: AdminPredictionGradeSummary;
  className?: string;
}

export function AdminPredictionGradeCard({ group, className }: AdminPredictionGradeCardProps) {
  if (!group.sections.length) return null;

  const uniqueStudents = new Set(
    group.sections.flatMap((section) => section.students.map((student) => student.student_id)),
  ).size;
  const moderateRisk = group.sections.reduce((total, section) => total + section.moderate_risk_count, 0);
  const highRisk = group.sections.reduce((total, section) => total + section.high_risk_count, 0);
  const gradePath = `/admin/predictions/${group.grade_level}`;

  return (
    <Card className={cn("flex min-w-0 flex-col bg-background", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to={gradePath}
          className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
        >
          <h2 className="text-xl font-bold">Grade {group.grade_level}</h2>
        </Link>
        <div className="flex flex-row flex-wrap items-center gap-2">
          <Badge size="sm" className={getRiskBadgeMeta("MODERATE_RISK").bg}>
            {moderateRisk} Moderate Risk ({Math.round(getTeacherRiskPercentage(moderateRisk, uniqueStudents))}%)
          </Badge>
          <Badge size="sm" className={getRiskBadgeMeta("HIGH_RISK").bg}>
            {highRisk} High Risk ({Math.round(getTeacherRiskPercentage(highRisk, uniqueStudents))}%)
          </Badge>
          <Tooltip>
            <TooltipTrigger render={
              <Button
                asChild
                size="sm"
                variant="secondary"
                className="p-1 shadow-none"
                aria-label={`View Grade ${group.grade_level} predictions`}
              >
                <Link to={gradePath}>
                  <ArrowUpRight className="size-3" />
                </Link>
              </Button>
            } />
            <TooltipContent>View Grade {group.grade_level} predictions</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex flex-row flex-wrap gap-3 pt-2">
        {group.sections.length ? group.sections.map((section) => (
          <GradeCard
            key={section.class_id}
            name={section.section_name}
            classId={section.class_id}
            grade={section.grade_level}
            totalStudents={section.unique_student_count}
            highRisk={section.high_risk_count}
            moderateRisk={section.moderate_risk_count}
            lowRisk={section.on_track_count}
            role="admin"
            emptyLabel={section.prediction_count === 0 ? "No Predictions Yet" : undefined}
          />
        )) : (
          <Empty className="w-full border-2 border-black bg-white py-4 px-3 shadow-none hover:shadow-none justify-center">
            <Empty.Content className="gap-1">
              <Empty.Title className="text-sm font-bold text-foreground">
                No sections assigned
              </Empty.Title>
              <Empty.Description className="text-xs text-muted-foreground">
                No sections assigned in this grade.
              </Empty.Description>
            </Empty.Content>
          </Empty>
        )}
      </div>
    </Card>
  );
}
