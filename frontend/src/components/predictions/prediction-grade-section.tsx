import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { ArrowUpRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
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

  return (
    <Card className="flex flex-col bg-primary">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">{levelName}</h2>
        <div className="flex flex-row gap-3">
          {highRiskTotal > 0 && (
            <Badge size="sm" variant={"surface"} className="bg-destructive text-black font-bold" title="High Risk">
              {highRiskTotal} {highRiskTotal === 1 ? "High Risk" : "High Risks"}
            </Badge>
          )}
          {monitoringTotal > 0 && (
            <Badge size="sm" variant={"outline"} className="border-border font-bold" title="Monitoring">
              {monitoringTotal} Monitoring
            </Badge>
          )}
          <Button
            variant="secondary"
            className="shadow-none h-6 w-6 p-1 border-2 border-black"
            size="sm"
            onClick={() => navigate(`/${activeRole}/predictions/${gradeLevel}`)}
            title={`View ${levelName}`}
          >
            <ArrowUpRight className="size-4" />
          </Button>
        </div>
      </div>
      <div className="pt-3 flex flex-wrap gap-3">
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
