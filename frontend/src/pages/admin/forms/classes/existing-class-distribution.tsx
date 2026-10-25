import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { useState } from "react";
import { commitExistingClassDistribution, previewExistingClassDistribution } from "@/lib/api";
import type { ClassTransferOption, ExistingClassDistributionPreview } from "@/types/adminClasses";
import { Alert } from "@/components/retroui/Alert";
import { AdminValidationAlert } from "@/components/admin/AdminValidationAlert";
import { Button } from "@/components/admin/button";
import { Dialog } from "@/components/retroui/Dialog";
import { Text } from "@/components/retroui/Text";

type PreviewAssignment = ExistingClassDistributionPreview["assignments"][number];

function assignmentGender(gender: string | null): "Male" | "Female" | "Unspecified" {
  const value = gender?.trim().toLowerCase();
  if (value === "male" || value === "m" || value === "boy") return "Male";
  if (value === "female" || value === "f" || value === "girl") return "Female";
  return "Unspecified";
}

function groupedAssignments(assignments: PreviewAssignment[]) {
  return (["Male", "Female", "Unspecified"] as const)
    .map((gender) => ({
      gender,
      students: assignments
        .filter((student) => assignmentGender(student.gender) === gender)
        .sort((left, right) =>
          (right.gwa ?? 0) - (left.gwa ?? 0)
          || left.student_name.localeCompare(right.student_name)
          || left.student_id.localeCompare(right.student_id)
        ),
    }))
    .filter((group) => group.students.length > 0);
}

function projectedClasses(preview: ExistingClassDistributionPreview, assignments: PreviewAssignment[]) {
  return preview.classes.map((section) => {
    const original = preview.assignments.filter((item) => item.class_id === section.class_id);
    const current = assignments.filter((item) => item.class_id === section.class_id);
    const originalGender = (gender: string) => original.filter((item) => assignmentGender(item.gender) === gender).length;
    const currentGender = (gender: string) => current.filter((item) => assignmentGender(item.gender) === gender).length;
    const finalCount = section.existing_count + current.length;
    const originalScore = original.reduce((sum, item) => sum + (item.gwa ?? 0), 0);
    const currentScore = current.reduce((sum, item) => sum + (item.gwa ?? 0), 0);
    let averageGwa: number | null = null;
    if (preview.mode === "gwa" && finalCount > 0) {
      if (section.existing_count === 0) {
        averageGwa = current.length > 0 ? Math.round((currentScore / current.length) * 100) / 100 : null;
      } else if (section.average_gwa != null) {
        const originalExistingScore = section.average_gwa * section.final_count - originalScore;
        const newTotalScore = originalExistingScore + currentScore;
        averageGwa = Math.round((newTotalScore / finalCount) * 100) / 100;
      }
    }
    return {
      ...section,
      to_add_count: current.length,
      final_count: finalCount,
      male_count: section.male_count - originalGender("Male") + currentGender("Male"),
      female_count: section.female_count - originalGender("Female") + currentGender("Female"),
      unspecified_count: section.unspecified_count - originalGender("Unspecified") + currentGender("Unspecified"),
      average_gwa: averageGwa,
    };
  });
}

