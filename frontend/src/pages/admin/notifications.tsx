import { useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { Tabs, type TabItem } from "@/components/retroui/Tabs";
import { NotificationCard } from "@/components/notification-card";

type NotificationTabId = "all" | "interventions" | "submissions";

const tabs: Array<TabItem<NotificationTabId>> = [
  { id: "all", label: "All" },
  { id: "interventions", label: "Interventions" },
  { id: "submissions", label: "Submissions" },
];

type Notification = {
  id: string;
  title: string;
  description: string;
  user: string;
  date: string;
  badge?: string;
  isRead: boolean;
};

const notifications: Array<Notification> = [
  { id: "1", title: "Notification 1", description: "Description 1", user: "User 1", badge: "Pending Approval", date: "2022-01-01", isRead: false },
  { id: "2", title: "Notification 2", description: "Description 2", user: "User 2", date: "2022-01-02", isRead: true },
  { id: "3", title: "Notification 3", description: "Description 3", user: "User 3", date: "2022-01-03", isRead: false },
];

export default function AdminNotifications() {
  const [activeTab, setActiveTab] = useState<NotificationTabId>("all");

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            <header className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" />
              <h1 className="text-4xl font-bold tracking-tight">
                Notifications
              </h1>
            </header>
            <div className="flex flex-col gap-4 md:gap-6">
              <Tabs
                tabs={tabs}
                activeTab={activeTab}
                onTabChange={setActiveTab}
              />
              <div className="flex flex-col gap-3">
                {notifications.map((notification) => (
                  <NotificationCard
                    key={notification.id}
                    title={notification.title}
                    description={notification.description}
                    badge={notification.badge}
                    date={notification.date}
                    isRead={notification.isRead} user={""} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
