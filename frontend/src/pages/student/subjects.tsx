import { useEffect, useState } from "react";
import AppLayout from "@/layouts/app-layout";
import Card from "../../components/StudentUIComponents/Card";
import { useNavigate } from "react-router-dom";
import { routes } from "@/../routes";
import { apiFetch } from "@/lib/api";
import { BookOpen, Loader2 } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";

interface EnrolledSubject {
  subject_load_id: number;
  class_id: number;
  subject_id: number;
  subject_name: string;
  subject_codename?: string;
  teacher_name: string;
  period_name: string;
  is_current_quarter: boolean;
  section_name: string;
  year_label: string;
}

const Subjects = () => {
  const navigate = useNavigate();
  const [subjects, setSubjects] = useState<EnrolledSubject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchSubjects();
  }, []);

  const fetchSubjects = async () => {
    setIsLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/v1/students/me/subjects");
      if (!res.ok) throw new Error("Failed to load subjects");
      const data = await res.json();
      setSubjects(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load subjects");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubjectClick = (subject: EnrolledSubject) => {
    navigate(
      routes.student.subjectDetail
        .replace(":classId", String(subject.class_id))
        .replace(":subjectId", String(subject.subject_id)),
    );
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6 flex-1">
            <header className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" />
              <h1 className="text-2xl md:text-4xl font-semibold">Subjects</h1>
            </header>

            <div className="-mx-4 md:-mx-6 border-b border-gray-500" />

            {isLoading ? (
              <div className="flex items-center justify-center w-full py-20">
                <Loader2 className="animate-spin text-gray-400" size={40} />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center w-full py-20 gap-4">
                <p className="text-red-500">{error}</p>
                <button
                  onClick={fetchSubjects}
                  className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : subjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center w-full py-20 gap-3 text-gray-500">
                <BookOpen size={48} className="opacity-40" />
                <p className="text-lg">No enrolled subjects found</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {subjects.map((subject) => (
                  <Card
                    key={subject.subject_load_id}
                    title={subject.subject_name}
                    onClick={() => handleSubjectClick(subject)}
                    teacher={subject.teacher_name}
                    badges={[
                      { label: subject.section_name || "Section", count: 0 },
                    ]}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Subjects;
