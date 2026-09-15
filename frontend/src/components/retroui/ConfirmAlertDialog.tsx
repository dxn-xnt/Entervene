import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/retroui/Button";

type ConfirmAlertDialogProps = {
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function ConfirmAlertDialog({
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
}: ConfirmAlertDialogProps) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-none border-2 border-border bg-background text-foreground shadow-[4px_4px_0_#000]">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          <Alert status="warning">
            <Alert.Title>{title}</Alert.Title>
            <Alert.Description>{description}</Alert.Description>
          </Alert>
        </div>
        <div className="flex shrink-0 flex-col-reverse items-stretch gap-2 border-t-2 border-border bg-background px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
          <Button
            type="button"
            onClick={onCancel}
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            variant="destructive"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
