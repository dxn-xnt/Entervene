import { useState, useMemo } from "react";
import { BookOpen } from "lucide-react";
import { Avatar } from "@/components/retroui/Avatar";
import { Select } from "@/components/retroui/Select";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Progress } from "@/components/retroui/Progress";
import { Empty } from "@/components/retroui/Empty";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { OverviewCard } from "@/components/overview-cards";
import { ClassworkItemLine } from "@/components/item-line/classwork";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { isReadingType } from "@/lib/classwork-utils";
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
  const [performanceFilter, setPerformanceFilter] = useState<string>("all");
  const [showAllPerformance, setShowAllPerformance] = useState(false);

  const availableTypes = useMemo(() => {
    const types = Array.from(
      new Set(detail.classwork_results.map((c) => c.type).filter(Boolean)),
    );
    return types;
  }, [detail.classwork_results]);

  const performanceItems = useMemo(() => {
    let items = detail.classwork_results;
    if (performanceFilter !== "all") {
      items = items.filter(
        (c) => c.type?.toUpperCase() === performanceFilter.toUpperCase(),
      );
    }
    return items.map((item) => {
      let percent = 0;
      if (item.percentage !== null && item.percentage !== undefined) {
        percent = Math.round(Number(item.percentage));
      } else if (item.score !== null && item.score !== undefined && item.total_points) {
        percent = Math.round((Number(item.score) / Number(item.total_points)) * 100);
      } else if (isReadingType(item.type)) {
        const isOpened =
          item.status === "submitted" ||
          item.status === "completed" ||
          item.status === "opened" ||
          item.status === "late" ||
          item.status === "graded" ||
          Boolean(item.submitted_at);
        percent = isOpened ? 100 : 0;
      }
      return {
        id: item.assignment_id,
        title: item.title,
        score: item.score,
        total_points: item.total_points,
        status: item.status,
        type: item.type,
        percent: Math.min(100, Math.max(0, percent)),
      };
    });
  }, [detail.classwork_results, performanceFilter]);

  const displayedPerformanceItems = showAllPerformance
    ? performanceItems
    : performanceItems.slice(0, 5);

  return (
    <div className="space-y-4">
      <Card className="block w-full border-black bg-primary p-6">
        <Card.Content className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-2">
            <Card.Title className="flex items-center gap-3 text-2xl sm:text-3xl">
              <Avatar variant="student" className="size-12 shrink-0">
                <Avatar.Image
                  src={(detail.student as any)?.avatar || "/avatars/student-avatars/1.svg"}
                  alt={detail.student.full_name}
                />
                <Avatar.Fallback>
                  {(detail.student.full_name || "?").charAt(0).toUpperCase()}
                </Avatar.Fallback>
              </Avatar>
              <div>
                <div className="flex items-center gap-4">
                  <p className="text-2xl sm:text-3xl font-extrabold text-black">
                    {detail.student.full_name}
                  </p>

                  <Badge variant="outline" size="sm">
                    {detail.student.academic_level || "Student"}
                  </Badge>
                </div>

                <p className="text-xs sm:text-sm font-normal pl-0.5">
                  LRN: {detail.student.lrn}
                </p>
              </div>

            </Card.Title>
          </div>

          <div className="flex gap-2">
            {detail.student.status && (
              <Badge variant="solid" size="sm">
                {statusLabel(detail.student.status)}
              </Badge>
            )}
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

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        {/* Main Content: Classwork History */}
        <div className="lg:col-span-8 xl:col-span-9 flex flex-col gap-4">
          {/* Lesson Performance Card */}
          <Card className="flex flex-col p-4 sm:p-5">
            <Card.Header className="mb-0 p-0 flex flex-col gap-2">
              <div className="flex flex-row items-center justify-between">
                <Card.Title className="text-xl sm:text-2xl font-bold text-foreground">
                  Lesson Performance
                </Card.Title>
                <Badge variant="secondary" size="sm" className="h-fit">
                  {detail.summary.graded_count} / {detail.summary.assigned_count} graded
                </Badge>
              </div>

              {availableTypes.length > 1 && (
                <div className="flex flex-row flex-wrap items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                  <Button
                    autoIcon={false}
                    variant={performanceFilter === "all" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPerformanceFilter("all")}
                    className="shrink-0 border-black shadow-none text-[11px] px-2 py-0.5"
                  >
                    All ({detail.classwork_results.length})
                  </Button>
                  {availableTypes.map((type) => {
                    const count = detail.classwork_results.filter(
                      (c) => c.type?.toUpperCase() === type.toUpperCase(),
                    ).length;
                    const label =
                      type.toUpperCase() === "QUIZ"
                        ? "Quizzes"
                        : type.toUpperCase() === "ASSIGNMENT"
                          ? "Assignments"
                          : type.toUpperCase() === "ACTIVITY"
                            ? "Activities"
                            : type.toUpperCase() === "READING"
                              ? "Readings"
                              : type.replace(/_/g, " ");

                    return (
                      <Button
                        key={type}
                        autoIcon={false}
                        variant={performanceFilter === type ? "default" : "outline"}
                        size="sm"
                        onClick={() => setPerformanceFilter(type)}
                        className="shrink-0 border-black shadow-none text-[11px] px-2 py-0.5 capitalize"
                      >
                        {label} ({count})
                      </Button>
                    );
                  })}
                </div>
              )}
            </Card.Header>

            <Card.Content className="flex flex-col justify-between gap-2.5 p-0 h-full mt-3">
              <div className="flex flex-col gap-2.5">
                {!performanceItems.length ? (
                  <Empty className="border-none bg-transparent shadow-none hover:shadow-none py-6 [&_p]:text-xs sm:[&_p]:text-sm [&_p]:font-medium [&_p]:text-muted-foreground">
                    <Empty.Content>
                      <Empty.Icon><BookOpen className="size-6 text-muted-foreground" /></Empty.Icon>
                      <Empty.Title>No classwork performance records found for this filter.</Empty.Title>
                    </Empty.Content>
                  </Empty>
                ) : (
                  displayedPerformanceItems.map((item) => (
                    <div
                      key={item.id}
                      title={`${item.title} — ${item.score !== null && item.score !== undefined
                        ? `${item.score} / ${item.total_points ?? 0} pts`
                        : isReadingType(item.type)
                          ? item.percent === 100
                            ? "Opened"
                            : "Not Opened"
                          : "Not Graded"
                        } (${item.percent}%)`}
                      className="flex items-center justify-between gap-3 text-xs sm:text-sm"
                    >
                      <span
                        className="font-medium text-foreground/90 shrink-0 w-32 sm:w-48 truncate"
                        title={item.title}
                      >
                        {item.title}
                      </span>
                      <Progress value={item.percent} className="h-2.5 flex-1" />
                      <span className="font-semibold text-foreground text-right w-12 shrink-0">
                        {item.percent}%
                      </span>
                    </div>
                  ))
                )}
              </div>

              {performanceItems.length > 5 && (
                <div className="flex items-center justify-end pt-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    autoIcon={false}
                    onClick={() => setShowAllPerformance((prev) => !prev)}
                    className="text-xs font-semibold px-2.5 py-1 h-7 text-foreground shadow-none"
                  >
                    {showAllPerformance
                      ? "Show less"
                      : `View all (${performanceItems.length})`}
                  </Button>
                </div>
              )}

              <Card.Description className="text-xs text-muted-foreground mt-1">
                {detail.summary.graded_count} of {detail.summary.assigned_count} classwork tasks graded
              </Card.Description>
            </Card.Content>
          </Card>

          <Card className="w-full gap-2 p-4 ">
            <Card.Header className="flex flex-row justify-between items-center">
              <div className="flex items-center gap-2">
                <Card.Title className="text-xl sm:text-2xl">
                  Classwork History
                </Card.Title>
              </div>
              <Badge
                variant="secondary"
                size="sm"
                className="h-fit"
              >
                {detail.classwork_results.length}{" "}
                {detail.classwork_results.length === 1 ? "task" : "tasks"}
              </Badge>
            </Card.Header>
            <Card.Content className="mt-2">
              <div className="space-y-2.5">
                {detail.classwork_results.length ? (
                  detail.classwork_results.map((item) => {
                    const isReading = isReadingType(item.type);
                    const isOpened =
                      item.status === "submitted" ||
                      item.status === "completed" ||
                      item.status === "opened" ||
                      item.status === "late" ||
                      item.status === "graded" ||
                      Boolean(item.submitted_at);
                    const isGraded =
                      item.status === "graded" ||
                      (item.score !== null && item.score !== undefined);

                    return (
                      <ClassworkItemLine
                        key={item.assignment_id}
                        item={item}
                        showPublicationStatus={false}
                        showCategoryBadge={false}
                        showTypeBadge={false}
                        className="shadow-none! hover:bg-retro hover:-translate-y-1 transition-all"
                        rightContent={
                          <div className="flex items-center gap-2 sm:gap-3">
                            {isReading ? (
                              isOpened ? (
                                <Badge variant="secondary" size="sm">
                                  Opened
                                </Badge>
                              ) : (
                                <Badge variant="default" size="sm">
                                  Not Opened
                                </Badge>
                              )
                            ) : isGraded ? (
                              <Badge variant="secondary" size="sm" className="text-sm font-bold whitespace-nowrap">
                                {item.score ?? 0} / {item.total_points ?? 0}
                              </Badge>
                            ) : (
                              <Badge
                                variant="default"
                                size="sm"
                              >
                                Not Graded
                              </Badge>
                            )}
                          </div>
                        }
                      />
                    );
                  })
                ) : (
                  <p className="border-2 border-dashed border-black/30 p-8 text-center text-sm font-medium text-muted-foreground">
                    No classwork records for this period yet.
                  </p>
                )}
              </div>
            </Card.Content>
          </Card>
        </div>

        {/* Side Overview Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1 lg:col-span-4 xl:col-span-3">
          <OverviewCard
            title="Official Grade"
            count={formatOfficialGrade(detail.summary.official_period_grade)}
            statDescription="Encoded period grade"
          />
          <OverviewCard
            title="Running Average"
            count={formatMetric(detail.summary.running_classwork_percentage)}
            statDescription="Classwork only"
          />
          <OverviewCard
            title="Completion"
            count={formatMetric(detail.summary.completion_rate)}
            stat={`${detail.summary.submitted_count}/${detail.summary.assigned_count}`}
            statDescription="done"
          />
          <OverviewCard
            title="Needs Attention"
            count={String(detail.summary.missing_count + detail.summary.ungraded_count)}
            statDescription="Missing or ungraded"
          />
        </div>
      </div>
    </div >
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
                <Select.Trigger className="h-10 w-full min-w-[180px] border-2 border-black bg-white text-sm font-normal shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] sm:w-auto">
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
