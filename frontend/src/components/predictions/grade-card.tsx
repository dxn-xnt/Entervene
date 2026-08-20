import { Card, Card as RetroCard } from "@/components/retroui/Card";
import { Link } from "react-router-dom";
import { Badge } from "@/components/retroui/Badge";
import { Progress } from "../retroui/Progress";
import { useAuth } from "@/context/AuthContext";

interface GradeCardProps {
  name: string;
  grade: number;
  highRisk?: number;
  monitoring?: number;
  role?: "teacher" | "admin";
}

export function GradeCard({ name, grade, highRisk = 0, monitoring = 0, role }: GradeCardProps) {
  const { role: authRole } = useAuth();
  const activeRole = role ?? (authRole === "admin" ? "admin" : "teacher");

  // Mock total students per class section
  const totalStudents: number = 30;
  const highRiskPct = totalStudents > 0 ? (highRisk / totalStudents) * 100 : 0;
  const monitoringPct = totalStudents > 0 ? (monitoring / totalStudents) * 100 : 0;

  return (
    <RetroCard className="group relative flex flex-col justify-between shadow-none p-3 hover:-translate-y-1 transition-transform">
      <Link
        to={`/${activeRole}/predictions/${grade}/${encodeURIComponent(name)}`}
        className="min-w-0 flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1 rounded"
        aria-label={`View ${name} predictions`}
      >
        <div className="flex flex-col items-start justify-between gap-2">
          <div className="flex flex-row w-full justify-between">
            <div>
              <p className="text-2xl font-bold leading-tight">{name}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Badge size="sm" variant="solid" className="">
                {totalStudents} <span>{totalStudents === 1 ? "Student" : "Students"}</span>
              </Badge>
            </div>
          </div>
          <div className="flex flex-row w-full gap-2">
            <Card className="p-2 px-4 shadow-none gap-3 w-full flex flex-row items-center">
              <Progress
                variant="circular"
                value={highRiskPct}
                className="size-20"
              />
              <div className="flex flex-col items-baseline items-center gap-1">
                <span className="font-head text-3xl font-black text-foreground">{highRisk}</span>
                <span className="text-sm font-medium text-foreground">{highRisk === 1 ? "High Risk" : "High Risks"}</span>
              </div>
            </Card>
            <Card className="p-2 px-4 w-full shadow-none gap-3 flex flex-row items-center">
              <Progress
                variant="circular"
                value={monitoringPct}
                className="size-20"
              />
              <div className="flex flex-col items-baseline items-center gap-1">
                <span className="font-head text-3xl font-black text-foreground">{monitoring}</span>
                <span className="text-sm font-medium text-foreground">{monitoring === 1 ? "Monitoring" : "Monitoring"}</span>
              </div>
            </Card>
          </div>
        </div>
      </Link>
    </RetroCard>
  );
}
