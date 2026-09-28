import { useMemo } from "react";
import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import { formatDate } from "@/lib/classwork-utils";
import type { ClassworkTracking, TeacherClasswork } from "@/types/classwork";

type ClassworkListItemProps = {
  item: TeacherClasswork;
  tracking?: ClassworkTracking;
  onOpen: (item: TeacherClasswork) => void;
};

function displayType(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export default function ClassworkListItem({
  item,
  onOpen,
}: ClassworkListItemProps) {
  const sections = useMemo(() => {
    const names = Array.from(
      new Set(
        (item.assignments ?? [])
          .map((assignment) => assignment.title?.trim())
          .filter((title): title is string => Boolean(title)),
      ),
    );
    if (names.length <= 2) return names.join(", ");
    return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  }, [item.assignments]);

  const dueLabel = useMemo(() => {
    const dueDates = Array.from(
      new Set(
        (item.assignments ?? [])
          .map((assignment) => assignment.due_date)
          .filter((date): date is string => Boolean(date)),
      ),
    );
    if (!dueDates.length) return null;
    if (dueDates.length === 1) return `Due ${formatDate(dueDates[0])}`;
    return `${dueDates.length} section due dates`;
  }, [item.assignments]);

  const openItem = () => onOpen(item);

  return (
    <Card
      className="w-full cursor-pointer transition-all p-3.5 sm:p-4 hover:shadow-none"
      role="button"
      tabIndex={0}
      onClick={openItem}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openItem();
        }
      }}
      aria-label={`Open ${item.title}`}
    >
      <div className="flex items-start justify-between gap-3 sm:gap-6 min-w-0">
        {/* Left Side: Title & Subtitle Metadata */}
        <div className="min-w-0 flex-1 flex flex-col justify-center gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-base text-foreground line-clamp-1 break-words [overflow-wrap:anywhere]">
              {item.title}
            </h3>
            {item.total_points !== null && item.total_points !== undefined && (
              <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
                · {item.total_points} pts
              </span>
            )}
          </div>

          <div className="text-xs text-muted-foreground font-medium line-clamp-2">
            {[item.subject_name, sections].filter(Boolean).join(" · ") ||
              "Subject unavailable"}
            {" · Created "}
            {formatDate(item.created_at)}
            {dueLabel && ` · ${dueLabel}`}
          </div>
        </div>

        {/* Right Side: Badges (top right) */}
        <div className="flex items-center gap-1.5 shrink-0 self-start">
          <Badge variant="secondary" size="sm" className="whitespace-nowrap">
            {displayType(item.classwork_type)}
          </Badge>
          <Badge
            variant={item.is_published ? "success" : "outline"}
            size="sm"
            className="whitespace-nowrap"
          >
            {item.is_published ? "Published" : "Draft"}
          </Badge>
        </div>
      </div>
    </Card>
  );
}
