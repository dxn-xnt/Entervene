import { useCallback, useEffect, useRef, useState } from "react";
import AppLayout from "@/layouts/app-layout";

import { routes } from "@/../routes";
import {
  getMySubjects,
  getStudentTodos,
  type StudentSubjectItem,
  type TodoItem,
} from "@/lib/api";
import { LoadingPanel } from "@/components/loading-panel";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { StudentEmptyState } from "@/components/student/student-empty-state";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/student/button";
import { StudentSubjectSectionCard } from "@/components/student/student-subject-section-card";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";

const Subjects = () => {
  const { selectedPeriodId } = useAcademicPeriod();
  const requestVersionRef = useRef(0);
  const [subjects, setSubjects] = useState<StudentSubjectItem[]>([]);
  const [classworks, setClassworks] = useState<TodoItem[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchSubjects = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current;
    setIsLoading(true);
    setError("");
    setSubjects([]);
    setClassworks(null);
    try {
      const [data, todos] = await Promise.all([
        getMySubjects(selectedPeriodId ?? undefined),
        getStudentTodos(selectedPeriodId ?? undefined).catch(() => null),
      ]);
      if (requestVersion !== requestVersionRef.current) return;
      setSubjects(data);
      setClassworks(todos?.all ?? null);
    } catch (err) {
      if (requestVersion !== requestVersionRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load subjects");
    } finally {
      if (requestVersion === requestVersionRef.current) {
        setIsLoading(false);
      }
    }
  }, [selectedPeriodId]);

  useEffect(() => {
    void fetchSubjects();
    return () => {
      requestVersionRef.current += 1;
    };
  }, [fetchSubjects]);

  const subjectHref = (subject: StudentSubjectItem): string =>
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
              <h1 className="text-xl font-bold sm:text-2xl md:text-4xl">
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
                <StudentEmptyState icon={<BookOpen />} title="No subjects yet" description="Your assigned subjects will appear here once your enrollment is available." />
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
