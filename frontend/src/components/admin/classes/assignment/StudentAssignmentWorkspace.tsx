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
import { ExternalLink, GripVertical, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { distributeClassStudents, getUnassignedClassStudents } from "@/lib/api";
import type {
  ClassAssignmentStudent,
  DistributionMode,
  ManualAssignmentWorkspaceState,
  ManualClassSetup,
  ManualSectionDraft,
} from "@/types/adminClasses";
import { Alert } from "@/components/retroui/Alert";
import { AdminValidationAlert } from "@/components/admin/AdminValidationAlert";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import { Checkbox } from "@/components/retroui/Checkbox";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { EmptyStateCard } from "@/pages/admin/subjects/components/empty-state-card";
import { sortAssignmentStudents } from "./studentSorting";

type PreviewAssignment = {
  student_id: string;
  localId: string;
  student_name: string;
  gender: string | null;
  gwa: number | null;
};

type SectionRow = {
  localId: string;
  sectionName: string;
  existingCount: number;
  toAddCount: number;
  finalCount: number;
  maleCount: number;
  femaleCount: number;
  unspecifiedCount: number;
  averageGwa: number | null;
};

function assignmentGender(
  gender: string | null,
): "Male" | "Female" | "Unspecified" {
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
        .sort(
          (left, right) =>
            (right.gwa ?? 0) - (left.gwa ?? 0) ||
            left.student_name.localeCompare(right.student_name) ||
            left.student_id.localeCompare(right.student_id),
        ),
    }))
    .filter((group) => group.students.length > 0);
}

function computeSectionRows(
  sections: ManualSectionDraft[],
  selectedSectionIds: Set<string>,
  draftAssignments: PreviewAssignment[],
  mode: DistributionMode,
): SectionRow[] {
  return sections
    .filter((sec) => selectedSectionIds.has(sec.localId))
    .map((section) => {
      const assigned = draftAssignments.filter(
        (item) => item.localId === section.localId,
      );
      const maleCount = assigned.filter(
        (item) => assignmentGender(item.gender) === "Male",
      ).length;
      const femaleCount = assigned.filter(
        (item) => assignmentGender(item.gender) === "Female",
      ).length;
      const unspecifiedCount = assigned.filter(
        (item) => assignmentGender(item.gender) === "Unspecified",
      ).length;
      const existingCount = 0;
      const toAddCount = assigned.length;
      const finalCount = existingCount + toAddCount;
      let averageGwa: number | null = null;
      if (mode === "gwa" && assigned.length > 0) {
        const withGwa = assigned.filter((item) => item.gwa != null);
        if (withGwa.length > 0) {
          const sum = withGwa.reduce((acc, curr) => acc + (curr.gwa ?? 0), 0);
          averageGwa = Math.round((sum / withGwa.length) * 100) / 100;
        }
      }
      return {
        localId: section.localId,
        sectionName: section.sectionName,
        existingCount,
        toAddCount,
        finalCount,
        maleCount,
        femaleCount,
        unspecifiedCount,
        averageGwa,
      };
    });
}

