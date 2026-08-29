import { useEffect, useState, useCallback } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { Tabs, type TabItem } from "@/components/retroui/Tabs";
import { NotificationCard } from "@/components/notification-card";
import { Button } from "@/components/retroui/Button";
import { Loader2 } from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { EmptyStateCard } from "@/components/empty-state-card";
import {
  getNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  type NotificationItem,
} from "@/lib/notifications-api";

type NotificationTabId = "all" | "interventions" | "submissions";

const tabs: Array<TabItem<NotificationTabId>> = [
  { id: "all", label: "All" },
  { id: "interventions", label: "Interventions" },
  { id: "submissions", label: "Submissions" },
];

export default function AdminNotifications() {
  const [activeTab, setActiveTab] = useState<NotificationTabId>("all");
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getNotifications(false, 50);
      setNotifications(data.notifications);
    } catch (err) {
      console.error("Failed to load notifications:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkAll = async () => {
    try {
      setMarkingAll(true);
      await markAllNotificationsAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    } finally {
      setMarkingAll(false);
    }
  };

  const handleCardClick = async (item: NotificationItem) => {
    if (item.is_read) return;
    try {
      await markNotificationAsRead(item.notification_id);
      setNotifications((prev) =>
        prev.map((n) =>
          n.notification_id === item.notification_id ? { ...n, is_read: true } : n
        )
      );
    } catch (err) {
      console.error("Failed to mark notification as read:", err);
    }
  };

  const filteredNotifications = notifications.filter((n) => {
    if (activeTab === "all") return true;
    if (activeTab === "submissions") return n.notification_type === "submission_graded" || n.notification_type === "assignment_due";
    if (activeTab === "interventions") return n.notification_type === "risk_alert";
    return true;
  });

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            <header className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <h1 className="text-4xl font-bold tracking-tight">
                  Notifications
                </h1>
              </div>
              <Button variant="default" size="md" onClick={handleMarkAll} disabled={markingAll || notifications.every((n) => n.is_read)}>
                {markingAll ? <Loader2 className="h-4 w-4 animate-spin mr-1 inline" /> : null}
                <span className="hidden sm:inline">Mark All as Read</span>
                <span className="sm:hidden">Read All</span>
              </Button>
            </header>
            <div className="flex flex-col gap-4 md:gap-6">
              <Tabs
                tabs={tabs}
                activeTab={activeTab}
                onTabChange={setActiveTab}
              />
              {loading ? (
                <LoadingPanel label="Loading notifications..." />
              ) : filteredNotifications.length === 0 ? (
                <EmptyStateCard
                  title="No notifications"
                  description="You are all caught up!"
                />
              ) : (
                <div className="flex flex-col gap-3 w-full">
                  {filteredNotifications.map((notification) => (
                    <div key={notification.notification_id} onClick={() => handleCardClick(notification)} className="cursor-pointer w-full">
                      <NotificationCard
                        title={notification.title}
                        description={notification.body ?? ""}
                        badge={notification.is_read ? undefined : "Unread"}
                        date={notification.created_at ? new Date(notification.created_at).toLocaleDateString() : ""}
                        isRead={notification.is_read}
                        user={notification.notification_type.replace(/_/g, " ")}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

