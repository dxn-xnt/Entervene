import { useState } from "react";
import AppLayout from "@/layouts/app-layout";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import {
  ArrowUpRight,
  BookOpen,
  Calendar,
  Check,
  CheckSquare,
  ClipboardList,
  FileText,
  Zap,
} from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { EmptyStateCard } from "@/components/empty-state-card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useNavigate } from "react-router-dom";
import { routes } from "@/../routes";
import type { TodoItem } from "@/lib/api";
import { Badge } from "@/components/retroui/Badge";
import { GradeOverviewCards } from "@/components/student/grade-overview-cards";
import { SubjectCard } from "@/components/subject-card";
import { useStudentOverviewData } from "@/hooks/use-student-overview-data";

const INITIAL_SUBJECTS_LIMIT = 4;

const StoryBoard = () => {
  const navigate = useNavigate();
  const { subjects, todos, urgentTodos, isLoading, error } = useStudentOverviewData();
  const [isSubjectsExpanded, setIsSubjectsExpanded] = useState(false);

  const displayedSubjects = isSubjectsExpanded
    ? subjects
    : subjects.slice(0, INITIAL_SUBJECTS_LIMIT);
  const remainingSubjectsCount = subjects.length - INITIAL_SUBJECTS_LIMIT;

  const handleSubjectClick = (subject: { class_id: number; subject_id: number }) => {
    navigate(
      routes.student.subjectDetail
        .replace(":classId", String(subject.class_id))
        .replace(":subjectId", String(subject.subject_id)),
    );
  };

  const getSubjectStats = (subjectId: number) => {
    const subjectTodos = todos.filter((t) => t.subject_id === subjectId);
    const pendingTodos = subjectTodos.filter(
      (t) => !t.is_submitted && t.status !== "completed",
    );
    const completedTodos = subjectTodos.filter(
      (t) => t.is_submitted || t.status === "completed" || t.grade !== null,
    );
    const completionRate =
      subjectTodos.length > 0
        ? Math.round((completedTodos.length / subjectTodos.length) * 100)
        : 0;
    const latestPending =
      pendingTodos.find((t) => t.deadline && t.deadline !== "No deadline") ||
      pendingTodos[0];

    return {
      pendingCount: pendingTodos.length,
      completionRate,
      latestActivityTitle: latestPending?.title,
      latestActivityDue: latestPending?.deadline
        ? `Due ${latestPending.deadline}`
        : undefined,
    };
  };

  const getClassworkIcon = (type?: string | null, category?: string | null) => {
    const normalized = (type || category || "").toUpperCase();
    switch (normalized) {
      case "READING":
      case "READINGS":
        return BookOpen;
      case "ACTIVITY":
      case "ACTIVITIES":
        return CheckSquare;
      case "QUIZ":
      case "QUIZZES":
        return ClipboardList;
      case "ASSIGNMENT":
      case "ASSIGNMENTS":
      default:
        return FileText;
    }
  };

  const openTodo = async (item: TodoItem) => {
    let targetClassId = item.class_id;

    if (!targetClassId && item.subject_id) {
      const subject = subjects.find((candidate) => candidate.subject_id === item.subject_id);
      if (subject) targetClassId = subject.class_id;
    }

    if (targetClassId && item.subject_id) {
      navigate(
        `/student/subjects/${targetClassId}/${item.subject_id}?tab=classwork&classworkAssignmentId=${item.assignment_id}`,
      );
    } else {
      navigate(routes.student.todo);
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-clip">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center justify-between gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <h1 className="whitespace-nowrap text-xl font-bold tracking-tight sm:text-2xl md:text-4xl">
                  Study Board
                </h1>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  size="header"
                  onClick={() => navigate(routes.student.profile)}
                  className="whitespace-nowrap"
                  aria-label="View my schedule"
                >
                  <Calendar className="size-4" />
                  <span className="sm:hidden">Schedule</span>
                  <span className="hidden sm:inline">View My Schedule</span>
                </Button>
              </div>
            </header>

            <div className="-mt-[1px] flex flex-1 flex-col gap-4 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                {/* Left 2 Columns: Grade Overview + Enrolled Subjects */}
                <div className="flex w-full min-w-0 flex-col gap-4 xl:col-span-2">
                  <GradeOverviewCards todos={todos} isLoading={isLoading} error={error} />

                  <Card className="flex w-full min-w-0 flex-col gap-3">
                    {isLoading ? (
                      <LoadingPanel label="Loading subjects..." />
                    ) : error ? (
                      <EmptyStateCard
                        title="Unable to load subjects"
                        description={error}
                        className="border-none bg-card shadow-none hover:shadow-none"
                      />
                    ) : subjects.length === 0 ? (
                      <EmptyStateCard
                        title="No enrolled subjects found"
                        description="You are not enrolled in any subjects for this period."
                        className="border-none bg-white shadow-none hover:shadow-none"
                      />
                    ) : (
                      <>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {displayedSubjects.map((subject) => {
                            const stats = getSubjectStats(subject.subject_id);
                            return (
                              <SubjectCard
                                key={subject.subject_load_id}
                                title={subject.subject_name}
                                pendingCount={stats.pendingCount}
                                completionRate={stats.completionRate}
                                latestActivityTitle={stats.latestActivityTitle}
                                latestActivityDue={stats.latestActivityDue}
                                onClick={() => handleSubjectClick(subject)}
                              />
                            );
                          })}
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <div>
                            {subjects.length > INITIAL_SUBJECTS_LIMIT && (
                              <Button
                                variant="default"
                                size="sm"
                                autoIcon={false}
                                onClick={() => setIsSubjectsExpanded((prev) => !prev)}
                                className="border-2 border-border shadow-none text-xs font-bold px-3 py-1.5 h-auto rounded bg-primary text-black hover:bg-primary/90"
                              >
                                {isSubjectsExpanded
                                  ? "Show less"
                                  : `Show ${remainingSubjectsCount} more`}
                              </Button>
                            )}
                          </div>
                          <Button
                            variant="link"
                            className="p-0 text-sm text-foreground inline-flex items-center gap-1 font-semibold hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(routes.student.subjects);
                            }}
                            title="View all subjects"
                          >
                            <span>View all subjects</span>
                            <ArrowUpRight className="size-4" />
                          </Button>
                        </div>
                      </>
                    )}
                  </Card>
                </div>

                {/* Right column: Week Streak + To do Card (Moved upward to top right) */}
                <div className="flex w-full min-w-0 flex-col gap-4 xl:col-span-1">
                  <Card className="block w-full border-black bg-white shadow-md hover:shadow-none">
                    <Card.Content className="">
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-row gap-2 items-center">
                          <Zap size={20} className="fill-primary text-foreground" />
                          <Text as="p" className="text-md font-semibold">
                            1 week streak
                          </Text>
                        </div>

                        <Text as="p" className="text-sm font-normal">
                          1-day streak — keep going, build the habit!
                        </Text>
                      </div>
                      <div className="mt-2 w-full">
                        <div className="grid w-full grid-cols-7 gap-1.5 sm:gap-2">
                          <Badge
                            size="md"
                            variant="secondary"
                            className="flex min-w-0 items-center justify-center px-1 sm:px-2.5"
                          >
                            <Check size={17} className="mt-0.5" />
                          </Badge>
                          <Badge size="md" variant="default" className="min-w-0 px-1 text-center sm:px-2.5 justify-center">
                            Tu
                          </Badge>
                          <Badge size="md" variant="default" className="min-w-0 px-1 text-center sm:px-2.5 justify-center">
                            We
                          </Badge>
                          <Badge size="md" variant="secondary" className="min-w-0 px-1 text-center sm:px-2.5  justify-center">
                            Th
                          </Badge>
                          <Badge size="md" variant="outline" className="min-w-0 px-1 text-center sm:px-2.5 justify-center">
                            Fr
                          </Badge>
                          <Badge size="md" variant="outline" className="min-w-0 px-1 text-center sm:px-2.5 justify-center">
                            Sa
                          </Badge>
                          <Badge size="md" variant="outline" className="min-w-0 px-1 text-center sm:px-2.5 justify-center">
                            Su
                          </Badge>
                        </div>
                      </div>
                    </Card.Content>
                  </Card>

                  <Card className="block w-full border-black bg-white shadow-md hover:shadow-none">
                    <Card.Content>
                      <div className="flex items-center justify-between mb-4">
                        <Card.Title className="mb-0 text-2xl md:text-3xl">
                          To do
                        </Card.Title>

                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => navigate(routes.student.todo)}
                          className="border-black bg-background"
                          aria-label="View all to-do items"
                        >
                          <ArrowUpRight size={18} />
                        </Button>
                      </div>

                      {isLoading ? (
                        <LoadingPanel label="Loading to-do items..." />
                      ) : error ? (
                        <EmptyStateCard
                          title="Unable to load to-do items"
                          description={error}
                          className="border-none bg-card shadow-none hover:shadow-none"
                        />
                      ) : urgentTodos.length === 0 ? (
                        <EmptyStateCard
                          title="All caught up!"
                          description="No pending tasks"
                          className="border-none bg-white shadow-none hover:shadow-none"
                        />
                      ) : (
                        <div className="flex flex-col gap-2.5">
                          {urgentTodos.map((item) => {
                            const IconComponent = getClassworkIcon(
                              item.type,
                              item.category,
                            );
                            return (
                              <Card
                                key={item.assignment_id}
                                onClick={() => openTodo(item)}
                                onKeyDown={(event) => {
                                  if (
                                    event.key === "Enter" ||
                                    event.key === " "
                                  ) {
                                    event.preventDefault();
                                    openTodo(item);
                                  }
                                }}
                                role="button"
                                tabIndex={0}
                                className="flex w-full cursor-pointer shadow-none items-center gap-3 border-black bg-background p-3 hover:-translate-y-1 hover:bg-accent! hover:text-foreground!"
                              >
                                <IconComponent
                                  size={20}
                                  className="shrink-0 text-black/70"
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-semibold text-sm">
                                    {item.title}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {item.subject} · {item.deadline}
                                  </p>
                                </div>
                                {item.status === "pastdue" && (
                                  <Badge
                                    variant="solid"
                                    size="sm"
                                    className="shrink-0 rounded bg-destructive px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-700"
                                  >
                                    Past Due
                                  </Badge>
                                )}
                              </Card>
                            );
                          })}
                        </div>
                      )}
                    </Card.Content>
                  </Card>
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
