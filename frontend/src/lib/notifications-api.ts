import { apiFetch } from "./api";

export type NotificationItem = {
  notification_id: string;
  notification_type: "assignment_due" | "risk_alert" | "announcement" | "grade_released" | "submission_graded";
  title: string;
  body: string | null;
  action_url: string | null;
  is_read: boolean;
  created_at: string | null;
  read_at: string | null;
};

export type NotificationListResponse = {
  unread_count: number;
  notifications: NotificationItem[];
};

export async function getNotifications(unreadOnly = false, limit = 50): Promise<NotificationListResponse> {
  const params = new URLSearchParams({
    unread_only: String(unreadOnly),
    limit: String(limit),
  });
  const res = await apiFetch(`/api/v1/notifications?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch notifications");
  return res.json();
}

export async function markNotificationAsRead(notificationId: string): Promise<NotificationItem> {
  const res = await apiFetch(`/api/v1/notifications/${notificationId}/read`, {
    method: "PATCH",
  });
  if (!res.ok) throw new Error("Failed to mark notification as read");
  return res.json();
}

export async function markAllNotificationsAsRead(): Promise<{ marked_read: number }> {
  const res = await apiFetch("/api/v1/notifications/read-all", {
    method: "PATCH",
  });
  if (!res.ok) throw new Error("Failed to mark all notifications as read");
  return res.json();
}
