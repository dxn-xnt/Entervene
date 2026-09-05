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
            <header className="flex items-center justify-between gap-3 bg-background py-4 px-4 md:px-6">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <h1 className="text-2xl md:text-4xl font-bold tracking-tight">
                  Study Board
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="md"
                  onClick={() => navigate(routes.student.profile)}
                  className="gap-2 whitespace-nowrap"
                >
                  <Calendar className="size-4" />
                  View My Schedule
                </Button>
              </div>
            </header>

            <div className="border-t-2 border-border -mt-[1px] py-4 px-4 md:px-6 flex flex-1 flex-col gap-3">
              <div className="flex flex-col lg:flex-row lg:items-start gap-4 flex-1">
                {/* Left side: Subject cards */}
                <div className="grid grid-cols-2 gap-4 flex-1 content-start">
                  {isLoading ? (
                    <LoadingPanel label="Loading subjects..." className="col-span-2" />
                  ) : subjects.length === 0 ? (
                    <EmptyStateCard title="No enrolled subjects found." className="col-span-2" />
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
                <div className="flex flex-col gap-4 w-full lg:w-[30%] shrink-0">
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
                      <div className="flex flex-row mt-2 items-center w-full ">
                        <div className="flex flex-row gap-2 justify-between w-full">
                          <Badge
                            size="md"
                            variant="secondary"
                            className="items-center justify-center"
                          >
                            <Check size={17} className="mt-0.5" />
                          </Badge>
                          <Badge size="md" variant="default">
                            Tu
                          </Badge>
                          <Badge size="md" variant="default">
                            We
                          </Badge>
                          <Badge size="md" variant="secondary">
                            Th
                          </Badge>
                          <Badge size="md" variant="outline">
                            Fr
                          </Badge>
                          <Badge size="md" variant="outline">
                            Sa
                          </Badge>
                          <Badge size="md" variant="outline">
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
