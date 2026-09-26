import { useCallback, useEffect, useState } from "react";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { OverviewCard } from "@/components/overview-cards";
import { Button } from "@/components/retroui/Button";
import { Tabs } from "@/components/retroui/Tabs";
import { useAuth } from "@/context/AuthContext";
import DevelopmentCurrentTermPanel from "@/components/predictions/development-current-term-panel";
import { cn } from "@/lib/utils";
import PredictionFilters from "@/components/predictions/prediction-filters";
import PredictionTable from "@/components/predictions/prediction-table";
import PredictionDetailSheet from "@/components/predictions/prediction-detail-sheet";
import { useTeacherCandidateShortcut } from "@/components/predictions/use-teacher-candidate-shortcut";
import { PredictionGradeSection } from "@/components/predictions/prediction-grade-section";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import type {
  DashboardAtRiskResponse,
  DashboardFilters,
  DashboardGradeGroupSummary,
  DashboardQueryParams,
  RiskSummary,
} from "@/lib/prediction-api";
import {
  fetchDashboardAtRisk,
  fetchDashboardFilters,
  fetchDashboardGradeSummaries,
  developmentPredictionsAvailable,
} from "@/lib/prediction-api";
import {
  buildCurrentTermDashboard,
  buildCurrentTermGradeSummaries,
  currentTermRiskSummary,
  loadAuthorizedCurrentTermPredictions,
  currentTermPredictionErrorMessage,
  type AuthorizedCurrentTermRow,
} from "@/components/predictions/current-term-dashboard-adapter";

const EMPTY_SUMMARY: RiskSummary = {
  HIGH_RISK: 0,
  MODERATE_RISK: 0,
  NEEDS_MONITORING: 0,
  LOW_RISK: 0,
  INSUFFICIENT_DATA: 0,
  total: 0,
};

const RISK_CARDS = [
  {
    key: "HIGH_RISK" as const,
    label: "High Risk",
    activeClass: "bg-red-200 ring-2 ring-black",
  },
  {
    key: "MODERATE_RISK" as const,
    label: "Moderate Risk",
    activeClass: "bg-amber-200 ring-2 ring-black",
  },
  {
    key: "NEEDS_MONITORING" as const,
    label: "Needs Monitoring",
    activeClass: "bg-yellow-200 ring-2 ring-black",
  },
  {
    key: "LOW_RISK" as const,
    label: "Low Risk",
    activeClass: "bg-emerald-200 ring-2 ring-black",
  },
  {
    key: "INSUFFICIENT_DATA" as const,
    label: "Insufficient Data",
    activeClass: "bg-gray-200 ring-2 ring-black",
  },
];

export default function PredictionsDashboard() {
  const { role } = useAuth();
  return role === "teacher" ? <TeacherCurrentTermDashboard /> : <LegacyPredictionsDashboard />;
}

