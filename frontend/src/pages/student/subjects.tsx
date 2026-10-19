import { useEffect, useState } from "react";
import AppLayout from "@/layouts/app-layout";

import { routes } from "@/../routes";
import { apiFetch, getStudentTodos, type TodoItem } from "@/lib/api";
import { LoadingPanel } from "@/components/loading-panel";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Empty } from "@/components/retroui/Empty";
import { Button } from "@/components/retroui/Button";
import { StudentSubjectSectionCard } from "@/components/student/student-subject-section-card";

interface EnrolledSubject {
  subject_load_id: number;
  class_id: number;
  subject_id: number;
  subject_name: string;
  subject_codename?: string;
  teacher_name: string;
  teacher_avatar?: string | null;
  period_name: string;
  is_current_period: boolean;
  is_current_quarter: boolean;
  section_name: string;
  year_label: string;
}

const Subjects = () => {

  const [subjects, setSubjects] = useState<EnrolledSubject[]>([]);
  const [classworks, setClassworks] = useState<TodoItem[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchSubjects();
  }, []);

  const fetchSubjects = async () => {
    setIsLoading(true);
    setError("");
    try {
      const [res, todos] = await Promise.all([
        apiFetch("/api/v1/students/me/subjects"),
        getStudentTodos().catch(() => null),
      ]);
      if (!res.ok) throw new Error("Failed to load subjects");
      const data = (await res.json()) as EnrolledSubject[];
      setSubjects(data);
      setClassworks(todos?.all ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load subjects");
    } finally {
      setIsLoading(false);
    }
  };

  const subjectHref = (subject: EnrolledSubject): string =>
    routes.student.subjectDetail
      .replace(":classId", String(subject.class_id))
      .replace(":subjectId", String(subject.subject_id));

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-clip">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <SidebarTrigger className="shrink-0 md:hidden" />
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl md:text-4xl">
                Subjects
              </h1>
            </header>

            <div className="-mt-[1px] flex min-w-0 flex-col gap-3 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
              {isLoading ? (
                <LoadingPanel label="Loading subjects..." />
              ) : error ? (
                <div className="flex w-full flex-col items-center justify-center gap-4 px-4 py-12 text-center sm:py-20">
                  <p className="break-words text-sm text-red-500 sm:text-base">{error}</p>
                  <Button
                    type="button"
                    onClick={fetchSubjects}
                    variant="secondary"
                    size="sm"
                  >
                    Retry
                  </Button>
                </div>
              ) : subjects.length === 0 ? (
                <Empty className="px-4 py-10 sm:px-6 sm:py-12">
                  <Empty.Content>
                    <Empty.Title>No enrolled subjects found.</Empty.Title>
                  </Empty.Content>
                </Empty>
              ) : (
                <div className="grid min-w-0 grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {subjects.map((subject) => (
                    <StudentSubjectSectionCard
                      key={subject.subject_load_id}
                      to={subjectHref(subject)}
                      subjectName={subject.subject_name}
                      sectionName={subject.section_name}
                      teacherName={subject.teacher_name}
                      teacherAvatar={subject.teacher_avatar}
                      periodName={subject.period_name}
                      yearLabel={subject.year_label}
                      isCurrentPeriod={subject.is_current_period}
                      classworks={classworks?.filter((item) =>
                        item.class_id === subject.class_id && item.subject_id === subject.subject_id,
                      ) ?? null}
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

export default Subjects;
