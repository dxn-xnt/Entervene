import { Card } from "@/components/retroui/Card";
import { Progress } from "@/components/retroui/Progress";
import { cn } from "@/lib/utils";

export interface TeacherLessonMasteryItem {
  lesson_id: number;
  title: string;
  percent: number;
}

export interface TeacherLessonMasteryProps {
  items: TeacherLessonMasteryItem[];
  title?: string;
  className?: string;
  onSelectLesson?: (lessonId: number) => void;
  isLoading?: boolean;
}

export function TeacherLessonMastery({
  items,
  title = "Lesson Mastery",
  className,
  onSelectLesson,
  isLoading = false,
}: TeacherLessonMasteryProps) {
  return (
    <Card className={cn("block w-full min-w-0", className)}>
      <Card.Title className="mb-4 text-xl font-bold">{title}</Card.Title>
      {isLoading && items.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <Card
              key={n}
              className="block w-full min-w-0 space-y-3 shadow-none hover:shadow-none animate-pulse"
            >
              <div className="h-4 bg-muted rounded w-3/4" />
              <div className="h-2 bg-muted rounded w-full" />
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No lessons available yet.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card
              key={item.lesson_id}
              onClick={() => onSelectLesson?.(item.lesson_id)}
              className={cn(
                "block w-full min-w-0 space-y-3 shadow-none hover:shadow-none",
                onSelectLesson && "cursor-pointer transition-colors hover:bg-accent/40",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="min-w-0 break-words text-sm font-semibold text-foreground">
                  {item.title}
                </h3>
                <span className="shrink-0 text-sm font-semibold text-foreground">
                  {item.percent}%
                </span>
              </div>
              <Progress
                value={Math.min(100, Math.max(0, item.percent))}
                className="h-2"
                aria-label={`${item.title} mastery`}
                aria-valuetext={`${item.percent}%`}
              />
            </Card>
          ))}
        </div>
      )}
    </Card>
  );
}

export default TeacherLessonMastery;
