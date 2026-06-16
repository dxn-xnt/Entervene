import { useEffect, useState } from "react";
import AppLayout from "@/layouts/app-layout";
import Card from "../../components/StudentUIComponents/Card";
import { ArrowUpRight, Loader2, BookOpen } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
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
              <h1 className="text-2xl md:text-4xl font-semibold">
                Story Board
              </h1>
            </header>

            <div className="-mx-4 md:-mx-6 border-b border-gray-500" />

            <div className="flex flex-col lg:flex-row lg:items-stretch gap-4 flex-1">
              <div className="grid grid-cols-2 gap-4 flex-1 content-start">
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
                      badges={[
                        { label: subject.section_name || "Section", count: 0 },
                      ]}
                    />
                  ))
                )}
              </div>

              <div className="lg:w-[35%] border rounded px-5 py-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <div className="flex flex-row justify-between items-center">
                  <h2 className="text-2xl md:text-3xl font-semibold">To do</h2>
                  <button
                    onClick={() => navigate(routes.student.todo)}
                    className="border border-black rounded-full p-1 cursor-pointer"
                  >
                    <ArrowUpRight size={18} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default StoryBoard;
