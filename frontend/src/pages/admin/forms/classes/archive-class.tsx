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
    <ModalShell title={`Archive Class ${classRecord.section_name}`} onClose={onClose}>
      <div className="flex flex-col">
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1">
            <Text as="p" className="text-base">
              Are you sure you want to archive <b>{classRecord.section_name}</b>?
            </Text>
            <Text as="p" className="text-base text-muted-foreground">
              This class will no longer appear in the active Classes list or as a
              valid Student-transfer destination. Existing records and historical
              data will be preserved.
            </Text>
          </div>

        </div>


        {error && (
          <p className="border-2 border-destructive bg-destructive/10 p-3 text-sm font-semibold text-destructive">
            {error}
          </p>
        )}

        <Dialog.Footer>
          <Button variant={"outline"} disabled={isArchiving} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={"default"}
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
