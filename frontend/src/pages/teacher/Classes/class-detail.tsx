import { type ReactNode, useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Users } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Tabs } from "@/components/retroui/Tabs";
import AppLayout from "@/layouts/app-layout";
import { Card } from "@/components/retroui/Card";
import { ManualSuggestionPanel } from "@/components/teacher/suggestions/ManualSuggestionPanel";
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
  const [detail, setDetail] =
    useState<TeacherAdvisoryClassDetailResponse | null>(null);
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
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load class details.",
          );
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
            className="rounded-md border-2 border-black bg-[#79bd80] px-3 py-1 text-xs font-bold"
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
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6">
            <header className="flex items-center gap-3">
              <Breadcrumb>
                <Breadcrumb.List>
                  <Breadcrumb.Item>
                    <Breadcrumb.Link
                      onClick={() => navigate("/teacher/classes")}
                      className="text-2xl md:text-4xl text-black/50 hover:text-black cursor-pointer"
                    >
                      Classes
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator />
                  <Breadcrumb.Item>
                    <Breadcrumb.Link className="text-2xl md:text-4xl text-black/50 hover:text-black cursor-pointer">
                      {detail.academic_level}
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator />
                  <Breadcrumb.Item>
                    <Breadcrumb.Page className="text-xl md:text-3xl">
                      {detail.section_name}
                    </Breadcrumb.Page>
                  </Breadcrumb.Item>
                </Breadcrumb.List>
              </Breadcrumb>
            </header>

            <Tabs<DetailTab>
              tabs={[
                {
                  id: "classes",
                  label: "Classes",
                  icon: BookOpen,
                },
                {
                  id: "students",
                  label: "Students",
                  icon: Users,
                },
                {
                  id: "subjects",
                  label: "Subject Load",
                  icon: BookOpen,
                },
              ]}
              activeTab={tab}
              onTabChange={setTab}
            />

            <Card className="block w-full border-black bg-[#F6E9B2] transition-none hover:shadow-md">
              <Card.Content>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <Card.Title className="mb-0">
                      {detail.section_name}
                    </Card.Title>
                    <p className="text-xs font-semibold">
                      {detail.academic_level} - {detail.academic_year} | Active
                      since {activeSince}
                    </p>
                  </div>
                  <span className="w-fit rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-black">
                    {statusLabel}
                  </span>
                </div>
              </Card.Content>
            </Card>

            {tab === "classes" && <OverviewTab detail={detail} />}
            {tab === "students" && <StudentsTab detail={detail} />}
            {tab === "subjects" && <SubjectLoadTab detail={detail} />}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function OverviewTab({
  detail,
}: {
  detail: TeacherAdvisoryClassDetailResponse;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_300px] items-stretch">
        <div className="flex flex-col gap-2">
          <h3 className="text-lg font-bold">Overview</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="block w-full border-black">
              <Card.Header>
                <Card.Description>Total Students</Card.Description>
              </Card.Header>
              <Card.Content>
                <Card.Title>{detail.student_count}</Card.Title>
                <p className="text-xs text-black">Real assigned students</p>
              </Card.Content>
            </Card>

            <Card className="block w-full border-black">
              <Card.Header>
                <Card.Description>Subjects</Card.Description>
              </Card.Header>
              <Card.Content>
                <Card.Title>{detail.subject_count}</Card.Title>
                <p className="text-xs text-black">
                  Active and historical subject loads
                </p>
              </Card.Content>
            </Card>
          </div>
        </div>
        <aside className="flex flex-col gap-2">
          <h3 className="text-lg font-bold">Recent Activity</h3>
          <Card className="block w-full flex-1">
            <Card.Content className="flex h-full items-center justify-center p-6 text-center text-sm font-semibold text-black/60">
              No recent activity available yet.
            </Card.Content>
          </Card>
        </aside>
      </div>

      <section>
        <h3 className="mb-2 text-lg font-bold">Subjects</h3>
        <div className="grid gap-2">
          {detail.subject_loads.length ? (
            detail.subject_loads.map((load) => (
              <Card
                key={load.subject_load_id}
                className="block w-full border-black transition-none hover:shadow-md"
              >
                <Card.Content className="flex min-h-16 items-center justify-between gap-4">
                  <span>
                    <span className="block text-xl font-black">
                      {load.subject_name}
                    </span>
                    <span className="block text-[10px] font-semibold text-black/65">
                      {load.teacher_name}
                    </span>
                  </span>
                  <span className="text-right text-xs font-semibold">
                    {load.schedule || "No schedule"}
                  </span>
                </Card.Content>
              </Card>
            ))
          ) : (
            <EmptyInline message="No subject load assigned yet." />
          )}
        </div>
      </section>
    </div>
  );
}

