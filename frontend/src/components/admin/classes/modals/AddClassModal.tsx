import { useState } from "react";
import type { ManualAssignmentWorkspaceState, ManualClassSetup, WizardMode } from "@/types/adminClasses";
import StudentAssignmentWorkspace from "../assignment/StudentAssignmentWorkspace";
import { sortAssignmentStudents } from "../assignment/studentSorting";
import { retroButton } from "../utils";
import AddClassMethodSelection from "./AddClassMethodSelection";
import ImportClassWizard from "./ImportClassWizard";
import ManualClassWizard from "./ManualClassWizard";
import ModalShell from "./ModalShell";

export default function AddClassModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<WizardMode>("choice");
  const [manualSetup, setManualSetup] = useState<ManualClassSetup | null>(null);
  const [manualStep, setManualStep] = useState<"details" | "assignment" | "review">("details");
  const [assignmentState, setAssignmentState] = useState<ManualAssignmentWorkspaceState | null>(null);
  const [resetWarning, setResetWarning] = useState("");

  if (mode === "choice") return <AddClassMethodSelection onClose={onClose} onSelect={setMode} />;

  function continueFromDetails(setup: ManualClassSetup) {
    setManualSetup(setup);
    setManualStep("assignment");

    if (!assignmentState) return;
    if (assignmentState.academicLevelId !== setup.academicLevelId) {
      setAssignmentState(null);
      setResetWarning("Student assignments were reset because the academic level changed.");
      return;
    }

    const currentSectionIds = new Set(setup.sections.map((section) => section.localId));
    const removedStudents = Object.entries(assignmentState.assignmentsBySection)
      .filter(([sectionId]) => !currentSectionIds.has(sectionId))
      .flatMap(([, students]) => students);
    setAssignmentState({
      ...assignmentState,
      unassignedStudents: sortAssignmentStudents([...assignmentState.unassignedStudents, ...removedStudents]),
      assignmentsBySection: Object.fromEntries(setup.sections.map((section) => [
        section.localId,
        assignmentState.assignmentsBySection[section.localId] ?? [],
      ])),
    });
    setResetWarning("");
  }

  return (
    <ModalShell
      title={mode === "manual" ? `Create Class - ${manualStep === "details" ? "Class Details" : manualStep === "assignment" ? "Assign Students" : "Review"}` : "Import from file"}
      onClose={onClose}
      wide={mode === "manual" && manualStep === "assignment"}
      fullScreen={mode === "manual" && manualStep === "assignment"}
    >
      {mode === "manual" ? (
        <div className={`grid gap-4 ${manualStep === "assignment" ? "h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]" : ""}`}>
          <ManualStepIndicator current={manualStep} />
          {manualStep === "details" ? (
            <ManualClassWizard
              initialSetup={manualSetup}
              onComplete={continueFromDetails}
              onBack={() => setMode("choice")}
            />
          ) : manualStep === "assignment" && manualSetup ? (
            <StudentAssignmentWorkspace
              setup={manualSetup}
              state={assignmentState}
              resetWarning={resetWarning}
              onChange={setAssignmentState}
              onBack={() => setManualStep("details")}
              onReview={() => setManualStep("review")}
            />
          ) : manualSetup && assignmentState ? (
            <ManualReview setup={manualSetup} assignmentState={assignmentState} onBack={() => setManualStep("assignment")} />
          ) : null}
        </div>
      ) : <ImportClassWizard onClose={onClose} />}
    </ModalShell>
  );
}

function ManualStepIndicator({ current }: { current: "details" | "assignment" | "review" }) {
  const steps = [
    ["details", "1. Class Details"],
    ["assignment", "2. Assign Students"],
    ["review", "3. Review"],
  ] as const;
  return (
    <div className="grid grid-cols-3 gap-2 text-center text-xs font-bold">
      {steps.map(([id, label]) => <span key={id} className={`rounded border border-black px-2 py-1 ${current === id ? "bg-[#79bd80]" : "bg-white"}`}>{label}</span>)}
    </div>
  );
}

function ManualReview({ setup, assignmentState, onBack }: {
  setup: ManualClassSetup;
  assignmentState: ManualAssignmentWorkspaceState;
  onBack: () => void;
}) {
  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-lg font-bold">Review Classes</h2>
        <p className="text-sm"><b>Academic Level:</b> {setup.academicLevelName}</p>
        <p className="text-sm"><b>Academic Year:</b> {setup.academicYear.year_label}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {setup.sections.map((section) => (
          <section key={section.localId} className="rounded-md border border-black bg-white p-3">
            <h3 className="font-bold">{section.sectionName}</h3>
            <p className="text-sm">Adviser: {section.adviserName || "Not available"}</p>
            <p className="text-sm">Assigned Students: {assignmentState.assignmentsBySection[section.localId]?.length ?? 0}</p>
          </section>
        ))}
      </div>
      <p className="text-sm font-bold">Remaining Unassigned Students: {assignmentState.unassignedStudents.length}</p>
      <div className="flex justify-between">
        <button className={retroButton()} onClick={onBack}>Back to Assign Students</button>
        <button disabled className={retroButton("cursor-not-allowed opacity-50")}>Save Classes - Coming Next</button>
      </div>
    </div>
  );
}
