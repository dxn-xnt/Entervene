import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { useEffect, useState } from "react";
import { getUnassignedClassStudents } from "@/lib/api";
import type { ClassAssignmentStudent, ManualAssignmentWorkspaceState, ManualClassSetup } from "@/types/adminClasses";
import { retroButton } from "../utils";
import AssignmentToolbar from "./AssignmentToolbar";
import AssignEvenlyConfirmationModal from "./AssignEvenlyConfirmationModal";
import AvailableStudentsPanel from "./AvailableStudentsPanel";
import { distributeUnassignedStudents, recommendedTargets } from "./assignmentDistribution";
import SectionAssignmentCard from "./SectionAssignmentCard";
import SectionDetailsModal from "./SectionDetailsModal";
import { sortAssignmentStudents } from "./studentSorting";

export default function StudentAssignmentWorkspace({ setup, state, resetWarning, onChange, onBack, onReview }: {
  setup: ManualClassSetup;
  state: ManualAssignmentWorkspaceState | null;
  resetWarning: string;
  onChange: (state: ManualAssignmentWorkspaceState) => void;
  onBack: () => void;
  onReview: () => void;
}) {
  const [loading, setLoading] = useState(!state || state.academicLevelId !== setup.academicLevelId);
  const [loadError, setLoadError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [reviewAttempted, setReviewAttempted] = useState(false);
  const [showAssignEvenlyConfirmation, setShowAssignEvenlyConfirmation] = useState(false);
  const [detailsSectionId, setDetailsSectionId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    if (state?.academicLevelId === setup.academicLevelId) return;
    let cancelled = false;
    getUnassignedClassStudents(setup.academicLevelId)
      .then((data) => {
        if (cancelled) return;
        onChange({
          academicLevelId: setup.academicLevelId,
          unassignedStudents: sortAssignmentStudents(data.students),
          assignmentsBySection: Object.fromEntries(setup.sections.map((section) => [section.localId, []])),
          selectedStudentIds: new Set(),
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Unable to load unassigned students.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [onChange, retryKey, setup, state]);

  function retryLoading() {
    setLoading(true);
    setLoadError("");
    setRetryKey((value) => value + 1);
  }

  function updateSelection(studentId: string, selected: boolean) {
    if (!state) return;
    const selectedStudentIds = new Set(state.selectedStudentIds);
    if (selected) selectedStudentIds.add(studentId);
    else selectedStudentIds.delete(studentId);
    onChange({ ...state, selectedStudentIds });
  }

  function moveStudents(studentIds: string[], target: string) {
    if (!state || !studentIds.length) return;
    const movingIds = new Set(studentIds);
    const allStudents = new Map<string, ClassAssignmentStudent>();
    state.unassignedStudents.forEach((student) => allStudents.set(student.student_id, student));
    Object.values(state.assignmentsBySection).flat().forEach((student) => allStudents.set(student.student_id, student));
    const moving = studentIds.map((id) => allStudents.get(id)).filter((student): student is ClassAssignmentStudent => Boolean(student));
    const assignmentsBySection = Object.fromEntries(setup.sections.map((section) => [
      section.localId,
      sortAssignmentStudents((state.assignmentsBySection[section.localId] ?? []).filter((student) => !movingIds.has(student.student_id))),
    ]));
    let unassignedStudents = sortAssignmentStudents(state.unassignedStudents.filter((student) => !movingIds.has(student.student_id)));
    if (target === "unassigned") unassignedStudents = sortAssignmentStudents([...unassignedStudents, ...moving]);
    else if (target in assignmentsBySection) assignmentsBySection[target] = sortAssignmentStudents([...assignmentsBySection[target], ...moving]);
    const selectedStudentIds = new Set(state.selectedStudentIds);
    movingIds.forEach((id) => selectedStudentIds.delete(id));
    onChange({ ...state, unassignedStudents, assignmentsBySection, selectedStudentIds });
  }

  function handleDragEnd(event: DragEndEvent) {
    const studentId = event.active.data.current?.studentId as string | undefined;
    const target = event.over?.data.current?.location as string | undefined;
    if (!studentId || !target || !state) return;
    moveStudents(state.selectedStudentIds.has(studentId) ? [...state.selectedStudentIds] : [studentId], target);
  }

  if (loading) return <StatePanel message="Loading unassigned students..." />;
  if (loadError) {
    return (
      <StatePanel message="Unable to load unassigned students." detail={loadError}>
        <button className={retroButton("bg-[#79bd80]")} onClick={retryLoading}>Retry</button>
        <button className={retroButton()} onClick={onBack}>Back to Class Details</button>
      </StatePanel>
    );
  }
  if (!state) return null;
  const emptySections = setup.sections.filter((section) => !(state.assignmentsBySection[section.localId]?.length));
  const canContinueToReview = state.unassignedStudents.length === 0 && emptySections.length === 0;
  const assignedCount = Object.values(state.assignmentsBySection).reduce((count, students) => count + students.length, 0);
  const totalStudentCount = assignedCount + state.unassignedStudents.length;
  const targets = recommendedTargets(totalStudentCount, setup.sections);
  const detailsSection = setup.sections.find((section) => section.localId === detailsSectionId);

  function continueToReview() {
    setReviewAttempted(true);
    if (canContinueToReview) onReview();
  }

  function assignEvenly() {
    if (!state || !state.unassignedStudents.length || !setup.sections.length) return;
    onChange({
      ...state,
      unassignedStudents: [],
      assignmentsBySection: distributeUnassignedStudents(state.unassignedStudents, state.assignmentsBySection, setup.sections),
      selectedStudentIds: new Set(),
    });
    setShowAssignEvenlyConfirmation(false);
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Assign Students - {setup.academicLevelName}</h2>
          <p className="text-sm">Academic Year: {setup.academicYear.year_label}</p>
        </div>
        {resetWarning && <p className="rounded-md border border-black bg-[#fff0a8] px-3 py-2 text-xs font-semibold">{resetWarning}</p>}
      </div>
      <AssignmentToolbar
        sections={setup.sections}
        selectedCount={state.selectedStudentIds.size}
        canAssignEvenly={state.unassignedStudents.length > 0 && setup.sections.length > 0}
        onMove={(target) => moveStudents([...state.selectedStudentIds], target)}
        onClear={() => onChange({ ...state, selectedStudentIds: new Set() })}
        onAssignEvenly={() => setShowAssignEvenlyConfirmation(true)}
      />
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="grid min-h-0 grid-cols-1 gap-3 overflow-y-auto lg:grid-cols-[minmax(320px,36%)_minmax(0,1fr)] lg:overflow-hidden">
          <AvailableStudentsPanel
            students={state.unassignedStudents}
            assignedCount={assignedCount}
            totalStudentCount={totalStudentCount}
            selectedIds={state.selectedStudentIds}
            onSelect={updateSelection}
            onSelectVisible={(ids) => onChange({ ...state, selectedStudentIds: new Set([...state.selectedStudentIds, ...ids]) })}
          />
          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2 rounded-md border-2 border-black bg-white p-3">
            <h3 className="font-bold">Sections</h3>
            <div className="grid min-h-0 grid-cols-1 content-start gap-3 overflow-y-auto pr-1 xl:grid-cols-2">
              {setup.sections.map((section) => (
                <SectionAssignmentCard
                  key={section.localId}
                  section={section}
                  students={state.assignmentsBySection[section.localId] ?? []}
                  selectedIds={state.selectedStudentIds}
                  recommendedTarget={targets[section.localId]}
                  showEmptyError={reviewAttempted && emptySections.some((emptySection) => emptySection.localId === section.localId)}
                  onSelect={updateSelection}
                  onRemove={(studentId) => moveStudents([studentId], "unassigned")}
                  onViewDetails={() => setDetailsSectionId(section.localId)}
                />
              ))}
            </div>
          </div>
        </div>
      </DndContext>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-black pt-3">
        <div>
          {reviewAttempted && !canContinueToReview && (
            <div className="grid gap-0.5 text-xs font-semibold text-red-700">
              {state.unassignedStudents.length > 0 && <p>Assign all students to a section before continuing.</p>}
              {emptySections.length > 0 && <p>Each section must contain at least one student.</p>}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={retroButton()} onClick={onBack}>Back to Class Details</button>
        <button
          aria-disabled={!canContinueToReview}
          className={retroButton(`bg-[#79bd80] ${canContinueToReview ? "" : "opacity-60"}`)}
          onClick={continueToReview}
        >
          Continue to Review
        </button>
        </div>
      </div>
      {showAssignEvenlyConfirmation && <AssignEvenlyConfirmationModal onCancel={() => setShowAssignEvenlyConfirmation(false)} onConfirm={assignEvenly} />}
      {detailsSection && (
        <SectionDetailsModal
          section={detailsSection}
          students={state.assignmentsBySection[detailsSection.localId] ?? []}
          recommendedTarget={targets[detailsSection.localId]}
          onClose={() => setDetailsSectionId(null)}
        />
      )}
    </div>
  );
}

function StatePanel({ message, detail, children }: { message: string; detail?: string; children?: React.ReactNode }) {
  return (
    <div className="grid gap-3 rounded-md border border-black bg-[#fff8d7] p-5 text-sm">
      <p className="font-bold">{message}</p>
      {detail && detail !== message && <p className="text-xs text-black/70">{detail}</p>}
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}
