import { useEffect, useState, useMemo, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, AlertCircle, ArrowUpRight, BookOpen, CheckCircle } from "lucide-react";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/teacher/button";
import { Badge } from "@/components/retroui/Badge";
import { Alert } from "@/components/retroui/Alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { Select } from "@/components/retroui/Select";
import { Progress } from "@/components/retroui/Progress";
import { OverviewCard } from "@/components/overview-cards";
import { Skeleton } from "@/components/retroui/Skeleton";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { routes } from "@/../routes";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import {
  getTeacherDashboardHealth,
  type TeacherDashboardHealthResponse,
  type TeacherDashboardHealthFilter,
  type TeacherDashboardWarning,
  type OverviewCardData,
} from "@/lib/api";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";

const defaultTeacherCards: OverviewCardData[] = [
  {
    title: "Active Classes",
    count: "—",
    statDescription: "in the selected academic period",
  },
  {
    title: "Improved Prediction Resolution Rate",
    count: "—",
    statDescription: "Interventions resolved via improved prediction in the selected period.",
  },
  {
    title: "Submission Rate",
    count: "—",
    statDescription: "across eligible submission-requiring work",
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
    statDescription: "Against each subject's grading template passing grade. Passing grade is set by the subject grading template.",
  },
  {
    title: "Late Submissions",
    count: "—",
    statDescription: "Late submissions, excluding excused submissions.",
  },
  {
    title: "Term Progress",
    count: "—",
    statDescription: "Calendar progress in the selected academic period.",
  },
];

const weekdayLabels = ["M", "T", "W", "Th", "F", "S"];
const trendAxisRange = [50, 100];

function isPositiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function formatPercent(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? `${value}%` : "—";
}

function formatGrade(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? String(value) : "—";
}

function uniqueDashboardWarnings(
  warnings: TeacherDashboardWarning[] | undefined,
): TeacherDashboardWarning[] {
  return [...new Map(
    (warnings ?? []).map((warning) => [`${warning.code}:${warning.message}`, warning]),
  ).values()];
}

function formatDashboardDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function DashboardQueueSkeleton({ label }: { label: string }) {
  return (
    <Card className="@container/card flex animate-pulse flex-col gap-3 p-4 sm:p-5" role="status" aria-label={`Loading ${label}`} aria-busy="true">
      <div className="flex items-center justify-between gap-3" aria-hidden="true">
        <div className="h-5 w-2/3 bg-muted text-transparent" />
        <div className="size-8 shrink-0 bg-muted text-transparent" />
      </div>
      <div className="flex flex-col gap-2.5" aria-hidden="true">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="h-4 w-3/4 bg-muted text-transparent" />
              <div className="h-3 w-1/2 bg-muted text-transparent" />
            </div>
            <div className="h-5 w-16 shrink-0 bg-muted text-transparent" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const {
    selectedPeriodId,
    selectedYearId,
    selectedYear,
    selectedPeriod,
    periods,
    isLoading: isPeriodLoading,
  } = useAcademicPeriod();

  const [data, setData] = useState<TeacherDashboardHealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const requestedPeriodId = useRef(selectedPeriodId);
  const requestedYearId = useRef(selectedYearId);
  const requestIdRef = useRef(0);
  const [dashboardClass, setDashboardClass] = useState("all");
  const [dashboardSubject, setDashboardSubject] = useState("all");
  const [dashboardFilters, setDashboardFilters] = useState<TeacherDashboardHealthFilter[]>([]);
  const classOptions = [...new Map(dashboardFilters.map(item => [item.class_id, item])).values()];
  const subjectOptions = [...new Map(dashboardFilters
    .filter(item => dashboardClass === "all" || String(item.class_id) === dashboardClass)
    .map(item => [item.subject_id, item])).values()];
  const changeDashboardScope = (classValue: string, subjectValue: string) => {
    setIsLoading(true);
    setData(null);
    setDashboardClass(classValue);
    setDashboardSubject(subjectValue);
    setSelectedFilterKey("");
    setSubjectFilter("");
    setShowAllSectionHealth(false);
  };

  // Only real selected-period subjects can become a lesson filter.
  const [subjectFilter, setSubjectFilter] = useState<string>("");

  // Filter state for the trend chart
  const [selectedFilterKey, setSelectedFilterKey] = useState<string>("");

  // Section health display limit state
  const [showAllSectionHealth, setShowAllSectionHealth] = useState<boolean>(false);

  const hasNoPeriods = !isPeriodLoading && selectedYearId != null && periods.length === 0;

  useEffect(() => {
    let cancelled = false;

    async function fetchDashboard() {
      setIsLoading(true);
      setError(null);
      if (
        requestedPeriodId.current !== selectedPeriodId ||
        requestedYearId.current !== selectedYearId
      ) {
        requestedPeriodId.current = selectedPeriodId;
        requestedYearId.current = selectedYearId;
        setData(null);
        setDashboardFilters([]);
        setDashboardClass("all");
        setDashboardSubject("all");
        setSubjectFilter("");
        if (selectedFilterKey || dashboardClass !== "all" || dashboardSubject !== "all") {
          setSelectedFilterKey("");
          return;
        }
      }

      if (hasNoPeriods) {
        setData(null);
        setIsLoading(false);
        setError(null);
        return;
      }

      if (isPeriodLoading || (selectedYearId != null && periods.length > 0 && selectedPeriodId == null)) {
        return;
      }

      const currentRequestId = ++requestIdRef.current;

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
          academic_year_id: selectedYearId ?? undefined,
          academic_period_id: selectedPeriodId ?? undefined,
          class_id: classId,
          subject_id: subjectId,
          ...(dashboardClass !== "all" ? { dashboard_class_id: Number(dashboardClass) } : {}),
          ...(dashboardSubject !== "all" ? { dashboard_subject_id: Number(dashboardSubject) } : {}),
        });

        if (!cancelled && currentRequestId === requestIdRef.current) {
          setData(res);
          setDashboardFilters(res.dashboard_filters ?? res.trend_chart.available_filters);
          if (!selectedFilterKey && res.trend_chart.available_filters.length > 0) {
            const first = res.trend_chart.available_filters[0];
            setSelectedFilterKey(`${first.class_id}-${first.subject_id}`);
          }
        }
      } catch (err: unknown) {
        if (!cancelled && currentRequestId === requestIdRef.current) {
          console.error("Failed to load teacher dashboard health:", err);
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load dashboard data",
          );
        }
      } finally {
        if (!cancelled && currentRequestId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    }

    fetchDashboard();
    return () => {
      cancelled = true;
    };
  }, [
    selectedPeriodId,
    selectedYearId,
    selectedFilterKey,
    isPeriodLoading,
    dashboardClass,
    dashboardSubject,
    hasNoPeriods,
    periods.length,
  ]);

  const isHistorical = Boolean(
    (selectedYear && !selectedYear.is_active) ||
    (selectedPeriod && !selectedPeriod.is_active) ||
    (data?.term_info && data.term_info.is_active === false)
  );

  const isDataMatchingPeriod =
    data != null &&
    !isLoading &&
    !isPeriodLoading &&
    !error &&
    (selectedPeriodId == null || data.term_info?.period_id === selectedPeriodId) &&
    (selectedYearId == null || data.term_info?.academic_year_id == null || data.term_info.academic_year_id === selectedYearId);

  // Derived 8 Stat Cards (Original right-sidebar metrics with Improved Prediction Resolution Rate and Submission Rate, without Attendance Today)
  const statCards = useMemo<OverviewCardData[]>(() => {
    if (!data || isLoading || isPeriodLoading || error || !isDataMatchingPeriod) return defaultTeacherCards;

    const interventionResolution =
      data.details?.intervention_resolution ?? data.phase_two?.intervention_resolution;

    const phaseOneCards: OverviewCardData[] = [
      {
        title: "Active Classes",
        count: data.kpis?.active_classes != null ? String(data.kpis.active_classes) : "—",
        stat: data.kpis?.active_classes != null ? `${data.kpis.active_classes} sections` : undefined,
        statDescription: data.term_info?.period_name ? `in ${data.term_info.period_name}` : "in the selected academic period",
      },
      {
        title: "Improved Prediction Resolution Rate",
        count: formatPercent(interventionResolution?.improved_prediction_resolution_rate_percent),
        stat: interventionResolution
          ? interventionResolution.eligible_count > 0
            ? `${interventionResolution.resolved_improved_count} of ${interventionResolution.eligible_count} active & resolved`
            : "No active or resolved interventions"
          : undefined,
        statDescription: "Interventions resolved via improved prediction in the selected period.",
      },
      {
        title: "Submission Rate",
        count: data.kpis?.overall_completion_rate != null ? formatPercent(Math.round(data.kpis.overall_completion_rate)) : "—",
        statDescription: "across eligible submission-requiring work",
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
    const progress = phaseTwo?.term_progress;
    const gradeCoverage = grades
      ? `${grades.available_grade_count} of ${grades.total_grade_count} student-subject grades available.`
      : undefined;
    const phaseTwoCards: OverviewCardData[] = [
      {
        title: "Current grade",
        count: formatGrade(grades?.current_grade),
        stat: gradeCoverage,
        statDescription: grades?.available_grade_count === 0
          ? "No current grades available."
          : "Weighted and transmuted, as in the class record.",
      },
      {
        title: "Passing Rate",
        count: formatPercent(grades?.passing_rate_percent),
        stat: grades?.passing_count != null
          ? `${grades.passing_count} of ${grades.available_grade_count} available grades pass.`
          : gradeCoverage,
        statDescription: grades?.warnings.length
          ? grades.warnings.map((warning) => warning.message).join(" ")
          : "Passing grade is set by the subject grading template.",
      },
      {
        title: "Late Submissions",
        count: formatPercent(late?.late_rate_percent),
        stat: late?.evaluable_count
          ? `${late.late_count} of ${late.evaluable_count} evaluable submissions are late.`
          : late?.eligible_count
            ? "No submissions have complete lateness data."
            : "No eligible submissions in the selected period.",
        statDescription: late
          ? `${late.excused_excluded_count} excused ${late.excused_excluded_count === 1 ? "submission" : "submissions"} excluded.${late.unevaluable_count ? ` ${late.unevaluable_count} ${late.unevaluable_count === 1 ? "submission was" : "submissions were"} omitted because required dates are missing.` : ""} ${uniqueDashboardWarnings(late.warnings).map((warning) => warning.message).join(" ") || "Lateness uses recorded submission and deadline timestamps."}`.trim()
          : undefined,
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
      if (card.title === "Improved Prediction Resolution Rate") {
        return phaseOneCards[1];
      }
      if (data.engagement && ["Submission Rate", "Ungraded Queue"].includes(card.title)) {
        const summary = data.engagement;
        const isSubmissionRate = card.title === "Submission Rate";
        return {
          ...card,
          count: isSubmissionRate ? formatPercent(summary.completion_rate_percent == null ? null : Math.round(summary.completion_rate_percent))
            : summary.pending_grading_count == null ? "—" : String(summary.pending_grading_count),
          stat: isSubmissionRate
            ? summary.completed_count == null ? `${summary.resolved_completed_count} resolved of ${summary.expected_count} expected.`
              : `${summary.completed_count} of ${summary.expected_count} submitted.`
            : summary.pending_grading_count == null ? `${summary.resolved_pending_grading_count} resolved submissions.`
              : `${summary.pending_grading_count} submissions.`,
          statDescription: `${isSubmissionRate
            ? "Selected-period eligible student-task submission requirements; unique latest completed attempts."
            : "Latest completed attempts pending teacher grading."} ${summary.warnings.map((warning) => warning.message).join(" ")}`.trim(),
        };
      }
      if (["Current grade", "Passing Rate", "Late Submissions"].includes(card.title)) {
        const metric = phaseTwoCards[index - phaseOneCards.length];
        const backendWarning = card.title === "Passing Rate" && !grades?.warnings.length && card.count === "—" && card.statDescription &&
          card.statDescription !== metric.statDescription ? card.statDescription : undefined;
        return {
          ...card,
          stat: card.title === "Passing Rate" && card.count === "—" ? gradeCoverage : metric.stat,
          statDescription: backendWarning ?? (card.title === "Current grade" && grades?.warnings.length
            ? `${metric.statDescription} ${grades.warnings.map((warning) => warning.message).join(" ")}`
            : metric.statDescription),
        };
      }
      return card;
    });
  }, [data, isLoading, isPeriodLoading, error, isDataMatchingPeriod]);

  const lessonPerformance = !isDataMatchingPeriod
    ? undefined : data?.details?.lesson_performance;
  const subjects = useMemo(() => lessonPerformance?.subjects ?? [], [lessonPerformance]);
  const lessonSubject = subjects.find((subject) => String(subject.subject_id) === subjectFilter) ?? subjects[0];
  const lessonClassIds = [...new Set(lessonSubject?.class_ids.filter(isPositiveId) ?? [])];
  const lessonClassId = lessonClassIds.length === 1 ? lessonClassIds[0] : undefined;
  const lowestMasteryItems = useMemo(
    () => (lessonSubject?.items ?? []).slice(0, 5),
    [lessonSubject],
  );

  useEffect(() => {
    // A trend-only refetch hides the card but must not reset its independent
    // subject choice. Period changes explicitly reset it in fetchDashboard.
    if (!lessonPerformance) return;
    if (!subjects.some((subject) => String(subject.subject_id) === subjectFilter))
      setSubjectFilter(subjects.length ? String(subjects[0].subject_id) : "");
  }, [subjects, subjectFilter, lessonPerformance]);

  const visibleGradeData = !isDataMatchingPeriod ? undefined : data?.details;
  const gradeDetails = visibleGradeData?.grade_details;
  const trendPoints = !isDataMatchingPeriod ? [] : data?.trend_chart.points ?? [];
  const visiblePhaseTwo = !isDataMatchingPeriod ? undefined : data?.phase_two;
  const visibleEngagement = !isDataMatchingPeriod ? undefined : data?.engagement;
  const reviewWarnings = uniqueDashboardWarnings(
    visibleEngagement?.warnings.filter((warning) => warning.code === "ambiguous_submission_attempts"),
  );
  const weekdayWarnings = uniqueDashboardWarnings(visiblePhaseTwo?.weekdays.warnings);
  const weekdayUnavailable = Boolean(
    visiblePhaseTwo?.weekdays.unevaluable_count && !visiblePhaseTwo.weekdays.total_count,
  );
  const submissionsWeekday = weekdayLabels.map((day, dayIndex) => ({
    day,
    count: weekdayUnavailable
      ? null
      : visiblePhaseTwo?.weekdays.days.find((item) => item.day_index === dayIndex)?.count ?? null,
  }));
  const pendingGrading = useMemo(
    () => !isDataMatchingPeriod ? [] : data?.action_queue?.pending_grading ?? [],
    [data, isDataMatchingPeriod]
  );
  const reviewSubmissions = pendingGrading.map((item) => {
    return {
      ...item,
      title: item.classwork_title,
      section: [item.student_name, item.section_name].filter(Boolean).join(" · "),
      badge: isHistorical ? "Historical" : "Ungraded",
      variant: isHistorical ? "default" : "destructive",
    };
  });
  const gradeDistribution = gradeDetails ? visibleGradeData?.grade_distribution ?? [] : [];
  const attendanceSections = !isDataMatchingPeriod ? [] : data?.details?.attendance_by_section ?? [];

  const maxWeekdayCount = Math.max(
    ...submissionsWeekday.map((item) => item.count ?? 0),
    45,
  );
  const maxGradeDistCount = Math.max(
    ...gradeDistribution.map((g) => g.count),
    15,
  );

  const emptyMessage = (message: string) =>
    isLoading || isPeriodLoading ? "Loading dashboard data..." : error ? "Dashboard data is unavailable." : message;

  const gradeEmptyMessage = (hasDetails: boolean) => emptyMessage(
    !gradeDetails || !hasDetails ? "Current-grade details are unavailable." :
      gradeDetails.total_grade_count === 0 ? "No student-subject grades for this academic period." :
        gradeDetails.available_grade_count === 0 ? "No Current grades available." :
          "Current-grade details are unavailable.",
  );
  const dashboardEmptyState = (title: string, description: string, icon: ReactNode) => {
    if (isLoading || isPeriodLoading) return <Skeleton className="h-36 w-full" />;
    if (error) return <p className="py-6 text-sm text-muted-foreground">Dashboard data is unavailable.</p>;
    return <TeacherEmptyState compact className="rounded! bg-card shadow-none hover:shadow-none" icon={icon} title={title} description={description} />;
  };
  const gradeCoverage = () => gradeDetails && (
    <Card.Description className="mt-3 text-[11px] text-muted-foreground">
      {gradeDetails.available_grade_count} of {gradeDetails.total_grade_count} student-subject grades available.
      {" "}Unavailable: {gradeDetails.unavailable_grade_count}.
      {gradeDetails.warnings.map((warning) => (
        <span key={`${warning.code}-${warning.subject_id}-${warning.class_id}`}> {warning.message}</span>
      ))}
    </Card.Description>
  );

  return (
    <AppLayout>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            {/* Header */}
            <header className="flex items-center justify-between gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <div className="flex items-center gap-2.5">
                  <h1 className="text-xl font-bold sm:text-2xl md:text-4xl ">
                    Dashboard
                  </h1>
                  {isHistorical && (
                    <Badge variant="surface" size="sm" className="font-semibold">
                      Historical · Read-Only
                    </Badge>
                  )}
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

            <main className="-mt-[1px] flex min-w-0 flex-col gap-4 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:gap-6 md:px-6">
              {hasNoPeriods ? (
                <TeacherEmptyState
                  icon={<BookOpen />}
                  title="No academic periods available"
                  description="There are no academic periods configured for this academic year."
                />
              ) : (
                <>
              {error && (
                <Alert status="error" className="flex items-center gap-2">
                  <AlertCircle className="size-4 shrink-0" />
                  <Alert.Description className="text-sm font-semibold text-destructive">
                    {error}
                  </Alert.Description>
                </Alert>
              )}
              {!isLoading && !isPeriodLoading && !error && data && !data.trend_chart.available_filters.length && (
                <TeacherEmptyState
                  compact
                  icon={<BookOpen />}
                  title={dashboardClass !== "all" || dashboardSubject !== "all" ? "No data for this selection" : "No classes assigned"}
                  description={dashboardClass !== "all" || dashboardSubject !== "all" ? "Choose another class or subject to view its analytics." : "Dashboard analytics will appear when you have assigned classes and subjects for this academic period."}
                  action={dashboardClass !== "all" || dashboardSubject !== "all" ? { label: "Clear filters", onClick: () => changeDashboardScope("all", "all") } : undefined}
                />
              )}

              {/* 2-Column Responsive Layout: Left/Center Main Analytics & Right Overview Cards */}
              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12 md:gap-4">
                {/* Left to Center Column: Learning Performance & Existing Dashboard Functions */}
                <div className="flex min-w-0 flex-col gap-3 lg:col-span-9 xl:col-span-9 md:gap-4">
                  {/* 1. Classwork Performance & Completion Trend Chart */}
                  <Card className="flex flex-col justify-between p-4 sm:p-5">
                    <Card.Header className="p-0">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
                        <div>
                          <Card.Title className="text-base font-bold sm:text-lg">
                            Classwork Performance & Completion Trend
                          </Card.Title>
                        </div>

                        {data &&
                          data.trend_chart.available_filters.length > 0 && (
                            <div className="flex items-center gap-1.5 sm:w-auto">
                              <Select
                                value={selectedFilterKey || `${data.trend_chart.selected_class_id}-${data.trend_chart.selected_subject_id}`}
                                onValueChange={setSelectedFilterKey}
                              >
                                <Select.Trigger
                                  id="trend-filter"
                                  className="h-8 sm:min-w-44 shadow-none"
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
                            Average task score (%)
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="size-2.5 rounded-full bg-muted inline-block" />
                          <span className="text-foreground">
                            Submission completion (%)
                          </span>
                        </div>
                      </div>
                    </Card.Header>

                    {/* Line Chart Body */}
                    <Card.Content className={trendPoints.length ? "h-52 w-full p-0 pb-4" : "w-full p-0"}>
                      {trendPoints.length ? <>
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
                                    {point.short_label} · {point.title}
                                  </p>
                                  <p className="text-emerald-400 font-semibold">
                                    Average task score: {formatPercent(point.avg_score_percent)}
                                  </p>
                                  <p className="text-amber-400 font-semibold">
                                    Completion: {formatPercent(point.completion_rate_percent)}
                                  </p>
                                  {point.scored_count != null && point.eligible_count != null && (
                                    <p>{point.scored_count} scored of {point.eligible_count} eligible student-task requirements.</p>
                                  )}
                                </div>
                              );
                            }}
                          />
                          <Line
                            type="monotone"
                            dataKey="avg_score_percent"
                            name="Average task score %"
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
                          ? "Grouped by Manila deadline date; publish or creation date used when no deadline exists. Raw task scores, not Current grades."
                          : emptyMessage("No published classwork for this selection.")}
                        {!isLoading && !isPeriodLoading && !error && data?.trend_chart.warnings?.map((warning, index) => (
                          <span key={`${warning.code}-${warning.assignment_id}-${index}`}> {warning.message}</span>
                        ))}
                      </Card.Description>
                      </> : dashboardEmptyState("No classwork performance yet", "Published classwork results will appear here for the selected class and subject.", <BookOpen />)}
                    </Card.Content>
                  </Card>

                  {/* 2. Learning Performance & Action Queue: Lowest Mastery Lessons Graph & Submissions to Review */}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {/* Lowest Mastery Lessons Graph */}
                    <Card className="flex flex-col p-4 sm:p-5 min-h-62">
                      <Card.Header className="mb-0 p-0 flex flex-col gap-2">
                        <div className="flex flex-row items-center justify-between">
                          <div>
                            <Card.Title className="text-base font-bold text-foreground sm:text-lg">
                              Lowest Mastery Lessons
                            </Card.Title>
                            <Card.Description className="text-xs text-muted-foreground">
                              Calculated from eligible graded quiz responses; insufficient data is not shown as 0%
                            </Card.Description>
                          </div>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  autoIcon={false}
                                  aria-label="View lesson subject"
                                  disabled={!isPositiveId(lessonSubject?.subject_id) || !isPositiveId(lessonClassId)}
                                  onClick={() => {
                                    if (isPositiveId(lessonSubject?.subject_id) && isPositiveId(lessonClassId)) {
                                      navigate(`/teacher/classes/${lessonClassId}/subjects/${lessonSubject.subject_id}`);
                                    }
                                  }}
                                  className="text-foreground shadow-none px-1.5"
                                >
                                  <ArrowUpRight className="size-4" />
                                </Button>
                              }
                            />
                            <TooltipContent side="right">{isPositiveId(lessonClassId) ? "View subject" : "Choose a class to view this subject."}</TooltipContent>
                          </Tooltip>
                        </div>

                        {subjects.length > 0 && (
                          <div className="flex flex-row flex-wrap items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                            {subjects.map((subject) => (
                              <Button
                                key={subject.subject_id}
                                autoIcon={false}
                                variant={
                                  lessonSubject?.subject_id === subject.subject_id
                                    ? "default"
                                    : "outline"
                                }
                                size="sm"
                                onClick={() => setSubjectFilter(String(subject.subject_id))}
                                className="shrink-0 border-black shadow-none text-[11px] px-2 py-0.5"
                              >
                                {subject.subject_name}
                              </Button>
                            ))}
                          </div>
                        )}
                      </Card.Header>

                      <Card.Content className="mt-2 flex flex-col justify-between gap-2.5 p-0 h-full">
                        {!lowestMasteryItems.length ? (
                          dashboardEmptyState(
                            "Insufficient lesson mastery data",
                            !lessonSubject
                              ? "No subjects assigned for this academic period."
                              : lessonSubject.coverage.scored_mapped_response_count === 0
                                ? "No scored graded quiz answers linked to lessons for this subject."
                                : `Not enough evidence yet. Each lesson needs scores from at least ${lessonPerformance?.policy.min_learners ?? 3} learners across ${lessonPerformance?.policy.min_questions ?? 3} questions (shown as insufficient data rather than 0% mastery).`,
                            <BookOpen />,
                          )
                        ) : (
                          <div
                            className="h-52 w-full min-w-0"
                            role="region"
                            aria-label={`Lowest mastery lessons graph for ${lessonSubject?.subject_name ?? "selected subject"}`}
                          >
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart
                                data={lowestMasteryItems}
                                layout="vertical"
                                margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
                              >
                                <CartesianGrid
                                  strokeDasharray="3 3"
                                  horizontal={false}
                                  stroke="var(--muted-foreground)"
                                  strokeOpacity={0.35}
                                />
                                <XAxis
                                  type="number"
                                  domain={[0, 100]}
                                  ticks={[0, 25, 50, 75, 100]}
                                  tickFormatter={(v) => `${v}%`}
                                  tickLine={false}
                                  axisLine={{ stroke: "var(--foreground)", strokeWidth: 1 }}
                                  tick={{ fontSize: 11, fill: "var(--foreground)" }}
                                />
                                <YAxis
                                  type="category"
                                  dataKey="title"
                                  width={120}
                                  tickLine={false}
                                  axisLine={{ stroke: "var(--foreground)", strokeWidth: 1 }}
                                  tick={{ fontSize: 11, fontWeight: 500, fill: "var(--foreground)" }}
                                />
                                <RechartsTooltip
                                  content={({ active, payload }) => {
                                    if (!active || !payload || !payload.length) return null;
                                    const item = payload[0].payload;
                                    return (
                                      <div className="space-y-1 rounded border border-border bg-background p-2.5 text-xs text-foreground shadow-md">
                                        <p className="font-bold">{item.title}</p>
                                        <p className="font-semibold">
                                          Mastery: {formatPercent(item.performance_percent)}
                                        </p>
                                        <p className="text-muted-foreground">
                                          {item.awarded_points} / {item.possible_points} pts · {item.scored_response_count} scored responses · {item.learner_count} learners · {item.question_count} questions
                                        </p>
                                      </div>
                                    );
                                  }}
                                />
                                <Bar
                                  dataKey="performance_percent"
                                  name="Mastery %"
                                  fill="var(--primary)"
                                  stroke="var(--foreground)"
                                  strokeWidth={1.5}
                                  barSize={18}
                                  radius={[0, 3, 3, 0]}
                                />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                        {lessonSubject && (
                          <Card.Description className="text-[11px] text-muted-foreground">
                            {lessonSubject.coverage.scored_mapped_response_count} scored lesson-linked responses from eligible graded quizzes. {lessonSubject.coverage.unmapped_response_count} unmapped; {lessonSubject.coverage.ungraded_response_count} awaiting scores{lessonSubject.coverage.insufficient_lesson_count > 0 ? `; ${lessonSubject.coverage.insufficient_lesson_count} below minimum evidence threshold` : ""}.
                            {lessonSubject.warnings.map((warning, index) => <span key={`${warning.code}-${index}`}> {warning.message}</span>)}
                          </Card.Description>
                        )}
                      </Card.Content>
                    </Card>

                    {/* Submissions to Review */}
                    {isLoading || isPeriodLoading ? <DashboardQueueSkeleton label="submissions to review" /> : (
                    <Card className="flex flex-col p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between">
                        <Card.Title className="text-base font-bold text-foreground sm:text-lg">
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
                          reviewWarnings.length ? (
                            <p className="py-6 text-sm text-muted-foreground" role="status">Review queue incomplete.</p>
                          ) : dashboardEmptyState(
                            isHistorical ? "No historical submissions to review" : "No submissions need grading",
                            isHistorical ? "There are no submissions awaiting review for this period." : "You're all caught up with grading.",
                            <CheckCircle />,
                          )
                        )}
                        {reviewSubmissions.slice(0, 3).map((item) => (
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
                        {reviewWarnings.map((warning, index) => (
                          <Card.Description key={`${warning.code}-${warning.assignment_id}-${index}`} className="text-xs text-muted-foreground">
                            {warning.message}
                          </Card.Description>
                        ))}
                      </Card.Content>
                    </Card>
                    )}
                  </div>

                  {/* 3. Section-by-Section Health */}
                  <Card className="flex flex-col justify-between p-4 sm:p-5">
                    <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between">
                      <Card.Title className="text-base font-bold text-foreground sm:text-lg">
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
                        const sections = isDataMatchingPeriod ? (data?.section_matrix ?? []) : [];
                        const displayed = showAllSectionHealth ? sections : sections.slice(0, 2);

                        return (
                          <>
                            {sections.length === 0 && (
                              dashboardEmptyState("No classes for this period", "Assigned classes will appear here for the selected academic period.", <BookOpen />)
                            )}
                            {displayed.map((sec, idx: number) => (
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
                                          : "Passing grade is set by the subject grading template; unavailable for this section."}
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
                                  {sec.warnings?.map((warning: { code: string; message: string }) => (
                                    <span key={warning.code}> {warning.message}</span>
                                  ))}
                                  {sec.engagement?.warnings.map((warning: { code: string; message: string }, index: number) => (
                                    <span key={`engagement-${warning.code}-${index}`}> {warning.message}</span>
                                  ))}
                                </Card.Description>
                              </Card>
                            ))}
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
                              <Card.Description className="text-xs text-muted-foreground">
                                Performance and completion across your classes. Attendance uses all recorded entries in the selected period.
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

                  {/* 4. Remaining Existing Dashboard Functions: Monthly Attendance, Weekday Submissions, Grade Distribution */}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {/* Monthly attendance by section */}
                    <Card className="flex flex-col p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0">
                        <Card.Title className="text-base font-semibold text-foreground sm:text-lg">
                          Attendance This Month by Section
                        </Card.Title>
                      </Card.Header>

                      <Card.Content className="mt-3 flex flex-col justify-between gap-3 p-0">
                        {attendanceSections.length === 0 ? (
                          dashboardEmptyState(
                            "No section attendance yet",
                            "Attendance rates by section will appear here for the selected academic period.",
                            <Calendar />,
                          )
                        ) : (
                          attendanceSections.map((item) => (
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
                          ))
                        )}
                      </Card.Content>
                      <Card.Description className="mt-3 text-[11px] text-muted-foreground mt-auto">
                        {visiblePhaseTwo?.month_window && visiblePhaseTwo.month_window.start_date <= visiblePhaseTwo.month_window.end_date
                          ? `${visiblePhaseTwo.month_window.label} (${formatDashboardDate(visiblePhaseTwo.month_window.start_date)}–${formatDashboardDate(visiblePhaseTwo.month_window.end_date)}) · Present + late / recorded entries.`
                          : visiblePhaseTwo?.month_window
                            ? "The current Manila month does not overlap the selected period."
                            : "Current Manila month within the selected period · Present + late / recorded entries."}
                      </Card.Description>
                    </Card>

                    {/* Submissions by weekday */}
                    <Card className="flex flex-col justify-start p-4 sm:p-5">
                      <Card.Header className="mb-0 p-0">
                        <Card.Title className="text-base font-semibold text-foreground sm:text-lg">
                          Submissions by weekday
                        </Card.Title>
                        <Card.Description className="mt-0.5 text-xs text-muted-foreground">
                          Selected period · Manila time · Sunday: {weekdayUnavailable ? "—" : visiblePhaseTwo?.weekdays.sunday_count ?? "—"}.
                          {visiblePhaseTwo?.weekdays && (
                            <span> {visiblePhaseTwo.weekdays.total_count} of {visiblePhaseTwo.weekdays.completed_count} submissions have recorded timestamps.</span>
                          )}
                          {weekdayWarnings.map((warning) => <span key={`${warning.code}:${warning.message}`}> {warning.message}</span>)}
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
                              className="h-3 flex-1"
                            />
                            <span className="font-semibold text-foreground text-right w-8 shrink-0">
                              {item.count ?? "—"}
                            </span>
                          </div>
                        ))}
                      </Card.Content>
                    </Card>

                    {/* Grade Distribution */}
                    <Card className="flex flex-col justify-between p-4 sm:p-5 md:col-span-2 xl:col-span-1">
                      <Card.Header className="mb-0 p-0">
                        <Card.Title className="text-base font-semibold text-foreground sm:text-lg">
                          Grade distribution
                        </Card.Title>
                        <Card.Description className="mt-0.5 text-xs text-muted-foreground">
                          Student-subject Current grades per band, selected period.
                        </Card.Description>
                      </Card.Header>

                      <Card.Content className="mt-4 flex flex-col justify-between gap-2.5 p-0">
                        {(!gradeDetails || gradeDetails.available_grade_count === 0 || gradeDistribution.length === 0) && (
                          dashboardEmptyState("No grade distribution yet", gradeEmptyMessage(Array.isArray(visibleGradeData?.grade_distribution)), <BookOpen />)
                        )}
                        {gradeDetails && gradeDetails.available_grade_count > 0 && gradeDistribution.map((item) => (
                          <div
                            key={item.band}
                            className="flex items-center justify-between gap-3 text-xs sm:text-sm"
                          >
                            <span className="font-medium text-foreground/90 shrink-0 w-20 whitespace-nowrap">
                              {item.band}
                            </span>
                            <Progress
                              value={Math.round(
                                (item.count / maxGradeDistCount) * 100,
                              )}
                              className="h-3 flex-1"
                              indicatorClassName="bg-muted-foreground"
                            />
                            <span className="font-semibold text-foreground text-right w-8 shrink-0">
                              {item.count}
                            </span>
                          </div>
                        ))}
                      </Card.Content>
                      {gradeCoverage()}
                      <Card.Description className="mt-0.5 text-xs text-muted-foreground">
                        Bands use unrounded grades and do not indicate passing.
                      </Card.Description>
                    </Card>
                  </div>

                </div>

                {/* Right Column: Filters & Overview Summary Metrics */}
                <div className="flex min-w-0 flex-col gap-3.5 lg:col-span-3 xl:col-span-3">
                  <div className="grid min-w-0 grid-cols-1 gap-2" aria-label="Dashboard filters">
                    <p className="text-sm font-medium">Filters</p>
                    <div className="flex min-w-0 flex-col gap-2">
                      <label htmlFor="dashboard-class" className="sr-only">Class</label>
                      <Select name="dashboard-class" value={dashboardClass} onValueChange={(value) => changeDashboardScope(value,
                        dashboardSubject === "all" || dashboardFilters.some(item => (value === "all" || String(item.class_id) === value) && String(item.subject_id) === dashboardSubject)
                          ? dashboardSubject : "all")}
                        disabled={isPeriodLoading || (!dashboardFilters.length && isLoading)}>
                        <Select.Trigger id="dashboard-class" className="w-full"><Select.Value /></Select.Trigger>
                        <Select.Content>
                          <Select.Item value="all">All Classes</Select.Item>
                          {classOptions.map(item => <Select.Item key={item.class_id} value={String(item.class_id)}>{item.section_name}</Select.Item>)}
                        </Select.Content>
                      </Select>
                    </div>
                    <div className="flex min-w-0 flex-col gap-2">
                      <label htmlFor="dashboard-subject" className="sr-only">Subject</label>
                      <Select name="dashboard-subject" value={dashboardSubject} onValueChange={(value) => changeDashboardScope(dashboardClass, value)}
                        disabled={isPeriodLoading || (!dashboardFilters.length && isLoading)}>
                        <Select.Trigger id="dashboard-subject" className="w-full"><Select.Value /></Select.Trigger>
                        <Select.Content>
                          <Select.Item value="all">All Subjects</Select.Item>
                          {subjectOptions.map(item => <Select.Item key={item.subject_id} value={String(item.subject_id)}>{item.subject_name}</Select.Item>)}
                        </Select.Content>
                      </Select>
                    </div>
                  </div>

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
              </>
              )}
            </main>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
