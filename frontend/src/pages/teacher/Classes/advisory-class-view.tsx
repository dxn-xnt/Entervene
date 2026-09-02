import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import { Award, BookOpen, ChevronDown, Users } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Tabs } from "@/components/retroui/Tabs";
import AppLayout from "@/layouts/app-layout";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { EmptyStateCard } from "@/components/empty-state-card";
import { Input } from "@/components/retroui/Input";
import { Badge } from "@/components/retroui/Badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Table } from "@/components/retroui/Table";
import { OverviewCard } from "@/components/overview-cards";
import { ManualSuggestionPanel } from "@/components/teacher/suggestions/manual-suggestion-panel";
import { getTeacherAdvisoryClassDetail, getTeacherAdvisoryClassGrades } from "@/lib/api";
import type {
  TeacherAdvisoryClassDetailResponse,
  TeacherAdvisoryClassGradesResponse,
  TeacherAdvisoryStudentItem,
} from "@/types/adminClasses";

type DetailTab = "classes" | "students" | "subjects" | "grades";

export default function AdvisoryClassDetail() {
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
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center gap-3 bg-background py-4 px-4 md:px-6">
              <SidebarTrigger className="md:hidden" />
              <Breadcrumb>
                <Breadcrumb.List className="flex items-center gap-2 text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-black [&_a]:!text-muted-foreground [&_a]:!text-inherit [&_a]:!font-inherit [&_button]:!text-muted-foreground [&_button]:!text-inherit [&_button]:!font-inherit [&_[aria-current=page]]:!text-black [&_[aria-current=page]]:!text-inherit [&_[aria-current=page]]:!font-extrabold">
                  <Breadcrumb.Item>
                    <Breadcrumb.Link
                      onClick={() => navigate("/teacher/classes")}
                      className="cursor-pointer"
                    >
                      Classes
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator />
                  <Breadcrumb.Item>
                    <Breadcrumb.Page className="text-2xl">
                      {detail.section_name}
                    </Breadcrumb.Page>
                  </Breadcrumb.Item>
                </Breadcrumb.List>
              </Breadcrumb>
            </header>
            <div className="px-4 md:px-6 bg-background -mt-[1px]">
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
                  {
                    id: "grades",
                    label: "Grades",
                    icon: Award,
                  },
                ]}
                activeTab={tab}
                onTabChange={setTab}
              />
            </div>

            <div className="border-t-1 border-border -mt-[1px] py-4 px-4 md:px-6 flex flex-col gap-4">

            <Card className="block w-full border-black bg-primary transition-none hover:shadow-md">
              <Card.Content>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <Card.Title className="mb-0">
                      {detail.section_name}
                    </Card.Title>

                  </div>
                  <Badge
                    variant="outline"
                    size="sm"
                    className="w-fit font-black"
                  >
                    {statusLabel}
                  </Badge>
                </div>
                <p className="text-sm font-normal">
                  {detail.academic_level} - {detail.academic_year} | Active
                  since {activeSince}
                </p>
              </Card.Content>
            </Card>

            {tab === "classes" && <OverviewTab detail={detail} />}
            {tab === "students" && <StudentsTab detail={detail} />}
            {tab === "subjects" && <SubjectLoadTab detail={detail} />}
            {tab === "grades" && <GradesTab classId={detail.class_id} />}
          </div>
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
    <div className="grid gap-4 min-w-0">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px] xl:grid-rows-[auto_1fr] items-stretch min-w-0">
        <div className="flex flex-col gap-2 min-w-0">
          <h3 className="text-lg font-bold">Overview</h3>
          <div className="grid gap-4 md:grid-cols-2 min-w-0">
            <OverviewCard
              title="Total Students"
              count={String(detail.student_count ?? 0)}
              statDescription="Real assigned students"
            />
            <OverviewCard
              title="Total Subjects"
              count={String(detail.subject_count ?? 0)}
              statDescription="Active and historical subject loads"
            />
          </div>
        </div>
        <aside className="flex flex-col gap-2 min-w-0 xl:row-span-2">
          <h3 className="text-lg font-bold">Recent Activity</h3>
          <EmptyStateCard
            title="No recent activity available yet."
            className="h-full flex-1"
          />
        </aside>
        <section className="min-w-0">
          <h3 className="text-lg font-bold">Subjects</h3>
          <div className="grid gap-2 min-w-0">
            {detail.subject_loads.length ? (
              detail.subject_loads.map((load) => (
                <Link
                  key={load.subject_load_id}
                  to={`/teacher/classes/${detail.class_id}/subjects/${load.subject_id}`}
                >
                  <Card className="block w-full">
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
                </Link>
              ))
            ) : (
              <EmptyInline message="No subject load assigned yet." />
            )}
          </div>
        </section>
      </div>
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
        <OverviewCard
          title="Students"
          count={String(detail.student_count ?? 0)}
          statDescription="Full advisory roster"
        />
        <OverviewCard
          title="Male"
          count={String(detail.male_count ?? 0)}
        />
        <OverviewCard
          title="Female"
          count={String(detail.female_count ?? 0)}
        />
      </div>
      <section>
        <div className="mb-2 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <h3 className="text-xl font-bold">Students</h3>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search students..."
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
                    className="group overflow-hidden border-2 border-black bg-white"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between bg-primary border-b-2 px-4 py-3 text-sm font-black">
                      <span>{gender.toUpperCase()}</span>
                      <span className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          size="sm"
                          className="rounded-none"
                        >
                          {students.length} student
                          {students.length !== 1 ? "s" : ""}
                        </Badge>
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
      <Table
        wrapperClassName="overflow-x-auto"
        className="border-black min-w-[720px]"
      >
        <Table.Header>
          <Table.Row>
            <Table.Head>Subject</Table.Head>
            <Table.Head>Teacher</Table.Head>
            <Table.Head>Schedule</Table.Head>
            <Table.Head>Status</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {detail.subject_loads.map((load) => (
            <Table.Row
              key={load.subject_load_id}
              className="border-black/40 text-xs"
            >
              <Table.Cell>
                <b className="hover:underline">{load.subject_name}</b>
              </Table.Cell>
              <Table.Cell>
                <span className="flex items-center gap-2 font-semibold">
                  <Avatar text={load.teacher_name} />
                  {load.teacher_name}
                </span>
              </Table.Cell>
              <Table.Cell>{load.schedule || "No schedule"}</Table.Cell>
              <Table.Cell>
                <Badge
                  variant="outline"
                  size="sm"
                  className="w-fit rounded-none font-bold"
                >
                  {load.status || "N/A"}
                </Badge>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </section>
  );
}

function GradesTab({ classId }: { classId: number }) {
  const [gradesData, setGradesData] =
    useState<TeacherAdvisoryClassGradesResponse | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadGrades() {
      setIsLoading(true);
      setError("");
      try {
        const data = await getTeacherAdvisoryClassGrades(
          classId,
          selectedPeriodId ?? undefined,
        );
        if (isMounted) {
          setGradesData(data);
          if (selectedPeriodId === null && data.academic_period_id) {
            setSelectedPeriodId(data.academic_period_id);
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load advisory grades.",
          );
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadGrades();

    return () => {
      isMounted = false;
    };
  }, [classId, selectedPeriodId]);

  const filteredStudents = useMemo(() => {
    if (!gradesData) return [];
    const query = search.trim().toLocaleLowerCase();
    return gradesData.students
      .filter(
        (student) =>
          !query || student.full_name.toLocaleLowerCase().includes(query),
      )
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [gradesData, search]);

  const groupedStudents = useMemo(() => {
    const order = ["Male", "Female", "Other", "Unspecified"];
    return order
      .map(
        (gender) =>
          [
            gender,
            filteredStudents.filter(
              (student) =>
                normalizedStudentGender(student.gender || "") === gender,
            ),
          ] as const,
      )
      .filter(([, group]) => group.length > 0);
  }, [filteredStudents]);

  if (isLoading && !gradesData) {
    return <StateInline message="Loading finalized subject grades..." />;
  }

  if (error && !gradesData) {
    return <StateInline message={error} />;
  }

  if (!gradesData) {
    return <EmptyInline message="No grade records available." />;
  }

  const fullyFinalizedCount = gradesData.students.filter(
    (s) => s.is_all_finalized,
  ).length;

  return (
    <div className="grid gap-4">
      {/* Top Controls: Period selector & Search */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-muted-foreground mr-1">
              Period:
            </span>
            {gradesData.periods.map((period) => (
              <Button
                key={period.academic_period_id}
                variant={
                  selectedPeriodId === period.academic_period_id
                    ? "default"
                    : "outline"
                }
                size="sm"
                onClick={() => setSelectedPeriodId(period.academic_period_id)}
                className="font-bold text-xs"
              >
                {period.period_name} {period.is_active ? "(Active)" : ""}
              </Button>
            ))}
          </div>

          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search students..."
            className="w-full sm:w-64"
          />
        </div>

        {/* Metric Cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          <OverviewCard
            title="Total Students"
            count={String(gradesData.total_students)}
            statDescription="Enrolled in this section"
          />
          <OverviewCard
            title="Total Subjects"
            count={String(gradesData.subjects.length)}
            statDescription="Assigned subject curriculum"
          />
          <OverviewCard
            title="Fully Finalized"
            count={`${fullyFinalizedCount} / ${gradesData.total_students}`}
            statDescription="All subjects finalized"
          />
        </div>
      </div>

      {/* Grades Matrix */}
      <Card className="block w-full border-black bg-card">
        <Card.Content className="p-0">
          {!gradesData.students.length ? (
            <StateInline message="No students are enrolled in this class." />
          ) : !filteredStudents.length ? (
            <StateInline message="No students match your search." />
          ) : (
            <Table
              wrapperClassName="overflow-x-auto"
              className="border-black min-w-[850px] w-full"
            >
              <Table.Header>
                <Table.Row className="bg-primary/20">
                  <Table.Head className="min-w-[220px] font-black">
                    Learner's Name
                  </Table.Head>
                  {gradesData.subjects.map((subj) => (
                    <Table.Head
                      key={subj.subject_id}
                      className="text-center min-w-[140px] font-bold"
                    >
                      <span className="block">{subj.subject_name}</span>
                      {subj.teacher_name && (
                        <span className="block text-[10px] font-normal text-muted-foreground">
                          {subj.teacher_name}
                        </span>
                      )}
                    </Table.Head>
                  ))}
                  <Table.Head className="text-center min-w-[160px] font-black">
                    General Average (GWA)
                  </Table.Head>
                  <Table.Head className="text-center min-w-[120px] font-black">
                    Status
                  </Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {groupedStudents.map(([gender, students]) => (
                  <Fragment key={gender}>
                    <Table.Row className="bg-muted/40 font-black border-y-2 border-black/30">
                      <Table.Cell
                        colSpan={gradesData.subjects.length + 3}
                        className="py-2 text-xs uppercase tracking-wider font-extrabold text-foreground"
                      >
                        {gender} ({students.length})
                      </Table.Cell>
                    </Table.Row>
                    {students.map((student) => (
                      <Table.Row
                        key={student.student_id}
                        className="border-b border-border text-xs hover:bg-muted/10"
                      >
                        <Table.Cell className="font-semibold">
                          <div className="flex items-center gap-2">
                            <Avatar text={student.full_name} />
                            <div>
                              <span className="block font-bold text-sm text-foreground">
                                {student.full_name}
                              </span>
                              {student.student_lrn && (
                                <span className="block text-[10px] font-medium text-muted-foreground">
                                  LRN {student.student_lrn}
                                </span>
                              )}
                            </div>
                          </div>
                        </Table.Cell>
                        {gradesData.subjects.map((subj) => {
                          const gradeItem = student.grades[subj.subject_id];
                          return (
                            <Table.Cell
                              key={subj.subject_id}
                              className="text-center"
                            >
                              {gradeItem &&
                              gradeItem.is_finalized &&
                              gradeItem.final_period_grade !== null ? (
                                <div className="flex flex-col items-center justify-center">
                                  <span className="font-bold text-sm tabular-nums text-foreground">
                                    {gradeItem.final_period_grade.toFixed(1)}
                                  </span>
                                  {gradeItem.performance_descriptor && (
                                    <span className="text-[10px] font-semibold text-muted-foreground">
                                      {gradeItem.performance_descriptor}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <Badge
                                  variant="outline"
                                  size="sm"
                                  className="font-semibold text-muted-foreground text-[10px] border-border"
                                >
                                  Pending
                                </Badge>
                              )}
                            </Table.Cell>
                          );
                        })}
                        <Table.Cell className="text-center">
                          {student.is_all_finalized &&
                          student.gwa !== null ? (
                            <div className="flex flex-col items-center justify-center">
                              <span className="font-black text-sm tabular-nums text-foreground">
                                {student.gwa.toFixed(1)}
                              </span>
                              {student.gwa_descriptor && (
                                <span className="text-[10px] font-semibold text-muted-foreground">
                                  {student.gwa_descriptor}
                                </span>
                              )}
                            </div>
                          ) : student.finalized_count > 0 &&
                            student.gwa !== null ? (
                            <div className="flex flex-col items-center justify-center text-amber-600 dark:text-amber-400">
                              <span className="font-bold text-xs tabular-nums">
                                {student.gwa.toFixed(1)}
                              </span>
                              <span className="text-[10px] font-medium text-muted-foreground">
                                Partial ({student.finalized_count}/
                                {student.total_subjects_count} subjects)
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground font-medium">
                              —
                            </span>
                          )}
                        </Table.Cell>
                        <Table.Cell className="text-center">
                          {student.is_all_finalized ? (
                            <Badge
                              variant="solid"
                              size="sm"
                              className="bg-[#79bd80] text-black font-black text-[10px]"
                            >
                              Complete
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              size="sm"
                              className="font-bold text-muted-foreground text-[10px]"
                            >
                              {student.finalized_count}/
                              {student.total_subjects_count} Finalized
                            </Badge>
                          )}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Fragment>
                ))}
              </Table.Body>
            </Table>
          )}
        </Card.Content>
      </Card>
    </div>
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
    <div className="border-b-2 border-black bg-white px-3 py-2 text-sm last:border-b-0">
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
