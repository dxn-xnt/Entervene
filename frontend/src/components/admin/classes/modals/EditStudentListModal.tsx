import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  ClassStudentListItem,
  ClassTransferOption,
  PendingStudentTransfer,
  UpdateClassStudentListRequest,
} from "@/types/adminClasses";
import SelectField from "../fields/SelectField";
import { retroButton } from "../utils";
import ModalShell from "./ModalShell";

type RowAction =
  | { type: "remove"; studentId: string }
  | { type: "transfer"; studentId: string; targetClassId: string };

type BulkAction =
  | { type: "remove" }
  | { type: "transfer"; targetClassId: string }
  | null;

export default function EditStudentListModal({
  currentSectionId,
  currentSectionName,
  academicLevel,
  students,
  availableSections,
  onSaveChanges,
  onClose,
}: {
  currentSectionId: number;
  currentSectionName: string;
  academicLevel: string;
  students: ClassStudentListItem[];
  availableSections: ClassTransferOption[];
  onSaveChanges: (payload: UpdateClassStudentListRequest) => Promise<void>;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selectMultiple, setSelectMultiple] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rowAction, setRowAction] = useState<RowAction | null>(null);
  const [bulkAction, setBulkAction] = useState<BulkAction>(null);
  const [pendingRemovals, setPendingRemovals] = useState<Set<string>>(new Set());
  const [pendingTransfers, setPendingTransfers] = useState<Map<string, number>>(new Map());
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const pendingIds = useMemo(
    () => new Set([...pendingRemovals, ...pendingTransfers.keys()]),
    [pendingRemovals, pendingTransfers]
  );
  const visibleStudents = useMemo(() => {
    const searchTerm = search.trim().toLocaleLowerCase();
    return students
      .filter((student) => !pendingIds.has(student.student_id))
      .filter((student) => !searchTerm || student.full_name.toLocaleLowerCase().includes(searchTerm))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [pendingIds, search, students]);
  const grouped = groupStudents(visibleStudents);
  const pendingCount = pendingRemovals.size + pendingTransfers.size;

  function toggleSelected(studentId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  function stageRemoval(studentIds: string[]) {
    setPendingRemovals((current) => {
      const next = new Set(current);
      studentIds.forEach((studentId) => next.add(studentId));
      return next;
    });
    setPendingTransfers((current) => {
      const next = new Map(current);
      studentIds.forEach((studentId) => next.delete(studentId));
      return next;
    });
    clearActions();
  }

  function stageTransfer(studentIds: string[], targetClassId: number) {
    setPendingTransfers((current) => {
      const next = new Map(current);
      studentIds.forEach((studentId) => next.set(studentId, targetClassId));
      return next;
    });
    setPendingRemovals((current) => {
      const next = new Set(current);
      studentIds.forEach((studentId) => next.delete(studentId));
      return next;
    });
    clearActions();
  }

  function clearActions() {
    setRowAction(null);
    setBulkAction(null);
    setSelectedIds(new Set());
    setSaveError("");
  }

  async function saveChanges() {
    if (!pendingCount || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const transfers: PendingStudentTransfer[] = Array.from(pendingTransfers.entries()).map(
        ([student_id, target_class_id]) => ({ student_id, target_class_id })
      );
      await onSaveChanges({
        removals: Array.from(pendingRemovals).map((student_id) => ({ student_id })),
        transfers,
      });
    } catch (error: unknown) {
      setSaveError(error instanceof Error ? error.message : "Unable to update student list.");
    } finally {
      setSaving(false);
    }
  }

  function closeModal() {
    if (pendingCount && !discardPrompt) {
      setDiscardPrompt(true);
      return;
    }
    onClose();
  }

  return (
    <ModalShell title="Edit Student List" onClose={closeModal} wide>
      <div
        data-current-section-id={currentSectionId}
        className="grid max-h-[78vh] grid-rows-[auto_minmax(0,1fr)_auto] gap-5"
      >
        <header className="grid gap-4">
          <div>
            <p className="text-xl font-black">{currentSectionName} - {academicLevel}</p>
            <p className="text-sm font-semibold text-black/65">{visibleStudents.length} Students visible</p>
          </div>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search students..."
              className="h-10 rounded-md border border-black bg-[#fffdf5] px-3 text-sm md:w-80"
            />
            <button
              className={retroButton(selectMultiple ? "bg-[#f7e9aa]" : "")}
              onClick={() => {
                setSelectMultiple((value) => !value);
                setSelectedIds(new Set());
                setBulkAction(null);
              }}
            >
              {selectMultiple ? "Exit Select Multiple" : "Select Multiple"}
            </button>
          </div>
          {pendingCount > 0 && (
            <div className="rounded-md border border-black bg-[#f7e9aa] p-2 text-xs font-bold">
              {pendingCount} pending change{pendingCount !== 1 ? "s" : ""}. Changes are local until Save Changes.
            </div>
          )}
        </header>

        <section className="min-h-0 overflow-y-auto rounded-lg border-2 border-black bg-[#fffdf5] shadow-[4px_4px_0_#000]">
          {!visibleStudents.length ? (
            <p className="p-6 text-center text-sm font-semibold text-black/60">
              {search.trim() ? "No students match your search." : "No students are currently assigned to this class."}
            </p>
          ) : (
            <div className="grid items-start gap-3 p-3 lg:grid-cols-2">
              {grouped.map(([gender, groupStudents]) => (
                <details key={gender} open className="group overflow-hidden rounded-lg border-2 border-black bg-[#fffdf5] shadow-[3px_3px_0_#000]">
                  <summary className="flex cursor-pointer list-none items-center justify-between bg-[#f7e9aa] px-4 py-3 text-sm font-black">
                    <span>{gender.toUpperCase()}</span>
                    <span className="flex items-center gap-2">
                      <span className="rounded-full border border-black/30 bg-white px-2 py-0.5 text-[10px]">
                        {groupStudents.length} student{groupStudents.length !== 1 ? "s" : ""}
                      </span>
                      <ChevronDown className="size-4 rotate-180 transition-transform group-open:rotate-180" />
                    </span>
                  </summary>
                  {groupStudents.map((student) => (
                    <StudentActionRow
                      key={student.student_id}
                      student={student}
                      currentSectionName={currentSectionName}
                      selected={selectedIds.has(student.student_id)}
                      selectMultiple={selectMultiple}
                      availableSections={availableSections}
                      rowAction={rowAction}
                      onToggleSelected={() => toggleSelected(student.student_id)}
                      onAction={setRowAction}
                      onCancelAction={() => setRowAction(null)}
                      onConfirmRemove={() => stageRemoval([student.student_id])}
                      onConfirmTransfer={(targetClassId) => stageTransfer([student.student_id], targetClassId)}
                    />
                  ))}
                </details>
              ))}
            </div>
          )}
        </section>

        <footer className="grid gap-4 pt-1">
          {selectMultiple && selectedIds.size > 0 && (
            <BulkActionBar
              selectedCount={selectedIds.size}
              currentSectionName={currentSectionName}
              availableSections={availableSections}
              bulkAction={bulkAction}
              onBulkAction={setBulkAction}
              onCancel={() => setBulkAction(null)}
              onConfirmRemove={() => stageRemoval(Array.from(selectedIds))}
              onConfirmTransfer={(targetClassId) => stageTransfer(Array.from(selectedIds), targetClassId)}
            />
          )}
          {discardPrompt && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-black bg-[#f7e9aa] p-3 text-sm font-bold">
              <span>Discard unsaved changes?</span>
              <span className="flex gap-2">
                <button className={retroButton("bg-[#fecdd3]")} onClick={onClose}>Discard Changes</button>
                <button className={retroButton()} onClick={() => setDiscardPrompt(false)}>Continue Editing</button>
              </span>
            </div>
          )}
          {saveError && <div className="rounded-md border border-red-700 bg-red-50 p-3 text-sm font-semibold text-red-800">{saveError}</div>}
          <div className="flex justify-end gap-2">
            <button disabled={saving} className={retroButton("disabled:cursor-not-allowed disabled:opacity-50")} onClick={closeModal}>Cancel</button>
            <button
              disabled={!pendingCount || saving}
              className={retroButton("bg-[#79bd80] disabled:cursor-not-allowed disabled:opacity-50")}
              onClick={saveChanges}
            >
              {saving ? "Saving changes..." : "Save Changes"}
            </button>
          </div>
        </footer>
      </div>
    </ModalShell>
  );
}

function StudentActionRow({
  student,
  currentSectionName,
  selected,
  selectMultiple,
  availableSections,
  rowAction,
  onToggleSelected,
  onAction,
  onCancelAction,
  onConfirmRemove,
  onConfirmTransfer,
}: {
  student: ClassStudentListItem;
  currentSectionName: string;
  selected: boolean;
  selectMultiple: boolean;
  availableSections: ClassTransferOption[];
  rowAction: RowAction | null;
  onToggleSelected: () => void;
  onAction: (action: RowAction) => void;
  onCancelAction: () => void;
  onConfirmRemove: () => void;
  onConfirmTransfer: (targetClassId: number) => void;
}) {
  const isRemoving = rowAction?.type === "remove" && rowAction.studentId === student.student_id;
  const isTransferring = rowAction?.type === "transfer" && rowAction.studentId === student.student_id;
  const targetClassId = isTransferring ? rowAction.targetClassId : "";
  const target = availableSections.find((section) => String(section.class_id) === targetClassId);

  return (
    <div className="border-b border-black/10 bg-white px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-3">
        {selectMultiple && <input type="checkbox" checked={selected} onChange={onToggleSelected} />}
        <Avatar student={student} />
        <span className="min-w-0 flex-1 truncate text-sm font-bold">{student.full_name}</span>
        <button className={retroButton("bg-white text-[#9f1239]")} onClick={() => onAction({ type: "remove", studentId: student.student_id })}>Remove</button>
        <button className={retroButton("bg-[#f7e9aa]")} onClick={() => onAction({ type: "transfer", studentId: student.student_id, targetClassId: "" })}>Transfer</button>
      </div>
      {isRemoving && (
        <div className="mt-2 rounded-md border border-red-700 bg-red-50 p-2 text-xs font-semibold text-red-800">
          <p>Remove {student.full_name} from {currentSectionName}?</p>
          <div className="mt-2 flex gap-2">
            <button className={retroButton("bg-[#fecdd3] text-xs")} onClick={onConfirmRemove}>Confirm Remove</button>
            <button className={retroButton("text-xs")} onClick={onCancelAction}>Cancel</button>
          </div>
        </div>
      )}
      {isTransferring && (
        <div className="mt-2 grid gap-2 rounded-md border border-black bg-[#fff8d7] p-2 text-xs font-semibold">
          <span>Transfer {student.full_name} to:</span>
          <SelectField value={targetClassId} onChange={(value) => onAction({ type: "transfer", studentId: student.student_id, targetClassId: value })}>
            <option value="">Select section</option>
            {availableSections.map((section) => <option key={section.class_id} value={section.class_id}>{section.section_name}</option>)}
          </SelectField>
          {target && <p>Transfer {student.full_name} to {target.section_name}?</p>}
          <div className="flex gap-2">
            <button disabled={!target} className={retroButton("bg-[#f7e9aa] text-xs disabled:cursor-not-allowed disabled:opacity-50")} onClick={() => onConfirmTransfer(Number(targetClassId))}>Confirm Transfer</button>
            <button className={retroButton("text-xs")} onClick={onCancelAction}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function BulkActionBar({
  selectedCount,
  currentSectionName,
  availableSections,
  bulkAction,
  onBulkAction,
  onCancel,
  onConfirmRemove,
  onConfirmTransfer,
}: {
  selectedCount: number;
  currentSectionName: string;
  availableSections: ClassTransferOption[];
  bulkAction: BulkAction;
  onBulkAction: (action: BulkAction) => void;
  onCancel: () => void;
  onConfirmRemove: () => void;
  onConfirmTransfer: (targetClassId: number) => void;
}) {
  const targetClassId = bulkAction?.type === "transfer" ? bulkAction.targetClassId : "";
  const target = availableSections.find((section) => String(section.class_id) === targetClassId);

  return (
    <div className="grid gap-2 rounded-md border-2 border-black bg-[#fffdf5] p-3 shadow-[3px_3px_0_#000]">
      <p className="font-bold">{selectedCount} Students selected</p>
      <div className="flex flex-wrap gap-2">
        <button className={retroButton("bg-[#fecdd3]")} onClick={() => onBulkAction({ type: "remove" })}>Remove Selected</button>
        <button className={retroButton("bg-[#f7e9aa]")} onClick={() => onBulkAction({ type: "transfer", targetClassId: "" })}>Transfer Selected</button>
      </div>
      {bulkAction?.type === "remove" && (
        <div className="rounded-md border border-red-700 bg-red-50 p-2 text-xs font-semibold text-red-800">
          <p>Remove {selectedCount} selected Students from {currentSectionName}?</p>
          <div className="mt-2 flex gap-2">
            <button className={retroButton("bg-[#fecdd3] text-xs")} onClick={onConfirmRemove}>Confirm Remove</button>
            <button className={retroButton("text-xs")} onClick={onCancel}>Cancel</button>
          </div>
        </div>
      )}
      {bulkAction?.type === "transfer" && (
        <div className="grid gap-2 rounded-md border border-black bg-[#fff8d7] p-2 text-xs font-semibold">
          <span>Transfer {selectedCount} selected Students to:</span>
          <SelectField value={targetClassId} onChange={(value) => onBulkAction({ type: "transfer", targetClassId: value })}>
            <option value="">Select section</option>
            {availableSections.map((section) => <option key={section.class_id} value={section.class_id}>{section.section_name}</option>)}
          </SelectField>
          {target && <p>Transfer {selectedCount} selected Students to {target.section_name}?</p>}
          <div className="flex gap-2">
            <button disabled={!target} className={retroButton("bg-[#f7e9aa] text-xs disabled:cursor-not-allowed disabled:opacity-50")} onClick={() => onConfirmTransfer(Number(targetClassId))}>Confirm Transfer</button>
            <button className={retroButton("text-xs")} onClick={onCancel}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Avatar({ student }: { student: ClassStudentListItem }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full border border-amber-700 bg-amber-200 text-sm font-bold text-amber-900">
      {student.avatar_initial || student.full_name.charAt(0)}
    </span>
  );
}

function groupStudents(students: ClassStudentListItem[]) {
  const order = ["Male", "Female", "Other", "Unspecified"];
  return order
    .map((gender) => [gender, students.filter((student) => normalizedGender(student.gender) === gender)] as const)
    .filter(([, group]) => group.length > 0);
}

function normalizedGender(gender: string) {
  if (gender === "Female" || gender === "Male" || gender === "Other") return gender;
  return "Unspecified";
}
