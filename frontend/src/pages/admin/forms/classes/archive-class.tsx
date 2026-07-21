"use client";

import type { ClassListItem } from "@/types/adminClasses";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Dialog } from "@/components/retroui/Dialog";
import ModalShell from "./modal-shell";

export default function ArchiveClass({ classRecord, isArchiving, error, onClose, onConfirm }: {
  classRecord: ClassListItem;
  isArchiving: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <ModalShell title="Archive Class" onClose={onClose}>
      <div className="grid gap-4">
        <Text as="p" className="font-bold text-base">
          {classRecord.section_name} - {classRecord.academic_level.level_name}
        </Text>
        <Text as="p" className="text-sm">
          Are you sure you want to archive <b>{classRecord.section_name}</b>?
        </Text>
        <Text as="p" className="text-sm text-muted-foreground">
          This class will no longer appear in the active Classes list or as a
          valid Student-transfer destination. Existing records and historical
          data will be preserved.
        </Text>

        {error && (
          <p className="border-2 border-destructive bg-destructive/10 p-3 text-sm font-semibold text-destructive">
            {error}
          </p>
        )}

        <Dialog.Footer className="px-0 pt-2 border-t-0">
          <Button variant={"outline"} disabled={isArchiving} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={"destructive"}
            disabled={isArchiving}
            onClick={() => void onConfirm()}
          >
            {isArchiving ? "Archiving class..." : "Archive Class"}
          </Button>
        </Dialog.Footer>
      </div>
    </ModalShell>
  );
}
