import { useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

type Step = "choose" | "import" | "manual";
type Role = "Teacher" | "Student" | "Admin";

interface ManualFormData {
  firstName: string;
  lastName: string;
  middleName: string;
  email: string;
  role: Role;
  // Staff-specific
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
  gender: "",
  contactNumber: "",
  address: "",
  hiredDate: "",
  employmentStatus: "",
  studentLrn: "",
  suffix: "",
  gradeLevel: "",
};

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
  const [importRole, setImportRole] = useState<"Teacher" | "Student">(
    "Teacher",
  );
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    message?: string;
    created?: number;
    skipped?: number;
    created_count?: number;
    failed_count?: number;
    skipped_emails?: string[];
    errors?: Array<{ row: number; field: string; value: string; reason: string }>;
  } | null>(null);
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
      setImportResult(res.ok ? data : data.detail ?? data);

      if (res.ok) {
        onUserAdded?.(form);
      }
    } finally {
      setImporting(false);
    }
  };

  const handleField = (field: keyof ManualFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleManualSubmit = async () => {
    if (manualSubmitting) return;
    setManualSubmitting(true);
    try {
      const res = await apiFetch("/api/v1/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
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
    if (file) setUploadedFile(file);
  };

  const isStudent = form.role === "Student";
  const isAdmin = form.role === "Admin";

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
                className="flex-1 rounded-lg p-4 text-left transition-all border bg-[#5c8f5c] hover:opacity-90 active:scale-95 overflow-hidden"
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
                className="flex-1 rounded-lg p-4 text-left transition-all border bg-[#5c8f5c] hover:opacity-90 active:scale-95 overflow-hidden"
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
            <div className="flex items-center justify-between p-4 border-b border-black bg-[#5c8f5c]">
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
                    setImportRole(e.target.value as "Teacher" | "Student")
                  }
                  className="w-full border rounded-lg px-3 pr-8 py-1.5 text-sm bg-white cursor-pointer"
                >
                  <option value="Teacher">Teacher</option>
                  <option value="Student">Student</option>
                </select>
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
                  border: `1px solid ${dragOver ? "#5c8f5c" : "black"}`,
                  background: dragOver ? "#f0f7f0" : "#fff",
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
                  if (f) setUploadedFile(f);
                }}
              />

              {importResult && (
                <div
                  className={`rounded border px-3 py-2 text-xs ${
                    importResult.errors?.length
                      ? "border-red-200 bg-red-50 text-red-800"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800"
                  }`}
                >
                  <div>
                    {importResult.message ? `${importResult.message}. ` : ""}
                    Imported {importResult.created_count ?? importResult.created ?? 0} user(s); failed{" "}
                    {importResult.failed_count ?? importResult.skipped ?? 0} user(s).
                  </div>
                  {importResult.skipped_emails?.length
                    ? ` Skipped: ${importResult.skipped_emails.join(", ")}`
                    : ""}
                  {importResult.errors?.length ? (
                    <ul className="mt-2 max-h-24 overflow-y-auto list-disc pl-4">
                      {importResult.errors.map((error, index) => (
                        <li key={`${error.row}-${error.field}-${index}`}>
                          Row {error.row}, {error.field}: {error.reason}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
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
                disabled={!uploadedFile || importing}
                className="px-4 py-1.5 rounded-lg border text-sm font-semibold transition cursor-pointer"
                style={{ background: "#5c8f5c" }}
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
            <div className="flex items-center justify-between p-4 border-b border-black bg-[#5c8f5c]">
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
                className="px-5 py-1.5 rounded-lg border text-sm font-semibold bg-[#5c8f5c] transition hover:opacity-90"
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
