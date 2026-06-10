import { useState } from "react";
import { ApiRequestError, createClassesBatch } from "@/lib/api";
import type {
  BatchCreateClassesRequest,
  BatchCreateClassesResponse,
  ManualAssignmentWorkspaceState,
  ManualClassSetup,
  WizardMode,
} from "@/types/adminClasses";
import StudentAssignmentWorkspace from "../assignment/StudentAssignmentWorkspace";
import { sortAssignmentStudents } from "../assignment/studentSorting";
import { retroButton } from "../utils";
import AddClassMethodSelection from "./AddClassMethodSelection";
import ImportClassWizard from "./ImportClassWizard";
import ManualClassWizard from "./ManualClassWizard";
import ModalShell from "./ModalShell";

export default function AddClassModal({ onClose, onClassesCreated }: { onClose: () => void; onClassesCreated?: () => void }) {
  const [mode, setMode] = useState<WizardMode>("choice");
  const [manualSetup, setManualSetup] = useState<ManualClassSetup | null>(null);
  const [manualStep, setManualStep] = useState<"details" | "assignment" | "review">("details");
  const [assignmentState, setAssignmentState] = useState<ManualAssignmentWorkspaceState | null>(null);
  const [resetWarning, setResetWarning] = useState("");
  const [saveSuccess, setSaveSuccess] = useState<BatchCreateClassesResponse | null>(null);

  if (mode === "choice") return <AddClassMethodSelection onClose={onClose} onSelect={setMode} />;

  function continueFromDetails(setup: ManualClassSetup) {
    setSaveSuccess(null);
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

  function resetManualState() {
    setManualSetup(null);
    setManualStep("details");
    setAssignmentState(null);
    setResetWarning("");
  }

  function continueFromImport(setup: ManualClassSetup, hydratedAssignmentState: ManualAssignmentWorkspaceState) {
    setSaveSuccess(null);
    if (manualSetup && assignmentState && sameImportedSetup(manualSetup, setup)) {
      setManualStep("assignment");
      return;
    }
    setManualSetup(setup);
    setAssignmentState(hydratedAssignmentState);
    setResetWarning("");
    setManualStep("assignment");
  }

  function clearImportHydration() {
    setManualSetup(null);
    setAssignmentState(null);
    setResetWarning("");
    setManualStep("details");
  }

  const inAssignmentStep = manualStep === "assignment";

  return (
    <ModalShell
      title={saveSuccess ? "Create Class - Success" : mode === "manual" ? `Create Class - ${manualStep === "details" ? "Class Details" : manualStep === "assignment" ? "Assign Students" : "Review"}` : `Import from file${manualStep === "assignment" ? " - Assign Students" : manualStep === "review" ? " - Review" : ""}`}
      onClose={onClose}
      wide={!saveSuccess && inAssignmentStep}
      fullScreen={!saveSuccess && inAssignmentStep}
    >
      {saveSuccess ? (
        <ManualSaveSuccess result={saveSuccess} onClose={() => {
          onClose();
          onClassesCreated?.();
        }} />
      ) : mode === "manual" ? (
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
            <ManualReview
              setup={manualSetup}
              assignmentState={assignmentState}
              onBack={() => setManualStep("assignment")}
              onSaved={(result) => {
                resetManualState();
                setSaveSuccess(result);
              }}
            />
          ) : null}
        </div>
      ) : (
        <div className={`grid gap-4 ${manualStep === "assignment" ? "h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]" : ""}`}>
          {manualStep !== "details" && <ManualStepIndicator current={manualStep} />}
          <div className={manualStep === "details" ? "" : "hidden"}>
            <ImportClassWizard onContinue={continueFromImport} onValidationStale={clearImportHydration} />
          </div>
          {manualStep === "assignment" && manualSetup ? (
            <StudentAssignmentWorkspace
              setup={manualSetup}
              state={assignmentState}
              resetWarning={resetWarning}
              onChange={setAssignmentState}
              onBack={() => setManualStep("details")}
              onReview={() => setManualStep("review")}
            />
          ) : manualStep === "review" && manualSetup && assignmentState ? (
            <ManualReview
              setup={manualSetup}
              assignmentState={assignmentState}
              onBack={() => setManualStep("assignment")}
              onSaved={(result) => {
                resetManualState();
                setSaveSuccess(result);
              }}
            />
          ) : null}
        </div>
      )}
    </ModalShell>
  );
}

