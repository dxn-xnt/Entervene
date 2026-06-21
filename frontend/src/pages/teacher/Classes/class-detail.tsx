import { type ReactNode, useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Search, Users } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Tabs from "@/components/Tabs";
import AppLayout from "@/layouts/app-layout";
import { getTeacherAdvisoryClassDetail } from "@/lib/api";
import type {
  TeacherAdvisoryClassDetailResponse,
  TeacherAdvisoryStudentItem,
} from "@/types/adminClasses";

type DetailTab = "classes" | "students" | "subjects";

export default function TeacherClassDetail() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<DetailTab>("classes");
  const [detail, setDetail] = useState<TeacherAdvisoryClassDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadDetail() {
      if (!classId) {
        setError("Class not found.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError("");
      try {
        const data = await getTeacherAdvisoryClassDetail(classId);
        if (isMounted) setDetail(data);
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Unable to load class details.");
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadDetail();

    return () => {
      isMounted = false;
    };
  }, [classId]);

  if (isLoading) {
    return (
      <AppLayout>
        <StatePanel message="Loading class details..." />
      </AppLayout>
    );
  }

  if (error || !detail) {
    return (
      <AppLayout>
        <StatePanel message={error || "Unable to load class details."}>
          <button
            type="button"
            onClick={() => navigate("/teacher/classes")}
            className="rounded-md border border-black bg-[#79bd80] px-3 py-1 text-xs font-bold shadow-[2px_2px_0_#000]"
          >
            Back to Classes
          </button>
        </StatePanel>
      </AppLayout>
    );
  }

  const statusLabel = detail.is_archived ? "Archived" : "Active";
  const activeSince = detail.active_since || formatClassDate(detail.created_at);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-0 px-4 py-4 md:px-6 md:py-5">
            <header className="flex items-center justify-between border-b border-black/40 pb-4">
              <h1 className="flex flex-wrap items-center gap-1.5 text-3xl font-bold tracking-tight">
                <Link
                  to="/teacher/classes"
                  className="text-black/50 transition-colors hover:text-black hover:underline"
                >
                  Classes
                </Link>
                <ChevronRight className="size-5 text-black/30" />
                <span className="text-2xl text-black/50">{detail.academic_level}</span>
                <ChevronRight className="size-5 text-black/30" />
                <span className="text-2xl text-black">{detail.section_name}</span>
              </h1>
            </header>

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

            <div className="flex flex-col gap-3 pt-4">
              {detail.is_archived && (
                <section className="rounded-lg border-2 border-black bg-[#f7e9aa] p-3 text-sm font-bold shadow-[3px_3px_0_#000]">
                  Archived. This class has been archived. This view is read-only.
                </section>
              )}

              <section className="rounded-lg border border-black bg-[#f7e9aa] p-4 shadow-[3px_3px_0_#000]">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h2 className="text-2xl font-bold">{detail.section_name}</h2>
                    <p className="text-xs font-semibold">
                      {detail.academic_level} - {detail.academic_year} | Active since {activeSince}
                    </p>
                  </div>
                  <span className="w-fit rounded-full border border-black bg-white px-3 py-1 text-xs font-black">
                    {statusLabel}
                  </span>
                </div>
              </section>

              {tab === "classes" && <OverviewTab detail={detail} />}
              {tab === "students" && <StudentsTab detail={detail} />}
              {tab === "subjects" && <SubjectLoadTab detail={detail} />}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function OverviewTab({ detail }: { detail: TeacherAdvisoryClassDetailResponse }) {
  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_300px]">
      <div className="grid gap-3">
        <h3 className="text-lg font-bold">Overview</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <MetricCard label="Total Students" value={detail.student_count} note="Real assigned students" />
          <MetricCard label="Subjects" value={detail.subject_count} note="Active and historical subject loads" />
          <MetricCard label="Class Status" value={detail.is_archived ? "Archived" : "Active"} note="Read-only adviser view" />
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          <EmptyDataCard
            title="Quarterly Class Performance"
            message="No performance data available yet."
          />
          <EmptyDataCard
            title="Subject Breakdown"
            message="No subject performance data available yet."
          />
        </div>
        <section>
          <h3 className="mb-1 text-lg font-bold">Subjects</h3>
          <div className="grid gap-2">
            {detail.subject_loads.length ? (
              detail.subject_loads.map((load) => (
                <div
                  key={load.subject_load_id}
                  className="flex min-h-16 items-center justify-between gap-4 rounded-lg border border-black bg-[#fffdf5] px-4 py-3 shadow-[3px_3px_0_#000]"
                >
                  <span>
                    <span className="block text-xl font-black">{load.subject_name}</span>
                    <span className="block text-[10px] font-semibold text-black/65">
                      {load.teacher_name}
                    </span>
                  </span>
                  <span className="text-right text-xs font-semibold">
                    {load.schedule || "No schedule"}
                  </span>
                </div>
              ))
            ) : (
              <EmptyInline message="No subject load assigned yet." />
            )}
          </div>
        </section>
      </div>
      <aside>
        <h3 className="mb-1 text-lg font-bold">Recent Activity</h3>
        <div className="rounded-lg border border-black bg-[#fffdf5] p-6 text-center text-sm font-semibold text-black/60 shadow-[3px_3px_0_#000]">
          No recent activity available yet.
        </div>
      </aside>
    </div>
  );
}

