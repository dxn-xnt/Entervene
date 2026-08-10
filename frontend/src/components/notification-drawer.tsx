import { useEffect, useState, useCallback } from "react";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { NotificationCard } from "./notification-card";
import {
  getNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  type NotificationItem,
} from "@/lib/notifications-api";

export function NotificationDrawer() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const loadNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getNotifications(false, 30);
      setNotifications(data.notifications);
      setUnreadCount(data.unread_count);
    } catch (err) {
      console.error("Failed to load notifications:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch initial unread count on mount, and full list when drawer opens
  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const handleRead = async (item: NotificationItem) => {
    if (item.is_read) return;
    try {
      await markNotificationAsRead(item.notification_id);
      setNotifications((prev) =>
        prev.map((n) =>
          n.notification_id === item.notification_id ? { ...n, is_read: true } : n
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error("Failed to mark notification as read:", err);
    }
  };

  const handleReadAll = async () => {
    try {
      setMarkingAll(true);
      await markAllNotificationsAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error("Failed to mark all notifications as read:", err);
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative cursor-pointer" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="p-4 border-b flex flex-row items-center justify-between">
          <SheetTitle className="text-lg font-bold flex items-center gap-2">
            Notifications
            {unreadCount > 0 && (
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                {unreadCount} unread
              </span>
            )}
          </SheetTitle>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReadAll}
              disabled={markingAll}
              className="text-xs flex items-center gap-1"
            >
              {markingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
              Mark all as read
            </Button>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mb-2" />
              <p className="text-sm">Loading notifications...</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">No notifications yet</p>
            </div>
          ) : (
            notifications.map((item) => (
              <div
                key={item.notification_id}
                onClick={() => handleRead(item)}
                className={`cursor-pointer transition-opacity ${item.is_read ? "opacity-70" : "opacity-100"}`}
              >
                <NotificationCard
                  title={item.title}
                  description={item.body ?? ""}
                  date={item.created_at ? new Date(item.created_at).toLocaleDateString() : ""}
                  user={item.notification_type.replace(/_/g, " ")}
                  badge={item.is_read ? undefined : "New"}
                  isRead={item.is_read}
                />
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
