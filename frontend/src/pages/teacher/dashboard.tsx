import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, RefreshCw } from "lucide-react";
import AppLayout from "@/layouts/app-layout";
import { Alert } from "@/components/retroui/Alert";
import { Card } from "@/components/retroui/Card";
import { Skeleton } from "@/components/retroui/Skeleton";
import { Button } from "@/components/teacher/button";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import {
  ApiRequestError,
  getTeacherDashboardHealth,
  type TeacherDashboardHealthResponse,
  type TrendChartPoint,
} from "@/lib/api";
import { routes } from "@/../routes";
import { DashboardScopeBar } from "@/components/teacher/dashboard/DashboardScopeBar";
import { DashboardKpiStrip } from "@/components/teacher/dashboard/DashboardKpiStrip";
import { PerformanceTrendChart } from "@/components/teacher/dashboard/PerformanceTrendChart";
import { SubjectComparisonChart } from "@/components/teacher/dashboard/SubjectComparisonChart";
import { GradeDistributionChart } from "@/components/teacher/dashboard/GradeDistributionChart";
import { OutcomesAndMasteryCard } from "@/components/teacher/dashboard/OutcomesAndMasteryCard";
import { InterventionAnalyticsCard } from "@/components/teacher/dashboard/InterventionAnalyticsCard";
import { SectionHealthMatrix } from "@/components/teacher/dashboard/SectionHealthMatrix";
import { buildPathWithQuery } from "@/components/teacher/dashboard/format";

function DashboardLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-3 py-4 sm:px-4 md:px-6" aria-label="Loading dashboard analytics">
      {/* 3x2 desktop / 2x3 mobile KPI skeleton */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 lg:gap-4">
        {Array.from({ length: 6 }).map((_, idx) => (
          <Card key={idx} className="border-2 border-black bg-card p-3 shadow-md sm:p-4">
            <div className="flex items-center gap-2">
              <Skeleton className="size-8 shrink-0" />
              <Skeleton className="h-4 w-28" />
            </div>
            <Skeleton className="mt-3 h-8 w-24" />
            <Skeleton className="mt-2 h-3 w-36" />
            <Skeleton className="mt-1.5 h-3 w-28" />
          </Card>
        ))}
      </div>

      {/* Band 2 skeleton */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="border-2 border-black bg-card p-4 shadow-md lg:col-span-7">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="mt-2 h-3 w-72" />
          <Skeleton className="mt-4 h-[260px] w-full" />
        </Card>
        <Card className="border-2 border-black bg-card p-4 shadow-md lg:col-span-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2 h-3 w-60" />
          <Skeleton className="mt-4 h-[260px] w-full" />
        </Card>
      </div>

      {/* Band 3 skeleton */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="border-2 border-black bg-card p-4 shadow-md lg:col-span-6">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-3 h-[240px] w-full" />
        </Card>
        <Card className="border-2 border-black bg-card p-4 shadow-md lg:col-span-6">
          <Skeleton className="h-5 w-52" />
          <Skeleton className="mt-3 h-[240px] w-full" />
        </Card>
      </div>
    </div>
  );
}

export default function TeacherDashboard() {
  const navigate = useNavigate();
  const {
    selectedYearId,
    selectedPeriodId,
    selectedYear,
    selectedPeriod,
    isLoading: isPeriodContextLoading,
  } = useAcademicPeriod();

  const [selectedClassId, setSelectedClassId] = useState<string>("all");
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("all");

  const [data, setData] = useState<TeacherDashboardHealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);

  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const prevPeriodKeyRef = useRef<string>("");

  const periodKey = `${selectedYearId ?? "none"}:${selectedPeriodId ?? "none"}`;

  // Reset class/subject filters cleanly when Academic Year or Period changes
  useEffect(() => {
    if (prevPeriodKeyRef.current && prevPeriodKeyRef.current !== periodKey) {
      setSelectedClassId("all");
      setSelectedSubjectId("all");
      setData(null);
    }
    prevPeriodKeyRef.current = periodKey;
  }, [periodKey]);

  const fetchDashboard = useCallback(async () => {
    if (isPeriodContextLoading) return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const currentRequestId = ++requestIdRef.current;

    setIsLoading(true);
    setError(null);

    try {
      const response = await getTeacherDashboardHealth(
        {
          academic_year_id: selectedYearId ?? undefined,
          academic_period_id: selectedPeriodId ?? undefined,
          dashboard_class_id:
            selectedClassId !== "all" ? Number(selectedClassId) : undefined,
          dashboard_subject_id:
            selectedSubjectId !== "all" ? Number(selectedSubjectId) : undefined,
        },
        { signal: controller.signal },
      );

      if (currentRequestId !== requestIdRef.current) return;
      setData(response);
    } catch (err: unknown) {
      if (controller.signal.aborted || currentRequestId !== requestIdRef.current) {
        return;
      }
      if (err instanceof ApiRequestError) {
        setError({ message: err.message, status: err.status });
      } else if (err instanceof Error) {
        setError({ message: err.message });
      } else {
        setError({ message: "Unable to load teacher dashboard analytics." });
      }
      setData(null);
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [
    isPeriodContextLoading,
    selectedYearId,
    selectedPeriodId,
    selectedClassId,
    selectedSubjectId,
  ]);

  useEffect(() => {
    void fetchDashboard();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [fetchDashboard]);

  const isHistorical = useMemo(() => {
    if (selectedYear && !selectedYear.is_active) return true;
    if (selectedPeriod && !selectedPeriod.is_active) return true;
    if (data && !data.term_info.is_active) return true;
    return false;
  }, [selectedYear, selectedPeriod, data]);

  const dashboardFilters = useMemo(
    () => data?.dashboard_filters ?? data?.trend_chart.available_filters ?? [],
    [data],
  );

  const classOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const f of dashboardFilters) {
      if (!map.has(f.class_id)) {
        map.set(f.class_id, f.section_name);
      }
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [dashboardFilters]);

  const subjectOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const f of dashboardFilters) {
      if (selectedClassId !== "all" && String(f.class_id) !== selectedClassId) {
        continue;
      }
      if (!map.has(f.subject_id)) {
        map.set(f.subject_id, f.subject_name);
      }
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [dashboardFilters, selectedClassId]);

  const handleClassChange = (value: string) => {
    setSelectedClassId(value);
    if (value !== "all" && selectedSubjectId !== "all") {
      const comboStillValid = dashboardFilters.some(
        (f) => String(f.class_id) === value && String(f.subject_id) === selectedSubjectId,
      );
      if (!comboStillValid) {
        setSelectedSubjectId("all");
      }
    }
  };

  const handleSubjectChange = (value: string) => {
    setSelectedSubjectId(value);
  };

  const handleResetFilters = () => {
    setSelectedClassId("all");
    setSelectedSubjectId("all");
  };

  const handleTrendPointClick = (point: TrendChartPoint) => {
    if (point.classwork_id != null) {
      navigate(`/teacher/classworks/${point.classwork_id}`);
      return;
    }
    navigate(
      buildPathWithQuery(routes.teacher.classworks, {
        class_id: selectedClassId !== "all" ? Number(selectedClassId) : undefined,
        subject_id: selectedSubjectId !== "all" ? Number(selectedSubjectId) : undefined,
      }),
    );
  };

  const handleOpenGrades = () => {
    const classIdNum = selectedClassId !== "all" ? Number(selectedClassId) : undefined;
    const subjectIdNum = selectedSubjectId !== "all" ? Number(selectedSubjectId) : undefined;
    if (classIdNum && subjectIdNum) {
      navigate(
        `/teacher/grades/${encodeURIComponent(String(classIdNum))}/${encodeURIComponent(String(subjectIdNum))}`,
      );
      return;
    }
    navigate(
      buildPathWithQuery(routes.teacher.grades, {
        class_id: classIdNum,
        subject_id: subjectIdNum,
      }),
    );
  };

  const trendScopeLabel = useMemo(() => {
    const classLabel =
      selectedClassId !== "all"
        ? classOptions.find((c) => String(c.id) === selectedClassId)?.label ?? "Selected Class"
        : "All Classes";
    const subjectLabel =
      selectedSubjectId !== "all"
        ? subjectOptions.find((s) => String(s.id) === selectedSubjectId)?.label ?? "Selected Subject"
        : "All Subjects";
    return `${classLabel} · ${subjectLabel}`;
  }, [selectedClassId, selectedSubjectId, classOptions, subjectOptions]);

  const showInitialSkeleton = isPeriodContextLoading || (isLoading && !data);
  const hasAssignedLoads = dashboardFilters.length > 0;

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <DashboardScopeBar
            periodName={data?.term_info.period_name ?? selectedPeriod?.period}
            academicYearLabel={data?.term_info.academic_year ?? selectedYear?.year_label}
            isHistorical={isHistorical}
            activeClassesCount={data?.kpis.active_classes ?? 0}
            enrolledStudentsCount={data?.kpis.enrolled_students ?? 0}
            termProgress={data?.phase_two?.term_progress}
            classOptions={classOptions}
            subjectOptions={subjectOptions}
            selectedClassId={selectedClassId}
            selectedSubjectId={selectedSubjectId}
            onClassChange={handleClassChange}
            onSubjectChange={handleSubjectChange}
            onResetFilters={handleResetFilters}
            onRefresh={() => void fetchDashboard()}
            isRefreshing={isLoading}
          />

          {error ? (
            <div className="px-3 py-4 sm:px-4 md:px-6">
              <Alert status="error">
                <Alert.Title>
                  {error.status === 403
                    ? "Academic period access restricted"
                    : "Unable to load dashboard analytics"}
                </Alert.Title>
                <Alert.Description className="mt-1 flex flex-wrap items-center justify-between gap-3">
                  <span>{error.message}</span>
                  {error.status !== 403 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void fetchDashboard()}
                      className="gap-1.5 bg-white"
                    >
                      <RefreshCw className="size-3.5" />
                      Retry
                    </Button>
                  )}
                </Alert.Description>
              </Alert>
            </div>
          ) : showInitialSkeleton ? (
            <DashboardLoadingSkeleton />
          ) : !data || !hasAssignedLoads ? (
            <div className="px-3 py-6 sm:px-4 md:px-6">
              <TeacherEmptyState
                icon={<BookOpen className="size-5" />}
                title="No assigned classes for this academic period"
                description={
                  isHistorical
                    ? "You had no authorized teaching loads recorded for the selected historical academic period."
                    : "Your analytics overview will appear here once classes and subjects are assigned to you for this period."
                }
                action={{
                  label: "View My Classes",
                  onClick: () => navigate(routes.teacher.classes),
                }}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4 px-3 py-4 sm:px-4 md:px-6">
              {/* Band 1: Six Percentage-First Hero KPIs (3x2 desktop / 2x3 mobile) */}
              <DashboardKpiStrip
                analytics={data.analytics}
                selectedClassId={selectedClassId}
                selectedSubjectId={selectedSubjectId}
                onNavigate={(path) => navigate(path)}
              />

              {/* Band 2: Core Trend (7 cols) & Subject/Section Comparison (5 cols) */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                <div className="min-w-0 lg:col-span-7">
                  <PerformanceTrendChart
                    points={data.trend_chart.points}
                    scopeLabel={trendScopeLabel}
                    hasSufficientData={data.trend_chart.has_sufficient_data}
                    gradedTaskCount={data.trend_chart.graded_task_count ?? 0}
                    isHistorical={isHistorical}
                    onPointClick={handleTrendPointClick}
                    onCreateClasswork={() => navigate(routes.teacher.classworks)}
                  />
                </div>
                <div className="min-w-0 lg:col-span-5">
                  <SubjectComparisonChart
                    subjectComparisons={data.analytics.subject_comparisons}
                    sectionMatrix={data.section_matrix}
                    selectedSubjectId={selectedSubjectId}
                    onSelectSubject={(subjectId) => setSelectedSubjectId(String(subjectId))}
                    onSelectSection={(classId, subjectId) =>
                      navigate(`/teacher/classes/${classId}/${subjectId}`)
                    }
                  />
                </div>
              </div>

              {/* Band 3: Term Grade Distribution + Threshold Summary (6 cols) & Category/Lesson Mastery (6 cols) */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                <div className="min-w-0 lg:col-span-6">
                  <GradeDistributionChart
                    bands={data.analytics.grade_distribution.bands}
                    thresholdSummary={data.analytics.threshold_summary}
                    onOpenGrades={handleOpenGrades}
                  />
                </div>
                <div className="min-w-0 lg:col-span-6">
                  <OutcomesAndMasteryCard
                    categoryPerformance={data.analytics.category_performance}
                    lessonPerformance={data.details?.lesson_performance}
                    onCategoryClick={(category) =>
                      navigate(
                        buildPathWithQuery(routes.teacher.classworks, {
                          class_id: selectedClassId !== "all" ? Number(selectedClassId) : undefined,
                          subject_id: selectedSubjectId !== "all" ? Number(selectedSubjectId) : undefined,
                          graded: "true",
                          category,
                        }),
                      )
                    }
                    onLessonClick={(classId, subjectId, lessonId) =>
                      navigate(
                        `/teacher/classes/${classId}/subjects/${subjectId}?lessonId=${lessonId}`,
                      )
                    }
                  />
                </div>
              </div>

              {/* Band 4: Intervention Analytics + Isolated Practice Assessments (5 cols) & Section Health Matrix (7 cols) */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                <div className="min-w-0 lg:col-span-5">
                  <InterventionAnalyticsCard
                    interventions={data.analytics.interventions}
                    onNavigateView={(view) =>
                      navigate(buildPathWithQuery(routes.teacher.interventions, { view }))
                    }
                  />
                </div>
                <div className="min-w-0 lg:col-span-7">
                  <SectionHealthMatrix
                    sections={data.section_matrix}
                    onSelectSection={(classId, subjectId) =>
                      navigate(`/teacher/classes/${classId}/${subjectId}`)
                    }
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
