import { useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, type TabItem } from "@/components/retroui/Tabs";
import { Button } from "@/components/student/button";
import { NotificationCard } from "@/components/notification-card";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Bell, ClipboardList, Shield, Loader2 } from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { StudentEmptyState } from "@/components/student/student-empty-state";
import { Alert } from "@/components/retroui/Alert";
import { routes } from "@/../routes";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import {
  getNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  type NotificationItem,
} from "@/lib/notifications-api";
import {
  formatNotificationBody,
  formatNotificationTitle,
  getStudentNotificationBadgeLabel,
  isExcludedNotification,
  isStudentDeadlineNotification,
  isStudentStudySupportType,
  matchesStudentNotificationTab,
  type StudentNotificationTab,
} from "@/lib/notification-formatting";

const studentNotificationTabs: Array<TabItem<StudentNotificationTab>> = [
  { id: "all", label: "All", icon: Bell },
  { id: "classwork", label: "Classwork", icon: ClipboardList },
  { id: "study_support", label: "Study Support", icon: Shield },
];

const emptyStateByTab: Record<
  StudentNotificationTab,
  { icon: ReactNode; title: string; description: string }
> = {
  all: {
    icon: <Bell />,
    title: "No notifications yet",
    description: "Updates from your classes will appear here when available.",
  },
  classwork: {
    icon: <ClipboardList />,
    title: "No classwork notifications",
    description: "New or updated classwork and grade releases will appear here.",
  },
  study_support: {
    icon: <Shield />,
    title: "No Study Support notifications",
    description: "New Study Support activities and reminders will appear here.",
  },
};

const Notifications = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<StudentNotificationTab>("all");
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const data = await getNotifications(false, 50);
      setNotifications(data.notifications.filter(
        (item) => !isExcludedNotification(item) && !isStudentDeadlineNotification(item.notification_type),
      ));
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

    if (isStudentStudySupportType(item.notification_type)) {
      const actionUrl = item.action_url?.trim();
      if (actionUrl?.startsWith(routes.student.interventions)) {
        navigate(actionUrl);
        return;
      }

      // Older targeted-activity notifications linked to classwork with the
      // Study Support return path encoded in `from`.
      if (actionUrl?.startsWith("/student/classworks/")) {
        const returnPath = new URLSearchParams(actionUrl.split("?", 2)[1] ?? "").get("from");
        if (returnPath?.startsWith(routes.student.interventions)) {
          navigate(returnPath);
          return;
        }
      }

      // Never let a Study Support event use a stale Subject/Classwork link.
      navigate(routes.student.interventions);
      return;
    }

    // Specific deep link for non-Study Support notifications.
    if (item.action_url && item.action_url.trim() && item.action_url !== "/student/notifications") {
      navigate(item.action_url);
      return;
    }

    navigate(routes.student.todo);
  };

  const unreadCounts = useMemo<Partial<Record<StudentNotificationTab, number>>>(() => {
    const counts: Record<StudentNotificationTab, number> = {
      all: 0,
      classwork: 0,
      study_support: 0,
    };
    for (const item of notifications) {
      if (item.is_read) continue;
      counts.all += 1;
      if (matchesStudentNotificationTab(item.notification_type, "classwork")) {
        counts.classwork += 1;
      } else if (matchesStudentNotificationTab(item.notification_type, "study_support")) {
        counts.study_support += 1;
      }
    }
    return counts;
  }, [notifications]);

  const filteredNotifications = useMemo(
    () =>
      notifications.filter((item) =>
        matchesStudentNotificationTab(item.notification_type, activeTab),
      ),
    [notifications, activeTab],
  );

  const activeEmptyState = emptyStateByTab[activeTab];

  const markAllDisabled = markingAll || notifications.every((n) => n.is_read);
  const markAllButton = (
    <Button variant="default" size="header" onClick={handleMarkAll} disabled={markAllDisabled} className="shrink-0 whitespace-nowrap">
      {markingAll ? <Loader2 className="size-4 animate-spin" /> : null}
      <span className="hidden sm:inline">Mark All as Read</span>
      <span className="sm:hidden">Read All</span>
    </Button>
  );

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-clip">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <div data-page-tabs-sticky-region>
              <header className="flex items-center justify-between gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
                <div className="flex items-center gap-3">
                  <SidebarTrigger className="shrink-0 md:hidden" />
                  <h1 className="text-xl font-bold sm:text-2xl md:text-4xl">
                    Notifications
                  </h1>
                </div>
                {markAllDisabled ? (
                  <Tooltip>
                    <TooltipTrigger render={<span className="inline-flex" tabIndex={0} aria-label={markingAll ? "Marking notifications as read" : "No unread notifications"}>{markAllButton}</span>} />
                    <TooltipContent>{markingAll ? "Marking notifications as read" : "No unread notifications"}</TooltipContent>
                  </Tooltip>
                ) : markAllButton}
              </header>
              <div className="sticky top-0 z-30 -mt-[1px] bg-background px-3 sm:static sm:px-4 md:px-6">
                <Tabs<StudentNotificationTab>
                  tabs={studentNotificationTabs}
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  counts={unreadCounts}
                  ariaLabel="Notification categories"
                />
              </div>
            </div>

            <div
              role="tabpanel"
              aria-label={studentNotificationTabs.find((tab) => tab.id === activeTab)?.label}
              className="border-t-1 -mt-[1px] flex min-w-0 flex-col gap-3 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6"
            >
              {loading ? (
                <LoadingPanel label="Loading notifications..." />
              ) : loadError ? (
                <Alert status="error">Unable to load notifications. <Button size="sm" variant="outline" className="ml-2 gap-2" onClick={() => void fetchNotifications()}>Retry</Button></Alert>
              ) : filteredNotifications.length === 0 ? (
                <StudentEmptyState
                  icon={activeEmptyState.icon}
                  title={activeEmptyState.title}
                  description={activeEmptyState.description}
                />
              ) : (
                <div className="flex flex-col gap-3 w-full">
                  {filteredNotifications.map((card) => (
                    <div
                      key={card.notification_id}
                      onClick={() => handleCardClick(card)}
                      className="cursor-pointer w-full"
                    >
                      <NotificationCard
                        title={formatNotificationTitle(card.title)}
                        description={formatNotificationBody(card.body)}
                        date={
                          card.created_at
                            ? new Date(
                              card.created_at,
                            ).toLocaleDateString()
                            : ""
                        }
                        type={getStudentNotificationBadgeLabel(card.notification_type)}
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
