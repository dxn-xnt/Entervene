import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import PredictionFilters from "@/components/predictions/prediction-filters";
import PredictionTable from "@/components/predictions/prediction-table";
import PredictionDetailSheet from "@/components/predictions/prediction-detail-sheet";
import { useTeacherCandidateShortcut } from "@/components/predictions/use-teacher-candidate-shortcut";
import { useAuth } from "@/context/AuthContext";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import type {
  DashboardAtRiskResponse,
  DashboardFilters,
  DashboardQueryParams,
  DashboardSubjectOption,
} from "@/lib/prediction-api";
import {
  fetchDashboardAtRisk,
  fetchDashboardFilters,
} from "@/lib/prediction-api";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Button } from "@/components/retroui/Button";
import {
  buildCurrentTermDashboard,
  loadAuthorizedCurrentTermPredictions,
  currentTermPredictionErrorMessage,
  type AuthorizedCurrentTermRow,
} from "@/components/predictions/current-term-dashboard-adapter";

export default function SectionPredictions() {
  const { role } = useAuth();
  return role === "teacher" ? <TeacherCurrentTermSectionPredictions /> : <LegacySectionPredictions />;
}

function LegacySectionPredictions() {
  const { role } = useAuth();
  const baseRole = role === "admin" ? "admin" : "teacher";
  const { grade, classId: classSlug } = useParams<{ grade: string; classId: string }>();

  const { selectedPeriodId } = useAcademicPeriod();

  // ── State ──
  const [data, setData] = useState<DashboardAtRiskResponse | null>(null);
  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const [loading, setLoading] = useState(true);

  // The sidebar's selected term is the single source of truth for every
  // prediction page and its drill-downs.
  const academicPeriodId = selectedPeriodId ?? undefined;

  // Filter values

  const [subjectId, setSubjectId] = useState<number | undefined>();
  const [riskLevel, setRiskLevel] = useState<string | undefined>();
  const [search, setSearch] = useState("");

  // Sorting & pagination
  const [sortBy, setSortBy] = useState<string | undefined>("student_name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [offset, setOffset] = useState(0);
  const limit = 10;

  // Detail sheet
  const [selectedPrediction, setSelectedPrediction] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Auto-open via search params (e.g. from dashboard)
  const [searchParams] = useSearchParams();
  const queryPredictionId = searchParams.get("predictionId");
  const queryStudentId = searchParams.get("studentId");
  const queryStudentName = searchParams.get("studentName");

  useEffect(() => {
    if (!data?.items?.length) return;
    if (queryPredictionId) {
      const match = data.items.find((item) => String(item.prediction_id) === queryPredictionId);
      if (match) {
        setSelectedPrediction(match.prediction_id);
        setSheetOpen(true);
        return;
      }
    }
    if (queryStudentId) {
      const match = data.items.find((item) => String(item.student_id) === queryStudentId);
      if (match) {
        setSelectedPrediction(match.prediction_id);
        setSheetOpen(true);
        return;
      }
    }
    if (queryStudentName) {
      const match = data.items.find((item) =>
        item.student_name.toLowerCase().includes(queryStudentName.toLowerCase())
      );
      if (match) {
        setSelectedPrediction(match.prediction_id);
        setSheetOpen(true);
        return;
      }
    }
    if (queryPredictionId || queryStudentId || queryStudentName) {
      setSelectedPrediction(data.items[0].prediction_id);
      setSheetOpen(true);
    }
  }, [data, queryPredictionId, queryStudentId, queryStudentName]);

  // Resolve numeric class ID from route param
  const resolvedClassId =
    classSlug && !isNaN(Number(classSlug))
      ? Number(classSlug)
      : filters?.classes.find(
        (c) => c.section_name.toLowerCase() === decodeURIComponent(classSlug || "").toLowerCase()
      )?.class_id;

  const sectionDisplayName =
    filters?.classes.find((c) => c.class_id === resolvedClassId)?.section_name ||
    (classSlug && isNaN(Number(classSlug)) ? decodeURIComponent(classSlug) : `Section ${classSlug}`);

  const numericGrade = grade ? Number(grade) : undefined;

  // ── Fetch scoped filters when class or period changes ──
  useEffect(() => {
    if (!resolvedClassId) {
      // If resolvedClassId is not yet resolved, fetch global filters to discover classes
      fetchDashboardFilters().then(setFilters).catch(console.error);
      return;
    }

    fetchDashboardFilters({
      class_id: resolvedClassId,
      academic_period_id: academicPeriodId,
    })
      .then(setFilters)
      .catch(console.error);
  }, [resolvedClassId, academicPeriodId]);

  // ── Compute sorted subjects ──
  // If a specific term is selected: period_index asc (nulls last) -> alphabetical
  // If "All Terms" (academicPeriodId === undefined): pure alphabetical fallback
  const sortedSubjects: DashboardSubjectOption[] = useMemo(() => {
    if (!filters?.subjects || filters.subjects.length === 0) return [];
    const list = [...filters.subjects];

    if (academicPeriodId !== undefined) {
      return list.sort((a, b) => {
        const aSlot = a.period_index;
        const bSlot = b.period_index;
        if (aSlot !== null && aSlot !== undefined && bSlot !== null && bSlot !== undefined) {
          if (aSlot !== bSlot) return aSlot - bSlot;
          return a.subject_name.localeCompare(b.subject_name);
        }
        if (aSlot !== null && aSlot !== undefined) return -1;
        if (bSlot !== null && bSlot !== undefined) return 1;
        return a.subject_name.localeCompare(b.subject_name);
      });
    }

    return list.sort((a, b) => a.subject_name.localeCompare(b.subject_name));
  }, [filters?.subjects, academicPeriodId]);

  // ── Sync active subject selection with sorted subjects list ──
  // Preserve current selection if still valid; otherwise default to first tab
  useEffect(() => {
    if (sortedSubjects.length === 0) {
      setSubjectId(undefined);
      return;
    }
    const exists = sortedSubjects.some((s) => s.subject_id === subjectId);
    if (!exists) {
      setSubjectId(sortedSubjects[0].subject_id);
      setOffset(0);
    }
  }, [sortedSubjects, subjectId]);

  // ── Fetch predictions data on filter/sort/page change ──
  const loadData = useCallback(async () => {
    // If filters loaded and there are 0 subjects, skip querying
    if (filters && sortedSubjects.length === 0) {
      setData(null);
      setLoading(false);
      return;
    }

    // Wait until subjectId is determined if subjects exist
    if (sortedSubjects.length > 0 && subjectId === undefined) {
      return;
    }

    setLoading(true);
    try {
      const params: DashboardQueryParams = {
        class_id: resolvedClassId,
        grade_level: numericGrade,
        subject_id: subjectId,
        academic_period_id: academicPeriodId,
        risk_level: riskLevel,
        search: search.trim() || undefined,
        sort_by: sortBy,
        sort_order: sortOrder,
        limit,
        offset,
      };

      const result = await fetchDashboardAtRisk(params);
      setData(result);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [
    resolvedClassId,
    numericGrade,
    subjectId,
    academicPeriodId,
    riskLevel,
    search,
    sortBy,
    sortOrder,
    offset,
    filters,
    sortedSubjects.length,
  ]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Debounce search
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimer) clearTimeout(searchTimer);
    setSearchTimer(
      setTimeout(() => {
        setOffset(0);
      }, 400),
    );
  };

  // ── Handlers ──
  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortOrder("desc");
    }
    setOffset(0);
  };

  const handleClearAll = () => {
    setRiskLevel(undefined);
    setSearch("");
    setOffset(0);
  };

  const handleRowClick = (predictionId: number) => {
    setSelectedPrediction(predictionId);
    setSheetOpen(true);
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            {/* ── Header ── */}
            <header className="flex items-center gap-3 bg-background py-4 px-4 md:px-6">
              <SidebarTrigger className="md:hidden" />
              <Breadcrumb>
                <Breadcrumb.List className="flex min-w-0 flex-nowrap items-center gap-2">
                  <Breadcrumb.Item>
                    <Breadcrumb.Link asChild>
                      <Link to={`/${baseRole}/predictions`}>AI Predictions</Link>
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  {grade && (
                    <>
                      <Breadcrumb.Separator />
                      <Breadcrumb.Item>
                        <Breadcrumb.Link asChild>
                          <Link to={`/${baseRole}/predictions/${grade}`}>Grade {grade}</Link>
                        </Breadcrumb.Link>
                      </Breadcrumb.Item>
                    </>
                  )}
                  {classSlug && (
                    <>
                      <Breadcrumb.Separator />
                      <Breadcrumb.Item>
                        <Breadcrumb.Page>
                          {sectionDisplayName}
                        </Breadcrumb.Page>
                      </Breadcrumb.Item>
                    </>
                  )}
                </Breadcrumb.List>
              </Breadcrumb>
            </header>

            <div className="border-t-2 border-border -mt-[1px] py-4 px-4 md:px-6">
              <div className="flex flex-col gap-4 w-full">
                {/* ── Filters Bar ── */}
                <PredictionFilters
                  filters={filters}
                  gradeLevel={numericGrade}
                  classId={resolvedClassId}
                  subjectId={subjectId}
                  academicPeriodId={academicPeriodId}
                  riskLevel={riskLevel}
                  search={search}
                  hideClassFilter
                  hideGradeFilter
                  hideSubjectFilter
                  hidePeriodFilter
                  riskSummary={data?.risk_summary}
                  onSubjectChange={(v) => {
                    setSubjectId(v);
                    setOffset(0);
                  }}
                  onRiskChange={(v) => {
                    setRiskLevel(v);
                    setOffset(0);
                  }}
                  onSearchChange={handleSearchChange}
                  onClearAll={handleClearAll}
                />

                {/* ── Subject Tabs ── */}
                {sortedSubjects.length > 0 && (
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    <span className="shrink-0 text-sm font-regular text-muted-foreground">
                      Subject:
                    </span>
                    {sortedSubjects.map((s) => (
                      <Button
                        key={s.subject_id}
                        autoIcon={false}
                        variant={
                          subjectId === s.subject_id
                            ? "default"
                            : "outline"
                        }
                        size="sm"
                        onClick={() => {
                          setSubjectId(s.subject_id);
                          setOffset(0);
                        }}
                        className="shrink-0 border-black shadow-none"
                      >
                        {s.subject_name}
                      </Button>
                    ))}
                  </div>
                )}

                {/* ── Table & Empty States (Full Width) ── */}
                {loading && !data ? (
                  <div className="flex items-center justify-center py-20 text-gray-400 font-semibold">
                    Loading {sectionDisplayName} predictions...
                  </div>
                ) : sortedSubjects.length === 0 ? (
                  <div className="p-8 bg-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-center">
                    <p className="text-lg font-bold text-gray-900">
                      No subjects available for {sectionDisplayName}.
                    </p>
                    <p className="text-sm text-gray-600 mt-1 max-w-md mx-auto">
                      There are no subjects offered or assigned for this section in the selected term.
                    </p>
                  </div>
                ) : (
                  <PredictionTable
                    items={data?.items ?? []}
                    total={data?.total ?? 0}
                    limit={data?.limit ?? limit}
                    offset={data?.offset ?? 0}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    hideClass
                    hideSubject
                    onSort={handleSort}
                    onPageChange={setOffset}
                    onRowClick={handleRowClick}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Detail Sheet ── */}
      <PredictionDetailSheet
        predictionId={selectedPrediction}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </AppLayout>
  );
}

function TeacherCurrentTermSectionPredictions() {
  const { grade, classId: classSlug } = useParams<{ grade: string; classId: string }>();
  const { selectedPeriodId } = useAcademicPeriod();
  const resolvedClassId = classSlug && !Number.isNaN(Number(classSlug)) ? Number(classSlug) : undefined;
  const [rows, setRows] = useState<AuthorizedCurrentTermRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<number | undefined>();
  const [riskLevel, setRiskLevel] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AuthorizedCurrentTermRow | null>(null);
  const candidateId = useTeacherCandidateShortcut(selected);

  // Auto-open via search params (e.g. from dashboard)
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
        return name ? (name.includes(normalizedQuery) || normalizedQuery.includes(name)) : false;
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
    if (!selectedPeriodId || !resolvedClassId) {
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

    loadAuthorizedCurrentTermPredictions(selectedPeriodId, { classId: resolvedClassId })
      .then(({ rows: loaded }) => {
        if (!cancelled) setRows(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRows([]);
          setLoadError(currentTermPredictionErrorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [resolvedClassId, selectedPeriodId]);

  const subjects = useMemo(
    () => [
      ...new Map(
        rows.map((row) => [
          row.subject_id,
          { subject_id: row.subject_id, subject_name: row.subject_name },
        ])
      ).values(),
    ],
    [rows]
  );
  const effectiveSubjectId = subjects.some((item) => item.subject_id === subjectId)
    ? subjectId
    : subjects[0]?.subject_id;
  const scopedRows = rows.filter(
    (row) => effectiveSubjectId === undefined || row.subject_id === effectiveSubjectId
  );
  const data = buildCurrentTermDashboard(scopedRows, {
    search,
    interventionLevel: riskLevel,
    limit: Math.max(10, scopedRows.length),
  });
  const sectionName = rows[0]?.class_name || `Section ${classSlug}`;

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
                <Breadcrumb.Link asChild>
                  <Link to={`/teacher/predictions/${grade}`}>Grade {grade}</Link>
                </Breadcrumb.Link>
              </Breadcrumb.Item>
              <Breadcrumb.Separator />
              <Breadcrumb.Item>
                <Breadcrumb.Page>{sectionName}</Breadcrumb.Page>
              </Breadcrumb.Item>
            </Breadcrumb.List>
          </Breadcrumb>
        </header>

        <div className="-mt-[1px] border-t-2 border-border px-4 py-4 md:px-6">
          <div className="flex flex-col gap-4">
            <PredictionFilters
              filters={null}
              gradeLevel={grade ? Number(grade) : undefined}
              classId={resolvedClassId}
              subjectId={effectiveSubjectId}
              academicPeriodId={selectedPeriodId ?? undefined}
              riskLevel={riskLevel}
              search={search}
              hideClassFilter
              hideGradeFilter
              hideSubjectFilter
              hidePeriodFilter
              riskSummary={data.risk_summary}
              onSubjectChange={setSubjectId}
              onRiskChange={setRiskLevel}
              onSearchChange={setSearch}
              onClearAll={() => {
                setRiskLevel(undefined);
                setSearch("");
              }}
            />

            {subjects.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <span className="shrink-0 text-sm font-regular text-muted-foreground">
                  Subject:
                </span>
                {subjects.map((subject) => (
                  <Button
                    key={subject.subject_id}
                    autoIcon={false}
                    variant={
                      effectiveSubjectId === subject.subject_id
                        ? "default"
                        : "outline"
                    }
                    size="sm"
                    onClick={() => setSubjectId(subject.subject_id)}
                    className="shrink-0 border-black shadow-none"
                  >
                    {subject.subject_name}
                  </Button>
                ))}
              </div>
            )}

            {loadError && (
              <div role="alert" className="border-2 border-red-600 bg-red-50 p-4 font-semibold">
                {loadError}
              </div>
            )}

            {loading ? (
              <div className="py-20 text-center font-semibold text-gray-500">
                Loading current-term projections...
              </div>
            ) : loadError ? null : (
              <PredictionTable
                items={data.items}
                total={data.total}
                limit={Math.max(10, data.total)}
                offset={0}
                hideClass
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
        </div>
      </div>

      <PredictionDetailSheet
        predictionId={selected?.prediction_id ?? null}
        currentTermPrediction={selected}
        candidateId={candidateId}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </AppLayout>
  );
}
