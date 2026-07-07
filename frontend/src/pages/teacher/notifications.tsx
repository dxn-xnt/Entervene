import { useState } from "react";
import Tabs from "../../components/tabs";
// import NotificationCard from "../../components/NotificationCard";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";

const tabs = [
  { id: "all", label: "All" },
  { id: "announcements", label: "Announcements" },
  { id: "submissions", label: "Submissions" },
  { id: "interventions", label: "Interventions" },
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

const submissionCard = [
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

const Notifications = () => {
  const [activeTab, setActiveTab] = useState("all");

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6">
            <header className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <h1 className="text-2xl md:text-4xl font-semibold">
                  Notifications
                </h1>
              </div>
              <button className="flex items-center gap-1.5 rounded-lg border border-black bg-[#7ABA78] px-4 py-2 text-sm font-semibold text-black shadow-[3px_3px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000]">
                <span className="hidden sm:inline">Mark All as Read</span>
                <span className="sm:hidden">Read All</span>
              </button>
            </header>

            <div className="-mx-4 md:-mx-6">
              <div className="overflow-x-auto">
                <Tabs
                  tabs={tabs}
                  activeTab={activeTab}
                  onChange={setActiveTab}
                />
              </div>
            </div>

            {/* <div className="flex flex-col gap-5">
              {(activeTab === "all" || activeTab === "classworks") && (
                <section className="flex flex-col gap-3">
                  <h2 className="text-xl md:text-3xl font-semibold">
                    Classwork
                  </h2>
                  {submissionCard.map((card, index) => (
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
            </div> */}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Notifications;
