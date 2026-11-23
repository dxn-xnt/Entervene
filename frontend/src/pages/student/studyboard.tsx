import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  BookOpen,
  Calendar,
  CheckCircle2,
  CheckSquare,
  ClipboardList,
  FileText,
  GraduationCap,
  HeartHandshake,
} from "lucide-react";
import AppLayout from "@/layouts/app-layout";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/student/button";
import { Badge } from "@/components/retroui/Badge";
import { Progress } from "@/components/retroui/Progress";
import { LoadingPanel } from "@/components/loading-panel";
import { Empty } from "@/components/retroui/Empty";
import { StudentEmptyState } from "@/components/student/student-empty-state";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { SubjectCard } from "@/components/subject-card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/retroui/Tooltip";
import { routes } from "@/../routes";
import {
  getMyStudyboardMetrics,
  type StudentStudyboardMetrics,
  type TodoItem,
} from "@/lib/api";
import {
  listMyActiveInterventions,
  type StudentPersistentIntervention,
} from "@/lib/student-persistent-interventions-api";
import { useStudentOverviewData } from "@/hooks/use-student-overview-data";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import IconContainer from "@/components/icon-container";
import { cn } from "@/lib/utils";
import { classifyMasteryPercentage } from "@/lib/student-lesson-mastery";
import {
  computeOnTimeSummary,
  computeSubjectMastery,
  prioritizeStudyboardTasks,
  type SubjectMasteryItem,
} from "@/lib/studyboard-insights";

const INITIAL_SUBJECTS_LIMIT = 4;
const PRIORITY_PREVIEW_LIMIT = 5;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

const attendanceLabel = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  excused: "Excused",
  no_record: "No record",
} as const;

const dayLabel = (value: string) =>
  new Date(
    value.includes("T") ? value : `${value}T12:00:00`,
  ).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function SectionCard({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "flex min-w-0 flex-col gap-0 border-border bg-card shadow-md hover:shadow-md",
        className,
      )}
    >
      <Card.Header className="mb-3 flex flex-row items-start justify-between gap-2 pb-0">
        <div className="min-w-0">
          <Card.Title className="text-lg font-bold sm:text-xl">
            {title}
          </Card.Title>
          {subtitle && (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </Card.Header>
      <Card.Content className="flex min-w-0 flex-1 flex-col pt-0">
        {children}
      </Card.Content>
    </Card>
  );
}

function SubjectPerformanceCard({
  item,
  onSelect,
}: {
  item: SubjectMasteryItem;
  onSelect: () => void;
}) {
  const hasScore = item.percentage !== null;
  const mastery = classifyMasteryPercentage(item.percentage);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      aria-label={`View ${item.subjectName}${hasScore ? `, ${item.percentage}% released score average` : ", no released graded scores yet"}`}
      className="group flex min-w-0 cursor-pointer flex-col justify-between gap-2 rounded border-2 border-border bg-background p-3 transition-all hover:-translate-y-0.5 hover:bg-accent/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <p className="truncate text-sm font-bold text-foreground sm:text-base">
                  {item.subjectName}
                </p>
              }
            />
            <TooltipContent>{item.subjectName}</TooltipContent>
          </Tooltip>
          {item.teacherName && (
            <p className="truncate text-xs text-muted-foreground">
              {item.teacherName}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {hasScore ? (
            <Badge
              size="sm"
              className={cn(mastery.badgeClass)}
              data-testid="subject-mastery-badge"
            >
              {mastery.badgeLabel}
            </Badge>
          ) : (
            <Badge variant="outline" size="sm">
              No scores yet
            </Badge>
          )}
        </div>
      </div>

      {hasScore ? (
        <div className="space-y-1">
          <Progress
            value={item.percentage!}
            className="h-2 w-full"
            aria-label={`${item.subjectName} released score average: ${item.percentage}%`}
          />
          <p className="text-xs text-muted-foreground">
            Based on {item.gradedCount} released graded{" "}
            {item.gradedCount === 1 ? "score" : "scores"}
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No released graded scores yet.
        </p>
      )}
    </div>
  );
}

