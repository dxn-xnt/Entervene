"use client";

import { Check, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  ClassAssignmentStudent,
  ClassStudentListItem,
  ClassTransferOption,
  PendingStudentAddition,
  PendingStudentRemoval,
  PendingStudentTransfer,
  UpdateClassStudentListRequest,
} from "@/types/adminClasses";
import { assignmentStudentName, matchesStudentSearch, sortAssignmentStudents } from "@/components/admin/classes/assignment/studentSorting";
import ModalShell from "./modal-shell";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import { Text } from "@/components/retroui/Text";
import { Dialog } from "@/components/retroui/Dialog";

type ModalTab = "enrolled" | "available";
type RowAction =
  | { type: "remove"; studentId: string }
  | { type: "transfer"; studentId: string; targetClassId: string };
type BulkAction =
  | { type: "remove" }
  | { type: "transfer"; targetClassId: string }
  | null;

export default function EditStudentList({
  currentSectionId: _currentSectionId,
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
      studentIds.forEach((id) => next.add(id));
      return next;
    });
    setPendingTransfers((current) => {
      const next = new Map(current);
      studentIds.forEach((id) => next.delete(id));
      return next;
    });
    setSelectedIds((current) => {
      const next = new Set(current);
      studentIds.forEach((id) => next.delete(id));
      return next;
    });
    setRowAction(null);
    setBulkAction(null);
    clearMessages();
  }

  function stageTransfer(studentIds: string[], targetClassId: number) {
    setPendingTransfers((current) => {
      const next = new Map(current);
      studentIds.forEach((id) => next.set(id, targetClassId));
      return next;
    });
    setPendingRemovals((current) => {
      const next = new Set(current);
      studentIds.forEach((id) => next.delete(id));
      return next;
    });
    setSelectedIds((current) => {
      const next = new Set(current);
      studentIds.forEach((id) => next.delete(id));
      return next;
    });
    setRowAction(null);
    setBulkAction(null);
    clearMessages();
  }

  function clearMessages() {
    setSaveError("");
    setSaveSuccess("");
    setDiscardPrompt(false);
  }

  function closeModal() {
    if (pendingCount && !discardPrompt) {
      setDiscardPrompt(true);
      return;
    }
    onClose();
  }

  async function saveChanges() {
    if (!pendingCount || saving) return;
    setSaving(true);
    clearMessages();

    const additions: PendingStudentAddition[] = Array.from(pendingAdditions).map((student_id) => ({
      student_id,
    }));
    const removals: PendingStudentRemoval[] = Array.from(pendingRemovals).map((student_id) => ({
      student_id,
    }));
    const transfers: PendingStudentTransfer[] = Array.from(pendingTransfers.entries()).map(
      ([student_id, target_class_id]) => ({
        student_id,
        target_class_id,
      })
    );

    const payload: UpdateClassStudentListRequest = {};
    if (additions.length) payload.additions = additions;
    if (removals.length) payload.removals = removals;
    if (transfers.length) payload.transfers = transfers;

    try {
      await onSaveChanges(payload);
      setSaveSuccess("Student list updated successfully.");
      setPendingAdditions(new Set());
      setPendingRemovals(new Set());
      setPendingTransfers(new Map());
    } catch (error: unknown) {
      setSaveError(error instanceof Error ? error.message : "Unable to save student list changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={`Manage Students - ${currentSectionName}`} wide onClose={closeModal}>
      <div className="grid h-[75vh] grid-rows-[auto_1fr_auto] gap-3">
        <header className="grid gap-2">
          <div className="flex border-b border-border">
            <TabButton active={activeTab === "enrolled"} onClick={() => setActiveTab("enrolled")}>
              Enrolled Students <CountBadge count={visibleEnrolledStudents.length} />
            </TabButton>
            <TabButton active={activeTab === "available"} onClick={() => setActiveTab("available")}>
              Available Students <CountBadge count={availableStudents.length} />
            </TabButton>
          </div>
          {!!pendingCount && (
            <Card className="bg-primary/10 border-primary p-2 text-xs font-bold text-primary">
              {pendingCount} pending change{pendingCount !== 1 ? "s" : ""}. Changes are local until Save Changes.
            </Card>
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

        <Dialog.Footer className="px-0 border-t-0 pt-2 flex flex-col gap-2 w-full">
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
            <Card className="flex flex-wrap items-center justify-between gap-2 border-destructive bg-destructive/10 p-2 text-sm font-bold text-destructive w-full">
              <span>Discard unsaved changes?</span>
              <span className="flex gap-2">
                <Button size="sm" variant={"secondary"} onClick={onClose}>Discard Changes</Button>
                <Button size="sm" variant={"outline"} onClick={() => setDiscardPrompt(false)}>Continue Editing</Button>
              </span>
            </Card>
          )}

          {saveError && <StatusBanner className="border-destructive bg-destructive/10 text-destructive">{saveError}</StatusBanner>}
          {saveSuccess && <StatusBanner className="bg-primary/10 border-primary text-primary">{saveSuccess}</StatusBanner>}

          <div className="flex justify-end gap-2 w-full">
            <Button variant={"outline"} disabled={saving} onClick={closeModal}>Cancel</Button>
            <Button
              disabled={!pendingCount || saving}
              onClick={saveChanges}
            >
              {saving ? "Saving changes..." : `Save Changes${pendingCount ? ` (+${pendingCount})` : ""}`}
            </Button>
          </div>
        </Dialog.Footer>
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
  groups: Array<readonly [string, ClassStudentListItem[]]>;
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
  const totalCount = groups.reduce((acc, [, list]) => acc + list.length, 0);

  return (
    <section className="grid h-full grid-rows-[auto_1fr] gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search enrolled students..."
          className="max-w-xs h-9"
        />
        <Button
          variant={selectMultiple ? "default" : "outline"}
          size="sm"
          onClick={onToggleSelectMultiple}
        >
          {selectMultiple ? "Cancel Selection" : "Select Multiple"}
        </Button>
      </div>

      <div className="min-h-0 overflow-y-auto rounded-lg border-2 border-border bg-card">
        {!totalCount ? (
          <EmptyState message={search.trim() ? "No students match your search." : "No enrolled students in this section."} />
        ) : (
          groups.map(([gender, group]) => (
            <div key={gender}>
              <div className="sticky top-0 z-10 border-b border-border bg-muted/60 px-4 py-2 text-xs font-bold uppercase text-muted-foreground">
                {gender} ({group.length})
              </div>
              {group.map((student) => (
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
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function AvailableStudentsPanel({
  academicLevel,
  students,
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
    <section className="grid h-full grid-rows-[auto_auto_1fr] gap-2">
      <Input
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder="Search available students..."
        className="max-w-xs h-9"
      />
      <div className="rounded-md border border-border bg-muted/40 p-2 text-xs font-bold text-muted-foreground">
        Showing {academicLevel} students not yet assigned to any section in the active academic year.
      </div>
      <div className="min-h-0 overflow-y-auto rounded-lg border-2 border-border bg-card">
        {!students.length ? (
          <EmptyState message={search.trim() ? "No students match your search." : `No available ${academicLevel} students without a section.`} />
        ) : students.map((student) => {
          const pending = pendingAdditions.has(student.student_id);
          return (
            <div key={student.student_id} className={`flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 ${pending ? "bg-primary/10" : "bg-card"}`}>
              <AvailableAvatar student={student} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{assignmentStudentName(student)}</span>
                <span className="block text-[10px] font-semibold text-muted-foreground">LRN {student.student_lrn}</span>
              </span>
              <Badge variant={"outline"}>No section</Badge>
              {pending && <Badge variant={"default"}>Pending save</Badge>}
              <Button
                size="sm"
                variant={pending ? "outline" : "default"}
                onClick={() => pending ? onUndo(student.student_id) : onAdd(student.student_id)}
              >
                {pending ? <><Check className="size-3 mr-1" /> Added</> : <><Plus className="size-3 mr-1" /> Add</>}
              </Button>
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
    <div className="border-b border-border bg-card px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-3">
        {selectMultiple && <input type="checkbox" checked={selected} onChange={onToggleSelected} />}
        <Avatar student={student} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-base font-bold">{student.full_name}</span>
          </span>
        </span>
        <Button size="sm" variant={"outline"} onClick={() => onAction({ type: "remove", studentId: student.student_id })}>Remove</Button>
        <Button size="sm" variant={"outline"} onClick={() => onAction({ type: "transfer", studentId: student.student_id, targetClassId: "" })}>Transfer</Button>
      </div>
      {isRemoving && (
        <Card className="mt-2 border-destructive bg-destructive/10 p-2 text-xs font-semibold text-destructive">
          <p>Remove {student.full_name} from {currentSectionName}?</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant={"secondary"} onClick={onConfirmRemove}>Confirm Remove</Button>
            <Button size="sm" variant={"outline"} onClick={onCancelAction}>Cancel</Button>
          </div>
        </Card>
      )}
      {isTransferring && (
        <Card className="mt-2 grid gap-2 p-2 text-xs font-semibold">
          <span>Transfer {student.full_name} to:</span>
          <Select value={targetClassId} onChange={(e) => onAction({ type: "transfer", studentId: student.student_id, targetClassId: e.target.value })}>
            <Select.Trigger className="w-full">
              <Select.Value placeholder="Select section" />
            </Select.Trigger>
            <Select.Content>
              <Select.Group>
                {availableSections.map((section) => (
                  <Select.Item key={section.class_id} value={String(section.class_id)}>{section.section_name}</Select.Item>
                ))}
              </Select.Group>
            </Select.Content>
          </Select>
          {target && <p>Transfer {student.full_name} to {target.section_name}?</p>}
          <div className="flex gap-2">
            <Button size="sm" disabled={!target} onClick={() => onConfirmTransfer(Number(targetClassId))}>Confirm Transfer</Button>
            <Button size="sm" variant={"outline"} onClick={onCancelAction}>Cancel</Button>
          </div>
        </Card>
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
    <Card className="grid max-h-44 gap-2 overflow-y-auto p-2 w-full">
      <div className="flex flex-wrap items-center gap-2">
        <Text as="p" className="mr-auto font-bold">{selectedCount} Students selected</Text>
        <Button size="sm" variant={"secondary"} onClick={() => onBulkAction({ type: "remove" })}>Remove Selected</Button>
        <Button size="sm" variant={"outline"} onClick={() => onBulkAction({ type: "transfer", targetClassId: "" })}>Transfer Selected</Button>
      </div>
      {bulkAction?.type === "remove" && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-2 text-xs font-semibold text-destructive">
          <p>Remove {selectedCount} selected Students from {currentSectionName}?</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant={"secondary"} onClick={onConfirmRemove}>Confirm Remove</Button>
            <Button size="sm" variant={"outline"} onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      )}
      {bulkAction?.type === "transfer" && (
        <div className="grid gap-2 rounded-md border border-border p-2 text-xs font-semibold">
          <span>Transfer {selectedCount} selected Students to:</span>
          <Select value={targetClassId} onChange={(e) => onBulkAction({ type: "transfer", targetClassId: e.target.value })}>
            <Select.Trigger className="w-full">
              <Select.Value placeholder="Select section" />
            </Select.Trigger>
            <Select.Content>
              <Select.Group>
                {availableSections.map((section) => <Select.Item key={section.class_id} value={String(section.class_id)}>{section.section_name}</Select.Item>)}
              </Select.Group>
            </Select.Content>
          </Select>
          {target && <p>Transfer {selectedCount} selected Students to {target.section_name}?</p>}
          <div className="flex gap-2">
            <Button size="sm" disabled={!target} onClick={() => onConfirmTransfer(Number(targetClassId))}>Confirm Transfer</Button>
            <Button size="sm" variant={"outline"} onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-0.5 flex items-center gap-2 rounded-t-md border-b-2 px-3 py-2 text-xs font-bold sm:text-sm ${active ? "border-primary text-primary bg-primary/10" : "border-transparent text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

function CountBadge({ count }: { count: number }) {
  return <Badge variant={"outline"} className="px-2 py-0.5 text-[10px]">{count}</Badge>;
}

function StatusBanner({ className, children }: { className: string; children: React.ReactNode }) {
  return <div className={`rounded-md border p-2 text-xs font-bold ${className}`}>{children}</div>;
}

function EmptyState({ message }: { message: string }) {
  return <p className="p-6 text-center text-sm font-semibold text-muted-foreground">{message}</p>;
}

function Avatar({ student }: { student: ClassStudentListItem }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/20 text-sm font-bold text-primary">
      {(student.avatar_initial || student.full_name || "?").charAt(0).toLocaleUpperCase()}
    </span>
  );
}

function AvailableAvatar({ student }: { student: ClassAssignmentStudent }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/20 text-sm font-bold text-primary">
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
