import { useEffect, useRef } from "react";
import { API_URL } from "@/lib/api";

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function useReadingFocusTracker(
  assignmentId: number | null | undefined,
  isActive: boolean,
) {
  const accumulatedRef = useRef<number>(0);
  const activeStartRef = useRef<number | null>(null);
  const assignmentIdRef = useRef<number | null | undefined>(assignmentId);

  useEffect(() => {
    assignmentIdRef.current = assignmentId;
  }, [assignmentId]);

  const flush = useRef(() => {
    const currentId = assignmentIdRef.current;
    if (!currentId) return;

    let seconds = accumulatedRef.current;
    if (activeStartRef.current !== null) {
      const now = Date.now();
      seconds += (now - activeStartRef.current) / 1000;
      activeStartRef.current = now; // reset active start after snapshot
    }

    const rounded = Math.round(seconds);
    if (rounded < 1) return;

    accumulatedRef.current = 0;

    const url = `${API_URL}/api/v1/submissions/assignment/${currentId}/reading-focus`;
    const payload = JSON.stringify({ focused_seconds: rounded });
    const csrfToken = getCookie("entervene_csrf");

    try {
      // Use fetch with keepalive first (supports custom headers and credentials)
      void fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
        body: payload,
        credentials: "include",
        keepalive: true,
      }).catch(() => {
        // Fallback to sendBeacon if fetch fails or on abrupt unload
        if (typeof navigator !== "undefined" && navigator.sendBeacon) {
          const blob = new Blob([payload], { type: "application/json" });
          navigator.sendBeacon(url, blob);
        }
      });
    } catch {
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon(url, blob);
      }
    }
  });

  useEffect(() => {
    if (!isActive || !assignmentId) {
      activeStartRef.current = null;
      accumulatedRef.current = 0;
      return;
    }

    // Start timer if visible and focused
    const isFocused = typeof document !== "undefined" && !document.hidden;
    if (isFocused) {
      activeStartRef.current = Date.now();
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        if (activeStartRef.current !== null) {
          accumulatedRef.current += (Date.now() - activeStartRef.current) / 1000;
          activeStartRef.current = null;
        }
        flush.current();
      } else {
        activeStartRef.current = Date.now();
      }
    };

    const onFocus = () => {
      if (!document.hidden && activeStartRef.current === null) {
        activeStartRef.current = Date.now();
      }
    };

    const onBlur = () => {
      if (activeStartRef.current !== null) {
        accumulatedRef.current += (Date.now() - activeStartRef.current) / 1000;
        activeStartRef.current = null;
      }
      flush.current();
    };

    const onPageHide = () => {
      flush.current();
    };

    window.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onPageHide);

    // Periodic flush every 30s for long active reading sessions
    const intervalId = window.setInterval(() => {
      if (activeStartRef.current !== null) {
        flush.current();
      }
    }, 30_000);

    return () => {
      window.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
      window.clearInterval(intervalId);
      flush.current();
      activeStartRef.current = null;
      accumulatedRef.current = 0;
    };
  }, [assignmentId, isActive]);
}
