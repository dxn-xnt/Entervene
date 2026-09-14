import { useMemo } from "react";
import { Card } from "@/components/retroui/Card";
import { EmptyStateCard } from "@/components/empty-state-card";
import { LoadingPanel } from "@/components/loading-panel";
import type { TodoItem } from "@/lib/api";

const TYPE_COLORS: Record<string, string> = {
  QUIZ: "#F59E0B",
  ASSIGNMENT: "#3B82F6",
  ACTIVITY: "#22C55E",
  EXAM: "#EF4444",
  PROJECT: "#8B5CF6",
};
const FALLBACK_COLOR = "#94A3B8";
const DONUT_RADIUS = 40;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

function colorForType(type: string) {
  return TYPE_COLORS[type.toUpperCase()] ?? FALLBACK_COLOR;
}

function computeCompletion(todos: TodoItem[]) {
  const total = todos.length;
  const completed = todos.filter((todo) =>
    todo.is_submitted || todo.status === "completed" || todo.grade !== null
  ).length;
  return { total, completed, rate: total > 0 ? Math.round((completed / total) * 100) : 0 };
}

function computeDistribution(todos: TodoItem[]) {
  const counts: Record<string, number> = {};
  todos.forEach((todo) => {
    const type = todo.type || "Other";
    counts[type] = (counts[type] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
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
  const distribution = useMemo(() => computeDistribution(todos), [todos]);
  const subjectPerformance = useMemo(() => computeSubjectPerformance(todos), [todos]);
  const weakestSubject = subjectPerformance.at(-1);
  const segments = useMemo(() => distribution.map((item, index) => {
      const offset = -distribution.slice(0, index).reduce(
        (sum, previous) => sum + (previous.count / todos.length) * DONUT_CIRCUMFERENCE,
        0,
      );
      const arc = (item.count / todos.length) * DONUT_CIRCUMFERENCE;
      return { ...item, arc, offset };
    }), [distribution, todos.length]);
  const ringRadius = 54;
  const ringCircumference = 2 * Math.PI * ringRadius;

  if (isLoading) return <LoadingPanel label="Loading grade overview..." />;
  if (error) return <EmptyStateCard title="Unable to load grade overview" description={error} />;

  return (
    <section aria-labelledby="grade-overview-heading" className="flex flex-col gap-3">
      <h2 id="grade-overview-heading" className="text-lg font-bold tracking-tight sm:text-xl">Grade Overview</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Card className="w-full">
          <Card.Header><Card.Title>Completion Rate</Card.Title></Card.Header>
          <Card.Content>
            <div className="flex items-center justify-center">
              <div className="relative h-36 w-36">
                <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden="true">
                  <circle cx="60" cy="60" r={ringRadius} fill="transparent" stroke="var(--muted)" strokeWidth="10" />
                  <circle cx="60" cy="60" r={ringRadius} fill="transparent"
                    stroke={completion.rate >= 80 ? "#22C55E" : completion.rate >= 50 ? "#F59E0B" : "#EF4444"}
                    strokeWidth="10" strokeDasharray={ringCircumference}
                    strokeDashoffset={ringCircumference * (1 - completion.rate / 100)} strokeLinecap="round"
                    className="transition-all duration-700 ease-out"
                    style={{ transform: "rotate(-90deg)", transformOrigin: "60px 60px" }} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold leading-none">{completion.rate}</span>
                  <span className="text-[10px] text-muted-foreground">%</span>
                </div>
              </div>
            </div>
            <p className="mt-2 text-center text-xs text-muted-foreground">{completion.completed} of {completion.total} activities done</p>
          </Card.Content>
        </Card>

        <Card className="w-full">
          <Card.Header><Card.Title>Classwork Distribution</Card.Title></Card.Header>
          <Card.Content>
            {todos.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No classwork data yet</p> : <>
              <div className="flex items-center justify-center">
                <div className="relative h-36 w-36">
                  <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
                    {segments.map((segment) => <circle key={segment.type} cx="50" cy="50" r={DONUT_RADIUS} fill="transparent"
                      stroke={colorForType(segment.type)} strokeWidth="20"
                      strokeDasharray={`${segment.arc} ${DONUT_CIRCUMFERENCE - segment.arc}`}
                      strokeDashoffset={segment.offset} className="transition-all duration-500" />)}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold leading-none">{todos.length}</span>
                    <span className="text-[9px] text-muted-foreground">total</span>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs">
                {distribution.map((item) => <span key={item.type} className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: colorForType(item.type) }} />
                  {item.type} ({item.count})
                </span>)}
              </div>
            </>}
          </Card.Content>
        </Card>

        <Card className="w-full md:col-span-2 xl:col-span-1">
          <Card.Header><Card.Title>Subject Performance</Card.Title></Card.Header>
          <Card.Content>
            {subjectPerformance.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No graded classwork yet</p> : <>
              <div className="flex flex-col gap-2">
                {subjectPerformance.map((item) => <div key={item.subjectId} className="flex items-center gap-2">
                  <span className="w-20 truncate text-[10px]" title={item.subject}>{item.subject}</span>
                  <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-3 rounded-full transition-all duration-500" style={{ width: `${item.score}%`, backgroundColor: item.score >= 80 ? "#22C55E" : item.score >= 60 ? "#F59E0B" : "#EF4444" }} />
                  </div>
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
