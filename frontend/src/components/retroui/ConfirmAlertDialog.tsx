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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-md rounded-lg border border-black bg-white p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <Alert status="warning">
          <Alert.Title>{title}</Alert.Title>
          <Alert.Description>{description}</Alert.Description>
        </Alert>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-black px-4 py-2 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg border border-red-600 bg-red-100 px-4 py-2 text-sm font-semibold text-red-700"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
