import { useState, useRef } from "react";

type Step = "choose" | "import" | "manual";
type Role = "Teacher" | "Student" | "Admin";

interface ManualFormData {
  firstName: string;
  lastName: string;
  middleName: string;
  email: string;
  role: Role;
  // Staff-specific
  staffId: string;
  gender: string;
  contactNumber: string;
  address: string;
  hiredDate: string;
  employmentStatus: string;
  // Student-specific
  studentLrn: string;
  suffix: string;
  academicLevelId: string;
}

const EMPTY_FORM: ManualFormData = {
  firstName: "",
  lastName: "",
  middleName: "",
  email: "",
  role: "Teacher",
  staffId: "",
  gender: "",
  contactNumber: "",
  address: "",
  hiredDate: "",
  employmentStatus: "",
  studentLrn: "",
  suffix: "",
  academicLevelId: "",
};

interface AddUserModalProps {
  open: boolean;
  onClose: () => void;
  onUserAdded?: (data: ManualFormData) => void;
}

export default function AddUserModal({ open, onClose, onUserAdded }: AddUserModalProps) {
  const [step, setStep] = useState<Step>("choose");
  const [form, setForm] = useState<ManualFormData>(EMPTY_FORM);
  const [dragOver, setDragOver] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const handleClose = () => {
    setStep("choose");
    setForm(EMPTY_FORM);
    setUploadedFile(null);
    onClose();
  };

  const handleField = (field: keyof ManualFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleManualSubmit = () => {
    onUserAdded?.(form);
    handleClose();
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
        className="relative w-full max-w-md rounded-xl shadow-2xl overflow-hidden"
        style={{ background: "#faf9f6", border: "2px solid #e5e3de" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── STEP: CHOOSE ─────────────────────────────────── */}
        {step === "choose" && (
          <>
            <div className="flex items-center justify-between px-5 py-4">
              <span className="font-semibold text-base text-gray-800">Add new users</span>
              <button onClick={handleClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none">×</button>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button
                onClick={() => setStep("import")}
                className="flex-1 rounded-lg p-4 text-left transition-all hover:opacity-90 active:scale-95"
                style={{ background: "#5c8f5c", color: "#fff", border: "none" }}
              >
                <div className="flex items-center gap-2 font-semibold text-sm mb-1">
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"/></svg>
                  Import from file
                </div>
                <p className="text-xs opacity-80">Upload a CSV or Excel file to add multiple users at once</p>
              </button>
              <button
                onClick={() => setStep("manual")}
                className="flex-1 rounded-lg p-4 text-left transition-all hover:opacity-90 active:scale-95"
                style={{ background: "#5c8f5c", color: "#fff", border: "none" }}
              >
                <div className="flex items-center gap-2 font-semibold text-sm mb-1">
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  Create manually
                </div>
                <p className="text-xs opacity-80">Add individual user accounts one at a time</p>
              </button>
            </div>
            <div className="flex justify-end px-5 pb-4">
              <button
                onClick={handleClose}
                className="px-4 py-1.5 rounded border text-sm text-gray-600 hover:bg-gray-100 transition"
                style={{ borderColor: "#d1cfc9" }}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {/* ── STEP: IMPORT ─────────────────────────────────── */}
        {step === "import" && (
          <>
            <div
              className="flex items-center justify-between px-5 py-3"
              style={{ background: "#5c8f5c" }}
            >
              <span className="font-semibold text-sm text-white">Import from file</span>
              <button onClick={handleClose} className="text-white/70 hover:text-white text-lg leading-none">×</button>
            </div>
            <div className="p-5">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-3 rounded-lg cursor-pointer transition-all"
                style={{
                  minHeight: 140,
                  border: `2px dashed ${dragOver ? "#5c8f5c" : "#ccc"}`,
                  background: dragOver ? "#f0f7f0" : "#fff",
                }}
              >
                {uploadedFile ? (
                  <>
                    <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="#5c8f5c" strokeWidth="2"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    <span className="text-sm font-medium text-gray-700">{uploadedFile.name}</span>
                    <span className="text-xs text-gray-400">{(uploadedFile.size / 1024).toFixed(1)} KB</span>
                  </>
                ) : (
                  <>
                    <button
                      className="px-4 py-1.5 rounded border text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
                      style={{ borderColor: "#ccc" }}
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                    >
                      Upload
                    </button>
                    <span className="text-xs text-gray-400">Drag & drop file here</span>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setUploadedFile(f); }}
              />
            </div>
            <div
              className="flex justify-end px-5 py-3 gap-2"
              style={{ borderTop: "1px solid #e5e3de" }}
            >
              <button
                onClick={() => setStep("choose")}
                className="px-4 py-1.5 rounded border text-sm text-gray-600 hover:bg-gray-100 transition"
                style={{ borderColor: "#d1cfc9" }}
              >
                Back
              </button>
              <button
                disabled={!uploadedFile}
                className="px-4 py-1.5 rounded text-sm font-semibold text-white transition disabled:opacity-50"
                style={{ background: "#5c8f5c" }}
                onClick={handleClose}
              >
                Next
              </button>
            </div>
          </>
        )}

        {/* ── STEP: MANUAL ─────────────────────────────────── */}
        {step === "manual" && (
          <>
            <div
              className="flex items-center justify-between px-5 py-3"
              style={{ background: "#5c8f5c" }}
            >
              <span className="font-semibold text-sm text-white">Create user manually</span>
              <button onClick={handleClose} className="text-white/70 hover:text-white text-lg leading-none">×</button>
            </div>
            <div className="p-5 flex flex-col gap-3 max-h-[70vh] overflow-y-auto">

              {/* Role — first so fields adapt below */}
              <Field label="Role">
                <select
                  value={form.role}
                  onChange={(e) => handleField("role", e.target.value as Role)}
                  className="w-full border rounded px-3 py-1.5 text-sm bg-white"
                  style={{ borderColor: "#ccc" }}
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
                    className="w-full border rounded px-3 py-1.5 text-sm"
                    style={{ borderColor: "#ccc" }}
                    placeholder="John"
                    value={form.firstName}
                    onChange={(e) => handleField("firstName", e.target.value)}
                  />
                </Field>
                <Field label="Last Name">
                  <input
                    className="w-full border rounded px-3 py-1.5 text-sm"
                    style={{ borderColor: "#ccc" }}
                    placeholder="Doe"
                    value={form.lastName}
                    onChange={(e) => handleField("lastName", e.target.value)}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Middle Name">
                  <input
                    className="w-full border rounded px-3 py-1.5 text-sm"
                    style={{ borderColor: "#ccc" }}
                    placeholder="(optional)"
                    value={form.middleName}
                    onChange={(e) => handleField("middleName", e.target.value)}
                  />
                </Field>
                {(isStudent || !isAdmin) && (
                  <Field label="Suffix">
                    <input
                      className="w-full border rounded px-3 py-1.5 text-sm"
                      style={{ borderColor: "#ccc" }}
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
                  className="w-full border rounded px-3 py-1.5 text-sm"
                  style={{ borderColor: "#ccc" }}
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
                      className="w-full border rounded px-3 py-1.5 text-sm bg-white"
                      style={{ borderColor: "#ccc" }}
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
                      className="w-full border rounded px-3 py-1.5 text-sm"
                      style={{ borderColor: "#ccc" }}
                      placeholder="+63 9XX XXX XXXX"
                      value={form.contactNumber}
                      onChange={(e) => handleField("contactNumber", e.target.value)}
                    />
                  </Field>
                </div>
              )}

              {/* Address */}
              {!isAdmin && (
                <Field label="Address">
                  <textarea
                    rows={2}
                    className="w-full border rounded px-3 py-1.5 text-sm resize-none"
                    style={{ borderColor: "#ccc" }}
                    placeholder="Street, Barangay, City…"
                    value={form.address}
                    onChange={(e) => handleField("address", e.target.value)}
                  />
                </Field>
              )}

              {/* ── Teacher/Staff-specific ── */}
              {!isStudent && !isAdmin && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Staff ID">
                      <input
                        className="w-full border rounded px-3 py-1.5 text-sm"
                        style={{ borderColor: "#ccc" }}
                        placeholder="e.g. TCH-001"
                        value={form.staffId}
                        onChange={(e) => handleField("staffId", e.target.value)}
                      />
                    </Field>
                    <Field label="Hired Date">
                      <input
                        type="date"
                        className="w-full border rounded px-3 py-1.5 text-sm"
                        style={{ borderColor: "#ccc" }}
                        value={form.hiredDate}
                        onChange={(e) => handleField("hiredDate", e.target.value)}
                      />
                    </Field>
                  </div>
                  <Field label="Employment Status">
                    <select
                      className="w-full border rounded px-3 py-1.5 text-sm bg-white"
                      style={{ borderColor: "#ccc" }}
                      value={form.employmentStatus}
                      onChange={(e) => handleField("employmentStatus", e.target.value)}
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
                        className="w-full border rounded px-3 py-1.5 text-sm font-mono"
                        style={{ borderColor: "#ccc" }}
                        placeholder="12-digit LRN"
                        maxLength={12}
                        value={form.studentLrn}
                        onChange={(e) => handleField("studentLrn", e.target.value.replace(/\D/g, ""))}
                      />
                    </Field>
                    <Field label="Academic Level">
                      <input
                        className="w-full border rounded px-3 py-1.5 text-sm"
                        style={{ borderColor: "#ccc" }}
                        placeholder="e.g. Grade 7"
                        value={form.academicLevelId}
                        onChange={(e) => handleField("academicLevelId", e.target.value)}
                      />
                    </Field>
                  </div>
                </>
              )}
            </div>

            <div
              className="flex justify-end px-5 py-3 gap-2"
              style={{ borderTop: "1px solid #e5e3de" }}
            >
              <button
                onClick={() => setStep("choose")}
                className="px-4 py-1.5 rounded border text-sm text-gray-600 hover:bg-gray-100 transition"
                style={{ borderColor: "#d1cfc9" }}
              >
                Back
              </button>
              <button
                onClick={handleManualSubmit}
                className="px-5 py-1.5 rounded text-sm font-semibold text-white transition hover:opacity-90"
                style={{ background: "#5c8f5c" }}
              >
                Add
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}