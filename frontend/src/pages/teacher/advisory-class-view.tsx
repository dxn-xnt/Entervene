import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import { Award, BookOpen, ChevronDown, FileSpreadsheet, FileText, Loader2, Search, Users } from "lucide-react";
import { TeacherEmptyAvatarGroup, TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { PageBreadcrumb as Breadcrumb } from "@/components/page-breadcrumb";
import { Tabs } from "@/components/retroui/Tabs";
import AppLayout from "@/layouts/app-layout";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/teacher/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { Input } from "@/components/retroui/Input";
import { Badge } from "@/components/retroui/Badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Table } from "@/components/retroui/Table";
import { OverviewCard } from "@/components/overview-cards";
import { SF9PreviewModal } from "@/pages/teacher/forms/sf9-preview-modal";
import { Avatar } from "@/components/retroui/Avatar";
import {
  exportTeacherAdvisoryBatchSF9,
  getClassSchedule,
  getTeacherAdvisoryClassDetail,
  getTeacherAdvisoryClassGrades,
  type DynamicScheduleResponse,
} from "@/lib/api";
import { DynamicScheduleTable } from "@/components/dynamic-schedule-table";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
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
  const [isBatchExportingXlsx, setIsBatchExportingXlsx] = useState(false);

  const handleExportBatchSF9Xlsx = async () => {
    if (!detail) return;
    try {
      setIsBatchExportingXlsx(true);
      toast.info("Generating batch Excel (.xlsx) report cards for advisory class...");
      const { blob, filename } = await exportTeacherAdvisoryBatchSF9(detail.class_id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.setAttribute("download", filename);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Advisory class SF9 report cards exported successfully.");
    } catch (err) {
      console.error("Batch SF9 export failed:", err);
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to export advisory SF9 report cards.",
      );
    } finally {
      setIsBatchExportingXlsx(false);
    }
  };

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
            className="rounded border-2 border-black bg-[#79bd80] px-3 py-1 text-xs font-bold"
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
      <div className="flex flex-1 flex-col min-w-0 w-full max-w-full">
        <div className="@container/main flex flex-1 flex-col min-w-0 w-full max-w-full">
          <div className="flex flex-1 flex-col min-w-0 w-full max-w-full">
            <div data-page-tabs-sticky-region>
              <header className="flex items-center justify-between gap-3 bg-background py-4 px-4 md:px-6">
                <div className="flex min-w-0 items-center gap-3">
                  <SidebarTrigger className="md:hidden" />
                  <Breadcrumb>
                    <Breadcrumb.List className="flex min-w-0 flex-nowrap items-center gap-2">
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
                        <Breadcrumb.Page>
                          {detail.section_name}
                        </Breadcrumb.Page>
                      </Breadcrumb.Item>
                    </Breadcrumb.List>
                  </Breadcrumb>
                </div>

                {tab === "grades" && (
                  <Button
                    variant="default"
                    disabled={isBatchExportingXlsx || !detail.students.length}
                    onClick={handleExportBatchSF9Xlsx}
                    className="flex items-center gap-1.5 border-2 border-black bg-primary text-primary-foreground"
                  >
                    {isBatchExportingXlsx ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="size-3.5" />
                    )}
                    <span>{isBatchExportingXlsx ? "Exporting..." : "Export Excel"}</span>
                  </Button>
                )}
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
            </div>

            <div className="border-t-1 border-border -mt-[1px] px-3 py-3 sm:px-4 sm:py-4 md:px-6 flex flex-col gap-4 min-w-0 w-full max-w-full">

              <Card className="block w-full border-black bg-primary transition-none hover:shadow-md">
                <Card.Content>
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <Tooltip>
                        <TooltipTrigger render={<Card.Title className="mb-0 truncate text-2xl font-extrabold sm:text-3xl" tabIndex={0}>{detail.section_name}</Card.Title>} />
                        <TooltipContent>{detail.section_name}</TooltipContent>
                      </Tooltip>
                    </div>
                    <Badge
                      variant="outline"
                      size="sm"
                      className="w-fit shrink-0 font-black"
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
        <section className="flex min-w-0 flex-col gap-2">
          <h3 className="text-lg font-bold">Subjects</h3>
          <div className="grid gap-2 min-w-0">
            {detail.subject_loads.length ? (
              detail.subject_loads.map((load) => (
                <Card key={load.subject_load_id} className="block w-full">
                  <Card.Content className="flex items-start justify-between gap-4">
                    <span>
                      <span className="block text-xl font-bold text-foreground/90">
                        {load.subject_name}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {load.teacher_name}
                      </span>
                    </span>
                    <span className="text-right text-sm font-medium">
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
        <aside className="flex flex-col gap-2 min-w-0 xl:row-span-2">
          <div className="flex flex-col gap-3 min-w-0">
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
        </aside>


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
          <label className="relative w-full md:w-86">
            <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-black/50" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search students..."
              className="h-10 w-full border-black pl-9 pr-3"
            />
          </label>
        </div>
        <div className="min-w-0">
          {!detail.students.length ? (
            <TeacherEmptyState compact illustration={<TeacherEmptyAvatarGroup />} title="No Students Found" />
          ) : !filteredStudents.length ? (
            <TeacherEmptyState compact illustration={<TeacherEmptyAvatarGroup />} title="No Students Found" />
          ) : (
            <div className="grid items-start gap-3">
              {groupedStudents.map(([gender, students]) => (
                <details
                  key={gender}
                  open
                  className="group overflow-hidden rounded border-2 border-border bg-background shadow-md transition-all hover:shadow-sm open:shadow-sm"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 bg-primary px-4 py-3 text-base font-bold text-foreground">
                    <span>{gender}</span>
                    <span className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        size="sm"
                        className="rounded"
                      >
                        {students.length} student
                        {students.length !== 1 ? "s" : ""}
                      </Badge>
                      <ChevronDown className="size-4" />
                    </span>
                  </summary>
                  <div className="border-t-2 border-border">
                    {students.map((student) => (
                      <StudentRow
                        key={student.student_id}
                        student={student}
                        classId={detail.class_id}
                      />
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

function SubjectLoadTab({
  detail,
}: {
  detail: TeacherAdvisoryClassDetailResponse;
}) {
  const { selectedPeriodId } = useAcademicPeriod();
  const [scheduleData, setScheduleData] = useState<DynamicScheduleResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadSchedule() {
      if (!detail.class_id) return;
      setIsLoading(true);
      try {
        const data = await getClassSchedule(detail.class_id, selectedPeriodId ?? undefined);
        if (isMounted) setScheduleData(data);
      } catch (err) {
        console.error("Failed to load advisory class schedule:", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadSchedule();
    return () => {
      isMounted = false;
    };
  }, [detail.class_id, selectedPeriodId]);

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-lg font-bold">Subject Load Schedule</h3>
      <DynamicScheduleTable
        schedule={scheduleData?.schedule || []}
        isPublished={scheduleData?.is_published}
        isLoading={isLoading}
        showTeacher={true}
        showSection={false}
        emptyMessage="No published schedule assigned yet for this section."
      />
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
    const order = ["Male", "Female", "Unspecified"];
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
    <div className="flex flex-col gap-4 min-w-0 w-full max-w-full">
      {/* Metric Cards */}
      <div className="grid gap-4 sm:grid-cols-3 min-w-0 w-full">
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

      {/* Controls: Search */}
      <div className="flex flex-wrap items-end justify-between gap-3 min-w-0 w-full">
        <p className="text-xl font-bold text-foreground -mb-2">Grades Matrix</p>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <label className="relative w-full sm:w-86">
            <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-black/50" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search students..."
              className="h-10 w-full border-black pl-9 pr-3"
            />
          </label>
        </div>
      </div>

      {/* Grades Matrix Scrollable Frame */}
      <div className="block w-full min-w-0 max-w-full rounded border-2 border-black bg-card shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
        {!gradesData.students.length ? (
          <TeacherEmptyState compact illustration={<TeacherEmptyAvatarGroup />} title="No Students Found" />
        ) : !filteredStudents.length ? (
          <TeacherEmptyState compact illustration={<TeacherEmptyAvatarGroup />} title="No Students Found" />
        ) : (
          <Table
            wrapperClassName="border-0 shadow-none rounded-none min-w-0 w-full max-w-full"
            containerClassName="overflow-auto overscroll-contain retro-scrollbar"
            className="border-separate border-spacing-0 min-w-max w-full"
          >
            <Table.Header>
              <Table.Row className="bg-primary">
                {/* 2D Pinned Corner Header */}
                <Table.Head className="sticky top-0 left-0 z-50 min-w-[220px] max-w-[260px] w-[240px] bg-primary text-primary-foreground font-black border-b-2 border-black px-4 py-3">
                  Learner's Name
                </Table.Head>
                {gradesData.subjects.map((subj) => (
                  <Table.Head
                    key={subj.subject_id}
                    className="sticky top-0 z-30 text-center min-w-[140px] max-w-[180px] font-bold px-3 py-2.5 border-b-2 border-black bg-primary text-primary-foreground"
                  >
                    <Tooltip>
                      <TooltipTrigger render={<span className="block truncate text-base" tabIndex={0}>{subj.subject_name}</span>} />
                      <TooltipContent>
                        <div className="font-bold">{subj.subject_name}</div>
                        {subj.teacher_name && (
                          <div className="text-[11px] text-muted-foreground">{subj.teacher_name}</div>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  </Table.Head>
                ))}
                <Table.Head className="sticky top-0 z-30 text-center min-w-[150px] font-black px-3 py-2.5 border-b-2 border-black bg-primary text-primary-foreground">
                  General Average
                </Table.Head>
                <Table.Head className="sticky top-0 z-30 text-center max-w-[70px] font-black px-3 py-2.5 border-b-2 border-black bg-primary text-primary-foreground">
                  SF9
                </Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {groupedStudents.map(([gender, students]) => (
                <Fragment key={gender}>
                  <Table.Row className="bg-muted font-black hover:bg-muted">
                    <Table.Cell
                      colSpan={gradesData.subjects.length + 3}
                      className="p-0! text-sm text-foreground border-b-1 bg-muted/70"
                    >
                      <div className="sticky left-0 z-20 inline-flex items-center gap-2 px-4 py-2 font-black">
                        <span>{gender}</span>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                  {students.map((student) => (
                    <Table.Row
                      key={student.student_id}
                      className="group text-xs transition-colors"
                    >
                      {/* Pinned Student Name Column */}
                      <Table.Cell className="sticky left-0 z-20 min-w-[220px] max-w-[260px] w-[240px] transition-colors border-b border-border font-semibold px-4 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar variant="student" className="size-8 shrink-0">
                            <Avatar.Image
                              src={student.avatar || "/avatars/student-avatars/1.svg"}
                              alt={student.full_name}
                            />
                            <Avatar.Fallback>
                              {(student.avatar_initial || student.full_name || "?")
                                .charAt(0)
                                .toUpperCase()}
                            </Avatar.Fallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <Tooltip>
                              <TooltipTrigger render={<span className="block font-bold text-sm text-foreground truncate" tabIndex={0}>{student.full_name}</span>} />
                              <TooltipContent>{student.full_name}</TooltipContent>
                            </Tooltip>
                            {student.student_lrn && (
                              <span className="block text-[10px] font-medium text-muted-foreground truncate">
                                {student.student_lrn}
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
                            className="text-center px-3 py-2.5 min-w-[140px] border-b border-border"
                          >
                            {gradeItem &&
                              gradeItem.is_finalized &&
                              gradeItem.final_period_grade !== null ? (
                              <div className="flex flex-col items-center justify-center">
                                <span className="font-bold text-sm tabular-nums text-foreground">
                                  {gradeItem.final_period_grade.toFixed(1)}
                                </span>
                                {gradeItem.performance_descriptor && (
                                  <Tooltip>
                                    <TooltipTrigger render={<span className="text-[10px] font-semibold text-muted-foreground truncate max-w-[130px]" tabIndex={0}>{gradeItem.performance_descriptor}</span>} />
                                    <TooltipContent>{gradeItem.performance_descriptor}</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            ) : (
                              <Badge
                                variant="default"
                                size="sm"
                              >
                                Pending
                              </Badge>
                            )}
                          </Table.Cell>
                        );
                      })}
                      <Table.Cell className="text-center px-3 py-2.5 min-w-[150px] border-b border-border">
                        {student.is_all_finalized &&
                          student.gwa !== null ? (
                          <div className="flex flex-col items-center justify-center">
                            <span className="font-black text-sm tabular-nums text-foreground">
                              {student.gwa.toFixed(1)}
                            </span>
                            {student.gwa_descriptor && (
                              <Tooltip>
                                <TooltipTrigger render={<span className="text-[10px] font-semibold text-muted-foreground truncate max-w-[140px]" tabIndex={0}>{student.gwa_descriptor}</span>} />
                                <TooltipContent>{student.gwa_descriptor}</TooltipContent>
                              </Tooltip>
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
                      <Table.Cell className="text-right px-3 py-2.5 max-w-[70px] border-b border-border">
                        <div className="flex items-center justify-end">
                          <StudentSF9Button
                            classId={classId}
                            studentId={student.student_id}
                            studentName={student.full_name}
                          />
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Fragment>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>
    </div>
  );
}

function StudentSF9Button({
  classId,
  studentId,
  studentName,
  compact = false,
}: {
  classId: number;
  studentId: string;
  studentName?: string;
  compact?: boolean;
}) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          setIsPreviewOpen(true);
        }}
        className={`gap-2 whitespace-nowrap ${compact ? "px-2 py-1 h-7" : ""}`}
      >
        <FileText className="size-4" />
        {!compact && <span>Export SF9</span>}
        {compact && <span className="sr-only">Export SF9</span>}
      </Button>

      {isPreviewOpen && (
        <SF9PreviewModal
          isOpen={isPreviewOpen}
          onClose={() => setIsPreviewOpen(false)}
          classId={classId}
          studentId={studentId}
          studentName={studentName}
        />
      )}
    </>
  );
}

function StudentRow({
  student,
  classId,
}: {
  student: TeacherAdvisoryStudentItem;
  classId: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-3 text-sm last:border-b-0">
      <div className="flex min-h-12 min-w-0 items-center gap-3">
        <Avatar variant="student" className="size-8 shrink-0">
          <Avatar.Image
            src={student.avatar || "/avatars/student-avatars/1.svg"}
            alt={student.full_name}
          />
          <Avatar.Fallback>
            {(student.avatar_initial || student.full_name || "?")
              .charAt(0)
              .toUpperCase()}
          </Avatar.Fallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">
            {student.full_name}
          </span>
          {student.student_lrn && (
            <span className="block text-[10px] font-semibold text-black/55">
              {student.student_lrn}
            </span>
          )}
        </span>
      </div>
      <StudentSF9Button
        classId={classId}
        studentId={student.student_id}
        studentName={student.full_name}
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
    <main className="flex flex-1 flex-col gap-5 px-3 py-3 sm:px-4 sm:py-4 md:px-6">
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

function normalizedStudentGender(gender: string) {
  if (gender === "Female" || gender === "Male")
    return gender;
  return "Unspecified";
}

function groupStudents(students: TeacherAdvisoryStudentItem[]) {
  const order = ["Male", "Female", "Unspecified"];
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
