import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Calendar,
  CheckCircle2,
  Clock,
  Layers,
  ArrowUpRight,
  TrendingUp,
  Sparkles,
  ClipboardList,
  AlertCircle,
  FileText,
  School,
  Users,
} from "lucide-react";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Progress } from "@/components/retroui/Progress";
import { OverviewCard } from "@/components/overview-cards";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { routes } from "@/../routes";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import {
  getTeacherDashboardHealth,
  type TeacherDashboardHealthResponse,
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
          // Set default filter key if empty
          if (!selectedFilterKey && res.trend_chart.available_filters.length > 0) {
            const first = res.trend_chart.available_filters[0];
            setSelectedFilterKey(`${first.class_id}-${first.subject_id}`);
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error("Failed to load teacher dashboard health:", err);
          setError(err.message || "Failed to load dashboard data");
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

  // Derived KPI cards
  const kpiCards = useMemo(() => {
    if (!data) return [];
    return [
      {
        title: "Active Classes",
        count: String(data.kpis.active_classes),
        stat: `${data.kpis.active_classes} sections`,
        statDescription: `in ${data.term_info.period_name}`,
      },
      {
        title: "Enrolled Students",
        count: String(data.kpis.enrolled_students),
        stat: `${data.kpis.enrolled_students} learners`,
        statDescription: "total across sections",
      },
      {
        title: "Overall Completion",
        count: `${data.kpis.overall_completion_rate}%`,
        stat: `${data.kpis.overall_completion_rate}% submitted`,
        statDescription: "across all published work",
      },
      {
        title: "Ungraded Queue",
        count: String(data.kpis.ungraded_count),
        stat: `${data.kpis.ungraded_count} submissions`,
        statDescription: "pending teacher grading",
      },
    ];
  }, [data]);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-y-auto">
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
                  <p className="text-xs text-muted-foreground hidden sm:block mt-0.5">
                    Class health & progress overview for {data?.term_info.period_name || "Current Term"}
                  </p>
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

            <div className="-mt-[1px] flex min-w-0 flex-col gap-5 border-t-2 border-border px-3 py-4 sm:px-4 sm:py-5 md:px-6 pb-12">
              {/* 1. Top KPI Summary Cards */}
              <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 md:gap-4">
                {isLoading && !data
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <Card key={i} className="@container/card animate-pulse">
                        <Card.Header>
                          <div className="h-4 w-24 bg-muted rounded" />
                        </Card.Header>
                        <Card.Content className="space-y-2">
                          <div className="h-8 w-16 bg-muted rounded" />
                          <div className="h-3 w-32 bg-muted rounded" />
                        </Card.Content>
                      </Card>
                    ))
                  : kpiCards.map((card) => (
                      <OverviewCard
                        key={card.title}
                        title={card.title}
                        count={card.count}
                        stat={card.stat}
                        statDescription={card.statDescription}
                      />
                    ))}
              </div>

              {/* 2. Chronological Mastery & Completion Trend Chart */}
              <Card className="w-full border-2 border-black shadow-[3px_3px_0px_#000]">
                <Card.Content className="p-4 sm:p-6">
                  {/* Chart Header with Class/Subject Filter */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
                    <div>
                      <div className="flex items-center gap-2">
                        <TrendingUp className="size-5 text-emerald-700" />
                        <Card.Title className="text-lg sm:text-xl font-bold font-head mb-0">
                          Classwork Mastery & Completion Trend
                        </Card.Title>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Chronological trajectory of class score averages vs. task submission completion
                      </p>
                    </div>

                    {/* Dynamic Section Selector */}
                    {data && data.trend_chart.available_filters.length > 0 && (
                      <div className="flex items-center gap-2">
                        <label htmlFor="trend-filter" className="text-xs font-semibold text-muted-foreground">
                          Section:
                        </label>
                        <select
                          id="trend-filter"
                          value={selectedFilterKey}
                          onChange={(e) => setSelectedFilterKey(e.target.value)}
                          className="border-2 border-black rounded px-3 py-1.5 text-xs font-semibold bg-background cursor-pointer hover:bg-muted/40 transition-colors focus:outline-none focus:ring-2 focus:ring-black"
                        >
                          {data.trend_chart.available_filters.map((f) => (
                            <option
                              key={`${f.class_id}-${f.subject_id}`}
                              value={`${f.class_id}-${f.subject_id}`}
                            >
                              {f.section_name} · {f.subject_name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Chart Legend */}
                  <div className="flex flex-wrap items-center gap-5 mb-4 px-1 text-xs">
                    <div className="flex items-center gap-2 font-medium">
                      <span className="size-3 rounded-full bg-emerald-600 border border-black inline-block" />
                      <span>Class Mastery Average (%)</span>
                    </div>
                    <div className="flex items-center gap-2 font-medium">
                      <span className="w-4 h-0.5 border-t-2 border-dashed border-amber-600 inline-block" />
                      <span>Submission Completion (%)</span>
                    </div>
                  </div>

                  {/* Chart Body: Real Line Chart vs. Graceful Empty/Pacing State */}
                  {data?.trend_chart.has_sufficient_data ? (
                    <div className="h-64 sm:h-72 w-full pt-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={data.trend_chart.points}
                          margin={{ top: 10, right: 20, left: -15, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                          <XAxis
                            dataKey="short_label"
                            tickLine={false}
                            axisLine={{ stroke: "#000", strokeWidth: 1 }}
                            tick={{ fontSize: 11, fontWeight: 500 }}
                          />
                          <YAxis
                            domain={[0, 100]}
                            tickLine={false}
                            axisLine={{ stroke: "#000", strokeWidth: 1 }}
                            tick={{ fontSize: 11 }}
                            unit="%"
                          />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload || !payload.length) return null;
                              const point = payload[0].payload;
                              return (
                                <div className="border-2 border-black bg-background p-2.5 rounded shadow-[2px_2px_0px_#000] text-xs max-w-xs space-y-1">
                                  <p className="font-bold">{point.title}</p>
                                  <p className="text-muted-foreground text-[11px]">
                                    Category: {point.category} · Due: {point.short_label}
                                  </p>
                                  <div className="border-t border-border pt-1 mt-1 space-y-0.5">
                                    <p className="text-emerald-700 font-semibold">
                                      Class Mastery: {point.avg_score_percent !== null ? `${point.avg_score_percent}%` : "Awaiting scores"}
                                    </p>
                                    <p className="text-amber-700 font-semibold">
                                      Turn-in Rate: {point.completion_rate_percent}% ({point.submitted_count}/{point.total_enrolled})
                                    </p>
                                  </div>
                                </div>
                              );
                            }}
                          />
                          <Line
                            type="monotone"
                            dataKey="avg_score_percent"
                            name="Mastery %"
                            stroke="#059669"
                            strokeWidth={3}
                            dot={{ r: 4, stroke: "#000", strokeWidth: 1, fill: "#059669" }}
                            activeDot={{ r: 6, stroke: "#000", strokeWidth: 2 }}
                            connectNulls={true}
                          />
                          <Line
                            type="monotone"
                            dataKey="completion_rate_percent"
                            name="Completion %"
                            stroke="#d97706"
                            strokeWidth={2}
                            strokeDasharray="4 4"
                            dot={{ r: 3, stroke: "#000", strokeWidth: 1, fill: "#d97706" }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    /* Graceful "Pacing in Progress" State */
                    <div className="border-2 border-dashed border-border rounded-lg p-6 sm:p-8 bg-muted/20 flex flex-col items-center text-center">
                      <div className="size-12 rounded-full border-2 border-black bg-amber-100 flex items-center justify-center mb-3">
                        <Sparkles className="size-6 text-amber-700" />
                      </div>
                      <h4 className="font-bold text-base font-head mb-1">
                        Pacing in Progress: Trend Curve Unlocks After 3 Graded Classworks
                      </h4>
                      <p className="text-xs text-muted-foreground max-w-md mb-4">
                        {data?.trend_chart.points && data.trend_chart.points.length > 0
                          ? `Currently, ${data.trend_chart.points.filter((p) => p.avg_score_percent !== null).length} of 3 required graded classworks have been recorded for ${data.trend_chart.selected_section_name || "this section"}.`
                          : `No classworks published yet for ${data?.trend_chart.selected_section_name || "this section"}. Once tasks are assigned and evaluated, chronological score curves will appear here automatically.`}
                      </p>

                      {/* Pill status of active classworks if 1-2 exist */}
                      {data?.trend_chart.points && data.trend_chart.points.length > 0 && (
                        <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                          {data.trend_chart.points.map((p) => (
                            <div
                              key={p.classwork_id}
                              className="border border-black rounded px-2.5 py-1 bg-background text-[11px] font-medium flex items-center gap-1.5 shadow-none"
                            >
                              <FileText className="size-3 text-muted-foreground" />
                              <span className="truncate max-w-[140px]">{p.title}</span>
                              {p.avg_score_percent !== null ? (
                                <Badge size="sm" variant="solid" className="bg-emerald-600 text-white text-[10px] px-1 py-0">
                                  {p.avg_score_percent}%
                                </Badge>
                              ) : (
                                <Badge size="sm" variant="outline" className="text-[10px] px-1 py-0">
                                  Pending scores
                                </Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </Card.Content>
              </Card>

              {/* 3. Section-by-Section Health Matrix & Live Action Queue Split */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 w-full">
                {/* Section-by-Section Health Matrix (Left 7 Cols) */}
                <Card className="lg:col-span-7 border-2 border-black shadow-[3px_3px_0px_#000]">
                  <Card.Content className="p-4 sm:p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <School className="size-5 text-primary" />
                          <Card.Title className="text-lg font-bold font-head mb-0">
                            Section-by-Section Health
                          </Card.Title>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Performance, completion, and attendance across your classes
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(routes.teacher.classes)}
                        className="text-xs h-8 border-black shadow-none"
                      >
                        All Classes <ArrowUpRight className="size-3.5 ml-1" />
                      </Button>
                    </div>

                    {data?.section_matrix && data.section_matrix.length > 0 ? (
                      <div className="space-y-3">
                        {data.section_matrix.map((sec) => (
                          <div
                            key={`${sec.class_id}-${sec.subject_id}`}
                            className="border-2 border-black rounded p-3.5 bg-background hover:bg-muted/10 transition-colors"
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <span className="font-bold text-sm sm:text-base mr-2">
                                  {sec.section_name}
                                </span>
                                <Badge size="sm" variant="secondary" className="text-[10px] py-0 px-1.5">
                                  {sec.grade_level || "Class"}
                                </Badge>
                                <span className="text-xs text-muted-foreground ml-2">
                                  {sec.subject_name}
                                </span>
                              </div>
                              <span className="text-xs font-semibold text-muted-foreground">
                                {sec.student_count} Students
                              </span>
                            </div>

                            {/* Meters Grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border">
                              {/* Task Completion */}
                              <div>
                                <div className="flex justify-between text-xs mb-1">
                                  <span className="text-muted-foreground">Task Completion</span>
                                  <span className="font-semibold">{sec.completion_rate_percent}%</span>
                                </div>
                                <Progress value={sec.completion_rate_percent} className="h-2" />
                              </div>

                              {/* Attendance */}
                              <div>
                                <div className="flex justify-between text-xs mb-1">
                                  <span className="text-muted-foreground">Attendance</span>
                                  {sec.attendance_rate_percent !== null ? (
                                    <span className="font-semibold">{sec.attendance_rate_percent}%</span>
                                  ) : (
                                    <span className="text-muted-foreground italic text-[11px]">No logs yet</span>
                                  )}
                                </div>
                                {sec.attendance_rate_percent !== null ? (
                                  <Progress value={sec.attendance_rate_percent} className="h-2" />
                                ) : (
                                  <div className="h-2 bg-muted/40 rounded" />
                                )}
                              </div>
                            </div>

                            {/* Bottom Status Bar: Average Score & Passing Rate with Graceful Partial State */}
                            <div className="mt-3 pt-2 border-t border-dashed border-border flex items-center justify-between text-xs">
                              <div className="flex items-center gap-3">
                                <div>
                                  <span className="text-muted-foreground mr-1.5">Class Average:</span>
                                  {sec.avg_score_percent !== null ? (
                                    <span className="font-bold text-emerald-700">{sec.avg_score_percent}%</span>
                                  ) : (
                                    <Badge size="sm" variant="outline" className="text-[10px] bg-muted/30">
                                      Awaiting Graded Work
                                    </Badge>
                                  )}
                                </div>

                                <div>
                                  <span className="text-muted-foreground mr-1.5">Passing Rate:</span>
                                  {sec.passing_rate_percent !== null ? (
                                    <span className="font-bold">{sec.passing_rate_percent}%</span>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </div>
                              </div>

                              <span className="text-[11px] text-muted-foreground">
                                {sec.published_classworks} published tasks
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground text-xs">
                        No active classes assigned for this term.
                      </div>
                    )}
                  </Card.Content>
                </Card>

                {/* Live Action Queue (Right 5 Cols) */}
                <div className="lg:col-span-5 flex flex-col gap-4">
                  {/* Card A: Submissions Awaiting Grading */}
                  <Card className="border-2 border-black shadow-[3px_3px_0px_#000] flex-1">
                    <Card.Content className="p-4 sm:p-5 flex flex-col h-full">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <ClipboardList className="size-5 text-amber-700" />
                          <Card.Title className="text-base font-bold font-head mb-0">
                            Submissions to Review
                          </Card.Title>
                        </div>
                        {data && data.action_queue.pending_grading.length > 0 && (
                          <Badge variant="solid" className="bg-amber-600 text-white text-xs px-2 py-0.5">
                            {data.action_queue.pending_grading.length} Pending
                          </Badge>
                        )}
                      </div>

                      {data?.action_queue.pending_grading && data.action_queue.pending_grading.length > 0 ? (
                        <div className="space-y-2 flex-1">
                          {data.action_queue.pending_grading.map((item) => (
                            <div
                              key={item.submission_id}
                              className="border border-black rounded p-2.5 bg-background hover:bg-muted/10 transition-colors flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-bold truncate">{item.student_name}</p>
                                <p className="text-[11px] text-muted-foreground truncate">
                                  {item.classwork_title} · {item.section_name}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => navigate(routes.teacher.classworks)}
                                className="h-7 text-xs border-black shrink-0 px-2"
                              >
                                Grade
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-center py-6 text-muted-foreground text-xs">
                          <CheckCircle2 className="size-8 text-emerald-600 mb-1.5" />
                          <p className="font-semibold text-foreground">All caught up!</p>
                          <p>No submissions currently pending review.</p>
                        </div>
                      )}
                    </Card.Content>
                  </Card>

                  {/* Card B: Upcoming Deadlines & Turn-in Pacing */}
                  <Card className="border-2 border-black shadow-[3px_3px_0px_#000] flex-1">
                    <Card.Content className="p-4 sm:p-5 flex flex-col h-full">
                      <div className="flex items-center gap-2 mb-3">
                        <Clock className="size-5 text-primary" />
                        <Card.Title className="text-base font-bold font-head mb-0">
                          Active Deadlines
                        </Card.Title>
                      </div>

                      {data?.action_queue.upcoming_deadlines && data.action_queue.upcoming_deadlines.length > 0 ? (
                        <div className="space-y-2 flex-1">
                          {data.action_queue.upcoming_deadlines.map((item, idx) => (
                            <div
                              key={item.classwork_id || idx}
                              className="border border-black rounded p-2.5 bg-background flex flex-col gap-1 text-xs"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold truncate">{item.title}</span>
                                <span className="text-[11px] font-semibold text-amber-800 shrink-0 ml-2">
                                  {item.due_date ? new Date(item.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Active"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                <span>{item.section_name}</span>
                                <span>
                                  {item.submitted_count} of {item.total_students} turned in
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-center py-6 text-muted-foreground text-xs">
                          <Calendar className="size-8 text-muted-foreground mb-1.5" />
                          <p>No upcoming task deadlines scheduled.</p>
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
}
