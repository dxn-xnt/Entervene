import { useEffect, useState } from "react";
import AppLayout from "@/layouts/app-layout";
import { SubjectCard } from "../../components/subject-card";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import {
  ArrowUpRight,
  FileText,
  Calendar,
  Check,
  Zap,
} from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { EmptyStateCard } from "@/components/empty-state-card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useNavigate } from "react-router-dom";
import { routes } from "@/../routes";
import {
  apiFetch,
  getStudentTodos,
  type TodoItem,
} from "@/lib/api";
import { Badge } from "@/components/retroui/Badge";

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
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [isTodosLoading, setIsTodosLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/v1/students/me/subjects")
      .then((r) => r.json())
      .then((data) => setSubjects(data))
      .catch(() => { })
      .finally(() => setIsLoading(false));

    getStudentTodos()
      .then((data) => {
        const urgent = [...data.pastdue, ...data.pending].slice(0, 3);
        setTodos(urgent);
      })
      .catch(() => { })
      .finally(() => setIsTodosLoading(false));
  }, []);

  const openTodo = async (item: TodoItem) => {
    let targetClassId = item.class_id;

    if (!targetClassId && item.subject_id) {
      try {
        const res = await apiFetch("/api/v1/students/me/subjects");
        if (res.ok) {
          const subjects = await res.json();
          const match = subjects.find(
            (s: { subject_id: number; class_id: number }) =>
              s.subject_id === item.subject_id,
          );
          if (match) targetClassId = match.class_id;
        }
      } catch (error) {
        console.error("Unable to resolve the class for this to-do item:", error);
      }
    }

    if (targetClassId && item.subject_id) {
      navigate(
        `/student/subjects/${targetClassId}/${item.subject_id}?tab=classwork&classworkAssignmentId=${item.assignment_id}`,
      );
    } else {
      navigate(routes.student.todo);
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
                  size="sm"
                  onClick={() => navigate(routes.student.profile)}
                  className="gap-1.5 whitespace-nowrap px-2 sm:px-3"
                  aria-label="View my schedule"
                >
                  <Calendar className="size-4" />
                  <span className="sm:hidden">Schedule</span>
                  <span className="hidden sm:inline">View My Schedule</span>
                </Button>
              </div>
            </header>

            <div className="-mt-[1px] flex flex-1 flex-col gap-3 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
              <div className="flex flex-col lg:flex-row lg:items-start gap-4 flex-1">
                {/* Left side: Subject cards */}
                <div className="grid min-w-0 flex-1 grid-cols-1 content-start gap-3 sm:grid-cols-2 sm:gap-4">
                  {isLoading ? (
                    <LoadingPanel label="Loading subjects..." className="sm:col-span-2" />
                  ) : subjects.length === 0 ? (
                    <EmptyStateCard
                      title="No enrolled subjects found."
                      className="px-4 py-10 sm:col-span-2 sm:px-6 sm:py-12"
                    />
                  ) : (
                    subjects.map((subject) => (
                      <SubjectCard
                        key={subject.subject_load_id}
                        title={subject.subject_name}
                        onClick={() => handleSubjectClick(subject)}
                        teacher={subject.teacher_name}
                        badges={[
                          {
                            label: subject.section_name || "Section",
                            count: 0,
                          },
                        ]}
                      />
                    ))
                  )}
                </div>

                {/* Right side: Top Card + To do Card */}
                <div className="flex w-full min-w-0 shrink-0 flex-col gap-4 lg:w-[30%]">
                  <Card className="block w-full border-black bg-white shadow-md hover:shadow-none">
                    <Card.Content className="">
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-row gap-2 items-center">
                          <Zap size={20} fill="#ffdb33" />
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
                          <Badge size="md" variant="default" className="min-w-0 px-1 text-center sm:px-2.5">
                            Tu
                          </Badge>
                          <Badge size="md" variant="default" className="min-w-0 px-1 text-center sm:px-2.5">
                            We
                          </Badge>
                          <Badge size="md" variant="secondary" className="min-w-0 px-1 text-center sm:px-2.5">
                            Th
                          </Badge>
                          <Badge size="md" variant="outline" className="min-w-0 px-1 text-center sm:px-2.5">
                            Fr
                          </Badge>
                          <Badge size="md" variant="outline" className="min-w-0 px-1 text-center sm:px-2.5">
                            Sa
                          </Badge>
                          <Badge size="md" variant="outline" className="min-w-0 px-1 text-center sm:px-2.5">
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
                          className="rounded-none border-black bg-white"
                          aria-label="View all to-do items"
                        >
                          <ArrowUpRight size={18} />
                        </Button>
                      </div>

                      {isTodosLoading ? (
                        <LoadingPanel label="Loading to-do items..." />
                      ) : todos.length === 0 ? (
                        <EmptyStateCard
                          title="All caught up!"
                          description="No pending tasks"
                          className="border-none bg-white shadow-none hover:shadow-none"
                        />
                      ) : (
                        <div className="flex flex-col gap-2.5">
                          {todos.map((item) => (
                            <Card
                              key={item.assignment_id}
                              onClick={() => openTodo(item)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  openTodo(item);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              className="flex w-full cursor-pointer items-center gap-3 border-black bg-white p-3 shadow-md hover:shadow-none"
                            >
                              <FileText
                                size={20}
                                className="shrink-0 text-black/70"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-semibold text-sm">
                                  {item.title}
                                </p>
                                <p className="truncate text-xs text-gray-600">
                                  {item.subject} · {item.deadline}
                                </p>
                              </div>
                              {item.status === "pastdue" && (
                                <Badge
                                  variant="secondary"
                                  size="sm"
                                  className="shrink-0 rounded-none border border-red-400 bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-700"
                                >
                                  Past Due
                                </Badge>
                              )}
                            </Card>
                          ))}
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
