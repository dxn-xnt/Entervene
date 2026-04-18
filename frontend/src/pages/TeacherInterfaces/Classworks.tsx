import Cards from "@/components/classwork-cards";
import Tabs from "../../components/Tabs";
import { useState } from "react";

// #region agent log
fetch('http://127.0.0.1:7485/ingest/3a9a3448-1bd9-405f-8357-a95cb0abb46c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ccf95c'},body:JSON.stringify({sessionId:'ccf95c',runId:'pre-fix',hypothesisId:'H1',location:'Classworks.tsx:5',message:'Classworks module evaluated',data:{cardsImportPath:'@/components/classwork-cards'},timestamp:Date.now()})}).catch(()=>{});
// #endregion

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
  // #region agent log
  fetch('http://127.0.0.1:7485/ingest/3a9a3448-1bd9-405f-8357-a95cb0abb46c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ccf95c'},body:JSON.stringify({sessionId:'ccf95c',runId:'pre-fix',hypothesisId:'H4',location:'Classworks.tsx:55',message:'Classworks render',data:{activeTab,totalItems:classworkItems.length},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

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