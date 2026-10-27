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
  description?: string | null;
  classwork_type?: string | null;
  type?: string | null;
  classwork_category?: string | null;
  category?: string | null;
  total_points?: number | null;
  is_published?: boolean;
  created_at?: string | null;
  due_date?: string | null;
  assignments?: { due_date?: string | null }[] | null;
  attachments?: { classwork_attachment_id?: number }[] | null;
  attachment_count?: number;
  score?: number | null;
  status?: string | null;
}

export interface ClassworkItemLineProps<T extends BaseClassworkItem = TeacherClasswork> {
  item: T;
  subtitle?: React.ReactNode;
  tracking?: ClassworkTracking;
  onOpen?: (item: T) => void;
  onClick?: () => void;
  className?: string;
  showPublicationStatus?: boolean;
  showType?: boolean;
  showCategory?: boolean;
  showTypeBadge?: boolean;
  showCategoryBadge?: boolean;
  rightContent?: React.ReactNode;
  size?: "default" | "sm";
  iconClassName?: string;
  iconContainerClassName?: string;
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
  subtitle,
  tracking,
  onOpen,
  onClick,
  className,
  iconClassName,
  iconContainerClassName,
  showPublicationStatus = true,
  showType = true,
  showCategory = true,
  showTypeBadge,
  showCategoryBadge,
  rightContent,
  size = "default",
}: ClassworkItemLineProps<T>) => {
  const shouldShowType = showTypeBadge ?? showType;
  const shouldShowCategory = showCategoryBadge ?? showCategory;
  const isSmall = size === "sm";

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

  const isClickable = Boolean(onOpen || onClick);
  const rawType = item.classwork_type ?? item.type;
  const formattedType = rawType
    ? rawType.toLowerCase().replace(/_/g, " ")
    : null;

  const rawCategory = item.classwork_category ?? item.category;
  const formattedCategory = rawCategory
    ? rawCategory.toLowerCase().replace(/_/g, " ")
    : null;

  return (
    <Card
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={isClickable ? handleOpen : undefined}
      onKeyDown={
        isClickable
          ? (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleOpen();
            }
          }
          : undefined
      }
      aria-label={isClickable ? `Open classwork: ${item.title}` : undefined}
      className={cn(
        "group flex w-full flex-col sm:flex-row sm:items-center justify-between border-2 border-black bg-white shadow-md! transition-all text-left select-none",
        isSmall ? "gap-2 p-2" : "gap-3 p-3",
        isClickable && "cursor-pointer hover:translate-x-1 hover:bg-retro",
        className,
      )}
    >
      {/* Left side: Icon + Title & Subtitle metadata */}
      <div className={cn("flex items-center min-w-0 flex-1", isSmall ? "gap-2.5" : "gap-3.5")}>
        <IconContainer
          variant="primary"
          size={isSmall ? "sm" : "default"}
          className={cn("rounded!", iconClassName ?? iconContainerClassName)}
        >
          <ClassworkTypeIcon type={rawType} size={isSmall ? 16 : 20} />
        </IconContainer>

        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <h4 className={cn("font-bold text-foreground line-clamp-1 break-words", isSmall ? "text-sm" : "text-base sm:text-lg")}>
              {item.title}
            </h4>
          </div>

          <div className={cn("-mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground", isSmall ? "text-xs" : "text-sm")}>
            {subtitle ? (
              <span>{subtitle}</span>
            ) : dueLabel ? (
              <span>{dueLabel}</span>
            ) : item.created_at ? (
              <span>Created {formatDate(item.created_at)}</span>
            ) : item.description ? (
              <span className="line-clamp-2">{item.description}</span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Right side: Tracking, Custom Content & Status Badges */}
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

        {rightContent}

        {(Boolean(shouldShowType && formattedType) ||
          Boolean(shouldShowCategory && formattedCategory && formattedCategory !== formattedType) ||
          Boolean(showPublicationStatus)) && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {shouldShowType && formattedType && (
                <Badge variant="surface" size="sm" className="capitalize">
                  {formattedType}
                </Badge>
              )}

              {shouldShowCategory && formattedCategory && formattedCategory !== formattedType && (
                <Badge variant="outline" size="sm" className="capitalize">
                  {formattedCategory}
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
          )}
      </div>
    </Card>
  );
};

export default ClassworkItemLine;
