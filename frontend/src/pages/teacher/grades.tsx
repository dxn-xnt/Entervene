import { useEffect, useRef, useState } from "react";
import GradeItemLine from "@/components/item-line/grade";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { useNavigate } from "react-router-dom";
import { getTeacherClasses, type TeacherClassItem } from "@/lib/api";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import { BookOpen } from "lucide-react";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import { LoadingPanel } from "@/components/loading-panel";
import { Alert } from "@/components/retroui/Alert";

const Grades = () => {
  const navigate = useNavigate();
  const [classes, setClasses] = useState<TeacherClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { selectedPeriodId, selectedYearId, isLoading: isContextLoading } = useAcademicPeriod();
  const requestIdRef = useRef(0);

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

  const showLoading = loading || isContextLoading;

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <SidebarTrigger className="shrink-0 md:hidden" />
              <div>
                <h1 className="text-xl font-bold sm:text-2xl md:text-4xl">Grades</h1>
              </div>
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
              ) : classes.length === 0 ? (
                <TeacherEmptyState
                  icon={<BookOpen className="size-5" />}
                  title="No classes assigned"
                  description="Your class grades will appear here once classes are assigned to you for this academic period."
                />
              ) : (
                <div className="flex flex-col gap-3">
                  {classes.map((item) => (
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
