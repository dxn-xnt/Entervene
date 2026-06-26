import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { Alert } from "@/components/retroui/Alert";
import { apiFetch } from "@/lib/api";
import type { InviteUserPayload } from "@/lib/api";

type Step = "choose" | "import" | "manual";
type Role = "Teacher" | "Student" | "Admin";
type ImportRole = "Teacher" | "Student";
type ImportErrorItem = { row: number; field: string; value: string; reason: string };
type ImportResult = {
  message?: string;
  created?: number;
  skipped?: number;
  created_count?: number;
  failed_count?: number;
  skipped_emails?: string[];
  errors?: ImportErrorItem[];
};

interface ManualFormData {
  firstName: string;
  lastName: string;
  middleName: string;
  email: string;
  role: Role;
  // Staff-specific
  dob: string;
  gender: string;
  contactNumber: string;
  address: string;
  hiredDate: string;
  employmentStatus: string;
  // Student-specific
  studentLrn: string;
  suffix: string;
  gradeLevel: string;
}

const EMPTY_FORM: ManualFormData = {
  firstName: "",
  lastName: "",
  middleName: "",
  email: "",
  role: "Teacher",
  dob: "",
  gender: "",
  contactNumber: "",
  address: "",
  hiredDate: "",
  employmentStatus: "",
  studentLrn: "",
  suffix: "",
  gradeLevel: "",
};

const IMPORT_TEMPLATES: Record<
  ImportRole,
  { fileName: string; columns: string[]; sample: string[] }
