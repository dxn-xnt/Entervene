import { useMemo } from "react";
import { Card } from "@/components/retroui/Card";
import type { TodoItem } from "@/lib/api";

// ─── Color palette for donut / legends ───────────────────────────────────────
export const TYPE_COLORS: Record<string, string> = {
  QUIZ: "#F59E0B",
  ASSIGNMENT: "#3B82F6",
  ACTIVITY: "#22C55E",
  EXAM: "#EF4444",
  PROJECT: "#8B5CF6",
};
export const FALLBACK_COLOR = "#94A3B8";

export function colorForType(type: string): string {
  return TYPE_COLORS[type.toUpperCase()] ?? FALLBACK_COLOR;
}

// ─── SVG Donut Dimensions ───────────────────────────────────────────────────
export const DONUT_RADIUS = 40;
export const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

// ─── Analytics computation helpers ──────────────────────────────────────────

/** Completion rate across all todos */
export function computeCompletion(todos: TodoItem[]) {
  const total = todos.length;
  const completed = todos.filter(
    (t) => t.is_submitted || t.status === "completed" || t.grade !== null,
  ).length;
  const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, rate };
}

/** Group todos by classwork type for donut chart */
export function computeDistribution(todos: TodoItem[]) {
  const counts: Record<string, number> = {};
  for (const t of todos) {
    const key = t.type || "Other";
    counts[key] = (counts[key] || 0) + 1;
  }
  const total = todos.length || 1;
  return Object.entries(counts)
    .map(([type, count]) => ({
      type,
      count,
      percent: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);
}

/** Per-subject average score (only graded items with total_points) */
export function computeSubjectPerformance(todos: TodoItem[]) {
  const buckets: Record<
    string,
    { subject: string; subjectId: number; earned: number; possible: number }
  > = {};
  for (const t of todos) {
    if (
      t.grade === null ||
      !t.total_points ||
      t.is_graded === false ||
      t.type?.toUpperCase() === "READING"
    ) {
      continue;
    }
    const key = String(t.subject_id);
    if (!buckets[key]) {
      buckets[key] = {
        subject: t.subject,
        subjectId: t.subject_id,
        earned: 0,
        possible: 0,
      };
    }
    buckets[key].earned += t.grade;
    buckets[key].possible += t.total_points;
  }
  return Object.values(buckets)
    .map((b) => ({
      ...b,
      score: b.possible > 0 ? Math.round((b.earned / b.possible) * 100) : 0,
    }))
    .sort((a, b) => a.score - b.score);
}

/** SVG Donut Segments builder */
export function donutSegments(distribution: ReturnType<typeof computeDistribution>) {
  let offset = 0;
  const total = distribution.reduce((s, x) => s + x.count, 0) || 1;
  return distribution.map((d) => {
    const arc = (d.count / total) * DONUT_CIRCUMFERENCE;
    const segment = { ...d, arc, offset, color: colorForType(d.type) };
    offset -= arc;
    return segment;
  });
}

/** Hook for computing student analytics from todos */
export function useStudentAnalytics(todos: TodoItem[]) {
  const completion = useMemo(() => computeCompletion(todos), [todos]);
  const distribution = useMemo(() => computeDistribution(todos), [todos]);
  const segments = useMemo(() => donutSegments(distribution), [distribution]);
  const subjectPerf = useMemo(() => computeSubjectPerformance(todos), [todos]);
  const weakestSubject = subjectPerf.length > 0 ? subjectPerf[0] : null;

  return {
    completion,
    distribution,
    segments,
    subjectPerf,
    weakestSubject,
  };
}

// ─── Individual Reusable Analytics Cards ────────────────────────────────────

interface CompletionRateCardProps {
  completion: ReturnType<typeof computeCompletion>;
  loading?: boolean;
  className?: string;
}

export function CompletionRateCard({
  completion,
  loading = false,
  className = "",
}: CompletionRateCardProps) {
  const RING_R = 54;
  const RING_C = 2 * Math.PI * RING_R;
  const ringStroke = RING_C * (1 - completion.rate / 100);

  return (
    <Card className={`block w-full border-black bg-white shadow-md hover:shadow-none ${className}`}>
      <Card.Header>
        <Card.Title className="mb-0 text-xl font-bold sm:text-2xl">Completion Rate</Card.Title>
      </Card.Header>

      <Card.Content>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-6 animate-pulse">
            <div className="w-36 h-36 rounded-full border-8 border-gray-200" />
            <div className="h-3 w-32 bg-gray-200 rounded mt-4" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-center">
              <div className="relative w-36 h-36">
                <svg viewBox="0 0 120 120" className="w-full h-full">
                  {/* Background ring */}
                  <circle
                    cx="60"
                    cy="60"
                    r={RING_R}
                    fill="transparent"
                    stroke="#E5E7EB"
                    strokeWidth="10"
                  />

                  {/* Filled arc */}
                  <circle
                    cx="60"
                    cy="60"
                    r={RING_R}
                    fill="transparent"
                    stroke={
                      completion.rate >= 80
                        ? "#22C55E"
                        : completion.rate >= 50
                          ? "#F59E0B"
                          : "#EF4444"
                    }
                    strokeWidth="10"
                    strokeDasharray={RING_C}
                    strokeDashoffset={ringStroke}
                    strokeLinecap="round"
                    className="transition-all duration-700 ease-out"
                    style={{
                      transform: "rotate(-90deg)",
                      transformOrigin: "60px 60px",
                    }}
                  />
                </svg>

                {/* Center label */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold leading-none">
                    {completion.rate}
                  </span>
                  <span className="text-[10px] text-gray-500 -mt-0.5">
                    %
                  </span>
                </div>
              </div>
            </div>

            <p className="text-center text-xs text-gray-600 mt-2">
              {completion.completed} of {completion.total} activities done
            </p>
          </>
        )}
      </Card.Content>
    </Card>
  );
}

interface ClassworkDistributionCardProps {
  distribution: ReturnType<typeof computeDistribution>;
  segments: ReturnType<typeof donutSegments>;
  totalCount: number;
  loading?: boolean;
  className?: string;
}

export function ClassworkDistributionCard({
  distribution,
  segments,
  totalCount,
  loading = false,
  className = "",
}: ClassworkDistributionCardProps) {
  return (
    <Card className={`block w-full border-black bg-white shadow-md hover:shadow-none ${className}`}>
      <Card.Header>
        <Card.Title className="mb-0 text-xl font-bold sm:text-2xl">Classwork Distribution</Card.Title>
      </Card.Header>

      <Card.Content>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-6 animate-pulse">
            <div className="w-36 h-36 rounded-full border-8 border-gray-200" />
            <div className="h-3 w-40 bg-gray-200 rounded mt-4" />
          </div>
        ) : totalCount === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">
            No classwork data yet
          </p>
        ) : (
          <>
            <div className="flex items-center justify-center">
              <div className="relative w-36 h-36">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                  {segments.map((seg) => (
                    <circle
                      key={seg.type}
                      cx="50"
                      cy="50"
                      r={DONUT_RADIUS}
                      fill="transparent"
                      stroke={seg.color}
                      strokeWidth="20"
                      strokeDasharray={`${seg.arc} ${
                        DONUT_CIRCUMFERENCE - seg.arc
                      }`}
                      strokeDashoffset={seg.offset}
                      className="transition-all duration-500"
                    />
                  ))}
                </svg>

                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold leading-none">
                    {totalCount}
                  </span>
                  <span className="text-[9px] text-gray-500">
                    total
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-3 text-xs">
              {distribution.map((d) => (
                <span key={d.type} className="flex items-center gap-1">
                  <span
                    className="w-2 h-2 rounded-full inline-block"
                    style={{
                      backgroundColor: colorForType(d.type),
                    }}
                  />
                  {d.type} ({d.count})
                </span>
              ))}
            </div>
          </>
        )}
      </Card.Content>
    </Card>
  );
}

