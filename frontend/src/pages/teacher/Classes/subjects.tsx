import { ChevronRight, Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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

type SubjectSummary = {
  subject_id: number;
  subject_name: string;
  classes: TeacherClassLoad[];
};

const Subject = () => {
  const navigate = useNavigate();
  const [loads, setLoads] = useState<TeacherClassLoad[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const loadSubjects = async () => {
      setIsLoading(true);
      setError("");

      try {
        const response = await apiFetch("/api/v1/classwork-assignments/teacher/classes");
        if (!response.ok) {
          throw new Error("Unable to load subjects.");
        }

        setLoads((await response.json()) as TeacherClassLoad[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load subjects.");
      } finally {
        setIsLoading(false);
      }
    };

    loadSubjects();
  }, []);

  const subjects = useMemo(() => {
    const bySubject = new Map<number, SubjectSummary>();
    loads.forEach((load) => {
      const existing = bySubject.get(load.subject_id);
      if (existing) {
        existing.classes.push(load);
      } else {
        bySubject.set(load.subject_id, {
          subject_id: load.subject_id,
          subject_name: load.subject_name,
          classes: [load],
        });
      }
    });

    return Array.from(bySubject.values()).sort((a, b) =>
      a.subject_name.localeCompare(b.subject_name)
    );
  }, [loads]);

  return (
    <AppLayout>
      <header className="border-b border-gray-300 bg-white px-5 py-5">
        <h1 className="text-3xl font-bold text-gray-950">Subject</h1>
      </header>

      <main className="flex flex-col gap-4 px-5 py-5">
        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="rounded-lg border border-black bg-[#F6E9B2] px-5 py-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-3xl font-bold">2024 - 2025</h2>
              <p className="text-xs font-medium">Subjects assigned for this academic year</p>
            </div>
            <Info size={16} />
          </div>
        </section>

        {isLoading ? (
          <p className="py-8 text-center text-gray-500">Loading subjects...</p>
        ) : (
          subjects.map((subject) => {
            const firstClass = subject.classes[0];
            return (
              <button
                key={subject.subject_id}
                type="button"
                onClick={() => {
                  if (firstClass) {
                    navigate(`/teacher/classes/${firstClass.class_id}/subjects/${subject.subject_id}`);
                  }
                }}
                className="flex flex-col gap-1 rounded-lg border border-black bg-white px-4 py-3 text-left shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
              >
                <p className="text-2xl font-bold text-gray-950">{subject.subject_name}</p>
                <p className="text-xs font-medium text-gray-700">
                  Assigned to {subject.classes.length} section{subject.classes.length === 1 ? "" : "s"}
                </p>
              </button>
            );
          })
        )}

        <button
          type="button"
          className="mt-1 flex items-center justify-between rounded-lg border border-gray-300 bg-white px-4 py-3 text-left font-semibold text-gray-700"
        >
          Archived Subjects
          <ChevronRight size={18} />
        </button>
      </main>
    </AppLayout>
  );
};

export default Subject;
