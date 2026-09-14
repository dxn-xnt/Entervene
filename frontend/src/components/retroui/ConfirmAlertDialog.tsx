import { Alert } from "@/components/retroui/Alert";

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
<<<<<<< HEAD
      <div className="w-full max-w-md rounded border border-black bg-white p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <Alert status="warning">
          <Alert.Title>{title}</Alert.Title>
          <Alert.Description>{description}</Alert.Description>
        </Alert>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-black px-4 py-2 text-sm font-semibold"
=======
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-none border-2 border-border bg-background text-foreground shadow-[4px_4px_0_#000]">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          <Alert status="warning">
            <Alert.Title>{title}</Alert.Title>
            <Alert.Description>{description}</Alert.Description>
          </Alert>
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border p-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-none border border-black px-4 py-2 text-sm font-semibold"
>>>>>>> db4c0c452e2d9c605335b22d05f6935487b30b3d
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
<<<<<<< HEAD
            className="rounded border border-red-600 bg-red-100 px-4 py-2 text-sm font-semibold text-red-700"
=======
            className="rounded-none border border-red-600 bg-red-100 px-4 py-2 text-sm font-semibold text-red-700"
>>>>>>> db4c0c452e2d9c605335b22d05f6935487b30b3d
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
