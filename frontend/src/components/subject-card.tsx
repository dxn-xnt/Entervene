"use client";

import { Link, useNavigate } from "react-router-dom";
import { Avatar } from "@/components/retroui/Avatar";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/retroui/Progress";
import { Card, type cardVariants } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { ArrowUpRight, BookOpen, CheckCircle2, UserRound } from "lucide-react";
import type { VariantProps } from "class-variance-authority";
import { StudentEmptyState } from "@/components/student/student-empty-state";
import { studentClassworkPath } from "@/lib/student-classwork-navigation";
import type { TodoItem } from "@/lib/api";

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
  status?: "ongoing" | "due_soon" | "past_due" | "no_due_date" | "completed" | string;
  submittedCount?: number;
  submitted_count?: number;
  totalStudents?: number;
  total_students?: number;
  classwork_type?: string;
  classworkType?: string;
};

export type SubjectCardProps = {
  variant?: "student" | "teacher";
  cardVariant?: VariantProps<typeof cardVariants>["variant"];
  to?: string;
  subjectCode?: string;
  periodName?: string;
  yearLabel?: string;
  isCurrentPeriod?: boolean;
  title?: string;
  subjectName?: string;
  sectionName?: string;
  subtitle?: string;
  teacher?: string;
  teacherName?: string;
  teacherAvatar?: string | null;
  gradeLevel?: string;
  isAdvisory?: boolean;
  badges?: BadgeItem[];
  pendingCount?: number;
  completionRate?: number;
  progressLabel?: string;
  latestActivityTitle?: string;
  latestActivityDue?: string;
  latestActivityId?: number;
  latestActivityAssignmentId?: number;
  activeClasswork?: ActiveClassworkInfo | null;
  activeClassworks?: ActiveClassworkInfo[];
  classworks?: TodoItem[] | null;
  onClassworkClick?: (classworkId?: number) => void;
  onClick?: () => void;
  className?: string;
  showPattern?: boolean;
};

