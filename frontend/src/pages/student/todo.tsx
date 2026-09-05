import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs } from "../../components/retroui/Tabs";
import ToDoItem from "../../components/to-do-item";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  apiFetch,
  getStudentTodos,
  type StudentTodosResponse,
  type TodoItem as ApiTodoItem,
} from "@/lib/api";
import { CheckCircle2 } from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { EmptyStateCard } from "@/components/empty-state-card";

const todoTabs = [
  { id: "pending", label: "Pending" },
  { id: "pastdue", label: "Past Due" },
  { id: "completed", label: "Completed" },
];

export default function ToDo() {
  const [activeTab, setActiveTab] = useState("pending");
  const [todos, setTodos] = useState<StudentTodosResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const fetchTodos = () => {
    setIsLoading(true);
    setError("");
    getStudentTodos()
      .then((data) => setTodos(data))
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Unable to load to-do items.",
        ),
      )
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    fetchTodos();
  }, []);

  const openTodo = async (item: ApiTodoItem) => {
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
      } catch {}
    }

    if (targetClassId && item.subject_id) {
      navigate(
        `/student/subjects/${targetClassId}/${item.subject_id}?tab=classwork&classworkAssignmentId=${item.assignment_id}`,
      );
    } else {
      navigate("/student/subjects");
    }
  };

  const pendingItems = todos?.pending || [];
  const pastDueItems = todos?.pastdue || [];
  const completedItems = todos?.completed || [];

  const interventionItems = pendingItems.filter(
    (item) => item.category === "INTERVENTION" || item.type === "INTERVENTION",
  );
  const regularUpcomingItems = pendingItems.filter(
    (item) => item.category !== "INTERVENTION" && item.type !== "INTERVENTION",
  );

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center gap-3 bg-background py-4 px-4 md:px-6">
              <SidebarTrigger className="md:hidden" />
              <h1 className="text-2xl md:text-4xl font-bold tracking-tight">
                To do
              </h1>
            </header>
            <div className="px-4 md:px-6 bg-background -mt-[1px]">
              <Tabs
                tabs={todoTabs}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                counts={{
                  pending: pendingItems.length,
                  pastdue: pastDueItems.length,
                  completed: completedItems.length,
                }}
              />
            </div>

            <div className="border-t-1 border-border -mt-[1px] py-4 px-4 md:px-6 flex flex-col gap-3">

              {isLoading ? (
                <LoadingPanel label="Loading your to-do items..." />
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-12 text-red-500 gap-2">
                  <p className="text-sm font-semibold">{error}</p>
                  <button
                    type="button"
                    onClick={fetchTodos}
                    className="px-4 py-1.5 border-2 border-black bg-white text-sm font-semibold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  {activeTab === "pending" && (
                    <>
                      {interventionItems.length > 0 && (
                        <section className="flex flex-col gap-4">
                          <h3 className="text-xl md:text-3xl font-semibold">
                            Intervention
                          </h3>
                          {interventionItems.map((item) => (
                            <ToDoItem
                              key={item.assignment_id}
                              title={item.title}
                              subject={item.subject}
                              deadline={item.deadline}
                              onClick={() => openTodo(item)}
                            />
                          ))}
                        </section>
                      )}

                      <section className="flex flex-col gap-4">
                        <h3 className="text-xl md:text-3xl font-semibold">
                          Pending Tasks
                        </h3>
                        {regularUpcomingItems.length === 0 &&
                        interventionItems.length === 0 ? (
                          <EmptyStateCard
                            title="All caught up!"
                            description="You have no pending assignments or tasks."
                          />
                        ) : regularUpcomingItems.length === 0 ? (
                          <p className="text-sm text-gray-500">No upcoming tasks.</p>
                        ) : (
                          regularUpcomingItems.map((item) => (
                            <ToDoItem
                              key={item.assignment_id}
                              title={item.title}
                              subject={item.subject}
                              deadline={item.deadline}
                              onClick={() => openTodo(item)}
                            />
                          ))
                        )}
                      </section>
                    </>
                  )}

                  {activeTab === "pastdue" && (
                    <section className="flex flex-col gap-4">
                      <h3 className="text-xl md:text-3xl font-semibold">Past Due</h3>
                      {pastDueItems.length === 0 ? (
                        <EmptyStateCard
                          title="No past due items!"
                          description="Great job keeping up with your deadlines."
                        />
                      ) : (
                        pastDueItems.map((item) => (
                          <ToDoItem
                            key={item.assignment_id}
                            title={item.title}
                            subject={item.subject}
                            deadline={item.deadline}
                            onClick={() => openTodo(item)}
                          />
                        ))
                      )}
                    </section>
                  )}

                  {activeTab === "completed" && (
                    <section className="flex flex-col gap-4">
                      <h3 className="text-xl md:text-3xl font-semibold">Completed</h3>
                      {completedItems.length === 0 ? (
                        <EmptyStateCard
                          title="No completed tasks yet."
                          description="Your submitted assignments and quizzes will appear here."
                        />
                      ) : (
                        completedItems.map((item) => (
                          <ToDoItem
                            key={item.assignment_id}
                            title={item.title}
                            subject={item.subject}
                            deadline={item.deadline}
                            onClick={() => openTodo(item)}
                          />
                        ))
                      )}
                    </section>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
