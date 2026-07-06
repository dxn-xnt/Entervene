import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "react-router-dom";

/**
 * Drives the global top-bar progress indicator.
 *
 * The progress bar triggers on:
 *  1. Route changes (detected via useLocation)
 *  2. Manual API start/done signals via the exported event bus
 *
 * Returns { progress, isActive } where progress is 0–100.
 */

// ── Event bus so non-React code (e.g. apiFetch) can signal loads ──
type Listener = (active: boolean) => void;
const listeners = new Set<Listener>();
let inflight = 0;

export function startProgress() {
  inflight++;
  listeners.forEach((fn) => fn(true));
}

export function doneProgress() {
  inflight = Math.max(0, inflight - 1);
  if (inflight === 0) {
    listeners.forEach((fn) => fn(false));
  }
}

function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ── React hook ──
export function useNavigationProgress() {
  const location = useLocation();
  const [progress, setProgress] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tickRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const start = useCallback(() => {
    // Clear any running completion timer
    clearTimeout(timerRef.current);
    clearInterval(tickRef.current);

    setIsActive(true);
    setProgress(15); // instant jump

    // Gradually crawl from 15 → ~90 over time
    let current = 15;
    tickRef.current = setInterval(() => {
      // Slow asymptotic approach so it never reaches 100 on its own
      const increment = (90 - current) * 0.08;
      current = Math.min(current + increment, 90);
      setProgress(current);
    }, 200);
  }, []);

  const finish = useCallback(() => {
    clearInterval(tickRef.current);
    setProgress(100);

    // After the bar reaches 100%, fade out then reset
    timerRef.current = setTimeout(() => {
      setIsActive(false);
      // Reset after fade animation completes
      setTimeout(() => setProgress(0), 300);
    }, 300);
  }, []);

  // ── Route changes ──
  const prevPath = useRef(location.pathname);
  useEffect(() => {
    if (location.pathname !== prevPath.current) {
      prevPath.current = location.pathname;
      start();
      // Routes in an SPA resolve almost instantly — finish after a short delay
      const t = setTimeout(finish, 350);
      return () => clearTimeout(t);
    }
  }, [location.pathname, start, finish]);

  // ── API event bus ──
  useEffect(() => {
    return subscribe((active) => {
      if (active) {
        start();
      } else {
        finish();
      }
    });
  }, [start, finish]);

  return { progress, isActive };
}
