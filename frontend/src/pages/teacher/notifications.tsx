import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, type TabItem } from "@/components/retroui/Tabs";
import { Button } from "@/components/teacher/button";
import { Alert } from "@/components/retroui/Alert";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/retroui/Tooltip";
import { NotificationCard } from "@/components/notification-card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { Bell, AlertTriangle, Loader2, Repeat, ClipboardCheck, PlusCircle } from "lucide-react";
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
  isTeacherSubmissionNotification,
  matchesTeacherNotificationTab,
  type TeacherNotificationTab,
} from "@/lib/notification-formatting";
import {
  formatSubmissionDate,
  generateInitialMockSubmissions,
  isSubmissionAwaitingGrading,
  upsertSubmissionNotification,
  type SubmissionNotificationItem,
} from "@/lib/teacher-submissions-notifications";

type TeacherAnyNotification = NotificationItem | SubmissionNotificationItem;

function toTitleCase(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

const tabs: Array<TabItem<TeacherNotificationTab>> = [
  { id: "all", label: "All", icon: Bell },
  { id: "repost", label: "Repost Requests", icon: Repeat },
  { id: "interventions", label: "Interventions", icon: AlertTriangle },
  { id: "submissions", label: "Submissions", icon: ClipboardCheck },
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
  interventions: {
    icon: <AlertTriangle />,
    title: "No intervention notifications",
    description:
      "Intervention candidates, assessments, and resolutions will appear here.",
  },
  submissions: {
    icon: <ClipboardCheck />,
    title: "No submissions awaiting grading",
    description: "Student submissions ready for review will appear here.",
  },
};

const Notifications = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TeacherNotificationTab>("all");
  const [notifications, setNotifications] = useState<TeacherAnyNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const mockSubmissions = generateInitialMockSubmissions();

      try {
        const data = await getNotifications(false, 50);
        const backendItems = data.notifications.filter(
          (item) => !isExcludedNotification(item) && !isTeacherSubmissionNotification(item),
        );
        setNotifications([...mockSubmissions, ...backendItems]);
      } catch (backendErr) {
        console.warn("Backend notifications unreachable, using mock submissions:", backendErr);
        setNotifications(mockSubmissions);
      }
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
      try {
        await markAllNotificationsAsRead();
      } catch {
        // Fallback for mocked notifications
      }
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    } finally {
      setMarkingAll(false);
    }
  };

  const handleCardClick = async (item: TeacherAnyNotification) => {
    if (!item.is_read) {
      if (item.notification_type !== "submission") {
        try {
          await markNotificationAsRead(item.notification_id);
        } catch (err) {
          console.error("Failed to mark notification as read:", err);
        }
      }
      setNotifications((prev) =>
        prev.map((n) =>
          n.notification_id === item.notification_id
            ? { ...n, is_read: true }
            : n,
        ),
      );
    }

    if (item.notification_type === "submission") {
      const sub = item as SubmissionNotificationItem;
      navigate(sub.action_url || `/teacher/classworks/${sub.classwork.id}`);
      return;
    }

    // Specific deep link in action_url
    if (
      item.action_url &&
      item.action_url.trim() &&
      item.action_url !== "/teacher/notifications"
    ) {
      navigate(item.action_url);
      return;
    }

    // Fallback based on structured notification event type
    if (
      item.notification_type === "risk_alert" ||
      item.notification_type.startsWith("intervention_")
    ) {
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

  /**
   * Action to simulate a new student submission arriving in real time.
   * Demonstrates the constraint: updates existing notification, increments count,
   * updates date, marks unread again, and creates NO duplicate notification.
   */
  const handleSimulateNewSubmission = () => {
    const now = new Date().toISOString();
    setNotifications((prev) => {
      // Find submission notifications
      const submissionItems = prev.filter(
        (n): n is SubmissionNotificationItem => n.notification_type === "submission",
      );
      const otherItems = prev.filter((n) => n.notification_type !== "submission");

      // Target Science 7 (cw-102) to add a 2nd submission
      const updatedSubmissions = upsertSubmissionNotification(submissionItems, {
        subject: { id: "sub-2", name: "Science 7" },
        classwork: {
          id: "cw-102",
          title: "Plant and Animal Cells Diagram",
          type: "activity",
          dueDate: "2026-11-21",
        },
        newSubmissionsCount: 1,
        latestSubmissionAt: now,
      });

      return [...updatedSubmissions, ...otherItems];
    });
  };

  const unreadCounts = useMemo<
    Partial<Record<TeacherNotificationTab, number>>
  >(() => {
    const counts: Record<TeacherNotificationTab, number> = {
      all: 0,
      repost: 0,
      interventions: 0,
      submissions: 0,
    };
    for (const item of notifications) {
      if (item.notification_type === "submission") {
        const subItem = item as SubmissionNotificationItem;
        if (!isSubmissionAwaitingGrading(subItem)) continue;
        if (!item.is_read) {
          counts.all += 1;
          counts.submissions += 1;
        }
        continue;
      }

      if (item.is_read) continue;
      counts.all += 1;
      if (matchesTeacherNotificationTab(item.notification_type, "repost")) {
        counts.repost += 1;
      } else if (
        matchesTeacherNotificationTab(item.notification_type, "interventions")
      ) {
        counts.interventions += 1;
      }
    }
    return counts;
  }, [notifications]);

  const filteredNotifications = useMemo(
    () =>
      notifications.filter((n) => {
        if (n.notification_type === "submission") {
          const subItem = n as SubmissionNotificationItem;
          // Only show in Submissions or All tab, and only if awaiting grading
          if (!isSubmissionAwaitingGrading(subItem)) return false;
          return activeTab === "all" || activeTab === "submissions";
        }
        if (activeTab === "submissions") return false;
        return matchesTeacherNotificationTab(n.notification_type, activeTab);
      }),
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
                <div className="flex items-center gap-2">
                  {activeTab === "submissions" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSimulateNewSubmission}
                      className="hidden sm:inline-flex items-center gap-1.5"
                      title="Simulate receiving another student submission for cw-102 to verify update-not-duplicate behavior"
                    >
                      <PlusCircle className="size-4" />
                      <span>Simulate Submission</span>
                    </Button>
                  )}
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
                </div>
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
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-2 gap-2"
                    onClick={() => void fetchNotifications()}
                  >
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
                  {filteredNotifications.map((card) => {
                    const isSubmission = card.notification_type === "submission";
                    const subItem = isSubmission
                      ? (card as SubmissionNotificationItem)
                      : null;
                    return (
                      <div
                        key={card.notification_id}
                        onClick={() => handleCardClick(card)}
                        className="cursor-pointer w-full"
                      >
                        <NotificationCard
                          title={
                            isSubmission
                              ? card.title
                              : formatNotificationTitle(card.title)
                          }
                          description={
                            isSubmission
                              ? card.body || ""
                              : formatNotificationBody(card.body)
                          }
                          date={
                            isSubmission && subItem
                              ? formatSubmissionDate(subItem.latestSubmissionAt)
                              : card.created_at
                                ? new Date(card.created_at).toLocaleDateString()
                                : ""
                          }
                          user={
                            isSubmission && subItem
                              ? `${subItem.subject.name} • Classwork`
                              : card.notification_type.replace(/_/g, " ")
                          }
                          type={
                            isSubmission && subItem
                              ? toTitleCase(subItem.classwork.type)
                              : undefined
                          }
                          badge={card.is_read ? undefined : "Unread"}
                          isRead={card.is_read}
                        />
                      </div>
                    );
                  })}
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
