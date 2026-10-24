"use client";

import type { ClassListItem } from "@/types/adminClasses";
import { ConfirmDialog } from "@/components/confirm-dialog";

export default function ArchiveClass({ classRecord, isArchiving, error, onClose, onConfirm }: {
  classRecord: ClassListItem;
  isArchiving: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="Archive Class"
      confirmationTitle={<p className="text-base">Are you sure you want to archive <strong>{classRecord.section_name}</strong>?</p>}
      description="This class will no longer appear in the active Classes list or as a valid student-transfer destination. Existing records and historical data will be preserved."
      confirmLabel={isArchiving ? "Archiving class..." : "Archive Class"}
      confirmVariant="destructive"
      isLoading={isArchiving}
      onCancel={onClose}
      onConfirm={onConfirm}
      size="md"
    >
      {error && <p className="border-2 border-destructive bg-destructive/10 p-3 text-sm font-semibold text-destructive">{error}</p>}
    </ConfirmDialog>
  );
}
