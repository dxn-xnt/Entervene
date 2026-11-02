import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Accordion } from "@/components/retroui/Accordion";
import { ArrowUpRight, School } from "lucide-react";
import { EmptyStateCard } from "@/pages/admin/subjects/components/empty-state-card";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { GradeCard } from "./grade-card";
import type { DashboardGradeGroupSummary } from "@/lib/prediction-api";

export interface GradeGroup {
  grade: number;
  classes: string[];
  highRisk: number;
  monitoring: number;
}

interface PredictionGradeSectionProps {
  group: DashboardGradeGroupSummary | GradeGroup;
  role?: "teacher" | "admin";
}

export function PredictionGradeSection({ group, role }: PredictionGradeSectionProps) {
  const { role: authRole } = useAuth();
  const activeRole = role ?? (authRole === "admin" ? "admin" : "teacher");
  const navigate = useNavigate();

  const isDynamicGroup = "sections" in group;
  const gradeLevel = isDynamicGroup ? group.grade_level : group.grade;
  const levelName = isDynamicGroup ? group.level_name : `Grade ${group.grade}`;

  // Totals for header badges
  const highRiskTotal = isDynamicGroup
    ? group.sections.reduce((acc, s) => acc + s.high_risk_count, 0)
    : group.highRisk;
  const monitoringTotal = isDynamicGroup
    ? group.sections.reduce((acc, s) => acc + s.moderate_risk_count, 0)
    : group.monitoring;

  if (activeRole === "admin") {
    const sectionCount = isDynamicGroup ? group.sections.length : group.classes.length;
    const accordionValue = String(gradeLevel);
    return (
      <Accordion multiple defaultValue={[accordionValue]} className="w-full">
        <Accordion.Item value={accordionValue} className="overflow-hidden rounded border-2 border-border bg-background shadow-md">
          <Accordion.Header className="items-center bg-primary px-4 py-3 text-foreground">
            <div className="mr-2 flex w-full items-center justify-between gap-3">
              <h2 className="text-xl font-bold">{levelName}</h2>
              <Badge size="sm" variant="outline" className="shrink-0 border-border bg-background">
                {sectionCount} {sectionCount === 1 ? "section" : "sections"}
              </Badge>
            </div>
          </Accordion.Header>
          <Accordion.Content className="border-t-2 border-border bg-background p-4 pt-3">
            {sectionCount === 0 ? (
              <EmptyStateCard compact icon={<School />} title="No sections assigned" description="Sections assigned to this grade will appear here." />
            ) : (
              <div className="grid grid-cols-1 gap-3 py-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 [&>[data-slot=card]]:min-w-0">
                {isDynamicGroup ? group.sections.map((sec) => (
                  <GradeCard key={sec.class_id} name={sec.section_name} classId={sec.class_id} grade={gradeLevel} totalStudents={sec.total_students} highRisk={sec.high_risk_count} monitoring={sec.moderate_risk_count} role="admin" />
                )) : group.classes.map((name) => (
                  <GradeCard key={name} name={name} grade={gradeLevel} role="admin" />
                ))}
              </div>
            )}
          </Accordion.Content>
        </Accordion.Item>
      </Accordion>
    );
  }

  return (
    <Card variant="primary" className="flex flex-col">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">{levelName}</h2>
        <div className="flex flex-row gap-3">
          {highRiskTotal > 0 && (
            <Badge size="sm" variant={"surface"} className="bg-destructive text-black font-bold">
              {highRiskTotal} {highRiskTotal === 1 ? "High Risk" : "High Risks"}
            </Badge>
          )}
          {monitoringTotal > 0 && (
            <Badge size="sm" variant={"outline"} className="border-border font-bold">
              {monitoringTotal} Monitoring
            </Badge>
          )}
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex"><Button
              variant="secondary"
              className="shadow-none h-6 w-6 p-1 border-2 border-black"
              size="sm"
              onClick={() => navigate(`/${activeRole}/predictions/${gradeLevel}`)}
              aria-label={`View ${levelName} predictions`}
            >
              <ArrowUpRight className="size-4" />
            </Button></span>} />
            <TooltipContent>View {levelName} predictions</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 pt-1">
        {isDynamicGroup ? (
          group.sections.length > 0 ? (
            group.sections.map((sec) => (
              <GradeCard
                key={sec.class_id}
                name={sec.section_name}
                classId={sec.class_id}
                grade={gradeLevel}
                totalStudents={sec.total_students}
                highRisk={sec.high_risk_count}
                monitoring={sec.moderate_risk_count}
                role={activeRole}
              />
            ))
          ) : (
            <p className="text-xs text-muted-foreground italic py-2">No sections assigned in this grade.</p>
          )
        ) : (
          group.classes.map((cls) => (
            <GradeCard key={cls} name={cls} grade={gradeLevel} role={activeRole} />
          ))
        )}
      </div>
    </Card>
  );
}
