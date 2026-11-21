import { useEffect, useMemo, useRef, useState } from "react";
import GradeItemLine from "@/components/item-line/grade";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getTeacherClasses, type TeacherClassItem } from "@/lib/api";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import { BookOpen, X } from "lucide-react";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import { LoadingPanel } from "@/components/loading-panel";
import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/teacher/button";

const Grades = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [classes, setClasses] = useState<TeacherClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { selectedPeriodId, selectedYearId, isLoading: isContextLoading } = useAcademicPeriod();
  const requestIdRef = useRef(0);

  const classIdParam = searchParams.get("class_id");
  const subjectIdParam = searchParams.get("subject_id");

  useEffect(() => {
    if (isContextLoading) return;

    const currentRequestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    getTeacherClasses(selectedPeriodId ?? null, selectedYearId ?? null)
      .then((data) => {
        if (requestIdRef.current !== currentRequestId) return;
        setClasses(data);
      })
      .catch((err: unknown) => {
        if (requestIdRef.current !== currentRequestId) return;
        console.error("Error loading teacher classes:", err);
        setClasses([]);
        setError(err instanceof Error ? err.message : "Unable to load teacher classes. Please try again.");
      })
      .finally(() => {
        if (requestIdRef.current === currentRequestId) {
          setLoading(false);
        }
      });
  }, [selectedPeriodId, selectedYearId, isContextLoading]);

  const filteredClasses = useMemo(() => {
    const targetClassId = classIdParam ? Number(classIdParam) : null;
    const targetSubjectId = subjectIdParam ? Number(subjectIdParam) : null;
    return classes.filter((item) => {
      if (targetClassId && Number.isFinite(targetClassId) && item.class_id !== targetClassId) {
        return false;
      }
      if (targetSubjectId && Number.isFinite(targetSubjectId) && item.subject_id !== targetSubjectId) {
        return false;
      }
      return true;
    });
  }, [classes, classIdParam, subjectIdParam]);

  const hasQueryFilter = Boolean(classIdParam || subjectIdParam);
  const showLoading = loading || isContextLoading;

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex flex-wrap items-center justify-between gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <div className="flex items-center gap-2 sm:gap-3">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <h1 className="text-xl font-bold sm:text-2xl md:text-4xl">Grades</h1>
              </div>
              {hasQueryFilter && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setSearchParams({})}
                  className="gap-1.5"
                >
                  <X className="size-3.5" />
                  Show all classes
                </Button>
              )}
            </header>

            <div className="-mt-[1px] flex min-w-0 flex-col gap-3 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
              {error && (
                <Alert status="error" onClose={() => setError(null)}>
                  <Alert.Title>Error</Alert.Title>
                  <Alert.Description>{error}</Alert.Description>
                </Alert>
              )}

              {showLoading ? (
                <LoadingPanel label="Loading grades..." />
              ) : filteredClasses.length === 0 ? (
                <TeacherEmptyState
                  icon={<BookOpen className="size-5" />}
                  title={hasQueryFilter ? "No matching classes for this filter" : "No classes assigned"}
                  description={
                    hasQueryFilter
                      ? "The filtered class or subject is not assigned in the selected academic period."
                      : "Your class grades will appear here once classes are assigned to you for this academic period."
                  }
                  action={
                    hasQueryFilter
                      ? { label: "Show all classes", onClick: () => setSearchParams({}) }
                      : undefined
                  }
                />
              ) : (
                <div className="flex flex-col gap-3">
                  {filteredClasses.map((item) => (
                    <GradeItemLine
                      key={`${item.class_id}-${item.subject_id}`}
                      section={item.section_name}
                      subject={item.subject_name}
                      onClick={() =>
                        navigate(
                          `/teacher/grades/${encodeURIComponent(String(item.class_id))}/${encodeURIComponent(
                            String(item.subject_id)
                          )}`
                        )
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Grades;
