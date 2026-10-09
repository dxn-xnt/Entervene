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
import {
  ArrowUpRight,
  BookOpen,
  Calendar,
  Check,
  CheckSquare,
  ClipboardList,
  FileText,
  Zap,
} from "lucide-react";
import AppLayout from "@/layouts/app-layout";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Badge } from "@/components/retroui/Badge";
import { Progress } from "@/components/retroui/Progress";
import { LoadingPanel } from "@/components/loading-panel";
import { EmptyStateCard } from "@/components/empty-state-card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { GradeOverviewCards } from "@/components/student/grade-overview-cards";
import { SubjectCard } from "@/components/subject-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
import { routes } from "@/../routes";
import {
  getMyStudyboardMetrics,
  type StudentStudyboardMetrics,
  type TodoItem,
} from "@/lib/api";
import { useStudentOverviewData } from "@/hooks/use-student-overview-data";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";

const INITIAL_SUBJECTS_LIMIT = 4;
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

const StoryBoard = () => {
  const navigate = useNavigate();
  const { subjects, todos, urgentTodos, isLoading, error } =
    useStudentOverviewData();
  const { selectedPeriodId } = useAcademicPeriod();
  const [metrics, setMetrics] = useState<StudentStudyboardMetrics | null>(null);
  const [isSubjectsExpanded, setIsSubjectsExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    getMyStudyboardMetrics(selectedPeriodId)
      .then((value) => {
        if (active) setMetrics(value);
      })
      .catch((cause: unknown) => {
        console.error("Failed to load studyboard metrics", cause);
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
    const overviewSubjects = [...bySubject.values()]
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
      subjects: overviewSubjects,
      deadlines,
    };
  }, [todos]);

  const readingTotal =
    metrics?.daily_reading_seconds.reduce((sum, value) => sum + value, 0) || 0;
  const readingDays = (metrics?.daily_reading_seconds || [0, 0, 0, 0, 0, 0, 0]).map(
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

  const displayedSubjects = isSubjectsExpanded
    ? subjects
    : subjects.slice(0, INITIAL_SUBJECTS_LIMIT);
  const remainingSubjectsCount = subjects.length - INITIAL_SUBJECTS_LIMIT;

  const handleSubjectClick = (subject: {
    class_id: number;
    subject_id: number;
  }) => {
    navigate(
      routes.student.subjectDetail
        .replace(":classId", String(subject.class_id))
        .replace(":subjectId", String(subject.subject_id)),
    );
  };

  const getSubjectStats = (subjectId: number) => {
    const subjectTodos = todos.filter((t) => t.subject_id === subjectId);
    const pendingTodos = subjectTodos.filter(
      (t) => !t.is_submitted && t.status !== "completed",
    );
    const completedTodos = subjectTodos.filter(
      (t) => t.is_submitted || t.status === "completed" || t.grade !== null,
    );
    const completionRate =
      subjectTodos.length > 0
        ? Math.round((completedTodos.length / subjectTodos.length) * 100)
        : 0;
    const latestPending =
      pendingTodos.find((t) => t.deadline && t.deadline !== "No deadline") ||
      pendingTodos[0];

    return {
      pendingCount: pendingTodos.length,
      completionRate,
      latestActivityTitle: latestPending?.title,
      latestActivityDue: latestPending?.deadline
        ? `Due ${latestPending.deadline}`
        : undefined,
    };
  };

  const getClassworkIcon = (type?: string | null, category?: string | null) => {
    const normalized = (type || category || "").toUpperCase();
    switch (normalized) {
      case "READING":
      case "READINGS":
        return BookOpen;
      case "ACTIVITY":
      case "ACTIVITIES":
        return CheckSquare;
      case "QUIZ":
      case "QUIZZES":
        return ClipboardList;
      case "ASSIGNMENT":
      case "ASSIGNMENTS":
      default:
        return FileText;
    }
  };

  const openTodo = async (item: TodoItem) => {
    let targetClassId = item.class_id;

    if (!targetClassId && item.subject_id) {
      const subject = subjects.find(
        (candidate) => candidate.subject_id === item.subject_id,
      );
      if (subject) targetClassId = subject.class_id;
    }

    if (targetClassId && item.subject_id) {
      navigate(
        `/student/subjects/${targetClassId}/${item.subject_id}?tab=classwork&classworkAssignmentId=${item.assignment_id}`,
      );
    } else {
      navigate(routes.student.todo);
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-clip">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center justify-between gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <h1 className="whitespace-nowrap text-xl font-bold tracking-tight sm:text-2xl md:text-4xl">
                  Study Board
                </h1>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  size="header"
                  onClick={() => navigate(routes.student.profile)}
                  className="whitespace-nowrap"
                  aria-label="View my schedule"
                >
                  <Calendar className="size-4" />
                  <span className="sm:hidden">Schedule</span>
                  <span className="hidden sm:inline">View My Schedule</span>
                </Button>
              </div>
            </header>

            <div className="-mt-[1px] flex flex-1 flex-col gap-4 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                {/* Left 2 Columns: Main Section */}
                <div className="flex w-full min-w-0 flex-col gap-4 xl:col-span-2">
                  <GradeOverviewCards
                    todos={todos}
                    isLoading={isLoading}
                    error={error}
                  />

                  {/* Enrolled Subjects Container */}
                  <Card className="flex w-full min-w-0 flex-col gap-3">
                    {isLoading ? (
                      <LoadingPanel label="Loading subjects..." />
                    ) : error ? (
                      <EmptyStateCard
                        title="Unable to load subjects"
                        description={error}
                        className="border-none bg-card shadow-none hover:shadow-none"
                      />
                    ) : subjects.length === 0 ? (
                      <EmptyStateCard
                        title="No enrolled subjects found"
                        description="You are not enrolled in any subjects for this period."
                        className="border-none bg-white shadow-none hover:shadow-none"
                      />
                    ) : (
                      <>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {displayedSubjects.map((subject) => {
                            const stats = getSubjectStats(subject.subject_id);
                            return (
                              <SubjectCard
                                key={subject.subject_load_id}
                                title={subject.subject_name}
                                pendingCount={stats.pendingCount}
                                completionRate={stats.completionRate}
                                latestActivityTitle={stats.latestActivityTitle}
                                latestActivityDue={stats.latestActivityDue}
                                onClick={() => handleSubjectClick(subject)}
                              />
                            );
                          })}
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <div>
                            {subjects.length > INITIAL_SUBJECTS_LIMIT && (
                              <Button
                                variant="default"
                                size="sm"
                                autoIcon={false}
                                onClick={() =>
                                  setIsSubjectsExpanded((prev) => !prev)
                                }
                                className="border-2 border-border shadow-none text-xs font-bold px-3 py-1.5 h-auto rounded bg-primary text-black hover:bg-primary/90"
                              >
                                {isSubjectsExpanded
                                  ? "Show less"
                                  : `Show ${remainingSubjectsCount} more`}
                              </Button>
                            )}
                          </div>
                          <Button
                            variant="link"
                            className="p-0 text-sm text-foreground inline-flex items-center gap-1 font-semibold hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(routes.student.subjects);
                            }}
                            title="View all subjects"
                          >
                            <span>View all subjects</span>
                            <ArrowUpRight className="size-4" />
                          </Button>
                        </div>
                      </>
                    )}
                  </Card>

                  {/* Additional Metric Cards displayed below subjects container */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-12">
                    <MetricCard title="Average Score" className="sm:col-span-1 xl:col-span-6">
                      <p className="text-4xl font-black">{overview.average ?? 0}%</p>
                      <Progress
                        value={overview.average ?? 0}
                        className="mt-4"
                        aria-label={`Average score ${overview.average ?? 0}%`}
                      />
                      <p className="mt-2 text-xs text-muted-foreground">
                        Across {overview.gradedCount} graded activities
                      </p>
                    </MetricCard>

                    <MetricCard title="Assignment Status" className="sm:col-span-1 xl:col-span-6">
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
                    </MetricCard>

                    <MetricCard
                      title="Study Time This Week"
                      className="sm:col-span-2 xl:col-span-12"
                    >
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
                    </MetricCard>

                    <MetricCard
                      title="Grade Trend"
                      className="sm:col-span-2 xl:col-span-7"
                    >
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
                    </MetricCard>

                    <MetricCard
                      title="Time per Subject"
                      className="sm:col-span-2 xl:col-span-5"
                    >
                      <p className="mb-3 text-xs text-muted-foreground">
                        Cumulative reading time on work recorded this week
                      </p>
                      <div className="space-y-3">
                        {(metrics?.subject_reading_seconds || []).length === 0 ? (
                          <p className="text-xs text-muted-foreground">No reading time recorded yet</p>
                        ) : (
                          metrics!.subject_reading_seconds.map((item) => (
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
                                      1,
                                      ...metrics!.subject_reading_seconds.map(
                                        (subject) => subject.seconds,
                                      ),
                                    )) *
                                  100
                                }
                                className="col-span-2 h-3"
                                aria-label={`${item.subject}: ${duration(item.seconds)}`}
                              />
                            </div>
                          ))
                        )}
                      </div>
                    </MetricCard>

                    <MetricCard title="On-Time Submissions" className="sm:col-span-1 xl:col-span-6">
                      <div className="flex items-center gap-4">
                        <Progress
                          value={
                            onTimeTotal > 0
                              ? Math.round(
                                  ((metrics?.on_time_count || 0) / onTimeTotal) * 100,
                                )
                              : 0
                          }
                          variant="circular"
                          className="size-24"
                          aria-label={`${metrics?.on_time_count || 0} of ${onTimeTotal} on time`}
                        />
                        <div className="text-sm">
                          <p className="font-semibold">
                            {metrics?.on_time_count || 0} of {onTimeTotal} on time
                          </p>
                          <p className="text-muted-foreground">
                            {metrics?.late_submission_count || 0} late
                          </p>
                        </div>
                      </div>
                    </MetricCard>

                    <MetricCard title="Quiz Accuracy" className="sm:col-span-1 xl:col-span-6">
                      <p className="text-4xl font-black">
                        {quizCount > 0
                          ? Math.round(((metrics?.quiz_correct || 0) / quizCount) * 100)
                          : 0}
                        %
                      </p>
                      <Progress
                        value={
                          quizCount > 0
                            ? ((metrics?.quiz_correct || 0) / quizCount) * 100
                            : 0
                        }
                        className="mt-4"
                        aria-label={`${metrics?.quiz_correct || 0} correct out of ${quizCount} graded quiz answers`}
                      />
                      <p className="mt-2 text-xs text-muted-foreground">
                        {metrics?.quiz_correct || 0} correct · {metrics?.quiz_wrong || 0} incorrect
                      </p>
                    </MetricCard>

                    <MetricCard
                      title="Attendance"
                      className="sm:col-span-2 xl:col-span-12"
                    >
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
                    </MetricCard>

                    <MetricCard
                      title="Strengths & Focus Areas"
                      className="sm:col-span-2 xl:col-span-12"
                    >
                      {overview.subjects.length === 0 ? (
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
                      )}
                    </MetricCard>
                  </div>
                </div>

                {/* Right column: Week Streak + To do Card */}
                <div className="flex w-full min-w-0 flex-col gap-4 xl:col-span-1">
                  <Card className="block w-full border-border bg-white shadow-md hover:shadow-none">
                    <Card.Content className="">
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-row gap-2 items-center">
                          <Zap
                            size={20}
                            className="fill-primary text-foreground"
                          />
                          <Text as="p" className="text-md font-semibold">
                            1 week streak
                          </Text>
                        </div>

                        <Text as="p" className="text-sm font-normal">
                          1-day streak — keep going, build the habit!
                        </Text>
                      </div>
                      <div className="mt-2 w-full">
                        <div className="grid w-full grid-cols-7 gap-1.5 sm:gap-2">
                          <Badge
                            size="md"
                            variant="secondary"
                            className="flex min-w-0 items-center justify-center px-1 sm:px-2.5"
                          >
                            <Check size={17} className="mt-0.5" />
                          </Badge>
                          <Badge
                            size="md"
                            variant="default"
                            className="min-w-0 px-1 text-center sm:px-2.5 justify-center"
                          >
                            Tu
                          </Badge>
                          <Badge
                            size="md"
                            variant="default"
                            className="min-w-0 px-1 text-center sm:px-2.5 justify-center"
                          >
                            We
                          </Badge>
                          <Badge
                            size="md"
                            variant="secondary"
                            className="min-w-0 px-1 text-center sm:px-2.5 justify-center"
                          >
                            Th
                          </Badge>
                          <Badge
                            size="md"
                            variant="outline"
                            className="min-w-0 px-1 text-center sm:px-2.5 justify-center"
                          >
                            Fr
                          </Badge>
                          <Badge
                            size="md"
                            variant="outline"
                            className="min-w-0 px-1 text-center sm:px-2.5 justify-center"
                          >
                            Sa
                          </Badge>
                          <Badge
                            size="md"
                            variant="outline"
                            className="min-w-0 px-1 text-center sm:px-2.5 justify-center"
                          >
                            Su
                          </Badge>
                        </div>
                      </div>
                    </Card.Content>
                  </Card>

                  <Card className="block w-full border-border bg-white shadow-md hover:shadow-none">
                    <Card.Content>
                      <div className="flex items-center justify-between mb-4">
                        <Card.Title className="mb-0 text-2xl md:text-3xl">
                          To do
                        </Card.Title>

                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => navigate(routes.student.todo)}
                          className="shadow-none px-1"
                          aria-label="View all to-do items"
                        >
                          <ArrowUpRight size={18} />
                        </Button>
                      </div>

                      {isLoading ? (
                        <LoadingPanel label="Loading to-do items..." />
                      ) : error ? (
                        <EmptyStateCard
                          title="Unable to load to-do items"
                          description={error}
                          className="border-none bg-card shadow-none hover:shadow-none"
                        />
                      ) : urgentTodos.length === 0 ? (
                        <EmptyStateCard
                          title="All caught up!"
                          description="No pending tasks"
                          className="border-none bg-white shadow-none hover:shadow-none"
                        />
                      ) : (
                        <div className="flex flex-col gap-2.5">
                          {urgentTodos.map((item) => {
                            const IconComponent = getClassworkIcon(
                              item.type,
                              item.category,
                            );
                            return (
                              <Card
                                key={item.assignment_id}
                                onClick={() => openTodo(item)}
                                onKeyDown={(event) => {
                                  if (
                                    event.key === "Enter" ||
                                    event.key === " "
                                  ) {
                                    event.preventDefault();
                                    openTodo(item);
                                  }
                                }}
                                role="button"
                                tabIndex={0}
                                className="flex w-full cursor-pointer shadow-none items-center gap-3 border-border bg-background p-3 hover:-translate-y-1 hover:bg-accent! hover:text-foreground!"
                              >
                                <IconComponent
                                  size={20}
                                  className="shrink-0 text-black/70"
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-semibold text-sm">
                                    {item.title}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {item.subject} · {item.deadline}
                                  </p>
                                </div>
                                {item.status === "pastdue" && (
                                  <Badge
                                    variant="solid"
                                    size="sm"
                                    className="shrink-0 rounded bg-destructive px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-700"
                                  >
                                    Past Due
                                  </Badge>
                                )}
                              </Card>
                            );
                          })}
                        </div>
                      )}
                    </Card.Content>
                  </Card>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default StoryBoard;
