import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import { Progress } from "@/components/retroui/Progress";
import type { TodoItem } from "@/lib/api";
import {
  computeSubjectLessonMastery,
  type MasteryClassworkInput,
} from "@/lib/student-lesson-mastery";
import { cn } from "@/lib/utils";
import type { StudentLesson } from "@/types/student-subject";

type Props = {
  lessons: StudentLesson[];
  assignmentIdsByLesson: Record<number, number[]>;
  classworks: Array<TodoItem | MasteryClassworkInput>;
  lessonClassworksByLesson?: Record<number, MasteryClassworkInput[]>;
  onReview?: (lesson: StudentLesson) => void;
};

export function StudentLessonMastery({
  lessons,
  assignmentIdsByLesson,
  classworks,
  lessonClassworksByLesson,
}: Props) {
  const { aggregate, perLesson } = computeSubjectLessonMastery(
    lessons,
    assignmentIdsByLesson,
    classworks,
    lessonClassworksByLesson,
  );
  const AggregateIcon = aggregate.icon;

  return (
    <Card className="block w-full min-w-0 shadow-none hover:shadow-none">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Card.Title className="text-xl">Lesson Mastery</Card.Title>
        <Badge
          size="sm"
          className={cn(aggregate.badgeClass)}
          data-testid="subject-mastery-badge"
        >
          {aggregate.percentage !== null
            ? aggregate.badgeLabel
            : "Not yet rated"}
        </Badge>
      </div>

      {lessons.length === 0 ? (
        <p className="text-sm text-muted-foreground">No lessons available yet.</p>
      ) : (
        <div className="space-y-4">
          <Card
            className={cn(
              "flex flex-col items-center gap-1 border-2 p-3 shadow-none hover:shadow-none",
              aggregate.bgClass,
            )}
            data-testid="subject-mastery-summary"
          >
            <AggregateIcon
              aria-hidden="true"
              fill={aggregate.fillColor}
              className="size-8 stroke-black stroke-[2] [&_path]:fill-none"
            />
            <p className={cn("text-base font-bold text-center", aggregate.colorClass)}>
              {aggregate.percentage !== null
                ? aggregate.label
                : "Not yet rated"}
            </p>
            <p className="text-xs text-muted-foreground text-center">
              {aggregate.description}
            </p>
          </Card>

          <div className="space-y-3">
            {perLesson.map(({ lesson, mastery }) => {
              const percent = mastery.percentage;
              return (
                <Card
                  key={lesson.lesson_id}
                  className="block w-full min-w-0 space-y-2.5 shadow-none hover:shadow-none"
                  data-testid={`subject-lesson-mastery-${lesson.lesson_id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="min-w-0 break-words text-sm font-semibold">
                      {lesson.title}
                    </h3>
                    <span className="shrink-0 text-xs font-semibold">
                      {percent !== null ? mastery.label : "Not yet rated"}
                    </span>
                  </div>
                  <Progress
                    value={percent !== null ? Math.min(100, Math.max(0, percent)) : 0}
                    className="h-2"
                    aria-label={`${lesson.title} mastery`}
                    aria-valuetext={percent !== null ? mastery.label : "Not yet rated"}
                  />
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
