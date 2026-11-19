import { useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, type TabItem } from "@/components/retroui/Tabs";
import { Button } from "@/components/teacher/button";
import { Alert } from "@/components/retroui/Alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { NotificationCard } from "@/components/notification-card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { Bell, FileCheck, AlertTriangle, Loader2, Repeat } from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
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
  isExcludedNotification,
  matchesTeacherNotificationTab,
  type TeacherNotificationTab,
} from "@/lib/notification-formatting";

const tabs: Array<TabItem<TeacherNotificationTab>> = [
  { id: "all", label: "All", icon: Bell },
  { id: "repost", label: "Repost Requests", icon: Repeat },
  { id: "submissions", label: "Submissions", icon: FileCheck },
  { id: "interventions", label: "Interventions", icon: AlertTriangle },
];

const emptyStateByTab: Record<
  TeacherNotificationTab,
  { icon: ReactNode; title: string; description: string }
> = {
  all: {
    icon: <Bell />,
    title: "No notifications",
    description: "New updates will appear here when they arrive.",
  },
  repost: {
    icon: <Repeat />,
    title: "No repost request notifications",
    description: "Repost requests and package updates will appear here.",
  },
  submissions: {
    icon: <FileCheck />,
    title: "No submission notifications",
    description: "Student submissions and deadline summaries will appear here.",
  },
  interventions: {
    icon: <AlertTriangle />,
    title: "No intervention notifications",
    description: "Intervention candidates, assessments, and resolutions will appear here.",
  },
};

const Notifications = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TeacherNotificationTab>("all");
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const data = await getNotifications(false, 50);
      setNotifications(data.notifications.filter((item) => !isExcludedNotification(item)));
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
            n.notification_id === item.notification_id ? { ...n, is_read: true } : n
          )
        );
      } catch (err) {
        console.error("Failed to mark notification as read:", err);
      }
    }

    // Specific deep link in action_url (e.g. /teacher/classworks/:id or /teacher/grades?academic_period_id=...)
    if (item.action_url && item.action_url.trim() && item.action_url !== "/teacher/notifications") {
      navigate(item.action_url);
      return;
    }

    // Fallback based on structured notification event type
    if (item.notification_type === "risk_alert" || item.notification_type.startsWith("intervention_")) {
      navigate(routes.teacher.interventions);
      return;
    }
    if (
      item.notification_type === "grade_submission_window_opened" ||
      item.notification_type === "grade_submission_closing_soon"
    ) {
      navigate(routes.teacher.grades);
      return;
    }

    if (item.notification_type.startsWith("repost_")) {
      navigate(routes.teacher.requests || "/teacher/requests");
      return;
    }

    // Default fallback for submissions / classworks
    navigate(routes.teacher.classworks);
  };

  const unreadCounts = useMemo<Partial<Record<TeacherNotificationTab, number>>>(() => {
    const counts: Record<TeacherNotificationTab, number> = {
      all: 0,
      repost: 0,
      submissions: 0,
      interventions: 0,
    };
    for (const item of notifications) {
      if (item.is_read) continue;
      counts.all += 1;
      if (matchesTeacherNotificationTab(item.notification_type, "repost")) {
        counts.repost += 1;
      } else if (matchesTeacherNotificationTab(item.notification_type, "submissions")) {
        counts.submissions += 1;
      } else if (matchesTeacherNotificationTab(item.notification_type, "interventions")) {
        counts.interventions += 1;
      }
    }
    return counts;
  }, [notifications]);

  const filteredNotifications = useMemo(
    () => notifications.filter((n) => matchesTeacherNotificationTab(n.notification_type, activeTab)),
    [notifications, activeTab],
  );

  const activeEmptyState = emptyStateByTab[activeTab];

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
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
                <Tooltip>
                  <TooltipTrigger render={<span className="inline-flex"><Button
                    variant="default"
                    size="header"
                    onClick={handleMarkAll}
                    disabled={markingAll || notifications.every((n) => n.is_read)}
                    className="shrink-0 whitespace-nowrap"
                  >
                    {markingAll ? <Loader2 className="size-4 animate-spin" /> : null}
                    <span className="hidden sm:inline">Mark All as Read</span>
                    <span className="sm:hidden">Read All</span>
                  </Button></span>} />
                  <TooltipContent>{markingAll ? "Marking as read" : notifications.every((n) => n.is_read) ? "No unread notifications" : "Mark all as read"}</TooltipContent>
                </Tooltip>
              </header>
              <div className="sticky top-0 z-30 -mt-[1px] bg-background px-3 sm:static sm:px-4 md:px-6">
                <Tabs<TeacherNotificationTab>
                  tabs={tabs}
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  counts={unreadCounts}
                  ariaLabel="Notification categories"
                />
              </div>

            </div>

            <div
              role="tabpanel"
              aria-label={tabs.find((tab) => tab.id === activeTab)?.label}
              className="border-t-1 -mt-[1px] flex min-w-0 flex-col gap-3 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6"
            >
              {loading ? (
                <LoadingPanel label="Loading notifications..." />
              ) : loadError ? (
                <Alert status="error">
                  Unable to load notifications.
                  <Button size="sm" variant="outline" className="ml-2 gap-2" onClick={() => void fetchNotifications()}>
                    Retry
                  </Button>
                </Alert>
              ) : filteredNotifications.length === 0 ? (
                <TeacherEmptyState
                  icon={activeEmptyState.icon}
                  title={activeEmptyState.title}
                  description={activeEmptyState.description}
                />
              ) : (
                <div className="flex flex-col gap-3 w-full">
                  {filteredNotifications.map((card) => (
                    <div key={card.notification_id} onClick={() => handleCardClick(card)} className="cursor-pointer w-full">
                      <NotificationCard
                        title={formatNotificationTitle(card.title)}
                        description={formatNotificationBody(card.body)}
                        date={card.created_at ? new Date(card.created_at).toLocaleDateString() : ""}
                        user={card.notification_type.replace(/_/g, " ")}
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

