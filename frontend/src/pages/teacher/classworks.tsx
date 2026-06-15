import Cards from "@/components/classwork-cards";
import Tabs from "../../components/Tabs";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useState } from "react";
import AppLayout from "@/layouts/app-layout";

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
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6">
            <header className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <h1 className="text-2xl md:text-4xl font-semibold">
                  Classworks
                </h1>
              </div>
              <button className="bg-[#7ABA78] text-black rounded px-4 py-2 border text-sm font-medium">
                <span className="hidden sm:inline">+ New Classwork</span>
                <span className="sm:hidden">+</span>
              </button>
            </header>

            <div className="-mx-4 md:-mx-6 overflow-x-auto">
              <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
            </div>

            <div className="flex flex-col gap-5">
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
                <p className="text-gray-500 text-center mt-10">
                  No items found.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Classworks;
