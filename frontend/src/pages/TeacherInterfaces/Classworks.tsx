import Tabs from "../../components/Tabs";
import { useState } from "react";
import Cards from "../../components/ClassworkCards";

const tabs = [
  { id: "all", label: "All" },
  { id: "readings", label: "Readings" },
  { id: "activities", label: "Activities" },
  { id: "assignments", label: "Assignments" },
  { id: "quizzes", label: "Quizzes" },
];

const classworkItems = [
  {
    title: "Reading: Intro to Variables",
    subject: "Computer Programming",
    date: "November 1, 2026",
    badge: "File 1",
    type: "readings",
  },
  {
    title: "Activity 1",
    subject: "Computer Programming",
    date: "November 3, 2026",
    badge: "File 1",
    type: "activities",
  },
  {
    title: "Create a number guessing game",
    date: "November 3, 2026",
    badge: "File 1",
    type: "activities",
  },
  {
    title: "Assignment 1",
    subject: "Computer Programming",
    date: "November 5, 2026",
    badge: "File 2",
    type: "assignments",
  },
  {
    title: "Quiz 1: Basic Syntax",
    subject: "Computer Programming",
    date: "November 7, 2026",
    badge: "File 1",
    type: "quizzes",
  },
];

const Classworks = () => {
  const [activeTab, setActiveTab] = useState("all");

  const filteredItems =
    activeTab === "all"
      ? classworkItems
      : classworkItems.filter((item) => item.type === activeTab);

  return (
    <div>
      <header className="px-5 py-5 flex flex-row justify-between gap-2 items-center">
        <h1 className="text-4xl font-semibold">Classworks</h1>
        <button className="bg-[#7ABA78] text-black rounded px-5 py-2 border">
          + New Classwork
        </button>
      </header>
      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      <main className="px-5 py-5 flex flex-col gap-5">
        {filteredItems.length > 0 ? (
          filteredItems.map((item, index) => (
            <Cards
              key={index}
              title={item.title}
              subject={item.subject}
              date={item.date}
              badge={item.badge}
            />
          ))
        ) : (
          <p className="text-gray-500 text-center mt-10">No items found.</p>
        )}
      </main>
    </div>
  );
};

export default Classworks;