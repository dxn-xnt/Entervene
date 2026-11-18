import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Text } from "@/components/retroui/Text";
import { Badge } from "@/components/retroui/Badge";
import PredictionFilters from "@/components/predictions/prediction-filters";
import PredictionTable from "@/components/predictions/prediction-table";
import PredictionDetailSheet from "@/components/predictions/prediction-detail-sheet";
import {
  useTeacherActiveInterventionShortcut,
  useTeacherCandidateShortcut,
} from "@/components/predictions/use-teacher-candidate-shortcut";
import { useAuth } from "@/context/AuthContext";
import type {
  DashboardFilters,
} from "@/lib/prediction-api";
import { PageBreadcrumb as Breadcrumb } from "@/components/page-breadcrumb";
import { AdminBreadcrumb } from "@/components/admin/admin-breadcrumb";
import { Card } from "@/components/retroui/Card";
import { School } from "lucide-react";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import {
  buildCurrentTermDashboard,
  buildCurrentTermGradeSummaries,
  loadAuthorizedCurrentTermPredictions,
  currentTermPredictionErrorMessage,
  type AuthorizedCurrentTermRow,
  type AssignedSubjectSectionScope,
} from "@/components/predictions/current-term-dashboard-adapter";
import { EmptyStateCard } from "@/pages/admin/subjects/components/empty-state-card";
import { Alert } from "@/components/retroui/Alert";
import { Loader } from "@/components/retroui/Loader";
import { AdminGradePredictionsWorkspace } from "@/components/predictions/admin-grade-predictions-workspace";

export default function GradePredictions() {
  const { role } = useAuth();
  return role === "admin" ? <AdminCurrentTermGradePredictions /> : <TeacherCurrentTermGradePredictions />;
}

