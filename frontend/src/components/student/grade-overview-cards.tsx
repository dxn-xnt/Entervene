import { useMemo } from "react";
import { Card } from "@/components/retroui/Card";
import { Progress } from "@/components/retroui/Progress";
import { EmptyStateCard } from "@/components/empty-state-card";
import { LoadingPanel } from "@/components/loading-panel";
import type { TodoItem } from "@/lib/api";

function computeCompletion(todos: TodoItem[]) {
  const total = todos.length;
  const completed = todos.filter((todo) =>
    todo.is_submitted || todo.status === "completed" || todo.grade !== null
  ).length;
  return { total, completed, rate: total > 0 ? Math.round((completed / total) * 100) : 0 };
}

function computeSubjectPerformance(todos: TodoItem[]) {
  const buckets: Record<string, { subject: string; subjectId: number; earned: number; possible: number }> = {};
  todos.forEach((todo) => {
    if (todo.grade === null || !todo.total_points || todo.is_graded === false || todo.type?.toUpperCase() === "READING") return;
    const bucket = buckets[todo.subject_id] ?? {
      subject: todo.subject,
      subjectId: todo.subject_id,
      earned: 0,
      possible: 0,
    };
    bucket.earned += todo.grade;
    bucket.possible += todo.total_points;
    buckets[todo.subject_id] = bucket;
  });
  return Object.values(buckets)
    .map((bucket) => ({ ...bucket, score: Math.round((bucket.earned / bucket.possible) * 100) }))
    .sort((a, b) => b.score - a.score);
}

export function GradeOverviewCards({ todos, isLoading, error }: {
  todos: TodoItem[];
  isLoading: boolean;
  error: string | null;
}) {
  const completion = useMemo(() => computeCompletion(todos), [todos]);
  const subjectPerformance = useMemo(() => computeSubjectPerformance(todos), [todos]);
  const weakestSubject = subjectPerformance.at(-1);
  if (isLoading) return <LoadingPanel label="Loading grade overview..." />;
  if (error) return <EmptyStateCard title="Unable to load grade overview" description={error} />;

  return (
    <section aria-labelledby="grade-overview-heading" className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card className="w-full">
          <Card.Header><Card.Title>Completion Rate</Card.Title></Card.Header>
          <Card.Content>
            <div className="flex items-center gap-3">
              <Progress
                value={completion.rate}
                className="flex-1 size-25"
                variant="circular"
                aria-label={`Completion rate: ${completion.rate}%`}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{completion.completed} of {completion.total} activities done</p>
          </Card.Content>
        </Card>

        <Card className="w-full">
          <Card.Header><Card.Title>Subject Performance</Card.Title></Card.Header>
          <Card.Content>
            {subjectPerformance.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No graded classwork yet</p> : <>
              <div className="flex flex-col gap-2">
                {subjectPerformance.map((item) => <div key={item.subjectId} className="flex items-center gap-2">
                  <span className="w-20 truncate text-[10px]" title={item.subject}>{item.subject}</span>
                  <Progress
                    value={Math.min(100, Math.max(0, item.score))}
                    className="h-3 flex-1"
                    aria-label={`${item.subject} score: ${item.score}%`}
                  />
                  <span className="w-8 text-right text-[10px] font-semibold">{item.score}%</span>
                </div>)}
              </div>
              {weakestSubject && <p className="mt-3 text-[10px] text-muted-foreground">Recommended Attention: <span className="font-bold">{weakestSubject.subject}</span></p>}
            </>}
          </Card.Content>
        </Card>
      </div>
    </section>
  );
}
