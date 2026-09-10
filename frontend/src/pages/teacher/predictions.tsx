import { useCallback, useEffect, useState } from "react";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { OverviewCard } from "@/components/overview-cards";
import { Button } from "@/components/retroui/Button";
import { cn } from "@/lib/utils";
import PredictionFilters from "@/components/predictions/prediction-filters";
import PredictionTable from "@/components/predictions/prediction-table";
import PredictionDetailSheet from "@/components/predictions/prediction-detail-sheet";
import { PredictionGradeSection } from "@/components/predictions/prediction-grade-section";
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
} from "@/lib/prediction-api";

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
    label: "Monitoring",
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
  // ── State ──
  const [data, setData] = useState<DashboardAtRiskResponse | null>(null);
  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const [gradeSummaries, setGradeSummaries] = useState<DashboardGradeGroupSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter values
  const [gradeLevel, setGradeLevel] = useState<number | undefined>();
  const [classId, setClassId] = useState<number | undefined>();
  const [subjectId, setSubjectId] = useState<number | undefined>();
  const [academicPeriodId, setAcademicPeriodId] = useState<number | undefined>();
  const [riskLevel, setRiskLevel] = useState<string | undefined>();
  const [search, setSearch] = useState("");

  // Sorting & pagination
  const [sortBy, setSortBy] = useState<string | undefined>("risk_score");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState(0);
  const limit = 5;

  // Detail sheet
  const [selectedPrediction, setSelectedPrediction] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // ── Fetch filters once ──
  useEffect(() => {
    fetchDashboardFilters().then(setFilters).catch(console.error);
  }, []);

  // ── Fetch dynamic grade summaries on period change ──
  useEffect(() => {
    fetchDashboardGradeSummaries({ academic_period_id: academicPeriodId })
      .then(setGradeSummaries)
      .catch(console.error);
  }, [academicPeriodId]);

  // ── Fetch data on filter/sort/page change ──
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: DashboardQueryParams = {
        grade_level: gradeLevel,
        class_id: classId,
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
  }, [gradeLevel, classId, subjectId, academicPeriodId, riskLevel, search, sortBy, sortOrder, offset]);

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
    setAcademicPeriodId(undefined);
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
    academicPeriodId !== undefined ||
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
            <header className="flex items-center gap-3 bg-background py-4 px-4 md:px-6">
              <SidebarTrigger className="md:hidden" />
              <h1 className="text-2xl md:text-4xl font-bold">AI Predictions</h1>
            </header>

            <div className="border-t-2 border-border -mt-[1px] py-4 px-4 md:px-6">
              {/* ── Risk Summary Cards ── */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-3">
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
                    academicPeriodId={academicPeriodId}
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
                          <h2 className="text-xl font-black uppercase tracking-tight text-black">Grade Cohort Summaries</h2>
                          <p className="text-xs text-gray-600 font-semibold">
                            Showing all {gradeSummaries.length} grade levels ({totalEnrolledStudents} actively enrolled students across 11 sections)
                          </p>
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
