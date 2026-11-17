import { useEffect, useState } from "react";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { OverviewCard } from "@/components/overview-cards";
import { Card } from "@/components/retroui/Card";
import { Alert } from "@/components/retroui/Alert";
import { Loader } from "@/components/retroui/Loader";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import PredictionFilters from "@/components/predictions/prediction-filters";
import PredictionTable from "@/components/predictions/prediction-table";
import PredictionDetailSheet from "@/components/predictions/prediction-detail-sheet";
import {
  useTeacherActiveInterventionShortcut,
  useTeacherCandidateShortcut,
} from "@/components/predictions/use-teacher-candidate-shortcut";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import type {
  DashboardFilters,
  RiskSummary,
} from "@/lib/prediction-api";
import {
  buildCurrentTermDashboard,
  buildCurrentTermSubjectSummaries,
  buildAdminPredictionHierarchy,
  adminUniqueStudentRiskSummary,
  currentTermRiskSummary,
  loadAuthorizedCurrentTermPredictions,
  currentTermPredictionErrorMessage,
  type AuthorizedCurrentTermRow,
  type AssignedSubjectSectionScope,
} from "@/components/predictions/current-term-dashboard-adapter";
import { PredictionSubjectSection } from "@/components/predictions/prediction-subject-section";
import { AdminPredictionGradeCard } from "@/components/predictions/admin-prediction-grade-card";
import { getTeacherRiskDisplaySummary } from "@/components/predictions/teacher-risk-display";
import { EmptyStateCard } from "@/pages/admin/subjects/components/empty-state-card";
import { SearchX, Sparkles } from "lucide-react";

const TEACHER_RISK_CARDS = [
  {
    key: "MODERATE_RISK" as const,
    label: "Moderate Risk",
    activeClass: "bg-amber-200 ring-2 ring-black",
  },
  {
    key: "HIGH_RISK" as const,
    label: "High Risk",
    activeClass: "bg-red-200 ring-2 ring-black",
  },
  {
    key: "ON_TRACK" as const,
    label: "On Track",
    activeClass: "bg-emerald-200 ring-2 ring-black",
  },
];

export default function PredictionsDashboard() {
  const { role } = useAuth();
  return role === "teacher" ? <TeacherCurrentTermDashboard /> : <AdminCurrentTermDashboard />;
}

