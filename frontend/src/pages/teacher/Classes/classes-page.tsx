import { Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { apiFetch, getTeacherAdvisoryClasses } from "@/lib/api";
import type { TeacherAdvisoryClassListItem } from "@/types/adminClasses";

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

function AdvisoryCard({ item, onClick }: { item: TeacherAdvisoryClassListItem; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border-2 border-black bg-[#F6E9B2] p-4 text-left shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition hover:-translate-y-0.5 md:p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-black leading-tight text-gray-950">
            {item.section_name}
          </h2>
          <p className="mt-1 text-xs font-medium text-gray-800">
            {item.academic_level} · {item.academic_year}
          </p>
        </div>
        <span className="rounded-full border-2 border-black bg-[#7ABA78] px-3 py-1 text-xs font-black">
          Adviser
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <MetricPill label={item.is_archived ? "Archived" : "Active"} />
        <MetricPill label="Students" count={item.student_count} />
        <MetricPill label="Subjects" count={item.subject_count} />
      </div>
    </button>
  );
}

function SubjectClassCard({
  load,
  isAdvisory,
  gradeLabel,
  onClick,
}: {
  load: TeacherClassLoad;
  isAdvisory: boolean;
  gradeLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-28 rounded-lg border-2 border-black p-4 text-left shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] transition hover:-translate-y-0.5 ${
        isAdvisory ? "bg-[#7ABA78]" : "bg-white"
      }`}
    >
      <h3 className="truncate text-xl font-black text-gray-950">{load.section_name}</h3>
      <p className="mt-1 text-xs font-medium text-gray-700">
        {load.subject_name}
        {isAdvisory ? " · you advise this" : ""}
      </p>
      <p className="mt-3 text-xs font-semibold text-gray-800">{gradeLabel}</p>
    </button>
  );
}

const ClassesPage = () => {
  const navigate = useNavigate();
  const [loads, setLoads] = useState<TeacherClassLoad[]>([]);
  const [advisoryClasses, setAdvisoryClasses] = useState<TeacherAdvisoryClassListItem[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const loadTeacherClasses = async () => {
      setIsLoading(true);
      setError("");

      try {
        const [response, advisoryData] = await Promise.all([
          apiFetch("/api/v1/classwork-assignments/teacher/classes"),
          getTeacherAdvisoryClasses(),
        ]);
        if (!response.ok) {
          throw new Error("Unable to load teacher classes.");
        }

        setLoads((await response.json()) as TeacherClassLoad[]);
        setAdvisoryClasses(advisoryData);
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

  const advisoryByClass = useMemo(() => {
    return new Map(advisoryClasses.map((item) => [item.class_id, item]));
  }, [advisoryClasses]);

  const groupedSubjectLoads = useMemo(() => {
    const groups = new Map<string, TeacherClassLoad[]>();
    loads.forEach((load) => {
      const gradeLabel = advisoryByClass.get(load.class_id)?.academic_level || "Teaching Sections";
      groups.set(gradeLabel, [...(groups.get(gradeLabel) || []), load]);
    });

    return Array.from(groups.entries())
      .map(([gradeLabel, classLoads]) => ({
        gradeLabel,
        loads: classLoads.sort((a, b) =>
          a.section_name.localeCompare(b.section_name) || a.subject_name.localeCompare(b.subject_name)
        ),
      }))
      .sort((a, b) => a.gradeLabel.localeCompare(b.gradeLabel));
  }, [advisoryByClass, loads]);

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
                <section className="flex flex-col gap-3">
                  <div>
                    <p className="text-base font-black">Advisory class</p>
                  </div>
                  {advisoryClasses.length === 0 ? (
                    <p className="rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-600">
                      No advisory classes assigned.
                    </p>
                  ) : (
                    <div className="grid gap-4">
                      {advisoryClasses.map((item) => (
                        <AdvisoryCard
                          key={item.class_id}
                          item={item}
                          onClick={() => navigate(`/teacher/classes/${item.class_id}`)}
                        />
                      ))}
                    </div>
                  )}
                </section>

                <section className="flex flex-col gap-4">
                  <p className="text-base font-black">My subjects</p>
                  {groupedSubjectLoads.length === 0 ? (
                    <p className="rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-600">
                      No subject teaching sections assigned.
                    </p>
                  ) : (
                    groupedSubjectLoads.map((group) => (
                      <div key={group.gradeLabel} className="flex flex-col gap-3">
                        <p className="text-sm font-medium text-gray-800">{group.gradeLabel}</p>
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                          {group.loads.map((load) => {
                            const advisoryClass = advisoryByClass.get(load.class_id);
                            return (
                              <SubjectClassCard
                                key={load.subject_load_id}
                                load={load}
                                isAdvisory={Boolean(advisoryClass)}
                                gradeLabel={advisoryClass?.academic_year || "Subject teaching section"}
                                onClick={() =>
                                  navigate(`/teacher/classes/${load.class_id}/subjects/${load.subject_id}`)
                                }
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
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
