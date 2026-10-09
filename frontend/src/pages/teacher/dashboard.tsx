import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, AlertCircle, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Alert } from "@/components/retroui/Alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
import { Select } from "@/components/retroui/Select";
import { Progress } from "@/components/retroui/Progress";
import { OverviewCard } from "@/components/overview-cards";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { routes } from "@/../routes";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import { useTeacherClasses } from "@/hooks/use-teacher-classes";
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
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";

// Dashboard metrics stay unavailable until loaded; later-phase detail widgets retain their mockups.
const defaultTeacherCards: OverviewCardData[] = [
  {
    title: "Active Classes",
    count: "—",
    statDescription: "in the selected academic period",
  },
  {
    title: "Overall Completion",
    count: "—",
    statDescription: "across all published work",
  },
  {
    title: "Ungraded Queue",
    count: "—",
    statDescription: "pending teacher grading",
  },
  {
    title: "Current grade",
    count: "—",
    statDescription: "Weighted and transmuted, as in the class record.",
  },
  {
    title: "Passing Rate",
    count: "—",
    statDescription: "Against each subject group's passing grade. Passing grade is set per subject group.",
  },
  {
    title: "Late Submissions",
    count: "—",
    statDescription: "Late submissions, excluding excused submissions.",
  },
  {
    title: "Attendance Today",
    count: "—",
    statDescription: "Present + late / recorded entries today.",
  },
  {
    title: "Term Progress",
    count: "—",
    statDescription: "Calendar progress in the selected academic period.",
  },
];

const defaultStudentsNeedingSupport = [
  {
    grade_level: 9,
    class_id: 1,
    student_id: 1,
    prediction_id: 1,
    name: "Jose Reyes",
    section: "Archimedes · 3 missing tasks",
    score: 52,
    variant: "destructive",
  },
  {
    grade_level: 9,
    class_id: 2,
    student_id: 2,
    prediction_id: 2,
    name: "Ana Lim",
    section: "Newton · falling 12 pts",
    score: 61,
    variant: "destructive",
  },
  {
    grade_level: 9,
    class_id: 3,
    student_id: 3,
    prediction_id: 3,
    name: "Paolo Cruz",
    section: "Curie · low attendance",
    score: 68,
    variant: "warning",
  },
];

const defaultTopPerformers = [
  { name: "Maria Santos", section: "Curie · Science 9", score: 97 },
  { name: "Liam Tan", section: "Newton · Mathematics 9", score: 95 },
  { name: "Bea Garcia", section: "Archimedes · Filipino 9", score: 94 },
];

const defaultTopicMastery = [
  { topic: "Pang-uri", rate: 91, subject_id: 1, subject_name: "Filipino 9" },
  { topic: "Fractions", rate: 88, subject_id: 2, subject_name: "Mathematics 9" },
  { topic: "Cells", rate: 80, subject_id: 3, subject_name: "Science 9" },
  { topic: "Geometry", rate: 64, subject_id: 2, subject_name: "Mathematics 9" },
  { topic: "Essay writing", rate: 59, subject_id: 1, subject_name: "Filipino 9" },
];

const weekdayLabels = ["M", "T", "W", "Th", "F", "S"];
const trendAxisRange = [50, 100];

const defaultHardestQuestions = [
  {
    code: "Q7 · Simplify mixed fractions",
    quiz: "Fractions Quiz",
    rate: "34% correct",
    variant: "destructive",
  },
  {
    code: "Q3 · Parts of the cell",
    quiz: "Lab Quiz",
    rate: "48% correct",
    variant: "destructive",
  },
  {
    code: "Q5 · Uri ng pang-uri",
    quiz: "Pagsusulit 1",
    rate: "57% correct",
    variant: "warning",
  },
];

const defaultGradeDistribution = [
  { band: "<60", count: 2, variant: "destructive" },
  { band: "60-69", count: 4, variant: "warning" },
  { band: "70-79", count: 9, variant: "warning" },
  { band: "80-89", count: 13, variant: "success" },
  { band: "90-100", count: 8, variant: "success" },
];

function isPositiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function formatPercent(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? `${value}%` : "—";
}

function formatGrade(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? String(value) : "—";
}

