import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Text } from "@/components/retroui/Text";
import { Badge } from "@/components/retroui/Badge";
import PredictionFilters from "@/components/predictions/prediction-filters";
import PredictionTable from "@/components/predictions/prediction-table";
import PredictionDetailSheet from "@/components/predictions/prediction-detail-sheet";
import { useAuth } from "@/context/AuthContext";
import type {
  DashboardAtRiskResponse,
  DashboardFilters,
  DashboardGradeGroupSummary,
  DashboardQueryParams,
} from "@/lib/prediction-api";
import {
  fetchDashboardAtRisk,
  fetchDashboardFilters,
  fetchDashboardGradeSummaries,
} from "@/lib/prediction-api";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Card } from "@/components/retroui/Card";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import {
  buildCurrentTermDashboard,
  buildCurrentTermGradeSummaries,
  loadAuthorizedCurrentTermPredictions,
  type AuthorizedCurrentTermRow,
} from "@/components/predictions/current-term-dashboard-adapter";

export default function GradePredictions() {
  const { role } = useAuth();
  return role === "teacher" ? <TeacherCurrentTermGradePredictions /> : <LegacyGradePredictions />;
}

function LegacyGradePredictions() {
  const { role } = useAuth();
  const baseRole = role === "admin" ? "admin" : "teacher";
  const { grade } = useParams<{ grade: string }>();
  const navigate = useNavigate();
  const { selectedPeriodId } = useAcademicPeriod();

  const numericGrade = grade ? Number(grade) : undefined;

  // ── State ──
  const [data, setData] = useState<DashboardAtRiskResponse | null>(null);
  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const [gradeSummaries, setGradeSummaries] = useState<DashboardGradeGroupSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter values
  const [classId, setClassId] = useState<number | undefined>();
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

  // ── Fetch filters and grade summaries ──
  useEffect(() => {
    fetchDashboardFilters().then(setFilters).catch(console.error);
  }, []);

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
        grade_level: numericGrade,
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
  }, [numericGrade, classId, subjectId, selectedPeriodId, riskLevel, search, sortBy, sortOrder, offset]);

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

  const currentGradeGroup = gradeSummaries.find((g) => g.grade_level === numericGrade);

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
                  <>
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item>
                      <Breadcrumb.Page>
                        Grade {grade}
                      </Breadcrumb.Page>
                    </Breadcrumb.Item>
                  </>
                </Breadcrumb.List>
              </Breadcrumb>
            </header>

            <div className="border-t-2 border-border -mt-[1px] py-4 px-4 md:px-6">
              {/* ── Main Content: Table on Left + Sections on Right ── */}
              <div className="flex flex-col lg:flex-row gap-5 items-start">
                {/* Left Column: Filters + Table */}
                <div className="flex-1 flex flex-col gap-4 min-w-0 w-full">
                  <PredictionFilters
                    filters={filters}
                    gradeLevel={numericGrade}
                    classId={classId}
                    subjectId={subjectId}
                    academicPeriodId={selectedPeriodId ?? undefined}
                    riskLevel={riskLevel}
                    search={search}
                    hideGradeFilter
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

                  {loading && !data ? (
                    <div className="flex items-center justify-center py-20 text-gray-400 font-semibold">
                      Loading Grade {grade} predictions...
                    </div>
                  ) : (data?.items.length ?? 0) === 0 ? (
                    <div className="p-8 bg-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-center">
                      <p className="text-lg font-bold text-gray-900">
                        No at-risk predictions recorded yet for Grade {grade}.
                      </p>
                      <p className="text-sm text-gray-600 mt-1 max-w-md mx-auto">
                        Predictions for this grade level will appear once the AI model generates risk assessments for its active classes and subjects.
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
                      onSort={handleSort}
                      onPageChange={setOffset}
                      onRowClick={handleRowClick}
                    />
                  )}
                </div>

                {/* Right Column: Sections Overview */}
                <div className="w-full lg:w-72 xl:w-80 shrink-0 flex flex-col gap-3">
                  <Card className="flex flex-col gap-3 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] bg-white p-4">
                    <div className="flex items-center justify-between border-b-2 border-black pb-2">
                      <Text as="h4" className="font-head font-bold text-base">Grade {grade} Sections</Text>
                      <Badge size="sm" variant="surface" className="font-bold">
                        {currentGradeGroup?.sections.length ?? 0}
                      </Badge>
                    </div>

                    <div className="flex flex-col gap-2">
                      {currentGradeGroup && currentGradeGroup.sections.length > 0 ? (
                        currentGradeGroup.sections.map((sec) => (
                          <div
                            key={sec.class_id}
                            onClick={() => navigate(`/${baseRole}/predictions/${grade}/${sec.class_id}`)}
                            className="cursor-pointer border-2 border-black p-2.5 bg-yellow-50 hover:bg-yellow-100 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex items-center justify-between"
                          >
                            <div>
                              <p className="font-bold text-sm text-black">{sec.section_name}</p>
                              <p className="text-xs text-gray-600 font-medium">
                                {sec.total_students} {sec.total_students === 1 ? "student" : "students"}
                              </p>
                            </div>
                            <div className="text-right">
                              <span className={`text-xs font-black px-2 py-0.5 border border-black rounded ${sec.at_risk_count > 0 ? "bg-red-200 text-red-900" : "bg-emerald-100 text-emerald-900"}`}>
                                {sec.at_risk_count} at risk
                              </span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-gray-500 italic py-2">
                          No sections enrolled or assigned for Grade {grade}.
                        </p>
                      )}
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

function TeacherCurrentTermGradePredictions() {
  const { grade } = useParams<{ grade: string }>();
  const { selectedPeriodId } = useAcademicPeriod();
  const numericGrade = grade ? Number(grade) : undefined;
  const [rows, setRows] = useState<AuthorizedCurrentTermRow[]>([]);
  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const [loading, setLoading] = useState(true);
  const [classId, setClassId] = useState<number | undefined>();
  const [subjectId, setSubjectId] = useState<number | undefined>();
  const [riskLevel, setRiskLevel] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AuthorizedCurrentTermRow | null>(null);

  useEffect(() => {
    if (!selectedPeriodId || numericGrade === undefined) return;
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) setLoading(true); });
    loadAuthorizedCurrentTermPredictions(selectedPeriodId, { gradeLevel: numericGrade })
      .then((result) => { if (!cancelled) { setRows(result.rows); setFilters(result.filters); } })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [numericGrade, selectedPeriodId]);

  const scopedRows = rows.filter((row) => (classId === undefined || row.class_id === classId) && (subjectId === undefined || row.subject_id === subjectId));
  const data = buildCurrentTermDashboard(scopedRows, { search, interventionLevel: riskLevel, limit: Math.max(10, scopedRows.length) });
  const gradeSummary = buildCurrentTermGradeSummaries(rows)[0];

  return <AppLayout>
    <div className="flex flex-1 flex-col">
      <header className="flex items-center gap-3 bg-background px-4 py-4 md:px-6"><SidebarTrigger className="md:hidden" /><Breadcrumb><Breadcrumb.List><Breadcrumb.Item><Breadcrumb.Link asChild><Link to="/teacher/predictions">AI Predictions</Link></Breadcrumb.Link></Breadcrumb.Item><Breadcrumb.Separator /><Breadcrumb.Item><Breadcrumb.Page>Grade {grade}</Breadcrumb.Page></Breadcrumb.Item></Breadcrumb.List></Breadcrumb></header>
      <div className="-mt-[1px] border-t-2 border-border px-4 py-4 md:px-6">
        <div className="flex flex-col items-start gap-5 lg:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <PredictionFilters filters={filters} gradeLevel={numericGrade} classId={classId} subjectId={subjectId} academicPeriodId={selectedPeriodId ?? undefined} riskLevel={riskLevel} search={search} hideGradeFilter hidePeriodFilter riskSummary={data.risk_summary} onClassChange={setClassId} onSubjectChange={setSubjectId} onRiskChange={setRiskLevel} onSearchChange={setSearch} onClearAll={() => { setClassId(undefined); setSubjectId(undefined); setRiskLevel(undefined); setSearch(""); }} />
            {loading ? <div className="py-20 text-center font-semibold text-gray-500">Loading Grade {grade} projections...</div> : <PredictionTable items={data.items} total={data.total} limit={Math.max(10, data.total)} offset={0} currentTerm hidePagination onSort={() => undefined} onPageChange={() => undefined} onRowClick={(predictionId) => setSelected(rows.find((row) => row.prediction_id === predictionId) || null)} />}
          </div>
          <Card className="w-full shrink-0 border-2 border-black bg-white p-4 shadow-[4px_4px_0px_#000] lg:w-80">
            <Text as="h4" className="mb-3 border-b-2 border-black pb-2 font-head text-base font-bold">Grade {grade} Sections</Text>
            <div className="flex flex-col gap-2">{gradeSummary?.sections.map((section) => <Link key={section.class_id} to={`/teacher/predictions/${grade}/${section.class_id}`} className="flex items-center justify-between border-2 border-black bg-yellow-50 p-2.5 hover:bg-yellow-100"><span className="font-bold">{section.section_name}</span><Badge size="sm" variant="surface">{section.total_students} projections</Badge></Link>)}</div>
          </Card>
        </div>
      </div>
    </div>
    <PredictionDetailSheet predictionId={selected?.prediction_id ?? null} currentTermPrediction={selected} open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }} />
  </AppLayout>;
}
