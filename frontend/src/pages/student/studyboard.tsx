import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Calendar } from "lucide-react";
import AppLayout from "@/layouts/app-layout";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Progress } from "@/components/retroui/Progress";
import { LoadingPanel } from "@/components/loading-panel";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { SubjectCard } from "@/components/subject-card";
import { routes } from "@/../routes";
import {
  getMyStudyboardMetrics,
  type StudentStudyboardMetrics,
  type TodoItem,
} from "@/lib/api";
import { useStudentOverviewData } from "@/hooks/use-student-overview-data";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const attendanceLabel = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  excused: "Excused",
  no_record: "No record",
} as const;
const dayLabel = (value: string) =>
  new Date(
    value.includes("T") ? value : `${value}T12:00:00`,
  ).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const duration = (seconds: number) => {
  const minutes = seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0;
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : `${minutes}m`;
};

function MetricCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`flex min-w-0 flex-col gap-0 ${className}`}>
      <Card.Header className="mb-3">
        <Card.Title className="text-lg sm:text-xl">{title}</Card.Title>
      </Card.Header>
      <Card.Content className="flex min-w-0 flex-1 flex-col">
        {children}
      </Card.Content>
    </Card>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="my-auto py-7 text-sm text-muted-foreground">{children}</p>
  );
}

