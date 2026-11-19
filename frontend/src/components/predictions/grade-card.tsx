import { Card, Card as RetroCard } from "@/components/retroui/Card";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Empty } from "@/components/retroui/Empty";
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
  ];

  const targetUrl = `/${activeRole}/predictions/${grade}/${classId !== undefined ? classId : encodeURIComponent(name)}`;

  return (
    <RetroCard className="group relative flex min-w-[320px] sm:w-[420px] max-w-full flex-col justify-between p-3 shadow-none transition-transform bg-primary hover:-translate-y-1 hover:shadow-none overflow-hidden">
      <Link
        to={targetUrl}
        className="min-w-0 flex-1 flex flex-col justify-between focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1 rounded"
        aria-label={`View ${name} predictions`}
      >
        <div className="flex flex-col items-start justify-between gap-1 w-full h-full">
          <div className="flex w-full flex-row items-center justify-between gap-2">
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
                <Empty.Title className="text-sm font-bold text-foreground">
                  {emptyLabel || "No Predictions Yet"}
                </Empty.Title>
                <Empty.Description className="text-xs text-muted-foreground">
                  Projections will appear once grades and attendance are recorded
                </Empty.Description>
              </Empty.Content>
            </Empty>
          )}
        </div>
      </Link>
    </RetroCard>
  );
}
