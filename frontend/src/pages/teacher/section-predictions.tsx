import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import PredictionFilters from "@/components/predictions/prediction-filters";
import PredictionTable from "@/components/predictions/prediction-table";
import PredictionDetailSheet from "@/components/predictions/prediction-detail-sheet";
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

export default function SectionPredictions() {
  const { role } = useAuth();
  const baseRole = role === "admin" ? "admin" : "teacher";
  const { grade, classId: classSlug } = useParams<{ grade: string; classId: string }>();

  const { selectedPeriodId } = useAcademicPeriod();

  // ── State ──
  const [data, setData] = useState<DashboardAtRiskResponse | null>(null);
  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const [loading, setLoading] = useState(true);

  // Filter values
  const [academicPeriodId, setAcademicPeriodId] = useState<number | undefined>(
    selectedPeriodId ?? undefined
  );
  const [termInitialized, setTermInitialized] = useState(false);

  // Sync initial term from AcademicPeriodContext once available
  useEffect(() => {
    if (!termInitialized && selectedPeriodId) {
      setAcademicPeriodId(selectedPeriodId);
      setTermInitialized(true);
    }
  }, [selectedPeriodId, termInitialized]);

  const [subjectId, setSubjectId] = useState<number | undefined>();
  const [riskLevel, setRiskLevel] = useState<string | undefined>();
  const [search, setSearch] = useState("");

  // Sorting & pagination
  const [sortBy, setSortBy] = useState<string | undefined>("risk_score");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState(0);
  const limit = 10;

  // Detail sheet
  const [selectedPrediction, setSelectedPrediction] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

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
                <Breadcrumb.List className="flex items-center gap-2 text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-black [&_a]:!text-muted-foreground [&_a]:!text-inherit [&_a]:!font-inherit [&_button]:!text-muted-foreground [&_button]:!text-inherit [&_button]:!font-inherit [&_[aria-current=page]]:!text-black [&_[aria-current=page]]:!text-inherit [&_[aria-current=page]]:!font-extrabold">
                  <Breadcrumb.Item>
                    <Breadcrumb.Link asChild className="text-2xl md:text-4xl font-bold">
                      <Link to={`/${baseRole}/predictions`}>AI Predictions</Link>
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  {grade && (
                    <>
                      <Breadcrumb.Separator />
                      <Breadcrumb.Item>
                        <Breadcrumb.Link asChild className="text-2xl font-bold">
                          <Link to={`/${baseRole}/predictions/${grade}`}>Grade {grade}</Link>
                        </Breadcrumb.Link>
                      </Breadcrumb.Item>
                    </>
                  )}
                  {classSlug && (
                    <>
                      <Breadcrumb.Separator />
                      <Breadcrumb.Item>
                        <Breadcrumb.Page className="text-2xl font-bold font-black">
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
                  riskSummary={data?.risk_summary}
                  onSubjectChange={(v) => {
                    setSubjectId(v);
                    setOffset(0);
                  }}
                  onPeriodChange={(v) => {
                    setAcademicPeriodId(v);
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
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                    {sortedSubjects.map((s) => {
                      const isActive = subjectId === s.subject_id;
                      return (
                        <button
                          key={s.subject_id}
                          type="button"
                          onClick={() => {
                            setSubjectId(s.subject_id);
                            setOffset(0);
                          }}
                          className={cn(
                            "px-4 py-1.5 text-xs md:text-sm font-bold rounded-md whitespace-nowrap transition-all cursor-pointer border-2",
                            isActive
                              ? "bg-yellow-400 border-black text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                              : "bg-white border-transparent text-gray-700 hover:bg-gray-100 hover:border-black"
                          )}
                        >
                          {s.subject_name}
                        </button>
                      );
                    })}
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
