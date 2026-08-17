import { useCallback, useEffect, useState } from "react";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import RiskSummaryCards from "@/components/predictions/RiskSummaryCards";
import RiskDistributionChart from "@/components/predictions/RiskDistributionChart";
import PredictionFilters from "@/components/predictions/PredictionFilters";
import PredictionTable from "@/components/predictions/PredictionTable";
import PredictionDetailSheet from "@/components/predictions/PredictionDetailSheet";
import type {
  DashboardAtRiskResponse,
  DashboardFilters,
  DashboardQueryParams,
  RiskSummary,
} from "@/lib/prediction-api";
import {
  fetchDashboardAtRisk,
  fetchDashboardFilters,
} from "@/lib/prediction-api";

const EMPTY_SUMMARY: RiskSummary = {
  HIGH_RISK: 0,
  MODERATE_RISK: 0,
  NEEDS_MONITORING: 0,
  LOW_RISK: 0,
  INSUFFICIENT_DATA: 0,
  total: 0,
};

export default function PredictionsDashboard() {
  // ── State ──
  const [data, setData] = useState<DashboardAtRiskResponse | null>(null);
  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const [loading, setLoading] = useState(true);

  // Filter values
  const [classId, setClassId] = useState<number | undefined>();
  const [subjectId, setSubjectId] = useState<number | undefined>();
  const [term, setTerm] = useState<number | undefined>();
  const [riskLevel, setRiskLevel] = useState<string | undefined>();
  const [search, setSearch] = useState("");

  // Sorting & pagination
  const [sortBy, setSortBy] = useState<string | undefined>("risk_score");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState(0);
  const limit = 25;

  // Detail sheet
  const [selectedPrediction, setSelectedPrediction] = useState<number | null>(
    null,
  );
  const [sheetOpen, setSheetOpen] = useState(false);

  // ── Fetch filters once ──
  useEffect(() => {
    fetchDashboardFilters().then(setFilters).catch(console.error);
  }, []);

  // ── Fetch data on filter/sort/page change ──
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: DashboardQueryParams = {
        class_id: classId,
        subject_id: subjectId,
        term,
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
  }, [classId, subjectId, term, riskLevel, search, sortBy, sortOrder, offset]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Debounce search
  const [searchTimer, setSearchTimer] = useState<ReturnType<
    typeof setTimeout
  > | null>(null);
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
    setClassId(undefined);
    setSubjectId(undefined);
    setTerm(undefined);
    setRiskLevel(undefined);
    setSearch("");
    setOffset(0);
  };

  const handleRowClick = (predictionId: number) => {
    setSelectedPrediction(predictionId);
    setSheetOpen(true);
  };

  const summary = data?.risk_summary ?? EMPTY_SUMMARY;

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-3 px-4 py-4 md:px-6 md:py-5">
            {/* ── Header ── */}
            <header className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" />
              <h1 className="text-2xl md:text-4xl font-bold">AI Prediction Dashboard</h1>
            </header>

            <div className="-mx-4 md:-mx-6 border-b-2 border-border -mt-[1px]" />

            {/* ── Risk Summary Cards ── */}
            <RiskSummaryCards
              summary={summary}
              onRiskClick={handleRiskClick}
              activeRisk={riskLevel}
            />

            {/* ── Chart + Filters row ── */}
            <div className="flex flex-col lg:flex-row gap-5">
              {/* Filters + table */}
              <div className="flex-1 flex flex-col gap-4 min-w-0">
                <PredictionFilters
                  filters={filters}
                  classId={classId}
                  subjectId={subjectId}
                  term={term}
                  riskLevel={riskLevel}
                  search={search}
                  onClassChange={(v) => {
                    setClassId(v);
                    setOffset(0);
                  }}
                  onSubjectChange={(v) => {
                    setSubjectId(v);
                    setOffset(0);
                  }}
                  onTermChange={(v) => {
                    setTerm(v);
                    setOffset(0);
                  }}
                  onRiskChange={(v) => {
                    setRiskLevel(v);
                    setOffset(0);
                  }}
                  onSearchChange={handleSearchChange}
                  onClearAll={handleClearAll}
                />

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
