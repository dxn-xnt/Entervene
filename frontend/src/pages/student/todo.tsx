import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Tabs from "../../components/Tabs";
import ToDoItem from "../../components/StudentUIComponents/ListCardItems/ToDoItem";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";

const todoTabs = [
  { id: "pending", label: "Pending" },
  { id: "pastdue", label: "Past Due" },
  { id: "completed", label: "Completed" },
];

const interventionItems = [
  {
    title: "Science Quiz",
    subject: "Computer Programming",
    deadline: "October 30, 2025",
  },
  {
    title: "Math Remediation",
    subject: "Mathematics 8",
    deadline: "November 2, 2025",
  },
];

const pastDueItems = [
  {
    title: "Assignment 4",
    subject: "Computer Programming",
    deadline: "October 30, 2025",
  },
  {
    title: "Assignment 3",
    subject: "Computer Programming",
    deadline: "October 28, 2025",
  },
  {
    title: "Assignment 2",
    subject: "Computer Programming",
    deadline: "October 25, 2025",
  },
];

const upcomingItems = [
  {
    title: "Assignment 6",
    subject: "Computer Programming",
    deadline: "November 5, 2025",
  },
  {
    title: "Performance Task",
    subject: "Science 8",
    deadline: "November 7, 2025",
  },
];

const completedItems = [
  {
    title: "Assignment 1",
    subject: "Computer Programming",
    deadline: "October 20, 2025",
  },
  {
    title: "Written Work #1",
    subject: "English 8",
    deadline: "October 18, 2025",
  },
];

export default function ToDo() {
  const [activeTab, setActiveTab] = useState("pending");
  const navigate = useNavigate();

  const openTodo = (item: { title: string; subject: string }) => {
    navigate(
      `/student/todo/${encodeURIComponent(item.subject)}/${encodeURIComponent(
        item.title,
      )}`,
    );
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6">
            <header className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" />
              <h1 className="text-2xl md:text-4xl font-bold tracking-tight">
                To do
              </h1>
            </header>

            <div className="-mx-4 md:-mx-6">
              <Tabs
                tabs={todoTabs}
                activeTab={activeTab}
                onChange={setActiveTab}
              />
            </div>

            {activeTab === "pending" && (
              <>
                <section className="flex flex-col gap-4">
                  <h3 className="text-xl md:text-3xl font-semibold">
                    Intervention
                  </h3>
                  {interventionItems.map((item, index) => (
                    <ToDoItem
                      key={index}
                      {...item}
                      onClick={() => openTodo(item)}
                    />
                  ))}
                </section>

                <section className="flex flex-col gap-4">
                  <h3 className="text-xl md:text-3xl font-semibold">
                    Past Due
                  </h3>
                  {pastDueItems.map((item, index) => (
                    <ToDoItem
                      key={index}
                      {...item}
                      onClick={() => openTodo(item)}
                    />
                  ))}
                </section>

                <section className="flex flex-col gap-4">
                  <h3 className="text-xl md:text-3xl font-semibold">
                    Upcoming
                  </h3>
                  {upcomingItems.map((item, index) => (
                    <ToDoItem
                      key={index}
                      {...item}
                      onClick={() => openTodo(item)}
                    />
                  ))}
                </section>
              </>
            )}

            {activeTab === "pastdue" && (
              <section className="flex flex-col gap-4">
                <h3 className="text-xl md:text-3xl font-semibold">Past Due</h3>
                {pastDueItems.map((item, index) => (
                  <ToDoItem
                    key={index}
                    {...item}
                    onClick={() => openTodo(item)}
                  />
                ))}
              </section>
            )}

            {activeTab === "completed" && (
              <section className="flex flex-col gap-4">
                <h3 className="text-xl md:text-3xl font-semibold">Completed</h3>
                {completedItems.map((item, index) => (
                  <ToDoItem
                    key={index}
                    {...item}
                    onClick={() => openTodo(item)}
                  />
                ))}
              </section>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
