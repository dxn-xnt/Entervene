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
import Field from "../fields/Field";
import SelectField from "../fields/SelectField";
import { retroButton } from "../utils";

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
      setFileError(file.type === "text/csv" ? "Please upload a valid CSV file." : "Only CSV files are supported.");
      clearFileInput();
      return;
    }
    if (file.size === 0) {
      setSelectedFile(null);
      setFileError("The selected CSV file is empty.");
      clearFileInput();
      return;
    }

    setSelectedFile(file);
    setFileError("");
  }

  function downloadTemplate() {
    const blob = new Blob([`${CLASS_IMPORT_TEMPLATE_HEADER_ROW}\r\n`], { type: "text/csv;charset=utf-8" });
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
        <button className={retroButton("bg-[#79bd80]")} onClick={retryLoading}>Retry</button>
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
          <input readOnly value={options.academic_year.year_label} className="h-10 rounded-md border border-black bg-black/5 px-3 text-sm text-black/70" />
        </Field>
        <Field label="Academic Level">
          <SelectField disabled={noLevels || isValidating} value={selectedAcademicLevelId} onChange={(value) => {
            setSelectedAcademicLevelId(value);
            clearValidationState();
          }}>
            {!selectedAcademicLevelId && <option value="">Select academic level</option>}
            {options.academic_levels.map((level) => <option key={level.academic_level_id} value={level.academic_level_id}>{level.level_name}</option>)}
          </SelectField>
          {noLevels && <InlineError message="No academic levels are available." />}
          {selectedLevel && <p className="mt-1 text-[11px] font-semibold text-black/60">Selected: {selectedLevel.level_name}</p>}
        </Field>
      </div>

      <section className="grid gap-3 rounded-md border border-black bg-[#fffdf5] p-4">
        <div>
          <h3 className="font-bold">Upload CSV file</h3>
          <p className="text-xs text-black/65">Choose a CSV file that follows the required class-import template.</p>
          <p className="mt-1 text-xs font-semibold text-black/70">Important: Keep student_lrn values as complete 12-digit numbers. When editing in spreadsheet software, format the student_lrn column as Text before pasting LRNs.</p>
        </div>
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
        {!selectedFile ? (
          <button disabled={isValidating} className={retroButton("w-fit bg-[#79bd80] disabled:cursor-not-allowed disabled:opacity-50")} onClick={openFilePicker}>
            <Upload className="size-4" /> Choose CSV File
          </button>
        ) : (
          <div className="grid gap-3 rounded-md border border-black bg-white p-3">
            <div className="flex items-start gap-2">
              <FileText className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase text-black/55">Selected CSV file</p>
                <p className="break-words text-sm font-bold">{selectedFile.name}</p>
                <p className="text-xs text-black/65">{readableFileSize(selectedFile.size)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button disabled={isValidating} className={retroButton("px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50")} onClick={openFilePicker}>Replace file</button>
              <button disabled={isValidating} className={retroButton("px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50")} onClick={removeFile}><X className="size-3" />Remove</button>
            </div>
          </div>
        )}
        {fileError && <InlineError message={fileError} />}
      </section>

      <div className="grid gap-2 rounded-md border border-black bg-[#fff8d7] p-3 text-sm">
        <div className="flex items-center gap-2 font-bold"><CheckCircle2 className="size-4" /> CSV validation</div>
        {isValidating ? <p className="text-xs font-semibold text-black/70">Uploading and validating CSV...</p> : <p className="text-xs text-black/70">Validate the selected CSV against existing class advisers and student accounts.</p>}
      </div>

      {validationError && <ValidationErrorPanel error={validationError} onDownloadTemplate={downloadTemplate} />}
      {validationResult && <ValidationSuccessPanel result={validationResult} canContinue={canContinueToAssignments(validationResult) && !isValidating && !validationError} onContinue={continueToAssignments} />}

      <div className="flex flex-wrap justify-between gap-2">
        <button className={retroButton()} onClick={downloadTemplate}><Download className="size-4" /> Download Template</button>
        <button disabled={!canValidate} className={retroButton("bg-[#79bd80] disabled:cursor-not-allowed disabled:opacity-50")} onClick={validateCsv}>
          {isValidating ? "Uploading and validating CSV..." : "Validate CSV"}
        </button>
      </div>
    </div>
  );
}

function readableFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function InlineError({ message }: { message: string }) {
  return <p className="text-[11px] font-semibold text-red-700">{message}</p>;
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
    <section className="grid gap-3 rounded-md border border-black bg-[#d8efca] p-4 text-sm">
      <div>
        <h3 className="font-bold">CSV validated successfully</h3>
        <p>Academic Year: {result.academic_year.year_label}</p>
        <p>Academic Level: {result.academic_level.level_name}</p>
        <p>Sections detected: {result.summary.section_count}</p>
        <p>Students resolved: {result.summary.student_count}</p>
      </div>
      <div className="grid gap-2">
        <h4 className="font-bold">Sections</h4>
        {result.sections.map((section) => (
          <div key={`${section.section_name}-${section.adviser.staff_id}`} className="rounded-md border border-black bg-white p-3">
            <p className="font-bold">{section.section_name}</p>
            <p className="text-xs">Adviser: {adviserName(section.adviser)} - {section.adviser.staff_id}</p>
            <p className="text-xs">Students: {section.students.length}</p>
          </div>
        ))}
      </div>
      <button disabled={!canContinue} className={retroButton("w-fit bg-[#79bd80] disabled:cursor-not-allowed disabled:opacity-50")} onClick={onContinue}>Continue to Assign Students</button>
    </section>
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
    <section className="grid gap-2 rounded-md border border-red-700 bg-red-50 p-4 text-sm text-red-800">
      <h3 className="font-bold">CSV validation failed.</h3>
      {showGeneralMessage && <p>{error.message}</p>}
      {hasHeaderError && (
        <div className="grid gap-2 rounded border border-red-700/40 bg-white/70 p-3">
          <p>The uploaded CSV headers do not match the required Class Management template.</p>
          <div className="grid gap-1">
            <p className="text-xs font-bold">Expected ordered headers:</p>
            <p className="break-words rounded border border-red-700/30 bg-white px-2 py-1 font-mono text-xs">{CLASS_IMPORT_TEMPLATE_HEADER_ROW}</p>
          </div>
          <p className="text-xs font-semibold">Make sure you uploaded the Class Management template, not a Student-account import file.</p>
          <button className={retroButton("w-fit bg-[#79bd80] text-black")} onClick={onDownloadTemplate}>
            <Download className="size-4" /> Download Class Import Template
          </button>
        </div>
      )}
      {!!error.details.length && (
        <div className="grid gap-2">
          {error.details.map((detail, index) => (
            <div key={`${detail.row ?? "file"}-${detail.field ?? "field"}-${detail.code}-${index}`} className="rounded border border-red-700/40 bg-white/70 p-2">
              <p className="text-xs font-bold">{errorLocation(detail)}</p>
              <p>{mappedImportMessage(detail)}</p>
              {detail.code === "student_not_found" && <p className="mt-1 text-xs font-semibold">Add this student through User Management, then validate the CSV again.</p>}
              <p className="mt-1 text-[11px] text-red-700/75">Code: {detail.code}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function adviserName(adviser: ValidatedImportAdviser) {
  return [adviser.first_name, adviser.middle_name, adviser.last_name, adviser.suffix].filter(Boolean).join(" ");
}

function errorLocation(detail: ClassImportValidationErrorItem) {
  const row = detail.row ? `Row ${detail.row}` : "File";
  return detail.field ? `${row} - ${detail.field}` : row;
}

function mappedImportMessage(detail: ClassImportValidationErrorItem) {
  if (detail.code === "student_not_found") {
    const lrn = detail.message.match(/\b\d{12}\b/)?.[0];
    return lrn ? `Student account not found for LRN ${lrn}.` : detail.message;
  }
  if (detail.code === "student_lrn_scientific_notation") {
    return "Student LRN was converted to scientific notation by spreadsheet software. Use the complete 12-digit LRN and format the student_lrn column as Text before saving the CSV. Copy the original LRN directly from the Student account record, then upload the corrected CSV again.";
  }
  return detail.message || importCodeMessage(detail.code);
}

async function preflightClassImportCsv(file: File): Promise<ImportValidationErrorState | null> {
  const text = await file.text();
  const parsed = parseCsvRows(text.replace(/^\uFEFF/, ""));

  if (parsed.malformed) {
    return {
      message: "CSV validation failed.",
      details: [{
        row: null,
        field: null,
        code: "csv_parse_error",
        message: "The CSV file could not be parsed. Check for malformed quoted values, then try again.",
      }],
    };
  }

  const [headerRow, ...dataRows] = parsed.rows;
  if (!headerRow || headerRow.values.join(",") !== CLASS_IMPORT_TEMPLATE_HEADER_ROW) {
    return {
      message: "CSV validation failed.",
      details: [{
        row: null,
        field: null,
        code: "invalid_headers",
        message: "CSV headers must exactly match the required ordered header list.",
      }],
    };
  }

  const studentLrnIndex = CLASS_IMPORT_TEMPLATE_HEADERS.indexOf("student_lrn");
  const details = dataRows.flatMap((row): ClassImportValidationErrorItem[] => {
    if (row.values.every((value) => value.trim() === "")) return [];
    const studentLrn = (row.values[studentLrnIndex] ?? "").trim();

    if (isScientificNotation(studentLrn)) {
      return [{
        row: row.rowNumber,
        field: "student_lrn",
        code: "student_lrn_scientific_notation",
        message: "Student LRN was converted to scientific notation by spreadsheet software. Use the complete 12-digit LRN and format the student_lrn column as Text before saving the CSV.",
      }];
    }

    if (!/^\d{12}$/.test(studentLrn)) {
      return [{
        row: row.rowNumber,
        field: "student_lrn",
        code: "student_lrn_invalid_format",
        message: "Student LRN must contain exactly 12 numeric characters.",
      }];
    }

    return [];
  });

  return details.length ? { message: "CSV validation failed.", details } : null;
}

function parseCsvRows(text: string): CsvParseResult {
  const rows: ParsedCsvRow[] = [];
  let row: string[] = [];
  let cell = "";
  let rowNumber = 1;
  let inQuotes = false;
  let malformed = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (inQuotes) {
      if (char === "\"") {
        if (nextChar === "\"") {
          cell += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === "\"") {
      if (cell.length === 0) inQuotes = true;
      else malformed = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push({ rowNumber, values: row });
      row = [];
      cell = "";
      rowNumber += 1;
    } else if (char !== "\r") {
      cell += char;
    }
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
    <div className="grid gap-3 rounded-md border border-black bg-[#fff8d7] p-5 text-sm">
      <p className="font-bold">{message}</p>
      {detail && detail !== message && <p className="text-xs text-black/70">{detail}</p>}
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}