> = {
  Student: {
    fileName: "student_import_template.csv",
    columns: [
      "first_name",
      "last_name",
      "middle_name",
      "email",
      "student_lrn",
      "gender",
      "contact_number",
      "address",
      "grade_level",
      "suffix",
      "dob",
    ],
    sample: [
      "Maria",
      "Santos",
      "Reyes",
      "maria.santos@student.ph",
      "123456789012",
      "Female",
      "09170000000",
      "12 Marcos Highway, Antipolo City",
      "7",
      "",
      "\t2008-04-15",
    ],
  },
  Teacher: {
    fileName: "teacher_import_template.csv",
    columns: [
      "first_name",
      "last_name",
      "middle_name",
      "email",
      "gender",
      "contact_number",
      "address",
      "suffix",
      "dob",
      "hired_date",
      "employment_status",
    ],
    sample: [
      "Ana",
      "Dela Cruz",
      "Rivera",
      "ana.delacruz@school.ph",
      "Female",
      "09170000000",
      "Antipolo City",
      "",
      "\t1990-04-15",
      "2024-06-01",
      "Regular",
    ],
  },
};

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function downloadCsvTemplate(role: ImportRole) {
  const template = IMPORT_TEMPLATES[role];
  const csv = [template.columns, template.sample]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  const blob = new Blob([`${csv}\r\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = template.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function requiredColumnsForRole(role: ImportRole) {
  return role === "Student"
    ? ["first_name", "last_name", "email", "student_lrn"]
    : ["first_name", "last_name", "email"];
}

async function validateCsvImportFile(file: File, role: ImportRole): Promise<ImportResult | null> {
  if (!file.name.toLowerCase().endsWith(".csv")) return null;

  const rows = parseCsvRows(await file.text());
  const headers = rows[0]?.map((header, index) => index === 0 ? header.replace(/^\uFEFF/, "").trim() : header.trim()) ?? [];
  const headerSet = new Set(headers);
  const missingRequired = requiredColumnsForRole(role).filter((column) => !headerSet.has(column));
  const hasStudentGradeColumn =
    role !== "Student" ||
    ["grade_level", "academic_level", "academic_level_id"].some((column) => headerSet.has(column));

  if (missingRequired.length || !hasStudentGradeColumn) {
    return {
      message: `This file does not match the ${role} import template. Download the ${role} CSV template and try again.`,
      failed_count: 1,
      errors: [
        {
          row: 1,
          field: "file",
          value: "",
          reason: missingRequired.length
            ? `Missing required column(s): ${missingRequired.join(", ")}.`
            : "Missing a student grade column: grade_level, academic_level, or academic_level_id.",
        },
      ],
    };
  }

  const dobIndex = headers.findIndex((header) => header === "dob" || header === "date_of_birth");
  if (dobIndex === -1) return null;

  const errors: ImportErrorItem[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const value = (rows[index][dobIndex] ?? "").trim();
    if (value && !isValidIsoDate(value)) {
      errors.push({
        row: index + 1,
        field: headers[dobIndex],
        value,
        reason: `Invalid DOB "${value}". Use YYYY-MM-DD, example 2008-04-15.`,
      });
    }
  }

  if (!errors.length) return null;
  return {
    message: "CSV DOB validation failed.",
    failed_count: errors.length,
    errors,
  };
}

function formatImportError(error: ImportErrorItem) {
  const isDobError = error.field === "dob" || error.field === "date_of_birth";
  if (isDobError) {
    const value = error.value ? ` "${error.value}"` : "";
    return `Row ${error.row}: Invalid DOB${value}. Use YYYY-MM-DD, example 2008-04-15.`;
  }
  return `Row ${error.row}, ${error.field}: ${error.reason}`;
}

function importSummary(result: ImportResult) {
  if (result.errors?.length) {
    return result.message ?? "Import failed. Please check the errors below.";
  }
  return `${result.message ? `${result.message}. ` : ""}Imported ${
    result.created_count ?? result.created ?? 0
  } user(s); failed ${result.failed_count ?? result.skipped ?? 0} user(s).`;
}

function backendImportResult(data: unknown, role: ImportRole): ImportResult {
  if (!data || typeof data !== "object") {
    return {
      message: "Import failed. Please check the file and try again.",
      failed_count: 1,
      errors: [{ row: 1, field: "file", value: "", reason: "The server did not return a readable error." }],
    };
  }

  if ("detail" in data && data.detail && typeof data.detail === "object") {
    return data.detail as ImportResult;
  }

  if ("detail" in data && typeof data.detail === "string") {
    const message = data.detail.includes("File missing")
      ? `This file does not match the ${role} import template. Download the ${role} CSV template and try again.`
      : data.detail;
    return {
      message,
      failed_count: 1,
      errors: [{ row: 1, field: "file", value: "", reason: data.detail }],
    };
  }

  return data as ImportResult;
}

interface AddUserModalProps {
  open: boolean;
  onClose: () => void;
  onUserAdded?: (data: ManualFormData) => void;
}

export default function AddUserModal({
  open,
  onClose,
  onUserAdded,
}: AddUserModalProps) {
  const [step, setStep] = useState<Step>("choose");
  const [form, setForm] = useState<ManualFormData>(EMPTY_FORM);
  const [dragOver, setDragOver] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [importRole, setImportRole] = useState<ImportRole>("Teacher");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const handleClose = () => {
    setStep("choose");
    setForm(EMPTY_FORM);
    setDragOver(false);
    setUploadedFile(null);
    setImportResult(null);
    setImporting(false);
    onClose();
  };

  const handleImportSubmit = async () => {
    if (!uploadedFile) return;

    const validationResult = await validateCsvImportFile(uploadedFile, importRole);
    if (validationResult) {
      setImportResult(validationResult);
      return;
    }

    setImporting(true);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append("file", uploadedFile);

      const res = await apiFetch(
        `/api/v1/admin/users/upload-csv?role=${encodeURIComponent(importRole)}`,
        {
          method: "POST",
          body: formData,
        },
      );

      const data = await res.json().catch(() => ({}));
      setImportResult(res.ok ? data : backendImportResult(data, importRole));

      if (res.ok) {
        onUserAdded?.(form);
      }
    } finally {
      setImporting(false);
    }
  };

  const handleField = (field: keyof ManualFormData, value: string) => {
    setForm((prev) => {
      if (field === "role" && value === "Admin") {
        return { ...prev, role: value as Role, dob: "" };
      }
      return { ...prev, [field]: value };
    });
  };

  const handleManualSubmit = async () => {
    if (manualSubmitting) return;
    if (form.dob && !/^\d{4}-\d{2}-\d{2}$/.test(form.dob)) {
      window.alert("DOB must use YYYY-MM-DD format.");
      return;
    }

    setManualSubmitting(true);
    try {
      const payload: InviteUserPayload = {
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        middle_name: form.middleName.trim(),
        email: form.email.trim().toLowerCase(),
        role: form.role,
        suffix: form.suffix.trim(),
        gender: form.gender,
        contact_number: form.contactNumber.trim(),
        address: form.address.trim(),
        hired_date: form.hiredDate,
        employment_status: form.employmentStatus,
        student_lrn: form.studentLrn.trim(),
        grade_level: form.gradeLevel ? Number(form.gradeLevel) : null,
      };

      if (form.role !== "Admin") {
        payload.dob = form.dob;
      }

      const res = await apiFetch("/api/v1/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        window.alert(data.detail ?? "Unable to send invite.");
        return;
      }

      onUserAdded?.(form);
      handleClose();
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Unable to send invite.",
      );
    } finally {
      setManualSubmitting(false);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void selectImportFile(file, importRole);
  };

  const selectImportFile = async (file: File, role: ImportRole) => {
    setImportResult(null);
    setUploadedFile(file);
    const validationResult = await validateCsvImportFile(file, role);
    if (validationResult) {
      setImportResult(validationResult);
      return;
    }
  };

  const handleImportRoleChange = (role: ImportRole) => {
    setImportRole(role);
    setImportResult(null);
    if (uploadedFile) void selectImportFile(uploadedFile, role);
  };

  const isStudent = form.role === "Student";
  const isAdmin = form.role === "Admin";
  const hasImportErrors = Boolean(importResult?.errors?.length);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-md rounded-xl border border-black overflow-hidden"
        style={{ background: "#faf9f6" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── STEP: CHOOSE ─────────────────────────────────── */}
        {step === "choose" && (
          <>
            <div className="flex items-center justify-between p-4 border-b">
              <span className="font-semibold text-base ">Add new users</span>
              <button
                onClick={handleClose}
                className=" hover:text-gray-700 text-lg leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex gap-3 p-4 border-b">
              <button
                onClick={() => setStep("import")}
                className="flex-1 rounded-lg p-4 text-left transition-all border bg-[#7ABA78] hover:opacity-90 active:scale-95 overflow-hidden"
              >
                <div className="flex items-center gap-2 font-semibold text-sm mb-1">
                  <svg
                    width="16"
                    height="16"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  Import from file
                </div>
                <p className="text-xs opacity-80">
                  Upload a CSV or Excel file to add multiple users at once
                </p>
              </button>
              <button
                onClick={() => setStep("manual")}
                className="flex-1 rounded-lg p-4 text-left transition-all border bg-[#7ABA78] hover:opacity-90 active:scale-95 overflow-hidden"
              >
                <div className="flex items-center gap-2 font-semibold text-sm mb-1">
                  <svg
                    width="16"
                    height="16"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Create manually
                </div>
                <p className="text-xs opacity-80">
                  Add individual user accounts one at a time
                </p>
              </button>
            </div>
            <div className="flex justify-end p-4">
              <button
                onClick={handleClose}
                className="px-4 py-1.5 rounded-lg border text-sm hover:bg-gray-100 transition"
                // style={{ borderColor: "#d1cfc9" }}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {/* ── STEP: IMPORT ─────────────────────────────────── */}
        {step === "import" && (
          <>
            <div className="flex items-center justify-between p-4 border-b border-black bg-[#7ABA78]">
              <span className="font-semibold text-s">Import from file</span>
              <button
                onClick={handleClose}
                className=" hover:text-gray-700 text-lg leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex flex-col gap-5 p-4">
              <div>
                <label className="text-xs font-medium text-gray-600">
                  Role for imported users
                </label>
                <select
                  value={importRole}
                  onChange={(e) =>
                    handleImportRoleChange(e.target.value as ImportRole)
                  }
                  className="w-full border rounded-lg px-3 pr-8 py-1.5 text-sm bg-white cursor-pointer"
                >
                  <option value="Teacher">Teacher</option>
                  <option value="Student">Student</option>
                </select>
              </div>

              <div className="rounded-lg border bg-white px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-gray-600">
                    Use YYYY-MM-DD for DOB, for example 2008-04-15.
                  </p>
                  <button
                    type="button"
                    onClick={() => downloadCsvTemplate(importRole)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-gray-50 transition cursor-pointer"
                  >
                    <Download className="size-3.5" />
                    Download {importRole} Template
                  </button>
                </div>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-3 rounded-lg cursor-pointer transition-all"
                style={{
                  minHeight: 140,
                  border: `1px solid ${hasImportErrors ? "#991b1b" : dragOver ? "#5c8f5c" : "black"}`,
                  background: hasImportErrors ? "#fff1f2" : dragOver ? "#f0f7f0" : "#fff",
                }}
              >
                {uploadedFile ? (
                  <>
                    {/* <svg
                      width="28"
                      height="28"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="#5c8f5c"
                      strokeWidth="2"
                    >
                      <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg> */}
                    <span className="text-sm font-medium text-gray-700">
                      {uploadedFile.name}
                    </span>
                    <span className="text-xs text-gray-400">
                      {(uploadedFile.size / 1024).toFixed(1)} KB
                    </span>
                    {hasImportErrors ? (
                      <span className="text-xs font-medium text-red-800">
                        Fix the file or choose a corrected CSV.
                      </span>
                    ) : (
                      <span className="text-xs text-emerald-700">
                        Ready to import
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      className="px-4 py-1.5 rounded-lg border text-sm font-medium hover:bg-gray-50 transition cursor-pointer"
                      // style={{ borderColor: "#ccc" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                    >
                      Upload
                    </button>
                    <span className="text-xs">Drag & drop file here</span>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void selectImportFile(f, importRole);
                }}
              />
              <p className="text-xs text-gray-600">
                DOB format for CSV import: YYYY-MM-DD, example 2008-04-15.
              </p>

              {importResult && (
                <Alert
                  status={importResult.errors?.length ? "error" : "success"}
                  className="px-3 py-2 text-xs"
                >
                  <Alert.Title className="text-sm">
                    {importResult.errors?.length ? "Import needs attention" : "Import complete"}
                  </Alert.Title>
                  <Alert.Description>
                    {importSummary(importResult)}
                  </Alert.Description>
                  {importResult.skipped_emails?.length
                    ? ` Skipped: ${importResult.skipped_emails.join(", ")}`
                    : ""}
                  {importResult.errors?.length ? (
                    <ul className="mt-2 max-h-24 overflow-y-auto list-disc pl-4">
                      {importResult.errors.slice(0, 5).map((error, index) => (
                        <li key={`${error.row}-${error.field}-${index}`}>
                          {formatImportError(error)}
                        </li>
                      ))}
                      {importResult.errors.length > 5 ? (
                        <li>
                          {importResult.errors.length - 5} more error(s). Fix the first errors and try again.
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                </Alert>
              )}
            </div>
            <div
              className="flex justify-end border-t p-4 gap-2"
              // style={{ borderTop: "1px solid #e5e3de" }}
            >
              <button
                onClick={() => setStep("choose")}
                className="px-4 py-1.5 rounded-lg border text-sm hover:bg-gray-100 transition cursor-pointer"
                // style={{ borderColor: "#d1cfc9" }}
              >
                Back
              </button>
              <button
                disabled={!uploadedFile || importing || hasImportErrors}
                className="px-4 py-1.5 rounded-lg border text-sm font-semibold transition cursor-pointer bg-[#7ABA78] disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleImportSubmit}
              >
                {importing ? "Importing..." : "Import"}
              </button>
            </div>
          </>
        )}

        {/* ── STEP: MANUAL ─────────────────────────────────── */}
        {step === "manual" && (
          <>
            <div className="flex items-center justify-between p-4 border-b border-black bg-[#7ABA78]">
              <span className="font-semibold text-s">Create user manually</span>
              <button
                onClick={handleClose}
                className=" hover:text-gray-700 text-lg leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-5 flex flex-col gap-3 max-h-[70vh] overflow-y-auto">
              {/* Role — first so fields adapt below */}
              <Field label="Role">
                <select
                  value={form.role}
                  onChange={(e) => handleField("role", e.target.value as Role)}
                  className="w-full border rounded-lg px-3 py-1.5 text-sm bg-white"
                >
                  <option>Teacher</option>
                  <option>Student</option>
                  <option>Admin</option>
                </select>
              </Field>

              {/* Common name fields */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="First Name">
                  <input
                    className="w-full border rounded-lg px-3 py-1.5 text-sm"
                    placeholder="John"
                    value={form.firstName}
                    onChange={(e) => handleField("firstName", e.target.value)}
                  />
                </Field>
                <Field label="Last Name">
                  <input
                    className="w-full border rounded-lg px-3 py-1.5 text-sm"
                    placeholder="Doe"
                    value={form.lastName}
                    onChange={(e) => handleField("lastName", e.target.value)}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Middle Name">
                  <input
                    className="w-full border rounded-lg px-3 py-1.5 text-sm"
                    placeholder="(optional)"
                    value={form.middleName}
                    onChange={(e) => handleField("middleName", e.target.value)}
                  />
                </Field>
                {(isStudent || !isAdmin) && (
                  <Field label="Suffix">
                    <input
                      className="w-full border rounded-lg px-3 py-1.5 text-sm"
                      placeholder="Jr., Sr., III…"
                      value={form.suffix}
                      onChange={(e) => handleField("suffix", e.target.value)}
                    />
                  </Field>
                )}
              </div>

              <Field label="Email Address">
                <input
                  type="email"
                  className="w-full border rounded-lg px-3 py-1.5 text-sm"
                  placeholder="john@example.com"
                  value={form.email}
                  onChange={(e) => handleField("email", e.target.value)}
                />
              </Field>

              {/* Gender + Contact */}
              {!isAdmin && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Gender">
                    <select
                      className="w-full border rounded-lg px-3 py-1.5 text-sm bg-white"
                      value={form.gender}
                      onChange={(e) => handleField("gender", e.target.value)}
                    >
                      <option value="">Select…</option>
                      <option>Male</option>
                      <option>Female</option>
                      <option>Other</option>
                    </select>
                  </Field>
                  <Field label="Contact Number">
                    <input
                      className="w-full border rounded-lg px-3 py-1.5 text-sm"
                      placeholder="+63 9XX XXX XXXX"
                      value={form.contactNumber}
                      onChange={(e) =>
                        handleField("contactNumber", e.target.value)
                      }
                    />
                  </Field>
                </div>
              )}

              {/* Address */}
              {!isAdmin && (
                <Field label="Address">
                  <textarea
                    rows={2}
                    className="w-full border rounded-lg px-3 py-1.5 text-sm resize-none"
                    placeholder="Street, Barangay, City…"
                    value={form.address}
                    onChange={(e) => handleField("address", e.target.value)}
                  />
                </Field>
              )}

              {!isAdmin && (
                <Field label="Date of Birth">
                  <input
                    type="date"
                    className="w-full border rounded-lg px-3 py-1.5 text-sm"
                    value={form.dob}
                    onChange={(e) => handleField("dob", e.target.value)}
                  />
                  <p className="text-xs text-gray-500">
                    Format: YYYY-MM-DD
                  </p>
                  <p className="text-xs text-gray-500">
                    Example: 2008-04-15
                  </p>
                </Field>
              )}

              {/* ── Teacher/Staff-specific ── */}
              {!isStudent && !isAdmin && (
                <>
                  <div>
                    <Field label="Hired Date">
                      <input
                        type="date"
                        className="w-full border rounded-lg px-3 py-1.5 text-sm"
                        value={form.hiredDate}
                        onChange={(e) =>
                          handleField("hiredDate", e.target.value)
                        }
                      />
                    </Field>
                  </div>
                  <Field label="Employment Status">
                    <select
                      className="w-full border rounded-lg px-3 py-1.5 text-sm bg-white"
                      value={form.employmentStatus}
                      onChange={(e) =>
                        handleField("employmentStatus", e.target.value)
                      }
                    >
                      <option value="">Select…</option>
                      <option>Regular</option>
                      <option>Contractual</option>
                      <option>Part-time</option>
                    </select>
                  </Field>
                </>
              )}

              {/* ── Student-specific ── */}
              {isStudent && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Student LRN">
                      <input
                        className="w-full border rounded-lg px-3 py-1.5 text-sm font-mono"
                        placeholder="12-digit LRN"
                        maxLength={12}
                        value={form.studentLrn}
                        onChange={(e) =>
                          handleField(
                            "studentLrn",
                            e.target.value.replace(/\D/g, ""),
                          )
                        }
                      />
                    </Field>
                    <Field label="Grade Level">
                      <select
                        className="w-full border rounded px-3 py-1.5 text-sm bg-white"
                        style={{ borderColor: "#ccc" }}
                        value={form.gradeLevel}
                        onChange={(e) => handleField("gradeLevel", e.target.value)}
                      >
                        <option value="">Select...</option>
                        <option value="7">Grade 7</option>
                        <option value="8">Grade 8</option>
                        <option value="9">Grade 9</option>
                        <option value="10">Grade 10</option>
                        <option value="11">Grade 11</option>
                        <option value="12">Grade 12</option>
                      </select>
                    </Field>
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end border-t p-4 gap-2">
              <button
                onClick={() => setStep("choose")}
                className="px-4 py-1.5 rounded-lg border text-sm hover:bg-gray-100 transition"
              >
                Back
              </button>
              <button
                onClick={handleManualSubmit}
                disabled={manualSubmitting}
                className="px-5 py-1.5 rounded-lg border text-sm font-semibold bg-[#7ABA78] transition hover:opacity-90"
              >
                {manualSubmitting ? "Sending..." : "Send Invitation"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium">{label}</label>
      {children}
    </div>
  );
}
