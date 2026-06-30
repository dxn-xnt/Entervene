import { type ReactNode, useEffect, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Pencil, Plus, Users } from "lucide-react";
import { useNavigate, useParams, Link } from "react-router-dom";
import Tabs from "@/components/Tabs";
import EditClassModal from "@/components/admin/classes/modals/EditClassModal";
import EditStudentListModal from "@/components/admin/classes/modals/EditStudentListModal";
import AppLayout from "@/layouts/app-layout";
import { getClassDetail, getClassStudents, getClassTransferOptions, getUnassignedClassStudents, updateClassStudentList } from "@/lib/api";
import { classData } from "@/mocks/adminClasses";
import type {
  ClassDetailResponse,
  ClassAssignmentStudent,
  ClassRecord,
  ClassStudentListItem,
  ClassStudentListResponse,
  ClassTransferOption,
  DetailTab,
  UpdateClassStudentListRequest,
} from "@/types/adminClasses";

export default function AdminClassDetail() {
  const { classId } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<DetailTab>("classes");
  const [classDetail, setClassDetail] = useState<ClassDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showEditClass, setShowEditClass] = useState(false);
  const [classStudents, setClassStudents] = useState<ClassStudentListResponse | null>(null);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState("");
  const [studentsSuccess, setStudentsSuccess] = useState("");
  const [showEditStudents, setShowEditStudents] = useState(false);
  const [transferOptions, setTransferOptions] = useState<ClassTransferOption[]>([]);
  const [availableStudents, setAvailableStudents] = useState<ClassAssignmentStudent[]>([]);
  const [transferOptionsError, setTransferOptionsError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadClassDetail() {
      if (!classId) {
        setClassDetail(null);
        setLoadError("Unable to load class details.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setLoadError("");
      setClassDetail(null);
      setShowEditClass(false);
      try {
        const detail = await getClassDetail(classId);
        if (isMounted) setClassDetail(detail);
      } catch {
        if (isMounted) setLoadError("Unable to load class details.");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadClassDetail();

    return () => {
      isMounted = false;
    };
  }, [classId]);

  useEffect(() => {
    let isMounted = true;

    async function loadStudents() {
      if (tab !== "students" || !classId) return;
      setStudentsLoading(true);
      setStudentsError("");
      try {
        const data = await getClassStudents(classId, { pageSize: 200 });
        if (isMounted) setClassStudents(data);
      } catch {
        if (isMounted) setStudentsError("Unable to load students.");
      } finally {
        if (isMounted) setStudentsLoading(false);
      }
    }

    void loadStudents();

    return () => {
      isMounted = false;
    };
  }, [classId, tab]);

  useEffect(() => {
    setClassStudents(null);
    setStudentsError("");
    setStudentsSuccess("");
    setShowEditStudents(false);
    setTransferOptions([]);
    setAvailableStudents([]);
    setTransferOptionsError("");
  }, [classId]);

  const isRouteChanging = Boolean(classDetail && classId && String(classDetail.class_id) !== classId);

  if (isLoading || isRouteChanging) {
    return (
      <AppLayout>
        <StatePanel message="Loading class details..." />
      </AppLayout>
    );
  }

  if (loadError || !classDetail) {
    return (
      <AppLayout>
        <StatePanel message="Unable to load class details.">
          <button
            className="rounded-md border border-black bg-[#79bd80] px-3 py-1 text-xs font-bold shadow-[2px_2px_0_#000]"
            onClick={() => navigate("/admin/classes")}
          >
            Back to Classes
          </button>
        </StatePanel>
      </AppLayout>
    );
  }

  const loadedClass = classDetail;
  const isArchived = normalizedClassStatus(loadedClass.class_status) === "Archived";
  const adviserName = adviserDisplayName(loadedClass);
  const activeSince = formatClassDate(loadedClass.created_at);
  const placeholderClass = classData[0];
  const selectedClass: ClassRecord = {
    ...placeholderClass,
    id: String(loadedClass.class_id),
    grade: loadedClass.academic_level.level_name,
    section: loadedClass.section_name,
    adviser: adviserName,
    academicYear: loadedClass.academic_year.year_label,
    status: normalizedClassStatus(loadedClass.class_status),
  };

  async function refreshStudents() {
    const data = await getClassStudents(loadedClass.class_id, { pageSize: 200 });
    setClassStudents(data);
  }

  async function openEditStudentList() {
    if (isArchived) return;
    setTransferOptionsError("");
    try {
      const [studentData, options, available] = await Promise.all([
        getClassStudents(loadedClass.class_id, { pageSize: 200 }),
        getClassTransferOptions(loadedClass.class_id),
        getUnassignedClassStudents(loadedClass.academic_level.academic_level_id),
      ]);
      setClassStudents(studentData);
      setTransferOptions(options.available_sections);
      setAvailableStudents(available.students);
      setShowEditStudents(true);
    } catch {
      setTransferOptionsError("Unable to load student edit options.");
    }
  }

  async function saveStudentListChanges(payload: UpdateClassStudentListRequest) {
    const updatedStudents = await updateClassStudentList(loadedClass.class_id, payload);
    setClassStudents(updatedStudents);
    const [availableResult, detailResult] = await Promise.allSettled([
      getUnassignedClassStudents(loadedClass.academic_level.academic_level_id),
      getClassDetail(loadedClass.class_id),
    ]);
    if (availableResult.status === "fulfilled") setAvailableStudents(availableResult.value.students);
    if (detailResult.status === "fulfilled") setClassDetail(detailResult.value);
    setStudentsSuccess("Student list updated successfully.");
  }

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-0 px-4 py-4 md:px-6 md:py-5">

            {/* Page header — breadcrumb + context actions */}
            <header className="flex items-center justify-between border-b border-black/40 pb-4">
              <h1 className="flex flex-wrap items-center gap-1.5 text-3xl font-bold tracking-tight">
                {/* Breadcrumb: Classes is a clickable link */}
                <Link
                  to="/admin/classes"
                  className="text-black/50 hover:text-black hover:underline transition-colors"
                >
                  Classes
                </Link>
                <ChevronRight className="size-5 text-black/30" />
                {/* Grade level — clicking filters back to that grade level eventually */}
                <span className="text-2xl text-black/50">{selectedClass.grade}</span>
                <ChevronRight className="size-5 text-black/30" />
                {/* Current section — active */}
                <span className="text-2xl text-black">{selectedClass.section}</span>
              </h1>

              {/* Context-aware action buttons */}
              <div className="flex items-center gap-2">
                {tab === "subjects" && !isArchived && (
                  <ActionButton secondary>
                    <Plus className="size-4" /> Add Subject Load
                  </ActionButton>
                )}
                {!isArchived && (
                  <ActionButton onClick={() => setShowEditClass(true)}>
                    <Pencil className="size-4" /> Edit Class
                  </ActionButton>
                )}
              </div>
            </header>

            {/* Sticky tab bar — stays visible while scrolling content */}
            <div className="sticky top-0 z-10 -mx-4 border-b border-black/40 bg-background md:-mx-6">
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

            {/* Tab content */}
            <div className="flex flex-col gap-3 pt-4">
              {isArchived && (
                <section className="rounded-lg border-2 border-black bg-[#f7e9aa] p-3 text-sm font-bold shadow-[3px_3px_0_#000]">
                  This class is archived and read-only. Restore it before editing
                  class information, Student assignments, or subject loads.
                </section>
              )}
              {/* Class identity banner */}
              <section className="rounded-lg border border-black bg-[#f7e9aa] p-4 shadow-[3px_3px_0_#000]">
                <h2 className="text-2xl font-bold">{selectedClass.section}</h2>
                <p className="text-xs">
                  {selectedClass.grade} - {selectedClass.academicYear} | Active since {activeSince}
                </p>
              </section>

              {tab === "classes" && (
                <OverviewTab selectedClass={selectedClass} activeSince={activeSince} />
              )}
              {tab === "students" && (
                <StudentsTab
                  studentData={classStudents}
                  isLoading={studentsLoading}
                  error={studentsError}
                  success={studentsSuccess}
                  editError={transferOptionsError}
                  isReadOnly={isArchived}
                  onRetry={() => void refreshStudents()}
                  onEdit={() => void openEditStudentList()}
                />
              )}
              {tab === "subjects" && (
                <SubjectLoadTab selectedClass={selectedClass} />
              )}
            </div>
          </div>
        </div>
      </div>
      {showEditClass && !isArchived && (
        <EditClassModal
          classId={loadedClass.class_id}
          initialClass={loadedClass}
          onClose={() => setShowEditClass(false)}
          onSaved={(updatedClass) => setClassDetail(updatedClass)}
        />
      )}
      {showEditStudents && classStudents && !isArchived && (
        <EditStudentListModal
          currentSectionId={loadedClass.class_id}
          currentSectionName={loadedClass.section_name}
          academicLevel={loadedClass.academic_level.level_name}
          students={classStudents.students}
          availableStudents={availableStudents}
          availableSections={transferOptions}
          onSaveChanges={saveStudentListChanges}
          onClose={() => setShowEditStudents(false)}
        />
      )}
    </AppLayout>
  );
}

function ActionButton({
  children,
  secondary = false,
  onClick,
}: {
  children: ReactNode;
  secondary?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg border-2 border-black ${
        secondary ? "bg-background" : "bg-[#79bd80]"
      } px-4 py-2 text-sm font-semibold shadow-[3px_3px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000]`}
    >
      {children}
    </button>
  );
}

function StatePanel({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col gap-5 px-4 py-4 md:px-6 md:py-5">
      <div className="rounded-lg border-2 border-black bg-[#fffdf5] p-8 text-center text-sm text-black/60 shadow-[3px_3px_0_#000]">
        <p className="font-bold text-black">{message}</p>
        {children && <div className="mt-3 flex justify-center">{children}</div>}
      </div>
    </main>
  );
}

function adviserDisplayName(classDetail: ClassDetailResponse) {
  if (!classDetail.adviser) return "No adviser assigned";
  return [
    classDetail.adviser.first_name,
    classDetail.adviser.middle_name,
    classDetail.adviser.last_name,
    classDetail.adviser.suffix,
  ]
    .filter(Boolean)
    .join(" ");
}

function normalizedClassStatus(status: string) {
  return status.trim().toLocaleLowerCase() === "archived" ? "Archived" : "Active";
}

function formatClassDate(value: string | null) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function retroDetailButton(className = "") {
  return `inline-flex items-center justify-center gap-2 rounded-md border border-black bg-white px-3 py-2 text-sm font-semibold text-black shadow-[3px_3px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000] ${className}`;
}

function StateInline({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="grid gap-3 p-6 text-center text-sm font-semibold text-black/60">
      <p>{message}</p>
      {children && <div className="flex justify-center">{children}</div>}
    </div>
  );
}

function groupClassStudents(students: ClassStudentListItem[]) {
  const order = ["Male", "Female", "Other", "Unspecified"];
  return order
    .map((gender) => [gender, students.filter((student) => normalizedStudentGender(student.gender) === gender)] as const)
    .filter(([, group]) => group.length > 0);
}

function normalizedStudentGender(gender: string) {
  if (gender === "Female" || gender === "Male" || gender === "Other") return gender;
  return "Unspecified";
}

function OverviewTab({ selectedClass, activeSince }: { selectedClass: ClassRecord; activeSince: string }) {
  // Cap recent activity at 3 items
  const recentActivity = [1, 2, 3, 4, 5, 6].slice(0, 3);

  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_300px]">
      {/* Main column */}
      <div className="grid gap-3">
        <h3 className="text-lg font-bold">Overview</h3>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          {/* Performance chart */}
          <section className="rounded-lg border border-black bg-[#fffdf5] p-4 shadow-[3px_3px_0_#000]">
            <div className="mb-2">
              <h4 className="text-lg font-bold">Period Class Performance</h4>
              <p className="text-[10px] font-semibold text-black/65">Average class mastery across all subjects</p>
            </div>
            <svg
              viewBox="0 0 620 170"
              className="h-40 w-full rounded-md bg-white"
              role="img"
              aria-label="Period class performance graph"
            >
              {[35, 65, 95, 125].map((y) => (
                <line key={y} x1="38" x2="596" y1={y} y2={y} stroke="#dfd8bf" strokeWidth="1" />
              ))}
              <line x1="38" x2="596" y1="140" y2="140" stroke="#222" strokeWidth="1" opacity=".35" />
              <polyline points="60,102 300,88 540,74" fill="none" stroke="#4f8b5f" strokeWidth="4" />
              <polyline
                points="60,114 210,108 360,102 540,96"
                fill="none"
                stroke="#e0be5a"
                strokeDasharray="5 4"
                strokeWidth="2"
              />
              {(
                [
                  ["T1", 58],
                  ["T2", 298],
                  ["T3", 538],
                ] as [string, number][]
              ).map(([label, x]) => (
                <text key={label} x={x} y="158" fontSize="10" fontWeight="700" fill="#555">
                  {label}
                </text>
              ))}
              <rect x="512" y="54" width="54" height="18" rx="8" fill="#4f8b5f" />
              <text x="526" y="67" fontSize="9" fontWeight="700" fill="white">
                88.4%
              </text>
            </svg>
          </section>

          {/* Subject breakdown */}
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

        {/* Class Adviser */}
        <section>
          <h3 className="mb-1 text-lg font-bold">Class Adviser</h3>
          <div className="flex items-center gap-3 rounded-lg border border-black bg-[#fffdf5] p-3 shadow-[3px_3px_0_#000]">
            <Avatar text={selectedClass.adviser} />
            <span>
              <span className="block text-sm font-bold">{selectedClass.adviser}</span>
              <span className="block text-[10px] font-semibold text-black/65">
                Adviser assigned since {activeSince}
              </span>
            </span>
          </div>
        </section>

        {/* Subjects */}
        <section>
          <h3 className="mb-1 text-lg font-bold">Subjects</h3>
          <div className="grid gap-2">
            {selectedClass.subjects.map((subject) => (
              <div
                key={subject.name}
                className="flex min-h-16 items-center justify-between rounded-lg border border-black bg-[#fffdf5] px-4 py-3 shadow-[3px_3px_0_#000]"
              >
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

      {/* Sidebar — Recent Activity */}
      <aside>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-lg font-bold">Recent Activity</h3>
          {/* View all link — swap href to real route when available */}
          <button className="text-xs font-semibold text-black/50 underline-offset-2 hover:text-black hover:underline transition-colors">
            View all
          </button>
        </div>
        <div className="grid gap-2 rounded-lg border border-black bg-[#fffdf5] p-3 shadow-[3px_3px_0_#000]">
          {recentActivity.map((item) => (
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
  studentData,
  isLoading,
  error,
  success,
  editError,
  isReadOnly,
  onRetry,
  onEdit,
}: {
  studentData: ClassStudentListResponse | null;
  isLoading: boolean;
  error: string;
  success: string;
  editError: string;
  isReadOnly: boolean;
  onRetry: () => void;
  onEdit: () => void;
}) {
  const [search, setSearch] = useState("");
  const students = studentData?.students ?? [];
  const searchTerm = search.trim().toLocaleLowerCase();
  const filteredStudents = students
    .filter((student) => !searchTerm || student.full_name.toLocaleLowerCase().includes(searchTerm))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const groupedStudents = groupClassStudents(filteredStudents);

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Total Students" value={studentData?.summary.total_students ?? 0} note="Real assigned students">
          <GenderBar
            male={studentData?.summary.gender_counts.male ?? 0}
            female={studentData?.summary.gender_counts.female ?? 0}
          />
        </MetricCard>
        <MetricCard label="Avg. Class Score" value="88%" note="12% increased from last month" />
        <MetricCard label="At-Risk Students" value={3} note="12% increased from last month" />
      </div>
      <section>
        <div className="mb-2 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-lg font-bold">Students</h3>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search students..."
              className="h-10 rounded-md border border-black bg-[#fffdf5] px-3 text-sm sm:w-64"
            />
            {!isReadOnly && (
              <button className={retroDetailButton("!bg-[#79bd80]")} onClick={onEdit}>
                Edit Student List
              </button>
            )}
          </div>
        </div>
        {success && <div className="mb-2 rounded-md border border-black bg-[#d8efca] p-2 text-xs font-bold">{success}</div>}
        {editError && <div className="mb-2 rounded-md border border-red-700 bg-red-50 p-2 text-xs font-bold text-red-800">{editError}</div>}
        <div className="max-h-[520px] overflow-y-auto rounded-xl border-2 border-black bg-[#fffdf5] p-5 shadow-[4px_4px_0_#000]">
          {isLoading ? (
            <StateInline message="Loading students..." />
          ) : error ? (
            <StateInline message="Unable to load students.">
              <button className={retroDetailButton("bg-[#79bd80]")} onClick={onRetry}>Retry</button>
            </StateInline>
          ) : !students.length ? (
            <StateInline message="No students are currently assigned to this class." />
          ) : !filteredStudents.length ? (
            <StateInline message="No students match your search." />
          ) : (
            <div className="grid items-start gap-3">
              {groupedStudents.map(([gender, group]) => (
                <details key={gender} open className="group overflow-hidden rounded-xl border-2 border-black bg-[#fffdf5] shadow-[4px_4px_0_#000]">
                  <summary className="flex cursor-pointer list-none items-center justify-between bg-[#f7e9aa] px-5 py-4 text-base font-black">
                    <span>{gender.toUpperCase()}</span>
                    <span className="flex items-center gap-2">
                      <span className="rounded-full border border-black/30 bg-white px-3 py-0.5 text-[10px]">
                        {group.length} student{group.length !== 1 ? "s" : ""}
                      </span>
                      <ChevronDown className="size-4 rotate-180 transition-transform group-open:rotate-180" />
                    </span>
                  </summary>
                  <div>
                    {group.map((student) => (
                      <div key={student.student_id} className="flex min-h-14 items-center gap-4 border-b border-black/10 bg-white px-4 py-3 text-sm last:border-b-0">
                        <RosterAvatar text={student.avatar_initial || student.full_name} />
                        <span className="min-w-0">
                          <span className="block truncate text-base font-black">{student.full_name}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
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
  return (
    <div className="mt-3 grid gap-1 text-[10px] font-semibold">
      <div className="flex h-3 overflow-hidden rounded-full border border-black bg-white">
        <div className="bg-[#79bd80]" style={{ width: `${(male / total) * 100}%` }} />
        <div className="bg-[#f7c76f]" style={{ width: `${(female / total) * 100}%` }} />
      </div>
      <div className="flex justify-between">
        <span>Male {male}</span>
        <span>Female {female}</span>
      </div>
    </div>
  );
}

function Avatar({ text }: { text: string }) {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-full border border-amber-700 bg-amber-200 text-[13px] font-semibold text-amber-900">
      {text.charAt(0)}
    </span>
  );
}

function RosterAvatar({ text }: { text: string }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full border border-[#d97706] bg-[#f7c76f] text-sm font-semibold text-[#7a3e00]">
      {(text || "?").charAt(0).toLocaleUpperCase()}
    </span>
  );
}

function SubjectLoadTab({ selectedClass }: { selectedClass: ClassRecord }) {
  if (!selectedClass.subjects.length)
    return (
      <div className="rounded-lg border border-black bg-[#fffdf5] p-8 text-center shadow-[3px_3px_0_#000]">
        No subject load assigned yet.
      </div>
    );

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
              {index === 2 && (
                <div className="border-b border-black/40 py-1 text-center text-[10px] font-semibold">Break</div>
              )}
              {index === 4 && (
                <div className="border-b border-black/40 py-1 text-center text-[10px] font-semibold">Lunch Break</div>
              )}
              <div className="grid min-h-10 grid-cols-[minmax(150px,1fr)_150px_130px_minmax(180px,1fr)] items-center border-b border-black/40 px-3 py-2 text-xs last:border-b-0">
                <b>{subject.name}</b>
                <span className="text-center">{subject.time}</span>
                <span className="flex justify-center gap-1">
                  {["M", "T", "W", "Th", "F"].map((day) => (
                    <span
                      key={day}
                      className="grid size-5 place-items-center rounded-full border border-black/30 bg-white text-[9px]"
                    >
                      {day}
                    </span>
                  ))}
                </span>
                <span className="flex items-center justify-center gap-2">
                  <Avatar text={subject.teacher} />
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
