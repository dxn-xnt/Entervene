import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Award, BookOpen, Check, ChevronDown, Download, FileSpreadsheet, FileText, History, Lightbulb, Loader2, Search, Users } from "lucide-react";
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
import { Checkbox } from "@/components/retroui/Checkbox";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Table } from "@/components/retroui/Table";
import { OverviewCard } from "@/components/overview-cards";
import { StudentSuggestionHistoryModal } from "@/components/teacher/suggestions/student-suggestion-history-modal";
import { SuggestionPanel } from "@/components/teacher/suggestions/suggestion-panel-modal";
import { SF9PreviewModal } from "@/pages/teacher/forms/sf9-preview-modal";
import { SF9BatchPdfModal } from "@/pages/teacher/forms/sf9-batch-pdf-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
              <header className="flex items-center gap-3 bg-background py-4 px-4 md:px-6">
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
                  <Card.Content className="flex min-h-16 items-start justify-between gap-4">
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
          <div className="flex flex-col gap-2 min-w-0">
            <h3 className="text-lg font-bold">Overview</h3>
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
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [isSuggestModalOpen, setIsSuggestModalOpen] = useState(false);
  const [historyStudent, setHistoryStudent] = useState<TeacherAdvisoryStudentItem | null>(null);
  const [previewStudent, setPreviewStudent] = useState<TeacherAdvisoryStudentItem | null>(null);
  const [batchPdfModal, setBatchPdfModal] = useState<{ isOpen: boolean; mode: "selected" | "all" }>({
    isOpen: false,
    mode: "selected",
  });
  const [isExportingSF9, setIsExportingSF9] = useState(false);

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

  const allStudentIds = useMemo(() => detail.students.map((s) => s.student_id), [detail.students]);
  const isAllSelected = detail.students.length > 0 && selectedStudentIds.size === detail.students.length;

  const handleToggleSelect = useCallback((studentId: string) => {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedStudentIds(new Set(allStudentIds));
  }, [allStudentIds]);

  const handleClearSelection = useCallback(() => {
    setSelectedStudentIds(new Set());
  }, []);

  const selectedStudents = useMemo(() => {
    return detail.students.filter((s) => selectedStudentIds.has(s.student_id));
  }, [detail.students, selectedStudentIds]);

  const singleSelectedStudent = selectedStudents.length === 1 ? selectedStudents[0] : null;

  const handleExportSF9All = async () => {
    try {
      setIsExportingSF9(true);
      toast.info(`Generating official SF9 report card workbooks for all ${detail.students.length} students...`);
      const { blob, filename } = await exportTeacherAdvisoryBatchSF9(
        detail.class_id,
        undefined,
        "zip",
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.setAttribute("download", filename);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("SF9 report cards exported successfully.");
    } catch (err) {
      console.error("SF9 export failed:", err);
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to export advisory SF9 report cards.",
      );
    } finally {
      setIsExportingSF9(false);
    }
  };

  const handleExportSF9Selected = async () => {
    if (selectedStudentIds.size === 0) {
      toast.error("Please select at least one student to export.");
      return;
    }
    try {
      setIsExportingSF9(true);
      const targetIds = Array.from(selectedStudentIds);
      const label = `${targetIds.length} selected student${targetIds.length > 1 ? "s" : ""}`;
      toast.info(`Generating official SF9 report card workbooks for ${label}...`);
      const { blob, filename } = await exportTeacherAdvisoryBatchSF9(
        detail.class_id,
        targetIds,
        "zip",
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.setAttribute("download", filename);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("SF9 report cards exported successfully.");
    } catch (err) {
      console.error("SF9 export failed:", err);
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to export advisory SF9 report cards.",
      );
    } finally {
      setIsExportingSF9(false);
    }
  };

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
      <section className="space-y-3">
        {/* Header with Title and Primary Actions */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-xl font-bold">Students</h3>
            <p className="text-xs text-muted-foreground">
              Select students to suggest material or export official SF9 report cards in batch.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* SF9 (PDF) Dropdown Action */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={detail.students.length === 0}
                  className="gap-2"
                  title="Official printable SF9 report cards (PDF)"
                >
                  <FileText className="size-4" />
                  <span>SF9 (PDF)</span>
                  <ChevronDown className="size-3.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 border-2 border-black bg-white shadow-md p-1">
                {/* 1. Preview Individual */}
                <DropdownMenuItem
                  disabled={!singleSelectedStudent}
                  onClick={() => {
                    if (singleSelectedStudent) {
                      setPreviewStudent(singleSelectedStudent);
                    }
                  }}
                  className="cursor-pointer gap-2 py-2"
                >
                  <FileText className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex flex-col text-left">
                    <span className="font-bold text-xs">Preview Individual</span>
                    <span className="text-[11px] text-muted-foreground font-normal">
                      {singleSelectedStudent
                        ? singleSelectedStudent.full_name
                        : selectedStudentIds.size === 0
                        ? "Select exactly 1 student"
                        : `Select exactly 1 student (${selectedStudentIds.size} selected)`}
                    </span>
                  </div>
                </DropdownMenuItem>

                {/* 2. Download Selected */}
                <DropdownMenuItem
                  disabled={selectedStudentIds.size === 0}
                  onClick={() => {
                    if (selectedStudentIds.size > 0) {
                      setBatchPdfModal({ isOpen: true, mode: "selected" });
                    }
                  }}
                  className="cursor-pointer gap-2 py-2"
                >
                  <Download className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex flex-col text-left">
                    <span className="font-bold text-xs">Download Selected</span>
                    <span className="text-[11px] text-muted-foreground font-normal">
                      {selectedStudentIds.size === 0
                        ? "Select at least 1 student"
                        : `${selectedStudentIds.size} student${selectedStudentIds.size === 1 ? "" : "s"} (one combined PDF)`}
                    </span>
                  </div>
                </DropdownMenuItem>

                {/* 3. Download All */}
                <DropdownMenuItem
                  disabled={detail.students.length === 0}
                  onClick={() => {
                    setBatchPdfModal({ isOpen: true, mode: "all" });
                  }}
                  className="cursor-pointer gap-2 py-2"
                >
                  <Users className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex flex-col text-left">
                    <span className="font-bold text-xs">Download All</span>
                    <span className="text-[11px] text-muted-foreground font-normal">
                      All {detail.students.length} enrolled students (one combined PDF)
                    </span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* SF9 (Excel) Dropdown Action */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isExportingSF9 || detail.students.length === 0}
                  className="gap-2"
                  title="Export official SF9 Excel workbooks (ZIP)"
                >
                  {isExportingSF9 ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="size-4" />
                  )}
                  <span>SF9 (Excel)</span>
                  <ChevronDown className="size-3.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60 border-2 border-black bg-white shadow-md p-1">
                <DropdownMenuItem
                  disabled={isExportingSF9 || detail.students.length === 0}
                  onClick={() => void handleExportSF9All()}
                  className="cursor-pointer gap-2 py-2"
                >
                  <Users className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex flex-col text-left">
                    <span className="font-bold text-xs">Export All Students</span>
                    <span className="text-[11px] text-muted-foreground font-normal">
                      All {detail.students.length} enrolled students (ZIP)
                    </span>
                  </div>
                </DropdownMenuItem>

                <DropdownMenuItem
                  disabled={isExportingSF9 || selectedStudentIds.size === 0}
                  onClick={() => void handleExportSF9Selected()}
                  className="cursor-pointer gap-2 py-2"
                >
                  <FileSpreadsheet className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex flex-col text-left">
                    <span className="font-bold text-xs">Export Selected Students</span>
                    <span className="text-[11px] text-muted-foreground font-normal">
                      {selectedStudentIds.size === 0
                        ? "Select at least 1 student"
                        : `${selectedStudentIds.size} student${selectedStudentIds.size === 1 ? "" : "s"} selected (ZIP)`}
                    </span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Header Bulk Suggest Material Action */}
            <Button
              variant="default"
              size="sm"
              disabled={selectedStudentIds.size === 0}
              onClick={() => setIsSuggestModalOpen(true)}
              className="gap-2"
              title={
                selectedStudentIds.size === 0
                  ? "Select one or more students below to suggest study material"
                  : `Suggest material to ${selectedStudentIds.size} selected student${selectedStudentIds.size > 1 ? "s" : ""}`
              }
            >
              <Lightbulb className="size-4" />
              <span>Suggest Material</span>
              {selectedStudentIds.size > 0 && (
                <span className="rounded bg-primary-foreground/20 px-1.5 py-0.5 text-[11px] font-bold">
                  {selectedStudentIds.size}
                </span>
              )}
            </Button>
          </div>
        </div>

        {/* Toolbar with Selection and Search Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-card p-2 text-sm shadow-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={isAllSelected ? handleClearSelection : handleSelectAll}
              className="h-8 text-xs font-bold gap-1.5"
            >
              <span
                aria-hidden="true"
                className={`size-3.5 rounded-xs border border-black flex items-center justify-center shrink-0 ${
                  isAllSelected ? "bg-primary text-primary-foreground" : "bg-background"
                }`}
              >
                {isAllSelected && <Check className="size-2.5 stroke-[3]" />}
              </span>
              <span>{isAllSelected ? "Deselect All" : `Select All (${detail.students.length})`}</span>
            </Button>

            {selectedStudentIds.size > 0 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearSelection}
                  className="h-8 text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                  Clear Selection
                </Button>
                <span className="text-xs font-semibold text-foreground/85">
                  {selectedStudentIds.size} of {detail.students.length} selected
                </span>
              </>
            )}
          </div>

          <label className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search students..."
              className="h-8 w-full border-border pl-8 pr-3 text-xs"
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
                    <span>{gender.toUpperCase()}</span>
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
                        isSelected={selectedStudentIds.has(student.student_id)}
                        onToggleSelect={handleToggleSelect}
                        onOpenHistory={setHistoryStudent}
                      />
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Suggest Material Dialog */}
      {isSuggestModalOpen && (
        <SuggestionPanel
          open={isSuggestModalOpen}
          isOpen={isSuggestModalOpen}
          onOpenChange={setIsSuggestModalOpen}
          onClose={() => setIsSuggestModalOpen(false)}
          classId={detail.class_id}
          students={selectedStudents}
          subjectLoads={detail.subject_loads}
          onSuccess={() => {
            setSelectedStudentIds(new Set());
          }}
        />
      )}

      {/* Suggestion History Modal */}
      {historyStudent && (
        <StudentSuggestionHistoryModal
          key={historyStudent.student_id}
          isOpen={Boolean(historyStudent)}
          onClose={() => setHistoryStudent(null)}
          classId={detail.class_id}
          student={historyStudent}
        />
      )}

      {/* SF9 Individual Preview Modal */}
      {previewStudent && (
        <SF9PreviewModal
          key={previewStudent.student_id}
          isOpen={Boolean(previewStudent)}
          onClose={() => setPreviewStudent(null)}
          classId={detail.class_id}
          studentId={previewStudent.student_id}
          studentName={previewStudent.full_name}
        />
      )}

      {/* SF9 Combined Batch PDF Download Modal */}
      {batchPdfModal.isOpen && (
        <SF9BatchPdfModal
          isOpen={batchPdfModal.isOpen}
          onClose={() => setBatchPdfModal({ isOpen: false, mode: "selected" })}
          classId={detail.class_id}
          studentIds={
            batchPdfModal.mode === "selected"
              ? Array.from(selectedStudentIds)
              : undefined
          }
          mode={batchPdfModal.mode}
          academicYear={detail.academic_year}
        />
      )}
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
  const [isBatchExportingXlsx, setIsBatchExportingXlsx] = useState(false);

  const handleExportBatchSF9Xlsx = async () => {
    try {
      setIsBatchExportingXlsx(true);
      toast.info("Generating batch Excel (.xlsx) report cards for advisory class...");
      const { blob, filename } = await exportTeacherAdvisoryBatchSF9(classId);
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
      {/* Top Controls: Period selector, Search & Batch SF9 Export */}
      <div className="flex flex-col gap-4 min-w-0 w-full">
        <div className="flex flex-wrap items-center justify-between gap-3 min-w-0 w-full">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
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

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <label className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-black/50" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search students..."
                className="h-10 w-full border-black pl-9 pr-3"
              />
            </label>
            <Button
              variant="default"
              size="sm"
              disabled={isBatchExportingXlsx || !gradesData.students.length}
              onClick={handleExportBatchSF9Xlsx}
              className="font-bold text-xs flex items-center gap-1.5 border-2 border-black bg-primary text-primary-foreground shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all shrink-0"
            >
              {isBatchExportingXlsx ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <FileSpreadsheet className="size-3.5" />
              )}
              <span>{isBatchExportingXlsx ? "Exporting..." : "Excel (.xlsx)"}</span>
            </Button>
          </div>
        </div>

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
      </div>

      {/* Grades Matrix Scrollable Frame */}
      <div className="block w-full min-w-0 max-w-full rounded border-2 border-black bg-card shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
        {/* Frame Sub-header with Scroll Hint */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-black bg-muted/40 px-4 py-2.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-foreground">
              Grades Matrix
            </span>
            <Badge variant="outline" size="sm" className="rounded font-semibold text-[10px] border-black/40">
              {gradesData.subjects.length} Subjects
            </Badge>
          </div>
          <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
            <span>Scroll horizontally & vertically</span>
            <span className="hidden sm:inline">• Headers and student names remain pinned</span>
          </span>
        </div>

        {!gradesData.students.length ? (
          <TeacherEmptyState compact illustration={<TeacherEmptyAvatarGroup />} title="No Students Found" />
        ) : !filteredStudents.length ? (
          <TeacherEmptyState compact illustration={<TeacherEmptyAvatarGroup />} title="No Students Found" />
        ) : (
          <Table
            wrapperClassName="border-0 shadow-none rounded-none min-w-0 w-full max-w-full"
            containerClassName="max-h-[560px] overflow-auto overscroll-contain retro-scrollbar"
            className="border-separate border-spacing-0 min-w-max w-full"
          >
            <Table.Header>
              <Table.Row className="bg-primary">
                {/* 2D Pinned Corner Header */}
                <Table.Head className="sticky top-0 left-0 z-50 min-w-[220px] max-w-[260px] w-[240px] bg-primary text-primary-foreground font-black border-r-2 border-b-2 border-black shadow-[3px_3px_5px_-2px_rgba(0,0,0,0.25)] px-4 py-3">
                  Learner's Name
                </Table.Head>
                {gradesData.subjects.map((subj) => (
                  <Table.Head
                    key={subj.subject_id}
                    className="sticky top-0 z-30 text-center min-w-[140px] max-w-[180px] font-bold px-3 py-2.5 border-r border-b-2 border-black/20 border-b-black bg-primary text-primary-foreground"
                  >
                    <Tooltip>
                      <TooltipTrigger render={<span className="block truncate font-bold text-xs" tabIndex={0}>{subj.subject_name}</span>} />
                      <TooltipContent>{subj.subject_name}</TooltipContent>
                    </Tooltip>
                    {subj.teacher_name && (
                      <Tooltip>
                        <TooltipTrigger render={<span className="block text-[10px] font-normal text-primary-foreground/75 truncate mt-0.5" tabIndex={0}>{subj.teacher_name}</span>} />
                        <TooltipContent>{subj.teacher_name}</TooltipContent>
                      </Tooltip>
                    )}
                  </Table.Head>
                ))}
                <Table.Head className="sticky top-0 z-30 text-center min-w-[150px] font-black px-3 py-2.5 border-r border-b-2 border-black/20 border-b-black bg-primary text-primary-foreground">
                  General Average (GWA)
                </Table.Head>
                <Table.Head className="sticky top-0 z-30 text-center min-w-[120px] font-black px-3 py-2.5 border-r border-b-2 border-black/20 border-b-black bg-primary text-primary-foreground">
                  Status
                </Table.Head>
                <Table.Head className="sticky top-0 z-30 text-center min-w-[100px] font-black px-3 py-2.5 border-b-2 border-black bg-primary text-primary-foreground">
                  SF9
                </Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {groupedStudents.map(([gender, students]) => (
                <Fragment key={gender}>
                  <Table.Row className="bg-muted/70 font-black">
                    <Table.Cell
                      colSpan={gradesData.subjects.length + 4}
                      className="p-0 text-xs uppercase tracking-wider font-extrabold text-foreground border-y-2 border-black/30 bg-muted/70"
                    >
                      <div className="sticky left-0 z-20 inline-flex items-center gap-2 px-4 py-2 font-black">
                        <span>{gender}</span>
                        <span className="text-muted-foreground font-semibold">({students.length})</span>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                  {students.map((student) => (
                    <Table.Row
                      key={student.student_id}
                      className="group text-xs hover:bg-muted/30 transition-colors"
                    >
                      {/* Pinned Student Name Column */}
                      <Table.Cell className="sticky left-0 z-20 min-w-[220px] max-w-[260px] w-[240px] bg-card group-hover:bg-muted/50 transition-colors border-r-2 border-black/30 border-b border-border font-semibold shadow-[3px_0_5px_-2px_rgba(0,0,0,0.15)] px-4 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar text={student.full_name} />
                          <div className="min-w-0 flex-1">
                            <Tooltip>
                              <TooltipTrigger render={<span className="block font-bold text-sm text-foreground truncate" tabIndex={0}>{student.full_name}</span>} />
                              <TooltipContent>{student.full_name}</TooltipContent>
                            </Tooltip>
                            {student.student_lrn && (
                              <span className="block text-[10px] font-medium text-muted-foreground truncate">
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
                            className="text-center px-3 py-2.5 min-w-[140px] border-r border-border/60 border-b border-border"
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
                      <Table.Cell className="text-center px-3 py-2.5 min-w-[150px] border-r border-border/60 border-b border-border">
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
                      <Table.Cell className="text-center px-3 py-2.5 min-w-[120px] border-r border-border/60 border-b border-border">
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
                      <Table.Cell className="text-center px-3 py-2.5 min-w-[150px] border-b border-border">
                        <div className="flex items-center justify-center">
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
  isSelected,
  onToggleSelect,
  onOpenHistory,
}: {
  student: TeacherAdvisoryStudentItem;
  isSelected: boolean;
  onToggleSelect: (studentId: string) => void;
  onOpenHistory: (student: TeacherAdvisoryStudentItem) => void;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-sm transition-colors last:border-b-0 ${
        isSelected ? "bg-primary/5" : "bg-background hover:bg-muted/40"
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Checkbox
          id={`select-student-${student.student_id}`}
          checked={isSelected}
          onCheckedChange={() => onToggleSelect(student.student_id)}
          aria-label={`Select ${student.full_name}`}
          className="size-4 shrink-0 border-border"
        />
        <Avatar text={student.avatar_initial || student.full_name} />
        <div className="min-w-0 flex-1">
          <span className="block truncate font-semibold">
            {student.full_name}
          </span>
          {student.student_lrn && (
            <span className="block text-[11px] font-medium text-muted-foreground">
              LRN {student.student_lrn}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onOpenHistory(student)}
          className="gap-1.5 h-8 text-xs font-bold"
        >
          <History className="size-3.5" />
          <span>History</span>
        </Button>
      </div>
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

function Avatar({ text }: { text: string }) {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-full border border-amber-700 bg-amber-200 text-[13px] font-semibold text-amber-900">
      {(text || "?").charAt(0)}
    </span>
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
