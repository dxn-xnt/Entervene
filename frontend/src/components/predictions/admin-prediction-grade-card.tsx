import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { GradeCard } from "./grade-card";
import { getTeacherRiskPercentage } from "./teacher-risk-display";
import type { AdminPredictionGradeSummary } from "./current-term-dashboard-adapter";

interface AdminPredictionGradeCardProps {
  group: AdminPredictionGradeSummary;
}

export function AdminPredictionGradeCard({ group }: AdminPredictionGradeCardProps) {
  const uniqueStudents = new Set(
    group.sections.flatMap((section) => section.students.map((student) => student.student_id)),
  ).size;
  const moderateRisk = group.sections.reduce((total, section) => total + section.moderate_risk_count, 0);
  const highRisk = group.sections.reduce((total, section) => total + section.high_risk_count, 0);
  const onTrack = group.sections.reduce((total, section) => total + section.on_track_count, 0);
  const gradePath = `/admin/predictions/${group.grade_level}`;

  return (
    <Card className="flex min-w-0 flex-col bg-primary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to={gradePath}
          className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
        >
          <h2 className="text-xl font-bold">Grade {group.grade_level}</h2>
        </Link>
        <div className="flex flex-row flex-wrap items-center gap-2">
          <Badge size="sm" variant="solid">
            {moderateRisk} Moderate Risk ({Math.round(getTeacherRiskPercentage(moderateRisk, uniqueStudents))}%)
          </Badge>
          <Badge size="sm" variant="destructive">
            {highRisk} High Risk ({Math.round(getTeacherRiskPercentage(highRisk, uniqueStudents))}%)
          </Badge>
          <Badge size="sm" variant="outline">
            {onTrack} On Track ({Math.round(getTeacherRiskPercentage(onTrack, uniqueStudents))}%)
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

      <div className="flex flex-wrap gap-3 pt-2">
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
          <p className="py-2 text-xs italic text-muted-foreground">No sections assigned in this grade.</p>
        )}
      </div>
    </Card>
  );
}
