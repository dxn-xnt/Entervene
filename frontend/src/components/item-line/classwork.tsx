import { useMemo } from "react";
import {
  BookOpen,
  CheckSquare,
  ClipboardList,
  FileText,
} from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import { IconContainer } from "@/components/icon-container";
import { Progress } from "@/components/retroui/Progress";
import { formatDate } from "@/lib/classwork-utils";
import { cn } from "@/lib/utils";
import type { ClassworkTracking, TeacherClasswork } from "@/types/classwork";

export interface BaseClassworkItem {
  classwork_id: number;
  title: string;
  classwork_type?: string | null;
  classwork_category?: string | null;
  total_points?: number | null;
  is_published?: boolean;
  created_at?: string | null;
  due_date?: string | null;
  assignments?: { due_date?: string | null }[] | null;
  attachments?: { classwork_attachment_id?: number }[] | null;
  attachment_count?: number;
}

export interface ClassworkItemLineProps<T extends BaseClassworkItem = TeacherClasswork> {
  item: T;
  tracking?: ClassworkTracking;
  onOpen?: (item: T) => void;
  onClick?: () => void;
  className?: string;
  showPublicationStatus?: boolean;
}

function ClassworkTypeIcon({
  type,
  size = 18,
}: {
  type?: string | null;
  size?: number;
}) {
  switch (type?.toUpperCase()) {
    case "QUIZ":
      return <ClipboardList size={size} />;
    case "ASSIGNMENT":
      return <BookOpen size={size} />;
    case "ACTIVITY":
      return <CheckSquare size={size} />;
    case "READING":
      return <FileText size={size} />;
    default:
      return <FileText size={size} />;
  }
}

export const ClassworkItemLine = <T extends BaseClassworkItem = TeacherClasswork>({
  item,
  tracking,
  onOpen,
  onClick,
  className,
  showPublicationStatus = true,
}: ClassworkItemLineProps<T>) => {
  const dueLabel = useMemo(() => {
    if (item.assignments && item.assignments.length > 0) {
      const dueDates = Array.from(
        new Set(
          item.assignments
            .map((assignment) => assignment.due_date)
            .filter((date): date is string => Boolean(date)),
        ),
      );
      if (dueDates.length === 1) return `Due ${formatDate(dueDates[0])}`;
      if (dueDates.length > 1) return `${dueDates.length} section due dates`;
    }
    if (item.due_date) {
      return `Due ${formatDate(item.due_date)}`;
    }
    return null;
  }, [item.assignments, item.due_date]);

  const completionRate =
    tracking && tracking.total_students > 0
      ? Math.round((tracking.submitted_count / tracking.total_students) * 100)
      : null;

  const handleOpen = () => {
    onOpen?.(item);
    onClick?.();
  };

  const formattedType = item.classwork_type
    ? item.classwork_type.toLowerCase().replace(/_/g, " ")
    : null;

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleOpen();
        }
      }}
      aria-label={`Open classwork: ${item.title}`}
      className={cn(
        "group flex w-full cursor-pointer flex-col sm:flex-row sm:items-center justify-between gap-3 border-2 border-black bg-white p-3 shadow-md! hover:translate-x-1 hover:bg-retro transition-all text-left select-none",
        className,
      )}
    >
      {/* Left side: Icon + Title & Subtitle metadata */}
      <div className="flex items-center gap-3.5 min-w-0 flex-1">
        <IconContainer variant="primary">
          <ClassworkTypeIcon type={item.classwork_type} size={20} />
        </IconContainer>

        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <h4 className="text-base sm:text-lg font-bold text-foreground line-clamp-1 break-words">
              {item.title}
            </h4>
          </div>

          <div className="-mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {dueLabel ? (
              <span>{dueLabel}</span>
            ) : item.created_at ? (
              <span>Created {formatDate(item.created_at)}</span>
            ) : null}

            {item.total_points !== null && item.total_points !== undefined && (
              <>
                <span className="text-black/30">•</span>
                <span>{item.total_points} pts</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right side: Tracking & Status Badges */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-black/10">
        {tracking && (
          <div className="flex flex-col items-start sm:items-end gap-1 min-w-[120px]">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Submitted:</span>
              <span className="font-bold text-foreground">
                {tracking.submitted_count}/{tracking.total_students}
              </span>
              {completionRate !== null && (
                <span className="text-muted-foreground">({completionRate}%)</span>
              )}
            </div>
            <Progress value={completionRate ?? 0} className="h-2 w-24 border border-black" />
          </div>
        )}

        <div className="flex items-center gap-1.5 flex-wrap">
          {formattedType && (
            <Badge variant="surface" size="sm" className="capitalize">
              {formattedType}
            </Badge>
          )}

          {showPublicationStatus && (
            <Badge
              variant={item.is_published ? "solid" : "default"}
              size="sm"
              className="whitespace-nowrap"
            >
              {item.is_published ? "Published" : "Draft"}
            </Badge>
          )}
        </div>
      </div>
    </Card>
  );
};

export default ClassworkItemLine;
