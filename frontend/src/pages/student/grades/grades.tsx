import { useState } from "react";
import { Card } from "@/components/retroui/Card";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { LoadingPanel } from "@/components/loading-panel";
import { EmptyStateCard } from "@/components/empty-state-card";
import { useStudentOverviewData } from "@/hooks/use-student-overview-data";
import SubjectGrade from "./subject-grade";

const Grades = () => {
  const [selectedSubject, setSelectedSubject] = useState<{ id: number; classId?: number; name: string } | null>(null);
  const { subjects, todos, isLoading, error } = useStudentOverviewData();

  if (selectedSubject) {
    return <SubjectGrade subjectId={selectedSubject.id} classId={selectedSubject.classId} subject={selectedSubject.name} onBack={() => setSelectedSubject(null)} />;
  }

  const getGradedCount = (subjectId: number) => todos.filter((todo) =>
    todo.subject_id === subjectId && todo.is_graded !== false &&
    todo.type?.toUpperCase() !== "READING" &&
    (todo.status === "completed" || todo.is_submitted || todo.grade !== null)
  ).length;

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-clip">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <SidebarTrigger className="shrink-0 md:hidden" />
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl md:text-4xl">Grades</h1>
            </header>
            <div className="-mt-[1px] flex min-w-0 flex-col gap-4 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
              {isLoading ? <LoadingPanel label="Loading subjects..." /> : error ? (
                <EmptyStateCard title="Unable to load subjects" description={error} />
              ) : subjects.length === 0 ? <EmptyStateCard title="No subjects enrolled." /> : subjects.map((subject) => (
                <Card key={subject.subject_load_id} className="block w-full cursor-pointer transition-colors hover:border-border"
                  onClick={() => setSelectedSubject({ id: subject.subject_id, classId: subject.class_id, name: subject.subject_name })}>
                  <Card.Content className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <Card.Title className="mb-1 truncate text-lg">{subject.subject_name}</Card.Title>
                      <p className="truncate text-sm text-muted-foreground">{subject.teacher_name}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Card.Description>{getGradedCount(subject.subject_id)}</Card.Description>
                      <p className="text-xs text-muted-foreground">Graded Classwork</p>
                    </div>
                  </Card.Content>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Grades;