function AssignmentRow({ item }: { item: PreviewAssignment }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `assignment:${item.student_id}`,
    data: { studentId: item.student_id },
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
      className={`group relative flex items-center justify-between gap-2.5 rounded border px-3 py-2 text-xs select-none transition-all ${
        isDragging
          ? "z-30 opacity-30 border-dashed border-2 border-primary bg-muted/60 scale-95"
          : "border-border/80 bg-background hover:border-black hover:bg-[#fffdf0] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5"
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <button
          type="button"
          aria-label={`Drag ${item.student_name}`}
          className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded bg-muted/80 text-muted-foreground touch-none transition-colors group-hover:bg-[#ffe038] group-hover:text-black active:cursor-grabbing"
          title={`Drag ${item.student_name} to reassign`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
        <span className="min-w-0 flex-1 break-words font-semibold text-foreground">{item.student_name}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {item.gwa != null && (
          <span className="rounded border border-black/20 bg-muted/50 px-2 py-0.5 text-[11px] font-bold text-foreground">
            GWA {item.gwa}
          </span>
        )}
        <span className="hidden text-[10px] font-bold text-muted-foreground group-hover:inline-block">
          Drag
        </span>
      </div>
    </li>
  );
}

function AssignmentSection({
  section,
  assignments,
  isDraggingAny,
}: {
  section: ExistingClassDistributionPreview["classes"][number];
  assignments: PreviewAssignment[];
  isDraggingAny: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `section:${section.class_id}`,
    data: { classId: section.class_id },
  });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${section.section_name} assignments`}
      className={`min-w-0 rounded-lg border-2 flex flex-col transition-all ${
        isOver
          ? "border-black bg-[#dcfce7] ring-4 ring-emerald-500/30 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
          : isDraggingAny
          ? "border-dashed border-primary/70 bg-card/90"
          : "border-border bg-card shadow-sm"
      }`}
    >
      <h5 className="border-b-2 border-border bg-[#ffe038] px-3.5 py-2.5 font-bold flex items-center justify-between text-black">
        <span className="text-base">{section.section_name}</span>
        <span className="rounded bg-black/10 px-2 py-0.5 text-xs font-semibold">
          {assignments.length} to add
        </span>
      </h5>
      {isOver && (
        <div className="m-2 rounded-md border-2 border-dashed border-emerald-600 bg-emerald-100 p-2 text-center text-xs font-bold text-emerald-900 animate-pulse">
          Drop here to assign to {section.section_name}
        </div>
      )}
      <div className="flex-1 p-2 space-y-3">
        {assignments.length ? (
          groupedAssignments(assignments).map(({ gender, students }) => (
            <div key={gender} className="space-y-1.5">
              <h6 className="bg-muted/60 px-3 py-1 text-xs font-bold uppercase text-muted-foreground rounded">
                {gender} ({students.length})
              </h6>
              <ul className="space-y-1.5">
                {students.map((item) => (
                  <AssignmentRow key={item.student_id} item={item} />
                ))}
              </ul>
            </div>
          ))
        ) : (
          <div className="flex h-32 flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/20 p-4 text-center">
            <p className="text-xs font-bold text-foreground">Section is empty</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Drop students here to assign them to {section.section_name}
            </p>
          </div>
        )}
      </div>
      <div
        className={`border-t border-dashed px-3 py-1.5 text-center text-[10px] font-medium transition-colors ${
          isOver
            ? "border-emerald-600 bg-emerald-100/60 text-emerald-950 font-bold"
            : "border-border/60 bg-muted/20 text-muted-foreground"
        }`}
      >
        {isOver ? `Release to place student in ${section.section_name}` : `Drop zone for ${section.section_name}`}
      </div>
    </section>
  );
}

