import { useCallback, useEffect, useState } from "react";
import { getNotifications, NOTIFICATIONS_CHANGED_EVENT } from "@/lib/notifications-api";

export function useUnreadNotificationCount() {
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const result = await getNotifications(true, 1);
      setUnreadCount(result.unread_count);
    } catch (error) {
      console.error("Failed to load unread notification count:", error);
    }
  }, []);

  useEffect(() => {
    const handleChange = () => void refresh();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    const initialRefresh = window.setTimeout(handleChange, 0);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, handleChange);
    window.addEventListener("focus", handleChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearTimeout(initialRefresh);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, handleChange);
      window.removeEventListener("focus", handleChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refresh]);

  return unreadCount;
}
