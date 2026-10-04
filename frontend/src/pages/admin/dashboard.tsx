import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Settings, AlertCircle, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Alert } from "@/components/retroui/Alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
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

// Fallback initial cards matching the requested spec
const defaultCards: OverviewCardData[] = [
  {
    title: "Students",
    count: "74",
    stat: "74",
    statDescription: "enrolled in Term 1",
  },
  {
    title: "Teachers",
    count: "19",
    stat: "13",
    statDescription: "teaching in Term 1",
  },
  {
    title: "Classes",
    count: "10",
    stat: "10",
    statDescription: "active in Term 1",
  },
  {
    title: "Subjects",
    count: "40",
    stat: "38",
    statDescription: "active in Term 1",
  },
  {
    title: "School Passing Rate",
    count: "92%",
    stat: "▲ 2 pts",
    statDescription: "vs. last term",
    trend: "up",
  },
  {
    title: "School Attendance",
    count: "95%",
    stat: "Last 20 school days",
    statDescription: "across all grade levels",
  },
  {
    title: "New Enrollments",
    count: "5",
    stat: "▲ 2",
    statDescription: "joined in the last 30 days",
    trend: "up",
  },
  {
    title: "Term Progress",
    count: "Week 6",
    stat: "of 10",
    statDescription: "term 1 ends in 4 weeks",
    progressValue: 60,
  },
];

const defaultEnrollmentTrend = [
  { week: "Wk 1", count: 66, active: 58 },
  { week: "Wk 2", count: 69, active: 63 },
  { week: "Wk 3", count: 71, active: 61 },
  { week: "Wk 4", count: 72, active: 66 },
  { week: "Wk 5", count: 74, active: 70 },
  { week: "Wk 6", count: 74, active: 74 },
];

const defaultStudentsPerGrade = [
  { grade: "G7", count: 14 },
  { grade: "G8", count: 12 },
  { grade: "G9", count: 17 },
  { grade: "G10", count: 13 },
  { grade: "S11", count: 10 },
  { grade: "S12", count: 8 },
];

const defaultAttendanceByGrade = [
  { grade: "Grade 7", rate: 96 },
  { grade: "Grade 8", rate: 93 },
  { grade: "Grade 9", rate: 95 },
  { grade: "Grade 10", rate: 94 },
  { grade: "STEM 11", rate: 97 },
  { grade: "STEM 12", rate: 96 },
];

const defaultCompletionByGrade = [
  { grade: "Grade 7", rate: 88 },
  { grade: "Grade 8", rate: 79 },
  { grade: "Grade 9", rate: 86 },
  { grade: "Grade 10", rate: 82 },
  { grade: "STEM 11", rate: 90 },
  { grade: "STEM 12", rate: 84 },
];

const defaultActiveUsers = [
  { day: "M", count: 58 },
  { day: "T", count: 63 },
  { day: "W", count: 61 },
  { day: "Th", count: 66 },
  { day: "F", count: 52, isDrop: true },
  { day: "S", count: 12 },
  { day: "S", count: 9 },
];

const defaultTeacherWorkload = [
  { name: "Ms. Reyes", subject: "English", classes: "3 classes", students: 41 },
  { name: "Mr. Cruz", subject: "Science", classes: "2 classes", students: 26 },
  { name: "Ms. Dela Cruz", subject: "Filipino", classes: "2 classes", students: 29 },
];

const defaultClassesNeedingAttention = [
  { name: "8 - Filipino", issue: "Completion 62%", status: "Low", variant: "destructive" },
  { name: "9 - Computer", issue: "Passing rate 78%", status: "Watch", variant: "warning" },
  { name: "7 - English", issue: "Ungraded 12 tasks", status: "Watch", variant: "warning" },
];

const defaultTeachersNoWork = [
  { name: "Mr. Santos", subject: "Mathematics 10", status: "0 tasks" },
  { name: "Ms. Villanueva", subject: "MAPEH 8", status: "0 tasks" },
  { name: "Mr. Lim", subject: "TLE 9", status: "0 tasks" },
];

