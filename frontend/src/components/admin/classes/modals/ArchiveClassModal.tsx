import type { ClassRecord } from "@/types/adminClasses";
import { retroButton } from "../utils";
import ModalShell from "./ModalShell";

export default function ArchiveClassModal({ classRecord, onClose, onConfirm }: {
  classRecord: ClassRecord;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell title={`Archive ${classRecord.grade} - ${classRecord.section}?`} onClose={onClose}>
      <div className="grid gap-4">
        <p className="text-sm">This class will be hidden from active class lists but can still be viewed in archived records.</p>
        <div className="flex justify-end gap-2">
          <button className={retroButton()} onClick={onClose}>Cancel</button>
          <button className={retroButton("bg-[#79bd80]")} onClick={onConfirm}>Archive Class</button>
        </div>
      </div>
    </ModalShell>
  );
}
