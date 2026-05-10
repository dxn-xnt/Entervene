import { useState } from "react";
import Tabs from "../../components/Tabs";
import NotificationCard from "../../components/StudentUIComponents/NotificationCard";
import AppLayout from "@/layouts/app-layout";

const tabs = [
  { id: "all", label: "All" },
  { id: "classworks", label: "Classworks" },
  { id: "announcements", label: "Announcements" },
];

const classworkCards = [
  {
    title: "Written Work #5 - Math 8",
    description:
      "Your teacher assigned a new written work on 'Systems of Linear Equations.' Submit your answer sheet befo....",
    cardInfo: "Nov 25, 2025 - 8:00 AM  Math 8 - Ms. Reyes",
    badge: "Due in 3 hrs",
  },
  {
    title: "Performance Task - Science 8",
    description:
      "Complete the lab report on 'Force and Motion.' Attach your data tables and observations before the deadline....",
    cardInfo: "Nov 26, 2025 - 11:59 PM  Science 8 - Mr. Santos",
    badge: "Due Tomorrow",
  },
  {
    title: "Written Work #3 - English 8",
    description:
      "Online quiz covering Chapters 4-6 of the reading material. Make sure to review your notes beforehand....",
    cardInfo: "Nov 27, 2025 - 9:00 AM  English 8 - Ms. Cruz",
    badge: "Due in 2 days",
  },
];

const announcementCards = [
  {
    title: "No Classes - Nov 30",
    description:
      "Classes are suspended on November 30 in observance of Bonifacio Day. Stay safe and enjoy the holiday....",
    cardInfo: "Nov 25, 2025 - 7:00 AM  Admin Office",
    badge: "Holiday",
  },
  {
    title: "Card Distribution",
    description:
      "Report cards will be distributed on December 5. Parents are required to accompany their students during pick-up....",
    cardInfo: "Nov 24, 2025 - 3:00 PM  Grade 8 Office",
    badge: "Reminder",
  },
];

const Notifications = () => {
  const [activeTab, setActiveTab] = useState("all");

  return (
    <AppLayout>
      <header className="px-5 py-5 flex flex-row justify-between">
        <h1 className="text-4xl font-semibold">Notifications</h1>
        <button className="bg-[#7ABA78] text-black rounded px-5 py-2 border">
          Mark all as read
        </button>
      </header>
      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      <main className="px-5 py-5 flex flex-col gap-5">
        {/* Classwork Section */}
        {(activeTab === "all" || activeTab === "classworks") && (
          <section className="flex flex-col gap-3">
            <h2 className="text-3xl font-semibold">Classwork</h2>
            {classworkCards.map((card, index) => (
              <NotificationCard key={index} {...card} />
            ))}
          </section>
        )}

        {/* Announcement Section */}
        {(activeTab === "all" || activeTab === "announcements") && (
          <section className="flex flex-col gap-3">
            <h2 className="text-3xl font-semibold">Announcement</h2>
            {announcementCards.map((card, index) => (
              <NotificationCard key={index} {...card} />
            ))}
          </section>
        )}
      </main>
    </AppLayout>
  );
};

export default Notifications;
