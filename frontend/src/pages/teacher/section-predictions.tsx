import { useEffect, useState } from "react";
import { useParams, Link, useSearchParams, Navigate } from "react-router-dom";
import { TrendingUp, Download, Loader2 } from "lucide-react";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card } from "@/components/retroui/Card";
import { Alert } from "@/components/retroui/Alert";
import { EmptyStateCard } from "@/pages/admin/subjects/components/empty-state-card";
import PredictionFilters from "@/components/predictions/prediction-filters";
import PredictionTable from "@/components/predictions/prediction-table";
import PredictionDetailSheet from "@/components/predictions/prediction-detail-sheet";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import {
  useTeacherActiveInterventionShortcut,
  useTeacherCandidateShortcut,
} from "@/components/predictions/use-teacher-candidate-shortcut";
import { useAuth } from "@/context/AuthContext";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import { toast } from "sonner";
import { exportStudentRiskSummaryCSV } from "@/lib/prediction-api";
import { PageBreadcrumb as Breadcrumb } from "@/components/page-breadcrumb";
import { AdminBreadcrumb } from "@/components/admin/admin-breadcrumb";
import { Button } from "@/components/teacher/button";
import {
  buildCurrentTermDashboard,
  loadAuthorizedCurrentTermPredictions,
  currentTermPredictionErrorMessage,
  formatSubjectDisplayName,
  type AuthorizedCurrentTermRow,
  type AssignedSubjectSectionScope,
} from "@/components/predictions/current-term-dashboard-adapter";
import { AdminCurrentTermGradePredictions } from "./grade-predictions";

export default function SectionPredictions() {
  const { role } = useAuth();
  const { subjectId } = useParams<{ subjectId?: string }>();
  if (role === "admin" && !subjectId) {
    return <AdminCurrentTermGradePredictions />;
  }
  const viewerRole = role === "admin" ? "admin" : "teacher";
  return <TeacherCurrentTermSectionPredictions viewerRole={viewerRole} />;
}

