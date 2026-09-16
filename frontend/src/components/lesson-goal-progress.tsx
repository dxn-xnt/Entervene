import React from "react";
import { ClipboardList, BookOpen, FileText, GraduationCap, Pencil, Sparkles } from "lucide-react";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import type { StudentLesson as Lesson } from "@/types/student-subject";
import type { LessonGoalItemResponse } from "@/lib/api";

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
  goalItems?: LessonGoalItemResponse[];
  sortedGoalLessons?: Lesson[];
  classworksByLesson?: Record<number, LessonClasswork[]>;
  className?: string;
  title?: string;
  isTeacher?: boolean;
  onSetGoal?: () => void;
  onClassworkClick?: (classworkId: number, classworkAssignmentId?: number | null) => void;
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
  isExam = false,
}: {
  type?: string | null;
  size?: number;
  isExam?: boolean;
}) {
  if (isExam || type?.toLowerCase() === "exam") {
    return <GraduationCap size={size} className="text-purple-700" />;
  }
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
  goalItems,
  sortedGoalLessons,
  classworksByLesson = {},
  className = "flex-1 min-w-0",
  title = "Lesson Goals",
  isTeacher = false,
  onSetGoal,
  onClassworkClick,
}: LessonGoalProgressProps) {
  // If goalItems was passed explicitly, we operate in Curated mode!
  const hasCuratedMode = goalItems !== undefined;
  const isCuratedEmpty = hasCuratedMode && (!goalItems || goalItems.length === 0);

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-xl font-bold">{title}</h3>
        {isTeacher && onSetGoal && (
          <button
            type="button"
            onClick={onSetGoal}
            className="flex items-center gap-1 text-xs font-bold text-black hover:underline cursor-pointer"
          >
            <Pencil className="size-3.5" />
            Edit
          </button>
        )}
      </div>

      <Card className="block w-full min-w-0">
        {/* State 1: Curated Mode is empty */}
        {isCuratedEmpty ? (
          <Card.Content className="flex flex-col items-center justify-center p-6 text-center">
            <Sparkles className="size-8 text-gray-400 mb-2" />
            <p className="text-sm font-bold text-gray-800">
              {isTeacher ? "No goals set for this term" : "No lesson goals set yet"}
            </p>
            <p className="text-xs text-muted-foreground mt-1 mb-4 max-w-xs">
              {isTeacher
                ? "Curate the specific lessons and exams you want highlighted for your students this term."
                : "Your teacher has not highlighted any goals for this term yet."}
            </p>
            {isTeacher && onSetGoal && (
              <Button
                size="sm"
                onClick={onSetGoal}
                className="border-black bg-primary font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-primary-hover"
              >
                <Pencil className="mr-1.5 size-3.5" /> Set Lesson Goal
              </Button>
            )}
          </Card.Content>
        ) : hasCuratedMode && goalItems && goalItems.length > 0 ? (
          /* State 2: Curated Mode with Teacher-Selected Items */
          <Card.Content className="p-4 flex flex-col gap-3">
            {goalItems.map((item, idx) => {
              const isFirst = idx === 0;
              const isLast = idx === goalItems.length - 1;

              if (item.item_type === "LESSON" && item.lesson) {
                return (
                  <div key={`goal-lesson-${item.goal_item_id}`} className="flex flex-col gap-1.5">
                    <Card.Description className="break-words text-lg sm:text-xl font-extrabold text-black">
                      {item.lesson.title}
                    </Card.Description>
                    {/* Decorative Lesson Completion Timeline Item (maintained per requirements) */}
                    <TimelineItem isFirst={isFirst} isLast={isLast} status="upcoming">
                      <div className="border-2 border-muted-foreground bg-muted px-2 py-1 text-center text-muted-foreground sm:px-3">
                        <p className="text-xs font-semibold">Lesson Completion</p>
                      </div>
                    </TimelineItem>
                  </div>
                );
              }

              if (item.item_type === "CLASSWORK" && item.classwork) {
                const cw = item.classwork;
                const badge = getStatusBadge(cw.submission_status, cw.due_date);
                const isExam =
                  cw.classwork_category === "QUARTERLY_ASSESSMENT" ||
                  cw.classwork_category === "EXAMS" ||
                  cw.classwork_type === "EXAM";
                const itemStatus: "done" | "ongoing" | "upcoming" =
                  isCompletedClasswork(cw.submission_status)
                    ? "done"
                    : cw.submission_status === "in_progress" || cw.submission_status === "late"
                      ? "ongoing"
                      : "upcoming";

                return (
                  <TimelineItem
                    key={`goal-cw-${item.goal_item_id}`}
                    isFirst={isFirst}
                    isLast={isLast}
                    status={itemStatus}
                  >
                    <div
                      onClick={() => onClassworkClick && onClassworkClick(cw.classwork_id, cw.classwork_assignment_id)}
                      className={`flex items-center justify-between gap-2 w-full border-2 px-3 py-2 transition-all ${
                        isExam
                          ? "bg-purple-50/70 border-purple-900 hover:bg-purple-100"
                          : "bg-white border-black hover:bg-accent"
                      } ${onClassworkClick ? "cursor-pointer" : ""}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <ClassworkIcon type={cw.classwork_type} isExam={isExam} />
                        <p className="text-xs font-bold truncate text-black">{cw.title}</p>
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
              }

              return null;
            })}
          </Card.Content>
        ) : (
          /* State 3: Legacy Fallback (when goalItems not passed) */
          !sortedGoalLessons || sortedGoalLessons.length === 0 ? (
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
                  <Card.Description className="break-words text-xl sm:text-2xl">{lesson.title}</Card.Description>
                  {isLoadingCws ? (
                    <div className="flex items-center gap-2 pl-4 py-1">
                      <div className="w-3 h-3 rounded-full border-2 border-gray-300 bg-gray-200 animate-pulse shrink-0" />
                      <p className="text-xs text-gray-400">Loading...</p>
                    </div>
                  ) : (
                    <div className="relative">
                      <TimelineItem
                        isFirst={true}
                        isLast={orderedClassworks.length === 0}
                        status="upcoming"
                      >
                        <div className="border-2 border-muted-foreground bg-muted px-2 py-1 text-center text-muted-foreground sm:px-3">
                          <p className="text-xs font-semibold">Lesson Completion</p>
                        </div>
                      </TimelineItem>

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
                              <div className="flex items-center justify-between gap-2 w-full border-2 px-3 py-2 hover:bg-accent">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <ClassworkIcon type={cw.classwork_type} />
                                  <p className="text-xs font-semibold truncate">{cw.title}</p>
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
            })
          )
        )}
      </Card>
    </div>
  );
}

export default LessonGoalProgress;
