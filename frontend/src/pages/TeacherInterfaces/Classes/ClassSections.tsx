import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Info, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { apiFetch } from "@/lib/api";

type TeacherClassLoad = {
  subject_load_id: number;
  subject_id: number;
  subject_name: string;
  subject_codename?: string | null;
  class_id: number;
  section_name: string;
};

type ClassSummary = {
  class_id: number;
  section_name: string;
  subjects: TeacherClassLoad[];
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
      className="min-h-32 rounded-lg border border-black bg-[#F6E9B2] p-4 text-left shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition hover:-translate-y-0.5"
    >
      <h2 className="text-2xl font-bold leading-tight text-gray-950">{item.section_name}</h2>
      <p className="text-sm font-semibold text-gray-800">
        {primarySubject?.subject_name || "No subject assigned"}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {item.subjects.slice(0, 3).map((subject) => (
          <Pill key={subject.subject_load_id} label={subject.subject_name} />
        ))}
      </div>
    </button>
  );
}

export default function ClassSections() {
  const [loads, setLoads] = useState<TeacherClassLoad[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const loadClasses = async () => {
      setIsLoading(true);
      setError("");

      try {
        const response = await apiFetch("/api/v1/classwork-assignments/teacher/classes");
        if (!response.ok) {
          throw new Error("Unable to load classes.");
        }

        setLoads((await response.json()) as TeacherClassLoad[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load classes.");
      } finally {
        setIsLoading(false);
      }
    };

    loadClasses();
  }, []);

  const classes = useMemo(() => {
    const byClass = new Map<number, ClassSummary>();
    loads.forEach((load) => {
      const existing = byClass.get(load.class_id);
      if (existing) {
        existing.subjects.push(load);
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
      <header className="border-b border-gray-300 bg-white px-5 py-5">
        <h1 className="text-3xl font-bold text-gray-950">Classes</h1>
      </header>

      <main className="flex flex-col gap-5 px-5 py-5">
        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="rounded-lg border border-black bg-[#F6E9B2] px-5 py-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-3xl font-bold">2024 - 2025</h2>
              <p className="text-xs font-medium">Sections assigned for this academic year</p>
            </div>
            <Info size={16} />
          </div>
        </section>

        <div className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 md:max-w-sm">
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
              className="flex items-center justify-between rounded-lg border border-gray-300 bg-white px-4 py-3 text-left font-semibold text-gray-700"
            >
              {year}
              <ChevronRight size={18} />
            </button>
          ))}
        </section>
      </main>
    </AppLayout>
  );
}
