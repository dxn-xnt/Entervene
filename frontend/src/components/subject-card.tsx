"use client";

import { Link } from "react-router-dom";
import { Avatar } from "@/components/retroui/Avatar";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/retroui/Progress";
import { Card, type cardVariants } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { ArrowUpRight, UserRound } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";

export type BadgeItem = {
  label: string;
  count?: number;
  icon?: string;
  variant?: "default" | "secondary" | "outline" | "solid" | "surface" | "ghost";
};

export type ActiveClassworkInfo = {
  id?: number;
  classwork_id?: number;
  title: string;
  dueLabel?: string;
  due_label?: string;
  status?: "ongoing" | "due_soon" | "past_due" | "no_due_date" | string;
  submittedCount?: number;
  submitted_count?: number;
  totalStudents?: number;
  total_students?: number;
};

export type SubjectCardProps = {
  variant?: "student" | "teacher";
  cardVariant?: VariantProps<typeof cardVariants>["variant"];
type SubjectCardProps = {
  to?: string;
  subjectCode?: string;
  periodName?: string;
  yearLabel?: string;
  isCurrentPeriod?: boolean;
  title: string;
  subtitle?: string;
  teacher?: string;
  teacherAvatar?: string;
  gradeLevel?: string;
  isAdvisory?: boolean;
  badges?: BadgeItem[];
  pendingCount?: number;
  completionRate?: number;
  progressLabel?: string;
  latestActivityTitle?: string;
  latestActivityDue?: string;
  activeClasswork?: ActiveClassworkInfo | null;
  onClassworkClick?: () => void;
  onClick?: () => void;
  className?: string;
  showPattern?: boolean;
};

export function SubjectCard({
  variant = "student",
  cardVariant,
  title,
  to,
  teacher,
  teacherAvatar,
  subjectCode,
  periodName,
  yearLabel,
  isCurrentPeriod,
  gradeLevel,
  isAdvisory,
  pendingCount,
  completionRate = 0,
  progressLabel,
  latestActivityTitle,
  latestActivityDue,
  activeClasswork,
  onClassworkClick,
  onClick,
  className,
}: SubjectCardProps) {
  if (to) {
    return (
      <Link
        to={to}
        aria-label={`Open ${title}${teacher ? `, taught by ${teacher}` : ""}`}
        className="group block h-full min-w-0 text-card-foreground no-underline outline-offset-4 focus-visible:outline-3 focus-visible:outline-ring"
      >
        <Card variant="retro" className={cn("flex h-full min-h-60 min-w-0 flex-col gap-0 p-0", className)}>
          <div className="retro-theme-stripes h-20 shrink-0 border-b-2 border-black bg-primary p-2.5 transition-colors group-hover:bg-primary-hover">
            <div className="flex items-start justify-between gap-2">
              <Badge size="sm" variant="outline" className="min-w-0 max-w-[60%] break-words">
                {subjectCode?.trim() || title}
              </Badge>
              {isCurrentPeriod && (
                <Badge size="sm" variant="solid" className="shrink-0">Current term</Badge>
              )}
            </div>
          </div>
          <div className="relative z-10 -mt-5 ml-3 w-fit" aria-hidden="true">
            <Avatar variant="teacher" className="size-15 rounded-full border-2 border-black">
              <Avatar.Image
                src={teacherAvatar || "/avatars/teacher-avatars/12.svg"}
                alt=""
              />
              <Avatar.Fallback className="rounded-full bg-primary text-base font-bold text-primary-foreground">
                <UserRound className="size-5" />
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
  const isTeacher = variant === "teacher";
  const defaultCardVariant = cardVariant || (isTeacher ? "retro" : "squares");

  // Normalized active classwork for teacher/student
  const activeCw = activeClasswork
    ? {
      title: activeClasswork.title,
      status: activeClasswork.status || "ongoing",
      dueLabel: activeClasswork.dueLabel || activeClasswork.due_label || "",
      submittedCount: activeClasswork.submittedCount ?? activeClasswork.submitted_count ?? 0,
      totalStudents: activeClasswork.totalStudents ?? activeClasswork.total_students ?? 0,
    }
    : null;

  const noClasswork = isTeacher ? !activeCw : !latestActivityTitle && !hasPending;
  const displayProgressLabel = progressLabel || (isTeacher ? "Classwork Completion" : "Completion");

  return (
    <Card
      variant={defaultCardVariant}
      className={cn(
        "group relative flex w-full min-w-0 flex-1 flex-col justify-between shadow-none hover:-translate-y-1 cursor-pointer transition-all",
        isTeacher ? "min-w-[240px] p-3" : "p-3.5",
        className
      )}
      onClick={onClick}
    >
      <div className="flex flex-col items-start justify-between gap-2.5">
        {/* Header */}
        {isTeacher ? (
          <div className="flex flex-row w-full items-center justify-between gap-2">
            <p className="text-2xl font-bold truncate min-w-0" title={title}>
              {title}
            </p>
            <div className="flex items-center gap-1.5 shrink-0">
              {isAdvisory && (
                <Badge size="sm" variant="solid">
                  Advisory
                </Badge>
              )}
              {gradeLevel && (
                <Badge size="sm" variant="secondary" className="shrink-0">
                  {gradeLevel}
                </Badge>
              )}
            </div>
          </div>
        ) : (
          <div className="flex w-full min-w-0 flex-col justify-between gap-2 -mb-2 sm:flex-row items-start">
            <p className="min-w-0 break-words text-xl font-bold sm:text-2xl">
              {title}
            </p>
            {hasPending && (
              <Badge size="sm" variant="surface" className="shrink-0">
                {pendingCount} {pendingCount === 1 ? "Pending Classwork" : "Pending Classworks"}
              </Badge>
            )}
          </div>
        )}

        {/* Progress Bar */}
        <div className="flex flex-col w-full gap-1">
          <div className="flex justify-between items-center text-xs">
            <span className="font-normal text-muted-foreground">{displayProgressLabel}</span>
            <span className="font-bold">{completionRate}%</span>
          </div>
          <div className="flex flex-row items-center gap-2">
            <Progress className="w-full" value={completionRate} />
            {!isTeacher && <p className="text-xs font-bold shrink-0">{completionRate}%</p>}
          </div>
        </div>

        {/* Inner Card */}
        <div className="flex flex-col w-full gap-1 mt-1">
          {isTeacher ? (
            activeCw ? (
              <Card
                className="bg-primary w-full shadow-none py-2 px-3 hover:opacity-95 transition-opacity"
                onClick={(e) => {
                  if (onClassworkClick) {
                    e.stopPropagation();
                    onClassworkClick();
                  }
                }}
              >
                <div className="flex flex-col w-full gap-2">
                  <div className="flex flex-row justify-between items-center gap-2">
                    <p
                      className="text-md font-semibold truncate flex-1 min-w-0"
                      title={activeCw.title}
                    >
                      {activeCw.title}
                    </p>
                    <Button
                      variant="secondary"
                      className="shadow-none p-1 shrink-0"
                      size="sm"
                      title="View Classwork"
                      onClick={(e) => {
                        if (onClassworkClick) {
                          e.stopPropagation();
                          onClassworkClick();
                        }
                      }}
                    >
                      <ArrowUpRight className="size-3" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <Badge
                      size="sm"
                      variant={activeCw.status === "due_soon" ? "solid" : "outline"}
                    >
                      {activeCw.status === "past_due"
                        ? "Closed"
                        : activeCw.status === "due_soon"
                          ? "Due Soon"
                          : "Ongoing"}
                    </Badge>
                    {activeCw.dueLabel && activeCw.status !== "past_due" && (
                      <Badge size="sm" variant="solid">
                        {activeCw.dueLabel}
                      </Badge>
                    )}
                    {activeCw.totalStudents > 0 && (
                      <span className="text-[11px] font-medium text-black/70 ml-auto">
                        {activeCw.submittedCount}/{activeCw.totalStudents} turned in
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="bg-primary w-full shadow-none py-2 px-3">
                <div className="flex flex-col w-full gap-2 items-center text-center justify-center">
                  <div className="flex flex-row justify-between w-full text-center items-center justify-between">
                    <p className="text-xs text-foreground font-medium">
                      No active classwork
                    </p>
                    <Badge size="sm" variant="outline">
                      All caught up
                    </Badge>
                  </div>
                </div>
              </Card>
            )
          ) : noClasswork ? (
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
                  <p className="text-sm font-semibold truncate">
                    {latestActivityTitle || `${pendingCount} Ongoing Tasks`}
                  </p>
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