function AdminCurrentTermDashboard() {
  const { selectedPeriodId } = useAcademicPeriod();
  const [rows, setRows] = useState<AuthorizedCurrentTermRow[]>([]);
  const [assignedScopes, setAssignedScopes] = useState<AssignedSubjectSectionScope[]>([]);
  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gradeLevel, setGradeLevel] = useState<number | undefined>();
  const [classId, setClassId] = useState<number | undefined>();
  const [subjectId, setSubjectId] = useState<number | undefined>();
  const [riskLevel, setRiskLevel] = useState<string | undefined>();
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!selectedPeriodId) {
      Promise.resolve().then(() => {
        setRows([]);
        setAssignedScopes([]);
        setFilters(null);
        setLoadError(null);
        setLoading(false);
      });
      return;
    }

    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        setLoading(true);
        setLoadError(null);
      }
    });

    loadAuthorizedCurrentTermPredictions(selectedPeriodId, {}, "admin")
      .then((result) => {
        if (!cancelled) {
          setRows(result.rows);
          setFilters(result.filters);
          setAssignedScopes(result.assignedScopes);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRows([]);
          setAssignedScopes([]);
          setFilters(null);
          setLoadError(currentTermPredictionErrorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPeriodId]);

  const clearFilters = () => {
    setGradeLevel(undefined);
    setClassId(undefined);
    setSubjectId(undefined);
    setRiskLevel(undefined);
    setSearch("");
  };
  const scopedRows = rows.filter(
    (row) =>
      (gradeLevel === undefined || row.grade_level === gradeLevel) &&
      (classId === undefined || row.class_id === classId) &&
      (subjectId === undefined || row.subject_id === subjectId)
  );
  const scopedAssignedScopes = assignedScopes.filter(
    (scope) =>
      (gradeLevel === undefined || scope.grade_level === gradeLevel) &&
      (classId === undefined || scope.class_id === classId) &&
      (subjectId === undefined || scope.subject_id === subjectId)
  );
  const normalizedSearch = search.trim().toLowerCase();
  const searchedRows = scopedRows.filter((row) =>
    !normalizedSearch || (row.student_name || row.student_id).toLowerCase().includes(normalizedSearch)
  );
  const displaySummary = adminUniqueStudentRiskSummary(searchedRows);
  const filterRiskSummary: RiskSummary = {
    HIGH_RISK: displaySummary.HIGH_RISK,
    MODERATE_RISK: displaySummary.MODERATE_RISK,
    NEEDS_MONITORING: 0,
    LOW_RISK: displaySummary.ON_TRACK,
    INSUFFICIENT_DATA: 0,
    total: displaySummary.total,
  };
  const gradeHierarchy = buildAdminPredictionHierarchy(scopedRows, scopedAssignedScopes, {
    gradeLevel,
    search,
    riskLevel,
    includeEmptySections: !normalizedSearch && riskLevel === undefined,
  });
  const visibleGradeHierarchy = gradeHierarchy.filter((group) => group.sections.length > 0);
  const hasHierarchyMatches = visibleGradeHierarchy.some((group) =>
    group.sections.some((section) => section.students.length > 0)
  );
  const hasPredictionResultFilters =
    riskLevel !== undefined ||
    search.trim() !== "" ||
    gradeLevel !== undefined ||
    classId !== undefined ||
    subjectId !== undefined;

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center gap-2 bg-background px-3 py-3 sm:px-4 sm:py-4 md:px-6">
          <SidebarTrigger className="shrink-0 md:hidden" />
          <h1 className="text-xl font-bold sm:text-2xl md:text-4xl">Current-Term Predictions</h1>
        </header>

        <div className="-mt-[1px] min-w-0 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
          <div aria-label="Prediction risk summary" className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:gap-4">
            {TEACHER_RISK_CARDS.map((card) => (
              <button
                key={card.key}
                type="button"
                onClick={() => setRiskLevel((current) => current === card.key ? undefined : card.key)}
                aria-label={`Filter by ${card.label}`}
                aria-pressed={riskLevel === card.key}
                className="cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              >
                <OverviewCard
                  title={card.label}
                  count={String(displaySummary[card.key])}
                  className={cn(
                    "w-full border-2 border-black shadow-[4px_4px_0px_#000]",
                    riskLevel === card.key && "translate-x-1 translate-y-1 bg-yellow-100 shadow-none",
                  )}
                />
              </button>
            ))}
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
              simplifiedTeacherRisk
              riskSummary={filterRiskSummary}
              onGradeChange={setGradeLevel}
              onClassChange={setClassId}
              onSubjectChange={setSubjectId}
              onRiskChange={setRiskLevel}
              onSearchChange={setSearch}
              onClearAll={clearFilters}
            />

            {loadError && <Alert status="error" className="font-semibold">{loadError}</Alert>}

            {loading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-20 font-semibold text-gray-500">
                <Loader size="md" />
                <span>Loading current-term projections...</span>
              </div>
            ) : loadError ? null : !selectedPeriodId ? (
              <EmptyStateCard
                icon={<Sparkles />}
                title="Select an academic term"
                description="Choose an academic year and term from the sidebar to view current-term projections."
              />
            ) : assignedScopes.length === 0 && rows.length === 0 ? (
              <EmptyStateCard
                icon={<Sparkles />}
                title="No current-term projections available"
                description="No valid classes or published subject loads are available for predictions in the selected term."
              />
            ) : hasPredictionResultFilters && (!hasHierarchyMatches || visibleGradeHierarchy.length === 0) ? (
              <EmptyStateCard
                icon={<SearchX />}
                title="No predictions match these filters"
                description="Try another student, grade, section, subject, or risk level."
                actionLabel="Clear filters"
                onAction={clearFilters}
              />
            ) : visibleGradeHierarchy.length === 0 ? (
              <EmptyStateCard
                icon={<SearchX />}
                title="No sections available"
                description="No sections are assigned for this term."
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {visibleGradeHierarchy.map((group) => (
                  <AdminPredictionGradeCard
                    key={group.grade_level}
                    group={group}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

    </AppLayout>
  );
}

function TeacherCurrentTermDashboard() {
  const { selectedPeriodId } = useAcademicPeriod();
  const [rows, setRows] = useState<AuthorizedCurrentTermRow[]>([]);
  const [assignedScopes, setAssignedScopes] = useState<AssignedSubjectSectionScope[]>([]);
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
  const activeInterventionId = useTeacherActiveInterventionShortcut(selected);

  useEffect(() => {
    if (!selectedPeriodId) {
      Promise.resolve().then(() => {
        setSelected(null);
        setLoading(false);
      });
      return;
    }

    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        setSelected(null);
        setLoading(true);
        setLoadError(null);
      }
    });

    loadAuthorizedCurrentTermPredictions(selectedPeriodId)
      .then((result) => {
        if (!cancelled) {
          setRows(result.rows);
          setFilters(result.filters);
          setAssignedScopes(result.assignedScopes);
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
  }, [selectedPeriodId]);

  const scopedRows = rows.filter(
    (row) =>
      (gradeLevel === undefined || row.grade_level === gradeLevel) &&
      (classId === undefined || row.class_id === classId) &&
      (subjectId === undefined || row.subject_id === subjectId)
  );
  const data = buildCurrentTermDashboard(scopedRows, {
    search,
    interventionLevel: riskLevel,
    limit: Math.max(10, scopedRows.length),
  });
  const summary = currentTermRiskSummary(scopedRows);
  const displaySummary = getTeacherRiskDisplaySummary(summary);
  const subjectSummaries = buildCurrentTermSubjectSummaries(rows, assignedScopes);
  const filtered =
    gradeLevel !== undefined ||
    classId !== undefined ||
    subjectId !== undefined ||
    riskLevel !== undefined ||
    search.trim() !== "";

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center gap-2 bg-background px-3 py-3 sm:px-4 sm:py-4 md:px-6">
          <SidebarTrigger className="shrink-0 md:hidden" />
          <h1 className="text-xl font-bold sm:text-2xl md:text-4xl">Current-Term Predictions</h1>
        </header>

        <div className="-mt-[1px] min-w-0 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:gap-4">
            {TEACHER_RISK_CARDS.map((card) => (
              <OverviewCard
                key={card.key}
                title={card.label}
                count={String(displaySummary[card.key])}
                className="w-full border-2 border-black shadow-[4px_4px_0px_#000]"
              />
            ))}
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
              simplifiedTeacherRisk
              riskSummary={summary}
              onGradeChange={setGradeLevel}
              onClassChange={setClassId}
              onSubjectChange={setSubjectId}
              onRiskChange={setRiskLevel}
              onSearchChange={setSearch}
              onClearAll={() => {
                setGradeLevel(undefined);
                setClassId(undefined);
                setSubjectId(undefined);
                setRiskLevel(undefined);
                setSearch("");
              }}
            />

            {loadError && <Alert status="error" className="font-semibold">{loadError}</Alert>}

            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 font-semibold text-gray-500">
                <Loader size="md" />
                <span>Loading current-term projections...</span>
              </div>
            ) : loadError ? null : !selectedPeriodId ? (
              <Card className="border-2 border-black bg-white p-6 text-center font-semibold text-gray-700">
                Select an academic term to view projections.
              </Card>
            ) : filtered ? (
              <PredictionTable
                items={data.items}
                total={data.total}
                limit={Math.max(10, data.total)}
                offset={0}
                currentTerm
                simplifiedTeacherRisk
                showGradeLevel
                hidePagination
                onSort={() => undefined}
                onPageChange={() => undefined}
                onRowClick={(predictionId) =>
                  setSelected(rows.find((row) => row.prediction_id === predictionId) || null)
                }
              />
            ) : (
              <div className="flex flex-col gap-3">
                {subjectSummaries.length ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {subjectSummaries.map((group) => (
                      <PredictionSubjectSection key={group.subject_id} group={group} />
                    ))}
                  </div>
                ) : (
                  <Card className="border-2 border-black bg-white p-6 text-center font-semibold">
                    No current-term projections are available for this scope.
                  </Card>
                )}
              </div>
            )}
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