function StudentsTab({
  detail,
}: {
  detail: TeacherAdvisoryClassDetailResponse;
}) {
  const [search, setSearch] = useState("");
  const filteredStudents = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return detail.students
      .filter(
        (student) =>
          !query || student.full_name.toLocaleLowerCase().includes(query),
      )
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [detail.students, search]);
  const groupedStudents = groupStudents(filteredStudents);

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="block w-full border-black">
          <Card.Header>
            <Card.Description>Students</Card.Description>
          </Card.Header>
          <Card.Content>
            <Card.Title>{detail.student_count}</Card.Title>
            <p className="text-xs text-black">Full advisory roster</p>
          </Card.Content>
        </Card>

        <Card className="block w-full border-black">
          <Card.Header>
            <Card.Description>Male</Card.Description>
          </Card.Header>
          <Card.Content>
            <Card.Title>{detail.male_count}</Card.Title>
          </Card.Content>
        </Card>

        <Card className="block w-full border-black">
          <Card.Header>
            <Card.Description>Female</Card.Description>
          </Card.Header>
          <Card.Content>
            <Card.Title>{detail.female_count}</Card.Title>
          </Card.Content>
        </Card>
      </div>
      <section>
        <div className="mb-2 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <h3 className="text-lg font-bold">Students</h3>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search students..."
            className="h-10 rounded-md border-2 border-black bg-white px-3 text-sm sm:w-64"
          />
        </div>
        <Card className="block w-full border-black">
          <Card.Content className="max-h-[560px] overflow-y-auto p-4">
            {!detail.students.length ? (
              <StateInline message="No students are currently enrolled in this class." />
            ) : !filteredStudents.length ? (
              <StateInline message="No students match your search." />
            ) : (
              <div className="grid items-start gap-3">
                {groupedStudents.map(([gender, students]) => (
                  <details
                    key={gender}
                    open
                    className="group overflow-hidden rounded-lg border-2 border-black bg-white"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between bg-[#f7e9aa] px-4 py-3 text-sm font-black">
                      <span>{gender.toUpperCase()}</span>
                      <span className="flex items-center gap-2">
                        <span className="rounded-full border border-black/30 bg-white px-2 py-0.5 text-[10px]">
                          {students.length} student
                          {students.length !== 1 ? "s" : ""}
                        </span>
                        <ChevronDown className="size-4" />
                      </span>
                    </summary>
                    <div>
                      {students.map((student) => (
                        <StudentRow
                          key={student.student_id}
                          student={student}
                          classId={detail.class_id}
                          subjectLoads={detail.subject_loads}
                        />
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </Card.Content>
        </Card>
      </section>
    </div>
  );
}

function SubjectLoadTab({
  detail,
}: {
  detail: TeacherAdvisoryClassDetailResponse;
}) {
  if (!detail.subject_loads.length) {
    return <EmptyInline message="No subject load assigned yet." />;
  }

  return (
    <section>
      <h3 className="mb-2 text-lg font-bold">Subject Load</h3>
      <Card className="block w-full border-black overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_160px_120px] border-b-2 border-black/50 px-3 py-1.5 text-[11px] font-semibold text-black/70">
            <span>Subject</span>
            <span>Teacher</span>
            <span>Schedule</span>
            <span>Status</span>
          </div>
          {detail.subject_loads.map((load) => (
            <div
              key={load.subject_load_id}
              className="grid min-h-12 grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_160px_120px] items-center border-b border-black/20 px-3 py-2 text-xs last:border-b-0"
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
      </Card>
    </section>
  );
}

function StudentRow({
  student,
  classId,
  subjectLoads,
}: {
  student: TeacherAdvisoryStudentItem;
  classId: number;
  subjectLoads: TeacherAdvisoryClassDetailResponse["subject_loads"];
}) {
  return (
    <div className="border-b border-black/10 bg-white px-3 py-2 text-sm last:border-b-0">
      <div className="flex min-h-12 items-center gap-3">
        <Avatar text={student.avatar_initial || student.full_name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">
            {student.full_name}
          </span>
          {student.student_lrn && (
            <span className="block text-[10px] font-semibold text-black/55">
              LRN {student.student_lrn}
            </span>
          )}
        </span>
      </div>
      <ManualSuggestionPanel
        classId={classId}
        student={student}
        subjectLoads={subjectLoads}
      />
    </div>
  );
}

function StatePanel({
  message,
  children,
}: {
  message: string;
  children?: ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col gap-5 px-4 py-4 md:px-6 md:py-5">
      <Card className="block w-full border-black">
        <Card.Content className="p-8 text-center text-sm text-black/60">
          <p className="font-bold text-black">{message}</p>
          {children && (
            <div className="mt-3 flex justify-center">{children}</div>
          )}
        </Card.Content>
      </Card>
    </main>
  );
}

function StateInline({ message }: { message: string }) {
  return (
    <div className="p-6 text-center text-sm font-semibold text-black/60">
      {message}
    </div>
  );
}

function EmptyInline({ message }: { message: string }) {
  return (
    <Card className="block w-full border-black">
      <Card.Content className="p-8 text-center text-sm font-semibold text-black/60">
        {message}
      </Card.Content>
    </Card>
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
  if (gender === "Female" || gender === "Male" || gender === "Other")
    return gender;
  return "Unspecified";
}

function groupStudents(students: TeacherAdvisoryStudentItem[]) {
  const order = ["Male", "Female", "Other", "Unspecified"];
  return order
    .map(
      (gender) =>
        [
          gender,
          students.filter(
            (student) => normalizedStudentGender(student.gender) === gender,
          ),
        ] as const,
    )
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
