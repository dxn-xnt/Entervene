import { useEffect, useState } from "react";
import AppLayout from "@/layouts/app-layout";
import Card from "../../components/StudentUIComponents/Card";
import { ArrowUpRight, Loader2, BookOpen } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { routes } from "@/../routes";
import { apiFetch } from "@/lib/api";

interface EnrolledSubject {
  subject_load_id: number;
  class_id: number;
  subject_id: number;
  subject_name: string;
  teacher_name: string;
  section_name: string;
}

const StoryBoard = () => {
  const navigate = useNavigate();
  const [subjects, setSubjects] = useState<EnrolledSubject[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/v1/students/me/subjects")
      .then((r) => r.json())
      .then((data) => setSubjects(data))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const handleSubjectClick = (subject: EnrolledSubject) => {
    navigate(
      routes.student.subjectDetail
        .replace(":classId", String(subject.class_id))
        .replace(":subjectId", String(subject.subject_id))
    );
  };

  return (
    <AppLayout>
      <header className="px-5 py-5 border-b border-gray-500">
        <h1 className="text-4xl font-semibold">Story Board</h1>
      </header>
      <main className="px-5 py-5 flex flex-row gap-4 min-h-screen">
        <div className="grid grid-cols-2 gap-4 w-[65%] self-start">
          {isLoading ? (
            <div className="col-span-2 flex justify-center py-16">
              <Loader2 className="animate-spin text-gray-400" size={36} />
            </div>
          ) : subjects.length === 0 ? (
            <div className="col-span-2 flex flex-col items-center py-16 gap-3 text-gray-400">
              <BookOpen size={40} className="opacity-50" />
              <p>No enrolled subjects found</p>
            </div>
          ) : (
            subjects.map((subject) => (
              <Card
                key={subject.subject_load_id}
                title={subject.subject_name}
                onClick={() => handleSubjectClick(subject)}
                teacher={subject.teacher_name}
                badges={[{ label: subject.section_name || "Section", count: 0 }]}
              />
            ))
          )}
        </div>

        <div className="w-[35%] border rounded px-5 py-5 self-stretch shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex flex-row justify-between items-center">
            <h2 className="text-3xl font-semibold">To do</h2>
            <button
              onClick={() => navigate(routes.student.todo)}
              className="border border-black rounded-full p-1 cursor-pointer"
            >
              <ArrowUpRight size={18} />
            </button>
          </div>
        </div>
      </main>
    </AppLayout>
  );
};

export default StoryBoard;
