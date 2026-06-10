import type { ClassListItem } from "@/types/adminClasses";
import { retroButton } from "../utils";
import ModalShell from "./ModalShell";

export default function ArchiveClassModal({ classRecord, isArchiving, error, onClose, onConfirm }: {
  classRecord: ClassListItem;
  isArchiving: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <ModalShell title="Archive Class" onClose={onClose}>
      <div className="grid gap-4">
        <p className="font-bold">
          {classRecord.section_name} - {classRecord.academic_level.level_name}
        </p>
        <p className="text-sm">
          Are you sure you want to archive {classRecord.section_name}?
        </p>
        <p className="text-sm">
          This class will no longer appear in the active Classes list or as a
          valid Student-transfer destination. Existing records and historical
          data will be preserved.
        </p>
        {error && (
          <p className="border-2 border-black bg-[#fecdd3] p-3 text-sm font-semibold text-[#9f1239]">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button className={retroButton()} disabled={isArchiving} onClick={onClose}>
            Cancel
          </button>
          <button
            className={retroButton("bg-[#fecdd3] text-[#9f1239] disabled:cursor-not-allowed disabled:opacity-60")}
            disabled={isArchiving}
            onClick={() => void onConfirm()}
          >
            {isArchiving ? "Archiving class..." : "Archive Class"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
