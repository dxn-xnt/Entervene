import { useState } from "react";
import Tabs from "../../components/StudentUIComponents/Tabs";
import ToDoItem from "../../components/StudentUIComponents/ListCardItems/ToDoItem";

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

const ToDo = () => {
  const [activeTab, setActiveTab] = useState("pending");

  return (
    <div>
      <header className="px-5 py-5">
        <h1 className="text-4xl font-semibold">To Do</h1>
      </header>
      <Tabs tabs={todoTabs} activeTab={activeTab} onChange={setActiveTab} />
      <div className="px-5 py-5 flex flex-col gap-5">

        {/* Pending Tab: Intervention + Past Due + Upcoming */}
        {activeTab === "pending" && (
          <>
            <section className="flex flex-col gap-4">
              <h3 className="text-3xl font-semibold">Intervention</h3>
              {interventionItems.map((item, index) => (
                <ToDoItem key={index} {...item} />
              ))}
            </section>

            <section className="flex flex-col gap-4">
              <h3 className="text-3xl font-semibold">Past Due</h3>
              {pastDueItems.map((item, index) => (
                <ToDoItem key={index} {...item} />
              ))}
            </section>

            <section className="flex flex-col gap-4">
              <h3 className="text-3xl font-semibold">Upcoming</h3>
              {upcomingItems.map((item, index) => (
                <ToDoItem key={index} {...item} />
              ))}
            </section>
          </>
        )}

        {/* Past Due Tab */}
        {activeTab === "pastdue" && (
          <section className="flex flex-col gap-4">
            <h3 className="text-3xl font-semibold">Past Due</h3>
            {pastDueItems.map((item, index) => (
              <ToDoItem key={index} {...item} />
            ))}
          </section>
        )}

        {/* Completed Tab */}
        {activeTab === "completed" && (
          <section className="flex flex-col gap-4">
            <h3 className="text-3xl font-semibold">Completed</h3>
            {completedItems.map((item, index) => (
              <ToDoItem key={index} {...item} />
            ))}
          </section>
        )}

      </div>
    </div>
  );
};

export default ToDo;