interface SubjectPerformanceCardProps {
  subjectPerf: ReturnType<typeof computeSubjectPerformance>;
  weakestSubject: ReturnType<typeof computeSubjectPerformance>[0] | null;
  loading?: boolean;
  className?: string;
}

export function SubjectPerformanceCard({
  subjectPerf,
  weakestSubject,
  loading = false,
  className = "",
}: SubjectPerformanceCardProps) {
  return (
    <Card className={`block w-full border-black bg-white shadow-md hover:shadow-none ${className}`}>
      <Card.Header>
        <Card.Title className="mb-0 text-xl font-bold sm:text-2xl">Subject Performance</Card.Title>
      </Card.Header>

      <Card.Content>
        {loading ? (
          <div className="flex flex-col gap-3 py-4 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-full" />
            <div className="h-4 bg-gray-200 rounded w-5/6" />
            <div className="h-4 bg-gray-200 rounded w-4/6" />
          </div>
        ) : subjectPerf.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">
            No graded classwork yet
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {[...subjectPerf]
                .sort((a, b) => b.score - a.score)
                .map((item) => (
                  <div key={item.subjectId} className="flex items-center gap-2">
                    <span
                      className="text-xs w-28 truncate font-medium"
                      title={item.subject}
                    >
                      {item.subject}
                    </span>

                    <div className="flex-1 bg-gray-200 rounded-full h-3 relative overflow-hidden">
                      <div
                        className="h-3 rounded-full transition-all duration-500"
                        style={{
                          width: `${item.score}%`,
                          backgroundColor:
                            item.score >= 80
                              ? "#22C55E"
                              : item.score >= 60
                                ? "#F59E0B"
                                : "#EF4444",
                        }}
                      />
                    </div>

                    <span className="text-xs font-semibold w-10 text-right">
                      {item.score}%
                    </span>
                  </div>
                ))}
            </div>

            {weakestSubject && (
              <p className="text-xs mt-3 text-gray-600">
                Recommended Attention:{" "}
                <span className="font-bold">{weakestSubject.subject}</span>
              </p>
            )}
          </>
        )}
      </Card.Content>
    </Card>
  );
}