function StudentsTab({ detail }: { detail: TeacherAdvisoryClassDetailResponse }) {
  const [search, setSearch] = useState("");
  const filteredStudents = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return detail.students
      .filter((student) => !query || student.full_name.toLocaleLowerCase().includes(query))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [detail.students, search]);
  const groupedStudents = groupStudents(filteredStudents);

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Students" value={detail.student_count} note="Full advisory roster" />
        <MetricCard label="Male" value={detail.male_count} />
        <MetricCard label="Female" value={detail.female_count} />
      </div>
      <section>
        <div className="mb-2 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-lg font-bold">Students</h3>
            <p className="text-xs font-semibold text-black/65">{detail.student_count} Students</p>
            <div className="mt-1 flex flex-wrap gap-2 text-xs font-semibold text-black/70">
              <span className="rounded-full border border-black/30 bg-white px-2 py-0.5">Male: {detail.male_count}</span>
              <span className="rounded-full border border-black/30 bg-white px-2 py-0.5">Female: {detail.female_count}</span>
            </div>
          </div>
          <label className="flex h-10 items-center gap-2 rounded-md border border-black bg-[#fffdf5] px-3 text-sm sm:w-72">
            <Search className="size-4 text-black/50" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search students..."
              className="min-w-0 flex-1 bg-transparent outline-none"
            />
          </label>
        </div>
        <div className="max-h-[560px] overflow-y-auto rounded-lg border border-black bg-[#fffdf5] p-4 shadow-[3px_3px_0_#000]">
          {!detail.students.length ? (
            <StateInline message="No students are currently enrolled in this class." />
          ) : !filteredStudents.length ? (
            <StateInline message="No students match your search." />
          ) : (
            <div className="grid items-start gap-3 lg:grid-cols-2">
              {groupedStudents.map(([gender, students]) => (
                <details key={gender} open className="group overflow-hidden rounded-lg border-2 border-black bg-[#fffdf5] shadow-[3px_3px_0_#000]">
                  <summary className="flex cursor-pointer list-none items-center justify-between bg-[#f7e9aa] px-4 py-3 text-sm font-black">
                    <span>{gender.toUpperCase()}</span>
                    <span className="flex items-center gap-2">
                      <span className="rounded-full border border-black/30 bg-white px-2 py-0.5 text-[10px]">
                        {students.length} student{students.length !== 1 ? "s" : ""}
                      </span>
                      <ChevronDown className="size-4" />
                    </span>
                  </summary>
                  <div>
                    {students.map((student) => (
                      <StudentRow key={student.student_id} student={student} />
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

function SubjectLoadTab({ detail }: { detail: TeacherAdvisoryClassDetailResponse }) {
  if (!detail.subject_loads.length) {
    return <EmptyInline message="No subject load assigned yet." />;
  }

  return (
    <section>
      <h3 className="mb-1 text-lg font-bold">Subject Load</h3>
      <div className="overflow-x-auto rounded-lg border border-black bg-[#fffdf5] shadow-[3px_3px_0_#000]">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_160px_120px] border-b border-black/50 px-3 py-1.5 text-[11px] font-semibold text-black/70">
            <span>Subject</span>
            <span>Teacher</span>
            <span>Schedule</span>
            <span>Status</span>
          </div>
          {detail.subject_loads.map((load) => (
            <div
              key={load.subject_load_id}
              className="grid min-h-12 grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_160px_120px] items-center border-b border-black/40 px-3 py-2 text-xs last:border-b-0"
            >
              <b>{load.subject_name}</b>
              <span className="flex items-center gap-2 font-semibold">
                <Avatar text={load.teacher_name} />
                {load.teacher_name}
              </span>
              <span>{load.schedule || "No schedule"}</span>
              <span className="w-fit rounded-full border border-black/30 bg-white px-2 py-0.5 font-bold">
                {load.status || "N/A"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StudentRow({ student }: { student: TeacherAdvisoryStudentItem }) {
  return (
    <div className="flex min-h-16 items-center gap-3 border-b border-black/10 bg-white px-3 py-2 text-sm last:border-b-0">
      <Avatar text={student.avatar_initial || student.full_name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{student.full_name}</span>
        <span className="block text-[11px] font-medium text-black/60">
          {student.gender}
          {student.student_lrn ? ` | LRN ${student.student_lrn}` : ""}
        </span>
        <span className="block truncate text-[11px] font-medium text-black/60">
          {student.email || "No email"}
          {student.account_status ? ` | ${student.account_status}` : ""}
        </span>
      </span>
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
}: {
  label: string;
  value: number | string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-black bg-[#fffdf5] p-4 shadow-[3px_3px_0_#000]">
      <p className="text-sm font-bold">{label}</p>
      <p className="mt-1 text-4xl font-black leading-none">{value}</p>
      {note && <p className="mt-2 text-[10px] font-semibold text-black/70">{note}</p>}
    </div>
  );
}

function EmptyDataCard({ title, message }: { title: string; message: string }) {
  return (
    <section className="rounded-lg border border-black bg-[#fffdf5] p-4 shadow-[3px_3px_0_#000]">
      <h4 className="text-lg font-bold">{title}</h4>
      <div className="mt-3 rounded-md border border-black/30 bg-white p-8 text-center text-sm font-semibold text-black/60">
        {message}
      </div>
    </section>
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

function StateInline({ message }: { message: string }) {
  return <div className="p-6 text-center text-sm font-semibold text-black/60">{message}</div>;
}

function EmptyInline({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-black bg-[#fffdf5] p-8 text-center text-sm font-semibold text-black/60 shadow-[3px_3px_0_#000]">
      {message}
    </div>
  );
}

function Avatar({ text }: { text: string }) {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-full border border-amber-700 bg-amber-200 text-[13px] font-semibold text-amber-900">
      {(text || "?").charAt(0)}
    </span>
  );
}

function normalizedStudentGender(gender: string) {
  if (gender === "Female" || gender === "Male" || gender === "Other") return gender;
  return "Unspecified";
}

function groupStudents(students: TeacherAdvisoryStudentItem[]) {
  const order = ["Male", "Female", "Other", "Unspecified"];
  return order
    .map((gender) => [gender, students.filter((student) => normalizedStudentGender(student.gender) === gender)] as const)
    .filter(([, group]) => group.length > 0);
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
