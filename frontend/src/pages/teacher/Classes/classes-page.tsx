import { ArrowUpRight, Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { apiFetch } from "@/lib/api";

type TeacherClassLoad = {
  subject_load_id: number;
  subject_id: number;
  subject_name: string;
  subject_codename?: string | null;
  class_id: number;
  section_name: string;
};

type CardBadge = {
  label: string;
  count?: number;
};

function MetricPill({ label, count }: CardBadge) {
  return (
    <span className="inline-flex items-center rounded-full border border-gray-500 bg-white px-2 py-1 text-[11px] font-medium">
      {label} {count !== undefined ? count : ""}
    </span>
  );
}

function DashboardCard({
  title,
  subtitle,
  badges,
  onClick,
}: {
  title: string;
  subtitle?: string;
  badges: CardBadge[];
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-28 rounded-lg border border-black bg-[#F6E9B2] p-4 text-left transition hover:-translate-y-0.5"
    >
      <h2 className="truncate text-2xl font-bold leading-tight text-gray-950">
        {title}
      </h2>
      {subtitle && (
        <p className="text-sm font-semibold text-gray-800">{subtitle}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {badges.map((badge) => (
          <MetricPill key={badge.label} {...badge} />
        ))}
      </div>
    </button>
  );
}

const ClassesPage = () => {
  const navigate = useNavigate();
  const [loads, setLoads] = useState<TeacherClassLoad[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const loadTeacherClasses = async () => {
      setIsLoading(true);
      setError("");

      try {
        const response = await apiFetch(
          "/api/v1/classwork-assignments/teacher/classes",
        );
        if (!response.ok) {
          throw new Error("Unable to load teacher classes.");
        }

        setLoads((await response.json()) as TeacherClassLoad[]);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load teacher classes.",
        );
      } finally {
        setIsLoading(false);
      }
    };

    loadTeacherClasses();
  }, []);

  const subjects = useMemo(() => {
    const bySubject = new Map<number, TeacherClassLoad[]>();
    loads.forEach((load) => {
      bySubject.set(load.subject_id, [
        ...(bySubject.get(load.subject_id) || []),
        load,
      ]);
    });

    return Array.from(bySubject.entries())
      .map(([subjectId, subjectLoads]) => ({
        subjectId,
        subjectName: subjectLoads[0]?.subject_name || "Subject",
        classes: subjectLoads,
      }))
      .sort((a, b) => a.subjectName.localeCompare(b.subjectName));
  }, [loads]);

  const classes = useMemo(() => {
    const byClass = new Map<number, TeacherClassLoad[]>();
    loads.forEach((load) => {
      byClass.set(load.class_id, [...(byClass.get(load.class_id) || []), load]);
    });

    return Array.from(byClass.entries())
      .map(([classId, classLoads]) => ({
        classId,
        sectionName: classLoads[0]?.section_name || "Class",
        subjects: classLoads,
      }))
      .sort((a, b) => a.sectionName.localeCompare(b.sectionName));
  }, [loads]);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6">
            <header className="flex items-center gap-3 border-b border-gray-300 pb-4">
              <SidebarTrigger className="md:hidden" />
              <h1 className="text-2xl md:text-4xl font-semibold">
                Classes
              </h1>
            </header>

            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <section className="rounded-lg border border-black bg-[#F6E9B2] px-5 py-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl md:text-3xl font-bold">
                    2024 - 2025
                  </h2>
                  <p className="text-xs font-medium">
                    Sections assigned for this academic year
                  </p>
                </div>
                <Info size={16} />
              </div>
            </section>

            {isLoading ? (
              <p className="py-8 text-center text-gray-500">
                Loading classes...
              </p>
            ) : (
              <>
                <section className="flex flex-col gap-4 rounded-lg border border-black bg-white px-5 py-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <div className="flex items-center justify-between">
                    <p className="text-xl md:text-2xl font-bold">Subjects</p>
                    <button
                      type="button"
                      onClick={() => navigate("/teacher/classes/subjects")}
                      className="rounded-full border border-black p-1"
                    >
                      <ArrowUpRight size={18} />
                    </button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {subjects.map((subject) => (
                      <DashboardCard
                        key={subject.subjectId}
                        title={subject.subjectName}
                        badges={[
                          { label: "Classes", count: subject.classes.length },
                          { label: "Lessons", count: 0 },
                        ]}
                        onClick={() => {
                          const firstClass = subject.classes[0];
                          if (firstClass) {
                            navigate(
                              `/teacher/classes/${firstClass.class_id}/subjects/${subject.subjectId}`,
                            );
                          }
                        }}
                      />
                    ))}
                  </div>
                </section>

                <section className="flex flex-col gap-4 rounded-lg border border-black bg-white px-5 py-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <div className="flex items-center justify-between">
                    <p className="text-xl md:text-2xl font-bold">Classes</p>
                    <button
                      type="button"
                      onClick={() => navigate("/teacher/classes/sections")}
                      className="rounded-full border border-black p-1"
                    >
                      <ArrowUpRight size={18} />
                    </button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {classes.map((item) => {
                      const primarySubject = item.subjects[0];
                      return (
                        <DashboardCard
                          key={item.classId}
                          title={item.sectionName}
                          subtitle={primarySubject?.subject_name}
                          badges={[
                            { label: "Subjects", count: item.subjects.length },
                            { label: "Lessons", count: 0 },
                          ]}
                          onClick={() => {
                            if (primarySubject) {
                              navigate(
                                `/teacher/classes/${item.classId}/subjects/${primarySubject.subject_id}`,
                              );
                            }
                          }}
                        />
                      );
                    })}
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default ClassesPage;
