import { useMemo } from "react";
import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
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

export default function ClassworkCard({ item, tracking, onOpen }: ClassworkCardProps) {
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

  const completionRate = tracking && tracking.total_students > 0
    ? Math.round((tracking.submitted_count / tracking.total_students) * 100)
    : null;

  const openCard = () => onOpen(item);

  return (
    <Card
      className="block w-full cursor-pointer"
      role="button"
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
      <Card.Header className="mb-3 flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <Card.Title className="mb-1 line-clamp-2 break-words text-base font-bold [overflow-wrap:anywhere] md:text-lg">
            {item.title}
          </Card.Title>
          <Card.Description className="text-xs font-medium text-muted-foreground">
            {[item.subject_name, sections].filter(Boolean).join(" · ") || "Subject or section unavailable"}
          </Card.Description>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <Badge variant="secondary" size="sm">{displayType(item.classwork_type)}</Badge>
          <Badge variant={item.is_published ? "success" : "outline"} size="sm">
            {item.is_published ? "Published" : "Draft"}
          </Badge>
        </div>
      </Card.Header>

      <Card.Content className="grid gap-3 border-t border-border pt-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
          {tracking && (
            <>
              <div>
                <dt className="text-muted-foreground">Submitted</dt>
                <dd className="font-bold text-foreground">
                  {tracking.submitted_count} / {tracking.total_students}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Completion</dt>
                <dd className="font-bold text-foreground">
                  {completionRate === null ? "No enrolled students" : `${completionRate}%`}
                </dd>
              </div>
            </>
          )}
          {item.total_points !== null && item.total_points !== undefined && (
            <div>
              <dt className="text-muted-foreground">Points</dt>
              <dd className="font-bold text-foreground">{item.total_points}</dd>
            </div>
          )}
          <div>
            <dt className="text-muted-foreground">Created</dt>
            <dd className="font-bold text-foreground">{formatDate(item.created_at)}</dd>
          </div>
          {dueLabel && (
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-muted-foreground">Schedule</dt>
              <dd className="font-bold text-foreground">{dueLabel}</dd>
            </div>
          )}
        </dl>

        {!tracking && (item.assignments?.length ?? 0) > 0 && (
          <p className="text-xs text-muted-foreground">Loading submission summary…</p>
        )}
        {!item.assignments?.length && (
          <p className="text-xs text-muted-foreground">Not assigned to a section</p>
        )}
      </Card.Content>
    </Card>
  );
}
