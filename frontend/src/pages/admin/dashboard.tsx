import { useEffect, useState } from "react";
import { OverviewCard } from "@/components/overview-cards";
import { Card } from "@/components/retroui/Card";
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
    title: "Student-Teacher Ratio",
    count: "3.9 : 1",
    stat: "74 students",
    statDescription: "per 19 teachers",
  },
  {
    title: "New Enrollments",
    count: "5",
    stat: "▲ 2",
    statDescription: "joined in the last 30 days",
    trend: "up",
  },
  {
    title: "Ungraded Backlog",
    count: "31",
    stat: "31 submissions",
    statDescription: "waiting more than 3 days",
  },
  {
    title: "Assessments Published",
    count: "86",
    stat: "61 classworks · 25 quizzes",
    statDescription: "this term",
  },
  {
    title: "Submission Completion",
    count: "84%",
    stat: "▼ 1 pt",
    statDescription: "of published work handed in",
    trend: "down",
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

  const maxStudentCount = Math.max(...studentsPerGrade.map((s: any) => s.count), 20);
  const maxActiveUserCount = Math.max(...activeUsers.map((u: any) => u.count), 70);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center justify-between gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <div className="flex flex-col items-start">
                  <h1 className="text-xl font-bold tracking-tight sm:text-2xl md:text-4xl">
                    Dashboard
                  </h1>
                </div>
              </div>
            </header>

            <div className="-mt-[1px] flex min-w-0 flex-col gap-5 border-t-2 border-border px-3 py-4 sm:px-4 sm:py-5 md:gap-6 md:px-6">
              {/* Top Overview Cards (12 Cards Grid) */}
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 @4xl/main:grid-cols-3 @6xl/main:grid-cols-4">
                {isLoading && cards.length === 0
                  ? Array.from({ length: 12 }).map((_, i) => (
                      <Card key={i} className="@container/card animate-pulse">
                        <Card.Header>
                          <div className="h-4 w-28 bg-muted rounded" />
                        </Card.Header>
                        <Card.Content className="space-y-2">
                          <div className="h-9 w-20 bg-muted rounded" />
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
                {/* Row 1: Enrollment Trend (wide), Students per Grade, Attendance by Grade */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                  {/* Enrollment Trend */}
                  <Card className="flex flex-col justify-between p-4 sm:p-5 lg:col-span-6 xl:col-span-5">
                    <div>
                      <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                        Enrollment trend
                      </h2>
                      <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
                        Enrolled students by week, Term 1 ·{" "}
                        <span className="font-semibold text-emerald-400">▲ 8 students</span>
                      </p>
                    </div>

                    {/* Line Chart */}
                    <div className="mt-4 flex flex-col">
                      <div className="relative h-44 w-full sm:h-48">
                        {/* Background dashed grid lines with Y values */}
                        <div className="absolute inset-0 flex flex-col justify-between pointer-events-none pr-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-muted-foreground/70 w-5 text-right shrink-0">80</span>
                            <div className="w-full border-b border-dashed border-border/40" />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-muted-foreground/70 w-5 text-right shrink-0">70</span>
                            <div className="w-full border-b border-dashed border-border/40" />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-muted-foreground/70 w-5 text-right shrink-0">60</span>
                            <div className="w-full border-b border-dashed border-border/40" />
                          </div>
                        </div>

                        {/* SVG Polyline with data points */}
                        <svg className="absolute inset-0 size-full overflow-visible pl-7 pr-2" viewBox="0 0 320 120" preserveAspectRatio="none">
                          <defs>
                            <linearGradient id="enrollmentGlow" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#facc15" stopOpacity="0.25" />
                              <stop offset="100%" stopColor="#facc15" stopOpacity="0" />
                            </linearGradient>
                          </defs>
                          {/* Fill gradient under line */}
                          <polygon
                            points="10,120 10,80 70,62 130,48 190,40 250,26 310,26 310,120"
                            fill="url(#enrollmentGlow)"
                          />
                          {/* Main line */}
                          <polyline
                            fill="none"
                            stroke="#facc15"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points="10,80 70,62 130,48 190,40 250,26 310,26"
                          />
                          {/* Points with values */}
                          {[
                            { x: 10, y: 80, val: 66 },
                            { x: 70, y: 62, val: 69 },
                            { x: 130, y: 48, val: 71 },
                            { x: 190, y: 40, val: 72 },
                            { x: 250, y: 26, val: 74 },
                            { x: 310, y: 26, val: 74 },
                          ].map((pt, idx) => (
                            <g key={idx}>
                              <circle
                                cx={pt.x}
                                cy={pt.y}
                                r="4"
                                className="fill-amber-400 stroke-background"
                                strokeWidth="2"
                              />
                              <text
                                x={pt.x}
                                y={pt.y - 8}
                                textAnchor="middle"
                                className="fill-foreground text-[11px] font-semibold select-none"
                              >
                                {pt.val}
                              </text>
                            </g>
                          ))}
                        </svg>
                      </div>

                      {/* X Axis Labels */}
                      <div className="mt-2 flex justify-between pl-7 pr-2 text-[11px] text-muted-foreground font-medium">
                        {enrollmentTrend.map((item: any) => (
                          <span key={item.week}>{item.week}</span>
                        ))}
                      </div>
                    </div>
                  </Card>

                  {/* Students per Grade */}
                  <Card className="flex flex-col justify-between p-4 sm:p-5 lg:col-span-6 xl:col-span-3">
                    <div>
                      <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                        Students per grade
                      </h2>
                    </div>

                    <div className="mt-4 flex h-48 items-end justify-between gap-2 px-1">
                      {studentsPerGrade.map((item: any) => {
                        const heightPct = Math.round((item.count / maxStudentCount) * 85);
                        return (
                          <div key={item.grade} className="flex flex-1 flex-col items-center gap-1.5 h-full justify-end">
                            <span className="text-[11px] font-semibold text-foreground">{item.count}</span>
                            <div
                              className="w-full max-w-[32px] rounded-t-sm bg-amber-400 transition-all duration-500"
                              style={{ height: `${heightPct}%` }}
                            />
                            <span className="text-[11px] font-medium text-muted-foreground shrink-0">{item.grade}</span>
                          </div>
                        );
                      })}
                    </div>
                  </Card>

                  {/* Attendance by Grade */}
                  <Card className="flex flex-col justify-between p-4 sm:p-5 lg:col-span-12 xl:col-span-4">
                    <div>
                      <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                        Attendance by grade
                      </h2>
                    </div>

                    <div className="mt-4 flex flex-col justify-between gap-2.5">
                      {attendanceByGrade.map((item: any) => (
                        <div key={item.grade} className="flex items-center justify-between gap-3 text-xs sm:text-sm">
                          <span className="font-medium text-foreground/90 shrink-0 min-w-[65px]">{item.grade}</span>
                          <div className="relative flex-1 min-w-[60px] max-w-[160px] h-3.5 rounded-full border border-border/80 bg-background/50 p-0.5 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-emerald-400 transition-all duration-500"
                              style={{ width: `${item.rate}%` }}
                            />
                          </div>
                          <span className="font-semibold text-foreground text-right w-12 shrink-0">{item.rate}%</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>

                {/* Row 2: Completion by Grade, Active Users this Week, Teacher Workload, Classes Needing Attention */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {/* Completion by Grade */}
                  <Card className="flex flex-col justify-between p-4 sm:p-5">
                    <div>
                      <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                        Completion by grade
                      </h2>
                    </div>

                    <div className="mt-4 flex flex-col justify-between gap-2.5">
                      {completionByGrade.map((item: any) => (
                        <div key={item.grade} className="flex items-center justify-between gap-3 text-xs sm:text-sm">
                          <span className="font-medium text-foreground/90 shrink-0 w-20">{item.grade}</span>
                          <div className="relative flex-1 h-2.5 rounded bg-muted/60 overflow-hidden">
                            <div
                              className="h-full rounded bg-amber-400 transition-all duration-500"
                              style={{ width: `${item.rate}%` }}
                            />
                          </div>
                          <span className="font-semibold text-foreground text-right w-10 shrink-0">{item.rate}%</span>
                        </div>
                      ))}
                    </div>
                  </Card>

                  {/* Active Users this Week */}
                  <Card className="flex flex-col justify-between p-4 sm:p-5">
                    <div>
                      <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                        Active users this week
                      </h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Students and teachers who signed in
                      </p>
                    </div>

                    <div className="mt-4 flex h-40 items-end justify-between gap-1.5 px-0.5">
                      {activeUsers.map((item: any, idx: number) => {
                        const heightPct = Math.round((item.count / maxActiveUserCount) * 80);
                        const isRed = item.highlight || item.isDrop;
                        return (
                          <div key={idx} className="flex flex-1 flex-col items-center gap-1.5 h-full justify-end">
                            <span className="text-[11px] font-semibold text-foreground">{item.count}</span>
                            <div
                              className={cn(
                                "w-full max-w-[24px] rounded-t-sm transition-all duration-500",
                                isRed ? "bg-rose-500" : "bg-amber-400"
                              )}
                              style={{ height: `${heightPct}%` }}
                            />
                            <span className="text-[11px] font-medium text-muted-foreground shrink-0">{item.day}</span>
                          </div>
                        );
                      })}
                    </div>
                  </Card>

                  {/* Teacher Workload */}
                  <Card className="flex flex-col justify-between p-4 sm:p-5">
                    <div>
                      <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                        Teacher workload
                      </h2>
                    </div>

                    <div className="mt-3 flex flex-col gap-2.5">
                      {teacherWorkload.map((t: any, idx: number) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between rounded-xl border border-border/80 bg-card/60 px-3 py-2.5 text-xs sm:text-sm"
                        >
                          <div className="flex flex-col min-w-0 pr-2">
                            <span className="font-semibold text-foreground truncate">{t.name}</span>
                            <span className="text-[11px] text-muted-foreground truncate">
                              {t.subject} · {t.classes}
                            </span>
                          </div>
                          <span className="shrink-0 rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-semibold text-black">
                            {t.students} students
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>

                  {/* Classes Needing Attention */}
                  <Card className="flex flex-col justify-between p-4 sm:p-5">
                    <div>
                      <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                        Classes needing attention
                      </h2>
                    </div>

                    <div className="mt-3 flex flex-col gap-2.5">
                      {classesAttention.map((c: any, idx: number) => {
                        const isDestructive = c.variant === "destructive" || c.status === "Low";
                        return (
                          <div
                            key={idx}
                            className="flex items-center justify-between rounded-xl border border-border/80 bg-card/60 px-3 py-2.5 text-xs sm:text-sm"
                          >
                            <div className="flex flex-col min-w-0 pr-2">
                              <span className="font-semibold text-foreground truncate">{c.name}</span>
                              <span className="text-[11px] text-muted-foreground truncate">{c.issue}</span>
                            </div>
                            <span
                              className={cn(
                                "shrink-0 rounded-full px-3 py-0.5 text-[11px] font-semibold border",
                                isDestructive
                                  ? "border-rose-500/80 bg-rose-500/15 text-rose-400"
                                  : "border-amber-500/80 bg-amber-500/15 text-amber-400"
                              )}
                            >
                              {c.status}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                </div>

                {/* Row 3: Teachers with No Published Work, Top Performing Subjects */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* Teachers with No Published Work */}
                  <Card className="flex flex-col justify-between p-4 sm:p-5">
                    <div>
                      <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                        Teachers with no published work
                      </h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Active this term but nothing posted yet
                      </p>
                    </div>

                    <div className="mt-3 flex flex-col gap-2.5">
                      {teachersNoWork.map((t: any, idx: number) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between rounded-xl border border-border/80 bg-card/60 px-3 py-2.5 text-xs sm:text-sm"
                        >
                          <div className="flex flex-col min-w-0 pr-2">
                            <span className="font-semibold text-foreground truncate">{t.name}</span>
                            <span className="text-[11px] text-muted-foreground truncate">{t.subject}</span>
                          </div>
                          <span className="shrink-0 rounded-full border border-rose-500/80 bg-rose-500/15 px-3 py-0.5 text-[11px] font-semibold text-rose-400">
                            {t.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>

                  {/* Top Performing Subjects */}
                  <Card className="flex flex-col justify-between p-4 sm:p-5">
                    <div>
                      <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                        Top performing subjects
                      </h2>
                    </div>

                    <div className="mt-3 flex flex-col gap-2.5">
                      {topSubjects.map((s: any, idx: number) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between rounded-xl border border-border/80 bg-card/60 px-3 py-2.5 text-xs sm:text-sm"
                        >
                          <div className="flex flex-col min-w-0 pr-2">
                            <span className="font-semibold text-foreground truncate">{s.name}</span>
                            <span className="text-[11px] text-muted-foreground truncate">{s.metric}</span>
                          </div>
                          <span className="shrink-0 rounded-full border border-emerald-500/80 bg-emerald-500/15 px-3 py-0.5 text-[11px] font-semibold text-emerald-400">
                            {s.rank}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
