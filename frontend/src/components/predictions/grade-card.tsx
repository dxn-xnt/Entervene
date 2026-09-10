import { Card, Card as RetroCard } from "@/components/retroui/Card";
import { Link } from "react-router-dom";
import { Badge } from "@/components/retroui/Badge";
import { Progress } from "../retroui/Progress";
import { useAuth } from "@/context/AuthContext";

export interface GradeCardProps {
  name: string;
  grade: number;
  classId?: number;
  totalStudents?: number;
  highRisk?: number;
  monitoring?: number;
  role?: "teacher" | "admin";
}

export function GradeCard({
  name,
  grade,
  classId,
  totalStudents = 0,
  highRisk = 0,
  monitoring = 0,
  role,
}: GradeCardProps) {
  const { role: authRole } = useAuth();
  const activeRole = role ?? (authRole === "admin" ? "admin" : "teacher");

  const highRiskPct = totalStudents > 0 ? (highRisk / totalStudents) * 100 : 0;
  const monitoringPct = totalStudents > 0 ? (monitoring / totalStudents) * 100 : 0;

  const targetUrl = `/${activeRole}/predictions/${grade}/${classId !== undefined ? classId : encodeURIComponent(name)}`;

  return (
    <RetroCard className="group relative flex flex-col justify-between shadow-none p-3 hover:-translate-y-1 transition-transform flex-1 min-w-[200px] max-w-full">
      <Link
        to={targetUrl}
        className="min-w-0 flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1 rounded"
        aria-label={`View ${name} predictions`}
      >
        <div className="flex flex-col items-start justify-between gap-2">
          <div className="flex flex-row w-full justify-between items-center">
            <div>
              <p className="text-lg font-bold leading-tight truncate">{name}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Badge size="sm" variant="solid">
                {totalStudents} {totalStudents === 1 ? "Student" : "Students"}
              </Badge>
            </div>
          </div>
          <div className="flex flex-row w-full gap-2">
            <Card className="p-2 px-2 shadow-none gap-2 flex-1 flex flex-row items-center border border-black bg-white min-w-0">
              <Progress
                variant="circular"
                value={highRiskPct}
                className="size-12 shrink-0"
              />
              <div className="flex flex-col items-center justify-center min-w-0">
                <span className="font-head text-xl font-black text-foreground">{highRisk}</span>
                <span className="text-[11px] font-semibold text-destructive whitespace-nowrap">{highRisk === 1 ? "High Risk" : "High Risks"}</span>
              </div>
            </Card>
            <Card className="p-2 px-2 flex-1 shadow-none gap-2 flex flex-row items-center border border-black bg-white min-w-0">
              <Progress
                variant="circular"
                value={monitoringPct}
                className="size-12 shrink-0"
              />
              <div className="flex flex-col items-center justify-center min-w-0">
                <span className="font-head text-xl font-black text-foreground">{monitoring}</span>
                <span className="text-[11px] font-semibold text-amber-700 whitespace-nowrap">Monitoring</span>
              </div>
            </Card>
          </div>
        </div>
      </Link>
    </RetroCard>
  );
}
