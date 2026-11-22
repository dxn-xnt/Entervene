import {
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/retroui/Button";
import { Alert } from "@/components/retroui/Alert";
import { Badge } from "@/components/retroui/Badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/retroui/Tooltip";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { Settings, Loader2 } from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { NotificationCard } from "@/components/notification-card";
import { routes } from "@/../routes";
import {
  getNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  type NotificationItem,
} from "@/lib/notifications-api";
import {
  formatNotificationBody,
  formatNotificationTitle,
  formatSystemSettingSentence,
  isExcludedNotification,
  parseSystemSettingNotification,
} from "@/lib/notification-formatting";

const AdminNotifications = () => {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const data = await getNotifications(false, 50);
      setNotifications(
        data.notifications.filter((item) => !isExcludedNotification(item)),
      );
    } catch (err) {
      console.error("Failed to load notifications:", err);
      setLoadError(true);
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

    if (
      item.action_url &&
      item.action_url.trim() &&
      item.action_url !== "/admin/notifications"
    ) {
      navigate(item.action_url);
      return;
    }

    navigate(routes.admin.settings);
  };

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications],
  );

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex flex-col gap-2 bg-background px-3 py-3 sm:px-4 sm:py-4 md:flex-row md:items-center md:justify-between md:gap-3 md:px-6">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-xl font-bold sm:text-2xl md:text-4xl">
                      Notifications
                    </h1>
                    {unreadCount > 0 && (
                      <Badge variant="solid" size="sm" className="font-bold">
                        {unreadCount} unread
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="inline-flex">
                      <Button
                        variant="default"
                        size="header"
                        onClick={handleMarkAll}
                        disabled={
                          markingAll || notifications.every((n) => n.is_read)
                        }
                        className="shrink-0 whitespace-nowrap"
                      >
                        {markingAll ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : null}
                        <span className="hidden sm:inline">
                          Mark All as Read
                        </span>
                        <span className="sm:hidden">Read All</span>
                      </Button>
                    </span>
                  }
                />
                <TooltipContent>
                  {markingAll
                    ? "Marking as read"
                    : notifications.every((n) => n.is_read)
                      ? "No unread notifications"
                      : "Mark all as read"}
                </TooltipContent>
              </Tooltip>
            </header>

            <main
              className="border-t-1 -mt-[1px] flex min-w-0 flex-col gap-3 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6"
            >
              {loading ? (
                <LoadingPanel label="Loading notifications..." />
              ) : loadError ? (
                <Alert status="error">
                  Unable to load notifications.
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-2 gap-2"
                    onClick={() => void fetchNotifications()}
                  >
                    Retry
                  </Button>
                </Alert>
              ) : notifications.length === 0 ? (
                <AdminEmptyState
                  icon={<Settings />}
                  title="No system setting notifications"
                  description="New system setting changes and policy adjustments will appear here."
                />
              ) : (
                <div className="flex flex-col gap-3 w-full">
                  {notifications.map((card) => {
                    const meta = parseSystemSettingNotification(
                      card.body,
                      card.created_at,
                    );
                    const isGeneralAverage =
                      card.title.toLowerCase().includes("general average") ||
                      (meta.summary &&
                        meta.summary.toLowerCase().includes("general average"));
                    const badgeType = isGeneralAverage
                      ? "General Average"
                      : "System Setting";

                    const sentenceDescription =
                      formatSystemSettingSentence(meta);
                    const description =
                      sentenceDescription || formatNotificationBody(card.body);

                    return (
                      <div
                        key={card.notification_id}
                        onClick={() => handleCardClick(card)}
                        className="cursor-pointer w-full"
                      >
                        <NotificationCard
                          title={formatNotificationTitle(card.title)}
                          description={description}
                          date={
                            card.created_at
                              ? new Date(card.created_at).toLocaleString([], {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                })
                              : ""
                          }
                          type={badgeType}
                          badge={card.is_read ? undefined : "Unread"}
                          isRead={card.is_read}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </main>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default AdminNotifications;
