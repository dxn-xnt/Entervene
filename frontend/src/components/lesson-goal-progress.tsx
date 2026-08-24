import React from "react";
import { ClipboardList, BookOpen, FileText } from "lucide-react";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import type { StudentLesson as Lesson } from "@/types/student-subject";

export interface LessonClasswork {
  classwork_assignment_id: number;
  classwork_id: number;
  title: string;
  classwork_type?: string | null;
  classwork_category?: string | null;
  is_graded?: boolean;
  total_points?: number | null;
  due_date?: string | null;
  allow_late_submissions?: boolean;
  submission_status?: string | null;
}

export interface LessonGoalProgressProps {
  sortedGoalLessons?: Lesson[];
  classworksByLesson?: Record<number, LessonClasswork[]>;
  className?: string;
  title?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getStatusBadge(status?: string | null, dueDate?: string | null) {
  if (status === "graded" || status === "submitted") {
    return {
      label: "Done",
      cls: "bg-gray-200 text-gray-600 border border-gray-300",
    };
  }
  if (status === "late") {
    return { label: "Late", cls: "bg-[#FF4B4B] text-white" };
  }
  if (!dueDate) return null;
  const diffDays = Math.ceil(
    (new Date(dueDate).getTime() - Date.now()) / 86_400_000,
  );
  if (diffDays < 0)
    return {
      label: `${Math.abs(diffDays)} days late`,
      cls: "bg-[#E47171] text-black",
    };
  if (diffDays === 0)
    return { label: "Due today", cls: "bg-orange-400 text-white" };
  return { label: `Due in ${diffDays} days`, cls: "bg-[#7ABA78] text-white" };
}

function isCompletedClasswork(status?: string | null) {
  return ["graded", "submitted"].includes(status ?? "");
}

function classworkGoalScore(cw: LessonClasswork) {
  if (isCompletedClasswork(cw.submission_status))
    return Number.MAX_SAFE_INTEGER;
  if (!cw.due_date) return Number.MAX_SAFE_INTEGER - 1;
  return new Date(cw.due_date).getTime();
}

function ClassworkIcon({
  type,
  size = 16,
}: {
  type?: string | null;
  size?: number;
}) {
  switch (type?.toLowerCase()) {
    case "quiz":
      return <ClipboardList size={size} />;
    case "assignment":
      return <BookOpen size={size} />;
    default:
      return <FileText size={size} />;
  }
}

function TimelineItem({
  children,
  isFirst = false,
  isLast = false,
  status = "upcoming",
}: {
  children: React.ReactNode;
  isFirst?: boolean;
  isLast?: boolean;
  status: "done" | "ongoing" | "upcoming";
}) {
  const getDotClass = () => {
    switch (status) {
      case "done":
        return "bg-muted border-muted-foreground";
      case "ongoing":
        return "bg-primary border-border";
      case "upcoming":
      default:
        return "bg-white border-muted";
    }
  };

  const getLineClass = () => {
    switch (status) {
      case "done":
        return "bg-foreground";
      case "ongoing":
        return "bg-foreground";
      case "upcoming":
      default:
        return "bg-muted";
    }
  };

  return (
    <div className="relative flex items-start gap-3 last:pb-0">
      {/* Timeline track column */}
      <div className="relative flex flex-col items-center shrink-0 w-3.5 self-stretch">
        {/* Continuous line segment */}
        {!(isFirst && isLast) && (
          <div
            className={`absolute -translate-x-1/2 left-1/2 ${getLineClass()}`}
            style={{
              width: "2px",
              top: isFirst ? "20px" : "0px",
              bottom: isLast ? undefined : "0px",
              height: isLast ? "20px" : undefined,
            }}
          />
        )}
        {/* Dot */}
        <div
          className={`relative z-10 w-3.5 h-3.5 rounded-full border-2 shrink-0 mt-[20px] ${getDotClass()}`}
        />
      </div>
      {/* Content */}
      <div className="flex-1 min-w-0 my-1.5">
        {children}
      </div>
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────

export function LessonGoalProgress({
  sortedGoalLessons = [],
  classworksByLesson = {},
  className = "flex-1 min-w-0",
  title = "Weekly Goals",
}: LessonGoalProgressProps) {
  return (
    <div className={className}>
      <h3 className="text-xl font-bold mb-3">{title}</h3>
      <Card className="w-full">
        {!sortedGoalLessons || sortedGoalLessons.length === 0 ? (
          <Card.Content className="flex h-full items-center justify-center p-6 text-center text-sm font-semibold text-black/60">
            No goals available yet.
          </Card.Content>
        ) : (
          sortedGoalLessons.map((lesson) => {
          const cws = classworksByLesson[lesson.lesson_id];
          const orderedClassworks = cws
            ? [...cws].sort(
              (a, b) => classworkGoalScore(a) - classworkGoalScore(b),
            )
            : [];
          const isLoadingCws = cws === undefined;

          return (
            <div key={lesson.lesson_id} className="flex flex-col gap-2 mb-3">
              {/* Lesson header - plain text, no box */}
              <Card.Description>{lesson.title}</Card.Description>

              {/* Timeline */}
              {isLoadingCws ? (
                <div className="flex items-center gap-2 pl-4 py-1">
                  <div className="w-3 h-3 rounded-full border-2 border-gray-300 bg-gray-200 animate-pulse shrink-0" />
                  <p className="text-xs text-gray-400">Loading...</p>
                </div>
              ) : (
                <div className="relative">
                  {/* Lesson Completion */}
                  <TimelineItem
                    isFirst={true}
                    isLast={orderedClassworks.length === 0}
                    status="upcoming"
                  >
                    <div className="text-center border-2 px-3 py-1 bg-muted text-muted-foreground border-muted-foreground">
                      <p className="text-md">Lesson Completion</p>
                    </div>
                  </TimelineItem>

                  {/* Classwork items */}
                  {orderedClassworks.length === 0 ? (
                    <p className="text-[11px] text-gray-400 pl-6 mt-1">
                      No classworks linked
                    </p>
                  ) : (
                    orderedClassworks.map((cw, idx) => {
                      const badge = getStatusBadge(
                        cw.submission_status,
                        cw.due_date,
                      );
                      const itemStatus: "done" | "ongoing" | "upcoming" =
                        isCompletedClasswork(cw.submission_status)
                          ? "done"
                          : cw.submission_status === "in_progress" ||
                            cw.submission_status === "late"
                            ? "ongoing"
                            : "upcoming";

                      return (
                        <TimelineItem
                          key={cw.classwork_assignment_id}
                          isFirst={false}
                          isLast={idx === orderedClassworks.length - 1}
                          status={itemStatus}
                        >
                          <div className="flex items-center justify-between gap-2 w-full border-2 px-3 py-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="shrink-0">
                                <ClassworkIcon
                                  type={cw.classwork_type}
                                  size={13}
                                />
                              </span>
                              <p className="text-md truncate">{cw.title}</p>
                            </div>
                            {badge && (
                              <Badge
                                variant="secondary"
                                className={`text-[10px] font-bold px-1.5 py-0.5 shrink-0 whitespace-nowrap ${badge.cls}`}
                              >
                                {badge.label}
                              </Badge>
                            )}
                          </div>
                        </TimelineItem>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        }))}
      </Card>
    </div>
  );
}

export default LessonGoalProgress;
