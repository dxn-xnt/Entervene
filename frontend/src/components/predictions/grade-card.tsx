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
  moderateRisk?: number;
  monitoring?: number;
  lowRisk?: number;
  insufficientData?: number;
  role?: "teacher" | "admin";
}

export function GradeCard({
  name,
  grade,
  classId,
  totalStudents = 0,
  highRisk = 0,
  moderateRisk = 0,
  monitoring = 0,
  lowRisk = 0,
  insufficientData = 0,
  role,
}: GradeCardProps) {
  const { role: authRole } = useAuth();
  const activeRole = role ?? (authRole === "admin" ? "admin" : "teacher");

  const riskList: {
    key: string;
    label: string;
    count: number;
    percentage: number;
    priority: number;
  }[] = [];

  if (highRisk > 0) {
    riskList.push({
      key: "high_risk",
      label: highRisk === 1 ? "High Risk" : "High Risks",
      count: highRisk,
      percentage: totalStudents > 0 ? (highRisk / totalStudents) * 100 : 0,
      priority: 1,
    });
  }

  const monitoringCount = monitoring || moderateRisk;
  if (monitoringCount > 0) {
    riskList.push({
      key: "monitoring",
      label: "Monitoring",
      count: monitoringCount,
      percentage: totalStudents > 0 ? (monitoringCount / totalStudents) * 100 : 0,
      priority: 2,
    });
  }

  if (insufficientData > 0) {
    riskList.push({
      key: "insufficient_data",
      label: "Insufficient Data",
      count: insufficientData,
      percentage: totalStudents > 0 ? (insufficientData / totalStudents) * 100 : 0,
      priority: 3,
    });
  }

  if (lowRisk > 0) {
    riskList.push({
      key: "low_risk",
      label: "Low Risk",
      count: lowRisk,
      percentage: totalStudents > 0 ? (lowRisk / totalStudents) * 100 : 0,
      priority: 4,
    });
  }

  const topRisks = riskList
    .sort((a, b) => b.count - a.count || a.priority - b.priority)
    .slice(0, 2);

  const targetUrl = `/${activeRole}/predictions/${grade}/${classId !== undefined ? classId : encodeURIComponent(name)}`;

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
              <p className="text-lg font-bold leading-tight truncate" title={name}>{name}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Badge size="sm" variant="solid">
                {totalStudents} {totalStudents === 1 ? "Student" : "Students"}
              </Badge>
            </div>
          </div>
          {topRisks.length > 0 ? (
            <div className="flex flex-row w-full gap-2">
              {topRisks.map((risk) => (
                <Card
                  key={risk.key}
                  className="p-2 px-2 shadow-none gap-2 flex-1 flex flex-row items-center border border-black bg-white min-w-0"
                >
                  <Progress
                    variant="circular"
                    value={risk.percentage}
                    className="size-20 shrink-0"
                  />
                  <div className="flex flex-col items-center justify-center min-w-0">
                    <span className="font-head text-xl font-black text-foreground">{risk.count}</span>
                    <span className="text-xs font-semibold whitespace-nowrap">{risk.label}</span>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <div className="w-full py-2.5 px-3 bg-emerald-100/70 border border-black text-center shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
              <span className="text-xs font-bold text-emerald-950 uppercase tracking-wide">
                No At-Risk Students
              </span>
            </div>
          )}
        </div>
      </Link>
    </RetroCard>
  );
}
