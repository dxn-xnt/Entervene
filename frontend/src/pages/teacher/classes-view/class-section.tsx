import { useMemo } from "react";
import { ChevronRight, Info, RefreshCw, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/retroui/Button";
import { useTeacherClasses } from "@/hooks/use-teacher-classes";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import type { TeacherClassItem } from "@/lib/api";

type ClassSummary = {
  class_id: number;
  section_name: string;
  subjects: TeacherClassItem[];
};

function Pill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-gray-500 bg-white px-2 py-1 text-[11px] font-medium">
      {label}
    </span>
  );
}

function ClassCard({ item }: { item: ClassSummary }) {
  const navigate = useNavigate();
  const primarySubject = item.subjects[0];

  return (
    <button
      type="button"
      onClick={() => {
        if (primarySubject) {
          navigate(`/teacher/classes/${item.class_id}/subjects/${primarySubject.subject_id}`);
        }
      }}
      className="min-h-32 rounded border border-black bg-[#F6E9B2] p-4 text-left shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition hover:-translate-y-0.5"
    >
      <h2 className="text-2xl font-bold leading-tight text-gray-950">{item.section_name}</h2>
      <p className="text-sm font-semibold text-gray-800">
        {primarySubject?.subject_name || "No subject assigned"}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {item.subjects.slice(0, 3).map((subject) => (
          <Pill key={subject.subject_load_id || `${subject.class_id}-${subject.subject_id}`} label={subject.subject_name} />
        ))}
      </div>
    </button>
  );
}

export default function ClassSections() {
  const {
    classes: loads,
    isLoading,
    error,
    refetch,
    selectedPeriodId,
  } = useTeacherClasses({ includeAdvisory: false });
  const { periods } = useAcademicPeriod();
  const currentPeriod = periods.find((p) => p.id === selectedPeriodId);

  const classes = useMemo(() => {
    const byClass = new Map<number, ClassSummary>();
    loads.forEach((load) => {
      const existing = byClass.get(load.class_id);
      if (existing) {
        if (!existing.subjects.some((s) => s.subject_id === load.subject_id)) {
          existing.subjects.push(load);
        }
      } else {
        byClass.set(load.class_id, {
          class_id: load.class_id,
          section_name: load.section_name,
          subjects: [load],
        });
      }
    });

    return Array.from(byClass.values()).sort((a, b) =>
      a.section_name.localeCompare(b.section_name)
    );
  }, [loads]);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center gap-3 bg-background py-4 px-4 md:px-6">
              <SidebarTrigger className="md:hidden" />
              <h1 className="text-2xl md:text-4xl font-bold tracking-tight">Classes</h1>
            </header>

            <div className="border-t-2 border-border -mt-[1px] py-4 px-4 md:px-6 flex flex-col gap-5">
              {error && (
                <div className="flex items-center justify-between rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <span>{error.message}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void refetch()}
                    className="ml-3 h-7 text-xs border-red-400 text-red-700 hover:bg-red-100"
                  >
                    <RefreshCw className="mr-1 size-3" /> Retry
                  </Button>
                </div>
              )}

        <section className="rounded border border-black bg-[#F6E9B2] px-5 py-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-3xl font-bold">
                {currentPeriod ? `${currentPeriod.academicyear} (${currentPeriod.period})` : "Current Term"}
              </h2>
              <p className="text-xs font-medium">Sections assigned for this academic term</p>
            </div>
            <Info size={16} />
          </div>
        </section>

        <div className="flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-2 md:max-w-sm">
          <Search size={16} className="text-gray-500" />
          <span className="text-sm text-gray-500">Assigned class sections</span>
        </div>

        {isLoading ? (
          <p className="py-8 text-center text-gray-500">Loading classes...</p>
        ) : (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {classes.map((item) => (
              <ClassCard key={item.class_id} item={item} />
            ))}
          </section>
        )}

        <section className="flex flex-col gap-3">
          {["2023 - 2024", "2022 - 2023", "2021 - 2022"].map((year) => (
            <button
              key={year}
              type="button"
              className="flex items-center justify-between rounded border border-gray-300 bg-white px-4 py-3 text-left font-semibold text-gray-700"
            >
              {year}
              <ChevronRight size={18} />
            </button>
          ))}
        </section>
      </div>
    </div>
  </div>
</div>
    </AppLayout>
  );
}
