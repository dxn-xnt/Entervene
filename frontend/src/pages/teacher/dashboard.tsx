import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Calendar,
  ArrowUpRight,
  AlertCircle,
  FileText,
} from "lucide-react";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Progress } from "@/components/retroui/Progress";
import { Select } from "@/components/retroui/Select";
import { OverviewCard } from "@/components/overview-cards";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { routes } from "@/../routes";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import {
  getTeacherDashboardHealth,
  type TeacherDashboardHealthResponse,
  type OverviewCardData,
} from "@/lib/api";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";

// Default fallback data matching mockup
const defaultTeacherCards: OverviewCardData[] = [
  {
    title: "Active Classes",
    count: "3",
    stat: "3 sections",
    statDescription: "in Term 1",
  },
  {
    title: "Enrolled Students",
    count: "36",
    stat: "36 learners",
    statDescription: "total across sections",
  },
  {
    title: "Overall Completion",
    count: "87%",
    stat: "31 of 36 submitted",
    statDescription: "across all published work",
  },
  {
    title: "Ungraded Queue",
    count: "14",
    stat: "14 submissions",
    statDescription: "pending teacher grading",
  },
  {
    title: "Class Average",
    count: "82%",
    stat: "▲ 3 pts",
    statDescription: "vs. last grading period",
    trend: "up",
  },
  {
    title: "Passing Rate",
    count: "89%",
    stat: "32 of 36 learners",
    statDescription: "at or above 75%",
  },
  {
    title: "Late Submissions",
    count: "8%",
    stat: "▲ 2 pts",
    statDescription: "of work handed in after due date",
    trend: "down",
  },
  {
    title: "Grading Turnaround",
    count: "1.8 days",
    statDescription: "Median wait from submission to score",
  },
  {
    title: "Attendance Today",
    count: "33 / 36",
    stat: "2 late · 1 absent",
    statDescription: "logged for this morning",
  },
  {
    title: "Feedback Coverage",
    count: "71%",
    stat: "25 of 35 graded",
    statDescription: "have written comments",
  },
  {
    title: "Term Progress",
    count: "Week 6",
    stat: "of 10",
    statDescription: "1 published classwork planned this week",
    progressValue: 60,
  },
  {
    title: "Published Work",
    count: "12",
    stat: "9 classworks · 3 quizzes",
    statDescription: "this term, 2 still in draft",
  },
];

const defaultStudentsNeedingSupport = [
  { name: "Jose Reyes", section: "Archimedes · 3 missing tasks", score: 52, variant: "destructive" },
  { name: "Ana Lim", section: "Newton · falling 12 pts", score: 61, variant: "destructive" },
  { name: "Paolo Cruz", section: "Curie · low attendance", score: 68, variant: "warning" },
];

const defaultTopPerformers = [
  { name: "Maria Santos", section: "Curie · Science 9", score: 97 },
  { name: "Liam Tan", section: "Newton · Mathematics 9", score: 95 },
  { name: "Bea Garcia", section: "Archimedes · Filipino 9", score: 94 },
];

const defaultDueThisWeek = [
  { title: "Fractions worksheet", section: "Newton · Mathematics 9", due_label: "Tomorrow", variant: "destructive" },
  { title: "Lab report: Cells", section: "Curie · Science 9", due_label: "Thu", variant: "warning" },
  { title: "Sanaysay", section: "Archimedes · Filipino 9", due_label: "Fri", variant: "warning" },
];

const defaultTopicMastery = [
  { topic: "Pang-uri", rate: 91 },
  { topic: "Fractions", rate: 88 },
  { topic: "Cells", rate: 80 },
  { topic: "Geometry", rate: 64 },
  { topic: "Essay writing", rate: 59 },
];

const defaultSubmissionsWeekday = [
  { day: "M", count: 18 },
  { day: "T", count: 22 },
  { day: "W", count: 14 },
  { day: "Th", count: 30 },
  { day: "F", count: 41, isHighlight: true },
  { day: "S", count: 9 },
];

