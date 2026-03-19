import { useState } from "react";
import Tabs from "../../components/StudentUIComponents/Tabs";
import ToDoItem from "../../components/StudentUIComponents/ListCardItems/ToDoItem";

const todoTabs = [
  { id: "pending", label: "Pending" },
  { id: "pastdue", label: "Past Due" },
  { id: "completed", label: "Completed" },
];

const ToDo = () => {
  const [activeTab, setActiveTab] = useState("pending");

  return (
    <div>
      <header className="px-5 py-5">
        <h1 className="text-4xl font-semibold">To Do</h1>
      </header>
      <Tabs tabs={todoTabs} activeTab={activeTab} onChange={setActiveTab} />
      <div className="px-5 py-5 flex flex-col gap-3">
        {/* Intervention */}
        <div className="flex flex-col gap-4 mb-5">
          <h3 className="text-3xl font-semibold">Intervention</h3>
          <ToDoItem
            title="Science Quiz"
            subject="Computer Programming"
            deadline="October 30, 2025"
          />
        </div>
        {/* Past Due */}
        <div className="flex flex-col gap-4 mb-5">
          <h3 className="text-3xl font-semibold">Past Due</h3>
          <ToDoItem
            title="Assignment 4"
            subject="Computer Programming"
            deadline="October 30, 2025"
          />
          <ToDoItem
            title="Assignment 3"
            subject="Computer Programming"
            deadline="October 30, 2025"
          />
          <ToDoItem
            title="Assignment 2"
            subject="Computer Programming"
            deadline="October 30, 2025"
          />
        </div>
        {/* Upcoming */}
        <div className="flex flex-col gap-4 mb-5">
          <h3 className="text-3xl font-semibold">Upcoming</h3>
          <ToDoItem
            title="Assignment 6"
            subject="Computer Programming"
            deadline="October 30, 2025"
          />
        </div>
      </div>
    </div>
  );
};

export default ToDo;
