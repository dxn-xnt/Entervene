"use client";

import { Check, Plus } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
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
import { Alert } from "@/components/retroui/Alert";
import { Avatar } from "@/components/retroui/Avatar";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Checkbox } from "@/components/retroui/Checkbox";
import { Dialog } from "@/components/retroui/Dialog";
import { Empty } from "@/components/retroui/Empty";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Table } from "@/components/retroui/Table";
import { Tabs, type TabItem } from "@/components/retroui/Tabs";
import { Text } from "@/components/retroui/Text";

type ModalTab = "enrolled" | "available";
type RowAction =
  | { type: "remove"; studentId: string }
  | { type: "transfer"; studentId: string; targetClassId: string };
type BulkAction =
  | { type: "remove" }
  | { type: "transfer"; targetClassId: string }
  | null;

const MODAL_TABS: Array<TabItem<ModalTab>> = [
  { id: "enrolled", label: "Enrolled Students" },
  { id: "available", label: "Unassigned Students" },
];

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
    <Dialog open onOpenChange={(open) => { if (!open) closeModal(); }}>
      <Dialog.Content size="2xl">
        <Dialog.Header>
          <Text as="h5" className="font-sans text-xl font-bold">
            Manage Students - {currentSectionName}
          </Text>
        </Dialog.Header>

        <div className="grid h-[75vh] grid-rows-[auto_1fr] gap-3 p-4 min-h-0 overflow-hidden">
          <header className="grid gap-2">
            <Tabs<ModalTab>
              tabs={MODAL_TABS}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              counts={{
                enrolled: visibleEnrolledStudents.length,
                available: availableStudents.length,
              }}
              className="border-b border-border -mx-4 px-4"
            />
            {!!pendingCount && (
              <Alert status="info" className="p-2">
                <Text as="p" className="text-xs font-bold">
                  {pendingCount} pending change{pendingCount !== 1 ? "s" : ""}. Changes are local until Save Changes.
                </Text>
              </Alert>
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
        </div>

        <Dialog.Footer className="flex flex-col gap-2 w-full">
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
            <Alert status="error" className="flex flex-wrap items-center justify-between gap-2 p-3 w-full">
              <Text as="p" className="text-sm font-bold">
                Discard unsaved changes?
              </Text>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={onClose}>
                  Discard Changes
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDiscardPrompt(false)}>
                  Continue Editing
                </Button>
              </div>
            </Alert>
          )}

          {saveError && (
            <Alert status="error">
              <Alert.Title className="text-xs font-bold">{saveError}</Alert.Title>
            </Alert>
          )}
          {saveSuccess && (
            <Alert status="success">
              <Alert.Title className="text-xs font-bold">{saveSuccess}</Alert.Title>
            </Alert>
          )}

          <div className="flex justify-end gap-2 w-full">
            <Button variant="outline" disabled={saving} onClick={closeModal}>
              Cancel
            </Button>
            <Button disabled={!pendingCount || saving} onClick={saveChanges}>
              Save Changes
            </Button>
          </div>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
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

      <div className="min-h-0 overflow-y-auto rounded-none border-2 border-border bg-card">
        {!totalCount ? (
          <Empty className="p-6 border-0 shadow-none bg-transparent">
            <Empty.Content>
              <Empty.Description className="text-sm font-semibold">
                {search.trim() ? "No students match your search." : "No enrolled students in this section."}
              </Empty.Description>
            </Empty.Content>
          </Empty>
        ) : (
          <Table className="border-none shadow-none" wrapperClassName="overflow-x-auto">
            <Table.Header className="font-sans">
              <Table.Row>
                {selectMultiple && <Table.Head className="w-12 text-center"></Table.Head>}
                <Table.Head>Name</Table.Head>
                <Table.Head className="text-right w-44">Actions</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {groups.map(([gender, group]) => (
                <Fragment key={gender}>
                  <Table.Row className="bg-muted/60 hover:bg-muted/60">
                    <Table.Cell
                      colSpan={selectMultiple ? 3 : 2}
                      className="py-2 px-4 text-xs font-bold uppercase text-muted-foreground"
                    >
                      {gender} ({group.length})
                    </Table.Cell>
                  </Table.Row>
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
                      onConfirmTransfer={(targetClassId) =>
                        onConfirmTransfer(student.student_id, targetClassId)
                      }
                    />
                  ))}
                </Fragment>
              ))}
            </Table.Body>
          </Table>
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
      <div className="min-h-0 overflow-y-auto rounded-none border-2 border-border bg-card">
        {!students.length ? (
          <Empty className="p-6 border-0 shadow-none bg-transparent">
            <Empty.Content>
              <Empty.Description className="text-sm font-semibold">
                {search.trim() ? "No students match your search." : `No available ${academicLevel} students without a section.`}
              </Empty.Description>
            </Empty.Content>
          </Empty>
        ) : (
          students.map((student) => {
            const pending = pendingAdditions.has(student.student_id);
            return (
              <div
                key={student.student_id}
                className={`flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 ${pending ? "bg-primary/10" : "bg-card"
                  }`}
              >
                <Avatar variant="student" className="size-9 shrink-0">
                  <Avatar.Image src="/avatars/student-avatars/1.svg" alt={assignmentStudentName(student)} />
                  <Avatar.Fallback>
                    {(student.first_name || "?").charAt(0).toUpperCase()}
                  </Avatar.Fallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <Text as="p" className="block truncate text-sm font-bold">
                    {assignmentStudentName(student)}
                  </Text>
                  <Text as="p" className="block text-xs font-semibold text-muted-foreground">
                    LRN {student.student_lrn}
                  </Text>
                </span>
                <Badge variant="outline">No section</Badge>
                {pending && <Badge variant="default">Pending save</Badge>}
                <Button
                  size="sm"
                  variant={pending ? "outline" : "default"}
                  onClick={() => (pending ? onUndo(student.student_id) : onAdd(student.student_id))}
                >
                  {pending ? (
                    <>
                      <Check className="size-3 mr-1" /> Added
                    </>
                  ) : (
                    <>
                      <Plus className="size-3 mr-1" /> Add
                    </>
                  )}
                </Button>
              </div>
            );
          })
        )}
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
    <>
      <Table.Row>
        {selectMultiple && (
          <Table.Cell className="w-12 text-center">
            <Checkbox
              checked={selected}
              onCheckedChange={() => onToggleSelected()}
              size="sm"
            />
          </Table.Cell>
        )}
        <Table.Cell>
          <div className="flex items-center gap-3">
            <Avatar variant="student" className="size-9 shrink-0">
              <Avatar.Image src="/avatars/student-avatars/1.svg" alt={student.full_name} />
              <Avatar.Fallback>
                {(student.avatar_initial || student.full_name || "?").charAt(0).toUpperCase()}
              </Avatar.Fallback>
            </Avatar>
            <Text as="p" className="truncate text-base font-semibold text-black">
              {student.full_name}
            </Text>
          </div>
        </Table.Cell>
        <Table.Cell className="text-right">
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => onAction({ type: "remove", studentId: student.student_id })}>
              Remove
            </Button>
            <Button size="sm" variant="outline" onClick={() => onAction({ type: "transfer", studentId: student.student_id, targetClassId: "" })}>
              Transfer
            </Button>
          </div>
        </Table.Cell>
      </Table.Row>
      {isRemoving && (
        <Table.Row className="bg-destructive/5 hover:bg-destructive/5">
          <Table.Cell colSpan={selectMultiple ? 3 : 2} className="p-3">
            <Alert status="error" className="p-3">
              <Alert.Title className="text-xs font-semibold">
                Remove {student.full_name} from {currentSectionName}?
              </Alert.Title>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="secondary" onClick={onConfirmRemove}>
                  Confirm Remove
                </Button>
                <Button size="sm" variant="outline" onClick={onCancelAction}>
                  Cancel
                </Button>
              </div>
            </Alert>
          </Table.Cell>
        </Table.Row>
      )}
      {isTransferring && (
        <Table.Row className="bg-accent/20 hover:bg-accent/20">
          <Table.Cell colSpan={selectMultiple ? 3 : 2} className="p-3">
            <Card className="grid gap-2 p-3 text-sm font-semibold">
              <Text as="p" className="text-sm font-semibold">
                Transfer {student.full_name} to:
              </Text>
              <Select
                value={targetClassId}
                onChange={(e) =>
                  onAction({
                    type: "transfer",
                    studentId: student.student_id,
                    targetClassId: e.target.value,
                  })
                }
              >
                <Select.Trigger className="w-full">
                  <Select.Value placeholder="Select section" />
                </Select.Trigger>
                <Select.Content>
                  <Select.Group>
                    {availableSections.map((section) => (
                      <Select.Item key={section.class_id} value={String(section.class_id)}>
                        {section.section_name}
                      </Select.Item>
                    ))}
                  </Select.Group>
                </Select.Content>
              </Select>
              {target && (
                <Text as="p" className="text-xs font-semibold">
                  Transfer {student.full_name} to {target.section_name}?
                </Text>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={!target}
                  onClick={() => onConfirmTransfer(Number(targetClassId))}
                >
                  Confirm Transfer
                </Button>
                <Button size="sm" variant="outline" onClick={onCancelAction}>
                  Cancel
                </Button>
              </div>
            </Card>
          </Table.Cell>
        </Table.Row>
      )}
    </>
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
    <Card className="grid max-h-44 gap-2 overflow-y-auto p-3 w-full">
      <div className="flex flex-wrap items-center gap-2">
        <Text as="p" className="mr-auto font-bold">
          {selectedCount} Students selected
        </Text>
        <Button size="sm" variant="secondary" onClick={() => onBulkAction({ type: "remove" })}>
          Remove Selected
        </Button>
        <Button size="sm" variant="outline" onClick={() => onBulkAction({ type: "transfer", targetClassId: "" })}>
          Transfer Selected
        </Button>
      </div>
      {bulkAction?.type === "remove" && (
        <Alert status="error" className="p-3">
          <Alert.Title className="text-xs font-semibold">
            Remove {selectedCount} selected Students from {currentSectionName}?
          </Alert.Title>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="secondary" onClick={onConfirmRemove}>
              Confirm Remove
            </Button>
            <Button size="sm" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </Alert>
      )}
      {bulkAction?.type === "transfer" && (
        <div className="grid gap-2 rounded border border-border p-3 text-xs font-semibold">
          <Text as="p" className="text-xs font-semibold">
            Transfer {selectedCount} selected Students to:
          </Text>
          <Select
            value={targetClassId}
            onChange={(e) => onBulkAction({ type: "transfer", targetClassId: e.target.value })}
          >
            <Select.Trigger className="w-full">
              <Select.Value placeholder="Select section" />
            </Select.Trigger>
            <Select.Content>
              <Select.Group>
                {availableSections.map((section) => (
                  <Select.Item key={section.class_id} value={String(section.class_id)}>
                    {section.section_name}
                  </Select.Item>
                ))}
              </Select.Group>
            </Select.Content>
          </Select>
          {target && (
            <Text as="p" className="text-xs font-semibold">
              Transfer {selectedCount} selected Students to {target.section_name}?
            </Text>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!target}
              onClick={() => onConfirmTransfer(Number(targetClassId))}
            >
              Confirm Transfer
            </Button>
            <Button size="sm" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
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
