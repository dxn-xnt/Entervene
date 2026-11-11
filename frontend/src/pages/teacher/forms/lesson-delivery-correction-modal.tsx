import { useEffect, useState } from "react";
import { Loader2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, dialogHeaderCloseButtonClassName } from "@/components/retroui/Dialog";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import LessonItemLine from "@/components/item-line/lesson";
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

  useEffect(() => {
    if (open) {
      setReason("");
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
      toast.error("Please provide a reason of at least 3 characters.");
      return;
    }
    if (trimmedReason.length > 500) {
      toast.error("Reason cannot exceed 500 characters.");
      return;
    }

    setIsSubmitting(true);

    try {
      await onConfirmCorrection(deliveryId, trimmedReason);
      onOpenChange(false);
    } catch (err) {
      toast.error(
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
      <Dialog.Content size="xl" className="overflow-visible">
        <Dialog.Header position="fixed" asChild>
          <div className="flex items-center justify-between w-full">
            <div>
              <Text as="h5" className="font-sans text-xl font-bold">
                Revoke Lesson Completion Confirmation
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
          <section className="flex flex-col gap-4 p-5 pb-1">
            <LessonItemLine
              lesson={{
                lesson_id: deliveryId || 0,
                title: lessonTitle || "Selected Lesson",
              }}
              className="rounded! "
              isDelivered={true}
              showDeliveryStatus={true}
              subtitle={
                deliveredAt ? `Completed on ${formatDate(deliveredAt)}` : undefined
              }
              showDropdown={false}
              withShadow={false}
            />

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="delivery-correction-reason"
                  className="text-sm font-semibold text-foreground"
                >
                  Correction Reason <span className="text-destructive">*</span>
                </label>
                <span
                  className={`text-xs ${trimmedReason.length > 500
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
                onChange={(e) => setReason(e.target.value)}
                disabled={isSubmitting}
                placeholder="Explain why this delivery record is being corrected..."
                className="w-full resize-none rounded! border-2 border-border bg-background px-3 py-2 font-sans text-sm shadow-sm transition focus:outline-hidden focus:ring-1 focus:ring-primary"
              />
            </div>
            <p className="text-xs text-muted-foreground -mt-4 px-2">
              Revoking this delivery confirmation removes the <strong>Completed</strong> status for this class and grading period.
            </p>
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
