import { Card } from "@/components/retroui/Card";
import { Progress } from "@/components/retroui/Progress";
import type { TodoItem } from "@/lib/api";
import type { StudentLesson } from "@/types/student-subject";

type Props = {
  lessons: StudentLesson[];
  assignmentIdsByLesson: Record<number, number[]>;
  classworks: TodoItem[];
  onReview: (lesson: StudentLesson) => void;
};

export function StudentLessonMastery({ lessons, assignmentIdsByLesson, classworks }: Props) {
  return <Card className="block w-full min-w-0 shadow-none hover:shadow-none">
    <Card.Title className="mb-4 text-xl">Lesson Mastery</Card.Title>
    {lessons.length === 0 ? <p className="text-sm text-muted-foreground">No lessons available yet.</p> :
      <div className="space-y-4">{lessons.map((lesson) => {
        const ids = new Set(assignmentIdsByLesson[lesson.lesson_id] ?? []);
        const graded = classworks.filter((work) => ids.has(work.assignment_id) && work.is_graded !== false && work.show_scores !== false && work.submission_status === "graded" && work.grade != null && Number(work.total_points) > 0);
        const possible = graded.reduce((sum, work) => sum + Number(work.total_points), 0);
        const earned = graded.reduce((sum, work) => sum + Number(work.grade), 0);
        const percent = possible > 0 ? Math.round(earned / possible * 100) : null;
        return <Card key={lesson.lesson_id} className="block w-full min-w-0 space-y-3 shadow-none hover:shadow-none">
          <div className="flex items-start justify-between gap-3">
            <h3 className="min-w-0 break-words text-sm font-semibold">{lesson.title}</h3>
            <span className="shrink-0 text-sm font-semibold">{percent ?? 0}%</span>
          </div>
          <Progress
            value={Math.min(100, Math.max(0, percent ?? 0))}
            className="h-2"
            aria-label={`${lesson.title} mastery`}
            aria-valuetext={`${percent ?? 0}%`}
          />
        </Card>;
      })}</div>}
  </Card>;
}
