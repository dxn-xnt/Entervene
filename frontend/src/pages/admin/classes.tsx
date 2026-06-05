import { type ReactNode, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Archive,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Download,
  Eye,
  Pencil,
  Plus,
  Search,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import AppLayout from "@/layouts/app-layout";
import Tabs from "@/components/Tabs";

type ClassStatus = "Active" | "Archived";
type WizardMode = "choice" | "manual" | "import";
type DetailTab = "classes" | "students" | "subjects";

type Student = {
  id: string;
  name: string;
  lrn: string;
  gender: "Male" | "Female";
  score: number;
  risk?: boolean;
};

type ClassRecord = {
  id: string;
  grade: string;
  section: string;
  adviser: string;
  adviserEmail: string;
  academicYear: string;
  status: ClassStatus;
  students: Student[];
  subjects: { name: string; teacher: string; time: string; progress: number }[];
};

const students: Student[] = [
  { id: "s1", name: "Daniel Victor Santos", lrn: "100000000001", gender: "Male", score: 77, risk: true },
  { id: "s2", name: "Mia Gabriela Rodriguez", lrn: "100000000002", gender: "Female", score: 76, risk: true },
  { id: "s3", name: "Lucas Henry Wallace", lrn: "100000000003", gender: "Male", score: 74, risk: true },
  { id: "s4", name: "Emma Grace Foster", lrn: "100000000004", gender: "Female", score: 98 },
  { id: "s5", name: "Benjamin Isaac Ortiz", lrn: "100000000005", gender: "Male", score: 97 },
  { id: "s6", name: "Lily Rose Patel", lrn: "100000000006", gender: "Female", score: 97 },
  { id: "s7", name: "Samuel Nathaniel Brooks", lrn: "100000000007", gender: "Male", score: 98 },
  { id: "s8", name: "Sofia Elena Morales", lrn: "100000000008", gender: "Female", score: 90 },
];

const classData: ClassRecord[] = [
  {
    id: "grade-7-sapphire",
    grade: "Grade 7",
    section: "Sapphire",
    adviser: "Raymart Gabutan",
    adviserEmail: "raymart.gabutan@entervene.edu",
    academicYear: "2025-2026",
    status: "Active",
    students,
    subjects: [
      { name: "Computer Programming", teacher: "John Doe", time: "7:45 - 8:45 AM", progress: 87 },
      { name: "Filipino", teacher: "Ana Reyes", time: "8:45 - 9:45 AM", progress: 93 },
      { name: "Science", teacher: "Maria Santos", time: "10:00 - 11:00 AM", progress: 90 },
      { name: "English", teacher: "Paolo Cruz", time: "1:00 - 2:00 PM", progress: 85 },
    ],
  },
  {
    id: "grade-7-ruby",
    grade: "Grade 7",
    section: "Ruby",
    adviser: "Maria Santos",
    adviserEmail: "maria.santos@entervene.edu",
    academicYear: "2025-2026",
    status: "Active",
    students: students.slice(0, 6),
    subjects: [
      { name: "Computer Programming", teacher: "John Doe", time: "7:45 - 8:45 AM", progress: 82 },
      { name: "Mathematics", teacher: "Ben Santos", time: "9:00 - 10:00 AM", progress: 88 },
      { name: "Science", teacher: "Maria Santos", time: "10:00 - 11:00 AM", progress: 84 },
    ],
  },
  {
    id: "grade-8-sampaguita",
    grade: "Grade 8",
    section: "Sampaguita",
    adviser: "Juan Dela Cruz",
    adviserEmail: "juan.delacruz@entervene.edu",
    academicYear: "2025-2026",
    status: "Active",
    students: [...students, { id: "s9", name: "Aaron Cruz", lrn: "100000000009", gender: "Male", score: 91 }],
    subjects: [
      { name: "English", teacher: "Paolo Cruz", time: "8:00 - 9:00 AM", progress: 89 },
      { name: "Science", teacher: "Maria Santos", time: "10:00 - 11:00 AM", progress: 91 },
    ],
  },
  {
    id: "grade-8-rose",
    grade: "Grade 8",
    section: "Rose",
    adviser: "Ana Reyes",
    adviserEmail: "ana.reyes@entervene.edu",
    academicYear: "2025-2026",
    status: "Active",
    students: [...students, ...students.slice(0, 3)].map((student, index) => ({ ...student, id: `${student.id}-rose-${index}` })),
    subjects: [
      { name: "Filipino", teacher: "Ana Reyes", time: "8:45 - 9:45 AM", progress: 95 },
      { name: "Mathematics", teacher: "Ben Santos", time: "11:00 - 12:00 PM", progress: 86 },
    ],
  },
  {
    id: "grade-9-hope",
    grade: "Grade 9",
    section: "Hope",
    adviser: "Ben Santos",
    adviserEmail: "ben.santos@entervene.edu",
    academicYear: "2024-2025",
    status: "Archived",
    students: students.slice(0, 5),
    subjects: [{ name: "Science", teacher: "Maria Santos", time: "10:00 - 11:00 AM", progress: 80 }],
  },
  {
    id: "grade-9-love",
    grade: "Grade 9",
    section: "Love",
    adviser: "Clara Lim",
    adviserEmail: "clara.lim@entervene.edu",
    academicYear: "2025-2026",
    status: "Active",
    students: [...students, ...students.slice(0, 4)].map((student, index) => ({ ...student, id: `${student.id}-love-${index}` })),
    subjects: [{ name: "English", teacher: "Paolo Cruz", time: "1:00 - 2:00 PM", progress: 88 }],
  },
  {
    id: "grade-10-gold",
    grade: "Grade 10",
    section: "Gold",
    adviser: "John Doe",
    adviserEmail: "john.doe@entervene.edu",
    academicYear: "2025-2026",
    status: "Active",
    students: students.slice(0, 7),
    subjects: [{ name: "Computer Programming", teacher: "John Doe", time: "7:45 - 8:45 AM", progress: 92 }],
  },
];

const gradeOptions = ["All", "Grade 7", "Grade 8", "Grade 9", "Grade 10"];
const yearOptions = ["All", "2025-2026", "2024-2025", "2023-2024"];
const availableStudents = [
  { id: "a1", name: "Aaron Cruz", lrn: "900000000001", gender: "Male" as const },
  { id: "a2", name: "Carlos Reyes", lrn: "900000000002", gender: "Male" as const },
  { id: "a3", name: "Alexa Lim", lrn: "900000000003", gender: "Female" as const },
  { id: "a4", name: "Claire Torres", lrn: "900000000004", gender: "Female" as const },
];

function retroButton(className = "") {
  return `inline-flex items-center justify-center gap-2 rounded-md border border-black bg-white px-3 py-2 text-sm font-semibold text-black shadow-[3px_3px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000] ${className}`;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-xs font-semibold">
      {label}
      {children}
    </label>
  );
}

