import { BookOpen } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import type { TodoItem } from "@/lib/api";
import type { StudentLesson } from "@/types/student-subject";

type Props = {
  lessons: StudentLesson[];
  assignmentIdsByLesson: Record<number, number[]>;
  classworks: TodoItem[];
  onReview: (lesson: StudentLesson) => void;
};

export function StudentLessonMastery({ lessons, assignmentIdsByLesson, classworks, onReview }: Props) {
  return <Card className="block w-full min-w-0 p-5">
    <Card.Title className="mb-4 text-xl">Lesson Mastery</Card.Title>
    {lessons.length === 0 ? <p className="text-sm text-muted-foreground">No lessons available yet.</p> :
      <div className="space-y-4">{lessons.map((lesson) => {
        const ids = new Set(assignmentIdsByLesson[lesson.lesson_id] ?? []);
        const graded = classworks.filter((work) => ids.has(work.assignment_id) && work.is_graded !== false && work.show_scores !== false && work.submission_status === "graded" && work.grade != null && Number(work.total_points) > 0);
        const possible = graded.reduce((sum, work) => sum + Number(work.total_points), 0);
        const earned = graded.reduce((sum, work) => sum + Number(work.grade), 0);
        const percent = possible > 0 ? Math.round(earned / possible * 100) : null;
        const level = percent === null ? "Not yet rated" : percent >= 80 ? "High" : percent >= 50 ? "Moderate" : "Low";
        return <div key={lesson.lesson_id} className="space-y-3 border-t-2 border-border pt-4 first:border-0 first:pt-0">
          <h3 className="font-semibold">{lesson.title}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" size="sm">{level}{percent === null ? "" : ` · ${percent}%`}</Badge>
            <p className="text-sm text-muted-foreground">{percent === null ? "Mastery appears after related classwork is graded." : level === "High" ? "Strong performance in related classwork." : level === "Moderate" ? "Making progress in related classwork." : "Related classwork suggests more practice may help."}</p>
          </div>
          <Button size="sm" className="gap-2" onClick={() => onReview(lesson)}><BookOpen className="size-4" aria-hidden="true" />Review lesson</Button>
        </div>;
      })}</div>}
  </Card>;
}