function formatDeadline(dueDate: string | null): string {
  if (!dueDate) return "—";
  const date = new Date(dueDate);
  if (Number.isNaN(date.getTime())) return "—";
  const dateKey = (value: Date) => value.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  if (dateKey(date) === dateKey(new Date())) return "Today";
  if (dateKey(date) === dateKey(new Date(Date.now() + 24 * 60 * 60 * 1000))) return "Tomorrow";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "Asia/Manila" });
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { selectedPeriodId, isLoading: isPeriodLoading } = useAcademicPeriod();
  const { classes: loads } = useTeacherClasses({ includeAdvisory: false });

  const [data, setData] = useState<TeacherDashboardHealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const requestedPeriodId = useRef(selectedPeriodId);

  // Subject filter state for Topic Mastery
  const [subjectFilter, setSubjectFilter] = useState<string>("1");

  // Filter state for the trend chart
  const [selectedFilterKey, setSelectedFilterKey] = useState<string>("");

  // Section health display limit state
  const [showAllSectionHealth, setShowAllSectionHealth] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchDashboard() {
      setIsLoading(true);
      setError(null);
      if (requestedPeriodId.current !== selectedPeriodId) {
        requestedPeriodId.current = selectedPeriodId;
        setData(null);
        if (selectedFilterKey) {
          setSelectedFilterKey("");
          return;
        }
      }
      if (isPeriodLoading) return;
      try {
        let classId: number | undefined;
        let subjectId: number | undefined;

        if (selectedFilterKey) {
          const [cId, sId] = selectedFilterKey.split("-").map(Number);
          if (isPositiveId(cId) && isPositiveId(sId)) {
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
          if (
            !selectedFilterKey &&
            res.trend_chart.available_filters.length > 0
          ) {
            const first = res.trend_chart.available_filters[0];
            setSelectedFilterKey(`${first.class_id}-${first.subject_id}`);
          }
        }
      } catch (err: unknown) {
        if (!cancelled) {
          console.error("Failed to load teacher dashboard health:", err);
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load dashboard data",
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchDashboard();
    return () => {
      cancelled = true;
    };
  }, [selectedPeriodId, selectedFilterKey, isPeriodLoading]);

  // Derived 8 Stat Cards
  const statCards = useMemo<OverviewCardData[]>(() => {
    if (!data || isLoading || isPeriodLoading || error) return defaultTeacherCards;

    const phaseOneCards: OverviewCardData[] = [
      {
        title: "Active Classes",
        count: data.kpis?.active_classes != null ? String(data.kpis.active_classes) : "—",
        stat: data.kpis?.active_classes != null ? `${data.kpis.active_classes} sections` : undefined,
        statDescription: data.term_info?.period_name ? `in ${data.term_info.period_name}` : "in the selected academic period",
      },
      {
        title: "Overall Completion",
        count: data.kpis?.overall_completion_rate != null ? formatPercent(Math.round(data.kpis.overall_completion_rate)) : "—",
        statDescription: "across all published work",
      },
      {
        title: "Ungraded Queue",
        count: data.kpis?.ungraded_count != null ? String(data.kpis.ungraded_count) : "—",
        stat: data.kpis?.ungraded_count != null ? `${data.kpis.ungraded_count} submissions` : undefined,
        statDescription: "pending teacher grading",
      },
    ];
    const phaseTwo = data.phase_two;
    const grades = phaseTwo?.grades;
    const late = phaseTwo?.late_submissions;
    const attendance = phaseTwo?.attendance_today;
    const progress = phaseTwo?.term_progress;
    const gradeCoverage = grades
      ? `${grades.available_grade_count} of ${grades.total_grade_count} student-subject grades available`
      : undefined;
    const phaseTwoCards: OverviewCardData[] = [
      {
        title: "Current grade",
        count: formatGrade(grades?.current_grade),
        stat: gradeCoverage,
        statDescription: grades?.available_grade_count === 0
          ? "No current grades available. Weighted and transmuted, as in the class record."
          : "Weighted and transmuted, as in the class record.",
      },
      {
        title: "Passing Rate",
        count: formatPercent(grades?.passing_rate_percent),
        stat: grades?.passing_count != null
          ? `${grades.passing_count} of ${grades.available_grade_count} available grades`
          : gradeCoverage,
        statDescription: grades?.warnings.length
          ? grades.warnings.map((warning) => warning.message).join(" ")
          : "Against each subject group's passing grade.",
      },
      {
        title: "Late Submissions",
        count: formatPercent(late?.late_rate_percent),
        stat: late
          ? `${late.late_count} of ${late.eligible_count} assessed submissions · ${late.excused_excluded_count} excused excluded`
          : undefined,
        statDescription: late?.warnings.length
          ? late.warnings.map((warning) => warning.message).join(" ")
          : "Late submissions, excluding excused submissions.",
      },
      {
        title: "Attendance Today",
        count: attendance?.record_count
          ? `${attendance.present_count + attendance.late_count} / ${attendance.record_count}`
          : "—",
        stat: attendance
          ? `${attendance.late_count} late · ${attendance.absent_count} absent · ${attendance.excused_count} excused`
          : undefined,
        statDescription: "Present + late / recorded entries today.",
      },
      {
        title: "Term Progress",
        count: !progress || progress.warnings.length ? "—" : progress.week_number === 0 ? "Not started" : `Week ${progress.week_number}`,
        stat: progress ? `of ${progress.total_weeks}` : undefined,
        statDescription: progress?.warnings.length
          ? progress.warnings.map((warning) => warning.message).join(" ")
          : `Calendar progress in ${data.term_info.period_name}.`,
        progressValue: progress?.warnings.length ? undefined : progress?.progress_percent ?? undefined,
      },
    ];
    return defaultTeacherCards.map((fallback, index) => {
      const card = data.cards?.find((item) => item.title === fallback.title) ??
        (index < phaseOneCards.length ? phaseOneCards[index] : phaseTwoCards[index - phaseOneCards.length]);
      if (card.title === "Current grade" && grades?.available_grade_count === 0) {
        return { ...card, statDescription: `No current grades available. Weighted and transmuted, as in the class record. ${grades.warnings.map((warning) => warning.message).join(" ")}`.trim() };
      }
      return card.title === "Passing Rate"
        ? { ...card, statDescription: `${card.statDescription ?? ""} Passing grade is set per subject group.`.trim() }
        : card;
    });
  }, [data, isLoading, isPeriodLoading, error]);

  // Derive unique subjects from teacher's loads / available filters
  const subjects = useMemo(() => {
    if (loads && loads.length > 0) {
      return Array.from(
        new Map(
          loads.map((load) => [
            load.subject_id,
            { id: load.subject_id, name: load.subject_name },
          ]),
        ).values(),
      ).sort((a, b) => a.name.localeCompare(b.name));
    }
    if (data?.trend_chart?.available_filters?.length) {
      const map = new Map<number, { id: number; name: string }>();
      data.trend_chart.available_filters.forEach((f) => {
        if (f.subject_id && f.subject_name) {
          map.set(f.subject_id, { id: f.subject_id, name: f.subject_name });
        }
      });
      return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    }
    return [
      { id: 1, name: "Filipino 9" },
      { id: 2, name: "Mathematics 9" },
      { id: 3, name: "Science 9" },
    ];
  }, [loads, data]);

  // Keep subjectFilter synced to first valid subject
  useEffect(() => {
    if (
      subjects.length > 0 &&
      (!subjectFilter || !subjects.some((s) => String(s.id) === subjectFilter))
    ) {
      setSubjectFilter(String(subjects[0].id));
    }
  }, [subjects, subjectFilter]);

  const studentsSupport =
    data?.details?.students_needing_support || defaultStudentsNeedingSupport;
  const topPerformers = data?.details?.top_performers || defaultTopPerformers;
  const dueWeek = data?.action_queue?.upcoming_deadlines ?? [];
  const trendPoints = isLoading || isPeriodLoading || error ? [] : data?.trend_chart.points ?? [];
  const rawTopicMastery = data?.details?.topic_mastery || defaultTopicMastery;
  const topicMastery = useMemo(() => {
    if (subjectFilter === "all") return rawTopicMastery;
    return rawTopicMastery.filter((item: any) => {
      if (item.subject_id !== undefined) {
        return String(item.subject_id) === subjectFilter;
      }
      if (item.subject_name) {
        const activeSub = subjects.find((s) => String(s.id) === subjectFilter);
        return activeSub
          ? item.subject_name.toLowerCase().includes(activeSub.name.toLowerCase())
          : true;
      }
      return true;
    });
  }, [rawTopicMastery, subjectFilter, subjects]);
  const visiblePhaseTwo = isLoading || isPeriodLoading || error ? undefined : data?.phase_two;
  const submissionsWeekday = weekdayLabels.map((day, dayIndex) => ({
    day,
    count: visiblePhaseTwo?.weekdays.days.find((item) => item.day_index === dayIndex)?.count ?? null,
    isHighlight: dayIndex === 4,
  }));
  const hardestQuestions =
    data?.details?.hardest_questions || defaultHardestQuestions;
  const reviewSubmissions = (data?.action_queue?.pending_grading ?? []).map((item) => ({
    ...item,
    title: item.classwork_title,
    section: [item.student_name, item.section_name].filter(Boolean).join(" · "),
    badge: "Needs grading",
    variant: "destructive",
  }));
  const gradeDistribution =
    data?.details?.grade_distribution || defaultGradeDistribution;
  const attendanceSections = isLoading || isPeriodLoading || error ? [] : data?.details?.attendance_by_section ?? [];

  const maxWeekdayCount = Math.max(
    ...submissionsWeekday.map((item) => item.count ?? 0),
    45,
  );
  const maxGradeDistCount = Math.max(
    ...gradeDistribution.map((g: any) => g.count),
    15,
  );

  const emptyMessage = (message: string) =>
    isLoading || isPeriodLoading ? "Loading dashboard data..." : error ? "Dashboard data is unavailable." : message;

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
                  {/* 1. Students Support, Top Performers, Due this Week, Topic Mastery */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/* Students needing support */}
                    <Card className="flex flex-col justify-between p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between">
                        <Card.Title className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                          Students Needing Support
                        </Card.Title>
                        <Tooltip >
                          <TooltipTrigger
                            render={
                              <Button
                                variant="secondary"
                                size="sm"
                                autoIcon={false}
                                onClick={() => navigate(routes.teacher.predictions)}
                                className="text-foreground shadow-none px-1.5"
                              >
                                <ArrowUpRight className="size-4" />
                              </Button>
                            }
                          />
                          <TooltipContent side="right">View at risk students</TooltipContent>
                        </Tooltip>
                      </Card.Header>

                      <Card.Content className="mt-1 flex flex-col gap-2.5 p-0">
                        {studentsSupport.map((s: any, idx: number) => (
                          <Card
                            key={idx}
                            onClick={() => {
                              if (!data?.details?.students_needing_support || !isPositiveId(s.grade_level) || !isPositiveId(s.class_id)) return;
                              const grade = s.grade_level;
                              const classId = s.class_id;
                              const params = new URLSearchParams();
                              if (s.prediction_id) params.set("predictionId", String(s.prediction_id));
                              if (s.student_id) params.set("studentId", String(s.student_id));
                              if (s.name) params.set("studentName", s.name);
                              navigate(`/teacher/predictions/${grade}/${classId}?${params.toString()}`);
                            }}
                            className="flex items-center justify-between shadow-none rounded px-3 py-2.5 text-xs sm:text-sm cursor-pointer hover:bg-retro hover:-translate-y-1"
                          >
                            <div className="flex flex-col min-w-0 pr-2">
                              <span className="font-semibold text-foreground truncate">
                                {s.name}
                              </span>
                              <span className="text-xs text-muted-foreground truncate">
                                {s.section}
                              </span>
                            </div>
                            <Badge
                              size="sm"
                              variant={
                                s.variant === "destructive" || s.score <= 65
                                  ? "destructive"
                                  : "default"
                              }
                              className="shrink-0"
                            >
                              {s.score}%
                            </Badge>
                          </Card>
                        ))}

                      </Card.Content>
                    </Card>
                    {/* Submissions to Review */}
                    <Card className="flex flex-col justify-between p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between">
                        <Card.Title className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                          Submissions to Review
                        </Card.Title>
                        <Tooltip >
                          <TooltipTrigger

                            render={
                              <Button
                                variant="secondary"
                                size="sm"
                                autoIcon={false}
                                onClick={() => navigate(routes.teacher.classworks)}
                                className="text-foreground shadow-none px-1.5"
                              >
                                <ArrowUpRight className="size-4" />
                              </Button>
                            }
                          />
                          <TooltipContent side="right">View classworks</TooltipContent>
                        </Tooltip>
                      </Card.Header>

                      <Card.Content className="mt-1 flex flex-col gap-2.5 p-0">
                        {reviewSubmissions.length === 0 && (
                          <Card.Description className="text-xs text-muted-foreground">
                            {emptyMessage("No submissions need grading.")}
                          </Card.Description>
                        )}
                        {reviewSubmissions.map((item) => (
                          <Card
                            key={item.submission_id}
                            onClick={() => {
                              if (isPositiveId(item.classwork_id)) navigate(`/teacher/classworks/${item.classwork_id}`);
                            }}
                            className="flex cursor-pointer items-center justify-between shadow-none rounded px-3 py-2.5 text-xs sm:text-sm transition-all hover:-translate-y-0.5 hover:bg-retro"
                          >
                            <div className="flex flex-col min-w-0 pr-2">
                              <span className="font-semibold text-foreground truncate">
                                {item.title}
                              </span>
                              <span className="text-[11px] text-muted-foreground truncate">
                                {item.section}
                              </span>
                            </div>
                            <Badge
                              size="sm"
                              variant={
                                item.variant === "destructive"
                                  ? "destructive"
                                  : "default"
                              }
                              className="shrink-0"
                            >
                              {item.badge}
                            </Badge>
                          </Card>
                        ))}
                      </Card.Content>
                    </Card>
                  </div>

                  {/* 2. Mastery & Completion Trend Chart */}
                  <Card className="flex flex-col justify-between p-4 sm:p-5">
                    <Card.Header className="p-0">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
                        <div>
                          <Card.Title className="text-base font-bold sm:text-lg">
                            Classwork Mastery & Completion Trend
                          </Card.Title>
                        </div>

                        {data &&
                          data.trend_chart.available_filters.length > 0 && (
                            <div className="flex items-center gap-1.5 sm:w-auto">
                              <Select
                                value={selectedFilterKey}
                                onValueChange={setSelectedFilterKey}
                              >
                                <Select.Trigger
                                  id="trend-filter"
                                  className="h-8 text-xs font-semibold sm:min-w-44 shadow-none"
                                >
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
                      <div className="flex flex-wrap items-center gap-4 mb-1 text-xs text-muted-foreground font-medium">
                        <div className="flex items-center gap-1.5">
                          <span className="size-2.5 rounded-full bg-primary inline-block" />
                          <span className="text-foreground">
                            Class Mastery Average (%)
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="size-2.5 rounded-full bg-muted inline-block" />
                          <span className="text-foreground">
                            Submission Completion (%)
                          </span>
                        </div>
                      </div>
                    </Card.Header>

                    {/* Line Chart Body */}
                    <Card.Content className="h-52 w-full p-0 pb-4">
                      <ResponsiveContainer width="100%" height="100%" className="-mx-2 text-foreground!">
                        <LineChart
                          data={trendPoints}
                          margin={{ top: 10, right: 15, left: -20, bottom: 0 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="var(--muted-foreground)"
                            strokeOpacity={0.4}
                          />
                          <XAxis
                            dataKey="short_label"
                            tickLine={false}
                            axisLine={{
                              stroke: "var(--foreground)",
                              strokeWidth: 1,
                            }}
                            tick={{ fontSize: 11, fontWeight: 500, fill: "var(--foreground)" }}
                          />
                          <YAxis
                            domain={trendAxisRange}
                            ticks={[trendAxisRange[0], (trendAxisRange[0] + trendAxisRange[1]) / 2, trendAxisRange[1]]}
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
                                    {point.title || point.short_label}
                                  </p>
                                  <p className="text-emerald-400 font-semibold">
                                    Mastery: {formatPercent(point.avg_score_percent)}
                                  </p>
                                  <p className="text-amber-400 font-semibold">
                                    Completion: {formatPercent(point.completion_rate_percent)}
                                  </p>
                                </div>
                              );
                            }}
                          />
                          <Line
                            type="monotone"
                            dataKey="avg_score_percent"
                            name="Mastery %"
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
                            dataKey="completion_rate_percent"
                            name="Completion %"
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
                        {trendPoints.length
                          ? "Class score averages vs. task submission completion"
                          : emptyMessage("No published classwork for this selection.")}
                      </Card.Description>
                    </Card.Content>
                  </Card>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/* Topic mastery */}
                    <Card className="flex flex-col p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0 flex flex-col gap-2">
                        <div className="flex flex-row items-center justify-between">
                          <Card.Title className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                            Lesson Mastery
                          </Card.Title>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  autoIcon={false}
                                  onClick={() => {
                                    const activeSubjectId = Number(subjectFilter);
                                    const activeClassId =
                                      loads.find((l) => String(l.subject_id) === String(activeSubjectId))?.class_id ||
                                      data?.trend_chart?.available_filters?.find((f) => String(f.subject_id) === String(activeSubjectId))?.class_id;
                                    if (isPositiveId(activeSubjectId) && isPositiveId(activeClassId)) {
                                      navigate(`/teacher/classes/${activeClassId}/subjects/${activeSubjectId}`);
                                    }
                                  }}
                                  className="text-foreground shadow-none px-1.5"
                                >
                                  <ArrowUpRight className="size-4" />
                                </Button>
                              }
                            />
                            <TooltipContent side="right">View subject</TooltipContent>
                          </Tooltip>
                        </div>

                        <div className="flex flex-row flex-wrap items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                          {subjects.map((subject) => (
                            <Button
                              key={subject.id}
                              autoIcon={false}
                              variant={
                                subjectFilter === String(subject.id)
                                  ? "default"
                                  : "outline"
                              }
                              size="sm"
                              onClick={() => setSubjectFilter(String(subject.id))}
                              className="shrink-0 border-black shadow-none text-[11px] px-2 py-0.5"
                            >
                              {subject.name}
                            </Button>
                          ))}
                        </div>
                      </Card.Header>

                      <Card.Content className="flex flex-col justify-between gap-2.5 p-0 justify-between h-full">
                        <div className="flex flex-col gap-2.5 ">
                          {topicMastery.slice(0, 5).map((item: any) => (
                            <div
                              key={item.topic}
                              className="flex items-center justify-between gap-3 text-xs sm:text-sm"
                            >
                              <span className="font-medium text-foreground/90 shrink-0 w-24 truncate">
                                {item.topic}
                              </span>
                              <Progress value={item.rate} className="h-2.5 flex-1" />
                              <span className="font-semibold text-foreground text-right w-10 shrink-0">
                                {item.rate}%
                              </span>
                            </div>
                          ))}
                        </div>

                        <Card.Description className="text-[11px] text-muted-foreground">
                          Lowest topics may need reteaching
                        </Card.Description>
                      </Card.Content>

                    </Card>

                    {/* Due this week */}
                    <Card className="flex flex-col justify-between p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between">
                        <Card.Title className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                          Due this week
                        </Card.Title>
                        <Tooltip >
                          <TooltipTrigger

                            render={
                              <Button
                                variant="secondary"
                                size="sm"
                                autoIcon={false}
                                onClick={() => navigate(routes.teacher.classworks)}
                                className="text-foreground shadow-none px-1.5"
                              >
                                <ArrowUpRight className="size-4" />
                              </Button>
                            }
                          />
                          <TooltipContent side="right">View classworks</TooltipContent>
                        </Tooltip>
                      </Card.Header>

                      <Card.Content className="mt-1 flex flex-col gap-2.5 p-0">
                        {dueWeek.length === 0 && (
                          <Card.Description className="text-xs text-muted-foreground">
                            {emptyMessage("No classwork due this week.")}
                          </Card.Description>
                        )}
                        {dueWeek.map((d, idx) => (
                          <Card
                            key={idx}
                            onClick={() => {
                              if (isPositiveId(d.classwork_id)) navigate(`/teacher/classworks/${d.classwork_id}`);
                            }}
                            className="flex items-center justify-between shadow-none rounded px-3 py-2.5 text-xs sm:text-sm cursor-pointer hover:bg-retro hover:-translate-y-1"
                          >
                            <div className="flex flex-col min-w-0 pr-2">
                              <span className="font-semibold text-foreground truncate">
                                {d.title}
                              </span>
                              <span className="text-[11px] text-muted-foreground truncate">
                                {d.section_name}
                              </span>
                            </div>
                            <Badge
                              size="sm"
                              variant={formatDeadline(d.due_date) === "Tomorrow" ? "destructive" : "default"}
                              className="shrink-0"
                            >
                              {formatDeadline(d.due_date)}
                            </Badge>
                          </Card>
                        ))}
                      </Card.Content>
                    </Card>
                  </div>

                  {/* 3. Section-by-Section Health */}
                  <Card className="flex flex-col justify-between p-4 sm:p-5">
                    <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between">
                      <Card.Title className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                        Section-by-Section Health
                      </Card.Title>
                      <Tooltip >
                        <TooltipTrigger
                          render={
                            <Button
                              variant="secondary"
                              size="sm"
                              autoIcon={false}
                              onClick={() => navigate(routes.teacher.classes)}
                              className="text-foreground shadow-none px-1.5"
                            >
                              <ArrowUpRight className="size-4" />
                            </Button>
                          }
                        />
                        <TooltipContent side="right">View all sections</TooltipContent>
                      </Tooltip>
                    </Card.Header>

                    <Card.Content className="mt-1 flex flex-col gap-3 p-0">
                      {(() => {
                        const sections = data?.section_matrix ?? [];
                        const displayed = showAllSectionHealth ? sections : sections.slice(0, 2);

                        return (
                          <>
                            {sections.length === 0 && (
                              <Card.Description className="text-xs text-muted-foreground">
                                {emptyMessage("No classes for this academic period.")}
                              </Card.Description>
                            )}
                            {displayed.map((sec: any, idx: number) => (
                              <Card
                                key={idx}
                                className="shadow-none p-4 text-xs hover:bg-retro hover:-translate-y-1 cursor-pointer transition-all"
                                onClick={() => {
                                  if (isPositiveId(sec.class_id) && isPositiveId(sec.subject_id)) {
                                    navigate(`/teacher/classes/${sec.class_id}/${sec.subject_id}`);
                                  }
                                }}
                              >
                                <div className="flex items-center justify-between mb-4">
                                  <div className="flex items-center gap-3">
                                    <span className="font-bold text-xl text-foreground">
                                      {sec.section_name}
                                    </span>
                                    <Badge
                                      variant="secondary"
                                      size="sm"
                                      className="px-1.5 py-0.5"
                                    >
                                      {sec.subject_name}
                                    </Badge>
                                  </div>
                                  <span className="font-semibold text-xs text-muted-foreground">
                                    {sec.student_count} Students
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
                                        {formatPercent(sec.completion_rate_percent)}
                                      </span>
                                    </div>
                                    <Progress
                                      value={sec.completion_rate_percent}
                                      className="h-2"
                                    />
                                  </div>

                                  <div className="space-y-1">
                                    <div className="flex justify-between text-sm">
                                      <span className="text-foreground">
                                        Attendance
                                      </span>
                                      <span className="font-semibold">
                                        {formatPercent(sec.attendance_rate_percent)}
                                      </span>
                                    </div>
                                    <Progress
                                      value={sec.attendance_rate_percent}
                                      className="h-2"
                                    />
                                  </div>
                                </div>

                                {/* Bottom Info Bar */}
                                <div className="flex items-center justify-between text-sm text-muted-foreground pt-2">
                                  <div className="flex items-center gap-4">
                                    <span className="text-foreground font-semibold">
                                      Current grade:{" "}
                                      <Badge
                                        variant={
                                          sec.current_grade_meets_threshold === false
                                            ? "destructive"
                                            : sec.current_grade_meets_threshold === true
                                              ? "success"
                                              : "surface"
                                        }
                                        size="sm"
                                        className="ml-1"
                                        title={sec.passing_threshold != null
                                          ? `Passing grade is set per subject group: ${sec.passing_threshold}. Compared before display rounding.`
                                          : "Passing grade is set per subject group; unavailable for this section."}
                                      >
                                        {formatGrade(sec.current_grade)}
                                      </Badge>
                                    </span>
                                    <span className="text-foreground font-semibold">
                                      Passing Rate:{" "}
                                      <Badge
                                        variant="surface"
                                        size="sm"
                                        className="ml-1"
                                      >
                                        {formatPercent(sec.passing_rate_percent)}
                                      </Badge>
                                    </span>
                                  </div>
                                  <span className="text-foreground">
                                    <span className="text-foreground font-bold mr-1">
                                      {sec.published_classworks}
                                    </span>
                                    published tasks
                                  </span>
                                </div>
                                <Card.Description className="text-xs text-muted-foreground">
                                  {sec.available_grade_count != null && sec.total_grade_count != null
                                    ? `${sec.available_grade_count} of ${sec.total_grade_count} student-subject grades available. `
                                    : ""}
                                  Weighted and transmuted, as in the class record. Passing grade is set per subject group.
                                  {sec.warnings?.map((warning: { code: string; message: string }) => (
                                    <span key={warning.code}> {warning.message}</span>
                                  ))}
                                </Card.Description>
                              </Card>
                            ))}
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
                              <Card.Description className="text-xs text-muted-foreground">
                                Performance, completion, and attendance across your classes
                              </Card.Description>
                              {sections.length > 2 && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  autoIcon={false}
                                  onClick={() => setShowAllSectionHealth((prev) => !prev)}
                                  className="self-end sm:self-auto text-xs font-semibold px-2.5 py-1 h-7 text-foreground shadow-none"
                                >
                                  {showAllSectionHealth ? "Show less" : "Show all classes"}
                                </Button>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </Card.Content>
                  </Card>

                  {/* 4. Submissions by weekday & Hardest questions */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/* Submissions by weekday */}
                    <Card className="flex flex-col justify-between p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0">
                        <Card.Title className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                          Submissions by weekday
                        </Card.Title>
                        <Card.Description className="mt-0.5 text-xs text-muted-foreground">
                          Selected period · Manila time · Sunday: {visiblePhaseTwo?.weekdays.sunday_count ?? "—"}.
                          {visiblePhaseTwo?.weekdays.warnings.map((warning) => <span key={warning.code}> {warning.message}</span>)}
                        </Card.Description>
                      </Card.Header>

                      <Card.Content className="mt-4 flex flex-col justify-between gap-2.5 p-0">
                        {submissionsWeekday.map((item, idx: number) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between gap-3 text-xs sm:text-sm"
                          >
                            <span className="font-medium text-foreground/90 shrink-0 w-10 truncate">
                              {item.day}
                            </span>
                            <Progress
                              value={Math.round(
                                ((item.count ?? 0) / maxWeekdayCount) * 100,
                              )}
                              className={cn(
                                "h-3 flex-1",
                                item.isHighlight && "[&>div]:bg-success",
                              )}
                            />
                            <span className="font-semibold text-foreground text-right w-8 shrink-0">
                              {item.count ?? "—"}
                            </span>
                          </div>
                        ))}
                      </Card.Content>
                    </Card>

                    {/* Top performers */}
                    <Card className="flex flex-col justify-between p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0">
                        <Card.Title className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                          Top Performers
                        </Card.Title>
                      </Card.Header>

                      <Card.Content className="mt-1 flex flex-col gap-2.5 p-0">
                        {topPerformers.map((p: any, idx: number) => (
                          <Card
                            key={idx}
                            className="flex items-center justify-between shadow-none rounded px-3 py-2.5 text-xs sm:text-sm"
                          >
                            <div className="flex flex-col min-w-0 pr-2">
                              <span className="font-semibold text-foreground truncate">
                                {p.name}
                              </span>
                              <span className="text-[11px] text-muted-foreground truncate">
                                {p.section}
                              </span>
                            </div>
                            <Badge size="sm" variant="success" className="shrink-0">
                              {p.score}%
                            </Badge>
                          </Card>
                        ))}
                      </Card.Content>
                    </Card>

                    {/* Grade Distribution */}
                    <Card className="flex flex-col justify-between p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0">
                        <Card.Title className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                          Grade distribution
                        </Card.Title>
                        <Card.Description className="mt-0.5 text-xs text-muted-foreground">
                          Learners per score band, all sections
                        </Card.Description>
                      </Card.Header>

                      <Card.Content className="mt-4 flex flex-col justify-between gap-2.5 p-0">
                        {gradeDistribution.map((item: any, idx: number) => {
                          const isRed = item.variant === "destructive";
                          const isGreen = item.variant === "success";
                          return (
                            <div
                              key={idx}
                              className="flex items-center justify-between gap-3 text-xs sm:text-sm"
                            >
                              <span className="font-medium text-foreground/90 shrink-0 w-14 truncate">
                                {item.band}
                              </span>
                              <Progress
                                value={Math.round(
                                  (item.count / maxGradeDistCount) * 100,
                                )}
                                className={cn(
                                  "h-3 flex-1",
                                  isRed && "[&>div]:bg-destructive",
                                  isGreen && "[&>div]:bg-success",
                                )}
                              />
                              <span className="font-semibold text-foreground text-right w-8 shrink-0">
                                {item.count}
                              </span>
                            </div>
                          );
                        })}
                      </Card.Content>
                    </Card>

                    {/* Attendance by Section */}
                    <Card className="flex flex-col justify-between p-4 sm:p-5 sm:col-span-2 xl:col-span-1">
                      <Card.Header className="mb-0 p-0">
                        <Card.Title className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                          Attendance by section
                        </Card.Title>
                      </Card.Header>

                      <Card.Content className="mt-3 flex flex-col justify-between gap-3 p-0">
                        {attendanceSections.every((item) => item.record_count === 0) && (
                          <Card.Description className="text-xs text-muted-foreground">
                            {emptyMessage("No attendance records this month for the selected period.")}
                          </Card.Description>
                        )}
                        {attendanceSections.map((item) => (
                          <div
                            key={item.class_id}
                            className="flex items-center justify-between gap-2 text-xs sm:text-sm"
                            title={`${item.record_count} recorded ${item.record_count === 1 ? "entry" : "entries"}.`}
                          >
                            <span className="font-medium text-foreground/90 shrink-0 w-20 truncate">
                              {item.section}
                            </span>
                            <Progress value={item.rate ?? 0} className="h-3 flex-1" />
                            <span className="font-semibold text-foreground text-right w-10 shrink-0">
                              {formatPercent(item.rate)}
                            </span>
                          </div>
                        ))}
                      </Card.Content>
                      <Card.Description className="mt-3 text-[11px] text-muted-foreground">
                        This month · Present + late / recorded entries. Excused and absent do not count as present.
                      </Card.Description>
                    </Card>
                  </div>
                </div>

                {/* Right Column: All Overview Cards */}
                <div className="flex min-w-0 flex-col gap-3.5 lg:col-span-3 xl:col-span-3">
                  <div className="grid grid-cols-1 gap-3.5">
                    {isLoading && !data
                      ? Array.from({ length: defaultTeacherCards.length }).map((_, i) => (
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
                </div>
              </div>
            </main>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
