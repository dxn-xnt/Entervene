import { useEffect, useState } from "react";
import GradeItemLine from "@/components/item-line/grade";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { useNavigate } from "react-router-dom";
import { getTeacherClasses, type TeacherClassItem } from "@/lib/api";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import { EmptyStateCard } from "@/components/empty-state-card";
import { LoadingPanel } from "@/components/loading-panel";

const Grades = () => {
  const navigate = useNavigate();
  const [classes, setClasses] = useState<TeacherClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { selectedPeriodId } = useAcademicPeriod();

  useEffect(() => {
    let isMounted = true;
    getTeacherClasses(selectedPeriodId ?? undefined)
      .then((data) => {
        if (!isMounted) return;
        setClasses(data);
      })
      .catch((err) => console.error("Error loading teacher classes:", err))
      .finally(() => {
        if (isMounted) setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [selectedPeriodId]);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center gap-3 bg-background py-4 px-4 md:px-6">
              <SidebarTrigger className="md:hidden" />
              <div>
                <h1 className="text-2xl md:text-4xl font-bold">Grades</h1>
              </div>
            </header>

            <div className="border-t-2 border-border -mt-[1px] py-4 px-4 md:px-6 flex flex-col gap-3">
              {loading ? (
              <LoadingPanel label="Loading grades..." />
            ) : classes.length === 0 ? (
              <EmptyStateCard title="No classes assigned." />
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
