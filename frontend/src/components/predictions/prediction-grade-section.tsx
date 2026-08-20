import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { ArrowUpRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { GradeCard } from "./grade-card";

export interface GradeGroup {
  grade: number;
  classes: string[];
  highRisk: number;
  monitoring: number;
}

interface PredictionGradeSectionProps {
  group: GradeGroup;
  role?: "teacher" | "admin";
}

export function PredictionGradeSection({ group, role }: PredictionGradeSectionProps) {
  const { role: authRole } = useAuth();
  const activeRole = role ?? (authRole === "admin" ? "admin" : "teacher");
  const navigate = useNavigate();

  return (
    <Card className="flex flex-col bg-primary">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Grade {group.grade}</h2>
        <div className="flex flex-row gap-3">
          {group.highRisk > 0 && (
            <Badge size="sm" variant={"surface"} className="bg-destructive" title="High Risk">
              {group.highRisk} High Risks
            </Badge>
          )}
          {group.monitoring > 0 && (
            <Badge size="sm" variant={"outline"} className="border-border" title="Monitoring">
              {group.monitoring} Monitoring
            </Badge>
          )}
          <Button
            variant="secondary"
            className="shadow-none h-6 w-6 p-1"
            size="sm"
            onClick={() => navigate(`/${activeRole}/predictions/${group.grade}`)}
            title={`View Grade ${group.grade}`}
          >
            <ArrowUpRight className="size-4" />
          </Button>
        </div>
      </div>
      <div className="pt-3 flex gap-3 overflow-auto pb-2">
        {group.classes.map((cls) => (
          <GradeCard key={cls} name={cls} grade={group.grade} role={activeRole} />
        ))}
      </div>
    </Card>
  );
}
