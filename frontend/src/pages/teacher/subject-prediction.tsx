import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BookOpen, TrendingUp } from "lucide-react";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Progress } from "@/components/retroui/Progress";
import { Button } from "@/components/teacher/button";
import { Empty } from "@/components/retroui/Empty";
import IconContainer from "@/components/icon-container";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import PredictionFilters from "@/components/predictions/prediction-filters";
import PredictionTable from "@/components/predictions/prediction-table";
import PredictionDetailSheet from "@/components/predictions/prediction-detail-sheet";
import {
  useTeacherActiveInterventionShortcut,
  useTeacherCandidateShortcut,
} from "@/components/predictions/use-teacher-candidate-shortcut";
import {
  type AssignedSubjectSectionScope,
  type AuthorizedCurrentTermRow,
  buildCurrentTermDashboard,
  currentTermPredictionErrorMessage,
  formatSubjectDisplayName,
  loadAuthorizedCurrentTermPredictions,
} from "@/components/predictions/current-term-dashboard-adapter";
import type { DashboardFilters } from "@/lib/prediction-api";
import {
  getTeacherDashboardHealth,
  type TeacherDashboardHealthResponse,
  type SectionHealthItem,
} from "@/lib/api";


export default function SubjectPrediction() {
  const navigate = useNavigate();
  const { subjectId: routeSubjectSlug } = useParams<{ subjectId?: string }>();
  const { selectedPeriodId } = useAcademicPeriod();
  const routeSubjectId =
    routeSubjectSlug && !Number.isNaN(Number(routeSubjectSlug))
      ? Number(routeSubjectSlug)
      : undefined;

  const [rows, setRows] = useState<AuthorizedCurrentTermRow[]>([]);
  const [assignedScopes, setAssignedScopes] = useState<AssignedSubjectSectionScope[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<number | undefined>();
  const [riskLevel, setRiskLevel] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AuthorizedCurrentTermRow | null>(null);
  const candidateId = useTeacherCandidateShortcut(selected);
  const activeInterventionId = useTeacherActiveInterventionShortcut(selected);

  // Section-by-section health
  const [healthData, setHealthData] = useState<TeacherDashboardHealthResponse | null>(null);
  const [isHealthLoading, setIsHealthLoading] = useState(false);
  const [showAllSectionHealth, setShowAllSectionHealth] = useState(false);

  // Auto-open via search params (e.g. from dashboard or alerts)
  const [searchParams] = useSearchParams();
  const queryPredictionId = searchParams.get("predictionId");
  const queryStudentId = searchParams.get("studentId");
  const queryStudentName = searchParams.get("studentName");

  useEffect(() => {
    if (!rows.length) return;
    if (queryPredictionId) {
      const match = rows.find((r) => String(r.prediction_id) === queryPredictionId);
      if (match) {
        setSelected(match);
        return;
      }
    }
    if (queryStudentId) {
      const match = rows.find((r) => String(r.student_id) === queryStudentId);
      if (match) {
        setSelected(match);
        return;
      }
    }
    if (queryStudentName) {
      const normalizedQuery = queryStudentName.toLowerCase();
      const match = rows.find((r) => {
        const name = r.student_name?.toLowerCase();
        return name ? name.includes(normalizedQuery) || normalizedQuery.includes(name) : false;
      });
      if (match) {
        setSelected(match);
        return;
      }
    }
    if (queryPredictionId || queryStudentId || queryStudentName) {
      setSelected(rows[0]);
    }
  }, [rows, queryPredictionId, queryStudentId, queryStudentName]);

  useEffect(() => {
    if (!selectedPeriodId || routeSubjectId === undefined) {
      Promise.resolve().then(() => setLoading(false));
      return;
    }

    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        setLoading(true);
        setLoadError(null);
      }
    });

    loadAuthorizedCurrentTermPredictions(selectedPeriodId, { subjectId: routeSubjectId })
      .then(({ rows: loaded, assignedScopes: loadedScopes }) => {
        if (!cancelled) {
          setRows(loaded);
          setAssignedScopes(loadedScopes);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRows([]);
          setAssignedScopes([]);
          setLoadError(currentTermPredictionErrorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [routeSubjectId, selectedPeriodId]);

  useEffect(() => {
    let isMounted = true;
    const loadHealth = async () => {
      setIsHealthLoading(true);
      try {
        const res = await getTeacherDashboardHealth({
          subject_id: routeSubjectId,
          academic_period_id: selectedPeriodId ?? undefined,
        });
        if (isMounted) {
          setHealthData(res);
        }
      } catch (err) {
        console.warn("Failed to load section health in subject prediction:", err);
      } finally {
        if (isMounted) setIsHealthLoading(false);
      }
    };
    if (routeSubjectId) {
      void loadHealth();
    }
    return () => {
      isMounted = false;
    };
  }, [routeSubjectId, selectedPeriodId]);

  const sections: SectionHealthItem[] = useMemo(() => {
    if (healthData?.section_matrix && healthData.section_matrix.length > 0) {
      if (routeSubjectId) {
        const forSubject = healthData.section_matrix.filter(
          (sec) => Number(sec.subject_id) === Number(routeSubjectId),
        );
        if (forSubject.length > 0) return forSubject;
      }
      return healthData.section_matrix;
    }
    return [];
  }, [healthData, routeSubjectId]);

  const lessonPerformance = isHealthLoading ? undefined : healthData?.details?.lesson_performance;
  const lessonSubject = useMemo(() => {
    if (!lessonPerformance?.subjects.length) return undefined;
    if (routeSubjectId != null) {
      const match = lessonPerformance.subjects.find((s) => s.subject_id === routeSubjectId);
      if (match) return match;
    }
    return lessonPerformance.subjects[0];
  }, [lessonPerformance, routeSubjectId]);

  const emptyLessonMessage = (message: string) =>
    isHealthLoading ? "Loading lesson performance..." : message;

  const matchingScope = assignedScopes.find((s) => s.subject_id === routeSubjectId);
  const subjectDisplayName = matchingScope
    ? formatSubjectDisplayName(matchingScope.subject_name, matchingScope.grade_level)
    : rows[0]
      ? formatSubjectDisplayName(rows[0].subject_name, rows[0].grade_level)
      : "Subject";

  const scopedFilters = useMemo<DashboardFilters | null>(() => {
    if (!assignedScopes.length) return null;
    const classesMap = new Map<number, { class_id: number; section_name: string; grade_level?: number }>();
    assignedScopes.forEach((s) => {
      if (!classesMap.has(s.class_id)) {
        classesMap.set(s.class_id, {
          class_id: s.class_id,
          section_name: s.section_name,
          grade_level: s.grade_level ?? undefined,
        });
      }
    });
    return {
      grades: [],
      classes: Array.from(classesMap.values()),
      subjects: [],
      terms: [],
    };
  }, [assignedScopes]);

  const sectionFilteredRows = useMemo(() => {
    if (selectedClassId === undefined) return rows;
    return rows.filter((r) => r.class_id === selectedClassId);
  }, [rows, selectedClassId]);

  const data = buildCurrentTermDashboard(sectionFilteredRows, {
    search,
    interventionLevel: riskLevel,
    limit: Math.max(10, sectionFilteredRows.length),
  });

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center gap-3 bg-background px-4 py-4 md:px-6">
          <SidebarTrigger className="md:hidden" />
          <Breadcrumb>
            <Breadcrumb.List className="flex min-w-0 flex-nowrap items-center gap-2">
              <Breadcrumb.Item>
                <Breadcrumb.Link asChild>
                  <Link to="/teacher/predictions">AI Predictions</Link>
                </Breadcrumb.Link>
              </Breadcrumb.Item>
              <Breadcrumb.Separator />
              <Breadcrumb.Item>
                <Breadcrumb.Page>{subjectDisplayName}</Breadcrumb.Page>
              </Breadcrumb.Item>
            </Breadcrumb.List>
          </Breadcrumb>
        </header>

        <div className="-mt-[1px] border-t-2 border-border px-4 py-4 md:px-6">
          <div className="flex flex-col gap-4">
            <PredictionFilters
              filters={scopedFilters}
              classId={selectedClassId}
              subjectId={routeSubjectId}
              academicPeriodId={selectedPeriodId ?? undefined}
              riskLevel={riskLevel}
              search={search}
              hideGradeFilter
              hideSubjectFilter
              hidePeriodFilter
              riskSummary={data.risk_summary}
              onClassChange={setSelectedClassId}
              onSubjectChange={() => undefined}
              onRiskChange={setRiskLevel}
              onSearchChange={setSearch}
              onClearAll={() => {
                setSelectedClassId(undefined);
                setRiskLevel(undefined);
                setSearch("");
              }}
            />

            <div className="grid grid-cols-1 lg:grid-cols-15 gap-4 items-start">
              {/* ── Left Column: Prediction Table ── */}
              <div className="lg:col-span-8 xl:col-span-10 min-w-0 flex flex-col gap-4">
                {loadError && (
                  <div role="alert" className="border-2 border-red-600 bg-red-50 p-4 font-semibold text-red-900">
                    {loadError}
                  </div>
                )}

                {loading ? (
                  <div className="py-20 text-center font-semibold text-gray-500">
                    Loading current-term projections...
                  </div>
                ) : loadError ? null : !selectedPeriodId ? (
                  <Card className="border-2 border-black bg-white p-6 text-center font-semibold text-gray-700">
                    Select an academic term to view projections.
                  </Card>
                ) : assignedScopes.length === 0 ? (
                  <div role="alert" className="border-2 border-red-600 bg-red-50 p-6 font-semibold flex flex-col items-start gap-4">
                    <p className="text-red-950 font-bold">
                      This subject is not assigned to you or you do not have permission to access it in the selected term.
                    </p>
                    <Button asChild variant="outline" className="border-2 border-black font-bold">
                      <Link to="/teacher/predictions">Return to AI Predictions</Link>
                    </Button>
                  </div>
                ) : rows.length === 0 ? (
                  <TeacherEmptyState
                    icon={<TrendingUp />}
                    title={`No predictions available for ${subjectDisplayName}`}
                    description="There are currently no generated predictions for this subject across your assigned sections in the selected term."
                  />
                ) : (
                  <PredictionTable
                    items={data.items}
                    total={data.total}
                    limit={Math.max(10, data.total)}
                    offset={0}
                    hideSubject
                    hidePagination
                    currentTerm
                    onSort={() => undefined}
                    onPageChange={() => undefined}
                    onRowClick={(predictionId) =>
                      setSelected(rows.find((row) => row.prediction_id === predictionId) || null)
                    }
                  />
                )}
              </div>

              {/* ── Right Column: Section-by-Section Health ── */}
              <aside className="lg:col-span-4 xl:col-span-5 min-w-0 lg:sticky lg:top-4 flex flex-col gap-4">
                <Card className="flex flex-col justify-between p-4 sm:p-5 border-2 border-black bg-background">
                  <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between">
                    <Card.Title className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                      Section-by-Section Health
                    </Card.Title>
                  </Card.Header>

                  <Card.Content className="flex flex-col gap-3 p-0">
                    {(() => {
                      if (isHealthLoading) {
                        return (
                          <div className="flex flex-col gap-2 p-2">
                            <div className="h-20 animate-pulse bg-black/5 rounded border border-black/20" />
                          </div>
                        );
                      }

                      if (sections.length === 0) {
                        return (
                          <p className="border-2 border-dashed border-black/30 p-4 text-center text-xs font-medium text-muted-foreground">
                            No section health data available for this subject.
                          </p>
                        );
                      }

                      const displayed = showAllSectionHealth ? sections : sections.slice(0, 2);

                      return (
                        <>
                          {displayed.map((sec, idx) => (
                            <Card
                              key={sec.class_id ? `${sec.class_id}-${sec.subject_id}-${idx}` : idx}
                              className="shadow-none p-3 text-xs hover:bg-retro hover:-translate-y-0.5 cursor-pointer transition-all border-2 border-black"
                              onClick={() => {
                                const targetSubjectId = routeSubjectId ?? sec.subject_id;
                                if (sec.class_id && targetSubjectId) {
                                  navigate(`/teacher/predictions/subject/${targetSubjectId}/section/${sec.class_id}`);
                                } else if (sec.class_id) {
                                  navigate(`/teacher/predictions/${sec.grade_level ?? 0}/${sec.class_id}`);
                                }
                              }}
                            >
                              {/* Section name & badge & student count */}
                              <div className="flex items-center justify-between gap-2 mb-2.5">
                                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                  <span className="font-bold text-base text-foreground truncate">
                                    {sec.section_name}
                                  </span>
                                </div>
                                <span className="font-semibold text-xs text-muted-foreground shrink-0">
                                  {sec.student_count} Students
                                </span>
                              </div>

                              {/* Task completion & attendance progress in vertical form */}
                              <div className="flex flex-col gap-2 mb-2.5">
                                <div className="space-y-1">
                                  <div className="flex justify-between text-xs">
                                    <span className="text-foreground font-medium">
                                      Task Completion
                                    </span>
                                    <span className="font-semibold">
                                      {sec.completion_rate_percent ?? 0}%
                                    </span>
                                  </div>
                                  <Progress
                                    value={sec.completion_rate_percent ?? 0}
                                    className="h-2"
                                  />
                                </div>

                                <div className="space-y-1">
                                  <div className="flex justify-between text-xs">
                                    <span className="text-foreground font-medium">
                                      Attendance
                                    </span>
                                    <span className="font-semibold">
                                      {sec.attendance_rate_percent != null
                                        ? `${sec.attendance_rate_percent}%`
                                        : "%"}
                                    </span>
                                  </div>
                                  <Progress
                                    value={sec.attendance_rate_percent ?? 0}
                                    className="h-2"
                                  />
                                </div>
                              </div>

                              {/* Bottom Info Bar */}
                              <div className="flex flex-col gap-1.5 pt-1 text-xs text-muted-foreground">
                                <div className="flex items-center justify-between gap-1 flex-wrap">
                                  <div className="flex items-center gap-1">
                                    <span className="text-foreground font-semibold text-[11px]">
                                      Class Average:
                                    </span>
                                    <Badge
                                      variant={
                                        sec.avg_score_percent == null || sec.avg_score_percent < 75
                                          ? "destructive"
                                          : sec.avg_score_percent > 87
                                            ? "success"
                                            : "surface"
                                      }
                                      size="sm"
                                      className="px-1.5 py-0.2 text-[10px] font-bold"
                                    >
                                      {sec.avg_score_percent != null ? `${sec.avg_score_percent}%` : "%"}
                                    </Badge>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="text-foreground font-semibold text-[11px]">
                                      Passing Rate:
                                    </span>
                                    <Badge
                                      variant={
                                        sec.passing_rate_percent == null || sec.passing_rate_percent < 75
                                          ? "destructive"
                                          : sec.passing_rate_percent > 87
                                            ? "success"
                                            : "surface"
                                      }
                                      size="sm"
                                      className="px-1.5 py-0.2 text-[10px] font-bold"
                                    >
                                      {sec.passing_rate_percent != null ? `${sec.passing_rate_percent}%` : "%"}
                                    </Badge>
                                  </div>
                                </div>
                              </div>
                            </Card>
                          ))}
                          <div className="flex flex-col gap-2">
                            {sections.length > 2 && (
                              <Button
                                variant="secondary"
                                size="sm"
                                autoIcon={false}
                                onClick={() => setShowAllSectionHealth((prev) => !prev)}
                                className="self-end text-xs font-semibold px-2.5 py-1 h-7 shadow-none"
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

                {/* Scored quiz lesson performance */}
                <Card className="flex flex-col p-4 sm:p-5 min-h-62 border-2 border-black bg-background">
                  <Card.Header className="mb-0 p-0 flex flex-row items-center justify-between">
                    <Card.Title className="text-base font-bold text-foreground sm:text-lg">
                      Lesson Performance
                    </Card.Title>
                  </Card.Header>

                  <Card.Content className="flex flex-col justify-between gap-2.5 p-0 h-full">
                    <div className="flex flex-col gap-2.5">
                      {!lessonSubject?.items.length && (
                        <Empty className="rounded! bg-retro shadow-none hover:shadow-none py-6 [&_p]:text-xs sm:[&_p]:text-sm [&_p]:font-medium [&_p]:text-muted-foreground">
                          <Empty.Content>
                            <Empty.Icon>
                              <IconContainer className="bg-primary rounded-none">
                                <BookOpen className="size-6 text-foreground" />
                              </IconContainer>
                            </Empty.Icon>
                            <Empty.Title className="text-base! font-medium">
                              {emptyLessonMessage(!lessonSubject
                                ? "No subjects assigned for this academic period."
                                : lessonSubject.coverage.scored_mapped_response_count === 0
                                  ? "No scored quiz answers linked to lessons for this subject."
                                  : `Not enough evidence yet. Each lesson needs scores from at least ${lessonPerformance?.policy.min_learners ?? 3} learners across ${lessonPerformance?.policy.min_questions ?? 3} questions.`)}
                            </Empty.Title>
                          </Empty.Content>
                        </Empty>
                      )}
                      {lessonSubject?.items.slice(0, 5).map((item) => (
                        <div
                          key={item.lesson_id}
                          title={`Points earned / points available. ${item.scored_response_count} scored responses · ${item.learner_count} learners · ${item.question_count} questions.`}
                          className="flex items-center justify-between gap-3 text-xs sm:text-sm"
                        >
                          <span className="font-medium text-foreground/90 shrink-0 w-24 truncate">
                            {item.title}
                          </span>
                          <Progress value={item.performance_percent} className="h-2.5 flex-1" />
                          <span className="font-semibold text-foreground text-right w-10 shrink-0">
                            {item.performance_percent}%
                          </span>
                        </div>
                      ))}
                    </div>
                    {lessonSubject && (
                      <Card.Description className="text-xs text-muted-foreground -mb-2">
                        {lessonSubject.coverage.scored_mapped_response_count} scored lesson-linked responses. {lessonSubject.coverage.ungraded_response_count} awaiting scores.
                        {lessonSubject.warnings.map((warning, index) => (
                          <span key={`${warning.code}-${index}`}> {warning.message}</span>
                        ))}
                      </Card.Description>
                    )}
                  </Card.Content>
                </Card>
              </aside>
            </div>
          </div>
        </div>
      </div>

      <PredictionDetailSheet
        predictionId={selected?.prediction_id ?? null}
        currentTermPrediction={selected}
        candidateId={candidateId}
        activeInterventionId={activeInterventionId}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </AppLayout>
  );
}