const StoryBoard = () => {
  const navigate = useNavigate();
  const { subjects, todos, isLoading, error } = useStudentOverviewData();
  const { selectedPeriodId, selectedPeriod, selectedYear } = useAcademicPeriod();

  const [metrics, setMetrics] = useState<StudentStudyboardMetrics | null>(null);
  const [metricsLoadedPeriod, setMetricsLoadedPeriod] = useState<
    number | null | "unloaded"
  >("unloaded");
  const [metricsErrorPeriod, setMetricsErrorPeriod] = useState<
    number | null | "unloaded"
  >("unloaded");

  const [studySupportItems, setStudySupportItems] = useState<
    StudentPersistentIntervention[]
  >([]);
  const [supportLoadedPeriod, setSupportLoadedPeriod] = useState<
    number | null | "unloaded"
  >("unloaded");

  const [isSubjectsExpanded, setIsSubjectsExpanded] = useState(false);
  const [performanceFilter, setPerformanceFilter] = useState<
    "with_scores" | "no_scores" | "all"
  >("with_scores");

  const metricsLoading =
    metricsLoadedPeriod === "unloaded" ||
    metricsLoadedPeriod !== selectedPeriodId;
  const metricsError = metricsErrorPeriod === selectedPeriodId;
  const supportLoading =
    supportLoadedPeriod === "unloaded" ||
    supportLoadedPeriod !== selectedPeriodId;

  useEffect(() => {
    let active = true;
    getMyStudyboardMetrics(selectedPeriodId)
      .then((value) => {
        if (active) setMetrics(value);
      })
      .catch((cause: unknown) => {
        console.error("Failed to load studyboard metrics", cause);
        if (active) setMetricsErrorPeriod(selectedPeriodId);
      })
      .finally(() => {
        if (active) setMetricsLoadedPeriod(selectedPeriodId);
      });
    return () => {
      active = false;
    };
  }, [selectedPeriodId]);

  useEffect(() => {
    let active = true;
    listMyActiveInterventions(selectedPeriodId)
      .then((res) => {
        if (active) setStudySupportItems(res.items ?? []);
      })
      .catch(() => {
        if (active) setStudySupportItems([]);
      })
      .finally(() => {
        if (active) setSupportLoadedPeriod(selectedPeriodId);
      });
    return () => {
      active = false;
    };
  }, [selectedPeriodId]);

  const prioritizedTasks = useMemo(
    () => prioritizeStudyboardTasks(todos, new Date(), PRIORITY_PREVIEW_LIMIT),
    [todos],
  );
  const subjectPerformanceItems = useMemo(
    () => computeSubjectMastery(subjects, todos),
    [subjects, todos],
  );
  const subjectsWithScores = useMemo(
    () => subjectPerformanceItems.filter((item) => item.percentage !== null),
    [subjectPerformanceItems],
  );
  const subjectsWithoutScores = useMemo(
    () => subjectPerformanceItems.filter((item) => item.percentage === null),
    [subjectPerformanceItems],
  );
  const filteredPerformanceItems = useMemo(() => {
    if (performanceFilter === "with_scores") return subjectsWithScores;
    if (performanceFilter === "no_scores") return subjectsWithoutScores;
    return subjectPerformanceItems;
  }, [
    performanceFilter,
    subjectPerformanceItems,
    subjectsWithScores,
    subjectsWithoutScores,
  ]);
  const onTimeSummary = useMemo(
    () => computeOnTimeSummary(metrics),
    [metrics],
  );

  const sortedSubjects = useMemo(() => {
    if (!subjects.length) return [];

    return [...subjects].sort((a, b) => {
      const aTodos = todos.filter((t) => t.subject_id === a.subject_id);
      const bTodos = todos.filter((t) => t.subject_id === b.subject_id);

      const aPending = aTodos.filter(
        (t) => !t.is_submitted && t.status !== "completed",
      );
      const bPending = bTodos.filter(
        (t) => !t.is_submitted && t.status !== "completed",
      );

      if (bPending.length !== aPending.length) {
        return bPending.length - aPending.length;
      }

      const getEarliestDue = (pendingList: typeof aPending) => {
        const dates = pendingList
          .map((t) =>
            t.due_date ? new Date(t.due_date).getTime() : Number.MAX_SAFE_INTEGER,
          )
          .filter((d) => !isNaN(d));
        return dates.length ? Math.min(...dates) : Number.MAX_SAFE_INTEGER;
      };

      const aDue = getEarliestDue(aPending);
      const bDue = getEarliestDue(bPending);

      if (aDue !== bDue) {
        return aDue - bDue;
      }

      return a.subject_name.localeCompare(b.subject_name);
    });
  }, [subjects, todos]);

  const displayedSubjects = isSubjectsExpanded
    ? sortedSubjects
    : sortedSubjects.slice(0, INITIAL_SUBJECTS_LIMIT);
  const remainingSubjectsCount = sortedSubjects.length - INITIAL_SUBJECTS_LIMIT;

  const handleSubjectClick = (subject: {
    class_id: number;
    subject_id: number;
  }) => {
    navigate(
      routes.student.subjectDetail
        .replace(":classId", String(subject.class_id))
        .replace(":subjectId", String(subject.subject_id)),
    );
  };

  const getSubjectStats = (subjectId: number) => {
    const subjectTodos = todos.filter((t) => t.subject_id === subjectId);
    const pendingTodos = subjectTodos.filter(
      (t) => !t.is_submitted && t.status !== "completed",
    );
    const completedTodos = subjectTodos.filter(
      (t) => t.is_submitted || t.status === "completed",
    );
    const completionRate =
      subjectTodos.length > 0
        ? Math.round((completedTodos.length / subjectTodos.length) * 100)
        : 0;
    const latestPending =
      pendingTodos.find((t) => t.deadline && t.deadline !== "No deadline") ||
      pendingTodos[0];

    return {
      pendingCount: pendingTodos.length,
      completionRate,
      latestActivityTitle: latestPending?.title,
      latestActivityDue: latestPending?.deadline
        ? `Due ${latestPending.deadline}`
        : undefined,
      latestActivityAssignmentId: latestPending?.assignment_id,
      latestActivityId:
        latestPending?.assignment_id ?? latestPending?.classwork_id,
    };
  };

  const getClassworkIcon = (type?: string | null, category?: string | null) => {
    const normalized = (type || category || "").toUpperCase();
    switch (normalized) {
      case "READING":
      case "READINGS":
        return BookOpen;
      case "ACTIVITY":
      case "ACTIVITIES":
        return CheckSquare;
      case "QUIZ":
      case "QUIZZES":
        return ClipboardList;
      case "ASSIGNMENT":
      case "ASSIGNMENTS":
      default:
        return FileText;
    }
  };

  const openTodo = (item: TodoItem) => {
    if (item.assignment_id) {
      navigate(
        `/student/classworks/${item.assignment_id}?from=${encodeURIComponent(window.location.pathname + window.location.search)}`,
      );
      return;
    }
    let targetClassId = item.class_id;
    if (!targetClassId && item.subject_id) {
      const subject = subjects.find(
        (candidate) => candidate.subject_id === item.subject_id,
      );
      if (subject) targetClassId = subject.class_id;
    }
    if (targetClassId && item.subject_id) {
      navigate(
        `/student/subjects/${targetClassId}/${item.subject_id}?tab=classwork&classworkAssignmentId=${item.assignment_id}`,
      );
    } else {
      navigate(routes.student.todo);
    }
  };

  const hasAttendanceRecords = Boolean(
    metrics?.attendance?.some((day) => day.status !== "no_record"),
  );

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-clip">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            {/* Header & Academic Context */}
            <header className="flex items-center justify-between gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h1 className="whitespace-nowrap text-xl font-bold sm:text-2xl md:text-4xl">
                    Study Board
                  </h1>
                  {(selectedPeriod?.period || selectedYear?.year_label) && (
                    <Badge
                      variant="outline"
                      size="sm"
                      className="hidden sm:inline-flex"
                    >
                      {[selectedPeriod?.period, selectedYear?.year_label]
                        .filter(Boolean)
                        .join(" · ")}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  size="header"
                  onClick={() => navigate(routes.student.profile)}
                  className="whitespace-nowrap"
                  aria-label="View my schedule"
                >
                  <Calendar className="size-4" />
                  <span className="sm:hidden">Schedule</span>
                  <span className="hidden sm:inline">View My Schedule</span>
                </Button>
              </div>
            </header>

            <div className="-mt-[1px] flex flex-1 flex-col gap-4 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
              {/* 2. Main Responsive Workspace */}
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                {/* Left Column (8 cols): My Subjects + Subject Mastery */}
                <div className="flex min-w-0 flex-col gap-4 xl:col-span-8">
                  {/* Subjects Overview */}
                  <SectionCard
                    title="My Subjects"
                    subtitle={
                      subjects.length > 0
                        ? `${subjects.length} enrolled ${subjects.length === 1 ? "subject" : "subjects"} · sorted by pending work`
                        : undefined
                    }
                    action={
                      <Button
                        variant="link"
                        className="inline-flex h-auto items-center gap-1 p-0 text-sm font-semibold text-foreground hover:underline"
                        onClick={() => navigate(routes.student.subjects)}
                        title="View all subjects"
                      >
                        <span>View all</span>
                        <ArrowUpRight className="size-4" />
                      </Button>
                    }
                  >
                    {isLoading ? (
                      <LoadingPanel label="Loading subjects..." />
                    ) : error ? (
                      <Empty className="border-none bg-card shadow-none hover:shadow-none">
                        <Empty.Content>
                          <Empty.Title>Unable to load subjects</Empty.Title>
                          <Empty.Description>{error}</Empty.Description>
                        </Empty.Content>
                      </Empty>
                    ) : subjects.length === 0 ? (
                      <StudentEmptyState
                        embedded
                        compact
                        icon={<BookOpen />}
                        title="No subjects this period"
                        description="Your assigned subjects will appear here once enrollment is available."
                      />
                    ) : (
                      <>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {displayedSubjects.map((subject) => {
                            const stats = getSubjectStats(subject.subject_id);
                            return (
                              <SubjectCard
                                key={subject.subject_load_id}
                                title={subject.subject_name}
                                sectionName={subject.section_name}
                                teacher={subject.teacher_name}
                                teacherAvatar={subject.teacher_avatar}
                                pendingCount={stats.pendingCount}
                                completionRate={stats.completionRate}
                                latestActivityTitle={stats.latestActivityTitle}
                                latestActivityDue={stats.latestActivityDue}
                                latestActivityAssignmentId={
                                  stats.latestActivityAssignmentId
                                }
                                latestActivityId={stats.latestActivityId}
                                classworks={todos.filter(
                                  (t) => t.subject_id === subject.subject_id,
                                )}
                                onClick={() => handleSubjectClick(subject)}
                              />
                            );
                          })}
                        </div>

                        {sortedSubjects.length > INITIAL_SUBJECTS_LIMIT && (
                          <div className="mt-3 flex items-center justify-start">
                            <Button
                              variant="default"
                              size="sm"
                              autoIcon={false}
                              onClick={() =>
                                setIsSubjectsExpanded((prev) => !prev)
                              }
                              className="h-auto rounded border-2 border-border bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground shadow-none hover:bg-primary/90"
                            >
                              {isSubjectsExpanded
                                ? "Show less"
                                : `Show ${remainingSubjectsCount} more`}
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </SectionCard>

                  {/* Subject Performance */}
                  <SectionCard
                    title="Subject Performance"
                    subtitle="Released graded-score average per enrolled subject · click any subject to view details"
                    action={
                      !isLoading && !error && subjectPerformanceItems.length > 0 ? (
                        <div
                          role="group"
                          aria-label="Filter subject performance"
                          className="inline-flex flex-wrap items-center gap-1 rounded border-2 border-border bg-background p-0.5"
                        >
                          {(
                            [
                              {
                                id: "with_scores",
                                label: "With Scores",
                                count: subjectsWithScores.length,
                              },
                              {
                                id: "no_scores",
                                label: "No Scores",
                                count: subjectsWithoutScores.length,
                              },
                              {
                                id: "all",
                                label: "All Subjects",
                                count: subjectPerformanceItems.length,
                              },
                            ] as const
                          ).map((tab) => {
                            const active = performanceFilter === tab.id;
                            return (
                              <button
                                key={tab.id}
                                type="button"
                                aria-pressed={active}
                                onClick={() => setPerformanceFilter(tab.id)}
                                className={cn(
                                  "cursor-pointer rounded-sm px-2 py-1 text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                                  active
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                                )}
                              >
                                {tab.label} ({tab.count})
                              </button>
                            );
                          })}
                        </div>
                      ) : undefined
                    }
                  >
                    {isLoading ? (
                      <LoadingPanel label="Loading subject performance..." />
                    ) : error ? (
                      <p className="text-sm text-destructive">
                        Unable to load subject performance.
                      </p>
                    ) : subjectPerformanceItems.length === 0 ? (
                      <StudentEmptyState
                        embedded
                        compact
                        icon={<BookOpen />}
                        title="No subjects this period"
                        description="Your subject performance will appear here once enrollment is available."
                      />
                    ) : filteredPerformanceItems.length === 0 ? (
                      performanceFilter === "with_scores" ? (
                        <StudentEmptyState
                          embedded
                          compact
                          icon={<FileText />}
                          title="No released graded scores yet"
                          description="Subject averages will appear here once teachers release graded scores."
                          action={{
                            label: `View all enrolled subjects (${subjectPerformanceItems.length})`,
                            onClick: () => setPerformanceFilter("all"),
                          }}
                        />
                      ) : (
                        <StudentEmptyState
                          embedded
                          compact
                          icon={<CheckCircle2 />}
                          title="All subjects have released scores"
                          description="Every enrolled subject in this term already has at least one released graded score."
                        />
                      )
                    ) : (
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        {filteredPerformanceItems.map((item) => (
                          <SubjectPerformanceCard
                            key={item.subjectLoadId}
                            item={item}
                            onSelect={() =>
                              handleSubjectClick({
                                class_id: item.classId,
                                subject_id: item.subjectId,
                              })
                            }
                          />
                        ))}
                      </div>
                    )}
                  </SectionCard>
                </div>

                {/* Right Column (4 cols): My Priorities, Study Support, On-Time Submissions, Weekly Attendance */}
                <div className="flex min-w-0 flex-col gap-4 xl:col-span-4">
                  {/* My Priorities */}
                  <SectionCard
                    title="My Priorities"
                    action={
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => navigate(routes.student.todo)}
                        className="px-2 shadow-none"
                        aria-label="View all to-do items"
                      >
                        <ArrowUpRight className="ml-1 size-3.5" />
                      </Button>
                    }
                  >
                    {isLoading ? (
                      <LoadingPanel label="Loading priorities..." />
                    ) : error ? (
                      <p className="text-sm text-destructive">{error}</p>
                    ) : prioritizedTasks.length === 0 ? (
                      <StudentEmptyState
                        embedded
                        compact
                        icon={<CheckSquare />}
                        title="You're all caught up!"
                        description="No actionable pending classwork right now."
                        className="shadow-none"
                      />
                    ) : (
                      <div className="flex flex-col gap-2">
                        {prioritizedTasks.map(({ item, bucket }) => {
                          const IconComponent = getClassworkIcon(
                            item.type,
                            item.category,
                          );
                          return (
                            <div
                              key={item.assignment_id}
                              role="button"
                              tabIndex={0}
                              onClick={() => openTodo(item)}
                              onKeyDown={(event) => {
                                if (
                                  event.key === "Enter" ||
                                  event.key === " "
                                ) {
                                  event.preventDefault();
                                  openTodo(item);
                                }
                              }}
                              className="flex w-full cursor-pointer items-center gap-2.5 rounded border-2 border-border bg-background p-2.5 transition-all hover:-translate-y-0.5 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                            >
                              <IconContainer
                                className="shrink-0 border-2 border-border bg-primary text-primary-foreground"
                                size="sm"
                              >
                                <IconComponent
                                  size={14}
                                  className="shrink-0"
                                />
                              </IconContainer>

                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-foreground">
                                  {item.title}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {item.subject} · {item.deadline}
                                </p>
                              </div>

                              <div className="flex shrink-0 flex-col items-end gap-1">
                                {bucket === "overdue" ? (
                                  <Badge variant="destructive" size="sm">
                                    Overdue
                                  </Badge>
                                ) : bucket === "due_soon" ? (
                                  <Badge variant="default" size="sm">
                                    Due Soon
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" size="sm">
                                    Pending
                                  </Badge>
                                )}
                                {item.is_study_support && (
                                  <Badge variant="secondary" size="sm">
                                    Study Support
                                  </Badge>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <label className="text-xs px-1 text-muted-foreground mt-2">
                      Actionable overdue work first, then upcoming deadlines
                    </label>
                  </SectionCard>

                  {/* Study Support Preview */}
                  {!supportLoading && studySupportItems.length > 0 && (
                    <SectionCard
                      title="Study Support"
                      subtitle="Teacher-recommended resources and activities for you"
                      action={
                        <Button
                          variant="link"
                          className="inline-flex h-auto items-center gap-1 p-0 text-xs font-semibold text-foreground hover:underline"
                          onClick={() => navigate(routes.student.interventions)}
                        >
                          <span>Open</span>
                          <ArrowUpRight className="size-3.5" />
                        </Button>
                      }
                    >
                      <div className="flex flex-col gap-2">
                        {studySupportItems.slice(0, 3).map((support) => {
                          const readyActivities = support.activities.filter(
                            (a) => !a.is_passed,
                          ).length;
                          return (
                            <div
                              key={support.intervention_id}
                              role="button"
                              tabIndex={0}
                              onClick={() =>
                                navigate(
                                  `${routes.student.interventions}/${support.intervention_id}`,
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  navigate(
                                    `${routes.student.interventions}/${support.intervention_id}`,
                                  );
                                }
                              }}
                              className="flex cursor-pointer items-center justify-between gap-2 rounded border-2 border-border bg-accent/30 p-2.5 transition-all hover:-translate-y-0.5 hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                            >
                              <div className="flex min-w-0 items-center gap-2.5">
                                <IconContainer
                                  className="shrink-0 border-2 border-border bg-primary text-primary-foreground"
                                  size="sm"
                                >
                                  <HeartHandshake className="size-3.5" />
                                </IconContainer>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold">
                                    {support.subject_name}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {support.preparation.required_count > 0
                                      ? `Readings: ${support.preparation.completed_count}/${support.preparation.required_count}`
                                      : "Active Study Support"}
                                    {readyActivities > 0
                                      ? ` · ${readyActivities} ${readyActivities === 1 ? "activity" : "activities"}`
                                      : ""}
                                  </p>
                                </div>
                              </div>
                              <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
                            </div>
                          );
                        })}
                      </div>
                    </SectionCard>
                  )}

                  {/* On-Time Submissions */}
                  <SectionCard
                    title="On-Time Submissions"
                  >
                    {metricsLoading ? (
                      <LoadingPanel label="Loading submission timeliness..." />
                    ) : metricsError ? (
                      <p className="text-sm text-destructive">
                        Unable to load submission timeliness.
                      </p>
                    ) : !onTimeSummary.hasData ? (
                      <div className="flex items-center gap-3 rounded border-2 border-dashed border-border bg-background p-3">
                        <GraduationCap className="size-5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 text-xs">
                          <p className="font-semibold text-foreground">
                            No timed submissions yet
                          </p>
                          <p className="text-muted-foreground">
                            {onTimeSummary.withoutDeadlineCount > 0
                              ? `${onTimeSummary.withoutDeadlineCount} submitted without a due date.`
                              : "Submitted work with due dates will appear here."}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-4">
                        <Progress
                          value={onTimeSummary.rate ?? 0}
                          variant="circular"
                          className="size-20 shrink-0"
                          aria-label={`${onTimeSummary.onTimeCount} of ${onTimeSummary.eligibleCount} on time (${onTimeSummary.rate}%)`}
                        />
                        <div className="min-w-0 space-y-0.5 text-sm">
                          <p className="font-bold text-foreground">
                            {onTimeSummary.onTimeCount} of{" "}
                            {onTimeSummary.eligibleCount} on time
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {onTimeSummary.lateCount} late
                            {onTimeSummary.withoutDeadlineCount > 0
                              ? ` · ${onTimeSummary.withoutDeadlineCount} without due date`
                              : ""}
                          </p>
                        </div>
                      </div>
                    )}
                    <label className="text-xs px-1 text-muted-foreground mt-2">
                      Submitted work with assigned due dates
                    </label>
                  </SectionCard>

                  {/* Weekly Attendance */}
                  <SectionCard
                    title="Weekly Attendance"
                  >
                    {metricsLoading ? (
                      <LoadingPanel label="Loading attendance..." />
                    ) : metricsError ? (
                      <p className="text-sm text-destructive">
                        Unable to load attendance.
                      </p>
                    ) : !hasAttendanceRecords ? (
                      <div className="flex items-center gap-3 rounded border-2 border-dashed border-border bg-background p-3">
                        <Calendar className="size-5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 text-xs">
                          <p className="font-semibold text-foreground">
                            No attendance recorded this week
                          </p>
                          <p className="text-muted-foreground">
                            Daily attendance appears once your school records
                            it.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-baseline gap-2">
                          <p className="text-3xl font-black">
                            {metrics?.attendance_rate == null
                              ? "—"
                              : `${metrics.attendance_rate}%`}
                          </p>
                          <span className="text-xs text-muted-foreground">
                            attended this week
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-5 gap-1.5">
                          {metrics?.attendance.map((day, index) => (
                            <div
                              key={day.date}
                              className="min-w-0 text-center"
                            >
                              <p className="mb-1 text-xs font-semibold text-muted-foreground">
                                {WEEKDAYS[index]}
                              </p>
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <div
                                      tabIndex={0}
                                      aria-label={`${dayLabel(day.date)}: ${attendanceLabel[day.status]}`}
                                      className={cn(
                                        "flex min-h-10 items-center justify-center rounded border-2 border-border px-0.5 text-[11px] font-bold",
                                        day.status === "present"
                                          ? "bg-primary text-primary-foreground"
                                          : day.status === "late"
                                            ? "bg-accent text-accent-foreground"
                                            : day.status === "absent"
                                              ? "bg-destructive text-destructive-foreground"
                                              : day.status === "excused"
                                                ? "bg-secondary text-secondary-foreground"
                                                : "bg-muted text-muted-foreground",
                                      )}
                                    >
                                      {day.status === "no_record"
                                        ? "—"
                                        : attendanceLabel[day.status]}
                                    </div>
                                  }
                                />
                                <TooltipContent>
                                  {dayLabel(day.date)}:{" "}
                                  {attendanceLabel[day.status]}
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          ))}
                        </div>
                        <p className="mt-2.5 text-[11px] text-muted-foreground">
                          Present, late, and excused count as attended.
                        </p>
                      </>
                    )}
                    <label className="text-xs px-1 text-muted-foreground mt-2">
                      Monday–Friday recorded attendance
                    </label>
                  </SectionCard>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default StoryBoard;
