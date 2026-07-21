"use client";

import { CheckCircle2, Download, FileText, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { ApiRequestError, getClassFormOptions, validateClassImport } from "@/lib/api";
import type {
  ClassAssignmentStudent,
  ClassFormOptions,
  ClassImportValidationErrorItem,
  ClassImportValidationErrorResponse,
  ManualAssignmentWorkspaceState,
  ManualClassSetup,
  ManualSectionDraft,
  ValidateClassImportResponse,
  ValidatedImportAdviser,
} from "@/types/adminClasses";
import Field from "@/components/admin/classes/fields/Field";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Text } from "@/components/retroui/Text";
import { Card } from "@/components/retroui/Card";
import { Dialog } from "@/components/retroui/Dialog";

const CLASS_IMPORT_TEMPLATE_HEADERS = [
  "section_name",
  "grade_level",
  "adviser_staff_id",
  "adviser_first_name",
  "adviser_middle_name",
  "adviser_last_name",
  "student_lrn",
  "student_first_name",
  "student_middle_name",
  "student_last_name",
  "student_gender",
];
const CLASS_IMPORT_TEMPLATE_HEADER_ROW = CLASS_IMPORT_TEMPLATE_HEADERS.join(",");

export default function ImportClassWizard({ onContinue, onValidationStale }: {
  onContinue: (setup: ManualClassSetup, assignmentState: ManualAssignmentWorkspaceState) => void;
  onValidationStale?: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [options, setOptions] = useState<ClassFormOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [selectedAcademicLevelId, setSelectedAcademicLevelId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidateClassImportResponse | null>(null);
  const [validationError, setValidationError] = useState<ImportValidationErrorState | null>(null);

  useEffect(() => {
    let cancelled = false;

    getClassFormOptions()
      .then((data) => {
        if (cancelled) return;
        setOptions(data);
        setSelectedAcademicLevelId((current) => current || String(data.academic_levels[0]?.academic_level_id ?? ""));
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Unable to load class options.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  function retryLoading() {
    setLoading(true);
    setLoadError("");
    setRetryKey((value) => value + 1);
  }

  function openFilePicker() {
    if (isValidating) return;
    fileInputRef.current?.click();
  }

  function clearFileInput() {
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile() {
    if (isValidating) return;
    setSelectedFile(null);
    setFileError("");
    clearValidationState();
    clearFileInput();
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    clearValidationState();

    if (!file) return;
    if (!file.name.toLocaleLowerCase().endsWith(".csv")) {
      setSelectedFile(null);
      setFileError("Only .csv files are supported.");
      clearFileInput();
      return;
    }

    setFileError("");
    setSelectedFile(file);
  }

  function downloadTemplate() {
    const content = `${CLASS_IMPORT_TEMPLATE_HEADER_ROW}\nGrade 7 - Sapphire,7,STF-2026-001,John,A,Doe,109876543201,Alice,M,Smith,Female\n`;
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "admin_add_class_import_template.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function validateCsv() {
    if (isValidating || !selectedAcademicLevelId || !selectedFile) return;

    setIsValidating(true);
    clearValidationState();
    try {
      const preflightError = await preflightClassImportCsv(selectedFile);
      if (preflightError) {
        setValidationError(preflightError);
        return;
      }
      const result = await validateClassImport(selectedFile, Number(selectedAcademicLevelId));
      setValidationResult(result);
    } catch (error: unknown) {
      setValidationError(toImportValidationError(error));
    } finally {
      setIsValidating(false);
    }
  }

  function clearValidationState() {
    setValidationResult(null);
    setValidationError(null);
    onValidationStale?.();
  }

  function continueToAssignments() {
    if (!validationResult || !canContinueToAssignments(validationResult) || isValidating || validationError) return;
    const { setup, assignmentState } = hydratedImportState(validationResult);
    onContinue(setup, assignmentState);
  }

  if (loading) {
    return <StatePanel message="Loading class options..." />;
  }

  if (loadError) {
    return (
      <StatePanel message="Unable to load class options." detail={loadError}>
        <Button variant={"default"} onClick={retryLoading}>Retry</Button>
      </StatePanel>
    );
  }

  if (!options) return null;
  const noLevels = options.academic_levels.length === 0;
  const canValidate = Boolean(selectedAcademicLevelId && selectedFile && !isValidating);
  const selectedLevel = options.academic_levels.find((level) => String(level.academic_level_id) === selectedAcademicLevelId);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3">
        <Field label="Academic Year">
          <Input readOnly value={options.academic_year.year_label} className="bg-muted/50 text-muted-foreground" />
        </Field>
        <Field label="Academic Level">
          <Select
            disabled={noLevels || isValidating}
            value={selectedAcademicLevelId}
            onChange={(e) => {
              setSelectedAcademicLevelId(e.target.value);
              clearValidationState();
            }}
          >
            <Select.Trigger className="w-full">
              <Select.Value placeholder="Select academic level" />
            </Select.Trigger>
            <Select.Content>
              <Select.Group>
                {options.academic_levels.map((level) => (
                  <Select.Item key={level.academic_level_id} value={String(level.academic_level_id)}>
                    {level.level_name}
                  </Select.Item>
                ))}
              </Select.Group>
            </Select.Content>
          </Select>
          {noLevels && <InlineError message="No academic levels are available." />}
          {selectedLevel && <Text as="p" className="mt-1 text-xs text-muted-foreground font-semibold">Selected: {selectedLevel.level_name}</Text>}
        </Field>
      </div>

      <Card className="grid gap-3 p-4">
        <div>
          <Text as="h6" className="font-bold">Upload CSV file</Text>
          <Text as="p" className="text-xs text-muted-foreground">Choose a CSV file that follows the required class-import template.</Text>
          <Text as="p" className="mt-1 text-xs font-semibold text-muted-foreground">Important: Keep student_lrn values as complete 12-digit numbers.</Text>
        </div>
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
        {!selectedFile ? (
          <Button disabled={isValidating} className="w-fit" onClick={openFilePicker}>
            <Upload className="size-4 mr-2" /> Choose CSV File
          </Button>
        ) : (
          <Card className="grid gap-3 p-3 bg-muted/20">
            <div className="flex items-start gap-2">
              <FileText className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <Text as="p" className="text-xs font-bold uppercase text-muted-foreground">Selected CSV file</Text>
                <Text as="p" className="break-words text-sm font-bold">{selectedFile.name}</Text>
                <Text as="p" className="text-xs text-muted-foreground">{readableFileSize(selectedFile.size)}</Text>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={"outline"} disabled={isValidating} onClick={openFilePicker}>Replace file</Button>
              <Button size="sm" variant={"outline"} disabled={isValidating} onClick={removeFile}><X className="size-3 mr-1" />Remove</Button>
            </div>
          </Card>
        )}
        {fileError && <InlineError message={fileError} />}
      </Card>

      <Card className="grid gap-2 p-3 text-sm bg-muted/20">
        <div className="flex items-center gap-2 font-bold"><CheckCircle2 className="size-4 text-primary" /> CSV validation</div>
        {isValidating ? <p className="text-xs font-semibold text-muted-foreground">Uploading and validating CSV...</p> : <p className="text-xs text-muted-foreground">Validate the selected CSV against existing class advisers and student accounts.</p>}
      </Card>

      {validationError && <ValidationErrorPanel error={validationError} onDownloadTemplate={downloadTemplate} />}
      {validationResult && <ValidationSuccessPanel result={validationResult} canContinue={canContinueToAssignments(validationResult) && !isValidating && !validationError} onContinue={continueToAssignments} />}

      <Dialog.Footer className="px-0 border-t-0 pt-2 flex justify-between w-full">
        <Button variant={"outline"} onClick={downloadTemplate}><Download className="size-4 mr-2" /> Download Template</Button>
        <Button disabled={!canValidate} onClick={validateCsv}>
          {isValidating ? "Validating CSV..." : "Validate CSV"}
        </Button>
      </Dialog.Footer>
    </div>
  );
}

function readableFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function InlineError({ message }: { message: string }) {
  return <p className="text-xs font-semibold text-destructive">{message}</p>;
}

type ImportValidationErrorState = {
  message: string;
  details: ClassImportValidationErrorItem[];
};

type ParsedCsvRow = {
  rowNumber: number;
  values: string[];
};

type CsvParseResult = {
  rows: ParsedCsvRow[];
  malformed: boolean;
};

function ValidationSuccessPanel({ result, canContinue, onContinue }: {
  result: ValidateClassImportResponse;
  canContinue: boolean;
  onContinue: () => void;
}) {
  return (
    <Card className="grid gap-3 border-primary bg-primary/10 p-4 text-sm">
      <div>
        <Text as="h6" className="font-bold text-primary">CSV validated successfully</Text>
        <Text as="p" className="text-xs">Academic Year: {result.academic_year.year_label}</Text>
        <Text as="p" className="text-xs">Academic Level: {result.academic_level.level_name}</Text>
        <Text as="p" className="text-xs">Sections detected: {result.summary.section_count}</Text>
        <Text as="p" className="text-xs">Students resolved: {result.summary.student_count}</Text>
      </div>
      <div className="grid gap-2">
        <Text as="h6" className="font-bold text-xs">Sections</Text>
        {result.sections.map((section) => (
          <Card key={`${section.section_name}-${section.adviser.staff_id}`} className="p-3">
            <p className="font-bold">{section.section_name}</p>
            <p className="text-xs">Adviser: {adviserName(section.adviser)} - {section.adviser.staff_id}</p>
            <p className="text-xs">Students: {section.students.length}</p>
          </Card>
        ))}
      </div>
      <Button disabled={!canContinue} className="w-fit" onClick={onContinue}>Next: Assign Students</Button>
    </Card>
  );
}

function canContinueToAssignments(result: ValidateClassImportResponse) {
  return result.sections.length > 0 && result.sections.every((section) => section.students.length > 0);
}

function hydratedImportState(result: ValidateClassImportResponse): {
  setup: ManualClassSetup;
  assignmentState: ManualAssignmentWorkspaceState;
} {
  const sections: ManualSectionDraft[] = result.sections.map((section) => ({
    localId: crypto.randomUUID(),
    sectionName: section.section_name,
    adviserStaffId: section.adviser.staff_id,
    adviserName: adviserName(section.adviser),
  }));
  const assignmentsBySection = Object.fromEntries(sections.map((section, index) => [
    section.localId,
    result.sections[index].students.map((student): ClassAssignmentStudent => ({
      student_id: student.student_id,
      student_lrn: student.student_lrn,
      first_name: student.first_name,
      middle_name: student.middle_name,
      last_name: student.last_name,
      gender: student.gender,
      academic_level_id: student.academic_level_id,
    })),
  ]));

  return {
    setup: {
      academicLevelId: result.academic_level.academic_level_id,
      academicLevelName: result.academic_level.level_name,
      academicYear: result.academic_year,
      sections,
    },
    assignmentState: {
      academicLevelId: result.academic_level.academic_level_id,
      unassignedStudents: [],
      assignmentsBySection,
      selectedStudentIds: new Set(),
    },
  };
}

function ValidationErrorPanel({ error, onDownloadTemplate }: { error: ImportValidationErrorState; onDownloadTemplate: () => void }) {
  const hasHeaderError = error.details.some((detail) => isHeaderValidationCode(detail.code));
  const showGeneralMessage = error.message.trim().toLocaleLowerCase() !== "csv validation failed.";

  return (
    <Card className="grid gap-2 border-destructive bg-destructive/10 p-4 text-sm text-destructive">
      <Text as="h6" className="font-bold">CSV validation failed.</Text>
      {showGeneralMessage && <p>{error.message}</p>}
      {hasHeaderError && (
        <div className="grid gap-2 rounded border border-destructive/40 bg-card p-3">
          <p className="font-bold text-xs">Required Header Template:</p>
          <code className="break-all rounded bg-muted p-2 text-[11px] font-mono">{CLASS_IMPORT_TEMPLATE_HEADER_ROW}</code>
          <Button size="sm" variant={"outline"} className="w-fit" onClick={onDownloadTemplate}>
            <Download className="size-3 mr-1" /> Download Header Template
          </Button>
        </div>
      )}
      {!!error.details.length && (
        <ul className="grid gap-1 text-xs">
          {error.details.map((item, index) => (
            <li key={`${item.code}-${index}`}>- {item.message}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

async function preflightClassImportCsv(file: File): Promise<ImportValidationErrorState | null> {
  const text = await file.text();
  const parseResult = parseCsvRows(text);
  if (parseResult.malformed) {
    return { message: "The CSV file is malformed. Ensure fields with commas or quotes are properly escaped.", details: [] };
  }
  if (!parseResult.rows.length) {
    return { message: "The selected CSV file is empty.", details: [] };
  }

  const headerValues = parseResult.rows[0].values.map((item) => item.trim());
  const headerMatch = CLASS_IMPORT_TEMPLATE_HEADERS.length === headerValues.length
    && CLASS_IMPORT_TEMPLATE_HEADERS.every((header, index) => header === headerValues[index]);
  if (!headerMatch) {
    return {
      message: "CSV headers do not match the required template.",
      details: [{ code: "invalid_headers", message: "Header row must match the required import format." }],
    };
  }

  const details: ClassImportValidationErrorItem[] = [];
  const lrnOccurrences = new Map<string, number[]>();

  parseResult.rows.slice(1).forEach(({ rowNumber, values }) => {
    const rawLrn = (values[6] ?? "").trim();
    if (!rawLrn) return;
    if (isScientificNotation(rawLrn)) {
      details.push({
        code: "student_lrn_scientific_notation",
        message: `Row ${rowNumber}: Student LRN "${rawLrn}" appears to be in scientific notation.`,
      });
      return;
    }
    const rows = lrnOccurrences.get(rawLrn) ?? [];
    rows.push(rowNumber);
    lrnOccurrences.set(rawLrn, rows);
  });

  lrnOccurrences.forEach((rows, lrn) => {
    if (rows.length > 1) {
      details.push({
        code: "duplicate_student_lrn",
        message: `Student LRN "${lrn}" is duplicated on rows ${rows.join(", ")}.`,
      });
    }
  });

  return details.length ? { message: "CSV preflight check failed.", details: details.slice(0, 10) } : null;
}

function parseCsvRows(text: string): CsvParseResult {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: ParsedCsvRow[] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let rowNumber = 1;
  let malformed = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (char === "\n" && !inQuotes) {
      row.push(cell);
      rows.push({ rowNumber, values: row });
      row = [];
      cell = "";
      rowNumber += 1;
      continue;
    }

    cell += char;
  }

  if (inQuotes) malformed = true;
  if (cell || row.length) {
    row.push(cell);
    rows.push({ rowNumber, values: row });
  }

  return {
    malformed,
    rows: rows.filter((item, index) => index === 0 || item.values.some((value) => value.trim() !== "")),
  };
}

function isScientificNotation(value: string) {
  return /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(value);
}

function isHeaderValidationCode(code: string) {
  return code === "invalid_header" || code === "invalid_headers";
}

function toImportValidationError(error: unknown): ImportValidationErrorState {
  if (!(error instanceof ApiRequestError)) {
    return { message: "Unable to connect to the server. Please try again.", details: [] };
  }
  if (error.status === 401) return { message: "Your session has expired. Please sign in again.", details: [] };
  if (error.status === 403) return { message: "You do not have permission to validate class imports.", details: [] };

  const data = safeImportErrorResponse(error.data);
  if (!data) return { message: error.message || "Unable to validate CSV. Please try again.", details: [] };
  return {
    message: importCodeMessage(data.code, data.message),
    details: data.errors.filter((item) => isSafeMessage(item.message)),
  };
}

function safeImportErrorResponse(data: unknown): ClassImportValidationErrorResponse | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  if (typeof value.message !== "string" || typeof value.code !== "string" || !Array.isArray(value.errors)) return null;
  return {
    message: value.message,
    code: value.code,
    errors: value.errors.filter(isImportErrorItem),
  };
}

function isImportErrorItem(value: unknown): value is ClassImportValidationErrorItem {
  return Boolean(value && typeof value === "object"
    && "code" in value && typeof value.code === "string"
    && "message" in value && typeof value.message === "string");
}

function isSafeMessage(message: string) {
  return !/stack|traceback|sql|constraint|\/app\/|\\app\\/i.test(message);
}

function importCodeMessage(code: string, fallback?: string) {
  const messages: Record<string, string> = {
    csv_validation_failed: "CSV validation failed.",
    invalid_csv_file: "Please upload a valid CSV file.",
    invalid_file_type: "Only CSV files are supported.",
    empty_csv: "The selected CSV file is empty.",
    file_empty: "The selected CSV file is empty.",
    invalid_headers: "CSV headers do not match the required template.",
    missing_required_field: "A required CSV field is missing.",
    invalid_grade_level: "Grade level must be a whole number.",
    academic_level_mismatch: "CSV grade level does not match the selected academic level.",
    duplicate_student_lrn: "A student LRN appears more than once in the CSV.",
    student_lrn_scientific_notation: "One or more Student LRNs were converted to scientific notation.",
    student_not_found: "One or more student accounts could not be found.",
    student_already_assigned: "One or more students are already assigned to a class.",
    adviser_not_found: "One or more advisers could not be found.",
    adviser_already_assigned: "An adviser is already assigned to another class section.",
    duplicate_adviser_assignment: "An adviser is assigned to multiple imported sections.",
    conflicting_section_adviser: "A section uses conflicting adviser information.",
    section_already_exists: "A section already exists for the selected academic level and active academic year.",
    active_academic_year_missing: "No active academic year is configured.",
    active_academic_year_multiple: "Multiple active academic years were detected.",
  };
  return messages[code] ?? fallback ?? "Unable to validate CSV. Please try again.";
}

function StatePanel({ message, detail, children }: { message: string; detail?: string; children?: ReactNode }) {
  return (
    <div className="grid gap-3 rounded-md border-2 border-border bg-card p-5 text-sm">
      <p className="font-bold">{message}</p>
      {detail && detail !== message && <p className="text-xs text-muted-foreground">{detail}</p>}
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}

function adviserName(adviser: ValidatedImportAdviser) {
  return [adviser.first_name, adviser.middle_name, adviser.last_name, adviser.suffix].filter(Boolean).join(" ");
}
