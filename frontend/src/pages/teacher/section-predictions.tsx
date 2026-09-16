import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import PredictionFilters from "@/components/predictions/prediction-filters";
import PredictionDetailSheet from "@/components/predictions/prediction-detail-sheet";
import { PredictionRoster } from "@/components/predictions/prediction-roster";
import { useAuth } from "@/context/AuthContext";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import { usePredictionRoster } from "@/hooks/use-prediction-roster";
import type { DashboardFilters, DashboardSubjectOption } from "@/lib/prediction-api";
import { fetchDashboardFilters } from "@/lib/prediction-api";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";

export default function SectionPredictions() {
  const { role } = useAuth();
  const baseRole = role === "admin" ? "admin" : "teacher";
  const { grade, classId: classSlug } = useParams<{ grade: string; classId: string }>();
  const { selectedPeriodId } = useAcademicPeriod();

  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const [subjectId, setSubjectId] = useState<number | undefined>();
  const [baselineRiskLevel, setBaselineRiskLevel] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [selectedPrediction, setSelectedPrediction] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const academicPeriodId = selectedPeriodId ?? undefined;
  const numericGrade = grade ? Number(grade) : undefined;

  const resolvedClassId =
    classSlug && !Number.isNaN(Number(classSlug))
      ? Number(classSlug)
      : filters?.classes.find(
          (c) => c.section_name.toLowerCase() === decodeURIComponent(classSlug || "").toLowerCase()
        )?.class_id;

  const sectionDisplayName =
    filters?.classes.find((c) => c.class_id === resolvedClassId)?.section_name ||
    (classSlug && Number.isNaN(Number(classSlug)) ? decodeURIComponent(classSlug) : `Section ${classSlug}`);

  useEffect(() => {
    if (!resolvedClassId) {
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

  const sortedSubjects: DashboardSubjectOption[] = useMemo(() => {
    if (!filters?.subjects?.length) return [];
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

  useEffect(() => {
    if (sortedSubjects.length === 0) {
      setSubjectId(undefined);
      return;
    }
    if (!sortedSubjects.some((s) => s.subject_id === subjectId)) {
      setSubjectId(sortedSubjects[0].subject_id);
    }
  }, [sortedSubjects, subjectId]);

  const roster = usePredictionRoster({
    classId: resolvedClassId,
    subjectId,
    academicPeriodId,
    search,
    baselineRiskLevel,
  });

  const handleClearAll = () => {
    setBaselineRiskLevel(undefined);
    setSearch("");
  };

  const handleOpenDetail = (predictionId: number) => {
    setSelectedPrediction(predictionId);
    setSheetOpen(true);
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
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
                        <Breadcrumb.Page>{sectionDisplayName}</Breadcrumb.Page>
                      </Breadcrumb.Item>
                    </>
                  )}
                </Breadcrumb.List>
              </Breadcrumb>
            </header>

            <div className="-mt-[1px] border-t-2 border-border px-4 py-4 md:px-6">
              <div className="flex w-full flex-col gap-4">
                <PredictionFilters
                  filters={filters}
                  gradeLevel={numericGrade}
                  classId={resolvedClassId}
                  subjectId={subjectId}
                  academicPeriodId={academicPeriodId}
                  riskLevel={baselineRiskLevel}
                  search={search}
                  hideClassFilter
                  hideGradeFilter
                  hideSubjectFilter
                  hidePeriodFilter
                  onSubjectChange={setSubjectId}
                  onRiskChange={setBaselineRiskLevel}
                  onSearchChange={setSearch}
                  onClearAll={handleClearAll}
                />

                {sortedSubjects.length > 0 && (
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                    {sortedSubjects.map((s) => {
                      const isActive = subjectId === s.subject_id;
                      return (
                        <button
                          key={s.subject_id}
                          type="button"
                          onClick={() => setSubjectId(s.subject_id)}
                          className={cn(
                            "cursor-pointer whitespace-nowrap rounded border-2 px-4 py-1.5 text-xs font-bold transition-all md:text-sm",
                            isActive
                              ? "border-black bg-yellow-400 text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                              : "border-transparent bg-white text-gray-700 hover:border-black hover:bg-gray-100"
                          )}
                        >
                          {s.subject_name}
                        </button>
                      );
                    })}
                  </div>
                )}

                {sortedSubjects.length === 0 ? (
                  <div className="bg-white p-8 text-center border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <p className="text-lg font-bold text-gray-900">No subjects available for {sectionDisplayName}.</p>
                    <p className="mx-auto mt-1 max-w-md text-sm text-gray-600">
                      There are no subjects offered or assigned for this section in the selected term.
                    </p>
                  </div>
                ) : (
                  <PredictionRoster
                    roster={roster.data}
                    students={roster.students}
                    loading={roster.loading}
                    error={roster.error}
                    onRefetch={roster.refetch}
                    onOpenDetail={handleOpenDetail}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <PredictionDetailSheet
        predictionId={selectedPrediction}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </AppLayout>
  );
}