const defaultTopPerformingSubjects = [
  { name: "7 - Science", metric: "Mastery 95%", rank: "1st" },
  { name: "8 - Filipino", metric: "Mastery 95%", rank: "2nd" },
  { name: "9 - English", metric: "Mastery 93%", rank: "3rd" },
];

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { selectedPeriodId } = useAcademicPeriod();
  const [cards, setCards] = useState<OverviewCardData[]>(defaultCards);
  const [details, setDetails] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllGradeHealth, setShowAllGradeHealth] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await getOverviewStats({
          scope: "system",
          academic_period_id: selectedPeriodId ?? undefined,
        });
        if (!cancelled) {
          if (data.cards && data.cards.length > 0) {
            setCards(data.cards.slice(0, 8));
          }
          if (data.details) {
            setDetails(data.details);
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
  }, [selectedPeriodId]);

  const enrollmentTrend = useMemo(() => {
    if (!details?.enrollment_trend) return defaultEnrollmentTrend;
    return details.enrollment_trend.map((item: any, idx: number) => ({
      week: item.week,
      count: item.count,
      active: item.active ?? Math.min(item.count, (defaultEnrollmentTrend[idx]?.active ?? item.count)),
    }));
  }, [details]);

  const studentsPerGrade = details?.students_per_grade || defaultStudentsPerGrade;
  const attendanceByGrade = details?.attendance_by_grade || defaultAttendanceByGrade;
  const completionByGrade = details?.completion_by_grade || defaultCompletionByGrade;
  const activeUsers = details?.active_users_weekly || defaultActiveUsers;
  const teacherWorkload = details?.teacher_workload || defaultTeacherWorkload;
  const classesAttention = details?.classes_needing_attention || defaultClassesNeedingAttention;
  const teachersNoWork = details?.teachers_no_work || defaultTeachersNoWork;
  const topSubjects = details?.top_performing_subjects || defaultTopPerformingSubjects;

  const maxActiveUsersCount = Math.max(
    ...activeUsers.map((s: any) => s.count),
    70,
  );
  const maxStudentsGradeCount = Math.max(
    ...studentsPerGrade.map((s: any) => s.count),
    20,
  );

  // Grade level health matrix (analogous to section-by-section health)
  const gradeHealthData = useMemo(() => {
    const defaultList = [
      { grade: "Grade 7", category: "Junior High", students: 14, attendance: 96, completion: 88, passingRate: 94, classes: 2 },
      { grade: "Grade 8", category: "Junior High", students: 12, attendance: 93, completion: 79, passingRate: 91, classes: 2 },
      { grade: "Grade 9", category: "Junior High", students: 17, attendance: 95, completion: 86, passingRate: 93, classes: 2 },
      { grade: "Grade 10", category: "Junior High", students: 13, attendance: 94, completion: 82, passingRate: 90, classes: 2 },
      { grade: "STEM 11", category: "Senior High", students: 10, attendance: 97, completion: 90, passingRate: 96, classes: 1 },
      { grade: "STEM 12", category: "Senior High", students: 8, attendance: 96, completion: 84, passingRate: 95, classes: 1 },
    ];

    if (!details) return defaultList;

    return defaultList.map((item) => {
      const att = details.attendance_by_grade?.find((a: any) => a.grade === item.grade);
      const comp = details.completion_by_grade?.find((c: any) => c.grade === item.grade);
      const std = details.students_per_grade?.find(
        (s: any) => s.grade === item.grade || (s.grade === "G7" && item.grade === "Grade 7") || (s.grade === "G8" && item.grade === "Grade 8") || (s.grade === "G9" && item.grade === "Grade 9") || (s.grade === "G10" && item.grade === "Grade 10") || (s.grade === "S11" && item.grade === "STEM 11") || (s.grade === "S12" && item.grade === "STEM 12")
      );
      return {
        ...item,
        attendance: att?.rate ?? item.attendance,
        completion: comp?.rate ?? item.completion,
        students: std?.count ?? item.students,
      };
    });
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
                  <h1 className="text-xl font-bold sm:text-2xl md:text-4xl font-head tracking-tight">
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

            <main className="-mt-[1px] flex min-w-0 flex-col gap-4 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-3 md:gap-6 md:px-6">
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
                      <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between">
                        <Card.Title className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                          Classes Needing Attention
                        </Card.Title>
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
                          <TooltipContent side="right">View all classes</TooltipContent>
                        </Tooltip>
                      </Card.Header>

                      <Card.Content className="mt-1 flex flex-col gap-2.5 p-0">
                        {classesAttention.map((c: any, idx: number) => {
                          const isDestructive = c.variant === "destructive" || c.status === "Low";
                          return (
                            <Card
                              key={idx}
                              onClick={() => navigate(routes.admin.classes)}
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
                                variant={isDestructive ? "destructive" : "default"}
                                className="shrink-0"
                              >
                                {c.status}
                              </Badge>
                            </Card>
                          );
                        })}
                      </Card.Content>
                    </Card>

                    {/* Teachers with No Published Work */}
                    <Card className="flex flex-col justify-between p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between">
                        <Card.Title className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                          Teachers with No Work
                        </Card.Title>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="secondary"
                                size="sm"
                                autoIcon={false}
                                onClick={() => navigate(routes.admin.users)}
                                className="text-foreground shadow-none px-1.5"
                              >
                                <ArrowUpRight className="size-4" />
                              </Button>
                            }
                          />
                          <TooltipContent side="right">View teacher accounts</TooltipContent>
                        </Tooltip>
                      </Card.Header>

                      <Card.Content className="mt-1 flex flex-col gap-2.5 p-0">
                        {teachersNoWork.map((t: any, idx: number) => (
                          <Card
                            key={idx}
                            onClick={() => navigate(routes.admin.users)}
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
                        ))}
                      </Card.Content>
                    </Card>
                  </div>

                  {/* 2. School Enrollment & Active Engagement Trend Chart */}
                  <Card className="flex flex-col justify-between p-4 sm:p-5">
                    <Card.Header className="p-0">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
                        <div>
                          <Card.Title className="text-base font-bold sm:text-lg">
                            School Enrollment & Engagement Trend
                          </Card.Title>
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
                          <span className="size-2.5 rounded-full bg-muted inline-block" />
                          <span className="text-foreground">
                            Active Learners
                          </span>
                        </div>
                      </div>
                    </Card.Header>

                    {/* Line Chart Body */}
                    <Card.Content className="h-52 w-full p-0 pb-4">
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
                            domain={[40, 80]}
                            ticks={[40, 50, 60, 70, 80]}
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
                              const point = payload[0].payload;
                              return (
                                <div className="space-y-1 rounded border border-border bg-background p-2.5 text-xs text-foreground shadow-md">
                                  <p className="font-bold">
                                    {point.week}
                                  </p>
                                  <p className="text-emerald-500 font-semibold">
                                    Enrolled: {point.count} students
                                  </p>
                                  <p className="text-amber-500 font-semibold">
                                    Active: {point.active} students
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
                            stroke="var(--muted)"
                            strokeWidth={2.5}
                            dot={{
                              r: 4,
                              stroke: "var(--background)",
                              strokeWidth: 1.5,
                              fill: "var(--muted)",
                            }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                      <Card.Description className="text-xs text-muted-foreground mt-0.5 pb-2">
                        Total enrolled students vs. actively participating learners across weeks
                      </Card.Description>
                    </Card.Content>
                  </Card>

                  {/* 3. Attendance by Grade & Completion by Grade */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/* Attendance by grade */}
                    <Card className="flex flex-col justify-between p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between">
                        <Card.Title className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                          Attendance by Grade
                        </Card.Title>
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

                      <Card.Content className="mt-3 flex flex-col justify-between gap-2.5 p-0 justify-between h-full">
                        <div className="flex flex-col gap-2.5">
                          {attendanceByGrade.map((item: any) => (
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
                        <Card.Description className="mt-2 text-[11px] text-muted-foreground">
                          Average present rate across all grade levels
                        </Card.Description>
                      </Card.Content>
                    </Card>

                    {/* Completion by grade */}
                    <Card className="flex flex-col justify-between p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between">
                        <Card.Title className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                          Completion by Grade
                        </Card.Title>
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

                      <Card.Content className="mt-3 flex flex-col justify-between gap-2.5 p-0 justify-between h-full">
                        <div className="flex flex-col gap-2.5">
                          {completionByGrade.map((item: any) => (
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
                        <Card.Description className="mt-2 text-[11px] text-muted-foreground">
                          Assigned classwork completion rate
                        </Card.Description>
                      </Card.Content>
                    </Card>
                  </div>

                  {/* 4. Grade-Level Health & Performance (Section-by-Section Health counterpart) */}
                  <Card className="flex flex-col justify-between p-4 sm:p-5">
                    <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between">
                      <Card.Title className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                        Grade-Level Performance & Health
                      </Card.Title>
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
                      {displayedGrades.map((g: any, idx: number) => (
                        <Card
                          key={idx}
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
                                  {g.completion}%
                                </span>
                              </div>
                              <Progress
                                value={g.completion}
                                className="h-2"
                              />
                            </div>

                            <div className="space-y-1">
                              <div className="flex justify-between text-sm">
                                <span className="text-foreground">
                                  Attendance
                                </span>
                                <span className="font-semibold">
                                  {g.attendance}%
                                </span>
                              </div>
                              <Progress
                                value={g.attendance}
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
                                    g.passingRate < 75
                                      ? "destructive"
                                      : g.passingRate > 87
                                        ? "success"
                                        : "surface"
                                  }
                                  size="sm"
                                  className="ml-1"
                                >
                                  {g.passingRate}%
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
                        <Card.Title className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                          Active users this week
                        </Card.Title>
                        <Card.Description className="mt-0.5 text-xs text-muted-foreground">
                          Daily student and teacher logins
                        </Card.Description>
                      </Card.Header>

                      <Card.Content className="mt-4 flex flex-col justify-between gap-2.5 p-0">
                        {activeUsers.map((item: any, idx: number) => (
                          <div
                            key={idx}
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
                        ))}
                      </Card.Content>
                    </Card>

                    {/* Top performing subjects */}
                    <Card className="flex flex-col justify-between p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between">
                        <Card.Title className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                          Top Performing Subjects
                        </Card.Title>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="secondary"
                                size="sm"
                                autoIcon={false}
                                onClick={() => navigate(routes.admin.subjects)}
                                className="text-foreground shadow-none px-1.5"
                              >
                                <ArrowUpRight className="size-4" />
                              </Button>
                            }
                          />
                          <TooltipContent side="right">View all subjects</TooltipContent>
                        </Tooltip>
                      </Card.Header>

                      <Card.Content className="mt-1 flex flex-col gap-2.5 p-0">
                        {topSubjects.map((s: any, idx: number) => (
                          <Card
                            key={idx}
                            onClick={() => navigate(routes.admin.subjects)}
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
                        ))}
                      </Card.Content>
                    </Card>

                    {/* Teacher Workload */}
                    <Card className="flex flex-col justify-between p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between">
                        <Card.Title className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                          Teacher Workload
                        </Card.Title>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="secondary"
                                size="sm"
                                autoIcon={false}
                                onClick={() => navigate(routes.admin.users)}
                                className="text-foreground shadow-none px-1.5"
                              >
                                <ArrowUpRight className="size-4" />
                              </Button>
                            }
                          />
                          <TooltipContent side="right">View teacher workload</TooltipContent>
                        </Tooltip>
                      </Card.Header>

                      <Card.Content className="mt-1 flex flex-col gap-2.5 p-0">
                        {teacherWorkload.map((t: any, idx: number) => (
                          <Card
                            key={idx}
                            onClick={() => navigate(routes.admin.users)}
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
                              {t.students} students
                            </Badge>
                          </Card>
                        ))}
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

                      <Card.Content className="mt-4 flex flex-col justify-between gap-2.5 p-0">
                        {studentsPerGrade.map((item: any, idx: number) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between gap-3 text-xs sm:text-sm"
                          >
                            <span className="font-medium text-foreground/90 shrink-0 w-14 truncate">
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
                        ))}
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
