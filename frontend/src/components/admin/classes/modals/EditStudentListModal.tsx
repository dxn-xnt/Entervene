import { Check, ChevronDown, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  ClassAssignmentStudent,
  ClassStudentListItem,
  ClassTransferOption,
  PendingStudentTransfer,
  UpdateClassStudentListRequest,
} from "@/types/adminClasses";
import { assignmentStudentName, matchesStudentSearch, sortAssignmentStudents } from "../assignment/studentSorting";
import SelectField from "../fields/SelectField";
import { retroButton } from "../utils";
import ModalShell from "./ModalShell";

type ModalTab = "enrolled" | "available";
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
  availableStudents,
  availableSections,
  onSaveChanges,
  onClose,
}: {
  currentSectionId: number;
  currentSectionName: string;
  academicLevel: string;
  students: ClassStudentListItem[];
  availableStudents: ClassAssignmentStudent[];
  availableSections: ClassTransferOption[];
  onSaveChanges: (payload: UpdateClassStudentListRequest) => Promise<void>;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<ModalTab>("enrolled");
  const [enrolledSearch, setEnrolledSearch] = useState("");
  const [availableSearch, setAvailableSearch] = useState("");
  const [selectMultiple, setSelectMultiple] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rowAction, setRowAction] = useState<RowAction | null>(null);
  const [bulkAction, setBulkAction] = useState<BulkAction>(null);
  const [pendingAdditions, setPendingAdditions] = useState<Set<string>>(new Set());
  const [pendingRemovals, setPendingRemovals] = useState<Set<string>>(new Set());
  const [pendingTransfers, setPendingTransfers] = useState<Map<string, number>>(new Map());
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");

  const pendingEnrolledIds = useMemo(
    () => new Set([...pendingRemovals, ...pendingTransfers.keys()]),
    [pendingRemovals, pendingTransfers]
  );
  const visibleEnrolledStudents = useMemo(() => {
    const searchTerm = enrolledSearch.trim().toLocaleLowerCase();
    return students
      .filter((student) => !pendingEnrolledIds.has(student.student_id))
      .filter((student) => !searchTerm || student.full_name.toLocaleLowerCase().includes(searchTerm))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [enrolledSearch, pendingEnrolledIds, students]);
  const visibleAvailableStudents = useMemo(
    () => sortAssignmentStudents(availableStudents.filter((student) => matchesStudentSearch(student, availableSearch))),
    [availableSearch, availableStudents]
  );
  const enrolledGroups = groupStudents(visibleEnrolledStudents);
  const pendingCount = pendingAdditions.size + pendingRemovals.size + pendingTransfers.size;

  function toggleSelected(studentId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  function stageAddition(studentId: string) {
    setPendingAdditions((current) => new Set(current).add(studentId));
    clearMessages();
  }

  function undoAddition(studentId: string) {
    setPendingAdditions((current) => {
      const next = new Set(current);
      next.delete(studentId);
      return next;
    });
    clearMessages();
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

  function clearMessages() {
    setSaveError("");
    setSaveSuccess("");
    setDiscardPrompt(false);
  }

  function clearActions() {
    setRowAction(null);
    setBulkAction(null);
    setSelectedIds(new Set());
    clearMessages();
  }

  async function saveChanges() {
    if (!pendingCount || saving) return;
    setSaving(true);
    setSaveError("");
    setSaveSuccess("");
    try {
      const transfers: PendingStudentTransfer[] = Array.from(pendingTransfers.entries()).map(
        ([student_id, target_class_id]) => ({ student_id, target_class_id })
      );
      await onSaveChanges({
        additions: Array.from(pendingAdditions).map((student_id) => ({ student_id })),
        removals: Array.from(pendingRemovals).map((student_id) => ({ student_id })),
        transfers,
      });
      setPendingAdditions(new Set());
      setPendingRemovals(new Set());
      setPendingTransfers(new Map());
      setSelectedIds(new Set());
      setRowAction(null);
      setBulkAction(null);
      setSaveSuccess("Student list updated successfully.");
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
    <ModalShell title="Edit Student List" onClose={closeModal} workspace>
      <div
        data-current-section-id={currentSectionId}
        className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3"
      >
        <header className="grid shrink-0 gap-3">
          <div>
            <p className="text-xl font-black">{currentSectionName} - {academicLevel}</p>
            <p className="text-sm font-semibold text-black/65">
              {students.length} student{students.length !== 1 ? "s" : ""} enrolled
            </p>
          </div>
          <div className="flex gap-1 border-b-2 border-black px-1">
            <TabButton active={activeTab === "enrolled"} onClick={() => setActiveTab("enrolled")}>
              Enrolled students
              <CountBadge count={students.length} />
            </TabButton>
            <TabButton active={activeTab === "available"} onClick={() => setActiveTab("available")}>
              Add students
              <CountBadge count={availableStudents.length} />
            </TabButton>
          </div>
          {pendingCount > 0 && (
            <div className="rounded-md border border-black bg-[#f7e9aa] p-2 text-xs font-bold">
              {pendingCount} pending change{pendingCount !== 1 ? "s" : ""}. Changes are local until Save Changes.
            </div>
          )}
        </header>

        <main className="min-h-0 overflow-hidden">
          {activeTab === "enrolled" ? (
            <EnrolledStudentsPanel
              search={enrolledSearch}
              onSearch={setEnrolledSearch}
              selectMultiple={selectMultiple}
              onToggleSelectMultiple={() => {
                setSelectMultiple((value) => !value);
                setSelectedIds(new Set());
                setBulkAction(null);
              }}
              groups={enrolledGroups}
              selectedIds={selectedIds}
              availableSections={availableSections}
              currentSectionName={currentSectionName}
              rowAction={rowAction}
              onToggleSelected={toggleSelected}
              onAction={setRowAction}
              onCancelAction={() => setRowAction(null)}
              onConfirmRemove={(studentId) => stageRemoval([studentId])}
              onConfirmTransfer={(studentId, targetClassId) => stageTransfer([studentId], targetClassId)}
            />
          ) : (
            <AvailableStudentsPanel
              academicLevel={academicLevel}
              students={visibleAvailableStudents}
              totalStudents={availableStudents.length}
              search={availableSearch}
              onSearch={setAvailableSearch}
              pendingAdditions={pendingAdditions}
              onAdd={stageAddition}
              onUndo={undoAddition}
            />
          )}
        </main>

        <footer className="grid shrink-0 gap-2 border-t border-black/30 bg-[#fffdf5] pt-3">
          {activeTab === "enrolled" && selectMultiple && selectedIds.size > 0 && (
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
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-black bg-[#f7e9aa] p-2 text-sm font-bold">
              <span>Discard unsaved changes?</span>
              <span className="flex gap-2">
                <button className={retroButton("bg-[#fecdd3]")} onClick={onClose}>Discard Changes</button>
                <button className={retroButton()} onClick={() => setDiscardPrompt(false)}>Continue Editing</button>
              </span>
            </div>
          )}
          {saveError && <StatusBanner className="border-red-700 bg-red-50 text-red-800">{saveError}</StatusBanner>}
          {saveSuccess && <StatusBanner className="bg-[#d8efca]">{saveSuccess}</StatusBanner>}
          <div className="flex justify-end gap-2">
            <button disabled={saving} className={retroButton("disabled:cursor-not-allowed disabled:opacity-50")} onClick={closeModal}>Cancel</button>
            <button
              disabled={!pendingCount || saving}
              className={retroButton("bg-[#79bd80] disabled:cursor-not-allowed disabled:opacity-50")}
              onClick={saveChanges}
            >
              {saving ? "Saving changes..." : `Save Changes${pendingCount ? ` (+${pendingCount})` : ""}`}
            </button>
          </div>
        </footer>
      </div>
    </ModalShell>
  );
}

function EnrolledStudentsPanel({
  search,
  onSearch,
  selectMultiple,
  onToggleSelectMultiple,
  groups,
  selectedIds,
  availableSections,
  currentSectionName,
  rowAction,
  onToggleSelected,
  onAction,
  onCancelAction,
  onConfirmRemove,
  onConfirmTransfer,
}: {
  search: string;
  onSearch: (value: string) => void;
  selectMultiple: boolean;
  onToggleSelectMultiple: () => void;
  groups: ReturnType<typeof groupStudents>;
  selectedIds: Set<string>;
  availableSections: ClassTransferOption[];
  currentSectionName: string;
  rowAction: RowAction | null;
  onToggleSelected: (studentId: string) => void;
  onAction: (action: RowAction) => void;
  onCancelAction: () => void;
  onConfirmRemove: (studentId: string) => void;
  onConfirmTransfer: (studentId: string, targetClassId: number) => void;
}) {
  const visibleCount = groups.reduce((count, [, students]) => count + students.length, 0);
  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search students..."
          className="h-10 rounded-md border border-black bg-[#fffdf5] px-3 text-sm md:w-80"
        />
        <button className={retroButton(selectMultiple ? "bg-[#f7e9aa]" : "")} onClick={onToggleSelectMultiple}>
          {selectMultiple ? "Exit Select Multiple" : "Select Multiple"}
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto bg-[#fffdf5]">
        {!visibleCount ? (
          <EmptyState message={search.trim() ? "No students match your search." : "No enrolled students found."} />
        ) : (
          <div className="grid items-start gap-3">
            {groups.map(([gender, groupStudents]) => (
              <details key={gender} open className="group overflow-hidden rounded-xl border-2 border-black bg-[#fffdf5] shadow-[4px_4px_0_#000]">
                <summary className="sticky top-0 z-[1] flex cursor-pointer list-none items-center justify-between bg-[#f7e9aa] px-5 py-4 text-base font-black">
                  <span>{gender.toUpperCase()}</span>
                  <span className="flex items-center gap-2">
                    <span className="rounded-full border border-black/30 bg-white px-3 py-0.5 text-[10px]">
                      {groupStudents.length} student{groupStudents.length !== 1 ? "s" : ""}
                    </span>
                    <ChevronDown className="size-4 rotate-180 transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                {!groupStudents.length ? (
                  <p className="p-4 text-center text-xs font-semibold text-black/55">No {gender.toLocaleLowerCase()} students.</p>
                ) : groupStudents.map((student) => (
                  <StudentActionRow
                    key={student.student_id}
                    student={student}
                    currentSectionName={currentSectionName}
                    selected={selectedIds.has(student.student_id)}
                    selectMultiple={selectMultiple}
                    availableSections={availableSections}
                    rowAction={rowAction}
                    onToggleSelected={() => onToggleSelected(student.student_id)}
                    onAction={onAction}
                    onCancelAction={onCancelAction}
                    onConfirmRemove={() => onConfirmRemove(student.student_id)}
                    onConfirmTransfer={(targetClassId) => onConfirmTransfer(student.student_id, targetClassId)}
                  />
                ))}
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function AvailableStudentsPanel({
  academicLevel,
  students,
  totalStudents,
  search,
  onSearch,
  pendingAdditions,
  onAdd,
  onUndo,
}: {
  academicLevel: string;
  students: ClassAssignmentStudent[];
  totalStudents: number;
  search: string;
  onSearch: (value: string) => void;
  pendingAdditions: Set<string>;
  onAdd: (studentId: string) => void;
  onUndo: (studentId: string) => void;
}) {
  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search available students..."
          className="h-10 rounded-md border border-black bg-[#fffdf5] px-3 text-sm md:w-80"
        />
        <span className="text-xs font-bold text-black/65">{totalStudents} available student{totalStudents !== 1 ? "s" : ""}</span>
      </div>
      <div className="rounded-md border border-black bg-[#f7e9aa] p-2 text-xs font-bold">
        Showing {academicLevel} students not yet assigned to any section in the active academic year.
      </div>
      <div className="min-h-0 overflow-y-auto rounded-lg border-2 border-black bg-[#fffdf5] shadow-[4px_4px_0_#000]">
        {!students.length ? (
          <EmptyState message={search.trim() ? "No students match your search." : `No available ${academicLevel} students without a section.`} />
        ) : students.map((student) => {
          const pending = pendingAdditions.has(student.student_id);
          return (
            <div key={student.student_id} className={`flex flex-wrap items-center gap-3 border-b border-black/10 px-4 py-3 last:border-b-0 ${pending ? "bg-[#fff8d7]" : "bg-white"}`}>
              <AvailableAvatar student={student} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{assignmentStudentName(student)}</span>
                <span className="block text-[10px] font-semibold text-black/55">LRN {student.student_lrn}</span>
              </span>
              <span className="rounded-full border border-black/30 bg-white px-2 py-0.5 text-[10px] font-bold">No section</span>
              {pending && <span className="rounded-full border border-black bg-[#d8efca] px-2 py-0.5 text-[10px] font-bold">Pending save</span>}
              <button
                title={pending ? "Undo staged addition" : `Add ${assignmentStudentName(student)}`}
                className={retroButton(pending ? "bg-[#d8efca]" : "bg-[#79bd80]")}
                onClick={() => pending ? onUndo(student.student_id) : onAdd(student.student_id)}
              >
                {pending ? <><Check className="size-3" /> Added</> : <><Plus className="size-3" /> Add</>}
              </button>
            </div>
          );
        })}
      </div>
    </section>
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
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-base font-black">{student.full_name}</span>
          </span>
        </span>
        <button className={retroButton("min-h-12 bg-white px-4 text-base text-black")} onClick={() => onAction({ type: "remove", studentId: student.student_id })}>Remove</button>
        <button className={retroButton("min-h-12 bg-white px-4 text-base")} onClick={() => onAction({ type: "transfer", studentId: student.student_id, targetClassId: "" })}>Transfer</button>
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
    <div className="grid max-h-44 gap-2 overflow-y-auto rounded-md border-2 border-black bg-[#fffdf5] p-2 shadow-[3px_3px_0_#000]">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto font-bold">{selectedCount} Students selected</p>
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

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-0.5 flex items-center gap-2 rounded-t-md border-2 border-b-0 border-black px-3 py-2 text-xs font-black sm:text-sm ${active ? "bg-[#f7e9aa]" : "bg-white text-black/60"}`}
    >
      {children}
    </button>
  );
}

function CountBadge({ count }: { count: number }) {
  return <span className="rounded-full border border-black/30 bg-white px-2 py-0.5 text-[10px] font-bold">{count}</span>;
}

function StatusBanner({ className, children }: { className: string; children: React.ReactNode }) {
  return <div className={`rounded-md border border-black p-2 text-xs font-bold ${className}`}>{children}</div>;
}

function EmptyState({ message }: { message: string }) {
  return <p className="p-6 text-center text-sm font-semibold text-black/60">{message}</p>;
}

function Avatar({ student }: { student: ClassStudentListItem }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full border border-[#d97706] bg-[#f7c76f] text-sm font-semibold text-[#7a3e00]">
      {(student.avatar_initial || student.full_name || "?").charAt(0).toLocaleUpperCase()}
    </span>
  );
}

function AvailableAvatar({ student }: { student: ClassAssignmentStudent }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full border border-[#d97706] bg-[#f7c76f] text-sm font-semibold text-[#7a3e00]">
      {(student.first_name || "?").charAt(0).toLocaleUpperCase()}
    </span>
  );
}

function groupStudents(students: ClassStudentListItem[]) {
  const groups = ["Male", "Female", "Other", "Unspecified"].map(
    (gender) => [gender, students.filter((student) => normalizedGender(student.gender) === gender)] as const
  );
  return groups.filter(([gender, group]) => gender === "Male" || gender === "Female" || group.length > 0);
}

function normalizedGender(gender: string | null | undefined) {
  if (gender === "Female" || gender === "Male" || gender === "Other") return gender;
  return "Unspecified";
}