export function SubjectCard({
  variant = "student",
  cardVariant,
  title,
  subjectName,
  sectionName,
  to,
  teacher,
  teacherName,
  teacherAvatar,
  gradeLevel,
  pendingCount,
  completionRate = 0,
  progressLabel,
  latestActivityTitle,
  latestActivityDue,
  latestActivityId,
  latestActivityAssignmentId,
  activeClasswork,
  activeClassworks,
  classworks,
  onClassworkClick,
  onClick,
  className,
}: SubjectCardProps) {
  if (variant === "teacher") {
    const defaultCardVariant = cardVariant || "retro";

    // Resolve the most recent and active classwork,
    // excluding reading classworks, completed classworks, and classworks where all students have submitted
    const currentCw = (() => {
      const raw =
        activeClassworks && activeClassworks.length > 0
          ? activeClassworks
          : activeClasswork
            ? [activeClasswork]
            : [];
      const valid = raw.filter((cw) => {
        // Exclude reading classworks
        const type = (cw.classwork_type || cw.classworkType || "").toUpperCase();
        if (type === "READING") return false;

        // Exclude completed classworks
        const status = (cw.status || "").toLowerCase();
        if (status === "completed") return false;

        // Exclude classworks where all students have submitted already
        const total = cw.totalStudents ?? cw.total_students ?? 0;
        const submitted = cw.submittedCount ?? cw.submitted_count ?? 0;
        if (total > 0 && submitted >= total) return false;

        return true;
      });

      if (valid.length === 0) return null;
      const cw = valid[0];
      return {
        classworkId: cw.classwork_id ?? cw.id,
        title: cw.title,
        status: cw.status || "ongoing",
        dueLabel: cw.dueLabel || cw.due_label || "",
        submittedCount: cw.submittedCount ?? cw.submitted_count ?? 0,
        totalStudents: cw.totalStudents ?? cw.total_students ?? 0,
        classworkType: cw.classwork_type || cw.classworkType,
      };
    })();

    const displayProgressLabel = progressLabel || "Classwork Completion";
    const displayTitle = title || subjectName || "";

    return (
      <Card
        variant={defaultCardVariant}
        className={cn(
          "group relative flex w-full min-w-0 flex-1 flex-col justify-between shadow-none! hover:bg-retro hover:shadow-none hover:-translate-y-1 cursor-pointer transition-all min-w-[240px] p-3",
          className,
        )}
        onClick={onClick}
      >
        <div className="flex flex-col items-start justify-between gap-2.5">
          {/* Header */}
          <div className="flex flex-row w-full items-center justify-between gap-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <p
                    className="text-2xl font-bold truncate min-w-0"
                    tabIndex={0}
                  >
                    {displayTitle}
                  </p>
                }
              />
              <TooltipContent>{displayTitle}</TooltipContent>
            </Tooltip>
            <div className="flex items-center gap-1.5 shrink-0">
              {gradeLevel && (
                <Badge size="sm" variant="secondary" className="shrink-0">
                  {gradeLevel}
                </Badge>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          <div className="flex flex-col w-full gap-1">
            <div className="flex justify-between items-center text-sm">
              <span className="font-normal text-muted-foreground">
                {displayProgressLabel}
              </span>
              <span className="font-bold">{completionRate}%</span>
            </div>
            <div className="flex flex-row items-center gap-2">
              <Progress className="w-full" value={completionRate} />
            </div>
          </div>

          {/* Inner Card */}
          <div className="flex flex-col w-full gap-1 mt-1">
            {currentCw ? (
              <Card
                className="bg-primary w-full shadow-none! py-2 px-3 hover:opacity-95 transition-opacity"
                onClick={(e) => {
                  if (onClassworkClick) {
                    e.stopPropagation();
                    onClassworkClick(currentCw.classworkId);
                  }
                }}
              >
                <div className="flex flex-col w-full gap-2">
                  <div className="flex flex-row justify-between items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <p
                            className="text-md font-semibold truncate flex-1 min-w-0"
                            tabIndex={0}
                          >
                            {currentCw.title}
                          </p>
                        }
                      />
                      <TooltipContent>{currentCw.title}</TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {currentCw.dueLabel && currentCw.status !== "past_due" && (
                      <Badge size="sm" variant="solid">
                        {currentCw.dueLabel}
                      </Badge>
                    )}
                    {currentCw.totalStudents > 0 && (
                      <span className="text-[11px] font-medium text-black/70 ml-auto">
                        {currentCw.submittedCount}/{currentCw.totalStudents}{" "}
                        turned in
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="bg-primary w-full shadow-none! py-2 px-3">
                <div className="flex flex-col w-full gap-2 items-center text-center justify-center">
                  <div className="flex flex-row justify-between w-full text-center items-center">
                    <p className="text-xs text-foreground font-medium">
                      No active classwork
                    </p>
                    <Badge size="sm" variant="outline">
                      All caught up
                    </Badge>
                  </div>
                </div>
              </Card>
            )}
          </div>
        </div>
      </Card>
    );
  }

  // Student variant (merged from StudentSubjectSectionCard)
  const navigate = useNavigate();
  const subjectDisplayName = subjectName || title || "";
  const teacherDisplayName = teacherName || teacher || "";
  const displayProgressLabel = progressLabel || "Classwork Completion";

  const {
    effectiveCompletionRate,
    effectivePendingCount,
    nextClasswork,
    hasClassworkData,
  } = (() => {
    if (classworks !== undefined && classworks !== null) {
      const completedCount = classworks.filter(
        (item) => item.status === "completed",
      ).length;
      const rate = classworks.length
        ? Math.round((completedCount / classworks.length) * 100)
        : 0;
      const pending = classworks.filter(
        (item) => !item.is_submitted && item.status !== "completed",
      ).length;
      const next = classworks
        .filter((item) => item.status !== "completed")
        .sort((a, b) => {
          const dueA = a.due_date
            ? new Date(a.due_date).getTime()
            : Number.MAX_SAFE_INTEGER;
          const dueB = b.due_date
            ? new Date(b.due_date).getTime()
            : Number.MAX_SAFE_INTEGER;
          return dueA - dueB;
        })[0];
      return {
        effectiveCompletionRate: rate,
        effectivePendingCount: pending,
        nextClasswork: next
          ? {
            id: next.assignment_id ?? next.classwork_id,
            assignmentId: next.assignment_id,
            classworkId: next.classwork_id,
            title: next.title,
            deadline: next.deadline,
          }
          : null,
        hasClassworkData: classworks.length > 0,
      };
    }

    const rate = completionRate ?? 0;
    const pending = pendingCount ?? 0;
    const targetId =
      latestActivityAssignmentId ??
      latestActivityId ??
      activeClasswork?.id ??
      activeClasswork?.classwork_id;
    const next = latestActivityTitle
      ? {
        id: targetId,
        assignmentId: latestActivityAssignmentId ?? targetId,
        classworkId: latestActivityId ?? targetId,
        title: latestActivityTitle,
        deadline: latestActivityDue,
      }
      : null;
    return {
      effectiveCompletionRate: rate,
      effectivePendingCount: pending,
      nextClasswork: next,
      hasClassworkData: rate > 0 || pending > 0 || Boolean(latestActivityTitle),
    };
  })();

  const handleClassworkClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const targetAssignmentId =
      nextClasswork?.assignmentId ??
      nextClasswork?.classworkId ??
      nextClasswork?.id;

    if (onClassworkClick) {
      onClassworkClick(targetAssignmentId);
      return;
    }

    if (targetAssignmentId) {
      const currentPath =
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : undefined;
      navigate(studentClassworkPath(targetAssignmentId, currentPath));
      return;
    }

    if (to) {
      navigate(`${to}?tab=classwork`);
    }
  };

  const cardInner = (
    <Card
      variant={cardVariant || "retro"}
      className="relative flex h-full min-w-0 cursor-pointer flex-col gap-3 border-black p-3.5 pt-4 shadow-none shadow-black transition-all hover:bg-retro hover:shadow-none group-focus-visible:bg-retro"
    >
      <div className="flex min-w-0 items-start gap-3">
        <Avatar
          variant="teacher"
          className="size-14 shrink-0 rounded-full border-2 border-black"
        >
          <Avatar.Image
            src={teacherAvatar || "/avatars/teacher-avatars/12.svg"}
            alt=""
          />
          <Avatar.Fallback className="rounded-full bg-primary text-base font-bold text-primary-foreground">
            <UserRound className="size-7" />
          </Avatar.Fallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          <div className="flex w-full flex-row gap-2 items-center justify-between">
            <Card.Title className="min-w-0 break-words text-2xl font-bold leading-tight">
              {subjectDisplayName}
            </Card.Title>
            {effectivePendingCount > 0 && (
              <Badge size="sm" variant="default" className="shrink-0">
                {effectivePendingCount} Pending
              </Badge>
            )}
          </div>
          {teacherDisplayName && (
            <span className="min-w-0 break-words text-sm text-muted-foreground">
              {teacherDisplayName}
            </span>
          )}
        </div>
      </div>

      <div className="flex w-full flex-col gap-1">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">{displayProgressLabel}</span>
          <span className="font-bold">{effectiveCompletionRate}%</span>
        </div>
        <Progress className="w-full" value={effectiveCompletionRate} />
      </div>

      {nextClasswork ? (
        <Card
          onClick={handleClassworkClick}
          className="flex min-h-[72px] w-full min-w-0 flex-col justify-center gap-2 border-black bg-primary px-3 py-2 shadow-none hover:shadow-none transition-opacity hover:opacity-95 cursor-pointer"
        >
          <div className="flex items-center justify-between gap-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <p className="truncate text-base font-semibold min-w-0 flex-1">
                    {nextClasswork.title}
                  </p>
                }
              />
              <TooltipContent>{nextClasswork.title}</TooltipContent>
            </Tooltip>
            <Button
              variant="secondary"
              size="sm"
              autoIcon={false}
              className="p-0.5 shadow-none shrink-0"
              aria-label={`View ${nextClasswork.title}`}
              onClick={handleClassworkClick}
            >
              <ArrowUpRight className="size-4" />
            </Button>
          </div>
          {nextClasswork.deadline && (
            <Badge size="sm" variant="solid" className="self-start">
              {nextClasswork.deadline}
            </Badge>
          )}
        </Card>
      ) : (
        <StudentEmptyState
          icon={hasClassworkData ? <CheckCircle2 /> : <BookOpen />}
          title={hasClassworkData ? "All caught up" : "No classwork yet"}
          description={
            hasClassworkData
              ? "No pending classwork right now."
              : "Assigned classwork will appear here."
          }
          embedded
          compact
          className="min-h-[72px] py-2 shadow-none hover:shadow-none"
        />
      )}
    </Card>
  );

  const ariaLabel = `Open ${sectionName || subjectDisplayName}${teacherDisplayName ? `, taught by ${teacherDisplayName}` : ""}`;

  if (to) {
    return (
      <Link
        to={to}
        aria-label={ariaLabel}
        className={cn(
          "group block min-w-[240px] flex-1 text-foreground no-underline outline-offset-4 focus-visible:outline-3 focus-visible:outline-ring",
          className,
        )}
      >
        {cardInner}
      </Link>
    );
  }

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onClick();
            }
          }
          : undefined
      }
      aria-label={ariaLabel}
      className={cn(
        "group block min-w-[240px] flex-1 text-foreground no-underline outline-offset-4 focus-visible:outline-3 focus-visible:outline-ring",
        onClick && "cursor-pointer",
        className,
      )}
    >
      {cardInner}
    </div>
  );
}
