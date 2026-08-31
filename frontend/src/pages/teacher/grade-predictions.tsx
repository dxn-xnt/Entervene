import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Text } from "@/components/retroui/Text";
import PredictionFilters from "@/components/predictions/prediction-filters";
import PredictionTable from "@/components/predictions/prediction-table";
import PredictionDetailSheet from "@/components/predictions/prediction-detail-sheet";
import { useAuth } from "@/context/AuthContext";
import type {
  DashboardAtRiskResponse,
  DashboardFilters,
  DashboardQueryParams,
} from "@/lib/prediction-api";
import {
  fetchDashboardAtRisk,
  fetchDashboardFilters,
} from "@/lib/prediction-api";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Card } from "@/components/retroui/Card";

export default function GradePredictions() {
  const { role } = useAuth();
  const baseRole = role === "admin" ? "admin" : "teacher";
  const { grade } = useParams<{ grade: string }>();

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
  const limit = 10;

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
                  <>
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item>
                      <Breadcrumb.Page className="text-2xl font-bold font-black">
                        Grade {grade}
                      </Breadcrumb.Page>
                    </Breadcrumb.Item>
                  </>
                </Breadcrumb.List>
              </Breadcrumb>
            </header>

            <div className="border-t-2 border-border -mt-[1px] py-4 px-4 md:px-6">
              {/* ── Main Content: Table on Left + Risk Cards on Right ── */}
              <div className="flex flex-col lg:flex-row gap-5 items-start">
              {/* Left Column: Filters + Table */}
              <div className="flex-1 flex flex-col gap-4 min-w-0 w-full">
                <PredictionFilters
                  filters={filters}
                  classId={classId}
                  subjectId={subjectId}
                  term={term}
                  riskLevel={riskLevel}
                  search={search}
                  hideClassFilter
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

              {/* Right Column: Risk Summary Cards */}
              <div className="w-full lg:w-64 xl:w-72 shrink-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-3">
                <Card className="flex flex-col gap-2">
                  <Text as="h4" className="font-head font-semibold">Sections</Text>
                  <div className="flex flex-col gap-2">
                    <Card className="shadow-none px-3 py-2">
                      <Text as="h6" className="font-head font-semibold">At Risk Students</Text>
                    </Card>
                    <Card className="shadow-none px-3 py-2">
                      <Text as="h6" className="font-head font-semibold">At Risk Students</Text>
                    </Card>
                    <Card className="shadow-none px-3 py-2">
                      <Text as="h6" className="font-head font-semibold">At Risk Students</Text>
                    </Card>
                  </div>
                </Card>
                <Card className="flex flex-col gap-2">
                  <div className="flex flex-row justify-between items-center">
                    <Text as="h4" className="font-head font-semibold">Subjects</Text>

                  </div>
                  <div className="flex flex-col gap-2">
                    <Card className="shadow-none px-3 py-2">
                      <Text as="h6" className="font-head font-semibold">At Risk Students</Text>
                    </Card>
                    <Card className="shadow-none px-3 py-2">
                      <Text as="h6" className="font-head font-semibold">At Risk Students</Text>
                    </Card>
                    <Card className="shadow-none px-3 py-2">
                      <Text as="h6" className="font-head font-semibold">At Risk Students</Text>
                    </Card>
                  </div>
                </Card>
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
