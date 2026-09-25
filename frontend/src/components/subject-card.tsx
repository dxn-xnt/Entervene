"use client";

import { Link } from "react-router-dom";
import { Avatar } from "@/components/retroui/Avatar";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/retroui/Progress";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { ArrowUpRight } from "lucide-react";

type BadgeItem = {
  label: string;
  count?: number;
  icon?: string;
  variant?: "default" | "secondary" | "outline" | "solid" | "surface" | "ghost";
};

type SubjectCardProps = {
  to?: string;
  subjectCode?: string;
  periodName?: string;
  yearLabel?: string;
  isCurrentPeriod?: boolean;
  title: string;
  teacher?: string;
  badges?: BadgeItem[];
  pendingCount?: number;
  completionRate?: number;
  latestActivityTitle?: string;
  latestActivityDue?: string;
  onClick?: () => void;
  className?: string;
  showPattern?: boolean;
};

export function SubjectCard({
  title,
  to,
  teacher,
  subjectCode,
  periodName,
  yearLabel,
  isCurrentPeriod,
  pendingCount,
  completionRate = 0,
  latestActivityTitle,
  latestActivityDue,
  onClick,
  className,
  showPattern = true,
}: SubjectCardProps) {
  if (to) {
    const words = title.trim().split(/\s+/).filter(Boolean);
    const initials = (words.length > 1
      ? `${words[0][0]}${words[words.length - 1][0]}`
      : (words[0] || "").slice(0, 2)).toUpperCase();

    return (
      <Link
        to={to}
        aria-label={`Open ${title}`}
        className="group block h-full min-w-0 text-card-foreground no-underline outline-offset-4 focus-visible:outline-3 focus-visible:outline-ring"
      >
        <Card variant="retro" className={cn("flex h-full min-h-60 min-w-0 flex-col gap-0 p-0", className)}>
          <div className="retro-theme-stripes h-20 shrink-0 border-b-2 border-black bg-primary p-2.5 transition-colors group-hover:bg-primary-hover">
            <div className="flex items-start justify-between gap-2">
              <Badge size="sm" variant="outline" className="min-w-0 max-w-[60%] break-words">
                {subjectCode?.trim() || initials}
              </Badge>
              {isCurrentPeriod && (
                <Badge size="sm" variant="solid" className="shrink-0">Current term</Badge>
              )}
            </div>
          </div>
          <div className="relative z-10 -mt-5 ml-3 w-fit -rotate-6" aria-hidden="true">
            <Avatar className="size-10 rounded border-black bg-primary text-primary-foreground shadow-sm shadow-black">
              <Avatar.Fallback className="rounded bg-primary text-base font-bold text-primary-foreground">
                {initials}
              </Avatar.Fallback>
            </Avatar>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1 px-3 pb-3 pt-2">
            <Card.Title className="break-words text-lg font-bold leading-tight">{title}</Card.Title>
            {teacher && <p className="break-words text-sm text-muted-foreground">{teacher}</p>}
            {(periodName || yearLabel) && (
              <div className="mt-auto flex min-w-0 flex-wrap items-center gap-2 pt-2">
                {periodName && <Badge size="sm" variant="surface" className="max-w-full break-words whitespace-normal">{periodName}</Badge>}
                {yearLabel && <span className="break-words text-xs text-muted-foreground">{yearLabel}</span>}
              </div>
            )}
          </div>
        </Card>
      </Link>
    );
  }
  const hasPending = (pendingCount ?? 0) > 0;
  const noClasswork = !latestActivityTitle && !hasPending;

  return (
    <Card
      variant={showPattern ? "squares" : "default"}
      className={`group relative flex min-w-0 flex-col justify-between p-3.5 shadow-none hover:-translate-y-1 cursor-pointer transition-all${className || ""}`}
      onClick={onClick}
    >
      <div className="flex flex-col items-start justify-between gap-2.5">
        <div className="flex w-full min-w-0 flex-col justify-between gap-2 -mb-2 sm:flex-row item-center sm:items-start">
          <p className="min-w-0 break-words text-xl font-bold sm:text-2xl">
            {title}
          </p>
          {hasPending && (
            <Badge size="sm" variant="surface" className="shrink-0">
              {pendingCount} {pendingCount === 1 ? "Pending Classwork" : "Pending Classworks"}
            </Badge>
          )}
        </div>
        {/* <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5 sm:-mt-1">
          {teacher !== "" && (
            <p className="min-w-0 break-words text-sm font-semibold text-gray-700">
              {teacher}
            </p>
          )}
        </div> */}
        <div className="flex flex-col w-full gap-1">
          <p className="text-xs font-normal text-muted-foreground">Completion</p>
          <div className="flex flex-row items-center gap-2">
            <Progress className="w-full" value={completionRate} />
            <p className="text-xs font-bold shrink-0">{completionRate}%</p>
          </div>
        </div>
        <div className="flex flex-col w-full gap-1 mt-1">
          {noClasswork ? (
            <Card className="bg-primary w-full shadow-none py-2 px-3">
              <div className="flex flex-col w-full gap-2 items-center text-center justify-center">
                <div className="flex flex-row justify-between w-full text-center items-center justify-center">
                  <p className="text-center text-xs font-normal text-black">
                    No Classworks Assigned
                  </p>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="bg-primary w-full shadow-none py-2 px-3 hover:-translate-y-0.5 hover:shadow-none transition-all">
              <div className="flex flex-col w-full gap-1.5">
                <div className="flex flex-row justify-between items-center">
                  <p className="text-sm font-semibold truncate">{latestActivityTitle || `${pendingCount} Ongoing Tasks`}</p>
                  <Button
                    variant="secondary"
                    className="shadow-none p-1 shrink-0"
                    size="sm"
                  >
                    <ArrowUpRight className="size-3" />
                  </Button>
                </div>
                <div className="flex flex-row gap-1.5 items-center flex-wrap">

                  {latestActivityDue && (
                    <Badge size="sm" variant="solid">
                      {latestActivityDue}
                    </Badge>
                  )}
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </Card>
  );
}
