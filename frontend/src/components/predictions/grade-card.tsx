import { Card, Card as RetroCard } from "@/components/retroui/Card";
import { Link } from "react-router-dom";
import { Badge } from "@/components/retroui/Badge";
import { Progress } from "../retroui/Progress";
import { useAuth } from "@/context/AuthContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";

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
  emptyLabel?: string;
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
  role,
  emptyLabel = "No At-Risk Students",
}: GradeCardProps) {
  const { role: authRole } = useAuth();
  const activeRole = role ?? (authRole === "admin" ? "admin" : "teacher");

  const moderateCount = moderateRisk || monitoring;
  const riskList = [
    {
      key: "moderate_risk",
      label: "Moderate Risk",
      count: moderateCount,
      percentage: totalStudents > 0 ? (moderateCount / totalStudents) * 100 : 0,
    },
    {
      key: "high_risk",
      label: "High Risk",
      count: highRisk,
      percentage: totalStudents > 0 ? (highRisk / totalStudents) * 100 : 0,
    },
    {
      key: "on_track",
      label: "On Track",
      count: lowRisk,
      percentage: totalStudents > 0 ? (lowRisk / totalStudents) * 100 : 0,
    },
  ];

  const targetUrl = `/${activeRole}/predictions/${grade}/${classId !== undefined ? classId : encodeURIComponent(name)}`;

  return (
    <RetroCard className="group relative flex min-w-[200px] max-w-full flex-col justify-between p-3 shadow-none transition-transform hover:-translate-y-1 hover:shadow-none">
      <Link
        to={targetUrl}
        className="min-w-0 flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1 rounded"
        aria-label={`View ${name} predictions`}
      >
        <div className="flex flex-col items-start justify-between gap-3">
          <div className="flex w-full flex-row items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Tooltip>
                <TooltipTrigger render={<p className="text-lg font-bold leading-tight truncate">{name}</p>} />
                <TooltipContent>{name}</TooltipContent>
              </Tooltip>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Badge size="sm" variant="solid">
                {totalStudents} {totalStudents === 1 ? "Student" : "Students"}
              </Badge>
            </div>
          </div>
          {totalStudents > 0 ? (
            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3">
              {riskList.map((risk) => (
                <Card
                  key={risk.key}
                  className="flex min-w-0 flex-row items-center gap-2 bg-white p-2 shadow-none sm:flex-col sm:justify-center"
                >
                  <Progress
                    variant="circular"
                    value={risk.percentage}
                    className="size-14 shrink-0"
                  />
                  <div className="flex min-w-0 flex-col items-center justify-center">
                    <span className="font-head text-xl font-black text-foreground">{risk.count}</span>
                    <span className="text-xs font-semibold whitespace-nowrap">{risk.label}</span>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="w-full border border-border bg-emerald-100/70 px-3 py-2.5 text-center shadow-none hover:shadow-none">
              <span className="text-xs font-bold text-emerald-950 uppercase tracking-wide">
                {emptyLabel}
              </span>
            </Card>
          )}
        </div>
      </Link>
    </RetroCard>
  );
}