function AssignmentRow({ item }: { item: PreviewAssignment }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `assignment:${item.student_id}`,
      data: { studentId: item.student_id },
    });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
      }}
      className={`group relative flex items-center justify-between gap-2.5 rounded! border px-3 py-2 text-sm select-none transition-all ${
        isDragging
          ? "z-30 opacity-30 border-dashed border-2 border-primary bg-muted/60 scale-95"
          : "border-border/80 bg-background hover:border-black hover:bg-accent hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5"
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <button
          type="button"
          aria-label={`Drag ${item.student_name}`}
          className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded! bg-muted/80 text-muted-foreground touch-none transition-colors group-hover:bg-primary group-hover:text-black active:cursor-grabbing"
          title={`Drag ${item.student_name} to reassign`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
        <span className="min-w-0 flex-1 break-words font-semibold text-foreground">
          {item.student_name}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {item.gwa != null && (
          <span className="rounded border border-black/20 bg-muted/50 px-2 py-0.5 text-sm font-bold text-foreground">
            GWA {item.gwa}
          </span>
        )}
        <span className="hidden text-sm font-bold text-muted-foreground group-hover:inline-block">
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
  section: SectionRow;
  assignments: PreviewAssignment[];
  isDraggingAny: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `section:${section.localId}`,
    data: { localId: section.localId },
  });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${section.sectionName} assignments`}
      className={`min-w-0 rounded! border-2 overflow-hidden flex flex-col transition-all ${
        isOver
          ? "border-black bg-[#dcfce7] ring-4 ring-emerald-500/30 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
          : isDraggingAny
            ? "border-dashed border-primary/70 bg-card/90"
            : "border-border bg-card shadow-none"
      }`}
    >
      <h5 className="border-b-2 border-border bg-primary px-3.5 py-2.5 font-bold flex items-center justify-between text-black">
        <span className="text-base">{section.sectionName}</span>
        <Badge size="sm" variant="outline">
          {assignments.length} to add
        </Badge>
      </h5>
      {isOver && (
        <div className="m-2 rounded-md border-2 border-dashed border-emerald-600 bg-emerald-100 p-2 text-center text-sm font-bold text-emerald-900 animate-pulse">
          Drop here to assign to {section.sectionName}
        </div>
      )}
      <div className="flex-1 p-2 space-y-3">
        {assignments.length ? (
          groupedAssignments(assignments).map(({ gender, students }) => (
            <div key={gender} className="space-y-1.5">
              <h6 className="bg-muted/60 px-3 py-1 text-sm font-semibold text-foreground rounded!">
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
          <EmptyStateCard
            compact
            icon={<Users />}
            title="Section is empty"
            description={`Drop students here to assign them to ${section.sectionName}.`}
          />
        )}
      </div>
      <div
        className={`border-t border-dashed px-3 py-1.5 text-center text-sm font-medium transition-colors ${
          isOver
            ? "border-emerald-600 bg-emerald-100/60 text-emerald-950 font-bold"
            : "border-border/60 bg-muted/20 text-muted-foreground"
        }`}
      >
        {isOver
          ? `Release to place student in ${section.sectionName}`
          : `Drop zone for ${section.sectionName}`}
      </div>
    </section>
  );
}

