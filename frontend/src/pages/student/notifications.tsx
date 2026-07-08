import { useState } from "react";
import Tabs from "../../components/tabs";
import { NotificationCard } from "../../components/notification-card";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";

const tabs = [
  { id: "all", label: "All" },
  { id: "classworks", label: "Classworks" },
  { id: "announcements", label: "Announcements" },
];

const classworkCards = [
  {
    title: "Mathematics Assignment",
    description: "Submit your Chapter 5 worksheet before Friday.",
    date: "July 7, 2026",
    user: "Mr. Smith",
    badge: "Pending Approval",
    isRead: false,
  },
  {
    title: "Science Quiz",
    description: "Quiz on the Solar System tomorrow.",
    date: "July 6, 2026",
    user: "Mrs. Cruz",
    badge: "Passed",
    isRead: true,
  },
];

const announcementCards = [
  {
    title: "School Holiday",
    description: "There will be no classes on Friday.",
    date: "July 5, 2026",
    user: "Admin",
    isRead: true,
  },
];

const Notifications = () => {
  const [activeTab, setActiveTab] = useState("all");

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6">
            <header className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <h1 className="text-2xl md:text-4xl font-bold tracking-tight">
                  Notifications
                </h1>
              </div>
              <button className="flex items-center gap-1.5 rounded-lg border-2 border-black bg-[#7ABA78] px-4 py-2 text-sm font-semibold shadow-md hover:shadow-none transition-all cursor-pointer">
                <span className="hidden sm:inline">Mark all as read</span>
                <span className="sm:hidden">Read All</span>
              </button>
            </header>

            <div className="-mx-4 md:-mx-6">
              <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
            </div>

            <div className="flex flex-col gap-5">
              {(activeTab === "all" || activeTab === "classworks") && (
                <section className="flex flex-col gap-3">
                  <h2 className="text-xl md:text-3xl font-semibold">
                    Classwork
                  </h2>
                  {classworkCards.map((card, index) => (
                    <NotificationCard key={index} {...card} />
                  ))}
                </section>
              )}

              {(activeTab === "all" || activeTab === "announcements") && (
                <section className="flex flex-col gap-3">
                  <h2 className="text-xl md:text-3xl font-semibold">
                    Announcement
                  </h2>
                  {announcementCards.map((card, index) => (
                    <NotificationCard key={index} {...card} />
                  ))}
                </section>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Notifications;
