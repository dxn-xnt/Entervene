import { useEffect, useState } from "react";
import { BookOpen, ChevronDown, Pencil, Plus, Users } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card as RetroCard } from "@/components/retroui/Card";
import { EmptyStateCard } from "@/components/empty-state-card";
import { Input } from "@/components/retroui/Input";
import { Loader } from "@/components/retroui/Loader";
import { Tabs } from "@/components/retroui/Tabs";
import { Text } from "@/components/retroui/Text";
import { OverviewCard } from "@/components/overview-cards";
import EditClassModal from "@/pages/admin/forms/classes/edit-class";
import EditStudentListModal from "@/pages/admin/forms/classes/edit-student-list";
import {
  getClassDetail,
  getClassStudents,
  getClassTransferOptions,
  getUnassignedClassStudents,
  updateClassStudentList,
  getClassSchedule,
  type DynamicScheduleResponse,
} from "@/lib/api";
import { DynamicScheduleTable } from "@/components/dynamic-schedule-table";
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

function CustomAvatar({ text, size = "md" }: { text: string; size?: "sm" | "md" | "lg" }) {
  const initial = (text || "?").charAt(0).toUpperCase();
  const sizeClasses =
    size === "sm"
      ? "size-7 text-xs"
      : size === "lg"
        ? "size-10 text-base"
        : "size-8 text-sm";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border-2 border-border bg-primary font-bold text-primary-foreground ${sizeClasses}`}
    >
      {initial}
    </span>
  );
}

function groupClassStudents(students: ClassStudentListItem[]) {
  const order = ["Male", "Female", "Other", "Unspecified"];
  return order
    .map(
      (gender) =>
        [
          gender,
          students.filter((student) => normalizedStudentGender(student.gender) === gender),
        ] as const
    )
    .filter(([, group]) => group.length > 0);
}

function normalizedStudentGender(gender: string) {
  if (gender === "Female" || gender === "Male" || gender === "Other") return gender;
  return "Unspecified";
}

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

  const isRouteChanging = Boolean(
    classDetail && classId && String(classDetail.class_id) !== classId
  );

  if (isLoading || isRouteChanging) {
    return (
      <AppLayout>
        <div className="flex flex-1 flex-col p-4 md:p-6">
          <div className="flex items-center justify-center gap-3 border border-black bg-background py-12 text-sm text-muted-foreground shadow-[4px_5px_0_#000]">
            <Loader size="sm" />
            Loading class details...
          </div>
        </div>
      </AppLayout>
    );
  }

  if (loadError || !classDetail) {
    return (
      <AppLayout>
        <div className="flex flex-1 flex-col p-4 md:p-6">
          <RetroCard className="bg-accent p-4">
            <Text as="h2" className="font-sans text-xl font-bold">
              Unable to load class details
            </Text>
            <Text as="p" className="mt-1 text-sm text-black/70">
              {loadError || "Class not found."}
            </Text>
            <div className="mt-4">
              <Button onClick={() => navigate("/admin/classes")}>Back to Classes</Button>
            </div>
          </RetroCard>
        </div>
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
    if (availableResult.status === "fulfilled")
      setAvailableStudents(availableResult.value.students);
    if (detailResult.status === "fulfilled") setClassDetail(detailResult.value);
    setStudentsSuccess("Student list updated successfully.");
  }

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            {/* Header with Breadcrumb & Context Actions */}
            <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <Breadcrumb>
                  <Breadcrumb.List>
                    <Breadcrumb.Item>
                      <Breadcrumb.Link href="/admin/classes">Classes</Breadcrumb.Link>
                    </Breadcrumb.Item>
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item>
                      <Breadcrumb.Link
                        href={`/admin/classes?grade=${encodeURIComponent(selectedClass.grade)}`}
                        className="text-xl text-muted-foreground font-semibold"
                      >
                        {selectedClass.grade}
                      </Breadcrumb.Link>
                    </Breadcrumb.Item>
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item>
                      <Breadcrumb.Page>{selectedClass.section}</Breadcrumb.Page>
                    </Breadcrumb.Item>
                  </Breadcrumb.List>
                </Breadcrumb>
              </div>

              <div className="flex items-center gap-2">
                {tab === "subjects" && !isArchived && (
                  <Button variant="outline">
                    <Plus className="mr-2 size-4" /> Add Subject Load
                  </Button>
                )}
                {!isArchived && (
                  <Button onClick={() => setShowEditClass(true)}>
                    <Pencil className="mr-2 size-4" /> Edit Class
                  </Button>
                )}
              </div>
            </header>

            {/* Retro UI Tabs */}
            <Tabs<DetailTab>
              tabs={[
                { id: "classes", label: "Overview", icon: BookOpen },
                { id: "students", label: "Students", icon: Users },
                { id: "subjects", label: "Subject Load", icon: BookOpen },
              ]}
              activeTab={tab}
              onTabChange={(id) => setTab(id)}
            />

            {/* Tab content */}
            <div className="flex flex-col gap-3 pt-2">
              {isArchived && (
                <RetroCard className="bg-[#fff7d6] p-3">
                  <Text as="p" className="text-sm font-bold">
                    This class is archived and read-only. Restore it before editing class
                    information, student assignments, or subject loads.
                  </Text>
                </RetroCard>
              )}

              {/* Class identity banner */}
              <RetroCard className="bg-accent p-4">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <Text as="h2" className="font-sans text-2xl font-bold">
                      {selectedClass.section}
                    </Text>
                    <Badge variant={isArchived ? "default" : "surface"}>
                      {selectedClass.status}
                    </Badge>
                  </div>
                  <Text as="p" className="text-sm font-normal">
                    {selectedClass.grade} - {selectedClass.academicYear} | Active since{" "}
                    {activeSince}
                  </Text>
                </div>
              </RetroCard>

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
              {tab === "subjects" && <SubjectLoadTab selectedClass={selectedClass} />}
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

function OverviewTab({
  selectedClass,
  activeSince,
}: {
  selectedClass: ClassRecord;
  activeSince: string;
}) {
  const { classId } = useParams();
  const [scheduleData, setScheduleData] = useState<DynamicScheduleResponse | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadSchedule() {
      if (!classId) return;
      try {
        const data = await getClassSchedule(classId);
        if (isMounted) setScheduleData(data);
      } catch {
        // fallback
      }
    }
    void loadSchedule();
    return () => {
      isMounted = false;
    };
  }, [classId]);

  const recentActivity = [1, 2, 3].slice(0, 3);
  const classSubjects = (scheduleData?.schedule || []).filter((s) => s.type === "class");

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
      <div className="grid gap-4">
        <Text as="h3" className="font-sans text-xl font-bold">
          Overview
        </Text>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          {/* Performance chart */}
          <RetroCard className="p-4">
            <div className="mb-2">
              <Text as="h4" className="font-sans text-lg font-bold">
                Period Class Performance
              </Text>
              <Text as="p" className="text-xs font-semibold text-black/65">
                Average class mastery across all subjects
              </Text>
            </div>
            <svg
              viewBox="0 0 620 170"
              className="h-40 w-full rounded-md border border-border bg-background"
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
          </RetroCard>

          {/* Subject breakdown */}
          <RetroCard className="p-4">
            <Text as="h4" className="font-sans text-lg font-bold">
              Subject Breakdown
            </Text>
            <Text as="p" className="mb-3 text-xs font-semibold text-black/65">
              Average mastery per subject load
            </Text>
            <div className="grid gap-2">
              {(classSubjects.length > 0 ? classSubjects : selectedClass.subjects).map((subject: any, index: number) => {
                const name = subject.subject || subject.name || "Subject";
                const progress = (subject as any).progress || 90;
                return (
                  <div key={name} className="grid grid-cols-[80px_1fr_34px] items-center gap-2 text-xs">
                    <span className="truncate font-semibold">{name}</span>
                    <span className="h-2 rounded-full bg-black/15">
                      <span
                        className={`block h-full rounded-full ${index % 2 === 0 ? "bg-[#79bd80]" : "bg-[#f7c76f]"}`}
                        style={{ width: `${progress}%` }}
                      />
                    </span>
                    <span className="text-right font-bold">{progress}%</span>
                  </div>
                );
              })}
            </div>
          </RetroCard>
        </div>

        {/* Class Adviser */}
        <section className="flex flex-col gap-2">
          <Text as="h3" className="font-sans text-xl font-bold">
            Class Adviser
          </Text>
          <RetroCard className="p-3">
            <div className="flex items-center gap-3">
              <CustomAvatar text={selectedClass.adviser} size="lg" />
              <span>
                <Text as="p" className="text-base font-bold">
                  {selectedClass.adviser}
                </Text>
                <Text as="p" className="text-xs font-semibold text-black/65">
                  Adviser assigned since {activeSince}
                </Text>
              </span>
            </div>
          </RetroCard>
        </section>

        {/* Subjects */}
        <section className="flex flex-col gap-2">
          <Text as="h3" className="font-sans text-xl font-bold">
            Subjects
          </Text>
          <div className="grid gap-2">
            {classSubjects.length > 0 ? (
              classSubjects.map((subject) => (
                <RetroCard key={subject.subject_load_id || subject.subject} className="p-3">
                  <div className="flex items-center justify-between">
                    <span>
                      <Text as="p" className="text-lg font-bold">
                        {subject.subject}
                      </Text>
                      <Text as="p" className="text-xs font-semibold text-black/65">
                        Teacher: {subject.teacher || "Unassigned"}
                      </Text>
                    </span>
                    <Text as="p" className="text-sm font-semibold">
                      {subject.time}
                    </Text>
                  </div>
                </RetroCard>
              ))
            ) : (
              <EmptyStateCard title="No published subjects for this section yet." />
            )}
          </div>
        </section>
      </div>

      {/* Sidebar — Recent Activity */}
      <aside className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Text as="h3" className="font-sans text-xl font-bold">
            Recent Activity
          </Text>
          <button className="text-xs font-semibold text-black/50 underline-offset-2 hover:text-black hover:underline transition-colors">
            View all
          </button>
        </div>
        <RetroCard className="p-3">
          <div className="grid gap-2">
            {recentActivity.map((item) => (
              <div key={item} className="rounded-md border border-border bg-background p-2 text-xs">
                <p className="font-semibold">New lessons added for Sci10</p>
                <p className="text-black/65">Added by {selectedClass.adviser} - 2 hours ago</p>
              </div>
            ))}
          </div>
        </RetroCard>
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
  const { classId } = useParams();
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const students = studentData?.students ?? [];
  const searchTerm = search.trim().toLocaleLowerCase();
  const filteredStudents = students
    .filter((student) => !searchTerm || student.full_name.toLocaleLowerCase().includes(searchTerm))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const groupedStudents = groupClassStudents(filteredStudents);

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-3">
        <OverviewCard
          title="Total Students"
          count={String(studentData?.summary.total_students ?? 0)}
        />
        <OverviewCard title="Avg. Class Score" count="88%" stat="12%" />
        <OverviewCard title="At-Risk Students" count="3" stat="12%" />
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <Text as="h3" className="font-sans text-xl font-bold">
            Students
          </Text>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search students..."
              className="h-10 w-full sm:w-64"
            />
            {!isReadOnly && (
              <Button onClick={onEdit}>Edit Student List</Button>
            )}
          </div>
        </div>

        {success && (
          <RetroCard className="bg-[#d8efca] p-3">
            <Text as="p" className="text-xs font-bold">
              {success}
            </Text>
          </RetroCard>
        )}
        {editError && (
          <RetroCard className="bg-red-50 text-red-800 p-3">
            <Text as="p" className="text-xs font-bold">
              {editError}
            </Text>
          </RetroCard>
        )}

        <RetroCard className="max-h-[520px] overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center gap-3 border border-black bg-background py-12 text-sm text-muted-foreground shadow-[4px_5px_0_#000]">
              <Loader size="sm" />
              Loading students...
            </div>
          ) : error ? (
            <div className="grid gap-3 p-6 text-center text-sm font-semibold">
              <p>{error}</p>
              <div className="flex justify-center">
                <Button onClick={onRetry}>Retry</Button>
              </div>
            </div>
          ) : !students.length ? (
            <p className="p-6 text-center text-sm font-semibold text-black/60">
              No students are currently assigned to this class.
            </p>
          ) : !filteredStudents.length ? (
            <p className="p-6 text-center text-sm font-semibold text-black/60">
              No students match your search.
            </p>
          ) : (
            <div className="grid items-start gap-3">
              {groupedStudents.map(([gender, group]) => (
                <details
                  key={gender}
                  open
                  className="group overflow-hidden rounded-xl border-2 border-border bg-background shadow-none"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between bg-accent px-4 py-3 text-base font-bold">
                    <span>{gender.toUpperCase()}</span>
                    <span className="flex items-center gap-2">
                      <Badge variant="outline" size="sm">
                        {group.length} student{group.length !== 1 ? "s" : ""}
                      </Badge>
                      <ChevronDown className="size-4 rotate-180 transition-transform group-open:rotate-180" />
                    </span>
                  </summary>
                  <div>
                    {group.map((student) => (
                      <div
                        key={student.student_id}
                        className="flex min-h-14 items-center gap-3 border-b border-border bg-background px-4 py-3 text-sm last:border-b-0 cursor-pointer hover:bg-accent/40 transition-colors"
                        onClick={() =>
                          navigate(
                            `/admin/classes/${classId}/students/${student.student_id}`
                          )
                        }
                      >
                        <CustomAvatar text={student.avatar_initial || student.full_name} size="md" />
                        <span className="min-w-0 flex-1">
                          <Text as="p" className="truncate text-base font-bold">
                            {student.full_name}
                          </Text>
                        </span>
                        {(student.account_status || "").toLowerCase() === "pending" && (
                          <Badge
                            variant="outline"
                            size="sm"
                            className="shrink-0 border-amber-400 bg-amber-50 text-amber-700"
                          >
                            Pending
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </RetroCard>
      </section>
    </div>
  );
}

function SubjectLoadTab({ selectedClass: _selectedClass }: { selectedClass?: ClassRecord }) {
  const { classId } = useParams();
  const [scheduleData, setScheduleData] = useState<DynamicScheduleResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function loadSchedule() {
      if (!classId) return;
      setIsLoading(true);
      try {
        const data = await getClassSchedule(classId);
        if (isMounted) setScheduleData(data);
      } catch (err) {
        console.error("Failed to load class schedule:", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    void loadSchedule();
    return () => {
      isMounted = false;
    };
  }, [classId]);

  return (
    <section className="flex flex-col gap-2">
      <Text as="h3" className="font-sans text-xl font-bold">
        Subject Load Schedule
      </Text>
      <DynamicScheduleTable
        schedule={scheduleData?.schedule || []}
        isPublished={scheduleData?.is_published}
        isLoading={isLoading}
        emptyMessage="No published schedule assigned yet for this section."
      />
    </section>
  );
}