export default function ExistingClassDistribution({
  sourceClassId, sourceSectionName, academicYear, academicLevel, requiresPathway,
  otherClasses, initialAvailableCount, onClose, onCommitted,
}: {
  sourceClassId: number;
  sourceSectionName: string;
  academicYear: string;
  academicLevel: string;
  requiresPathway: boolean;
  otherClasses: ClassTransferOption[];
  initialAvailableCount: number;
  onClose: () => void;
  onCommitted: () => Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set([sourceClassId, ...otherClasses.map((item) => item.class_id)]));
  const [mode, setMode] = useState<"alphabetical" | "gwa">("alphabetical");
  const [preview, setPreview] = useState<ExistingClassDistributionPreview | null>(null);
  const [draftAssignments, setDraftAssignments] = useState<PreviewAssignment[]>([]);
  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const classRows = preview ? projectedClasses(preview, draftAssignments) : [];
  const finalCounts = classRows.map((item) => item.final_count);
  const imbalance = finalCounts.length ? Math.max(...finalCounts) - Math.min(...finalCounts) : 0;
  const customCount = preview?.assignments.filter((item) =>
    draftAssignments.find((draft) => draft.student_id === item.student_id)?.class_id !== item.class_id
  ).length ?? 0;

  function moveAssignment(studentId: string, classId: number) {
    if (!preview?.classes.some((item) => item.class_id === classId)) return;
    setDraftAssignments((current) => current.map((item) => item.student_id === studentId ? { ...item, class_id: classId } : item));
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveStudentId((event.active.data.current?.studentId as string) ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveStudentId(null);
    const studentId = event.active.data.current?.studentId as string | undefined;
    const classId = event.over?.data.current?.classId as number | undefined;
    if (studentId && classId != null) moveAssignment(studentId, classId);
  }

  function handleDragCancel() {
    setActiveStudentId(null);
  }

  const activeStudent = activeStudentId
    ? draftAssignments.find((item) => item.student_id === activeStudentId)
    : null;

  function toggleClass(classId: number) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(classId)) next.delete(classId);
      else next.add(classId);
      return next;
    });
    setPreview(null);
    setDraftAssignments([]);
    setError("");
  }

  async function calculate() {
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const nextPreview = await previewExistingClassDistribution(sourceClassId, [...selectedIds], mode);
      setPreview(nextPreview);
      setDraftAssignments(nextPreview.assignments);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Unable to calculate distribution.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview || busy) return;
    setBusy(true);
    setError("");
    try {
      await commitExistingClassDistribution(sourceClassId, preview, draftAssignments.map(({ student_id, class_id }) => ({ student_id, class_id })));
      await onCommitted();
    } catch (cause: unknown) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "Unable to save distribution. Recalculate the preview.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <Dialog.Content size="2xl">
        <Dialog.Header><Text as="h5" className="text-xl font-bold">Distribute Students Evenly</Text></Dialog.Header>
        <div className="grid max-h-[70vh] gap-4 overflow-y-auto p-4 text-sm">
          <p><b>Academic Year:</b> {academicYear} <span className="mx-2">•</span> <b>Grade:</b> {academicLevel}</p>
          <p>Unassigned students available when opened: {initialAvailableCount}. Preview checks the live, complete grade-level pool.</p>
          <AdminValidationAlert message={error} />
          {requiresPathway ? (
            <Alert status="info">Automatic distribution is unavailable for this pathway-based grade because student pathway assignments are not recorded.</Alert>
          ) : otherClasses.length === 0 ? (
            <Alert status="info">Create another eligible class for this academic year and grade before distributing students evenly.</Alert>
          ) : (
            <>
              <fieldset className="grid gap-2 rounded border-2 border-border p-3">
                <legend className="px-1 font-bold">Existing classes to include</legend>
                <label className="flex items-center gap-2"><input type="checkbox" checked disabled />{sourceSectionName} (current class)</label>
                {otherClasses.map((item) => (
                  <label key={item.class_id} className="flex items-center gap-2">
                    <input type="checkbox" checked={selectedIds.has(item.class_id)} onChange={() => toggleClass(item.class_id)} />
                    {item.section_name}
                  </label>
                ))}
              </fieldset>
              <fieldset className="grid gap-2 rounded border-2 border-border p-3">
                <legend className="px-1 font-bold">Distribution method</legend>
                <label className="flex items-center gap-2"><input type="radio" name="existing-distribution-mode" checked={mode === "alphabetical"} onChange={() => { setMode("alphabetical"); setPreview(null); setError(""); }} />Balance alphabetically and by gender</label>
                <label className="flex items-center gap-2"><input type="radio" name="existing-distribution-mode" checked={mode === "gwa"} onChange={() => { setMode("gwa"); setPreview(null); setError(""); }} />Balance by prior academic performance (GWA)</label>
              </fieldset>
              <Button variant="outline" disabled={busy || selectedIds.size < 2} onClick={() => void calculate()}>{busy ? "Working..." : "Preview Distribution"}</Button>
              {selectedIds.size < 2 && <p className="text-sm text-muted-foreground">Choose at least one other class.</p>}
              {preview && (
                <section className="grid gap-3" aria-label="Distribution preview">
                  <div><h3 className="font-bold">Proposed assignments</h3><p>{preview.unassigned_count} eligible unassigned students. No changes have been saved.</p></div>
                  <div className="overflow-x-auto rounded border-2 border-border">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-[#ffe038]"><tr><th className="p-2">Class</th><th className="p-2">Existing</th><th className="p-2">To add</th><th className="p-2">Final</th><th className="p-2">M / F / U</th>{preview.mode === "gwa" && <th className="p-2">Avg. GWA</th>}</tr></thead>
                      <tbody>{classRows.map((item) => <tr key={item.class_id} className="border-t border-border"><th className="p-2">{item.section_name}</th><td className="p-2">{item.existing_count}</td><td className="p-2">{item.to_add_count}</td><td className="p-2">{item.final_count}</td><td className="p-2">{item.male_count} / {item.female_count} / {item.unspecified_count}</td>{preview.mode === "gwa" && <td className="p-2">{item.average_gwa ?? "—"}</td>}</tr>)}</tbody>
                    </table>
                  </div>
                  {imbalance > 1 && <Alert status="info">Existing rosters limit exact balance. Current assignments will remain in place.</Alert>}
                  {customCount > 0 && (
                    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>{customCount} manual {customCount === 1 ? "adjustment" : "adjustments"} made to proposed distribution.</span>
                      <button
                        type="button"
                        className="cursor-pointer font-semibold text-primary underline hover:text-primary-hover"
                        onClick={() => setDraftAssignments(preview.assignments)}
                      >
                        Reset to suggested distribution
                      </button>
                    </div>
                  )}
                  <div className="grid gap-3">
                    <div className="space-y-1 text-sm text-muted-foreground">
                        <p>
                          Drag and drop students between sections to customize proposed assignments.
                        </p>
                        <p>
                          Click and hold any student card to drag them into another section. Section student counts and GWA summaries update automatically in real-time.
                        </p>
                    </div>
                    <DndContext
                      sensors={sensors}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      onDragCancel={handleDragCancel}
                    >
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {classRows.map((classItem) => {
                          const sectionAssignments = draftAssignments.filter((item) => item.class_id === classItem.class_id);
                          return (
                            <AssignmentSection
                              key={classItem.class_id}
                              section={classItem}
                              assignments={sectionAssignments}
                              isDraggingAny={Boolean(activeStudentId)}
                            />
                          );
                        })}
                      </div>
                      <DragOverlay dropAnimation={{ duration: 150, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
                        {activeStudent ? (
                          <div className="flex items-center justify-between gap-3 rounded-lg border-2 border-black bg-[#ffe038] px-3.5 py-2.5 text-xs font-bold text-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] rotate-1 scale-105 cursor-grabbing z-50 select-none">
                            <div className="flex items-center gap-2">
                              <span className="flex size-5 items-center justify-center rounded bg-black text-[#ffe038]">
                                <GripVertical className="size-3.5" />
                              </span>
                              <span className="font-bold">{activeStudent.student_name}</span>
                            </div>
                            {activeStudent.gwa != null && (
                              <span className="rounded bg-black px-2 py-0.5 text-[11px] text-white">
                                GWA {activeStudent.gwa}
                              </span>
                            )}
                          </div>
                        ) : null}
                      </DragOverlay>
                    </DndContext>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
        <Dialog.Footer>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          {preview && <Button disabled={busy || !draftAssignments.length} onClick={() => void confirm()}>{busy ? "Saving..." : `Confirm and Assign ${draftAssignments.length}`}</Button>}
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
