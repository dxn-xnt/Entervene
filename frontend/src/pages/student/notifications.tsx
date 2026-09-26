import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/retroui/Button";
import { NotificationCard } from "@/components/notification-card";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Loader2 } from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { EmptyStateCard } from "@/components/empty-state-card";
import { routes } from "@/../routes";
import {
  getNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  type NotificationItem,
} from "@/lib/notifications-api";

const Notifications = () => {
  const navigate = useNavigate();
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
    if (!item.is_read) {
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
    }

    // Tiered deep-link resolver
    // 1. Announcements: simplest fallback (stay in place)
    if (item.notification_type === "announcement") {
      return;
    }

    // 2. Specific deep link in action_url (e.g. /student/subjects/... or /student/todo)
    if (item.action_url && item.action_url.trim() && item.action_url !== "/student/notifications") {
      navigate(item.action_url);
      return;
    }

    // 3. Fallback based on notification role / type
    if (item.notification_type === "risk_alert" || item.notification_type === "intervention_reviewer_available") {
      navigate(routes.student.interventions);
      return;
    }

    // Default fallback for classwork and grades
    navigate(routes.student.todo);
  };

  const getNotificationType = (item: NotificationItem): string => {
    if (
      item.action_url?.toLowerCase().includes("tab=lesson") ||
      item.action_url?.toLowerCase().includes("/lessons") ||
      item.title.toLowerCase().includes("lesson") ||
      item.body?.toLowerCase().includes("lesson")
    ) {
      return "Lesson";
    }
    if (
      item.notification_type === "assignment_due" ||
      item.notification_type === "submission_graded" ||
      item.notification_type === "grade_released" ||
      item.action_url?.toLowerCase().includes("tab=classwork") ||
      item.title.toLowerCase().includes("classwork") ||
      item.title.toLowerCase().includes("assignment") ||
      item.title.toLowerCase().includes("quiz") ||
      item.title.toLowerCase().includes("activity")
    ) {
      return "Classwork";
    }
    if (item.notification_type === "risk_alert" || item.notification_type === "intervention_reviewer_available") {
      return "Intervention";
    }
    if (item.notification_type === "announcement") {
      return "Announcement";
    }
    return "Classwork";
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-clip">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center justify-between gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <h1 className="text-xl font-bold tracking-tight sm:text-2xl md:text-4xl">
                  Notifications
                </h1>
              </div>
              <Button
                variant="default"
                size="header"
                onClick={handleMarkAll}
                disabled={markingAll || notifications.every((n) => n.is_read)}
                className="shrink-0 whitespace-nowrap"
              >
                {markingAll ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                <span className="hidden sm:inline">Mark All as Read</span>
                <span className="sm:hidden">Read All</span>
              </Button>
            </header>

            <div className="-mt-[1px] flex min-w-0 flex-col gap-3 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
              {loading ? (
                <LoadingPanel label="Loading notifications..." />
              ) : notifications.length === 0 ? (
                <EmptyStateCard
                  title="No notifications yet."
                  description="You are all caught up!"
                />
              ) : (
                <div className="flex flex-col gap-3 w-full">
                  {notifications.map((card) => (
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
                        type={getNotificationType(card)}
                        badge={card.is_read ? undefined : "Unread"}
                        isRead={card.is_read}
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
};

export default Notifications;