export function AdminCurrentTermGradePredictions() {
  const Breadcrumb = AdminBreadcrumb;
  const { grade, classId: classSlug } = useParams<{ grade: string; classId?: string }>();
  const { selectedPeriodId } = useAcademicPeriod();
  const numericGrade = grade ? Number(grade) : undefined;
  const routeClassId = classSlug && !Number.isNaN(Number(classSlug)) ? Number(classSlug) : undefined;
  const [rows, setRows] = useState<AuthorizedCurrentTermRow[]>([]);
  const [assignedScopes, setAssignedScopes] = useState<AssignedSubjectSectionScope[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [classId, setClassId] = useState<number | undefined>(routeClassId);
  const [subjectId, setSubjectId] = useState<number | undefined>();
  const [riskLevel, setRiskLevel] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AuthorizedCurrentTermRow | null>(null);

  useEffect(() => {
    if (!selectedPeriodId || numericGrade === undefined || numericGrade < 7 || numericGrade > 12) {
      Promise.resolve().then(() => setLoading(false));
      return;
    }

    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        setLoading(true);
        setLoadError(null);
        setRows([]);
        setAssignedScopes([]);
        setSelected(null);
        setClassId(routeClassId);
        setSubjectId(undefined);
      }
    });
    loadAuthorizedCurrentTermPredictions(
      selectedPeriodId,
      { gradeLevel: numericGrade },
      "admin",
    )
      .then((result) => {
        if (!cancelled) {
          setRows(result.rows);
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
  }, [numericGrade, routeClassId, selectedPeriodId]);

  const sections = useMemo(() => {
    const byId = new Map<number, { class_id: number; section_name: string }>();
    assignedScopes.forEach((scope) => {
      if (!byId.has(scope.class_id)) {
        byId.set(scope.class_id, { class_id: scope.class_id, section_name: scope.section_name });
      }
    });
    return [...byId.values()].sort((a, b) => a.section_name.localeCompare(b.section_name));
  }, [assignedScopes]);

  const selectedClassId = sections.some((section) => section.class_id === classId)
    ? classId
    : routeClassId && sections.some((section) => section.class_id === routeClassId)
      ? routeClassId
      : sections[0]?.class_id;

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center gap-3 bg-background px-4 py-4 md:px-6">
          <SidebarTrigger className="md:hidden" />
          <Breadcrumb>
            <Breadcrumb.List className="flex min-w-0 flex-nowrap items-center gap-2">
              <Breadcrumb.Item>
                <Breadcrumb.Link asChild>
                  <Link to="/admin/predictions">AI Predictions</Link>
                </Breadcrumb.Link>
              </Breadcrumb.Item>
              <Breadcrumb.Separator />
              <Breadcrumb.Item>
                <Breadcrumb.Page>Grade {grade}</Breadcrumb.Page>
              </Breadcrumb.Item>
            </Breadcrumb.List>
          </Breadcrumb>
        </header>

        <div className="-mt-[1px] border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
          {loadError ? (
            <Alert status="error" className="font-semibold">{loadError}</Alert>
          ) : loading ? (
            <div className="flex items-center justify-center gap-3 py-20 font-semibold text-gray-500">
              <Loader size="md" />
              <span>Loading Grade {grade} sections...</span>
            </div>
          ) : !selectedPeriodId ? (
            <EmptyStateCard
              icon={<School />}
              title="Select an academic term"
              description="Choose an academic year and term from the sidebar to view sections."
            />
          ) : numericGrade === undefined || numericGrade < 7 || numericGrade > 12 ? (
            <EmptyStateCard
              icon={<School />}
              title="Grade level unavailable"
              description="Admin prediction grades are available for Grades 7 through 12."
            />
          ) : !sections.length ? (
            <EmptyStateCard
              icon={<School />}
              title={`No sections assigned to Grade ${grade}`}
              description="Sections with valid subject assignments for the selected term will appear here."
            />
          ) : (
            <AdminGradePredictionsWorkspace
              grade={numericGrade}
              rows={rows}
              assignedScopes={assignedScopes}
              sections={sections}
              selectedClassId={selectedClassId}
              selectedSubjectId={subjectId}
              riskLevel={riskLevel}
              search={search}
              onClassChange={(value) => {
                setClassId(value);
                setSubjectId(undefined);
                setRiskLevel(undefined);
                setSearch("");
                setSelected(null);
              }}
              onSubjectChange={(value) => {
                setSubjectId(value);
                setRiskLevel(undefined);
                setSearch("");
                setSelected(null);
              }}
              onRiskChange={setRiskLevel}
              onSearchChange={setSearch}
              onPredictionSelect={setSelected}
            />
          )}
        </div>
      </div>

      <PredictionDetailSheet
        predictionId={selected?.prediction_id ?? null}
        currentTermPrediction={selected}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [classId, setClassId] = useState<number | undefined>();
  const [subjectId, setSubjectId] = useState<number | undefined>();
  const [riskLevel, setRiskLevel] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AuthorizedCurrentTermRow | null>(null);
  const candidateId = useTeacherCandidateShortcut(selected);
  const activeInterventionId = useTeacherActiveInterventionShortcut(selected);

  useEffect(() => {
    if (!selectedPeriodId || numericGrade === undefined) {
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

    loadAuthorizedCurrentTermPredictions(selectedPeriodId, { gradeLevel: numericGrade })
      .then((result) => {
        if (!cancelled) {
          setRows(result.rows);
          setFilters(result.filters);
        }
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
  }, [numericGrade, selectedPeriodId]);

  const scopedRows = rows.filter(
    (row) =>
      (classId === undefined || row.class_id === classId) &&
      (subjectId === undefined || row.subject_id === subjectId)
  );
  const data = buildCurrentTermDashboard(scopedRows, {
    search,
    interventionLevel: riskLevel,
    limit: Math.max(10, scopedRows.length),
  });
  const gradeSummary = buildCurrentTermGradeSummaries(rows)[0];

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center gap-3 bg-background px-4 py-4 md:px-6">
          <SidebarTrigger className="md:hidden" />
          <Breadcrumb>
            <Breadcrumb.List>
              <Breadcrumb.Item>
                <Breadcrumb.Link asChild>
                  <Link to="/teacher/predictions">AI Predictions</Link>
                </Breadcrumb.Link>
              </Breadcrumb.Item>
              <Breadcrumb.Separator />
              <Breadcrumb.Item>
                <Breadcrumb.Page>Grade {grade}</Breadcrumb.Page>
              </Breadcrumb.Item>
            </Breadcrumb.List>
          </Breadcrumb>
        </header>

        <div className="-mt-[1px] border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
          <div className="flex flex-col items-start gap-5 lg:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <PredictionFilters
                filters={filters}
                gradeLevel={numericGrade}
                classId={classId}
                subjectId={subjectId}
                academicPeriodId={selectedPeriodId ?? undefined}
                riskLevel={riskLevel}
                search={search}
                hideGradeFilter
                hidePeriodFilter
                simplifiedTeacherRisk
                riskSummary={data.risk_summary}
                onClassChange={setClassId}
                onSubjectChange={setSubjectId}
                onRiskChange={setRiskLevel}
                onSearchChange={setSearch}
                onClearAll={() => {
                  setClassId(undefined);
                  setSubjectId(undefined);
                  setRiskLevel(undefined);
                  setSearch("");
                }}
              />

              {loadError && (
                <div role="alert" className="border-2 border-red-600 bg-red-50 p-4 font-semibold">
                  {loadError}
                </div>
              )}

              {loading ? (
                <div className="py-20 text-center font-semibold text-gray-500">
                  Loading Grade {grade} projections...
                </div>
              ) : loadError ? null : (
                <PredictionTable
                  items={data.items}
                  total={data.total}
                  limit={Math.max(10, data.total)}
                  offset={0}
                  currentTerm
                  simplifiedTeacherRisk
                  hidePagination
                  onSort={() => undefined}
                  onPageChange={() => undefined}
                  onRowClick={(predictionId) =>
                    setSelected(rows.find((row) => row.prediction_id === predictionId) || null)
                  }
                />
              )}
            </div>

            <Card className="w-full shrink-0 border-2 border-black bg-white p-4 shadow-[4px_4px_0px_#000] lg:w-80">
              <Text as="h4" className="mb-3 font-head text-base font-bold">
                Grade {grade} Sections
              </Text>
              <div className="flex flex-col gap-2">
                {gradeSummary?.sections.map((section) => (
                  <Link
                    key={section.class_id}
                    to={`/teacher/predictions/${grade}/${section.class_id}`}
                    className="flex items-center justify-between gap-3 rounded border-2 border-black bg-yellow-50 p-3 hover:bg-yellow-100"
                  >
                    <span className="font-bold">{section.section_name}</span>
                    <Badge size="sm" variant="surface">
                      {section.total_students} projections
                    </Badge>
                  </Link>
                ))}
              </div>
            </Card>
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