const defaultHardestQuestions = [
  { code: "Q7 · Simplify mixed fractions", quiz: "Fractions Quiz", rate: "34% correct", variant: "destructive" },
  { code: "Q3 · Parts of the cell", quiz: "Lab Quiz", rate: "48% correct", variant: "destructive" },
  { code: "Q5 · Uri ng pang-uri", quiz: "Pagsusulit 1", rate: "57% correct", variant: "warning" },
];

const defaultReviewSubmissions = [
  { title: "Panganganak ng Pang-uri", section: "Archimedes · Filipino 9", badge: "6 new", variant: "destructive" },
  { title: "Fractions Quiz", section: "Newton · Mathematics 9", badge: "5 new", variant: "destructive" },
  { title: "Lab Report: Cells", section: "Curie · Science 9", badge: "3 new", variant: "warning" },
];

const defaultGradeDistribution = [
  { band: "<60", count: 2, variant: "destructive" },
  { band: "60-69", count: 4, variant: "warning" },
  { band: "70-79", count: 9, variant: "warning" },
  { band: "80-89", count: 13, variant: "success" },
  { band: "90-100", count: 8, variant: "success" },
];

const defaultAttendanceBySection = [
  { section: "Archimedes", rate: 94 },
  { section: "Newton", rate: 90 },
  { section: "Curie", rate: 97 },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const { selectedPeriodId } = useAcademicPeriod();

  const [data, setData] = useState<TeacherDashboardHealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state for the trend chart
  const [selectedFilterKey, setSelectedFilterKey] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function fetchDashboard() {
      setIsLoading(true);
      setError(null);
      try {
        let classId: number | undefined;
        let subjectId: number | undefined;

        if (selectedFilterKey) {
          const [cId, sId] = selectedFilterKey.split("-").map(Number);
          if (!isNaN(cId) && !isNaN(sId)) {
            classId = cId;
            subjectId = sId;
          }
        }

        const res = await getTeacherDashboardHealth({
          academic_period_id: selectedPeriodId ?? undefined,
          class_id: classId,
          subject_id: subjectId,
        });

        if (!cancelled) {
          setData(res);
          if (!selectedFilterKey && res.trend_chart.available_filters.length > 0) {
            const first = res.trend_chart.available_filters[0];
            setSelectedFilterKey(`${first.class_id}-${first.subject_id}`);
          }
        }
      } catch (err: unknown) {
        if (!cancelled) {
          console.error("Failed to load teacher dashboard health:", err);
          setError(err instanceof Error ? err.message : "Failed to load dashboard data");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchDashboard();
    return () => {
      cancelled = true;
    };
  }, [selectedPeriodId, selectedFilterKey]);

  // Derived 12 Stat Cards (Retaining original stat cards and adding new ones)
  const statCards = useMemo<OverviewCardData[]>(() => {
    if (data?.cards && data.cards.length > 0) {
      return data.cards;
    }
    if (!data) return defaultTeacherCards;

    return [
      // Row 1 (Original retained)
      {
        title: "Active Classes",
        count: String(data.kpis.active_classes || 3),
        stat: `${data.kpis.active_classes || 3} sections`,
        statDescription: `in ${data.term_info?.period_name || "Term 1"}`,
      },
      {
        title: "Enrolled Students",
        count: String(data.kpis.enrolled_students || 36),
        stat: `${data.kpis.enrolled_students || 36} learners`,
        statDescription: "total across sections",
      },
      {
        title: "Overall Completion",
        count: `${Math.round(data.kpis.overall_completion_rate || 87)}%`,
        stat: "31 of 36 submitted",
        statDescription: "across all published work",
      },
      {
        title: "Ungraded Queue",
        count: String(data.kpis.ungraded_count || 14),
        stat: `${data.kpis.ungraded_count || 14} submissions`,
        statDescription: "pending teacher grading",
      },
      // Row 2 (New cards)
      {
        title: "Class Average",
        count: "82%",
        stat: "▲ 3 pts",
        statDescription: "vs. last grading period",
        trend: "up",
      },
      {
        title: "Passing Rate",
        count: "89%",
        stat: "32 of 36 learners",
        statDescription: "at or above 75%",
      },
      {
        title: "Late Submissions",
        count: "8%",
        stat: "▲ 2 pts",
        statDescription: "of work handed in after due date",
        trend: "down",
      },
      {
        title: "Grading Turnaround",
        count: "1.8 days",
        statDescription: "Median wait from submission to score",
      },
      // Row 3 (New cards)
      {
        title: "Attendance Today",
        count: "33 / 36",
        stat: "2 late · 1 absent",
        statDescription: "logged for this morning",
      },
      {
        title: "Feedback Coverage",
        count: "71%",
        stat: "25 of 35 graded",
        statDescription: "have written comments",
      },
      {
        title: "Term Progress",
        count: "Week 6",
        stat: "of 10",
        statDescription: "1 published classwork planned this week",
        progressValue: 60,
      },
      {
        title: "Published Work",
        count: "12",
        stat: "9 classworks · 3 quizzes",
        statDescription: "this term, 2 still in draft",
      },
    ];
  }, [data]);

  const studentsSupport = data?.details?.students_needing_support || defaultStudentsNeedingSupport;
  const topPerformers = data?.details?.top_performers || defaultTopPerformers;
  const dueWeek = data?.details?.due_this_week || defaultDueThisWeek;
  const topicMastery = data?.details?.topic_mastery || defaultTopicMastery;
  const submissionsWeekday = data?.details?.submissions_by_weekday || defaultSubmissionsWeekday;
  const hardestQuestions = data?.details?.hardest_questions || defaultHardestQuestions;
  const reviewSubmissions = defaultReviewSubmissions;
  const gradeDistribution = data?.details?.grade_distribution || defaultGradeDistribution;
  const attendanceSections = data?.details?.attendance_by_section || defaultAttendanceBySection;

  const maxWeekdayCount = Math.max(...submissionsWeekday.map((s: any) => s.count), 45);
  const maxGradeDistCount = Math.max(...gradeDistribution.map((g: any) => g.count), 15);

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
                onClick={() => navigate(routes.teacher.profile)}
                className="shrink-0 whitespace-nowrap"
              >
                <Calendar className="size-4" />
                <span className="sm:hidden">Schedule</span>
                <span className="hidden sm:inline">View My Schedule</span>
              </Button>
            </header>

            <main className="-mt-[1px] flex min-w-0 flex-col gap-5 border-t-2 border-border px-3 py-4 sm:px-4 sm:py-5 md:gap-6 md:px-6">
              {error && (
                <div role="alert" className="flex items-center gap-2 border-2 border-destructive bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* 1. Top 12 Stat Cards Grid (Retaining original stat cards) */}
              <div className="grid w-full grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                {isLoading && !data
                  ? Array.from({ length: 12 }).map((_, i) => (
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
                          <p className="h-3 w-32 bg-muted text-transparent">Loading summary</p>
                        </Card.Content>
                      </Card>
                    ))
                  : statCards.map((card) => (
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

              {/* 2. Middle Section: Students Support, Top Performers, Due this Week, Topic Mastery */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {/* Students needing support */}
                <Card className="flex flex-col justify-between p-4 sm:p-5">
                  <div>
                    <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                      Students needing support
                    </h2>
                  </div>

                  <div className="mt-3 flex flex-col gap-2.5">
                    {studentsSupport.map((s: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded-xl border border-border/80 bg-card/60 px-3 py-2.5 text-xs sm:text-sm"
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="font-semibold text-foreground truncate">{s.name}</span>
                          <span className="text-[11px] text-muted-foreground truncate">{s.section}</span>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-3 py-0.5 text-[11px] font-semibold border",
                            s.variant === "destructive" || s.score <= 65
                              ? "border-rose-500/80 bg-rose-500/15 text-rose-400"
                              : "border-amber-500/80 bg-amber-500/15 text-amber-400"
                          )}
                        >
                          {s.score}%
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* Top performers */}
                <Card className="flex flex-col justify-between p-4 sm:p-5">
                  <div>
                    <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                      Top performers
                    </h2>
                  </div>

                  <div className="mt-3 flex flex-col gap-2.5">
                    {topPerformers.map((p: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded-xl border border-border/80 bg-card/60 px-3 py-2.5 text-xs sm:text-sm"
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="font-semibold text-foreground truncate">{p.name}</span>
                          <span className="text-[11px] text-muted-foreground truncate">{p.section}</span>
                        </div>
                        <span className="shrink-0 rounded-full border border-emerald-500/80 bg-emerald-500/15 px-3 py-0.5 text-[11px] font-semibold text-emerald-400">
                          {p.score}%
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* Due this week */}
                <Card className="flex flex-col justify-between p-4 sm:p-5">
                  <div>
                    <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                      Due this week
                    </h2>
                  </div>

                  <div className="mt-3 flex flex-col gap-2.5">
                    {dueWeek.map((d: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded-xl border border-border/80 bg-card/60 px-3 py-2.5 text-xs sm:text-sm"
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="font-semibold text-foreground truncate">{d.title}</span>
                          <span className="text-[11px] text-muted-foreground truncate">{d.section}</span>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-3 py-0.5 text-[11px] font-semibold border",
                            d.due_label === "Tomorrow" || d.variant === "destructive"
                              ? "border-rose-500/80 bg-rose-500/15 text-rose-400"
                              : "border-amber-500/80 bg-amber-500/15 text-amber-400"
                          )}
                        >
                          {d.due_label}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* Topic mastery */}
                <Card className="flex flex-col justify-between p-4 sm:p-5">
                  <div>
                    <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                      Topic mastery
                    </h2>
                  </div>

                  <div className="mt-3 flex flex-col justify-between gap-2.5">
                    {topicMastery.map((item: any) => (
                      <div key={item.topic} className="flex items-center justify-between gap-3 text-xs sm:text-sm">
                        <span className="font-medium text-foreground/90 shrink-0 w-24 truncate">{item.topic}</span>
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
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Lowest topics may need reteaching
                  </p>
                </Card>
              </div>

              {/* 3. Submissions by weekday & Hardest questions */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Submissions by weekday */}
                <Card className="flex flex-col justify-between p-4 sm:p-5">
                  <div>
                    <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                      Submissions by weekday
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      When learners hand work in
                    </p>
                  </div>

                  <div className="mt-4 flex h-40 items-end justify-between gap-2 px-1">
                    {submissionsWeekday.map((item: any, idx: number) => {
                      const heightPct = Math.round((item.count / maxWeekdayCount) * 85);
                      const isGreen = item.isHighlight;
                      return (
                        <div key={idx} className="flex flex-1 flex-col items-center gap-1.5 h-full justify-end">
                          <span className="text-[11px] font-semibold text-foreground">{item.count}</span>
                          <div
                            className={cn(
                              "w-full max-w-[28px] rounded-t-sm transition-all duration-500",
                              isGreen ? "bg-emerald-400" : "bg-amber-400"
                            )}
                            style={{ height: `${heightPct}%` }}
                          />
                          <span className="text-[11px] font-medium text-muted-foreground shrink-0">{item.day}</span>
                        </div>
                      );
                    })}
                  </div>
                </Card>

                {/* Hardest questions */}
                <Card className="flex flex-col justify-between p-4 sm:p-5">
                  <div>
                    <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                      Hardest questions
                    </h2>
                  </div>

                  <div className="mt-3 flex flex-col gap-2.5">
                    {hardestQuestions.map((q: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded-xl border border-border/80 bg-card/60 px-3 py-2.5 text-xs sm:text-sm"
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="font-semibold text-foreground truncate">{q.code}</span>
                          <span className="text-[11px] text-muted-foreground truncate">{q.quiz}</span>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-3 py-0.5 text-[11px] font-semibold border",
                            q.variant === "destructive"
                              ? "border-rose-500/80 bg-rose-500/15 text-rose-400"
                              : "border-amber-500/80 bg-amber-500/15 text-amber-400"
                          )}
                        >
                          {q.rate}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              {/* 4. Lower Section Row 1: Mastery & Completion Trend + Section-by-Section Health */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                {/* Trend Chart (Left 6 Cols) */}
                <Card className="lg:col-span-6 flex flex-col justify-between p-4 sm:p-5">
                  <div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
                      <div>
                        <Card.Title className="text-base font-bold sm:text-lg">
                          Classwork Mastery & Completion Trend
                        </Card.Title>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Class score averages vs. task submission completion, last 6 classworks
                        </p>
                      </div>

                      {data && data.trend_chart.available_filters.length > 0 && (
                        <div className="flex items-center gap-1.5 sm:w-auto">
                          <Select
                            value={selectedFilterKey}
                            onValueChange={setSelectedFilterKey}
                          >
                            <Select.Trigger id="trend-filter" className="h-8 text-xs font-semibold sm:min-w-44">
                              <Select.Value placeholder="Select section" />
                            </Select.Trigger>
                            <Select.Content>
                              {data.trend_chart.available_filters.map((f) => (
                                <Select.Item
                                  key={`${f.class_id}-${f.subject_id}`}
                                  value={`${f.class_id}-${f.subject_id}`}
                                >
                                  {f.section_name} · {f.subject_name}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select>
                        </div>
                      )}
                    </div>

                    {/* Chart Legend */}
                    <div className="flex flex-wrap items-center gap-4 mb-3 text-xs text-muted-foreground font-medium">
                      <div className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full bg-emerald-400 inline-block" />
                        <span className="text-foreground">Class Mastery Average (%)</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-3.5 h-0.5 border-t-2 border-dashed border-amber-400 inline-block" />
                        <span className="text-foreground">Submission Completion (%)</span>
                      </div>
                    </div>
                  </div>

                  {/* Line Chart Body */}
                  <div className="h-52 w-full pt-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={
                          data?.trend_chart.points && data.trend_chart.points.length > 0
                            ? data.trend_chart.points
                            : [
                                { label: "CW 1", short_label: "CW 1", avg_score_percent: 70, completion_rate_percent: 60 },
                                { label: "CW 2", short_label: "CW 2", avg_score_percent: 72, completion_rate_percent: 68 },
                                { label: "CW 3", short_label: "CW 3", avg_score_percent: 72, completion_rate_percent: 74 },
                                { label: "CW 4", short_label: "CW 4", avg_score_percent: 76, completion_rate_percent: 78 },
                                { label: "CW 5", short_label: "CW 5", avg_score_percent: 78, completion_rate_percent: 82 },
                                { label: "CW 6", short_label: "CW 6", avg_score_percent: 80, completion_rate_percent: 85 },
                              ]
                        }
                        margin={{ top: 10, right: 15, left: -20, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" strokeOpacity={0.4} />
                        <XAxis
                          dataKey="short_label"
                          tickLine={false}
                          axisLine={{ stroke: "var(--foreground)", strokeWidth: 1 }}
                          tick={{ fontSize: 11, fontWeight: 500 }}
                        />
                        <YAxis
                          domain={[50, 100]}
                          ticks={[50, 75, 100]}
                          tickLine={false}
                          axisLine={{ stroke: "var(--foreground)", strokeWidth: 1 }}
                          tick={{ fontSize: 11 }}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload || !payload.length) return null;
                            const point = payload[0].payload;
                            return (
                              <div className="space-y-1 rounded border border-border bg-background p-2.5 text-xs text-foreground shadow-md">
                                <p className="font-bold">{point.title || point.short_label}</p>
                                <p className="text-emerald-400 font-semibold">
                                  Mastery: {point.avg_score_percent}%
                                </p>
                                <p className="text-amber-400 font-semibold">
                                  Completion: {point.completion_rate_percent}%
                                </p>
                              </div>
                            );
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="avg_score_percent"
                          name="Mastery %"
                          stroke="#34d399"
                          strokeWidth={2.5}
                          dot={{ r: 4, stroke: "var(--background)", strokeWidth: 1.5, fill: "#34d399" }}
                          activeDot={{ r: 6 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="completion_rate_percent"
                          name="Completion %"
                          stroke="#f59e0b"
                          strokeWidth={2}
                          strokeDasharray="4 4"
                          dot={{ r: 3, stroke: "var(--background)", strokeWidth: 1, fill: "#f59e0b" }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                {/* Section-by-Section Health (Right 6 Cols) */}
                <Card className="lg:col-span-6 flex flex-col justify-between p-4 sm:p-5">
                  <div>
                    <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                      Section-by-Section Health
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Performance, completion, and attendance across your classes
                    </p>
                  </div>

                  <div className="mt-3 flex flex-col gap-3">
                    {(data?.section_matrix && data.section_matrix.length > 0
                      ? data.section_matrix
                      : [
                          {
                            section_name: "Archimedes",
                            grade_level: "Grade 9",
                            subject_name: "Filipino 9",
                            student_count: 17,
                            completion_rate_percent: 82,
                            attendance_rate_percent: 94,
                            avg_score_percent: 84,
                            passing_rate_percent: 91,
                            published_classworks: 6,
                          },
                          {
                            section_name: "Newton",
                            grade_level: "Grade 9",
                            subject_name: "Mathematics 9",
                            student_count: 10,
                            completion_rate_percent: 76,
                            attendance_rate_percent: 90,
                            avg_score_percent: 78,
                            passing_rate_percent: 80,
                            published_classworks: 5,
                          },
                          {
                            section_name: "Curie",
                            grade_level: "Grade 9",
                            subject_name: "Science 9",
                            student_count: 9,
                            completion_rate_percent: 88,
                            attendance_rate_percent: 97,
                            avg_score_percent: 86,
                            passing_rate_percent: 100,
                            published_classworks: 4,
                          },
                        ]
                    ).map((sec: any, idx: number) => (
                      <div
                        key={idx}
                        className="rounded-xl border border-border/80 bg-card/60 p-3 text-xs"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-foreground">{sec.section_name}</span>
                            <span className="px-1.5 py-0.2 bg-amber-400 text-black text-[10px] font-semibold rounded">
                              {sec.grade_level || "Grade 9"}
                            </span>
                            <span className="text-muted-foreground text-[11px]">{sec.subject_name}</span>
                          </div>
                          <span className="font-semibold text-muted-foreground">{sec.student_count} Students</span>
                        </div>

                        {/* Task completion & attendance progress */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2.5">
                          <div className="space-y-1">
                            <div className="flex justify-between text-[11px]">
                              <span className="text-muted-foreground">Task Completion</span>
                              <span className="font-semibold">{sec.completion_rate_percent}%</span>
                            </div>
                            <div className="h-2 w-full rounded bg-muted/60 overflow-hidden">
                              <div
                                className="h-full bg-amber-400 rounded"
                                style={{ width: `${sec.completion_rate_percent}%` }}
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <div className="flex justify-between text-[11px]">
                              <span className="text-muted-foreground">Attendance</span>
                              <span className="font-semibold">{sec.attendance_rate_percent}%</span>
                            </div>
                            <div className="h-2.5 w-full rounded-full border border-border/80 p-0.5 bg-background overflow-hidden">
                              <div
                                className="h-full rounded-full bg-emerald-400"
                                style={{ width: `${sec.attendance_rate_percent}%` }}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Bottom Info Bar */}
                        <div className="flex items-center justify-between border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                          <div className="flex items-center gap-3">
                            <span>
                              Class Average:{" "}
                              <span className="font-semibold text-foreground px-1.5 py-0.5 rounded-full border border-border/70">
                                {sec.avg_score_percent}%
                              </span>
                            </span>
                            <span>
                              Passing Rate: <span className="font-semibold text-foreground">{sec.passing_rate_percent}%</span>
                            </span>
                          </div>
                          <span>{sec.published_classworks} published tasks</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              {/* 5. Lower Section Row 2: Submissions to Review, Grade Distribution, Attendance by Section */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12">
                {/* Submissions to Review (4 Cols) */}
                <Card className="flex flex-col justify-between p-4 sm:p-5 lg:col-span-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <FileText className="size-4 text-amber-400" />
                      <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                        Submissions to Review
                      </h2>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col gap-2.5">
                    {reviewSubmissions.map((item: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded-xl border border-border/80 bg-card/60 px-3 py-2.5 text-xs sm:text-sm"
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="font-semibold text-foreground truncate">{item.title}</span>
                          <span className="text-[11px] text-muted-foreground truncate">{item.section}</span>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-3 py-0.5 text-[11px] font-semibold border",
                            item.variant === "destructive"
                              ? "border-rose-500/80 bg-rose-500/15 text-rose-400"
                              : "border-amber-500/80 bg-amber-500/15 text-amber-400"
                          )}
                        >
                          {item.badge}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* Grade Distribution (5 Cols) */}
                <Card className="flex flex-col justify-between p-4 sm:p-5 lg:col-span-5">
                  <div>
                    <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                      Grade distribution
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Learners per score band, all sections
                    </p>
                  </div>

                  <div className="mt-4 flex h-36 items-end justify-between gap-2 px-1">
                    {gradeDistribution.map((item: any, idx: number) => {
                      const heightPct = Math.round((item.count / maxGradeDistCount) * 85);
                      const isRed = item.variant === "destructive";
                      const isGreen = item.variant === "success";
                      return (
                        <div key={idx} className="flex flex-1 flex-col items-center gap-1.5 h-full justify-end">
                          <span className="text-[11px] font-semibold text-foreground">{item.count}</span>
                          <div
                            className={cn(
                              "w-full rounded-t-sm transition-all duration-500",
                              isRed && "bg-rose-500",
                              isGreen && "bg-emerald-400",
                              !isRed && !isGreen && "bg-amber-400"
                            )}
                            style={{ height: `${heightPct}%` }}
                          />
                          <span className="text-[11px] font-medium text-muted-foreground shrink-0">{item.band}</span>
                        </div>
                      );
                    })}
                  </div>
                </Card>

                {/* Attendance by Section (3 Cols) */}
                <Card className="flex flex-col justify-between p-4 sm:p-5 lg:col-span-3">
                  <div>
                    <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                      Attendance by section
                    </h2>
                  </div>

                  <div className="mt-3 flex flex-col justify-between gap-3">
                    {attendanceSections.map((item: any) => (
                      <div key={item.section} className="flex items-center justify-between gap-2 text-xs sm:text-sm">
                        <span className="font-medium text-foreground/90 shrink-0 w-20 truncate">{item.section}</span>
                        <div className="relative flex-1 h-3 rounded-full border border-border/80 bg-background/50 p-0.5 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-emerald-400 transition-all duration-500"
                            style={{ width: `${item.rate}%` }}
                          />
                        </div>
                        <span className="font-semibold text-foreground text-right w-10 shrink-0">{item.rate}%</span>
                      </div>
                    ))}
                  </div>

                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Last 20 school days
                  </p>
                </Card>
              </div>
            </main>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
