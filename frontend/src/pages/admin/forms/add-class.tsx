"use client";

import { useState } from "react";
import { Download, UserPlus } from "lucide-react";
import { ApiRequestError, createClassesBatch } from "@/lib/api";
import type {
  BatchCreateClassesRequest,
  BatchCreateClassesResponse,
  ManualAssignmentWorkspaceState,
  ManualClassSetup,
  WizardMode,
} from "@/types/adminClasses";
import StudentAssignmentWorkspace from "@/components/admin/classes/assignment/StudentAssignmentWorkspace";
import { sortAssignmentStudents } from "@/components/admin/classes/assignment/studentSorting";
import ImportClassWizard from "@/pages/admin/forms/classes/import-class-wizard";
import ManualClassWizard from "@/pages/admin/forms/classes/manual-class-wizard";
import { Dialog } from "@/components/retroui/Dialog";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";

type AddClassModalProps = {
  onClose?: () => void;
  onClassesCreated?: () => void;
};

export default function AddClassModal({ onClose, onClassesCreated }: AddClassModalProps) {
  const [mode, setMode] = useState<WizardMode>("choice");
  const [manualSetup, setManualSetup] = useState<ManualClassSetup | null>(null);
  const [manualStep, setManualStep] = useState<"details" | "assignment" | "review">("details");
  const [assignmentState, setAssignmentState] = useState<ManualAssignmentWorkspaceState | null>(null);
  const [resetWarning, setResetWarning] = useState("");
  const [saveSuccess, setSaveSuccess] = useState<BatchCreateClassesResponse | null>(null);

  function handleClose() {
    setMode("choice");
    setManualSetup(null);
    setManualStep("details");
    setAssignmentState(null);
    setResetWarning("");
    setSaveSuccess(null);
    onClose?.();
  }

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

  if (mode === "choice") {
    return (
      <Dialog.Content size="lg">
        <Dialog.Header asChild>
          <div className="flex items-center justify-between w-full">
            <Text as="h5" className="font-sans text-xl font-bold">Add New Classes</Text>
          </div>
        </Dialog.Header>

        <section className="grid gap-4 p-4 md:grid-cols-2">
          <Card
            className="cursor-pointer transition hover:bg-muted/50"
            onClick={() => setMode("import")}
          >
            <div className="flex items-center gap-3 font-semibold mb-2">
              <Download className="size-5 text-primary" />
              <span>Import from File</span>
            </div>
            <Text as="p" className="text-sm text-muted-foreground">
              Upload a CSV file to add multiple classes and student assignments at once.
            </Text>
          </Card>

          <Card
            className="cursor-pointer transition hover:bg-muted/50"
            onClick={() => setMode("manual")}
          >
            <div className="flex items-center gap-3 font-semibold mb-2">
              <UserPlus className="size-5 text-primary" />
              <span>Create Manually</span>
            </div>
            <Text as="p" className="text-sm text-muted-foreground">
              Add individual class sections, assign advisers, and manage students step by step.
            </Text>
          </Card>
        </section>

        <Dialog.Footer>
          <Dialog.Close>
            <Button variant={"outline"} onClick={handleClose}>Cancel</Button>
          </Dialog.Close>
        </Dialog.Footer>
      </Dialog.Content>
    );
  }

  const stepIndex = manualStep === "details" ? 1 : manualStep === "assignment" ? 2 : 3;

  const dialogTitle = saveSuccess
    ? "Class Created Successfully"
    : manualStep === "details"
      ? mode === "manual" ? "Add Class Details" : "Import Class Details"
      : manualStep === "assignment"
        ? "Assign Students"
        : "Review Class Setup";

  return (
    <Dialog.Content size={!saveSuccess && inAssignmentStep ? "3xl" : "xl"}>
      <Dialog.Header asChild>
        <div className="flex items-center justify-between w-full">
          <Text as="h5" className="font-sans text-xl font-bold">{dialogTitle}</Text>
          {!saveSuccess && (
            <Text as="h5" className="font-sans text-md font-bold">(Step {stepIndex} of 3)</Text>
          )}
        </div>
      </Dialog.Header>

      <section className="flex flex-col gap-4 p-4 max-h-[80vh] overflow-y-auto">
        {saveSuccess ? (
          <ManualSaveSuccess
            result={saveSuccess}
            onDone={() => {
              handleClose();
              onClassesCreated?.();
            }}
          />
        ) : mode === "manual" ? (
          <div className={`grid gap-4 ${manualStep === "assignment" ? "h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]" : ""}`}>
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
      </section>

      {!saveSuccess && (
        <Dialog.Footer>
          {manualStep === "details" ? (
            <Button variant={"outline"} onClick={() => setMode("choice")}>Back</Button>
          ) : manualStep === "assignment" ? (
            <>
              <Button variant={"outline"} onClick={() => setManualStep("details")}>Back</Button>
              <Button variant={"default"} onClick={() => setManualStep("review")}>Next</Button>
            </>
          ) : (
            <Button variant={"outline"} onClick={() => setManualStep("assignment")}>Back</Button>
          )}
        </Dialog.Footer>
      )}
    </Dialog.Content>
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
        <Text as="p" className="text-sm"><b>Academic Level:</b> {setup.academicLevelName}</Text>
        <Text as="p" className="text-sm"><b>Academic Year:</b> {setup.academicYear.year_label}</Text>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {setup.sections.map((section) => (
          <Card key={section.localId} className="p-3">
            <h3 className="font-bold">{section.sectionName}</h3>
            <p className="text-sm">Adviser: {section.adviserName || "Not available"}</p>
            <p className="text-sm">Assigned Students: {assignmentState.assignmentsBySection[section.localId]?.length ?? 0}</p>
          </Card>
        ))}
      </div>

      <Text as="p" className="text-sm font-bold">
        Remaining Unassigned Students: {assignmentState.unassignedStudents.length}
      </Text>

      {saveError && (
        <div className="grid gap-2 rounded-md border-2 border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          <p className="font-bold">{saveError.message}</p>
          {saveError.backendMessage && saveError.backendMessage !== saveError.message && <p>{saveError.backendMessage}</p>}
          {!!saveError.details.length && (
            <ul className="grid gap-1 text-xs">
              {saveError.details.map((detail) => <li key={detail}>- {detail}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button variant={"default"} disabled={isSaving} onClick={saveClasses}>
          {isSaving ? "Saving classes..." : saveError?.retryable ? "Retry Save Classes" : "Save Classes"}
        </Button>
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

function ManualSaveSuccess({ result, onDone }: { result: BatchCreateClassesResponse; onDone: () => void }) {
  return (
    <div className="grid gap-4">
      <Card className="bg-primary/10 border-primary p-4">
        <Text as="h6" className="text-base font-bold text-primary">Classes created successfully.</Text>
        <Text as="p" className="text-sm">{result.summary.class_count} class{result.summary.class_count !== 1 ? "es" : ""} created.</Text>
        <Text as="p" className="text-sm">{result.summary.student_assignment_count} student{result.summary.student_assignment_count !== 1 ? "s" : ""} assigned.</Text>
      </Card>

      {!!result.classes.length && (
        <div className="grid gap-2">
          {result.classes.map((item) => (
            <Card key={item.class_id} className="p-3">
              <h3 className="font-bold">{item.section_name}</h3>
              <p className="text-sm">Assigned Students: {item.student_count}</p>
            </Card>
          ))}
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button variant={"default"} onClick={onDone}>Done</Button>
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
