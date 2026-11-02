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
    const reveal = (element: HTMLElement) => {
      const dialog = element.closest('[data-slot="dialog-content"]');
      if (!dialog) {
        element.scrollIntoView?.({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
        return;
      }

      // Scroll only the modal body. scrollIntoView also scrolls the popup's
      // overflow-hidden ancestors, which can push its header out of view.
      let container = element.parentElement;
      while (container && container !== dialog) {
        if (/auto|scroll/.test(window.getComputedStyle(container).overflowY)) {
          container.scrollTo({
            top: container.scrollTop + element.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientTop,
            behavior: reducedMotion ? "auto" : "smooth",
          });
          return;
        }
        container = container.parentElement;
      }
    };
    reveal(alert);
    const timer = window.setTimeout(() => alert.focus({ preventScroll: true }), reducedMotion ? 0 : 300);
    const fieldTimer = firstInvalidFieldId
      ? window.setTimeout(() => {
        const field = document.getElementById(firstInvalidFieldId);
        if (field) {
          reveal(field);
          field.focus({ preventScroll: true });
        }
      }, reducedMotion ? 200 : 900)
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