function TeacherCurrentTermSectionPredictions({ viewerRole }: { viewerRole: "admin" | "teacher" }) {
  const BreadcrumbComponent = viewerRole === "admin" ? AdminBreadcrumb : Breadcrumb;
  const isTeacher = viewerRole === "teacher";
  const predictionBasePath = `/${viewerRole}/predictions`;
  const { grade, classId: classSlug, subjectId: routeSubjectSlug } = useParams<{
    grade?: string;
    classId?: string;
    subjectId?: string;
  }>();
  const { selectedPeriodId } = useAcademicPeriod();
  const isSubjectRoute = Boolean(routeSubjectSlug);
  const routeSubjectId = routeSubjectSlug && !Number.isNaN(Number(routeSubjectSlug)) ? Number(routeSubjectSlug) : undefined;
  const resolvedClassId = classSlug && !Number.isNaN(Number(classSlug)) ? Number(classSlug) : undefined;

  const [rows, setRows] = useState<AuthorizedCurrentTermRow[]>([]);
  const [assignedScopes, setAssignedScopes] = useState<AssignedSubjectSectionScope[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [riskLevel, setRiskLevel] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AuthorizedCurrentTermRow | null>(null);
  const candidateId = useTeacherCandidateShortcut(selected, isTeacher);
  const activeInterventionId = useTeacherActiveInterventionShortcut(selected, isTeacher);
  const [isExporting, setIsExporting] = useState(false);

  const handleExportCsv = async () => {
    if (!selectedPeriodId) return;
    try {
      setIsExporting(true);
      toast.info("Preparing section risk summary CSV export...");
      const { blob, filename } = await exportStudentRiskSummaryCSV({
        academicPeriodId: selectedPeriodId,
        classId: resolvedClassId,
        subjectId: targetSubjectId,
        riskLevel,
        search,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Section risk summary CSV downloaded successfully.");
    } catch (err) {
      console.error("Export section risk summary CSV error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to export risk summary CSV.");
    } finally {
      setIsExporting(false);
    }
  };

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

    const constraints: { classId: number; subjectId?: number; gradeLevel?: number } = {
      classId: resolvedClassId,
    };
    if (routeSubjectId !== undefined) {
      constraints.subjectId = routeSubjectId;
    } else if (grade && !Number.isNaN(Number(grade))) {
      constraints.gradeLevel = Number(grade);
    }

    loadAuthorizedCurrentTermPredictions(selectedPeriodId, constraints, viewerRole)
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
  }, [resolvedClassId, routeSubjectId, grade, selectedPeriodId, viewerRole]);

  // Handle legacy route navigation
  if (!isSubjectRoute) {
    if (loading) {
      return (
        <AppLayout>
          <div className="flex flex-1 flex-col items-center justify-center py-20 text-gray-500 font-semibold">
            Loading section information...
          </div>
        </AppLayout>
      );
    }
    if (loadError) {
      return (
        <AppLayout>
          <div className="p-6">
            <div role="alert" className="border-2 border-red-600 bg-red-50 p-4 font-semibold text-red-900">
              {loadError}
            </div>
          </div>
        </AppLayout>
      );
    }
    if (assignedScopes.length === 1 && resolvedClassId) {
      return (
        <Navigate
          to={`${predictionBasePath}/subject/${assignedScopes[0].subject_id}/section/${resolvedClassId}`}
          replace
        />
      );
    }
    if (assignedScopes.length > 1 && resolvedClassId) {
      const sectionName = assignedScopes[0].section_name;
      return (
        <AppLayout>
          <div className="flex flex-1 flex-col p-6 max-w-2xl mx-auto gap-4">
            <h1 className="text-2xl font-bold">Select Subject for {sectionName}</h1>
            <p className="text-sm text-gray-600">
              Multiple subjects are assigned to this section. Please select which subject predictions you want to view:
            </p>
            <div className="flex flex-col gap-2 pt-2">
              {assignedScopes.map((scope) => (
                <Button
                  key={scope.subject_id}
                  asChild
                  variant="outline"
                  className="justify-start border-2 border-black font-bold p-4 text-left"
                >
                  <Link to={`${predictionBasePath}/subject/${scope.subject_id}/section/${resolvedClassId}`}>
                    {formatSubjectDisplayName(scope.subject_name, scope.grade_level)}
                  </Link>
                </Button>
              ))}
            </div>
            <div className="pt-4">
              <Button asChild variant="secondary" className="border-2 border-black font-bold">
                <Link to={predictionBasePath}>Return to AI Predictions</Link>
              </Button>
            </div>
          </div>
        </AppLayout>
      );
    }
    return (
      <AppLayout>
        <div className="flex flex-1 flex-col p-6 max-w-2xl mx-auto gap-4">
          <div role="alert" className="border-2 border-amber-600 bg-amber-50 p-6 font-semibold flex flex-col items-start gap-4">
            <p className="text-amber-950 font-bold">No authorized subjects were found for this section in the selected term.</p>
            <Button asChild variant="outline" className="border-2 border-black font-bold">
              <Link to={predictionBasePath}>Return to AI Predictions</Link>
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  // Invalid IDs check for subject-first route
  if (!routeSubjectId || !resolvedClassId) {
    return (
      <AppLayout>
        <div className="flex flex-1 flex-col p-6 max-w-2xl mx-auto gap-4">
          <div role="alert" className="border-2 border-red-600 bg-red-50 p-6 font-semibold flex flex-col items-start gap-4">
            <p className="text-red-950 font-bold">Invalid subject or section identifier in the address.</p>
            <Button asChild variant="outline" className="border-2 border-black font-bold">
              <Link to={predictionBasePath}>Return to AI Predictions</Link>
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const matchingScope = assignedScopes.find((s) => s.subject_id === routeSubjectId);
  const targetSubjectId = routeSubjectId ?? matchingScope?.subject_id ?? rows[0]?.subject_id;
  const subjectDisplayName = matchingScope
    ? formatSubjectDisplayName(matchingScope.subject_name, matchingScope.grade_level)
    : rows[0]
      ? formatSubjectDisplayName(rows[0].subject_name, rows[0].grade_level)
      : "Subject";
  const sectionName = matchingScope?.section_name || rows[0]?.class_name || `Section ${classSlug}`;

  const data = buildCurrentTermDashboard(rows, {
    search,
    interventionLevel: riskLevel,
    limit: Math.max(10, rows.length),
  });

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 bg-background px-4 py-4 md:px-6">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="md:hidden" />
            <BreadcrumbComponent>
              <Breadcrumb.List className="flex min-w-0 flex-nowrap items-center gap-2">
                <Breadcrumb.Item>
                  <Breadcrumb.Link asChild>
                    <Link to={predictionBasePath}>AI Predictions</Link>
                  </Breadcrumb.Link>
                </Breadcrumb.Item>
                <Breadcrumb.Separator />
                {viewerRole === "admin" ? (
                  <>
                    <Breadcrumb.Item>
                      <Breadcrumb.Link asChild>
                        <Link to={`${predictionBasePath}/${matchingScope?.grade_level ?? rows[0]?.grade_level}`}>
                          Grade {matchingScope?.grade_level ?? rows[0]?.grade_level}
                        </Link>
                      </Breadcrumb.Link>
                    </Breadcrumb.Item>
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item>
                      <Breadcrumb.Link asChild>
                        <Link to={`${predictionBasePath}/${matchingScope?.grade_level ?? rows[0]?.grade_level}/${resolvedClassId}`}>
                          {sectionName}
                        </Link>
                      </Breadcrumb.Link>
                    </Breadcrumb.Item>
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item>
                      <Breadcrumb.Page>{subjectDisplayName}</Breadcrumb.Page>
                    </Breadcrumb.Item>
                  </>
                ) : (
                  <>
                    <Breadcrumb.Item>
                      <Breadcrumb.Link asChild>
                        <Link
                          to={
                            targetSubjectId
                              ? `${predictionBasePath}/subject/${targetSubjectId}`
                              : predictionBasePath
                          }
                        >
                          {subjectDisplayName}
                        </Link>
                      </Breadcrumb.Link>
                    </Breadcrumb.Item>
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item>
                      <Breadcrumb.Page>{sectionName}</Breadcrumb.Page>
                    </Breadcrumb.Item>
                  </>
                )}
              </Breadcrumb.List>
            </BreadcrumbComponent>
          </div>
          <Button
            variant="outline"
            size="header"
            onClick={handleExportCsv}
            disabled={isExporting || !selectedPeriodId}
            data-testid="export-section-risk-summary-csv-button"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            <span>Export CSV</span>
          </Button>
        </header>

        <div className="-mt-[1px] border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
          <div className="flex flex-col gap-4">
            <PredictionFilters
              filters={null}
              gradeLevel={matchingScope?.grade_level ?? (rows[0]?.grade_level ?? undefined)}
              classId={resolvedClassId}
              subjectId={routeSubjectId}
              academicPeriodId={selectedPeriodId ?? undefined}
              riskLevel={riskLevel}
              search={search}
              hideClassFilter
              hideGradeFilter
              hideSubjectFilter
              hidePeriodFilter
              simplifiedTeacherRisk
              riskSummary={data.risk_summary}
              onSubjectChange={() => undefined}
              onRiskChange={setRiskLevel}
              onSearchChange={setSearch}
              onClearAll={() => {
                setRiskLevel(undefined);
                setSearch("");
              }}
            />

            {loadError && (
              <Alert status="error" className="font-semibold">
                {loadError}
              </Alert>
            )}

            <div className="w-full min-w-0 flex flex-col gap-4">
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
                    This subject is not assigned to this section or you do not have permission to access it in the selected term.
                  </p>
                  <Button asChild variant="outline" className="border-2 border-black font-bold">
                    <Link to={predictionBasePath}>Return to AI Predictions</Link>
                  </Button>
                </div>
              ) : rows.length === 0 ? (
                isTeacher ? (
                  <TeacherEmptyState
                    icon={<TrendingUp />}
                    title={`No predictions available for ${subjectDisplayName} in ${sectionName}`}
                    description="There are currently no generated predictions for this subject and section in the selected term."
                  />
                ) : (
                  <EmptyStateCard
                    icon={<TrendingUp />}
                    title={`No predictions available for ${subjectDisplayName} in ${sectionName}`}
                    description="There are currently no generated predictions for this subject and section in the selected term."
                  />
                )
              ) : (
                <PredictionTable
                  items={data.items}
                  total={data.total}
                  limit={Math.max(10, data.total)}
                  offset={0}
                  hideClass
                  hideSubject
                  hidePagination
                  currentTerm
                  simplifiedTeacherRisk
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
