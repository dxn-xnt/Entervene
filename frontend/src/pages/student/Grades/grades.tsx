import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/retroui/Card";
import SubjectGrade from "./subject-grade";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { getMySubjects, getStudentTodos, type StudentSubjectItem, type TodoItem } from "@/lib/api";

// ─── Color palette for donut / legends ───────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  QUIZ: "#F59E0B",
  ASSIGNMENT: "#3B82F6",
  ACTIVITY: "#22C55E",
  EXAM: "#EF4444",
  PROJECT: "#8B5CF6",
};
const FALLBACK_COLOR = "#94A3B8";

function colorForType(type: string): string {
  return TYPE_COLORS[type.toUpperCase()] ?? FALLBACK_COLOR;
}

// ─── Computed analytics helpers ──────────────────────────────────────────────

/** Completion rate across all todos */
function computeCompletion(todos: TodoItem[]) {
  const total = todos.length;
  const completed = todos.filter(
    (t) => t.is_submitted || t.status === "completed" || t.grade !== null,
  ).length;
  const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, rate };
}

/** Group todos by classwork type for donut chart */
function computeDistribution(todos: TodoItem[]) {
  const counts: Record<string, number> = {};
  for (const t of todos) {
    const key = t.type || "Other";
    counts[key] = (counts[key] || 0) + 1;
  }
  const total = todos.length || 1; // avoid div-by-zero
  return Object.entries(counts)
    .map(([type, count]) => ({
      type,
      count,
      percent: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);
}

/** Per-subject average score (only graded items with total_points) */
function computeSubjectPerformance(todos: TodoItem[]) {
  const buckets: Record<
    string,
    { subject: string; subjectId: number; earned: number; possible: number }
  > = {};
  for (const t of todos) {
    if (t.grade === null || !t.total_points) continue;
    const key = t.subject_id;
    if (!buckets[key]) {
      buckets[key] = { subject: t.subject, subjectId: t.subject_id, earned: 0, possible: 0 };
    }
    buckets[key].earned += t.grade;
    buckets[key].possible += t.total_points;
  }
  return Object.values(buckets)
    .map((b) => ({
      ...b,
      score: b.possible > 0 ? Math.round((b.earned / b.possible) * 100) : 0,
    }))
    .sort((a, b) => a.score - b.score); // lowest first so "recommended attention" is [0]
}

// ─── SVG donut builder ───────────────────────────────────────────────────────
const DONUT_RADIUS = 40;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

function donutSegments(distribution: ReturnType<typeof computeDistribution>) {
  let offset = 0;
  return distribution.map((d) => {
    const arc = (d.count / distribution.reduce((s, x) => s + x.count, 0)) * DONUT_CIRCUMFERENCE;
    const segment = { ...d, arc, offset, color: colorForType(d.type) };
    offset -= arc; // negative offset moves clockwise
    return segment;
  });
}

// ─── Main component ──────────────────────────────────────────────────────────

const Grades = () => {
  const [selectedSubject, setSelectedSubject] = useState<{ id: number; classId?: number; name: string } | null>(null);
  const [subjects, setSubjects] = useState<StudentSubjectItem[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    Promise.all([getMySubjects(), getStudentTodos()])
      .then(([subjectsData, todosData]) => {
        if (!isMounted) return;
        setSubjects(subjectsData);
        setTodos(todosData.all || []);
      })
      .catch((err) => console.error("Error loading student grades overview:", err))
      .finally(() => {
        if (isMounted) setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // ── Derived analytics (recompute only when todos change) ──
  const completion = useMemo(() => computeCompletion(todos), [todos]);
  const distribution = useMemo(() => computeDistribution(todos), [todos]);
  const segments = useMemo(() => donutSegments(distribution), [distribution]);
  const subjectPerf = useMemo(() => computeSubjectPerformance(todos), [todos]);
  const weakestSubject = subjectPerf.length > 0 ? subjectPerf[0] : null;

  if (selectedSubject) {
    return (
      <SubjectGrade
        subjectId={selectedSubject.id}
        classId={selectedSubject.classId}
        subject={selectedSubject.name}
        onBack={() => setSelectedSubject(null)}
      />
    );
  }

  const getGradedCount = (subjectId: number) => {
    return todos.filter(
      (t) => t.subject_id === subjectId && (t.status === "completed" || t.is_submitted || t.grade !== null)
    ).length;
  };

  // Ring arc for the completion widget
  const RING_R = 54;
  const RING_C = 2 * Math.PI * RING_R;
  const ringStroke = RING_C * (1 - completion.rate / 100);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            <header className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" />
              <h1 className="text-2xl md:text-4xl font-bold tracking-tight">
                Grades
              </h1>
            </header>

            <div className="-mx-4 md:-mx-6 border-b-2 border-border -mt-[1px]" />

            <main className="flex flex-col gap-3 py-3">
              {/* ── Analytics Widgets ── */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {/* Widget 1 — Overall Completion Rate */}
                <div className="border-2 border-black p-4 shadow-md bg-card">
                  <h2 className="text-lg font-semibold mb-4">Completion Rate</h2>
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
                          stroke={completion.rate >= 80 ? "#22C55E" : completion.rate >= 50 ? "#F59E0B" : "#EF4444"}
                          strokeWidth="10"
                          strokeDasharray={RING_C}
                          strokeDashoffset={ringStroke}
                          strokeLinecap="round"
                          className="transition-all duration-700 ease-out"
                          style={{ transform: "rotate(-90deg)", transformOrigin: "60px 60px" }}
                        />
                      </svg>
                      {/* Center label */}
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-3xl font-bold leading-none">{completion.rate}</span>
                        <span className="text-[10px] text-gray-500 -mt-0.5">%</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-center text-xs text-gray-600 mt-2">
                    {completion.completed} of {completion.total} activities done
                  </p>
                </div>

                {/* Widget 2 — Classwork Distribution (donut) */}
                <div className="border-2 border-black p-4 shadow-md bg-card">
                  <h2 className="text-lg font-semibold mb-4">Classwork Distribution</h2>
                  {todos.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">No classwork data yet</p>
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
                                strokeDasharray={`${seg.arc} ${DONUT_CIRCUMFERENCE - seg.arc}`}
                                strokeDashoffset={seg.offset}
                                className="transition-all duration-500"
                              />
                            ))}
                          </svg>
                          {/* Center total */}
                          <div className="absolute inset-0 flex flex-col items-center justify-center rotate-0">
                            <span className="text-2xl font-bold leading-none">{todos.length}</span>
                            <span className="text-[9px] text-gray-500">total</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-3 text-xs">
                        {distribution.map((d) => (
                          <span key={d.type} className="flex items-center gap-1">
                            <span
                              className="w-2 h-2 rounded-full inline-block"
                              style={{ backgroundColor: colorForType(d.type) }}
                            />
                            {d.type} ({d.count})
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Widget 3 — Subject Performance */}
                <div className="border-2 border-black p-4 shadow-md bg-card">
                  <h2 className="text-lg font-semibold mb-3">Subject Performance</h2>
                  {subjectPerf.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">No graded classwork yet</p>
                  ) : (
                    <>
                      <div className="flex flex-col gap-2">
                        {[...subjectPerf].sort((a, b) => b.score - a.score).map((item) => (
                          <div key={item.subjectId} className="flex items-center gap-2">
                            <span className="text-[10px] w-20 truncate" title={item.subject}>
                              {item.subject}
                            </span>
                            <div className="flex-1 bg-gray-200 rounded-full h-3 relative overflow-hidden">
                              <div
                                className="h-3 rounded-full transition-all duration-500"
                                style={{
                                  width: `${item.score}%`,
                                  backgroundColor:
                                    item.score >= 80 ? "#22C55E" : item.score >= 60 ? "#F59E0B" : "#EF4444",
                                }}
                              />
                            </div>
                            <span className="text-[10px] font-semibold w-8 text-right">
                              {item.score}%
                            </span>
                          </div>
                        ))}
                      </div>
                      {weakestSubject && (
                        <p className="text-[10px] mt-3 text-gray-600">
                          Recommended Attention:{" "}
                          <span className="font-bold">{weakestSubject.subject}</span>
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* ── Subject list ── */}
              <div className="flex flex-col gap-4">
              {loading ? (
                <div className="py-6 text-center text-sm text-gray-500">Loading subjects...</div>
              ) : subjects.length === 0 ? (
                <div className="py-6 text-center text-sm text-gray-500">No subjects enrolled.</div>
              ) : (
                subjects.map((sub) => (
                  <Card
                    key={sub.subject_load_id}
                    className="block w-full cursor-pointer hover:border-black transition-colors"
                    onClick={() => setSelectedSubject({ id: sub.subject_id, classId: sub.class_id, name: sub.subject_name })}
                  >
                    <Card.Content className="flex items-center justify-between">
                      <div>
                        <Card.Title className="mb-1 text-lg">
                          {sub.subject_name}
                        </Card.Title>
                        <p className="text-sm text-gray-600">{sub.teacher_name}</p>
                      </div>

                      <div className="text-right">
                        <Card.Description>{getGradedCount(sub.subject_id)}</Card.Description>
                        <p className="text-xs text-gray-600">Graded Classwork</p>
                      </div>
                    </Card.Content>
                  </Card>
                ))
              )}
              </div>
            </main>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Grades;