function sameImportedSetup(current: ManualClassSetup, next: ManualClassSetup) {
  return current.academicLevelId === next.academicLevelId
    && current.sections.length === next.sections.length
    && current.sections.every((section, index) => {
      const nextSection = next.sections[index];
      return section.sectionName === nextSection.sectionName
        && section.adviserStaffId === nextSection.adviserStaffId;
    });
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

function ManualReview({ setup, assignmentState, onBack, onSaved }: {
  setup: ManualClassSetup;
  assignmentState: ManualAssignmentWorkspaceState;
  onBack: () => void;
  onSaved: (result: BatchCreateClassesResponse) => void;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<SaveErrorState | null>(null);

  async function saveClasses() {
    if (isSaving) return;
    const payloadResult = buildBatchCreatePayload(setup, assignmentState);
    if (!payloadResult.ok) {
      setSaveError({
        message: "Review the class setup before saving.",
        details: payloadResult.errors,
        retryable: false,
      });
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await createClassesBatch(payloadResult.payload);
      onSaved(result);
    } catch (error: unknown) {
      setSaveError(errorToSaveError(error));
    } finally {
      setIsSaving(false);
    }
  }

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
      {saveError && (
        <div className="grid gap-2 rounded-md border border-red-700 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-bold">{saveError.message}</p>
          {saveError.backendMessage && saveError.backendMessage !== saveError.message && <p>{saveError.backendMessage}</p>}
          {!!saveError.details.length && (
            <ul className="grid gap-1 text-xs">
              {saveError.details.map((detail) => <li key={detail}>- {detail}</li>)}
            </ul>
          )}
        </div>
      )}
      <div className="flex justify-between">
        <button disabled={isSaving} className={retroButton("disabled:cursor-not-allowed disabled:opacity-50")} onClick={onBack}>Back to Assign Students</button>
        <button disabled={isSaving} className={retroButton("bg-[#79bd80] disabled:cursor-not-allowed disabled:opacity-50")} onClick={saveClasses}>
          {isSaving ? "Saving classes..." : saveError?.retryable ? "Retry Save Classes" : "Save Classes"}
        </button>
      </div>
    </div>
  );
}

type SaveErrorState = {
  message: string;
  backendMessage?: string;
  details: string[];
  retryable: boolean;
};

function ManualSaveSuccess({ result, onClose }: { result: BatchCreateClassesResponse; onClose: () => void }) {
  return (
    <div className="grid gap-4">
      <div className="rounded-md border border-black bg-[#d8efca] p-4">
        <h2 className="text-lg font-bold">Classes created successfully.</h2>
        <p className="text-sm">{result.summary.class_count} class{result.summary.class_count !== 1 ? "es" : ""} created.</p>
        <p className="text-sm">{result.summary.student_assignment_count} student{result.summary.student_assignment_count !== 1 ? "s" : ""} assigned.</p>
      </div>
      {!!result.classes.length && (
        <div className="grid gap-2">
          {result.classes.map((item) => (
            <section key={item.class_id} className="rounded-md border border-black bg-white p-3">
              <h3 className="font-bold">{item.section_name}</h3>
              <p className="text-sm">Assigned Students: {item.student_count}</p>
            </section>
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <button className={retroButton("bg-[#79bd80]")} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function buildBatchCreatePayload(setup: ManualClassSetup, assignmentState: ManualAssignmentWorkspaceState): { ok: true; payload: BatchCreateClassesRequest } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!setup.academicLevelId) errors.push("Select an academic level.");
  if (!setup.sections.length) errors.push("Add at least one section.");
  if (assignmentState.unassignedStudents.length > 0) errors.push("Assign all students to a section before saving.");

  const sectionNames = new Map<string, string>();
  const adviserIds = new Set<string>();
  const studentIds = new Set<string>();
  const sections = setup.sections.map((section) => {
    const sectionName = section.sectionName.trim();
    const normalizedSectionName = sectionName.toLocaleLowerCase();
    const adviserStaffId = section.adviserStaffId.trim();
    const assignedStudents = assignmentState.assignmentsBySection[section.localId] ?? [];

    if (!sectionName) errors.push("Every section must have a section name.");
    else if (sectionNames.has(normalizedSectionName)) errors.push(`Section name "${sectionName}" is duplicated.`);
    else sectionNames.set(normalizedSectionName, sectionName);

    if (!adviserStaffId) errors.push(`Select an adviser for ${sectionName || "each section"}.`);
    else if (adviserIds.has(adviserStaffId)) errors.push("Each adviser can only be assigned to one submitted section.");
    else adviserIds.add(adviserStaffId);

    if (assignedStudents.length === 0) errors.push(`${sectionName || "Each section"} must contain at least one student.`);
    const submittedStudentIds = assignedStudents.map((student) => {
      if (!isUuid(student.student_id) || student.student_id === student.student_lrn) {
        errors.push(`${student.first_name} ${student.last_name} is missing a valid student UUID.`);
      }
      if (studentIds.has(student.student_id)) errors.push(`${student.first_name} ${student.last_name} is assigned to more than one section.`);
      studentIds.add(student.student_id);
      return student.student_id;
    });

    return {
      section_name: sectionName,
      adviser_staff_id: adviserStaffId,
      student_ids: submittedStudentIds,
    };
  });

  return errors.length ? { ok: false, errors: [...new Set(errors)] } : { ok: true, payload: { academic_level_id: setup.academicLevelId, sections } };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function errorToSaveError(error: unknown): SaveErrorState {
  if (!(error instanceof ApiRequestError)) {
    return {
      message: "Unable to connect to the server. Please try again.",
      details: [],
      retryable: true,
    };
  }

  const mapped = mappedBackendError(error);
  return {
    message: mapped.message,
    backendMessage: safeBackendMessage(error.data),
    details: safeErrorDetails(error.data),
    retryable: ![401, 403].includes(error.status),
  };
}

function mappedBackendError(error: ApiRequestError): { message: string } {
  if (error.status === 401) return { message: "Your session has expired. Please sign in again." };
  if (error.status === 403) return { message: "You do not have permission to create classes." };

  const codes = backendErrorCodes(error.data);
  if (codes.has("section_already_exists")) return { message: "A section with this name already exists for the active academic year." };
  if (codes.has("adviser_already_assigned") || codes.has("duplicate_adviser_assignment")) return { message: "This adviser is already assigned to another class section." };
  if (codes.has("student_already_assigned")) return { message: "One or more students were already assigned to a class. Review the assignments and try again." };
  if (codes.has("active_academic_year_missing")) return { message: "No active academic year is configured. Please configure an active academic year first." };
  if (codes.has("active_academic_year_multiple")) return { message: "Multiple active academic years were detected. Please resolve the academic-year configuration." };
  return { message: error.message || "Unable to save classes. Please try again." };
}

function backendErrorCodes(data: unknown): Set<string> {
  return new Set(backendErrorItems(data).map((item) => item.code).filter((code): code is string => Boolean(code)));
}

function safeBackendMessage(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  if ("message" in data && typeof data.message === "string") return data.message;
  if ("detail" in data && typeof data.detail === "string") return data.detail;
  return undefined;
}

function safeErrorDetails(data: unknown): string[] {
  return backendErrorItems(data)
    .map((item) => item.message)
    .filter((message): message is string => Boolean(message))
    .filter((message) => !/stack|traceback|sql|constraint|\/app\/|\\app\\/i.test(message))
    .slice(0, 6);
}

function backendErrorItems(data: unknown): Array<{ code?: string; message?: string }> {
  if (!data || typeof data !== "object") return [];
  const detail = "detail" in data ? data.detail : undefined;
  const errors = "errors" in data ? data.errors : undefined;
  if (Array.isArray(errors)) return errors.filter(isBackendErrorItem);
  if (detail && typeof detail === "object" && "errors" in detail && Array.isArray(detail.errors)) {
    return detail.errors.filter(isBackendErrorItem);
  }
  if (Array.isArray(detail)) return detail.filter(isBackendErrorItem);
  return isBackendErrorItem(data) ? [data] : [];
}

function isBackendErrorItem(value: unknown): value is { code?: string; message?: string } {
  return Boolean(value && typeof value === "object" && (
    ("code" in value && typeof value.code === "string")
    || ("message" in value && typeof value.message === "string")
  ));
}
