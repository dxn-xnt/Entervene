import { useEffect, useState, useCallback } from "react";
import { Tabs } from "../../components/retroui/Tabs";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { NotificationCard } from "../../components/notification-card";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Loader2 } from "lucide-react";
import {
  getNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  type NotificationItem,
} from "@/lib/notifications-api";

const tabs = [
  { id: "all", label: "All" },
  { id: "classworks", label: "Classworks" },
  { id: "announcements", label: "Announcements" },
];

const Notifications = () => {
  const [activeTab, setActiveTab] = useState("all");
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
          n.notification_id === item.notification_id
            ? { ...n, is_read: true }
            : n,
        ),
      );
    } catch (err) {
      console.error("Failed to mark notification as read:", err);
    }
  };

  const classworkItems = notifications.filter(
    (n) =>
      n.notification_type === "assignment_due" ||
      n.notification_type === "submission_graded" ||
      n.notification_type === "grade_released",
  );

  const announcementItems = notifications.filter(
    (n) =>
      n.notification_type === "announcement" ||
      n.notification_type === "risk_alert",
  );

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            <header className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <h1 className="text-2xl md:text-4xl font-bold tracking-tight">
                  Notifications
                </h1>
              </div>
              <Button
                variant="default"
                size="md"
                onClick={handleMarkAll}
                disabled={markingAll || notifications.every((n) => n.is_read)}
              >
                {markingAll ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1 inline" />
                ) : null}
                <span className="hidden sm:inline">Mark All as Read</span>
                <span className="sm:hidden">Read All</span>
              </Button>
            </header>

            <main className="flex flex-col gap-3">
              <Tabs
                tabs={tabs}
                activeTab={activeTab}
                onTabChange={setActiveTab}
              />

              {loading ? (
                <div className="flex flex-col items-center justify-center p-12 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin mb-2" />
                  <p>Loading notifications...</p>
                </div>
              ) : notifications.length === 0 ? (
                <Card className="flex justify-center items-center py-12">
                  <p className="text-sm">No completed tasks yet.</p>
                </Card>
              ) : (
                <div className="flex flex-col gap-5 w-full">
                  {(activeTab === "all" || activeTab === "classworks") &&
                    classworkItems.length > 0 && (
                      <section className="flex flex-col gap-3 w-full">
                        <h2 className="text-xl md:text-3xl font-semibold">
                          Classwork
                        </h2>
                        {classworkItems.map((card) => (
                          <div
                            key={card.notification_id}
                            onClick={() => handleCardClick(card)}
                            className="cursor-pointer w-full"
                          >
                            <NotificationCard
                              title={card.title}
                              description={card.body ?? ""}
                              date={
                                card.created_at
                                  ? new Date(
                                      card.created_at,
                                    ).toLocaleDateString()
                                  : ""
                              }
                              user={
                                card.notification_type === "assignment_due"
                                  ? "Classwork"
                                  : card.notification_type
                                      .replace(/_/g, " ")
                                      .toUpperCase()
                              }
                              badge={card.is_read ? undefined : "Unread"}
                              isRead={card.is_read}
                            />
                          </div>
                        ))}
                      </section>
                    )}

                  {(activeTab === "all" || activeTab === "announcements") &&
                    announcementItems.length > 0 && (
                      <section className="flex flex-col gap-3 w-full">
                        <h2 className="text-xl md:text-3xl font-semibold">
                          Announcement
                        </h2>
                        {announcementItems.map((card) => (
                          <div
                            key={card.notification_id}
                            onClick={() => handleCardClick(card)}
                            className="cursor-pointer w-full"
                          >
                            <NotificationCard
                              title={card.title}
                              description={card.body ?? ""}
                              date={
                                card.created_at
                                  ? new Date(
                                      card.created_at,
                                    ).toLocaleDateString()
                                  : ""
                              }
                              user={
                                card.notification_type === "assignment_due"
                                  ? "Classwork"
                                  : card.notification_type
                                      .replace(/_/g, " ")
                                      .toUpperCase()
                              }
                              badge={card.is_read ? undefined : "Unread"}
                              isRead={card.is_read}
                            />
                          </div>
                        ))}
                      </section>
                    )}
                </div>
              )}
            </main>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Notifications;
