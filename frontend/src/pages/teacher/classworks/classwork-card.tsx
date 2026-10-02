import { useMemo } from "react";
import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import { Progress } from "@/components/retroui/Progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
import { formatDate } from "@/lib/classwork-utils";
import type { ClassworkTracking, TeacherClasswork } from "@/types/classwork";

type ClassworkCardProps = {
  item: TeacherClasswork;
  tracking?: ClassworkTracking;
  onOpen: (item: TeacherClasswork) => void;
};

function displayType(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export default function ClassworkCard({
  item,
  tracking,
  onOpen,
}: ClassworkCardProps) {
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

  const completionRate =
    tracking && tracking.total_students > 0
      ? Math.round((tracking.submitted_count / tracking.total_students) * 100)
      : null;

  const hasAssignments = (item.assignments?.length ?? 0) > 0;
  const openCard = () => onOpen(item);

  return (
    <Tooltip>
      <TooltipTrigger render={<Card
        className="flex h-full w-full cursor-pointer flex-col"
        tabIndex={0}
        onClick={openCard}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openCard();
          }
        }}
        aria-label={`Open ${item.title}`}
      >
        <Card.Header className="flex-col items-stretch gap-1">
          <div className="min-w-0">
            <Card.Title className="line-clamp-2 break-words text-lg font-bold [overflow-wrap:anywhere]">
              {item.title}
            </Card.Title>
          </div>
          <div className="flex items-center gap-1.5">
            {/* <Badge variant="secondary" size="sm">
              {displayType(item.classwork_type)}
            </Badge> */}
            <Badge variant={item.is_published ? "solid" : "default"} size="sm">
              {item.is_published ? "Published" : "Draft"}
            </Badge>
          </div>
        </Card.Header>

        <Card.Content className="mt-auto flex flex-col gap-3 mt-1">
          {tracking && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground">
                  Submitted{" "}
                  <span className="font-bold text-foreground">
                    {tracking.submitted_count}/{tracking.total_students}
                  </span>
                </span>
                <span className="font-bold text-foreground">
                  {completionRate === null ? "No students" : `${completionRate}%`}
                </span>
              </div>
              <Progress value={completionRate ?? 0} className="h-3" />
            </div>
          )}

          {!tracking && hasAssignments && (
            <p className="text-xs text-muted-foreground">
              Loading submission summary…
            </p>
          )}
          {!hasAssignments && (
            <p className="text-xs text-muted-foreground">
              Not assigned to a section
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {dueLabel ? (
              <span className="text-sm text-muted-foreground">{dueLabel}</span>
            ) : (
              <span className="text-sm text-muted-foreground">Created {formatDate(item.created_at)}</span>
            )}
          </div>
        </Card.Content>
      </Card>} />
      <TooltipContent>View classwork</TooltipContent>
    </Tooltip>
  );
}