export default function StudentAssignmentWorkspace({
  setup,
  state,
  resetWarning,
  onChange,
  onBack,
  onReview,
  onClose,
}: {
  setup: ManualClassSetup;
  state: ManualAssignmentWorkspaceState | null;
  resetWarning: string;
  onChange: (state: ManualAssignmentWorkspaceState) => void;
  onBack: () => void;
  onReview: () => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(
    !state || state.academicLevelId !== setup.academicLevelId,
  );
  const [loadError, setLoadError] = useState("");
  const [rawStudents, setRawStudents] = useState<ClassAssignmentStudent[]>([]);
  const [selectedSectionIds, setSelectedSectionIds] = useState<Set<string>>(
    () => new Set(setup.sections.map((s) => s.localId)),
  );
  const [mode, setMode] = useState<DistributionMode>("alphabetical");
  const [suggestedAssignments, setSuggestedAssignments] = useState<
    PreviewAssignment[]
  >([]);
  const [draftAssignments, setDraftAssignments] = useState<PreviewAssignment[]>(
    [],
  );
  const [previewCalculated, setPreviewCalculated] = useState(false);
  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [distributeError, setDistributeError] = useState("");

  const gradeLevel =
    parseInt(setup.academicLevelName.replace(/\D/g, ""), 10) || 7;
  const requiresPathway = gradeLevel >= 11;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const initialCalculatedRef = useRef(false);

  // Load available students
  useEffect(() => {
    let cancelled = false;

    // If state already has loaded students for this level, gather all students from state
    if (state && state.academicLevelId === setup.academicLevelId) {
      const allExisting: ClassAssignmentStudent[] = [
        ...state.unassignedStudents,
        ...Object.values(state.assignmentsBySection).flat(),
      ];
      const unique = Array.from(
        new Map(allExisting.map((s) => [s.student_id, s])).values(),
      );
      setRawStudents(unique);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError("");
    getUnassignedClassStudents(
      setup.academicLevelId,
      undefined,
      setup.academicYear.academic_year_id,
    )
      .then((data) => {
        if (cancelled) return;
        const sorted = sortAssignmentStudents(data.students);
        setRawStudents(sorted);
        onChange({
          academicLevelId: setup.academicLevelId,
          unassignedStudents: sorted,
          assignmentsBySection: Object.fromEntries(
            setup.sections.map((section) => [section.localId, []]),
          ),
          selectedStudentIds: new Set(),
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Unable to load unassigned students.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [onChange, setup.academicLevelId, setup.academicYear.academic_year_id, setup.sections, state]);

  const studentMap = useMemo(
    () => new Map(rawStudents.map((s) => [s.student_id, s])),
    [rawStudents],
  );

  const calculate = useCallback(
    async (
      targetMode: DistributionMode = mode,
      targetSectionIds: Set<string> = selectedSectionIds,
    ) => {
      if (!rawStudents.length || !targetSectionIds.size || requiresPathway) {
        return;
      }

      setBusy(true);
      setDistributeError("");
      try {
        const resp = await distributeClassStudents({
          academic_year_id: setup.academicYear.academic_year_id,
          academic_level_id: setup.academicLevelId,
          mode: targetMode,
          sections: setup.sections
            .filter((s) => targetSectionIds.has(s.localId))
            .map((s) => ({
              local_id: s.localId,
              section_name: s.sectionName,
            })),
          unassigned_student_ids: rawStudents.map((s) => s.student_id),
          assignments_by_section: Object.fromEntries(
            setup.sections.map((s) => [s.localId, []]),
          ),
        });

        const nextAssignments: PreviewAssignment[] = [];
        for (const [secId, studentIds] of Object.entries(
          resp.assignments_by_section,
        )) {
          for (const sid of studentIds) {
            const student = studentMap.get(sid);
            if (student) {
              nextAssignments.push({
                student_id: student.student_id,
                localId: secId,
                student_name: `${student.last_name}, ${student.first_name}${student.middle_name ? ` ${student.middle_name}` : ""}`,
                gender: student.gender,
                gwa: resp.student_gwas?.[student.student_id] ?? null,
              });
            }
          }
        }

        setSuggestedAssignments(nextAssignments);
        setDraftAssignments(nextAssignments);
        setPreviewCalculated(true);
      } catch (cause: unknown) {
        setDistributeError(
          cause instanceof Error
            ? cause.message
            : "Unable to calculate distribution.",
        );
      } finally {
        setBusy(false);
      }
    },
    [mode, rawStudents, requiresPathway, selectedSectionIds, setup.academicLevelId, setup.academicYear.academic_year_id, setup.sections, studentMap],
  );

  // Auto-calculate on initial load once students are available
  useEffect(() => {
    if (
      !initialCalculatedRef.current &&
      !loading &&
      rawStudents.length > 0 &&
      setup.sections.length > 0 &&
      !requiresPathway
    ) {
      initialCalculatedRef.current = true;
      void calculate(mode, selectedSectionIds);
    }
  }, [calculate, loading, mode, rawStudents.length, requiresPathway, selectedSectionIds, setup.sections.length]);

  function toggleSection(localId: string) {
    setSelectedSectionIds((current) => {
      const next = new Set(current);
      if (next.has(localId)) next.delete(localId);
      else next.add(localId);
      return next;
    });
    setPreviewCalculated(false);
    setDraftAssignments([]);
    setDistributeError("");
  }

  function moveAssignment(studentId: string, targetLocalId: string) {
    if (!selectedSectionIds.has(targetLocalId)) return;
    setDraftAssignments((current) =>
      current.map((item) =>
        item.student_id === studentId
          ? { ...item, localId: targetLocalId }
          : item,
      ),
    );
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveStudentId(
      (event.active.data.current?.studentId as string) ?? null,
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveStudentId(null);
    const studentId = event.active.data.current?.studentId as string | undefined;
    const targetLocalId = event.over?.data.current?.localId as string | undefined;
    if (studentId && targetLocalId) {
      moveAssignment(studentId, targetLocalId);
    }
  }

  function handleDragCancel() {
    setActiveStudentId(null);
  }

  const activeStudent = activeStudentId
    ? draftAssignments.find((item) => item.student_id === activeStudentId)
    : null;

  const classRows = computeSectionRows(
    setup.sections,
    selectedSectionIds,
    draftAssignments,
    mode,
  );

  const finalCounts = classRows.map((item) => item.finalCount);
  const imbalance = finalCounts.length
    ? Math.max(...finalCounts) - Math.min(...finalCounts)
    : 0;

  const customCount = suggestedAssignments.filter(
    (item) =>
      draftAssignments.find((draft) => draft.student_id === item.student_id)
        ?.localId !== item.localId,
  ).length;

  function continueToReview() {
    const assignmentsBySection: Record<string, ClassAssignmentStudent[]> = {};
    for (const section of setup.sections) {
      const sectionDrafts = draftAssignments.filter(
        (a) => a.localId === section.localId,
      );
      assignmentsBySection[section.localId] = sortAssignmentStudents(
        sectionDrafts
          .map((a) => studentMap.get(a.student_id))
          .filter((s): s is ClassAssignmentStudent => Boolean(s)),
      );
    }
    const assignedIds = new Set(draftAssignments.map((a) => a.student_id));
    const unassignedStudents = sortAssignmentStudents(
      rawStudents.filter((s) => !assignedIds.has(s.student_id)),
    );

    onChange({
      academicLevelId: setup.academicLevelId,
      unassignedStudents,
      assignmentsBySection,
      selectedStudentIds: new Set(),
    });
    onReview();
  }

  if (loading) {
    return (
      <div className="grid gap-3 rounded border border-black bg-[#fff8d7] p-5 text-sm m-4">
        <div className="flex items-center gap-2">
          <span className="inline-block size-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
          <p className="font-bold">Loading unassigned students...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="grid gap-3 rounded border border-black bg-[#fff8d7] p-5 text-sm m-4">
        <p className="font-bold">Unable to load unassigned students.</p>
        <p className="text-xs text-black/70">{loadError}</p>
        <div className="flex gap-2">
          <Button onClick={() => window.location.reload()}>Retry</Button>
          <Button variant="outline" onClick={onBack}>
            Back to Class Details
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grid max-h-[70vh] gap-4 overflow-y-auto p-5 text-sm">
        <p>
          <b>Academic Year:</b> {setup.academicYear.year_label}{" "}
          <span className="mx-2">•</span> <b>Grade:</b> {setup.academicLevelName}
        </p>
        <p>
          Unassigned students available when opened: {rawStudents.length}.
          Preview checks the live, complete grade-level pool.
        </p>
        <AdminValidationAlert message={distributeError} />

        {requiresPathway ? (
          <Alert status="info">
            Automatic distribution is unavailable for this pathway-based grade
            because student pathway assignments are not recorded.
          </Alert>
        ) : setup.sections.length === 0 ? (
          <Alert status="info">
            Add at least one section in the previous step before distributing
            students.
          </Alert>
        ) : rawStudents.length === 0 ? (
          <Alert status="info">
            There are no unassigned students available for this academic year
            and grade level. You can continue to create the classes without
            student assignments.
          </Alert>
        ) : (
          <>
            <fieldset className="space-y-2">
              <legend className="mb-2 font-semibold">
                Existing classes to include
              </legend>
              <Card className="grid w-full gap-3 shadow-none">
                {setup.sections.map((item) => (
                  <label key={item.localId} className="flex items-center gap-2">
                    <Checkbox
                      checked={selectedSectionIds.has(item.localId)}
                      onCheckedChange={() => toggleSection(item.localId)}
                    />
                    {item.sectionName}
                  </label>
                ))}
              </Card>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="mb-2 font-semibold">Distribution method</legend>
              <Card
                role="radiogroup"
                aria-label="Distribution method"
                className="grid w-full gap-3 shadow-none"
              >
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    role="radio"
                    aria-checked={mode === "alphabetical"}
                    checked={mode === "alphabetical"}
                    onCheckedChange={() => {
                      setMode("alphabetical");
                      setPreviewCalculated(false);
                      setDistributeError("");
                    }}
                  />
                  Balance alphabetically and by gender
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    role="radio"
                    aria-checked={mode === "gwa"}
                    checked={mode === "gwa"}
                    onCheckedChange={() => {
                      setMode("gwa");
                      setPreviewCalculated(false);
                      setDistributeError("");
                    }}
                  />
                  Balance by prior academic performance (GWA)
                </label>
              </Card>
            </fieldset>

            <Button
              className="gap-2 w-full justify-center"
              variant="outline"
              disabled={busy || selectedSectionIds.size === 0}
              onClick={() => void calculate(mode, selectedSectionIds)}
            >
              <ExternalLink className="size-4" />
              {busy ? "Working..." : "Preview Distribution"}
            </Button>

            {selectedSectionIds.size === 0 && (
              <p className="text-sm text-muted-foreground">
                Choose at least one class.
              </p>
            )}

            {previewCalculated && (
              <section
                className="grid gap-3"
                aria-label="Distribution preview"
              >
                <div>
                  <h3 className="font-bold">Proposed assignments</h3>
                  <p>
                    {rawStudents.length} eligible unassigned students. No changes
                    have been saved.
                  </p>
                </div>

                <div className="overflow-x-auto rounded! border-2 border-border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-primary">
                      <tr>
                        <th className="p-2">Class</th>
                        <th className="p-2">Existing</th>
                        <th className="p-2">To add</th>
                        <th className="p-2">Final</th>
                        <th className="p-2">M / F / U</th>
                        {mode === "gwa" && <th className="p-2">Avg. GWA</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {classRows.map((item) => (
                        <tr
                          key={item.localId}
                          className="border-t border-border"
                        >
                          <th className="p-2">{item.sectionName}</th>
                          <td className="p-2">{item.existingCount}</td>
                          <td className="p-2">{item.toAddCount}</td>
                          <td className="p-2">{item.finalCount}</td>
                          <td className="p-2">
                            {item.maleCount} / {item.femaleCount} /{" "}
                            {item.unspecifiedCount}
                          </td>
                          {mode === "gwa" && (
                            <td className="p-2">
                              {item.averageGwa != null ? item.averageGwa : "—"}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {imbalance > 1 && (
                  <p className="text-muted-foreground">
                    Existing rosters limit exact balance. Current assignments
                    will remain in place.
                  </p>
                )}

                {customCount > 0 && (
                  <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                    <span>
                      {customCount} manual{" "}
                      {customCount === 1 ? "adjustment" : "adjustments"} made
                      to proposed distribution.
                    </span>
                    <button
                      type="button"
                      className="cursor-pointer font-semibold text-primary underline hover:text-primary-hover"
                      onClick={() => setDraftAssignments(suggestedAssignments)}
                    >
                      Reset to suggested distribution
                    </button>
                  </div>
                )}

                <div className="grid gap-3">
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p>
                      Drag and drop students between sections to customize
                      proposed assignments.
                    </p>
                    <p>
                      Click and hold any student card to drag them into another
                      section. Section student counts and GWA summaries update
                      automatically in real-time.
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
                        const sectionAssignments = draftAssignments.filter(
                          (item) => item.localId === classItem.localId,
                        );
                        return (
                          <AssignmentSection
                            key={classItem.localId}
                            section={classItem}
                            assignments={sectionAssignments}
                            isDraggingAny={Boolean(activeStudentId)}
                          />
                        );
                      })}
                    </div>
                    <DragOverlay
                      dropAnimation={{
                        duration: 150,
                        easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
                      }}
                    >
                      {activeStudent ? (
                        <div className="flex items-center justify-between gap-3 rounded-lg border-2 border-black bg-primary px-3.5 py-2.5 text-sm font-bold text-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] rotate-1 scale-105 cursor-grabbing z-50 select-none">
                          <div className="flex items-center gap-2">
                            <span className="flex size-5 items-center justify-center rounded bg-black text-primary-foreground">
                              <GripVertical className="size-3.5" />
                            </span>
                            <span className="font-bold">
                              {activeStudent.student_name}
                            </span>
                          </div>
                          {activeStudent.gwa != null && (
                            <span className="rounded bg-black px-2 py-0.5 text-sm text-white">
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

        {resetWarning && (
          <p className="text-sm font-normal text-muted-foreground px-2 -mt-1">
            {resetWarning}
          </p>
        )}
      </div>

      <Dialog.Footer className="justify-between">
        <Button variant="outline" autoIcon={false} onClick={onClose}>
          Close
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onBack}>
            Back to Class Details
          </Button>
          <Button onClick={continueToReview}>Continue to Review</Button>
        </div>
      </Dialog.Footer>
    </>
  );
}
