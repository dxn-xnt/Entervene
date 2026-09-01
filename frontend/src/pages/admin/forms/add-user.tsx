"use client";

import React, { useRef, useState } from "react";
import { Download, FileSpreadsheet, UserPlus, Upload } from "lucide-react";
import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { apiFetch } from "@/lib/api";
import type { InviteUserPayload } from "@/lib/api";
import { DialogueSelect } from "@/components/dialogue-select";
import { cn } from "@/lib/utils";

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

export interface ManualFormData {
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
  priorGwa: string;
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
  priorGwa: "",
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
      "general_average",
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
      "2008-04-15",
      "88.50",
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
      "1990-04-15",
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

function isValidDobFormat(value: string): boolean {
  const clean = value.trim().replace(/^[\t']/, "");
  if (!clean) return false;

  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    const [yearText, monthText, dayText] = clean.split("-");
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

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(clean)) {
    const [p1, p2, year] = clean.split("/").map(Number);
    return year >= 1900 && year <= 2100 && ((p1 >= 1 && p1 <= 12 && p2 >= 1 && p2 <= 31) || (p2 >= 1 && p2 <= 12 && p1 >= 1 && p1 <= 31));
  }

  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(clean)) {
    const [year, month, day] = clean.split("/").map(Number);
    return year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
  }

  return false;
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
    if (value && !isValidDobFormat(value)) {
      errors.push({
        row: index + 1,
        field: headers[dobIndex],
        value,
        reason: `Invalid DOB "${value}". Use YYYY-MM-DD or MM/DD/YYYY, example 2008-04-15 or 12/2/2004.`,
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
    return `Row ${error.row}: Invalid DOB${value}. Use YYYY-MM-DD or MM/DD/YYYY, example 2008-04-15 or 12/2/2004.`;
  }
  return `Row ${error.row}, ${error.field}: ${error.reason}`;
}

function importSummary(result: ImportResult) {
  if (result.errors?.length) {
    return result.message ?? "Import failed. Please check the errors below.";
  }
  return `${result.message ? `${result.message}. ` : ""}Imported ${result.created_count ?? result.created ?? 0
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

export interface AddUserModalProps {
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
        prior_gwa: form.priorGwa.trim() ? Number(form.priorGwa.trim()) : null,
        general_average: form.priorGwa.trim() ? Number(form.priorGwa.trim()) : null,
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
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }} >
      <Dialog.Content size="md" className="w-full overflow-hidden font-sans">
        <Dialog.Header asChild className="bg-primary text-primary-foreground font-head flex items-center justify-between">
          <div>
            <span className="font-bold text-lg">
              {step === "choose" && "Add New Users"}
              {step === "import" && "Import Users from File"}
              {step === "manual" && "Create User Manually"}
            </span>
          </div>
        </Dialog.Header>

        {/* ── STEP: CHOOSE ─────────────────────────────────── */}
        {step === "choose" && (
          <>
            <div className="grid grid-cols-2 gap-4 p-5">
              <DialogueSelect
                icon={FileSpreadsheet}
                title="Import file"
                description="Upload a CSV file to add multiple users at once."
                onClick={() => setStep("import")}
              />
              <DialogueSelect
                icon={UserPlus}
                title="Create manual"
                description="Add individual user accounts one at a time."
                onClick={() => setStep("manual")}
              />
            </div>

            <Dialog.Footer>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
            </Dialog.Footer>
          </>
        )}

        {/* ── STEP: IMPORT ─────────────────────────────────── */}
        {step === "import" && (
          <>
            <div className="flex flex-col gap-4 p-5">
              <Field label="Role for imported users">
                <Select value={importRole} onValueChange={(val) => handleImportRoleChange(val as ImportRole)}>
                  <Select.Trigger className="w-full">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="Teacher">Teacher</Select.Item>
                    <Select.Item value="Student">Student</Select.Item>
                  </Select.Content>
                </Select>
              </Field>

              <div className="flex items-center justify-between rounded border-2 border-black bg-muted/40 p-3 shadow-[2px_2px_0_#000]">
                <span className="text-xs font-semibold text-foreground">
                  Download CSV template for {importRole}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1.5 bg-background hover:bg-accent"
                  onClick={() => downloadCsvTemplate(importRole)}
                >
                  <Download className="size-3.5" />
                  Template
                </Button>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-all min-h-[130px]",
                  hasImportErrors
                    ? "border-destructive bg-destructive/10"
                    : dragOver
                      ? "border-primary bg-primary/10"
                      : "border-black/40 bg-background hover:bg-muted/30"
                )}
              >
                {uploadedFile ? (
                  <>
                    <FileSpreadsheet className="size-8 text-primary" />
                    <span className="text-sm font-bold text-foreground">
                      {uploadedFile.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {(uploadedFile.size / 1024).toFixed(1)} KB
                    </span>
                    {hasImportErrors ? (
                      <span className="text-xs font-semibold text-destructive">
                        Fix the file or choose a corrected CSV.
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        Ready to import
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <Upload className="size-8 text-muted-foreground" />
                    <div className="text-xs font-semibold text-foreground">
                      Drag & drop CSV file here, or <span className="text-primary underline">browse</span>
                    </div>
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

              {importResult && (
                <Alert
                  status={importResult.errors?.length ? "error" : "success"}
                  className="px-3 py-2 text-xs border-2 border-black"
                >
                  <Alert.Title className="text-sm font-bold">
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

            <Dialog.Footer className="flex justify-end border-t-2 border-black px-5 py-3 bg-background gap-2">
              <Button variant="outline" onClick={() => setStep("choose")}>
                Back
              </Button>
              <Button
                variant="default"
                disabled={!uploadedFile || importing || hasImportErrors}
                onClick={handleImportSubmit}
              >
                Import Users
              </Button>
            </Dialog.Footer>
          </>
        )}

        {/* ── STEP: MANUAL ─────────────────────────────────── */}
        {step === "manual" && (
          <>
            <div className="p-5 flex flex-col gap-3.5 max-h-[60vh] overflow-y-auto">
              <Field label="Role">
                <Select value={form.role} onValueChange={(val) => handleField("role", val)}>
                  <Select.Trigger className="w-full">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="Teacher">Teacher</Select.Item>
                    <Select.Item value="Student">Student</Select.Item>
                    <Select.Item value="Admin">Admin</Select.Item>
                  </Select.Content>
                </Select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="First Name">
                  <Input
                    placeholder="John"
                    value={form.firstName}
                    onChange={(e) => handleField("firstName", e.target.value)}
                    className="w-full bg-background border-2 border-black"
                  />
                </Field>
                <Field label="Last Name">
                  <Input
                    placeholder="Doe"
                    value={form.lastName}
                    onChange={(e) => handleField("lastName", e.target.value)}
                    className="w-full bg-background border-2 border-black"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Middle Name">
                  <Input
                    placeholder="(optional)"
                    value={form.middleName}
                    onChange={(e) => handleField("middleName", e.target.value)}
                    className="w-full bg-background border-2 border-black"
                  />
                </Field>
                {(isStudent || !isAdmin) && (
                  <Field label="Suffix">
                    <Input
                      placeholder="Jr., Sr., III…"
                      value={form.suffix}
                      onChange={(e) => handleField("suffix", e.target.value)}
                      className="w-full bg-background border-2 border-black"
                    />
                  </Field>
                )}
              </div>

              <Field label="Email Address">
                <Input
                  type="email"
                  placeholder="john@example.com"
                  value={form.email}
                  onChange={(e) => handleField("email", e.target.value)}
                  className="w-full bg-background border-2 border-black"
                />
              </Field>

              {!isAdmin && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Gender">
                    <Select value={form.gender} onValueChange={(val) => handleField("gender", val)}>
                      <Select.Trigger className="w-full">
                        <Select.Value placeholder="Select gender" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="Male">Male</Select.Item>
                        <Select.Item value="Female">Female</Select.Item>
                        <Select.Item value="Other">Other</Select.Item>
                      </Select.Content>
                    </Select>
                  </Field>
                  <Field label="Contact Number">
                    <Input
                      placeholder="+63 9XX XXX XXXX"
                      value={form.contactNumber}
                      onChange={(e) =>
                        handleField("contactNumber", e.target.value)
                      }
                      className="w-full bg-background border-2 border-black"
                    />
                  </Field>
                </div>
              )}

              {!isAdmin && (
                <Field label="Address">
                  <textarea
                    rows={2}
                    className="w-full rounded border-2 border-black bg-background px-4 py-2 text-sm font-medium shadow-md transition focus:outline-hidden focus:shadow-xs resize-none"
                    placeholder="Street, Barangay, City…"
                    value={form.address}
                    onChange={(e) => handleField("address", e.target.value)}
                  />
                </Field>
              )}

              {!isAdmin && (
                <Field label="Date of Birth">
                  <Input
                    type="date"
                    value={form.dob}
                    onChange={(e) => handleField("dob", e.target.value)}
                    className="w-full bg-background border-2 border-black"
                  />
                </Field>
              )}

              {!isStudent && !isAdmin && (
                <>
                  <Field label="Hired Date">
                    <Input
                      type="date"
                      value={form.hiredDate}
                      onChange={(e) =>
                        handleField("hiredDate", e.target.value)
                      }
                      className="w-full bg-background border-2 border-black"
                    />
                  </Field>
                  <Field label="Employment Status">
                    <Select value={form.employmentStatus} onValueChange={(val) => handleField("employmentStatus", val)}>
                      <Select.Trigger className="w-full">
                        <Select.Value placeholder="Select status" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="Regular/Permanent">Regular/Permanent</Select.Item>
                        <Select.Item value="Substitute">Substitute</Select.Item>
                        <Select.Item value="Probationary">Probationary</Select.Item>
                      </Select.Content>
                    </Select>
                  </Field>
                </>
              )}

              {isStudent && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Student LRN">
                      <Input
                        placeholder="12-digit LRN"
                        maxLength={12}
                        className="w-full bg-background border-2 border-black font-mono"
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
                      <Select value={form.gradeLevel} onValueChange={(val) => handleField("gradeLevel", val)}>
                        <Select.Trigger className="w-full">
                          <Select.Value placeholder="Select grade level" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="7">Grade 7</Select.Item>
                          <Select.Item value="8">Grade 8</Select.Item>
                          <Select.Item value="9">Grade 9</Select.Item>
                          <Select.Item value="10">Grade 10</Select.Item>
                          <Select.Item value="11">Grade 11</Select.Item>
                          <Select.Item value="12">Grade 12</Select.Item>
                        </Select.Content>
                      </Select>
                    </Field>
                  </div>
                  <Field label="General Average (Prior GWA)">
                    <Input
                      type="number"
                      step="0.01"
                      min="60"
                      max="100"
                      placeholder="e.g. 88.50 (optional)"
                      className="w-full bg-background border-2 border-black font-mono"
                      value={form.priorGwa}
                      onChange={(e) => handleField("priorGwa", e.target.value)}
                    />
                  </Field>
                </>
              )}
            </div>

            <Dialog.Footer className="flex justify-end border-t-2 border-black px-5 py-3 bg-background gap-2">
              <Button variant="outline" onClick={() => setStep("choose")}>
                Back
              </Button>
              <Button
                variant="default"
                disabled={manualSubmitting}
                onClick={handleManualSubmit}
              >
                Send Invitation
              </Button>
            </Dialog.Footer>
          </>
        )}
      </Dialog.Content>
    </Dialog>
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
      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}
