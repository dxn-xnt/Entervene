import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw, X } from "lucide-react";
import { Dialog, dialogHeaderCloseButtonClassName } from "@/components/retroui/Dialog";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { Alert } from "@/components/retroui/Alert";
import { formatDate } from "@/lib/formatters";

export interface LessonDeliveryCorrectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deliveryId?: number | null;
  lessonTitle?: string;
  deliveredAt?: string | null;
  onConfirmCorrection: (deliveryId: number, reason: string) => Promise<void>;
}

export default function LessonDeliveryCorrectionModal({
  open,
  onOpenChange,
  deliveryId,
  lessonTitle,
  deliveredAt,
  onConfirmCorrection,
}: LessonDeliveryCorrectionModalProps) {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setReason("");
      setError("");
      setIsSubmitting(false);
    }
  }, [open]);

  const handleClose = () => {
    if (isSubmitting) return;
    onOpenChange(false);
  };

  const trimmedReason = reason.trim();
  const isValidLength = trimmedReason.length >= 3 && trimmedReason.length <= 500;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deliveryId) return;

    if (trimmedReason.length < 3) {
      setError("Please provide a reason of at least 3 characters.");
      return;
    }
    if (trimmedReason.length > 500) {
      setError("Reason cannot exceed 500 characters.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      await onConfirmCorrection(deliveryId, trimmedReason);
      onOpenChange(false);
    } catch (err) {
      // Inline alert only, avoid duplicate toasts per AGENTS.md
      setError(
        err instanceof Error
          ? err.message
          : "Failed to correct lesson delivery confirmation.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <Dialog.Content size="md" className="overflow-visible">
        <Dialog.Header position="fixed" asChild>
          <div className="flex items-center justify-between w-full">
            <div>
              <Text as="h5" className="font-sans text-xl font-bold">
                Correct Lesson Delivery Confirmation
              </Text>
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={isSubmitting}
                    className={dialogHeaderCloseButtonClassName}
                    aria-label="Close modal"
                  >
                    <X className="size-4" />
                  </button>
                }
              />
              <TooltipContent>Close modal</TooltipContent>
            </Tooltip>
          </div>
        </Dialog.Header>

        <form onSubmit={handleSubmit} noValidate>
          <section className="flex flex-col gap-4 p-5">
            {error && (
              <Alert status="error" className="rounded!" onClose={() => setError("")}>
                <Alert.Description>{error}</Alert.Description>
              </Alert>
            )}

            <div className="rounded! border-2 border-border bg-retro/40 p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Lesson
                </span>
                {deliveredAt && (
                  <span className="text-xs text-muted-foreground font-medium">
                    Taught on {formatDate(deliveredAt)}
                  </span>
                )}
              </div>
              <p className="text-base font-bold text-foreground">
                {lessonTitle || "Selected Lesson"}
              </p>
            </div>

            <div className="flex items-start gap-2.5 rounded! border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertTriangle className="size-4 shrink-0 text-amber-600 mt-0.5" />
              <p>
                Revoking this delivery confirmation removes the <strong>Taught</strong> status for this class and grading period. An auditable reason is required and preserved in the revision history.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="delivery-correction-reason"
                  className="text-sm font-semibold text-foreground"
                >
                  Correction Reason <span className="text-destructive">*</span>
                </label>
                <span
                  className={`text-xs ${
                    trimmedReason.length > 500
                      ? "text-destructive font-bold"
                      : "text-muted-foreground"
                  }`}
                >
                  {trimmedReason.length}/500 chars
                </span>
              </div>
              <textarea
                id="delivery-correction-reason"
                rows={4}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (error) setError("");
                }}
                disabled={isSubmitting}
                placeholder="Explain why this delivery record is being corrected..."
                className="w-full resize-none rounded! border-2 border-border bg-background px-3 py-2 font-sans text-sm shadow-sm transition focus:outline-hidden focus:ring-1 focus:ring-primary"
              />
              <p className="text-[11px] text-muted-foreground">
                Minimum 3 characters required.
              </p>
            </div>
          </section>

          <Dialog.Footer position="static" className="flex items-center justify-end gap-2 p-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!isValidLength || isSubmitting}
              className="gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  <span>Correcting...</span>
                </>
              ) : (
                <>
                  <RotateCcw className="size-4" />
                  <span>Revoke Delivery</span>
                </>
              )}
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog>
  );
}
