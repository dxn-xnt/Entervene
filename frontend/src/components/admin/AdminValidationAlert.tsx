import { useEffect, useRef } from "react";
import { Text } from "@/components/retroui/Text";

type AdminValidationAlertProps = {
  message?: string | null;
  attempt?: number;
  className?: string;
  firstInvalidFieldId?: string;
};

export function AdminValidationAlert({ message, attempt = 0, className, firstInvalidFieldId }: AdminValidationAlertProps) {
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!message || !alertRef.current) return;
    const alert = alertRef.current;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    alert.scrollIntoView?.({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    const timer = window.setTimeout(() => alert.focus({ preventScroll: true }), reducedMotion ? 0 : 300);
    const fieldTimer = firstInvalidFieldId
      ? window.setTimeout(() => document.getElementById(firstInvalidFieldId)?.focus(), reducedMotion ? 200 : 900)
      : null;
    return () => {
      window.clearTimeout(timer);
      if (fieldTimer !== null) window.clearTimeout(fieldTimer);
    };
  }, [message, attempt, firstInvalidFieldId]);

  if (!message) return null;

  return (
    <div ref={alertRef} role="alert" aria-live="assertive" tabIndex={-1} className={className}>
      <Text as="p" className="text-sm font-medium leading-snug text-destructive">
        {message}
      </Text>
    </div>
  );
}
