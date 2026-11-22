import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Settings, AlertCircle, ArrowUpRight, School, TrendingUp, CalendarClock, CheckCircle2, Award, Briefcase, Users } from "lucide-react";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Alert } from "@/components/retroui/Alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { Progress } from "@/components/retroui/Progress";
import { OverviewCard } from "@/components/overview-cards";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { routes } from "@/../routes";
import { getOverviewStats, type OverviewCardData } from "@/lib/api";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";
import { EmptyStateCard } from "@/pages/admin/subjects/components/empty-state-card";

type EnrollmentTrendItem = {
  week: string;
  count: number;
  active?: number;
  start_date?: string;
  end_date?: string;
};
type GradeMetricItem = { grade: string; rate: number };
type StudentsPerGradeItem = { grade: string; count: number };
type ActiveUserItem = {
  day: string;
  date?: string;
  count: number;
  students?: number;
  teachers?: number;
  isDrop?: boolean;
};
type TeacherWorkloadItem = {
  staff_id?: string;
  user_id?: string | null;
  name: string;
  subject: string;
  classes: string;
  classes_count?: number;
  loads_count?: number;
  students: number;
};
type AttentionClassItem = {
  class_id?: number;
  name: string;
  issue: string;
  status: string;
  variant?: string;
};
type TeacherNoWorkItem = {
  staff_id?: string;
  user_id?: string | null;
  name: string;
  subject: string;
  classes_count?: number;
  status: string;
};
type TopSubjectItem = {
  subject_id?: number;
  grade?: string | null;
  name: string;
  metric: string;
  score?: number;
  rank: string;
};
type GradeHealthApiItem = {
  academic_level_id: number;
  grade: string;
  category: string;
  students: number;
  active_classes: number;
  attendance_rate: number | null;
  attendance_record_count: number;
  completion_rate: number | null;
  expected_submission_count: number;
  passing_rate: number | null;
  available_grade_count: number;
};
type GradeHealthItem = {
  academicLevelId: number;
  grade: string;
  category: string;
  students: number;
  classes: number;
  attendance: number | null;
  attendanceRecordCount: number;
  completion: number | null;
  expectedSubmissionCount: number;
  passingRate: number | null;
  availableGradeCount: number;
};
type AdminDashboardDetails = {
  period_state?: "CURRENT" | "FUTURE" | "HISTORICAL";
  enrollment_trend_scope?: "academic_year" | "period";
  enrollment_trend?: EnrollmentTrendItem[];
  students_per_grade?: StudentsPerGradeItem[];
  attendance_by_grade?: GradeMetricItem[];
  completion_by_grade?: GradeMetricItem[];
  active_users_weekly?: ActiveUserItem[];
  teacher_workload?: TeacherWorkloadItem[];
  classes_needing_attention?: AttentionClassItem[];
  teachers_no_work?: TeacherNoWorkItem[];
  top_performing_subjects?: TopSubjectItem[];
  grade_health?: GradeHealthApiItem[];
};
type AdminTermInfo = {
  period_id?: number | null;
  period_name?: string;
  academic_year?: string;
  academic_year_id?: number | null;
  is_active?: boolean;
};

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { selectedPeriodId, selectedPeriod, selectedYearId, selectedYear } = useAcademicPeriod();
  const [cards, setCards] = useState<OverviewCardData[]>([]);
  const [details, setDetails] = useState<AdminDashboardDetails | null>(null);
  const [termInfo, setTermInfo] = useState<AdminTermInfo | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllGradeHealth, setShowAllGradeHealth] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      setIsLoading(true);
      setError(null);
      setCards([]);
      setDetails(null);
      setTermInfo(null);
      try {
        const data = await getOverviewStats({
          scope: "system",
          academic_period_id: selectedPeriodId ?? undefined,
          academic_year_id: selectedYearId ?? undefined,
        });
        if (!cancelled) {
          if (data.cards && data.cards.length > 0) {
            setCards(data.cards.slice(0, 8));
          }
          if (data.details) {
            setDetails(data.details as AdminDashboardDetails);
          }
          if (data.term_info) {
            setTermInfo(data.term_info as AdminTermInfo);
          }
        }
      } catch (err: unknown) {
        if (!cancelled) {
          console.error("Failed to load admin overview metrics:", err);
          setError(
            err instanceof Error ? err.message : "Failed to load overview metrics",
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchStats();
    return () => {
      cancelled = true;
    };
  }, [selectedPeriodId, selectedYearId]);

  const isUpcomingPeriod = details?.period_state === "FUTURE";
  const activeYearLabel = termInfo?.academic_year || selectedYear?.year_label || "";
  const activePeriodName = termInfo?.period_name || selectedPeriod?.period || "selected term";

  const enrollmentTrend = useMemo(() => {
    if (!Array.isArray(details?.enrollment_trend)) return [];
    return details.enrollment_trend.map((item) => ({
      week: item.week,
      count: Number(item.count ?? 0),
      active: Number(item.active ?? 0),
      start_date: item.start_date,
      end_date: item.end_date,
    }));
  }, [details]);

  const maxEnrollmentTrendCount = useMemo(() => {
    const peak = Math.max(
      0,
      ...enrollmentTrend.flatMap((point) => [point.count, point.active]),
    );
    if (peak <= 0) return 10;
    const step = peak <= 20 ? 5 : peak <= 100 ? 10 : 25;
    return Math.ceil((peak + 1) / step) * step;
  }, [enrollmentTrend]);

  const studentsPerGrade = details?.students_per_grade ?? [];
  const attendanceByGrade = details?.attendance_by_grade ?? [];
  const completionByGrade = details?.completion_by_grade ?? [];
  const activeUsers = details?.active_users_weekly ?? [];
  const teacherWorkload = details?.teacher_workload ?? [];
  const classesAttention = details?.classes_needing_attention ?? [];
  const teachersNoWork = details?.teachers_no_work ?? [];
  const topSubjects = details?.top_performing_subjects ?? [];

  const maxActiveUsersCount = Math.max(
    ...activeUsers.map((s) => s.count),
    1,
  );
  const maxStudentsGradeCount = Math.max(
    ...studentsPerGrade.map((s) => s.count),
    1,
  );

  // Grade level health matrix (analogous to section-by-section health)
  const gradeHealthData = useMemo(() => {
    if (!Array.isArray(details?.grade_health)) return [];
    return details.grade_health.map((item): GradeHealthItem => ({
      academicLevelId: item.academic_level_id,
      grade: item.grade,
      category: item.category,
      students: item.students,
      attendance: item.attendance_rate,
      attendanceRecordCount: item.attendance_record_count,
      completion: item.completion_rate,
      expectedSubmissionCount: item.expected_submission_count,
      passingRate: item.passing_rate,
      availableGradeCount: item.available_grade_count,
      classes: item.active_classes,
    }));
  }, [details]);

  const displayedGrades = showAllGradeHealth ? gradeHealthData : gradeHealthData.slice(0, 2);

  return (
    <AppLayout>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            {/* Header */}
            <header className="flex items-center justify-between gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <div>
                  <h1 className="text-xl font-bold sm:text-2xl md:text-4xl">
                    Dashboard
                  </h1>
                </div>
              </div>
              <Button
                size="header"
                onClick={() => navigate(routes.admin.settings)}
                className="shrink-0 whitespace-nowrap"
              >
                <Settings className="size-4" />
                <span className="sm:hidden">Settings</span>
                <span className="hidden sm:inline">System Settings</span>
              </Button>
            </header>

            <main className="-mt-[1px] flex min-w-0 flex-col gap-4 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:gap-6 md:px-6">
              {error && (
                <Alert status="error" className="flex items-center gap-2">
                  <AlertCircle className="size-4 shrink-0" />
                  <Alert.Description className="text-sm font-semibold text-destructive">
                    {error}
                  </Alert.Description>
                </Alert>
              )}

              {/* 2-Column Responsive Layout: Left/Center Main Analytics & Right Overview Cards */}
              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12 md:gap-4">
                {/* Left to Center Column: Main Statistical Cards & Charts */}
                <div className="flex min-w-0 flex-col gap-3 lg:col-span-9 xl:col-span-9 md:gap-4">
                  {/* 1. Classes Needing Attention & Teachers with No Published Work */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/* Classes needing attention */}
                    <Card className="flex flex-col justify-between p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <Card.Title className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                            Classes Needing Attention
                          </Card.Title>
                          {isUpcomingPeriod && (
                            <Badge variant="surface" size="sm">Upcoming</Badge>
                          )}
                        </div>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="secondary"
                                size="sm"
                                autoIcon={false}
                                onClick={() => navigate(routes.admin.classes)}
                                className="text-foreground shadow-none px-1.5 shrink-0"
                              >
                                <ArrowUpRight className="size-4" />
                              </Button>
                            }
                          />
                          <TooltipContent side="right">View all classes</TooltipContent>
                        </Tooltip>
                      </Card.Header>

                      <Card.Content className="mt-3 flex flex-col gap-2.5 p-0 flex-1 justify-start">
                        {isLoading ? (
                          <div className="flex flex-col gap-2.5">
                            {Array.from({ length: 3 }).map((_, idx) => (
                              <div key={idx} className="h-12 w-full animate-pulse rounded bg-muted/40" />
                            ))}
                          </div>
                        ) : classesAttention.length === 0 ? (
                          <EmptyStateCard
                            compact
                            icon={
                              isUpcomingPeriod ? (
                                <CalendarClock className="text-primary-foreground" />
                              ) : (
                                <CheckCircle2 className="text-primary-foreground" />
                              )
                            }
                            title={isUpcomingPeriod ? `Upcoming · ${activePeriodName}` : "All classes on track"}
                            description={
                              isUpcomingPeriod
                                ? `Class attention alerts for ${activePeriodName} will appear once the term starts.`
                                : `No classes currently show low passing, completion, attendance, or grading backlogs for ${activePeriodName}.`
                            }
                          />
                        ) : (
                          classesAttention.map((c, idx: number) => {
                            const isDestructive = c.variant === "destructive" || c.status === "Low";
                            return (
                              <Card
                                key={c.class_id ?? idx}
                                onClick={() =>
                                  navigate(
                                    c.class_id != null
                                      ? `/admin/classes/${c.class_id}`
                                      : routes.admin.classes,
                                  )
                                }
                                className="flex cursor-pointer items-center justify-between shadow-none rounded px-3 py-2.5 text-xs sm:text-sm hover:bg-retro hover:-translate-y-1 transition-all"
                              >
                                <div className="flex flex-col min-w-0 pr-2">
                                  <span className="font-semibold text-foreground truncate">
                                    {c.name}
                                  </span>
                                  <span className="text-xs text-muted-foreground truncate">
                                    {c.issue}
                                  </span>
                                </div>
                                <Badge
                                  size="sm"
                                  variant={isDestructive ? "destructive" : "surface"}
                                  className="shrink-0"
                                >
                                  {c.status}
                                </Badge>
                              </Card>
                            );
                          })
                        )}
                      </Card.Content>
                    </Card>

                    {/* Teachers with No Published Work */}
                    <Card className="flex flex-col justify-between p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <Card.Title className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                            Teachers with No Work
                          </Card.Title>
                          {isUpcomingPeriod && (
                            <Badge variant="surface" size="sm">Upcoming</Badge>
                          )}
                        </div>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="secondary"
                                size="sm"
                                autoIcon={false}
                                onClick={() => navigate(routes.admin.users)}
                                className="text-foreground shadow-none px-1.5 shrink-0"
                              >
                                <ArrowUpRight className="size-4" />
                              </Button>
                            }
                          />
                          <TooltipContent side="right">View teacher accounts</TooltipContent>
                        </Tooltip>
                      </Card.Header>

                      <Card.Content className="mt-3 flex flex-col gap-2.5 p-0 flex-1 justify-start">
                        {isLoading ? (
                          <div className="flex flex-col gap-2.5">
                            {Array.from({ length: 3 }).map((_, idx) => (
                              <div key={idx} className="h-12 w-full animate-pulse rounded bg-muted/40" />
                            ))}
                          </div>
                        ) : teachersNoWork.length === 0 ? (
                          <EmptyStateCard
                            compact
                            icon={
                              isUpcomingPeriod ? (
                                <CalendarClock className="text-primary-foreground" />
                              ) : (
                                <CheckCircle2 className="text-primary-foreground" />
                              )
                            }
                            title={
                              isUpcomingPeriod
                                ? `Upcoming · ${activePeriodName}`
                                : "All assigned teachers have work"
                            }
                            description={
                              isUpcomingPeriod
                                ? `Published task checks for ${activePeriodName} will appear once the term starts.`
                                : `Every teacher with active loads in ${activePeriodName} has published classwork, or no loads are assigned yet.`
                            }
                          />
                        ) : (
                          teachersNoWork.map((t, idx: number) => (
                            <Card
                              key={t.staff_id ?? idx}
                              onClick={() =>
                                navigate(
                                  t.user_id
                                    ? `/admin/users/teacher/${t.user_id}`
                                    : routes.admin.users,
                                )
                              }
                              className="flex cursor-pointer items-center justify-between shadow-none rounded px-3 py-2.5 text-xs sm:text-sm transition-all hover:-translate-y-0.5 hover:bg-retro"
                            >
                              <div className="flex flex-col min-w-0 pr-2">
                                <span className="font-semibold text-foreground truncate">
                                  {t.name}
                                </span>
                                <span className="text-[11px] text-muted-foreground truncate">
                                  {t.subject}
                                </span>
                              </div>
                              <Badge
                                size="sm"
                                variant="destructive"
                                className="shrink-0"
                              >
                                {t.status}
                              </Badge>
                            </Card>
                          ))
                        )}
                      </Card.Content>
                    </Card>
                  </div>

                  {/* 2. School Enrollment & Active Engagement Trend Chart */}
                  <Card className="flex flex-col justify-between p-4 sm:p-5">
                    <Card.Header className="p-0">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Card.Title className="text-base font-bold sm:text-lg">
                            School Enrollment & Engagement Trend
                          </Card.Title>
                          {activeYearLabel && (
                            <Badge variant="surface" size="sm">
                              {activeYearLabel} · School Year
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Chart Legend */}
                      <div className="flex flex-wrap items-center gap-4 mb-1 text-xs text-muted-foreground font-medium">
                        <div className="flex items-center gap-1.5">
                          <span className="size-2.5 rounded-full bg-primary inline-block" />
                          <span className="text-foreground">
                            Enrolled Students
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="size-2.5 rounded-full bg-muted-foreground inline-block" />
                          <span className="text-foreground">
                            Active Learners
                          </span>
                        </div>
                      </div>
                    </Card.Header>

                    {/* Line Chart Body */}
                    <Card.Content className="w-full p-0 pb-2">
                      {isLoading ? (
                        <div className="h-52 w-full animate-pulse rounded bg-muted/40" />
                      ) : enrollmentTrend.length === 0 ? (
                        <EmptyStateCard
                          compact
                          icon={<TrendingUp className="text-primary-foreground" />}
                          title="No weekly trend yet"
                          description={
                            activeYearLabel
                              ? `Enrollment and learner participation trends for ${activeYearLabel} will appear once the school year begins.`
                              : "Enrollment and learner participation trends will appear once the selected academic year begins."
                          }
                          className="my-2"
                        />
                      ) : (
                        <div className="h-52 w-full">
                          <ResponsiveContainer width="100%" height="100%" className="-mx-2 text-foreground!">
                            <LineChart
                              data={enrollmentTrend}
                              margin={{ top: 10, right: 15, left: -20, bottom: 0 }}
                            >
                              <CartesianGrid
                                strokeDasharray="3 3"
                                vertical={false}
                                stroke="var(--muted-foreground)"
                                strokeOpacity={0.4}
                              />
                              <XAxis
                                dataKey="week"
                                tickLine={false}
                                axisLine={{
                                  stroke: "var(--foreground)",
                                  strokeWidth: 1,
                                }}
                                tick={{ fontSize: 11, fontWeight: 500, fill: "var(--foreground)" }}
                              />
                              <YAxis
                                domain={[0, maxEnrollmentTrendCount]}
                                allowDecimals={false}
                                tickLine={false}
                                axisLine={{
                                  stroke: "var(--foreground)",
                                  strokeWidth: 1,
                                }}
                                tick={{ fontSize: 11, fill: "var(--foreground)" }}
                              />
                              <RechartsTooltip
                                content={({ active, payload }) => {
                                  if (!active || !payload || !payload.length)
                                    return null;
                                  const point = payload[0].payload as {
                                    week: string;
                                    count: number;
                                    active: number;
                                    start_date?: string;
                                    end_date?: string;
                                  };
                                  return (
                                    <div className="space-y-1 rounded border border-border bg-background p-2.5 text-xs text-foreground shadow-md">
                                      <p className="font-bold">
                                        {point.week}
                                        {point.start_date && point.end_date
                                          ? ` (${point.start_date} – ${point.end_date})`
                                          : ""}
                                      </p>
                                      <p className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                        Enrolled: {point.count} {point.count === 1 ? "student" : "students"}
                                      </p>
                                      <p className="text-amber-600 dark:text-amber-400 font-semibold">
                                        Active: {point.active} {point.active === 1 ? "learner" : "learners"}
                                      </p>
                                    </div>
                                  );
                                }}
                              />
                              <Line
                                type="monotone"
                                dataKey="count"
                                name="Enrolled"
                                stroke="var(--primary)"
                                strokeWidth={2.5}
                                dot={{
                                  r: 4,
                                  stroke: "var(--background)",
                                  strokeWidth: 1.5,
                                  fill: "var(--primary)",
                                }}
                                activeDot={{ r: 6 }}
                              />
                              <Line
                                type="monotone"
                                dataKey="active"
                                name="Active"
                                stroke="var(--muted-foreground)"
                                strokeWidth={2.5}
                                dot={{
                                  r: 4,
                                  stroke: "var(--background)",
                                  strokeWidth: 1.5,
                                  fill: "var(--muted-foreground)",
                                }}
                                activeDot={{ r: 6 }}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                      <Card.Description className="text-xs text-muted-foreground mt-2">
                        Total enrolled students vs. actively participating learners across weeks
                        {activeYearLabel ? ` (${activeYearLabel} to date)` : ""}
                      </Card.Description>
                    </Card.Content>
                  </Card>

                  {/* 3. Attendance by Grade & Completion by Grade */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/* Attendance by grade */}
                    <Card className="flex flex-col justify-between p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <Card.Title className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                            Attendance by Grade
                          </Card.Title>
                          {isUpcomingPeriod && (
                            <Badge variant="surface" size="sm">Upcoming</Badge>
                          )}
                        </div>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="secondary"
                                size="sm"
                                autoIcon={false}
                                onClick={() => navigate(routes.admin.classes)}
                                className="text-foreground shadow-none px-1.5"
                              >
                                <ArrowUpRight className="size-4" />
                              </Button>
                            }
                          />
                          <TooltipContent side="right">View classes</TooltipContent>
                        </Tooltip>
                      </Card.Header>

                      <Card.Content className="mt-3 flex flex-col justify-between gap-2.5 p-0 h-full">
                        {isLoading ? (
                          <div className="h-24 w-full animate-pulse rounded bg-muted/40" />
                        ) : attendanceByGrade.length === 0 ? (
                          <EmptyStateCard
                            compact
                            icon={<CalendarClock className="text-primary-foreground" />}
                            title={isUpcomingPeriod ? `Upcoming · ${activePeriodName}` : "No attendance recorded yet"}
                            description={
                              isUpcomingPeriod
                                ? `Attendance metrics for ${activePeriodName} will appear once the term starts.`
                                : `Attendance rates for ${activePeriodName} will appear once teachers log attendance.`
                            }
                          />
                        ) : (
                          <div className="flex flex-col gap-2.5">
                            {attendanceByGrade.map((item) => (
                              <div
                                key={item.grade}
                                className="flex items-center justify-between gap-3 text-xs sm:text-sm"
                              >
                                <span className="font-medium text-foreground/90 shrink-0 w-24 truncate">
                                  {item.grade}
                                </span>
                                <Progress value={item.rate} className="h-2.5 flex-1" />
                                <span className="font-semibold text-foreground text-right w-10 shrink-0">
                                  {item.rate}%
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        <Card.Description className="mt-2 text-[11px] text-muted-foreground">
                          Average present rate across all grade levels ({activePeriodName})
                        </Card.Description>
                      </Card.Content>
                    </Card>

                    {/* Completion by grade */}
                    <Card className="flex flex-col justify-between p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <Card.Title className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                            Completion by Grade
                          </Card.Title>
                          {isUpcomingPeriod && (
                            <Badge variant="surface" size="sm">Upcoming</Badge>
                          )}
                        </div>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="secondary"
                                size="sm"
                                autoIcon={false}
                                onClick={() => navigate(routes.admin.classes)}
                                className="text-foreground shadow-none px-1.5"
                              >
                                <ArrowUpRight className="size-4" />
                              </Button>
                            }
                          />
                          <TooltipContent side="right">View classes</TooltipContent>
                        </Tooltip>
                      </Card.Header>

                      <Card.Content className="mt-3 flex flex-col justify-between gap-2.5 p-0 h-full">
                        {isLoading ? (
                          <div className="h-24 w-full animate-pulse rounded bg-muted/40" />
                        ) : completionByGrade.length === 0 ? (
                          <EmptyStateCard
                            compact
                            icon={<CalendarClock className="text-primary-foreground" />}
                            title={isUpcomingPeriod ? `Upcoming · ${activePeriodName}` : "No completion data yet"}
                            description={
                              isUpcomingPeriod
                                ? `Classwork completion for ${activePeriodName} will appear once the term starts.`
                                : `Completion rates for ${activePeriodName} will appear once assessments are published.`
                            }
                          />
                        ) : (
                          <div className="flex flex-col gap-2.5">
                            {completionByGrade.map((item) => (
                              <div
                                key={item.grade}
                                className="flex items-center justify-between gap-3 text-xs sm:text-sm"
                              >
                                <span className="font-medium text-foreground/90 shrink-0 w-24 truncate">
                                  {item.grade}
                                </span>
                                <Progress value={item.rate} className="h-2.5 flex-1" />
                                <span className="font-semibold text-foreground text-right w-10 shrink-0">
                                  {item.rate}%
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        <Card.Description className="mt-2 text-[11px] text-muted-foreground">
                          Assigned classwork completion rate ({activePeriodName})
                        </Card.Description>
                      </Card.Content>
                    </Card>
                  </div>

                  {/* 4. Grade-Level Health & Performance (Section-by-Section Health counterpart) */}
                  <Card className="flex flex-col justify-between p-4 sm:p-5">
                    <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <Card.Title className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                          Grade-Level Performance & Health
                        </Card.Title>
                        {isUpcomingPeriod && (
                          <Badge variant="surface" size="sm">Upcoming</Badge>
                        )}
                      </div>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="secondary"
                              size="sm"
                              autoIcon={false}
                              onClick={() => navigate(routes.admin.classes)}
                              className="text-foreground shadow-none px-1.5"
                            >
                              <ArrowUpRight className="size-4" />
                            </Button>
                          }
                        />
                        <TooltipContent side="right">View all grade levels</TooltipContent>
                      </Tooltip>
                    </Card.Header>

                    <Card.Content className="mt-1 flex flex-col gap-3 p-0">
                      {isLoading ? (
                        <Card className="h-44 animate-pulse bg-muted shadow-none" />
                      ) : gradeHealthData.length === 0 ? (
                        <EmptyStateCard
                          compact
                          icon={<School />}
                          title="No grade-level data yet"
                          description="Grade-level health will appear when active classes and enrollments exist for the selected term."
                        />
                      ) : displayedGrades.map((g) => (
                        <Card
                          key={g.academicLevelId}
                          className="shadow-none p-4 text-xs hover:bg-retro hover:-translate-y-1 cursor-pointer transition-all"
                          onClick={() => navigate(routes.admin.classes)}
                        >
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                              <span className="font-bold text-xl text-foreground">
                                {g.grade}
                              </span>
                              <Badge
                                variant="secondary"
                                size="sm"
                                className="px-1.5 py-0.5"
                              >
                                {g.category}
                              </Badge>
                            </div>
                            <span className="font-semibold text-xs text-muted-foreground">
                              {g.students} Students
                            </span>
                          </div>

                          {/* Task completion & attendance progress */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-2.5">
                            <div className="space-y-1">
                              <div className="flex justify-between text-sm">
                                <span className="text-foreground">
                                  Task Completion
                                </span>
                                <span className="font-semibold">
                                  {g.completion == null ? (isUpcomingPeriod ? "Upcoming" : "—") : `${g.completion}%`}
                                </span>
                              </div>
                              <Progress
                                value={g.completion ?? 0}
                                className="h-2"
                              />
                            </div>

                            <div className="space-y-1">
                              <div className="flex justify-between text-sm">
                                <span className="text-foreground">
                                  Attendance
                                </span>
                                <span className="font-semibold">
                                  {g.attendance == null ? (isUpcomingPeriod ? "Upcoming" : "—") : `${g.attendance}%`}
                                </span>
                              </div>
                              <Progress
                                value={g.attendance ?? 0}
                                className="h-2"
                              />
                            </div>
                          </div>

                          {/* Bottom Info Bar */}
                          <div className="flex items-center justify-between text-sm text-muted-foreground pt-2">
                            <div className="flex items-center gap-4">
                              <span className="text-foreground font-semibold">
                                Passing Rate:{" "}
                                <Badge
                                  variant={
                                    g.passingRate == null
                                      ? "surface"
                                      : g.passingRate < 75
                                      ? "destructive"
                                      : g.passingRate > 87
                                        ? "success"
                                        : "surface"
                                  }
                                  size="sm"
                                  className="ml-1"
                                >
                                  {g.passingRate == null ? (isUpcomingPeriod ? "Upcoming" : "—") : `${g.passingRate}%`}
                                </Badge>
                              </span>
                            </div>
                            <span className="text-foreground">
                              <span className="text-foreground font-bold mr-1">
                                {g.classes}
                              </span>
                              active classes
                            </span>
                          </div>
                        </Card>
                      ))}

                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
                        <Card.Description className="text-xs text-muted-foreground">
                          Performance, completion, and attendance across all grade levels
                        </Card.Description>
                        {gradeHealthData.length > 2 && (
                          <Button
                            variant="secondary"
                            size="sm"
                            autoIcon={false}
                            onClick={() => setShowAllGradeHealth((prev) => !prev)}
                            className="self-end sm:self-auto text-xs font-semibold px-2.5 py-1 h-7 text-foreground shadow-none"
                          >
                            {showAllGradeHealth ? "Show less" : "Show all grade levels"}
                          </Button>
                        )}
                      </div>
                    </Card.Content>
                  </Card>

                  {/* 5. Active Users this Week & Top Performing Subjects */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/* Active users this week */}
                    <Card className="flex flex-col justify-between p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Card.Title className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                            Active users this week
                          </Card.Title>
                          {isUpcomingPeriod && (
                            <Badge variant="surface" size="sm">Upcoming</Badge>
                          )}
                        </div>
                        <Card.Description className="mt-0.5 text-xs text-muted-foreground">
                          Daily student and teacher logins
                        </Card.Description>
                      </Card.Header>

                      <Card.Content className="mt-4 flex flex-col justify-between gap-2.5 p-0 flex-1">
                        {isLoading ? (
                          <div className="h-36 w-full animate-pulse rounded bg-muted/40" />
                        ) : activeUsers.length === 0 ? (
                          <EmptyStateCard
                            compact
                            icon={
                              isUpcomingPeriod ? (
                                <CalendarClock className="text-primary-foreground" />
                              ) : (
                                <Users className="text-primary-foreground" />
                              )
                            }
                            title={
                              isUpcomingPeriod
                                ? `Upcoming · ${activePeriodName}`
                                : "No logins recorded this week"
                            }
                            description={
                              isUpcomingPeriod
                                ? `Daily login activity for ${activePeriodName} will appear once the term starts.`
                                : "Daily student and teacher logins will appear here once users sign in."
                            }
                          />
                        ) : (
                          activeUsers.map((item, idx: number) => (
                            <div
                              key={item.date ?? idx}
                              title={
                                item.date
                                  ? `${item.date}: ${item.students ?? 0} students, ${item.teachers ?? 0} teachers`
                                  : undefined
                              }
                              className="flex items-center justify-between gap-3 text-xs sm:text-sm"
                            >
                              <span className="font-medium text-foreground/90 shrink-0 w-10 truncate">
                                {item.day}
                              </span>
                              <Progress
                                value={Math.round(
                                  (item.count / maxActiveUsersCount) * 100,
                                )}
                                className={cn(
                                  "h-3 flex-1",
                                  item.isDrop && "[&>div]:bg-destructive",
                                )}
                              />
                              <span className="font-semibold text-foreground text-right w-8 shrink-0">
                                {item.count}
                              </span>
                            </div>
                          ))
                        )}
                      </Card.Content>
                    </Card>

                    {/* Top performing subjects */}
                    <Card className="flex flex-col justify-between p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <Card.Title className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                            Top Performing Subjects
                          </Card.Title>
                          {isUpcomingPeriod && (
                            <Badge variant="surface" size="sm">Upcoming</Badge>
                          )}
                        </div>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="secondary"
                                size="sm"
                                autoIcon={false}
                                onClick={() => navigate(routes.admin.subjects)}
                                className="text-foreground shadow-none px-1.5 shrink-0"
                              >
                                <ArrowUpRight className="size-4" />
                              </Button>
                            }
                          />
                          <TooltipContent side="right">View all subjects</TooltipContent>
                        </Tooltip>
                      </Card.Header>

                      <Card.Content className="mt-3 flex flex-col gap-2.5 p-0 flex-1 justify-start">
                        {isLoading ? (
                          <div className="flex flex-col gap-2.5">
                            {Array.from({ length: 3 }).map((_, idx) => (
                              <div key={idx} className="h-12 w-full animate-pulse rounded bg-muted/40" />
                            ))}
                          </div>
                        ) : topSubjects.length === 0 ? (
                          <EmptyStateCard
                            compact
                            icon={
                              isUpcomingPeriod ? (
                                <CalendarClock className="text-primary-foreground" />
                              ) : (
                                <Award className="text-primary-foreground" />
                              )
                            }
                            title={
                              isUpcomingPeriod
                                ? `Upcoming · ${activePeriodName}`
                                : "No subject performance yet"
                            }
                            description={
                              isUpcomingPeriod
                                ? `Top performing subjects for ${activePeriodName} will appear once the term starts.`
                                : `Subject rankings for ${activePeriodName} will appear once grades or graded assessments are recorded.`
                            }
                          />
                        ) : (
                          topSubjects.map((s, idx: number) => (
                            <Card
                              key={s.subject_id ?? idx}
                              onClick={() =>
                                navigate(
                                  s.grade && s.subject_id != null
                                    ? `/admin/subjects/${encodeURIComponent(s.grade)}/${s.subject_id}`
                                    : routes.admin.subjects,
                                )
                              }
                              className="flex cursor-pointer items-center justify-between shadow-none rounded px-3 py-2.5 text-xs sm:text-sm hover:bg-retro hover:-translate-y-0.5 transition-all"
                            >
                              <div className="flex flex-col min-w-0 pr-2">
                                <span className="font-semibold text-foreground truncate">
                                  {s.name}
                                </span>
                                <span className="text-[11px] text-muted-foreground truncate">
                                  {s.metric}
                                </span>
                              </div>
                              <Badge size="sm" variant="success" className="shrink-0">
                                {s.rank}
                              </Badge>
                            </Card>
                          ))
                        )}
                      </Card.Content>
                    </Card>

                    {/* Teacher Workload */}
                    <Card className="flex flex-col justify-between p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <Card.Title className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                            Teacher Workload
                          </Card.Title>
                          {isUpcomingPeriod && teacherWorkload.length === 0 && (
                            <Badge variant="surface" size="sm">Upcoming</Badge>
                          )}
                        </div>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="secondary"
                                size="sm"
                                autoIcon={false}
                                onClick={() => navigate(routes.admin.users)}
                                className="text-foreground shadow-none px-1.5 shrink-0"
                              >
                                <ArrowUpRight className="size-4" />
                              </Button>
                            }
                          />
                          <TooltipContent side="right">View teacher workload</TooltipContent>
                        </Tooltip>
                      </Card.Header>

                      <Card.Content className="mt-3 flex flex-col gap-2.5 p-0 flex-1 justify-start">
                        {isLoading ? (
                          <div className="flex flex-col gap-2.5">
                            {Array.from({ length: 3 }).map((_, idx) => (
                              <div key={idx} className="h-12 w-full animate-pulse rounded bg-muted/40" />
                            ))}
                          </div>
                        ) : teacherWorkload.length === 0 ? (
                          <EmptyStateCard
                            compact
                            icon={<Briefcase className="text-primary-foreground" />}
                            title="No assigned workloads yet"
                            description={`Teacher workload distribution for ${activePeriodName} will appear once subject loads are published.`}
                          />
                        ) : (
                          teacherWorkload.map((t, idx: number) => (
                            <Card
                              key={t.staff_id ?? idx}
                              onClick={() =>
                                navigate(
                                  t.user_id
                                    ? `/admin/users/teacher/${t.user_id}`
                                    : routes.admin.users,
                                )
                              }
                              className="flex cursor-pointer items-center justify-between shadow-none rounded px-3 py-2.5 text-xs sm:text-sm transition-all hover:-translate-y-0.5 hover:bg-retro"
                            >
                              <div className="flex flex-col min-w-0 pr-2">
                                <span className="font-semibold text-foreground truncate">
                                  {t.name}
                                </span>
                                <span className="text-[11px] text-muted-foreground truncate">
                                  {t.subject} · {t.classes}
                                </span>
                              </div>
                              <Badge variant="surface" size="sm" className="shrink-0 whitespace-nowrap">
                                {t.students} {t.students === 1 ? "student" : "students"}
                              </Badge>
                            </Card>
                          ))
                        )}
                      </Card.Content>
                    </Card>

                    {/* Students per Grade */}
                    <Card className="flex flex-col justify-between p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0">
                        <Card.Title className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                          Students per grade
                        </Card.Title>
                        <Card.Description className="mt-0.5 text-xs text-muted-foreground">
                          Active enrollment by level
                        </Card.Description>
                      </Card.Header>

                      <Card.Content className="mt-4 flex flex-col justify-between gap-2.5 p-0 flex-1">
                        {isLoading ? (
                          <div className="h-36 w-full animate-pulse rounded bg-muted/40" />
                        ) : studentsPerGrade.length === 0 ? (
                          <EmptyStateCard
                            compact
                            icon={<School className="text-primary-foreground" />}
                            title="No enrollments yet"
                            description="Active student counts by grade level will appear once students are enrolled in active classes."
                          />
                        ) : (
                          studentsPerGrade.map((item, idx: number) => (
                            <div
                              key={item.grade ?? idx}
                              className="flex items-center justify-between gap-3 text-xs sm:text-sm"
                            >
                              <span className="font-medium text-foreground/90 shrink-0 w-20 truncate">
                                {item.grade}
                              </span>
                              <Progress
                                value={Math.round(
                                  (item.count / maxStudentsGradeCount) * 100,
                                )}
                                className="h-3 flex-1"
                              />
                              <span className="font-semibold text-foreground text-right w-8 shrink-0">
                                {item.count}
                              </span>
                            </div>
                          ))
                        )}
                      </Card.Content>
                    </Card>
                  </div>
                </div>

                {/* Right Column: All Overview Cards Stack */}
                <div className="flex min-w-0 flex-col gap-3.5 lg:col-span-3 xl:col-span-3">
                  <div className="grid grid-cols-1 gap-3.5">
                    {isLoading && cards.length === 0
                      ? Array.from({ length: 8 }).map((_, i) => (
                        <Card key={i} className="@container/card animate-pulse">
                          <Card.Header>
                            <Card.Description className="h-4 w-24 bg-muted text-transparent">
                              Loading
                            </Card.Description>
                          </Card.Header>
                          <Card.Content className="space-y-2">
                            <Card.Title className="h-8 w-16 bg-muted text-transparent">
                              0
                            </Card.Title>
                            <p className="h-3 w-32 bg-muted text-transparent">
                              Loading summary
                            </p>
                          </Card.Content>
                        </Card>
                      ))
                      : cards.map((card) => (
                        <OverviewCard
                          key={card.title}
                          title={card.title}
                          count={card.count}
                          stat={card.stat}
                          statDescription={card.statDescription}
                          trend={card.trend}
                          progressValue={card.progressValue}
                        />
                      ))}
                  </div>
                </div>
              </div>
            </main>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
