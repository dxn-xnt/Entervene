import { useState } from "react";
import Tabs from "../components/Tabs";

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
    </div>
  );
};

export default ToDo;