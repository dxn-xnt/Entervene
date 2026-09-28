import { useEffect, useState } from "react";
import { OverviewCard } from "@/components/overview-cards";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Progress } from "@/components/retroui/Progress";
import { Text } from "@/components/retroui/Text";
import { RetroBarChart } from "@/components/retroui/Chart";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { getOverviewStats, type OverviewCardData } from "@/lib/api";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
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
  { week: "Wk 1", count: 66 },
  { week: "Wk 2", count: 69 },
  { week: "Wk 3", count: 71 },
  { week: "Wk 4", count: 72 },
  { week: "Wk 5", count: 74 },
  { week: "Wk 6", count: 74 },
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
  const { selectedPeriodId } = useAcademicPeriod();
  const [cards, setCards] = useState<OverviewCardData[]>(defaultCards);
  const [details, setDetails] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      setIsLoading(true);
      try {
        const data = await getOverviewStats({
          scope: "system",
          academic_period_id: selectedPeriodId ?? undefined,
        });
        if (!cancelled) {
          if (data.cards && data.cards.length > 0) {
            setCards(data.cards);
          }
          if (data.details) {
            setDetails(data.details);
          }
        }
      } catch (err) {
        console.error("Failed to load admin overview metrics:", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchStats();
    return () => {
      cancelled = true;
    };
  }, [selectedPeriodId]);

  const enrollmentTrend = details?.enrollment_trend || defaultEnrollmentTrend;
  const studentsPerGrade = details?.students_per_grade || defaultStudentsPerGrade;
  const attendanceByGrade = details?.attendance_by_grade || defaultAttendanceByGrade;
  const completionByGrade = details?.completion_by_grade || defaultCompletionByGrade;
  const activeUsers = details?.active_users_weekly || defaultActiveUsers;
  const teacherWorkload = details?.teacher_workload || defaultTeacherWorkload;
  const classesAttention = details?.classes_needing_attention || defaultClassesNeedingAttention;
  const teachersNoWork = details?.teachers_no_work || defaultTeachersNoWork;
  const topSubjects = details?.top_performing_subjects || defaultTopPerformingSubjects;

  return (
    <AppLayout>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center justify-between gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <div className="flex flex-col items-start">
                  <h1 className="font-head text-xl font-bold tracking-tight sm:text-2xl md:text-4xl">
                    Dashboard
                  </h1>
                </div>
              </div>
            </header>

            <main className="-mt-[1px] flex min-w-0 flex-col gap-5 border-t-2 border-border px-3 py-4 sm:px-4 sm:py-5 md:gap-6 md:px-6">
              {/* Top Overview Cards Grid */}
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 @4xl/main:grid-cols-3 @6xl/main:grid-cols-4">
                {isLoading && cards.length === 0
                  ? Array.from({ length: 8 }).map((_, i) => (
                    <Card key={i} className="@container/card animate-pulse">
                      <Card.Header>
                        <Card.Description className="h-4 w-28 bg-muted text-transparent">
                          Loading
                        </Card.Description>
                      </Card.Header>
                      <Card.Content className="space-y-2">
                        <Card.Title className="h-8 w-20 bg-muted text-transparent">
                          --
                        </Card.Title>
                        <div className="h-3 w-36 bg-muted rounded" />
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

              {/* Analytics & Breakdown Section */}
              <div className="flex flex-col gap-4">
                {/* Row 1: Enrollment Trend, Students per Grade, Attendance by Grade */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                  {/* Enrollment Trend (RetroBarChart) */}
                  <RetroBarChart
                    title="Enrollment trend"
                    description="Enrolled students by week, Term 1 · ▲ 8 students"
                    data={enrollmentTrend.map((item: any) => ({
                      label: item.week,
                      value: item.count,
                    }))}
                    yAxisTicks={[80, 60, 40, 20, 0]}
                    maxY={80}
                    className="lg:col-span-6 xl:col-span-5"
                  />

                  {/* Students per Grade (RetroBarChart) */}
                  <RetroBarChart
                    title="Students per grade"
                    description="Active student counts"
                    data={studentsPerGrade.map((item: any) => ({
                      label: item.grade,
                      value: item.count,
                    }))}
                    className="lg:col-span-6 xl:col-span-3"
                  />

                  {/* Attendance by Grade */}
                  <Card className="@container/card flex flex-col justify-between lg:col-span-12 xl:col-span-4">
                    <Card.Header>
                      <Card.Title className="text-base sm:text-lg font-bold font-head">
                        Attendance by grade
                      </Card.Title>
                      <Card.Description className="text-xs sm:text-sm text-muted-foreground font-normal">
                        Average present rate
                      </Card.Description>
                    </Card.Header>

                    <Card.Content className="mt-2 flex flex-col justify-between gap-3">
                      {attendanceByGrade.map((item: any) => (
                        <div key={item.grade} className="flex items-center justify-between gap-3 text-xs sm:text-sm">
                          <span className="font-semibold text-foreground shrink-0 min-w-[65px]">{item.grade}</span>
                          <Progress value={item.rate} className="h-3 flex-1" />
                          <span className="font-bold font-head text-foreground text-right w-12 shrink-0">{item.rate}%</span>
                        </div>
                      ))}
                    </Card.Content>
                  </Card>
                </div>

                {/* Row 2: Completion by Grade, Active Users this Week, Teacher Workload, Classes Needing Attention */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {/* Completion by Grade */}
                  <Card className="@container/card flex flex-col justify-between">
                    <Card.Header>
                      <Card.Title className="text-base sm:text-lg font-bold font-head">
                        Completion by grade
                      </Card.Title>
                      <Card.Description className="text-xs sm:text-sm text-muted-foreground font-normal">
                        Assigned classwork completion
                      </Card.Description>
                    </Card.Header>

                    <Card.Content className="mt-2 flex flex-col justify-between gap-3">
                      {completionByGrade.map((item: any) => (
                        <div key={item.grade} className="flex items-center justify-between gap-3 text-xs sm:text-sm">
                          <span className="font-semibold text-foreground shrink-0 w-20">{item.grade}</span>
                          <Progress value={item.rate} className="h-3 flex-1" />
                          <span className="font-bold font-head text-foreground text-right w-10 shrink-0">{item.rate}%</span>
                        </div>
                      ))}
                    </Card.Content>
                  </Card>

                  {/* Active Users this Week (RetroBarChart) */}
                  <RetroBarChart
                    title="Active users this week"
                    description="Students and teachers signed in"
                    data={activeUsers.map((item: any) => ({
                      label: item.day,
                      value: item.count,
                      highlight: item.highlight || item.isDrop,
                    }))}
                    highlightColor="#f43f5e"
                  />

                  {/* Teacher Workload */}
                  <Card className="@container/card flex flex-col justify-between">
                    <Card.Header>
                      <Card.Title className="text-base sm:text-lg font-bold font-head">
                        Teacher workload
                      </Card.Title>
                      <Card.Description className="text-xs sm:text-sm text-muted-foreground font-normal">
                        Class & student allocation
                      </Card.Description>
                    </Card.Header>

                    <Card.Content className="mt-2 flex flex-col gap-2.5">
                      {teacherWorkload.map((t: any, idx: number) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between rounded border-2 border-border bg-card/60 p-2.5 transition-colors hover:bg-muted/50 text-xs sm:text-sm"
                        >
                          <div className="flex flex-col min-w-0 pr-2">
                            <Text as="p" className="font-bold text-foreground truncate">
                              {t.name}
                            </Text>
                            <span className="text-[11px] text-muted-foreground truncate">
                              {t.subject} · {t.classes}
                            </span>
                          </div>
                          <Badge variant="surface" size="sm" className="shrink-0 whitespace-nowrap">
                            {t.students} students
                          </Badge>
                        </div>
                      ))}
                    </Card.Content>
                  </Card>

                  {/* Classes Needing Attention */}
                  <Card className="@container/card flex flex-col justify-between">
                    <Card.Header>
                      <Card.Title className="text-base sm:text-lg font-bold font-head">
                        Classes needing attention
                      </Card.Title>
                      <Card.Description className="text-xs sm:text-sm text-muted-foreground font-normal">
                        Completion & grading flags
                      </Card.Description>
                    </Card.Header>

                    <Card.Content className="mt-2 flex flex-col gap-2.5">
                      {classesAttention.map((c: any, idx: number) => {
                        const isDestructive = c.variant === "destructive" || c.status === "Low";
                        return (
                          <div
                            key={idx}
                            className="flex items-center justify-between rounded border-2 border-border bg-card/60 p-2.5 transition-colors hover:bg-muted/50 text-xs sm:text-sm"
                          >
                            <div className="flex flex-col min-w-0 pr-2">
                              <Text as="p" className="font-bold text-foreground truncate">
                                {c.name}
                              </Text>
                              <span className="text-[11px] text-muted-foreground truncate">
                                {c.issue}
                              </span>
                            </div>
                            <Badge
                              variant={isDestructive ? "destructive" : "secondary"}
                              size="sm"
                              className="shrink-0 whitespace-nowrap"
                            >
                              {c.status}
                            </Badge>
                          </div>
                        );
                      })}
                    </Card.Content>
                  </Card>
                </div>

                {/* Row 3: Teachers with No Published Work, Top Performing Subjects */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* Teachers with No Published Work */}
                  <Card className="@container/card flex flex-col justify-between">
                    <Card.Header>
                      <Card.Title className="text-base sm:text-lg font-bold font-head">
                        Teachers with no published work
                      </Card.Title>
                      <Card.Description className="text-xs sm:text-sm text-muted-foreground font-normal">
                        Active this term but nothing posted yet
                      </Card.Description>
                    </Card.Header>

                    <Card.Content className="mt-2 flex flex-col gap-2.5">
                      {teachersNoWork.map((t: any, idx: number) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between rounded border-2 border-border bg-card/60 p-2.5 transition-colors hover:bg-muted/50 text-xs sm:text-sm"
                        >
                          <div className="flex flex-col min-w-0 pr-2">
                            <Text as="p" className="font-bold text-foreground truncate">
                              {t.name}
                            </Text>
                            <span className="text-[11px] text-muted-foreground truncate">
                              {t.subject}
                            </span>
                          </div>
                          <Badge variant="destructive" size="sm" className="shrink-0 whitespace-nowrap">
                            {t.status}
                          </Badge>
                        </div>
                      ))}
                    </Card.Content>
                  </Card>

                  {/* Top Performing Subjects */}
                  <Card className="@container/card flex flex-col justify-between">
                    <Card.Header>
                      <Card.Title className="text-base sm:text-lg font-bold font-head">
                        Top performing subjects
                      </Card.Title>
                      <Card.Description className="text-xs sm:text-sm text-muted-foreground font-normal">
                        Highest student mastery rankings
                      </Card.Description>
                    </Card.Header>

                    <Card.Content className="mt-2 flex flex-col gap-2.5">
                      {topSubjects.map((s: any, idx: number) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between rounded border-2 border-border bg-card/60 p-2.5 transition-colors hover:bg-muted/50 text-xs sm:text-sm"
                        >
                          <div className="flex flex-col min-w-0 pr-2">
                            <Text as="p" className="font-bold text-foreground truncate">
                              {s.name}
                            </Text>
                            <span className="text-[11px] text-muted-foreground truncate">
                              {s.metric}
                            </span>
                          </div>
                          <Badge variant="success" size="sm" className="shrink-0 whitespace-nowrap">
                            {s.rank}
                          </Badge>
                        </div>
                      ))}
                    </Card.Content>
                  </Card>
                </div>
              </div>
            </main>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