function LegacyPredictionsDashboard() {
  const { role } = useAuth();
  const canUseDevelopment = developmentPredictionsAvailable(role);
  const [view, setView] = useState<"legacy" | "development">("legacy");
  const { selectedPeriodId } = useAcademicPeriod();
  // ── State ──
  const [data, setData] = useState<DashboardAtRiskResponse | null>(null);
  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const [gradeSummaries, setGradeSummaries] = useState<DashboardGradeGroupSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter values
  const [gradeLevel, setGradeLevel] = useState<number | undefined>();
  const [classId, setClassId] = useState<number | undefined>();
  const [subjectId, setSubjectId] = useState<number | undefined>();
  const [riskLevel, setRiskLevel] = useState<string | undefined>();
  const [search, setSearch] = useState("");

  // Sorting & pagination
  const [sortBy, setSortBy] = useState<string | undefined>("student_name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [offset, setOffset] = useState(0);
  const limit = 5;

  // Detail sheet
  const [selectedPrediction, setSelectedPrediction] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // ── Fetch filters once ──
  useEffect(() => {
    fetchDashboardFilters().then(setFilters).catch(console.error);
  }, []);

  // The sidebar's selected term is the single source of truth.  Previously this
  // page defaulted to all terms while section drill-downs defaulted to the
  // sidebar term, so a card could describe a different set of predictions.
  useEffect(() => {
    fetchDashboardGradeSummaries({ academic_period_id: selectedPeriodId ?? undefined })
      .then(setGradeSummaries)
      .catch(console.error);
  }, [selectedPeriodId]);

  // ── Fetch data on filter/sort/page change ──
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: DashboardQueryParams = {
        grade_level: gradeLevel,
        class_id: classId,
        subject_id: subjectId,
        academic_period_id: selectedPeriodId ?? undefined,
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
  }, [gradeLevel, classId, subjectId, selectedPeriodId, riskLevel, search, sortBy, sortOrder, offset]);

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

  const handleRiskClick = (level: string | undefined) => {
    setRiskLevel(level);
    setOffset(0);
  };

  const handleClearAll = () => {
    setGradeLevel(undefined);
    setClassId(undefined);
    setSubjectId(undefined);
    setRiskLevel(undefined);
    setSearch("");
    setOffset(0);
  };

  const handleRowClick = (predictionId: number) => {
    setSelectedPrediction(predictionId);
    setSheetOpen(true);
  };

  // ── Dynamic Enrolled Cohort Summary ──
  const totalEnrolledStudents = gradeSummaries.reduce((acc, g) => acc + g.total_students, 0);
  const totalAtRisk = gradeSummaries.reduce((acc, g) => acc + g.at_risk_count, 0);
  const totalHighRisk = gradeSummaries.reduce(
    (acc, g) => acc + g.sections.reduce((sAcc, s) => sAcc + s.high_risk_count, 0),
    0
  );
  const totalModerateRisk = gradeSummaries.reduce(
    (acc, g) => acc + g.sections.reduce((sAcc, s) => sAcc + s.moderate_risk_count, 0),
    0
  );

  const isFilterActive = Boolean(
    gradeLevel !== undefined ||
    classId !== undefined ||
    subjectId !== undefined ||
    riskLevel !== undefined ||
    search.trim() !== ""
  );

  const enrolledSummary: RiskSummary = {
    HIGH_RISK: totalHighRisk,
    MODERATE_RISK: 0,
    NEEDS_MONITORING: totalModerateRisk,
    LOW_RISK: 0,
    INSUFFICIENT_DATA: Math.max(0, totalEnrolledStudents - totalAtRisk),
    total: totalEnrolledStudents,
  };

  const summary = (data?.risk_summary && data.risk_summary.total > 0)
    ? data.risk_summary
    : (enrolledSummary.total > 0 ? enrolledSummary : EMPTY_SUMMARY);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            {/* ── Header ── */}
            <header className="flex items-center gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <SidebarTrigger className="shrink-0 md:hidden" />
              <h1 className="text-xl font-bold sm:text-2xl md:text-4xl">AI Predictions</h1>
            </header>

            {canUseDevelopment && <Tabs tabs={[{ id: "legacy", label: "AI Predictions" }, { id: "development", label: "Current-Term Development" }]} activeTab={view} onTabChange={setView} />}

            {canUseDevelopment && view === "development" ? (
              <DevelopmentCurrentTermPanel
                periodId={selectedPeriodId}
                termName={filters?.terms.find((item) => item.academic_period_id === selectedPeriodId)?.term_label || "Current Term"}
                role={role === "admin" ? "admin" : "teacher"}
              />
            ) : (

            <div className="-mt-[1px] min-w-0 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
              {/* ── Risk Summary Cards ── */}
              <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:gap-4">
                {RISK_CARDS.map((card) => {
                  const count = summary[card.key];
                  const isActive = riskLevel === card.key;

                  return (
                    <button
                      key={card.key}
                      type="button"
                      onClick={() => handleRiskClick(isActive ? undefined : card.key)}
                      className="text-left cursor-pointer transition-transform active:translate-x-[2px] active:translate-y-[2px] w-full"
                    >
                      <OverviewCard
                        title={card.label}
                        count={String(count)}
                        className={cn(
                          "w-full border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all",
                          isActive
                            ? `${card.activeClass} shadow-none translate-x-[2px] translate-y-[2px]`
                            : "hover:translate-x-[-1px] hover:translate-y-[-1px]"
                        )}
                      />
                    </button>
                  );
                })}
              </div>

              {/* ── Main Content Area ── */}
              <div className="flex flex-col lg:flex-row gap-5">
                <div className="flex-1 flex flex-col gap-4 min-w-0">
                  <PredictionFilters
                    filters={filters}
                    gradeLevel={gradeLevel}
                    classId={classId}
                    subjectId={subjectId}
                    academicPeriodId={selectedPeriodId ?? undefined}
                    riskLevel={riskLevel}
                    search={search}
                    onGradeChange={(v) => {
                      setGradeLevel(v);
                      setOffset(0);
                    }}
                    onClassChange={(v) => {
                      setClassId(v);
                      setOffset(0);
                    }}
                    onSubjectChange={(v) => {
                      setSubjectId(v);
                      setOffset(0);
                    }}
                    hidePeriodFilter
                    onRiskChange={(v) => {
                      setRiskLevel(v);
                      setOffset(0);
                    }}
                    onSearchChange={handleSearchChange}
                    onClearAll={handleClearAll}
                  />

                  {isFilterActive ? (
                    /* ── Filtered Predictions View ── */
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between py-2 border-b-2 border-black">
                        <div>
                          <h2 className="text-xl font-black uppercase tracking-tight text-black">Filtered Student Predictions</h2>
                          <p className="text-xs text-gray-600 font-semibold">
                            Showing matching predictions for active criteria ({data?.total ?? 0} results)
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleClearAll}
                          className="border-2 border-black font-bold text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                        >
                          Clear Filters
                        </Button>
                      </div>

                      {loading && !data ? (
                        <div className="flex items-center justify-center py-20 text-gray-400">
                          Loading predictions...
                        </div>
                      ) : (
                        <PredictionTable
                          items={data?.items ?? []}
                          total={data?.total ?? 0}
                          limit={data?.limit ?? limit}
                          offset={data?.offset ?? 0}
                          sortBy={sortBy}
                          sortOrder={sortOrder}
                          onSort={handleSort}
                          onPageChange={setOffset}
                          onRowClick={handleRowClick}
                        />
                      )}
                    </div>
                  ) : (
                    /* ── Default Grade Cohort Overview ── */
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-1">
                        <div>
                          <h2 className="text-xl font-black tracking-tight text-black">Grade Cohort Summaries</h2>
                        </div>
                      </div>

                      {gradeSummaries.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {gradeSummaries.map((group) => (
                            <PredictionGradeSection key={group.grade_level} group={group} />
                          ))}
                        </div>
                      ) : (
                        <div className="p-6 bg-white border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] rounded-none text-center text-sm font-semibold text-gray-600">
                          No grade overview summaries found for this scope.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Detail Sheet ── */}
      {(!canUseDevelopment || view === "legacy") && <PredictionDetailSheet
        predictionId={selectedPrediction}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />}
    </AppLayout>
  );
}

function TeacherCurrentTermDashboard() {
  const { selectedPeriodId } = useAcademicPeriod();
  const [rows, setRows] = useState<AuthorizedCurrentTermRow[]>([]);
  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gradeLevel, setGradeLevel] = useState<number | undefined>();
  const [classId, setClassId] = useState<number | undefined>();
  const [subjectId, setSubjectId] = useState<number | undefined>();
  const [riskLevel, setRiskLevel] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AuthorizedCurrentTermRow | null>(null);
  const candidateId = useTeacherCandidateShortcut(selected);

  useEffect(() => {
    if (!selectedPeriodId) { Promise.resolve().then(() => setLoading(false)); return; }
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) { setLoading(true); setLoadError(null); } });
    loadAuthorizedCurrentTermPredictions(selectedPeriodId)
      .then((result) => { if (!cancelled) { setRows(result.rows); setFilters(result.filters); } })
      .catch((error: unknown) => { if (!cancelled) { setRows([]); setLoadError(currentTermPredictionErrorMessage(error)); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedPeriodId]);

  const scopedRows = rows.filter((row) =>
    (gradeLevel === undefined || row.grade_level === gradeLevel)
    && (classId === undefined || row.class_id === classId)
    && (subjectId === undefined || row.subject_id === subjectId));
  const data = buildCurrentTermDashboard(scopedRows, { search, interventionLevel: riskLevel, limit: Math.max(10, scopedRows.length) });
  const summary = currentTermRiskSummary(scopedRows);
  const gradeSummaries = buildCurrentTermGradeSummaries(rows);
  const filtered = gradeLevel !== undefined || classId !== undefined || subjectId !== undefined || riskLevel !== undefined || search.trim() !== "";

  return <AppLayout>
    <div className="flex flex-1 flex-col">
      <header className="flex items-center gap-2 bg-background px-3 py-3 sm:px-4 sm:py-4 md:px-6"><SidebarTrigger className="shrink-0 md:hidden" /><h1 className="text-xl font-bold sm:text-2xl md:text-4xl">AI Predictions</h1></header>
      <div className="-mt-[1px] min-w-0 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
          {RISK_CARDS.filter((card) => card.key !== "INSUFFICIENT_DATA").map((card) => <button key={card.key} type="button" onClick={() => setRiskLevel(riskLevel === card.key ? undefined : card.key)} className="w-full cursor-pointer text-left"><OverviewCard title={card.label} count={String(summary[card.key])} className={cn("w-full border-2 border-black shadow-[4px_4px_0px_#000]", riskLevel === card.key && card.activeClass)} /></button>)}
        </div>
        <div className="flex flex-col gap-4">
          <PredictionFilters
            filters={filters}
            gradeLevel={gradeLevel}
            classId={classId}
            subjectId={subjectId}
            academicPeriodId={selectedPeriodId ?? undefined}
            riskLevel={riskLevel}
            search={search}
            hidePeriodFilter
            riskSummary={summary}
            onGradeChange={setGradeLevel}
            onClassChange={setClassId}
            onSubjectChange={setSubjectId}
            onRiskChange={setRiskLevel}
            onSearchChange={setSearch}
            onClearAll={() => { setGradeLevel(undefined); setClassId(undefined); setSubjectId(undefined); setRiskLevel(undefined); setSearch(""); }}
          />
          {loadError && <div role="alert" className="border-2 border-red-600 bg-red-50 p-4 font-semibold">{loadError}</div>}
          {loading ? <div className="py-20 text-center font-semibold text-gray-500">Loading current-term projections...</div> : loadError ? null : !selectedPeriodId ? <div>Select an academic term to view projections.</div> : filtered ? <PredictionTable
            items={data.items} total={data.total} limit={Math.max(10, data.total)} offset={0} currentTerm hidePagination
            onSort={() => undefined} onPageChange={() => undefined}
            onRowClick={(predictionId) => setSelected(rows.find((row) => row.prediction_id === predictionId) || null)}
          /> : <div className="flex flex-col gap-3"><h2 className="text-xl font-black">Grade Cohort Summaries</h2>{gradeSummaries.length ? <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{gradeSummaries.map((group) => <PredictionGradeSection key={group.grade_level} group={group} />)}</div> : <div className="border-2 border-black bg-white p-6 text-center font-semibold">No current-term projections are available for this scope.</div>}</div>}
        </div>
      </div>
    </div>
    <PredictionDetailSheet predictionId={selected?.prediction_id ?? null} currentTermPrediction={selected} candidateId={candidateId} open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }} />
  </AppLayout>;
}