export default function Studyboard() {
  const navigate = useNavigate();
  const { subjects, todos, isLoading, error } = useStudentOverviewData();
  const { selectedPeriodId } = useAcademicPeriod();
  const [metrics, setMetrics] = useState<StudentStudyboardMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // Reset belongs to the period-scoped request lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMetricsLoading(true);
    setMetricsError(null);
    setMetrics(null);
    getMyStudyboardMetrics(selectedPeriodId)
      .then((value) => {
        if (active) setMetrics(value);
      })
      .catch((cause: unknown) => {
        if (active)
          setMetricsError(
            cause instanceof Error ? cause.message : "Unable to load insights.",
          );
      })
      .finally(() => {
        if (active) setMetricsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedPeriodId]);

  const overview = useMemo(() => {
    const graded = todos.filter(
      (item) =>
        item.grade !== null &&
        item.total_points &&
        item.is_graded !== false &&
        item.show_scores !== false,
    );
    const earned = graded.reduce((sum, item) => sum + (item.grade || 0), 0);
    const possible = graded.reduce(
      (sum, item) => sum + (item.total_points || 0),
      0,
    );
    const done = todos.filter(
      (item) => item.is_submitted || item.status === "completed",
    ).length;
    const late = todos.filter((item) => item.status === "pastdue").length;
    const pending = Math.max(0, todos.length - done - late);
    const bySubject = new Map<
      number,
      { name: string; earned: number; possible: number }
    >();
    graded.forEach((item) => {
      const bucket = bySubject.get(item.subject_id) || {
        name: item.subject,
        earned: 0,
        possible: 0,
      };
      bucket.earned += item.grade || 0;
      bucket.possible += item.total_points || 0;
      bySubject.set(item.subject_id, bucket);
    });
    const subjects = [...bySubject.values()]
      .map((item) => ({
        name: item.name,
        score: Math.round((item.earned / item.possible) * 100),
      }))
      .sort((a, b) => b.score - a.score);
    const deadlines = todos
      .filter(
        (item) =>
          item.status === "pending" && !item.is_submitted && item.due_date,
      )
      .sort(
        (a, b) =>
          new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime(),
      )
      .slice(0, 4);
    return {
      average: possible ? Math.round((earned / possible) * 100) : null,
      gradedCount: graded.length,
      done,
      late,
      pending,
      subjects,
      deadlines,
    };
  }, [todos]);

  const readingTotal =
    metrics?.daily_reading_seconds.reduce((sum, value) => sum + value, 0) || 0;
  const readingDays = (metrics?.daily_reading_seconds || []).map(
    (seconds, index) => ({
      day: days[index],
      minutes: Math.round(seconds / 60),
    }),
  );
  const trend =
    metrics?.grade_trend.map((item) => ({
      label: dayLabel(item.week_start),
      average: item.average,
    })) || [];
  const quizCount = (metrics?.quiz_correct || 0) + (metrics?.quiz_wrong || 0);
  const onTimeTotal =
    (metrics?.on_time_count || 0) + (metrics?.late_submission_count || 0);
  const metricState = metricsLoading ? (
    <LoadingPanel label="Loading insights..." />
  ) : metricsError ? (
    <Empty>{metricsError}</Empty>
  ) : null;
  const todoState = isLoading ? (
    <LoadingPanel label="Loading classwork..." />
  ) : error ? (
    <Empty>{error}</Empty>
  ) : null;

  const openTodo = (item: TodoItem) => {
    navigate(
      item.class_id && item.subject_id
        ? `/student/subjects/${item.class_id}/${item.subject_id}?tab=classwork&classworkAssignmentId=${item.assignment_id}`
        : routes.student.todo,
    );
  };

  return (
    <AppLayout>
      <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
        <header className="flex items-center justify-between gap-2 bg-background px-3 py-3 sm:px-4 sm:py-4 md:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <SidebarTrigger className="shrink-0 md:hidden" />
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl md:text-4xl">
              Study Board
            </h1>
          </div>
          <Button
            type="button"
            size="header"
            onClick={() => navigate(routes.student.profile)}
            className="shrink-0 whitespace-nowrap"
            aria-label="View my schedule"
          >
            <Calendar className="size-4" />
            <span className="hidden sm:inline">View My Schedule</span>
            <span className="sm:hidden">Schedule</span>
          </Button>
        </header>
        <main className="-mt-[1px] grid min-w-0 grid-cols-1 gap-4 border-t-2 border-border px-3 py-4 sm:grid-cols-2 sm:px-4 md:px-6 xl:grid-cols-12">
          <MetricCard title="Average Score" className="xl:col-span-6">
            {todoState ||
              (overview.average === null ? (
                <Empty>No released graded scores yet.</Empty>
              ) : (
                <>
                  <p className="text-4xl font-black">{overview.average}%</p>
                  <Progress
                    value={overview.average}
                    className="mt-4"
                    aria-label={`Average score ${overview.average}%`}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Across {overview.gradedCount} graded activities
                  </p>
                </>
              ))}
          </MetricCard>
          <MetricCard title="Assignment Status" className="xl:col-span-6">
            {todoState ||
              (todos.length === 0 ? (
                <Empty>No classwork assigned yet.</Empty>
              ) : (
                <div className="flex flex-1 items-center gap-4">
                  <div
                    className="relative shrink-0"
                    role="img"
                    aria-label={`${overview.done} done, ${overview.pending} pending, ${overview.late} past due`}
                  >
                    <PieChart width={136} height={136}>
                      <Pie
                        data={[
                          { value: overview.done },
                          { value: overview.pending },
                          { value: overview.late },
                        ]}
                        dataKey="value"
                        innerRadius={42}
                        outerRadius={62}
                        stroke="var(--border)"
                        strokeWidth={1}
                        isAnimationActive={false}
                      >
                        <Cell fill="var(--primary)" />
                        <Cell fill="var(--muted)" />
                        <Cell fill="var(--destructive)" />
                      </Pie>
                    </PieChart>
                    <span className="absolute inset-0 flex items-center justify-center text-xl font-bold">
                      {todos.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5 text-sm">
                    <span>
                      <i className="mr-2 inline-block size-2.5 bg-primary" />
                      Done: {overview.done}
                    </span>
                    <span>
                      <i className="mr-2 inline-block size-2.5 bg-muted ring-1 ring-border" />
                      Pending: {overview.pending}
                    </span>
                    <span>
                      <i className="mr-2 inline-block size-2.5 bg-destructive" />
                      Past due: {overview.late}
                    </span>
                  </div>
                </div>
              ))}
          </MetricCard>
          <MetricCard
            title="Study Time This Week"
            className="sm:col-span-2 xl:col-span-12"
          >
            {metricState ||
              (readingTotal === 0 ? (
                <Empty>
                  No tracked reading time on work recorded this week.
                </Empty>
              ) : (
                <>
                  <p className="text-4xl font-black">
                    {duration(readingTotal)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Cumulative reading time on work recorded this week; daily
                    study sessions are not tracked
                  </p>
                  <div
                    className="mt-3 h-36 min-w-0"
                    aria-label="Reading time grouped by work date"
                  >
                    <ResponsiveContainer
                      width="100%"
                      height="100%"
                      minWidth={0}
                    >
                      <BarChart
                        data={readingDays}
                        margin={{ top: 8, right: 0, left: -28, bottom: 0 }}
                      >
                        <CartesianGrid
                          vertical={false}
                          stroke="var(--border)"
                          strokeOpacity={0.35}
                        />
                        <XAxis
                          dataKey="day"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: "var(--foreground)", fontSize: 11 }}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          tick={{
                            fill: "var(--muted-foreground)",
                            fontSize: 10,
                          }}
                        />
                        <ChartTooltip
                          formatter={(value) => `${value} min`}
                          contentStyle={{
                            background: "var(--card)",
                            borderColor: "var(--border)",
                            color: "var(--foreground)",
                          }}
                        />
                        <Bar
                          dataKey="minutes"
                          fill="var(--primary)"
                          stroke="var(--border)"
                          maxBarSize={42}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              ))}
          </MetricCard>
          <MetricCard
            title="Grade Trend"
            className="sm:col-span-2 xl:col-span-8"
          >
            {metricState ||
              (!trend.some((item) => item.average !== null) ? (
                <Empty>No graded classwork in the last six weeks.</Empty>
              ) : (
                <>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Weekly average of released graded classwork
                  </p>
                  <div
                    className="h-56 min-w-0"
                    aria-label="Grade trend over six weeks"
                  >
                    <ResponsiveContainer
                      width="100%"
                      height="100%"
                      minWidth={0}
                    >
                      <LineChart
                        data={trend}
                        margin={{ top: 8, right: 12, left: -26, bottom: 0 }}
                      >
                        <CartesianGrid
                          vertical={false}
                          stroke="var(--border)"
                          strokeOpacity={0.35}
                        />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: "var(--foreground)", fontSize: 11 }}
                        />
                        <YAxis
                          domain={[0, 100]}
                          tickLine={false}
                          axisLine={false}
                          tick={{
                            fill: "var(--muted-foreground)",
                            fontSize: 11,
                          }}
                        />
                        <ChartTooltip
                          formatter={(value) => `${value}%`}
                          contentStyle={{
                            background: "var(--card)",
                            borderColor: "var(--border)",
                            color: "var(--foreground)",
                          }}
                        />
                        <Line
                          type="linear"
                          dataKey="average"
                          stroke="var(--primary)"
                          strokeWidth={3}
                          dot={{
                            r: 4,
                            fill: "var(--primary)",
                            stroke: "var(--border)",
                          }}
                          connectNulls={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </>
              ))}
          </MetricCard>
          <MetricCard
            title="Time per Subject"
            className="sm:col-span-2 xl:col-span-4"
          >
            {metricState ||
              (!metrics?.subject_reading_seconds.length ? (
                <Empty>
                  No tracked reading time by subject on work recorded this week.
                </Empty>
              ) : (
                <>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Cumulative reading time on work recorded this week
                  </p>
                  <div className="space-y-3">
                    {metrics.subject_reading_seconds.map((item) => (
                      <div
                        key={item.subject}
                        className="grid grid-cols-[minmax(0,1fr)_4rem] gap-x-2 gap-y-1 text-xs"
                      >
                        <Tooltip>
                          <TooltipTrigger render={<span tabIndex={0} className="truncate font-medium">{item.subject}</span>} />
                          <TooltipContent>{item.subject}</TooltipContent>
                        </Tooltip>
                        <span className="text-right font-semibold">
                          {duration(item.seconds)}
                        </span>
                        <Progress
                          value={
                            (item.seconds /
                              Math.max(
                                ...metrics.subject_reading_seconds.map(
                                  (subject) => subject.seconds,
                                ),
                              )) *
                            100
                          }
                          className="col-span-2 h-3"
                          aria-label={`${item.subject}: ${duration(item.seconds)}`}
                        />
                      </div>
                    ))}
                  </div>
                </>
              ))}
          </MetricCard>
          <MetricCard title="On-Time Submissions" className="xl:col-span-4">
            {metricState ||
              (onTimeTotal === 0 ? (
                <Empty>No dated submissions recorded yet.</Empty>
              ) : (
                <div className="flex items-center gap-4">
                  <Progress
                    value={Math.round(
                      (metrics!.on_time_count / onTimeTotal) * 100,
                    )}
                    variant="circular"
                    className="size-24"
                    aria-label={`${metrics!.on_time_count} of ${onTimeTotal} on time`}
                  />
                  <div className="text-sm">
                    <p className="font-semibold">
                      {metrics!.on_time_count} of {onTimeTotal} on time
                    </p>
                    <p className="text-muted-foreground">
                      {metrics!.late_submission_count} late
                    </p>
                  </div>
                </div>
              ))}
          </MetricCard>
          <MetricCard title="Quiz Accuracy" className="xl:col-span-4">
            {metricState ||
              (quizCount === 0 ? (
                <Empty>No released graded quiz answers yet.</Empty>
              ) : (
                <>
                  <p className="text-4xl font-black">
                    {Math.round((metrics!.quiz_correct / quizCount) * 100)}%
                  </p>
                  <Progress
                    value={(metrics!.quiz_correct / quizCount) * 100}
                    className="mt-4"
                    aria-label={`${metrics!.quiz_correct} correct out of ${quizCount} graded quiz answers`}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {metrics!.quiz_correct} correct · {metrics!.quiz_wrong}{" "}
                    incorrect
                  </p>
                </>
              ))}
          </MetricCard>
          <MetricCard title="Upcoming Deadlines" className="xl:col-span-4">
            {todoState ||
              (overview.deadlines.length === 0 ? (
                <Empty>No upcoming dated classwork.</Empty>
              ) : (
                <div className="space-y-2">
                  {overview.deadlines.map((item) => (
                    <Tooltip key={item.assignment_id}>
                    <TooltipTrigger render={<button
                      type="button"
                      onClick={() => openTodo(item)}
                      aria-label={`View classwork: ${item.title}`}
                      className="flex w-full items-center justify-between gap-3 rounded border border-border bg-background p-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">
                          {item.title}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.subject}
                        </span>
                      </span>
                      <Badge variant="outline" size="sm" className="shrink-0">
                        {dayLabel(item.due_date!)}
                      </Badge>
                    </button>} />
                    <TooltipContent>View classwork</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              ))}
          </MetricCard>
          <MetricCard
            title="Attendance"
            className="sm:col-span-2 xl:col-span-4"
          >
            {metricState || (
              <>
                <div className="flex items-baseline gap-2">
                  <p className="text-4xl font-black">
                    {metrics?.attendance_rate == null
                      ? "—"
                      : `${metrics.attendance_rate}%`}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    recorded days this week
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-5 gap-1 sm:gap-2">
                  {metrics?.attendance.map((day, index) => (
                    <div key={day.date} className="min-w-0 text-center">
                      <p className="mb-1 text-xs font-semibold">
                        {days[index]}
                      </p>
                      <Tooltip>
                      <TooltipTrigger render={<div
                        tabIndex={0}
                        aria-label={`${dayLabel(day.date)}: ${attendanceLabel[day.status]}`}
                        className={`flex min-h-12 items-center justify-center break-words rounded border-2 border-border px-0.5 text-[9px] font-semibold sm:px-1 sm:text-xs ${day.status === "present" ? "bg-primary text-primary-foreground" : day.status === "late" ? "bg-accent text-accent-foreground" : day.status === "absent" ? "bg-destructive text-destructive-foreground" : day.status === "excused" ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"}`}
                      >
                        {attendanceLabel[day.status]}
                      </div>} />
                      <TooltipContent>{dayLabel(day.date)}: {attendanceLabel[day.status]}</TooltipContent>
                      </Tooltip>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Monday–Friday · Present, late, and excused count as attended
                </p>
              </>
            )}
          </MetricCard>
          <MetricCard
            title="Strengths & Focus Areas"
            className="sm:col-span-2 xl:col-span-8"
          >
            {todoState ||
              (overview.subjects.length === 0 ? (
                <Empty>No released subject scores yet.</Empty>
              ) : (
                <>
                  <p className="mb-4 text-xs text-muted-foreground">
                    Based on released graded classwork by subject
                  </p>
                  <div className="grid gap-5 sm:grid-cols-2">
                    {[
                      {
                        label: "Strongest subjects",
                        entries: overview.subjects.slice(0, 3),
                      },
                      {
                        label: "Focus areas",
                        entries: [...overview.subjects].reverse().slice(0, 3),
                      },
                    ].map((group) => (
                      <div key={group.label}>
                        <h4 className="mb-2 text-sm font-semibold">
                          {group.label}
                        </h4>
                        <div className="space-y-2">
                          {group.entries.map((item) => (
                            <div
                              key={item.name}
                              className="grid grid-cols-[minmax(0,1fr)_3rem] gap-x-2 gap-y-1 text-xs"
                            >
                              <Tooltip>
                                <TooltipTrigger render={<span tabIndex={0} className="truncate">{item.name}</span>} />
                                <TooltipContent>{item.name}</TooltipContent>
                              </Tooltip>
                              <span className="text-right font-semibold">
                                {item.score}%
                              </span>
                              <Progress
                                value={item.score}
                                className="col-span-2 h-3"
                                aria-label={`${item.name}: ${item.score}%`}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ))}
          </MetricCard>
          <section
            className="min-w-0 sm:col-span-2 xl:col-span-12"
            aria-labelledby="studyboard-subjects-title"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="studyboard-subjects-title" className="text-xl font-bold">
                Enrolled Subjects
              </h2>
              <Button
                variant="outline"
                size="header"
                onClick={() => navigate(routes.student.subjects)}
              >
                View all subjects
              </Button>
            </div>
            {todoState ||
              (subjects.length === 0 ? (
                <Empty>No enrolled subjects for this period.</Empty>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {subjects.slice(0, 4).map((subject) => {
                    const work = todos.filter(
                      (item) => item.subject_id === subject.subject_id,
                    );
                    const completed = work.filter(
                      (item) =>
                        item.is_submitted || item.status === "completed",
                    ).length;
                    return (
                      <SubjectCard
                        key={subject.subject_load_id}
                        title={subject.subject_name}
                        teacher={subject.teacher_name}
                        teacherAvatar={subject.teacher_avatar || undefined}
                        subjectCode={subject.subject_codename || undefined}
                        pendingCount={work.length - completed}
                        completionRate={
                          work.length
                            ? Math.round((completed / work.length) * 100)
                            : 0
                        }
                        onClick={() =>
                          navigate(
                            routes.student.subjectDetail
                              .replace(":classId", String(subject.class_id))
                              .replace(
                                ":subjectId",
                                String(subject.subject_id),
                              ),
                          )
                        }
                      />
                    );
                  })}
                </div>
              ))}
          </section>
        </main>
      </div>
    </AppLayout>
  );
}
