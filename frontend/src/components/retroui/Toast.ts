import { useMemo } from "react";
import { toast } from "sonner";

export type ToastMessage = {
  title: string;
  description?: string;
};

const durations = {
  success: 4500,
  info: 4500,
  warning: 5500,
  error: 6500,
} as const;

/** Semantic adapter for the shared Sonner viewport. */
export function useToast() {
  return useMemo(() => ({
    success: ({ title, description }: ToastMessage) =>
      toast.success(title, { description, duration: durations.success }),
    error: ({ title, description }: ToastMessage) =>
      toast.error(title, { description, duration: durations.error }),
    warning: ({ title, description }: ToastMessage) =>
      toast.warning(title, { description, duration: durations.warning }),
    info: ({ title, description }: ToastMessage) =>
      toast.info(title, { description, duration: durations.info }),
  }), []);
}
