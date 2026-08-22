import { Button, type IButtonProps } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import { Text } from "@/components/retroui/Text";
import React from "react";

export type ConfirmDialogSize =
  | "auto"
  | "sm"
  | "md"
  | "lg"
  | "xl"
  | "2xl"
  | "3xl"
  | "4xl"
  | "screen";

export type ConfirmDialogOptions = {
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: IButtonProps["variant"];
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
  size?: ConfirmDialogSize;
};

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  options?: ConfirmDialogOptions;
  // Optional flat props (can also be passed directly or inside options)
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: IButtonProps["variant"];
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
  size?: ConfirmDialogSize;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  options,
  ...flatProps
}: ConfirmDialogProps) {
  const confirmLabel = options?.confirmLabel ?? flatProps.confirmLabel ?? "Confirm";
  const cancelLabel = options?.cancelLabel ?? flatProps.cancelLabel ?? "Cancel";
  const confirmVariant = options?.confirmVariant ?? flatProps.confirmVariant ?? "default";
  const onConfirm = options?.onConfirm ?? flatProps.onConfirm;
  const onCancel = options?.onCancel ?? flatProps.onCancel;
  const isLoading = options?.isLoading ?? flatProps.isLoading ?? false;
  const size = options?.size ?? flatProps.size ?? "md";

  const handleCancel = () => {
    onCancel?.();
    onOpenChange?.(false);
  };

  const handleConfirm = async () => {
    if (onConfirm) {
      await onConfirm();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange?.(nextOpen);
        if (!nextOpen && onCancel) {
          onCancel();
        }
      }}
    >
      <Dialog.Content size={size}>
        <Dialog.Header position="static">
          {typeof title === "string" ? (
            <Text as="h5" className="font-sans text-xl font-bold">
              {title}
            </Text>
          ) : (
            title
          )}
        </Dialog.Header>
        <section className="flex flex-col gap-2 p-4 text-sm">
          {description ? (
            typeof description === "string" ? (
              <p>{description}</p>
            ) : (
              description
            )
          ) : null}
          {children}
        </section>
        <Dialog.Footer position="static">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isLoading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            onClick={() => void handleConfirm()}
            disabled={isLoading}
          >
            {confirmLabel}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}

export default ConfirmDialog;