function SelectField({ value, onChange, children }: { value?: string; onChange?: (value: string) => void; children: ReactNode }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      className="h-10 rounded-md border border-black bg-[#fffdf5] px-3 text-sm outline-none"
    >
      {children}
    </select>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/10 px-4">
      <div className="w-full max-w-3xl rounded-lg border border-black bg-[#fffdf5] shadow-[4px_4px_0_#000]">
        <div className="flex items-center justify-between rounded-t-lg border-b border-black bg-[#79bd80] px-4 py-3">
          <h2 className="font-bold">{title}</h2>
          <button aria-label="Close modal" className="rounded p-1 hover:bg-white/30" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function NewClassModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<WizardMode>("choice");
  const [step, setStep] = useState(1);
  const [selectedStudents, setSelectedStudents] = useState(availableStudents.slice(0, 2));

  if (mode === "choice") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center px-4"
        style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
        onClick={onClose}
      >
        <div
          className="w-full max-w-xl overflow-hidden rounded-xl border border-black bg-[#faf9f6]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-black px-5 py-5">
            <h2 className="text-xl font-semibold">Add new classes</h2>
            <button
              aria-label="Close modal"
              className="text-2xl leading-none hover:text-black/70"
              onClick={onClose}
            >
              ×
            </button>
          </div>

          <div className="grid gap-4 border-b border-black px-5 py-5 md:grid-cols-2">
            <button
              className="rounded-lg border border-black bg-[#5c8f5c] p-5 text-left transition hover:opacity-90 active:scale-95"
              onClick={() => setMode("import")}
            >
              <div className="mb-2 flex items-center gap-3 text-base font-semibold">
                <Download className="size-5" />
                Import from file
              </div>
              <p className="text-sm leading-snug text-black/80">
                Upload a CSV or Excel file to add multiple classes at once
              </p>
            </button>

            <button
              className="rounded-lg border border-black bg-[#5c8f5c] p-5 text-left transition hover:opacity-90 active:scale-95"
              onClick={() => setMode("manual")}
            >
              <div className="mb-2 flex items-center gap-3 text-base font-semibold">
                <UserPlus className="size-5" />
                Create manually
              </div>
              <p className="text-sm leading-snug text-black/80">
                Add individual class sections one at a time
              </p>
            </button>
          </div>

          <div className="flex justify-end px-5 py-5">
            <button
              className="rounded-lg border border-black bg-[#faf9f6] px-5 py-2 text-base font-medium transition hover:bg-black/5"
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ModalShell title={mode === "manual" ? "Create class" : "Import from file"} onClose={onClose}>
      {mode === "manual" && (
        <div className="grid gap-4">
          <div className="flex gap-2 text-xs font-semibold">
            {["Class Details", "Add Students", "Review"].map((label, index) => (
              <span key={label} className={`rounded-full border border-black px-3 py-1 ${step === index + 1 ? "bg-[#f7e9aa]" : "bg-white"}`}>
                {index + 1}. {label}
              </span>
            ))}
          </div>

          {step === 1 && (
            <div className="grid gap-3">
              <Field label="Grade Level">
                <SelectField><option>7</option><option>8</option><option>9</option><option>10</option></SelectField>
              </Field>
              <Field label="Section Name">
                <input className="h-10 rounded-md border border-black bg-[#fffdf5] px-3 text-sm" defaultValue="Sapphire" />
              </Field>
              <Field label="Class Adviser">
                <SelectField><option>John Doe</option><option>Raymart Gabutan</option><option>Maria Santos</option></SelectField>
              </Field>
              <Field label="Academic Year">
                <SelectField><option>2025-2026</option><option>2024-2025</option></SelectField>
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-3 md:grid-cols-2">
              <StudentTransfer title="Available Students" students={availableStudents} action="Add" onAction={(student) => setSelectedStudents((current) => [...current, student])} />
              <StudentTransfer title={`Selected Students (${selectedStudents.length})`} students={selectedStudents} action="Remove" onAction={(student) => setSelectedStudents((current) => current.filter((item) => item.id !== student.id))} />
              <div className="rounded-md border border-black bg-[#fff8d7] p-3 text-xs md:col-span-2">
                <p className="font-bold">Already Assigned</p>
                <p>David Reyes - Grade 7 Sapphire</p>
                <p>Anna Cruz - Grade 7 Ruby</p>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-2 rounded-md border border-black bg-[#fff8d7] p-4 text-sm">
              <p><b>Academic Level:</b> Grade 7</p>
              <p><b>Section Name:</b> Sapphire</p>
              <p><b>Adviser:</b> John Doe</p>
              <p><b>Academic Year:</b> 2025-2026</p>
              <p><b>Students:</b> {selectedStudents.length}</p>
              <p><b>Male:</b> {selectedStudents.filter((student) => student.gender === "Male").length}</p>
              <p><b>Female:</b> {selectedStudents.filter((student) => student.gender === "Female").length}</p>
            </div>
          )}

          <div className="flex justify-between">
            <button className={retroButton()} onClick={() => (step === 1 ? setMode("choice") : setStep(step - 1))}>Back</button>
            <button className={retroButton("bg-[#79bd80]")} onClick={() => (step === 3 ? onClose() : setStep(step + 1))}>
              {step === 3 ? "Save Class" : "Next"}
            </button>
          </div>
        </div>
      )}

      {mode === "import" && (
        <div className="grid gap-4">
          <div className="grid gap-3">
            <Field label="Grade">
              <SelectField><option>7</option><option>8</option><option>9</option><option>10</option></SelectField>
            </Field>
            {["Sapphire", "Ruby", "Gold", "Jade", "Diamond"].map((section) => (
              <div key={section} className="flex items-center justify-between rounded-md border border-black bg-[#fffdf5] p-3">
                <span><b>{section}</b><span className="block text-xs">30 Students</span></span>
                <Pencil className="size-4" />
              </div>
            ))}
          </div>
          <div className="grid gap-2 rounded-md border border-black bg-[#fff8d7] p-3 text-sm">
            <div className="flex items-center gap-2 font-bold"><CheckCircle2 className="size-4" /> Validation preview</div>
            <p>Valid students: 120 | Duplicate LRN: 3 | Missing required fields: 2 | Invalid academic level: 1</p>
            <p className="text-xs">Invalid rows are skipped before import.</p>
          </div>
          <div className="flex justify-between">
            <button className={retroButton()}><Download className="size-4" /> Download Template</button>
            <button className={retroButton("bg-[#79bd80]")} onClick={onClose}>Import</button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

function StudentTransfer({
  title,
  students: items,
  action,
  onAction,
}: {
  title: string;
  students: typeof availableStudents;
  action: string;
  onAction: (student: (typeof availableStudents)[number]) => void;
}) {
  return (
    <div className="grid gap-2 rounded-md border border-black p-3">
      <h3 className="font-bold">{title}</h3>
      {(["Male", "Female"] as const).map((gender) => (
        <div key={gender} className="grid gap-1">
          <p className="text-xs font-bold">{gender}</p>
          {items.filter((student) => student.gender === gender).map((student) => (
            <button key={student.id} className="flex items-center justify-between rounded border border-black bg-[#fffdf5] px-2 py-1 text-left text-xs" onClick={() => onAction(student)}>
              <span>{student.name}<span className="block text-[10px]">LRN {student.lrn}</span></span>
              <span>{action}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function AdminClasses() {
  const [search, setSearch] = useState("");
  const [grade, setGrade] = useState("All");
  const [year, setYear] = useState("All");
  const [status, setStatus] = useState<"All" | ClassStatus>("All");
  const [showNewClass, setShowNewClass] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<ClassRecord | null>(null);
  const [archivedIds, setArchivedIds] = useState<string[]>([]);

  const classes = classData.map((item) => ({
    ...item,
    status: archivedIds.includes(item.id) ? "Archived" as ClassStatus : item.status,
  }));

  const filteredClasses = classes.filter((item) => {
    const text = `${item.grade} ${item.section} ${item.adviser}`.toLowerCase();
    return (
      text.includes(search.toLowerCase()) &&
      (grade === "All" || item.grade === grade) &&
      (year === "All" || item.academicYear === year) &&
      (status === "All" || item.status === status)
    );
  });

  const grouped = useMemo(
    () => gradeOptions.slice(1).map((gradeLabel) => ({ grade: gradeLabel, classes: filteredClasses.filter((item) => item.grade === gradeLabel) })).filter((group) => group.classes.length),
    [filteredClasses]
  );

  const summary = {
    total: classes.length,
    active: classes.filter((item) => item.status === "Active").length,
    archived: classes.filter((item) => item.status === "Archived").length,
    students: classes.filter((item) => item.status === "Active").reduce((total, item) => total + item.students.length, 0),
  };

  return (
    <AppLayout>
      <main className="flex flex-1 flex-col gap-5 px-4 py-4 md:px-6 md:py-5">
        <header className="flex flex-col gap-3 border-b border-black/40 pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Class Management</h1>
            <p className="text-sm text-black/70">Manage class sections, advisers, students, subject load, and schedules.</p>
          </div>
          <button
            className="flex items-center gap-1.5 rounded-lg border-2 border-black bg-[#79bd80] px-4 py-2 text-sm font-semibold text-black shadow-[3px_3px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000]"
            onClick={() => setShowNewClass(true)}
          >
            <Plus className="size-4" /> New Class
          </button>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Total Classes" value={summary.total} icon={<BookOpen className="size-5" />} />
          <SummaryCard label="Active Classes" value={summary.active} icon={<CheckCircle2 className="size-5" />} />
          <SummaryCard label="Archived Classes" value={summary.archived} icon={<Archive className="size-5" />} />
          <SummaryCard label="Students Assigned" value={summary.students} icon={<Users className="size-5" />} />
        </section>

        <section className="grid gap-3 rounded-lg border border-black bg-[#fffdf5] p-3 shadow-[3px_3px_0_#000] md:grid-cols-[1fr_160px_160px_140px]">
          <label className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search class or adviser"
              className="h-10 w-full rounded-md border border-black bg-white pl-9 pr-3 text-sm outline-none"
            />
          </label>
          <SelectField value={grade} onChange={setGrade}>{gradeOptions.map((option) => <option key={option}>{option}</option>)}</SelectField>
          <SelectField value={year} onChange={setYear}>{yearOptions.map((option) => <option key={option}>{option}</option>)}</SelectField>
          <SelectField value={status} onChange={(value) => setStatus(value as "All" | ClassStatus)}><option>All</option><option>Active</option><option>Archived</option></SelectField>
        </section>

        <section className="grid gap-4">
          {grouped.length === 0 && (
            <div className="rounded-lg border border-black bg-[#fffdf5] p-8 text-center shadow-[3px_3px_0_#000]">No classes match the selected filters.</div>
          )}
          {grouped.map((group) => (
            <div key={group.grade} className="rounded-lg border border-black bg-[#fffdf5] p-4 shadow-[4px_4px_0_#000]">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xl font-bold">{group.grade}</h2>
                <span className="rounded-full border border-black bg-[#f7e9aa] px-3 py-1 text-xs font-bold">{group.classes.length} sections</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {group.classes.map((item) => (
                  <article key={item.id} className="rounded-lg border border-black bg-[#fff8d7] p-4 shadow-[3px_3px_0_#000]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-xl font-bold">{item.section}</h3>
                        <p className="text-sm">Adviser: {item.adviser}</p>
                        <p className="text-sm">Students: {item.students.length}</p>
                      </div>
                      <span className={`rounded-full border border-black px-2 py-1 text-xs font-bold ${item.status === "Active" ? "bg-[#79bd80]" : "bg-white"}`}>
                        {item.status === "Archived" ? "Read-only" : item.status}
                      </span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link className={retroButton("px-2 py-1 text-xs")} to={`/admin/classes/${item.id}`}><Eye className="size-3" /> View</Link>
                      {item.status === "Active" && (
                        <>
                          <button className={retroButton("px-2 py-1 text-xs")} onClick={() => setShowNewClass(true)}><Pencil className="size-3" /> Edit</button>
                          <button className={retroButton("px-2 py-1 text-xs")} onClick={() => setArchiveTarget(item)}><Archive className="size-3" /> Archive</button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </section>
      </main>

      {showNewClass && <NewClassModal onClose={() => setShowNewClass(false)} />}
      {archiveTarget && (
        <ModalShell title={`Archive ${archiveTarget.grade} - ${archiveTarget.section}?`} onClose={() => setArchiveTarget(null)}>
          <div className="grid gap-4">
            <p className="text-sm">This class will be hidden from active class lists but can still be viewed in archived records.</p>
            <div className="flex justify-end gap-2">
              <button className={retroButton()} onClick={() => setArchiveTarget(null)}>Cancel</button>
              <button
                className={retroButton("bg-[#79bd80]")}
                onClick={() => {
                  setArchivedIds((current) => [...current, archiveTarget.id]);
                  setArchiveTarget(null);
                }}
              >
                Archive Class
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </AppLayout>
  );
}

function SummaryCard({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="rounded-lg border border-black bg-[#fffdf5] p-4 shadow-[3px_3px_0_#000]">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold">{label}</p>
        {icon}
      </div>
      <p className="mt-3 text-3xl font-black">{value}</p>
    </div>
  );
}

export function AdminClassDetail() {
  const { classId } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<DetailTab>("classes");
  const selectedClass = classData.find((item) => item.id === classId) ?? classData[0];
  const groupedStudents = {
    Male: selectedClass.students.filter((student) => student.gender === "Male").sort((a, b) => a.name.localeCompare(b.name)),
    Female: selectedClass.students.filter((student) => student.gender === "Female").sort((a, b) => a.name.localeCompare(b.name)),
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-3 px-4 py-4 md:px-6 md:py-5">
            <header className="flex items-center justify-between">
              <h1 className="flex flex-wrap items-center gap-2 text-4xl font-bold tracking-tight">
                <button className="hover:underline" onClick={() => navigate("/admin/classes")}>Classes</button>
                <ChevronRight className="size-5" />
                <span className="text-2xl">{selectedClass.grade}</span>
                <ChevronRight className="size-5" />
                <span className="text-2xl">{selectedClass.section}</span>
              </h1>
              {tab === "students" ? (
                <button className="flex items-center gap-1.5 rounded-lg border-2 border-black bg-[#79bd80] px-4 py-2 text-sm font-semibold text-black shadow-[3px_3px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000]">
                  <Pencil className="size-4" />
                  Edit Student List
                </button>
              ) : (
                <div className="flex gap-2">
                  <button className="flex items-center gap-1.5 rounded-lg border-2 border-black bg-[#79bd80] px-4 py-2 text-sm font-semibold text-black shadow-[3px_3px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000]">
                    <Pencil className="size-4" />
                    Edit Class
                  </button>
                  {tab === "subjects" && (
                    <button className="flex items-center gap-1.5 rounded-lg border-2 border-black bg-background px-4 py-2 text-sm font-semibold text-black shadow-[3px_3px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000]">
                      <Plus className="size-4" />
                      Add Subject Load
                    </button>
                  )}
                </div>
              )}
            </header>

            <div className="-mx-4 border-b border-black/40 md:-mx-6">
              <Tabs
                tabs={[
                  { id: "classes", label: "Classes", icon: <BookOpen className="size-3.5" /> },
                  { id: "students", label: "Students", icon: <Users className="size-3.5" /> },
                  { id: "subjects", label: "Subject Load", icon: <BookOpen className="size-3.5" /> },
                ]}
                activeTab={tab}
                onChange={(id) => setTab(id as DetailTab)}
              />
            </div>

            <div className="flex flex-col gap-3 px-4 md:px-6">
              <section className="rounded-lg border border-black bg-[#f7e9aa] p-4 shadow-[3px_3px_0_#000]">
                <h2 className="text-2xl font-bold">{selectedClass.section}</h2>
                <p className="text-xs">{selectedClass.grade} - {selectedClass.academicYear} | Active since October 20, 2024</p>
              </section>

              {tab === "classes" && <OverviewTab selectedClass={selectedClass} />}
              {tab === "students" && <StudentsTab selectedClass={selectedClass} groupedStudents={groupedStudents} />}
              {tab === "subjects" && <SubjectLoadTab selectedClass={selectedClass} />}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function OverviewTab({ selectedClass }: { selectedClass: ClassRecord }) {
  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_300px]">
      <div className="grid gap-3">
        <h3 className="text-lg font-bold">Overview</h3>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="rounded-lg border border-black bg-[#fffdf5] p-4 shadow-[3px_3px_0_#000]">
            <div className="mb-2">
              <h4 className="text-lg font-bold">Quarterly Class Performance</h4>
              <p className="text-[10px] font-semibold text-black/65">Average class mastery across all subject</p>
            </div>
            <svg viewBox="0 0 620 170" className="h-40 w-full rounded-md bg-white" role="img" aria-label="Static quarterly class performance graph">
              {[35, 65, 95, 125].map((y) => (
                <line key={y} x1="38" x2="596" y1={y} y2={y} stroke="#dfd8bf" strokeWidth="1" />
              ))}
              <line x1="38" x2="596" y1="140" y2="140" stroke="#222" strokeWidth="1" opacity=".35" />
              <polyline points="60,102 210,88 360,82 540,74" fill="none" stroke="#4f8b5f" strokeWidth="4" />
              <polyline points="60,114 210,108 360,102 540,96" fill="none" stroke="#e0be5a" strokeDasharray="5 4" strokeWidth="2" />
              {[
                ["Q1", 58],
                ["Q2", 208],
                ["Q3", 358],
                ["Q4", 538],
              ].map(([label, x]) => (
                <text key={label} x={Number(x)} y="158" fontSize="10" fontWeight="700" fill="#555">{label}</text>
              ))}
              <rect x="512" y="54" width="54" height="18" rx="8" fill="#4f8b5f" />
              <text x="526" y="67" fontSize="9" fontWeight="700" fill="white">88.4%</text>
            </svg>
          </section>

          <section className="rounded-lg border border-black bg-[#fffdf5] p-4 shadow-[3px_3px_0_#000]">
            <h4 className="text-lg font-bold">Subject Breakdown</h4>
            <p className="mb-3 text-[10px] font-semibold text-black/65">Average mastery per subject load</p>
            <div className="grid gap-2">
              {selectedClass.subjects.map((subject, index) => (
                <div key={subject.name} className="grid grid-cols-[80px_1fr_34px] items-center gap-2 text-[10px]">
                  <span className="truncate font-semibold">{subject.name}</span>
                  <span className="h-2 rounded-full bg-black/15">
                    <span
                      className={`block h-full rounded-full ${index % 2 === 0 ? "bg-[#79bd80]" : "bg-[#f7c76f]"}`}
                      style={{ width: `${subject.progress}%` }}
                    />
                  </span>
                  <span className="text-right font-bold">{subject.progress}%</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section>
          <h3 className="mb-1 text-lg font-bold">Class Advisor</h3>
          <div className="flex items-center gap-3 rounded-lg border border-black bg-[#fffdf5] p-3 shadow-[3px_3px_0_#000]">
            <span className="grid size-8 shrink-0 place-items-center rounded-full border border-amber-700 bg-amber-200 text-[13px] font-semibold text-amber-900">
              {selectedClass.adviser.charAt(0)}
            </span>
            <span>
              <span className="block text-sm font-bold">{selectedClass.adviser}</span>
              <span className="block text-[10px] font-semibold text-black/65">Advisory assigned since October 20, 2024</span>
            </span>
          </div>
        </section>

        <section>
          <h3 className="mb-1 text-lg font-bold">Subjects</h3>
          <div className="grid gap-2">
            {selectedClass.subjects.map((subject) => (
              <div key={subject.name} className="flex min-h-16 items-center justify-between rounded-lg border border-black bg-[#fffdf5] px-4 py-3 shadow-[3px_3px_0_#000]">
                <span>
                  <span className="block text-xl font-black">{subject.name}</span>
                  <span className="block text-[10px] font-semibold text-black/65">Active since November 10, 2025</span>
                </span>
                <span className="text-xs font-semibold">{subject.time}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <aside>
        <h3 className="mb-1 text-lg font-bold">Recent Activity</h3>
        <div className="grid gap-2 rounded-lg border border-black bg-[#fffdf5] p-3 shadow-[3px_3px_0_#000]">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="rounded-md border border-black/40 bg-background p-2 text-[10px]">
              <p className="font-semibold">New lessons added for Sci10</p>
              <p className="text-black/65">Added by {selectedClass.adviser} - 2 hours ago</p>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function StudentsTab({
  selectedClass,
  groupedStudents,
}: {
  selectedClass: ClassRecord;
  groupedStudents: Record<"Male" | "Female", Student[]>;
}) {
  const atRisk = selectedClass.students.filter((student) => student.risk).length;
  const average = Math.round(selectedClass.students.reduce((sum, student) => sum + student.score, 0) / selectedClass.students.length);
  const sortedStudents = [...selectedClass.students].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Total Students" value={selectedClass.students.length} note="2% increased from last month">
          <GenderBar male={groupedStudents.Male.length} female={groupedStudents.Female.length} />
        </MetricCard>
        <MetricCard label="Avg. Class Score" value={`${average}%`} note="12% increased from last month" />
        <MetricCard label="At-Risk Students" value={atRisk} note="12% increased from last month" />
      </div>

      <section>
        <h3 className="mb-1 text-lg font-bold">Students</h3>
        <div className="overflow-hidden rounded-lg border border-black bg-[#fffdf5] shadow-[3px_3px_0_#000]">
          {sortedStudents.map((student) => (
            <button
              key={student.id}
              type="button"
              className="grid min-h-11 w-full grid-cols-[minmax(0,1fr)_120px_48px] items-center gap-3 border-b border-black/50 px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-accent hover:text-sidebar-accent-foreground"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full border border-amber-700 bg-amber-200 text-[13px] font-semibold text-amber-900">
                  {student.name.charAt(0)}
                </span>
                <span className="truncate font-semibold">{student.name}</span>
              </span>
              <span className="justify-self-center">
                {student.risk && <span className="rounded-full border border-[#d95d5d] bg-[#f07f7f] px-2 py-0.5 text-[10px] font-semibold">Marked at risk</span>}
              </span>
              <span className="justify-self-end font-black">{student.score}%</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
  children,
}: {
  label: string;
  value: number | string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-black bg-[#fffdf5] p-4 shadow-[3px_3px_0_#000]">
      <p className="text-sm font-bold">{label}</p>
      <p className="mt-1 text-4xl font-black leading-none">{value}</p>
      {children}
      {note && <p className="mt-2 text-[10px] font-semibold text-black/70">{note}</p>}
    </div>
  );
}

function GenderBar({ male, female }: { male: number; female: number }) {
  const total = Math.max(male + female, 1);
  const maleWidth = (male / total) * 100;
  const femaleWidth = (female / total) * 100;

  return (
    <div className="mt-3 grid gap-1 text-[10px] font-semibold">
      <div className="flex h-3 overflow-hidden rounded-full border border-black bg-white">
        <div className="bg-[#79bd80]" style={{ width: `${maleWidth}%` }} />
        <div className="bg-[#f7c76f]" style={{ width: `${femaleWidth}%` }} />
      </div>
      <div className="flex justify-between">
        <span>Male {male}</span>
        <span>Female {female}</span>
      </div>
    </div>
  );
}

function SubjectLoadTab({ selectedClass }: { selectedClass: ClassRecord }) {
  if (!selectedClass.subjects.length) {
    return <div className="rounded-lg border border-black bg-[#fffdf5] p-8 text-center shadow-[3px_3px_0_#000]">No subject load assigned yet.</div>;
  }

  return (
    <section>
      <h3 className="mb-1 text-lg font-bold">Subject Load</h3>
      <div className="overflow-x-auto rounded-lg border border-black bg-[#fffdf5] shadow-[3px_3px_0_#000]">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[minmax(150px,1fr)_150px_130px_minmax(180px,1fr)] border-b border-black/50 px-3 py-1.5 text-[11px] font-semibold text-black/70">
            <span className="text-center">Subject</span>
            <span className="text-center">Time</span>
            <span className="text-center">Days</span>
            <span className="text-center">Teacher</span>
          </div>
        {selectedClass.subjects.map((subject, index) => (
          <div key={subject.name}>
            {index === 2 && <div className="border-b border-black/40 py-1 text-center text-[10px] font-semibold">Break</div>}
            {index === 4 && <div className="border-b border-black/40 py-1 text-center text-[10px] font-semibold">Lunch Break</div>}
            <div className="grid min-h-10 grid-cols-[minmax(150px,1fr)_150px_130px_minmax(180px,1fr)] items-center border-b border-black/40 px-3 py-2 text-xs last:border-b-0">
              <b>{subject.name}</b>
              <span className="text-center">{subject.time}</span>
              <span className="flex justify-center gap-1">
                {["M", "T", "W", "Th", "F"].map((day) => (
                  <span key={day} className="grid size-5 place-items-center rounded-full border border-black/30 bg-white text-[9px]">{day}</span>
                ))}
              </span>
              <span className="flex items-center justify-center gap-2">
                <span className="grid size-6 place-items-center rounded-full border border-amber-700 bg-amber-200 text-[11px] font-semibold text-amber-900">
                  {subject.teacher.charAt(0)}
                </span>
                <span className="font-semibold">{subject.teacher}</span>
              </span>
            </div>
          </div>
        ))}
        </div>
      </div>
    </section>
  );
}
