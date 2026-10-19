import { Link } from "react-router-dom";
import { Avatar } from "@/components/retroui/Avatar";
import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import { Progress } from "@/components/retroui/Progress";
import { UserRound } from "lucide-react";
import type { TodoItem } from "@/lib/api";

type StudentSubjectSectionCardProps = {
  to: string;
  sectionName: string;
  teacherName: string;
  teacherAvatar?: string | null;
  periodName: string;
  yearLabel: string;
  isCurrentPeriod: boolean;
  classworks: TodoItem[] | null;
};

export function StudentSubjectSectionCard({
  to,
  sectionName,
  teacherName,
  teacherAvatar,
  periodName,
  yearLabel,
  isCurrentPeriod,
  classworks,
}: StudentSubjectSectionCardProps) {
  const completedCount = classworks?.filter((item) => item.status === "completed").length ?? 0;
  const completionRate = classworks?.length
    ? Math.round((completedCount / classworks.length) * 100)
    : null;
  const nextClasswork = classworks
    ?.filter((item) => item.status !== "completed")
    .sort((a, b) => {
      const dueA = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER;
      const dueB = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER;
      return dueA - dueB;
    })[0];

  return (
    <Link
      to={to}
      aria-label={`Open ${sectionName}, taught by ${teacherName}`}
      className="group block min-w-[240px] flex-1 text-foreground no-underline outline-offset-4 focus-visible:outline-3 focus-visible:outline-ring"
    >
      <Card
        variant="retro"
        className="relative flex h-full min-w-0 cursor-pointer flex-col justify-between gap-3 border-black p-3 shadow-none transition-all hover:-translate-y-1 hover:bg-retro hover:shadow-none group-focus-visible:-translate-y-1 group-focus-visible:bg-retro"
      >
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <Card.Title className="min-w-0 flex-[1_1_12rem] break-words text-2xl font-bold leading-tight">
            {sectionName}
          </Card.Title>
          {periodName && <Badge size="sm" variant="secondary" className="max-w-full break-words">{periodName}</Badge>}
        </div>

        <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <Avatar variant="teacher" className="size-8 shrink-0 rounded-full border-2 border-black">
            <Avatar.Image src={teacherAvatar || "/avatars/teacher-avatars/12.svg"} alt="" />
            <Avatar.Fallback className="rounded-full bg-primary text-base font-bold text-primary-foreground">
              <UserRound className="size-4" />
            </Avatar.Fallback>
          </Avatar>
          <span className="min-w-0 break-words">{teacherName}</span>
        </div>

        {completionRate !== null && (
          <div className="flex w-full flex-col gap-1">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Your Classwork Completion</span>
              <span className="font-bold">{completionRate}%</span>
            </div>
            <Progress className="w-full" value={completionRate} />
          </div>
        )}

        <Card className={`mt-auto flex w-full min-w-0 flex-col gap-2 border-black bg-primary px-3 py-2 shadow-none hover:shadow-none ${nextClasswork ? "transition-opacity hover:opacity-95" : ""}`}>
          <p className="break-words text-base font-semibold">
            {nextClasswork?.title || (classworks?.length ? "All caught up" : "View classwork")}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <Badge size="sm" variant="solid">
              {nextClasswork?.deadline || (isCurrentPeriod ? "Current term" : periodName)}
            </Badge>
            <span className="text-foreground/70">{yearLabel}</span>
          </div>
        </Card>
      </Card>
    </Link>
  );
}
