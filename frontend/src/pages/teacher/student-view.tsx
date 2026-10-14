import { ClipboardList, UserRound } from "lucide-react";
import { Select } from "@/components/retroui/Select";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ManualSuggestionPanel } from "@/components/teacher/suggestions/manual-suggestion-panel";
import type {
  StudentRecordDetailResponse,
  StudentRecordPeriodOption,
} from "@/lib/student-record-api";
import type {
  TeacherAdvisoryStudentItem,
  TeacherAdvisorySubjectLoadItem,
} from "@/types/adminClasses";

function formatMetric(value?: number | null, suffix = "%", emptyValue = "0") {
  if (value === null || value === undefined) return `${emptyValue}${suffix}`;
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;
}

function formatOfficialGrade(value?: number | null) {
  if (value === null || value === undefined) return "Not encoded";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatDateTime(value?: string | null) {
  if (!value) return "No due date";
  return new Date(value).toLocaleString();
}

function statusLabel(status: string) {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function StudentRecordDetail({
  detail,
  classId,
  subjectLoads,
  showSuggestionPanel = true,
}: {
  detail: StudentRecordDetailResponse;
  classId: number | string;
  subjectLoads: TeacherAdvisorySubjectLoadItem[];
  showSuggestionPanel?: boolean;
}) {
  return (
    <div className="space-y-4">
      <Card className="block w-full border-2 border-black bg-primary text-primary-foreground shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <Card.Content className="flex flex-col gap-4 p-4 sm:p-5 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" size="sm" className="h-fit">
                Student Record
              </Badge>
              {detail.student.status && (
                <Badge variant="solid" size="sm">
                  {statusLabel(detail.student.status)}
                </Badge>
              )}
            </div>
            <Card.Title className="text-2xl sm:text-3xl font-extrabold text-black">
              {detail.student.full_name}
            </Card.Title>
            <p className="text-xs sm:text-sm font-medium text-black/80">
              {detail.student.academic_level || "Student"} | {detail.student.section_name} | LRN {detail.student.lrn}
              {detail.student.gender ? ` | ${detail.student.gender}` : ""}
            </p>
          </div>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-black bg-[#F6E9B2] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
            <UserRound size={24} className="text-black" />
          </div>
        </Card.Content>
      </Card>

      {showSuggestionPanel && (
        <ManualSuggestionPanel
          classId={Number(classId)}
          student={{
            student_id: detail.student.student_id,
            full_name: detail.student.full_name,
          } as any}
          subjectLoads={subjectLoads}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="block w-full border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
          <Card.Content className="space-y-1 p-4">
            <Card.Description className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Official Grade
            </Card.Description>
            <Card.Title className="text-2xl sm:text-3xl font-extrabold">
              {formatOfficialGrade(detail.summary.official_period_grade)}
            </Card.Title>
            <p className="text-xs font-medium text-muted-foreground">
              Encoded period grade
            </p>
          </Card.Content>
        </Card>

        <Card className="block w-full border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
          <Card.Content className="space-y-1 p-4">
            <Card.Description className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Running Average
            </Card.Description>
            <Card.Title className="text-2xl sm:text-3xl font-extrabold">
              {formatMetric(detail.summary.running_classwork_percentage)}
            </Card.Title>
            <p className="text-xs font-medium text-muted-foreground">
              Classwork only
            </p>
          </Card.Content>
        </Card>

        <Card className="block w-full border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
          <Card.Content className="space-y-1 p-4">
            <Card.Description className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Completion
            </Card.Description>
            <Card.Title className="text-2xl sm:text-3xl font-extrabold">
              {formatMetric(detail.summary.completion_rate)}
            </Card.Title>
            <p className="text-xs font-medium text-muted-foreground">
              {detail.summary.submitted_count}/{detail.summary.assigned_count} done
            </p>
          </Card.Content>
        </Card>

        <Card className="block w-full border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
          <Card.Content className="space-y-1 p-4">
            <Card.Description className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Needs Attention
            </Card.Description>
            <Card.Title className="text-2xl sm:text-3xl font-extrabold">
              {detail.summary.missing_count + detail.summary.ungraded_count}
            </Card.Title>
            <p className="text-xs font-medium text-muted-foreground">
              Missing or ungraded
            </p>
          </Card.Content>
        </Card>
      </div>

      <Card className="block w-full border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <Card.Content className="p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-2 border-b-2 border-black pb-3">
            <div className="flex items-center gap-2">
              <ClipboardList size={20} className="text-black" />
              <Card.Title className="mb-0 text-lg sm:text-xl font-bold text-black">
                Classwork History
              </Card.Title>
            </div>
            <Badge
              variant="secondary"
              size="sm"
              className="bg-accent font-semibold text-accent-foreground"
            >
              {detail.classwork_results.length}{" "}
              {detail.classwork_results.length === 1 ? "task" : "tasks"}
            </Badge>
          </div>
          <div className="space-y-2.5">
            {detail.classwork_results.length ? (
              detail.classwork_results.map((item) => (
                <div
                  key={item.assignment_id}
                  className="border-2 border-black bg-background p-3 sm:p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-transform hover:-translate-y-0.5"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-bold text-black sm:text-base">{item.title}</p>
                      <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                        {item.type}{" "}
                        {item.category
                          ? `| ${item.category.replace(/_/g, " ")}`
                          : ""}{" "}
                        | {formatDateTime(item.due_date)}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-2 md:flex-col md:items-end">
                      <p className="text-sm font-bold sm:text-base">
                        {item.score ?? 0} / {item.total_points ?? 0}
                      </p>
                      <Badge
                        variant={
                          item.status === "graded" || item.status === "submitted"
                            ? "solid"
                            : item.status === "late"
                              ? "outline"
                              : "default"
                        }
                        size="sm"
                        className="text-[10px]"
                      >
                        {statusLabel(item.status)}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="border-2 border-dashed border-black/30 p-8 text-center text-sm font-medium text-muted-foreground">
                No classwork records for this period yet.
              </p>
            )}
          </div>
        </Card.Content>
      </Card>
    </div>
  );
}

export interface TeacherStudentViewProps {
  student?: TeacherAdvisoryStudentItem | null;
  studentDetail: StudentRecordDetailResponse | null;
  classId: number | string;
  subjectLoads?: TeacherAdvisorySubjectLoadItem[];
  periods?: StudentRecordPeriodOption[];
  selectedPeriodId?: string;
  onPeriodChange?: (periodId: string) => void;
  isDetailLoading?: boolean;
  detailError?: string;
  sectionName?: string;
  subjectName?: string;
  subjectId?: number | string | null;
}

export function TeacherStudentView({
  student,
  studentDetail,
  classId,
  subjectLoads = [],
  periods = [],
  selectedPeriodId,
  onPeriodChange,
  isDetailLoading = false,
  detailError = "",
  sectionName,
  subjectName,
  subjectId,
}: TeacherStudentViewProps) {
  const studentName =
    studentDetail?.student?.full_name || student?.full_name || "Student Record";
  const displaySection =
    sectionName ||
    studentDetail?.student?.section_name;

  const activeSubjectLoad =
    subjectLoads.find((l) =>
      subjectId
        ? l.subject_id === Number(subjectId)
        : subjectName
          ? l.subject_name === subjectName
          : true,
    ) || subjectLoads[0];
  const activeSubjectId = subjectId || activeSubjectLoad?.subject_id;
  const subjectHref =
    classId && activeSubjectId
      ? `/teacher/classes/${classId}/subjects/${activeSubjectId}`
      : undefined;
  const sectionHref =
    classId && activeSubjectId
      ? `/teacher/classes/${classId}/${activeSubjectId}`
      : classId
        ? `/teacher/classes/${classId}`
        : undefined;

  return (
    <div className="flex flex-col flex-1 min-w-0 w-full animate-in fade-in-50 duration-200">
      {/* ── Universal Header with Breadcrumbs ── */}
      <div data-page-tabs-sticky-region>
        <header className="flex min-w-0 flex-col gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <SidebarTrigger className="shrink-0 md:hidden" />
            <Breadcrumb className="min-w-0">
              <Breadcrumb.List className="flex min-w-0 flex-nowrap items-center gap-1.5 sm:gap-2">
                <Breadcrumb.Item>
                  <Breadcrumb.Link href="/teacher/classes" className="whitespace-nowrap">
                    Classes
                  </Breadcrumb.Link>
                </Breadcrumb.Item>

                {subjectName && (
                  <>
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item className="min-w-0 shrink-0">
                      <Breadcrumb.Link
                        href={subjectHref}
                        className="cursor-pointer block max-w-[120px] sm:max-w-[180px] truncate"
                      >
                        {subjectName}
                      </Breadcrumb.Link>
                    </Breadcrumb.Item>
                  </>
                )}

                {displaySection && (
                  <>
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item className="min-w-0 shrink-0">
                      <Breadcrumb.Link
                        href={sectionHref}
                        className="cursor-pointer block max-w-[120px] sm:max-w-[180px] truncate"
                      >
                        {displaySection}
                      </Breadcrumb.Link>
                    </Breadcrumb.Item>
                  </>
                )}

                <Breadcrumb.Separator />
                <Breadcrumb.Item className="min-w-0 flex-1">
                  <Breadcrumb.Page
                    className="block max-w-[180px] sm:max-w-[300px] truncate font-bold text-black"
                    title={studentName}
                  >
                    {studentName}
                  </Breadcrumb.Page>
                </Breadcrumb.Item>
              </Breadcrumb.List>
            </Breadcrumb>
          </div>

          <div className="flex flex-wrap w-full gap-2 md:flex md:w-auto md:flex-nowrap md:items-center justify-end">
            {(student || studentDetail?.student) && subjectLoads && subjectLoads.length > 0 && (
              <ManualSuggestionPanel
                classId={Number(classId)}
                student={
                  student || {
                    student_id: studentDetail?.student?.student_id || "",
                    full_name: studentName,
                    student_lrn: studentDetail?.student?.lrn || null,
                    gender: studentDetail?.student?.gender || "",
                    email: studentDetail?.student?.email || null,
                    account_status: studentDetail?.student?.status || null,
                    avatar_initial: studentName ? studentName.charAt(0) : "S",
                  }
                }
                subjectLoads={subjectLoads}
                displayMode="header"
              />
            )}

            {periods.length > 0 && onPeriodChange && (
              <Select
                value={selectedPeriodId}
                onValueChange={onPeriodChange}
              >
                <Select.Trigger className="h-10 text-sm bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] font-semibold min-w-[180px] w-full sm:w-auto">
                  <Select.Value placeholder="Select period" />
                </Select.Trigger>
                <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  {periods.map((p) => (
                    <Select.Item
                      key={p.academic_period_id}
                      value={String(p.academic_period_id)}
                    >
                      {p.period_name} ({p.year_label})
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            )}
          </div>
        </header>
      </div>

      {/* ── Main Content Body ── */}
      <div className="-mt-[3px] flex min-w-0 flex-col gap-4 border-t-2! border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
        {detailError && (
          <div className="border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 font-medium rounded">
            {detailError}
          </div>
        )}

        {isDetailLoading || !studentDetail ? (
          <p className="py-12 text-center text-sm font-semibold text-gray-500">
            Loading student analytics...
          </p>
        ) : (
          <StudentRecordDetail
            detail={studentDetail}
            classId={classId}
            subjectLoads={subjectLoads as any}
            showSuggestionPanel={false}
          />
        )}
      </div>
    </div>
  );
}

export default TeacherStudentView;
