import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, useParams } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Button } from "@/components/student/button";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Progress } from "@/components/retroui/Progress";
import ClassworkItemLine from "@/components/item-line/classwork";
import { routes } from "@/../routes";
import {
  getMyReviewer,
  listMyReviewers,
  type StudentReviewerDetail,
} from "@/lib/student-intervention-reviewers-api";
import {
  getMyActiveIntervention,
  getMyResolvedIntervention,
  listMyActiveInterventions,
  listMyResolvedInterventions,
  type StudentPersistentIntervention,
  type StudentSupportActivity,
} from "@/lib/student-persistent-interventions-api";
import {
  BookOpen,
  LockKeyhole,
  ChevronDown,
  ChevronUp,
  Frown as FaceSlightlyFrowning,
  Meh as FaceNeutral,
  Smile as FaceSlightlySmiling,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { StudentEmptyState } from "@/components/student/student-empty-state";

export default function StudentInterventionView() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const routeParams = useParams();

  const interventionIdParam = params.get("intervention");
  const interventionId = interventionIdParam && /^\d+$/.test(interventionIdParam) ? Number(interventionIdParam) : null;
  const reviewerIdParam = params.get("reviewer") || routeParams.id;
  const reviewerId = reviewerIdParam && /^\d+$/.test(reviewerIdParam) ? Number(reviewerIdParam) : null;

  const [intervention, setIntervention] = useState<StudentPersistentIntervention | null>(null);
  const [reviewer, setReviewer] = useState<StudentReviewerDetail | null>(null);
  const [activities, setActivities] = useState<StudentSupportActivity[]>([]);
  const [isContentExpanded, setIsContentExpanded] = useState(false);
  const [targetLesson, setTargetLesson] = useState<{ lesson_id: number; title: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      let resolvedReviewerId = reviewerId;
      let matchedIntervention: StudentPersistentIntervention | null = null;

      // 1. If intervention ID is given, load the intervention directly
      if (interventionId) {
        try {
          matchedIntervention = await getMyActiveIntervention(interventionId);
        } catch {
          try {
            matchedIntervention = await getMyResolvedIntervention(interventionId);
          } catch (err) {
            console.warn("Unable to load intervention by ID", err);
          }
        }
      }

      // 2. If no intervention ID, but reviewerId is given or discovered later,
      // or if neither is given, try finding the active intervention or reviewer
      if (!matchedIntervention && !resolvedReviewerId) {
        try {
          const activeList = await listMyActiveInterventions();
          if (activeList.items.length > 0) {
            matchedIntervention = activeList.items[0];
          }
        } catch {
          // ignore
        }
      }

      if (matchedIntervention) {
        if (!cancelled) {
          setIntervention(matchedIntervention);
          setActivities(matchedIntervention.activities || []);
        }
        if (!resolvedReviewerId && matchedIntervention.reviewer_id) {
          resolvedReviewerId = matchedIntervention.reviewer_id;
        }
        if (matchedIntervention.class_id && matchedIntervention.subject_id) {
          try {
            const lessonRes = await apiFetch(
              `/api/v1/lessons/class/${matchedIntervention.class_id}/subject/${matchedIntervention.subject_id}`
            );
            if (lessonRes.ok) {
              const lessonsList: Array<{ lesson_id: number; title: string }> = await lessonRes.json();
              if (lessonsList && lessonsList.length > 0 && !cancelled) {
                const matchedLesson = lessonsList.find((l) =>
                  matchedIntervention?.subject_name &&
                  l.title.toLowerCase().includes(matchedIntervention.subject_name.toLowerCase())
                ) || lessonsList[0];
                setTargetLesson(matchedLesson);
              }
            }
          } catch {
            // graceful fallback
          }
        }
      }

      // 3. Load reviewer if available
      if (resolvedReviewerId) {
        try {
          const revData = await getMyReviewer(resolvedReviewerId);
          if (!cancelled) setReviewer(revData);
        } catch (err) {
          console.warn("Unable to load reviewer", err);
        }
      } else if (!matchedIntervention) {
        try {
          const list = await listMyReviewers();
          if (!cancelled && list.items.length > 0) {
            const first = await getMyReviewer(list.items[0].material_id);
            if (!cancelled) setReviewer(first);
          }
        } catch (err) {
          console.warn("Using preset review content", err);
        }
      }
    };

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [interventionId, reviewerId]);

  // Curated activities fallback if only reviewer was loaded directly
  useEffect(() => {
    if (activities.length > 0 || !reviewer?.material_id) return;
    let cancelled = false;

    const loadActivities = async () => {
      const [active, resolved] = await Promise.allSettled([
        listMyActiveInterventions(),
        listMyResolvedInterventions(),
      ]);
      if (cancelled) return;
      const items = [
        ...(active.status === "fulfilled" ? active.value.items : []),
        ...(resolved.status === "fulfilled" ? resolved.value.items : []),
      ];
      const match = items.find((item) => item.reviewer_id === reviewer.material_id);
      if (match) {
        setIntervention(match);
        setActivities(match.activities ?? []);
        if (match.class_id && match.subject_id) {
          try {
            const lessonRes = await apiFetch(
              `/api/v1/lessons/class/${match.class_id}/subject/${match.subject_id}`
            );
            if (lessonRes.ok) {
              const lessonsList: Array<{ lesson_id: number; title: string }> = await lessonRes.json();
              if (lessonsList && lessonsList.length > 0 && !cancelled) {
                const matchedLesson = lessonsList.find((l) =>
                  match.subject_name &&
                  l.title.toLowerCase().includes(match.subject_name.toLowerCase())
                ) || lessonsList[0];
                setTargetLesson(matchedLesson);
              }
            }
          } catch {
            // graceful fallback
          }
        }
      }
    };

    void loadActivities();

    return () => {
      cancelled = true;
    };
  }, [reviewer?.material_id, activities.length]);

  const subjectName = intervention?.subject_name || reviewer?.subject_name || "Study Support";
  const title = reviewer?.title || (intervention ? `${intervention.subject_name} Support` : "Study Support");
  const teacherName = intervention?.teacher_name;
  const body = reviewer?.body?.trim() ?? "";

  const derivedLessonName = reviewer?.title
    ? reviewer.title.replace(/\s*(Reviewer|Support|Material|Help)$/i, "").trim() || reviewer.title
    : `${subjectName} Target Topic`;
  const targetLessonTitle = targetLesson?.title || derivedLessonName;

  const allReadings =
    intervention?.required_readings && intervention.required_readings.length > 0
      ? intervention.required_readings
      : Array.from(
        new Map(
          (activities ?? [])
            .flatMap((act) => act.readings ?? [])
            .map((r) => [r.assignment_id, r])
        ).values()
      );
  const orderedReadings = [...allReadings].sort((left, right) => left.order - right.order);

  const preparation =
    intervention?.preparation ??
    (activities ?? []).find((act) => act.preparation)?.preparation ??
    (orderedReadings.length > 0
      ? {
        completed_count: orderedReadings.filter((r) => r.review_status === "REVIEWED").length,
        required_count: orderedReadings.length,
      }
      : null);


  const isHistorical =
    (activities ?? []).length > 0 &&
    activities.every((act) => act.access_state === "HISTORICAL");

  const totalReadings = orderedReadings.length;
  const reviewedReadings = orderedReadings.filter((r) => r.review_status === "REVIEWED").length;
  const readingPercentage = totalReadings > 0 ? Math.round((reviewedReadings / totalReadings) * 100) : 100;

  const totalActivities = activities.length;
  const completedActivities = activities.filter((a) =>
    ["submitted", "graded", "completed"].includes(a.submission_status?.toLowerCase() ?? "")
  ).length;
  const activityPercentage = totalActivities > 0 ? Math.round((completedActivities / totalActivities) * 100) : 0;

  const totalTasks = totalReadings + totalActivities;
  const completedTasks = reviewedReadings + completedActivities;
  const overallPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const gradedActivities = activities.filter((a) => a.grade != null && a.total_points != null);
  const earnedPoints = gradedActivities.reduce((acc, a) => acc + (a.grade ?? 0), 0);
  const maxPoints = gradedActivities.reduce((acc, a) => acc + (a.total_points ?? 0), 0);

  const isResolved = intervention?.status === "RESOLVED";
  const currentMastery = isResolved || overallPercentage === 100
    ? {
      label: "Outstanding",
      badgeLabel: "Mastered",
      badgeVariant: "success" as const,
      colorClass: "text-success dark:text-success",
      bgClass: "bg-retro bg-success/20 border-border",
      icon: FaceSlightlySmiling,
      description: "Difficulty overcome! You've strengthened your understanding in this target lesson.",
    }
    : overallPercentage >= 50
      ? {
        label: "Moderate",
        badgeLabel: "Improving",
        badgeVariant: "solid" as const,
        colorClass: "text-amber-600 dark:text-amber-400",
        bgClass: "bg-retro bg-amber-500/10 border-border",
        icon: FaceNeutral,
        description: "Making steady progress! You're actively addressing the difficulty in this target lesson.",
      }
      : {
        label: "Low",
        badgeLabel: "Needs Practice",
        badgeVariant: "destructive" as const,
        colorClass: "text-destructive",
        bgClass: "bg-retro bg-destructive/10 border-border",
        icon: FaceSlightlyFrowning,
        description: "Identified difficulty in this target lesson. Complete review readings and activities to build mastery.",
      };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-clip">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex min-w-0 items-center gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <SidebarTrigger className="shrink-0 md:hidden" />
              <Breadcrumb className="min-w-0">
                <Breadcrumb.List className="flex min-w-0 flex-nowrap items-center gap-1.5 text-base font-semibold text-muted-foreground sm:gap-2 sm:text-lg md:text-xl">
                  <Breadcrumb.Item>
                    <Breadcrumb.Link
                      onClick={() => navigate(routes.student.interventions)}
                      className="cursor-pointer hover:text-foreground"
                    >
                      Study Support
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator />
                  <Breadcrumb.Item className="min-w-0">
                    <Breadcrumb.Page className="block truncate font-bold text-foreground">
                      {title}
                    </Breadcrumb.Page>
                  </Breadcrumb.Item>
                </Breadcrumb.List>
              </Breadcrumb>
            </header>

            <div className="-mt-[1px] flex min-w-0 flex-col gap-6 border-t-2 border-border px-3 py-4 sm:px-4 sm:py-4 md:px-6">
              <div className="mx-auto w-full flex flex-col gap-4">
                {/* Hero Support Information Card */}
                <Card className="w-full flex flex-col gap-3 bg-primary border-2 border-border p-3 sm:p-4 shadow-md">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1 min-w-0">
                      <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground truncate">
                        {title}
                      </h1>
                      <p className="text-base text-foreground">
                        Assigned by {teacherName ? teacherName : "Teacher"}
                      </p>
                    </div>

                    {intervention?.status && (
                      <Badge variant="solid">
                        {intervention.status === "RESOLVED" ? "Resolved" : "Active"}
                      </Badge>
                    )}
                  </div>

                  {(intervention?.activated_at || intervention?.resolved_at) && (
                    <p className="text-sm text-foreground -mt-1">
                      {intervention.resolved_at
                        ? `Resolved ${formatDate(intervention.resolved_at)}`
                        : intervention.activated_at
                          ? `Started ${formatDate(intervention.activated_at)}`
                          : ""}
                    </p>
                  )}

                  {/* Supporting material from the teacher */}
                  {body && (
                    <div className="flex flex-col gap-1.5 pt-1">
                      <span className="text-sm font-bold text-foreground">Supporting Material</span>
                      <Card
                        className={cn(
                          "min-w-0 shadow-none relative transition-all duration-200 px-4 py-3 bg-card border-2 border-border",
                          !isContentExpanded && body.length > 250 && "max-h-32 overflow-hidden"
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                          {body}
                        </p>
                        {!isContentExpanded && body.length > 250 && (
                          <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent pointer-events-none" />
                        )}
                      </Card>
                      {body.length > 250 && (
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            onClick={() => setIsContentExpanded((prev) => !prev)}
                            className="text-foreground p-0 text-sm gap-1 shadow-none"
                          >
                            {isContentExpanded ? (
                              <>
                                Show less
                                <ChevronUp className="size-3.5" />
                              </>
                            ) : (
                              <>
                                See more
                                <ChevronDown className="size-3.5" />
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Resolution message if resolved */}
                  {intervention?.resolution_message && (
                    <div className="flex flex-col gap-1 pt-1">
                      <span className="text-sm font-bold text-foreground">Teacher Resolution Note</span>
                      <Card className="min-w-0 shadow-none px-4 py-3 bg-card border-2 border-border">
                        <p className="text-sm leading-relaxed text-foreground">
                          {intervention.resolution_message}
                        </p>
                      </Card>
                    </div>
                  )}
                </Card>

                <div className="grid grid-cols-1 lg:grid-cols-20 gap-4 items-start">
                  {/* ── Main Section ── */}
                  <main className="lg:col-span-14 flex flex-col gap-4 min-w-0">

                    {/* Review Activity */}
                    {orderedReadings.length > 0 && (
                      <Card
                        aria-label="Review activity"
                        className="w-full border-2 border-border bg-card p-4 sm:p-5 flex flex-col gap-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h2 className="text-base sm:text-lg font-bold text-foreground">
                            Review Activity
                          </h2>
                          {preparation && (
                            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                              <BookOpen className="size-4 shrink-0" />
                              {preparation.completed_count} of {preparation.required_count}{" "}
                              reviewed
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col gap-2">
                          {orderedReadings.map((reading) => {
                            const isReviewed = reading.review_status === "REVIEWED";
                            return (
                              <ClassworkItemLine
                                key={reading.assignment_id}
                                className="border-2! shadow-none!"
                                item={{
                                  classwork_id: reading.classwork_id,
                                  title: reading.title,
                                  classwork_type: "READING",
                                }}
                                onClick={
                                  !isHistorical
                                    ? () =>
                                      navigate(
                                        `/student/classworks/${reading.assignment_id}?from=${encodeURIComponent(
                                          window.location.pathname + window.location.search
                                        )}&support_title=${encodeURIComponent(title)}`
                                      )
                                    : undefined
                                }
                                showPublicationStatus={false}
                                showCategory={false}
                                showType={false}
                                rightContent={
                                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                                    <Badge
                                      variant={isReviewed ? "surface" : "solid"}
                                      size="sm"
                                      className="gap-1"
                                    >
                                      {isReviewed ? "Reviewed" : "Review Required"}
                                    </Badge>
                                  </div>
                                }
                              />
                            );
                          })}
                        </div>
                        <p className="text-xs sm:text-sm text-muted-foreground px-1 -mt-1">
                          Complete all review activities before proceeding to the curated remediation activities.
                        </p>
                      </Card>
                    )}

                    {/* Curated remediation activities */}
                    {activities.length > 0 && (
                      <Card
                        aria-label="Curated activities"
                        className="w-full border-2 border-border bg-card p-4 sm:p-5 flex flex-col gap-3"
                      >
                        <h2 className="text-base sm:text-lg font-bold text-foreground">
                          Curated Remediation Activity
                        </h2>
                        <div className="flex flex-col gap-3">
                          {activities.map((act) => {
                            const preparationBlocked = act.preparation?.state === "BLOCKED";
                            const actHistorical = act.access_state === "HISTORICAL";
                            const locked = act.access_state === "PREPARATION_REQUIRED";
                            const finished = ["submitted", "graded", "completed"].includes(
                              act.submission_status?.toLowerCase() ?? ""
                            );

                            return (
                              <div key={act.assignment_id} className="space-y-1">
                                <ClassworkItemLine
                                  className="border-2! shadow-none!"
                                  item={{
                                    classwork_id: act.assignment_id,
                                    title: act.title,
                                    classwork_type: act.classwork_type,
                                  }}
                                  onClick={
                                    !actHistorical && !locked && !preparationBlocked
                                      ? () =>
                                        navigate(
                                          `/student/classworks/${act.assignment_id}?from=${encodeURIComponent(
                                            window.location.pathname + window.location.search
                                          )}&support_title=${encodeURIComponent(title)}`
                                        )
                                      : undefined
                                  }
                                  showPublicationStatus={false}
                                  showCategory={false}
                                  showType={false}
                                  rightContent={
                                    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                                      {act.grade != null && act.total_points != null && (
                                        <Badge variant="outline" size="sm">
                                          Score: {act.grade}/{act.total_points}
                                        </Badge>
                                      )}
                                      {act.submission_status && (
                                        <Badge
                                          variant={finished ? "solid" : "outline"}
                                          size="sm"
                                          className="capitalize"
                                        >
                                          {act.submission_status === "graded"
                                            ? "Completed"
                                            : act.submission_status === "submitted"
                                              ? "Submitted"
                                              : act.submission_status}
                                        </Badge>
                                      )}
                                      <Badge
                                        variant={actHistorical ? "default" : locked ? "solid" : "surface"}
                                        size="sm"
                                        className="gap-1"
                                      >
                                        {actHistorical ? "Unavailable" : locked ? "Locked" : "Ready"}
                                      </Badge>
                                    </div>
                                  }
                                />

                                {preparationBlocked ? (
                                  <p className="text-xs sm:text-sm text-muted-foreground px-1">
                                    Some required readings are unavailable. Your teacher needs to update this activity before you can continue.
                                  </p>
                                ) : locked ? (
                                  <p className="flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground px-1">
                                    <LockKeyhole className="size-3.5 shrink-0" />
                                    Complete all Supporting Readings before opening this activity.
                                  </p>
                                ) : actHistorical ? (
                                  <p className="text-xs sm:text-sm text-muted-foreground px-1">
                                    {act.prerequisite_message || "This activity is no longer available."}
                                  </p>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>

                        <p className="text-xs sm:text-sm text-muted-foreground px-1 -mt-1">
                          For additional help or resources, please contact your teacher.
                        </p>

                      </Card>
                    )}

                    {/* Empty state if neither review readings nor curated activities exist */}
                    {orderedReadings.length === 0 && activities.length === 0 && (
                      <StudentEmptyState
                        icon={<BookOpen className="size-6" />}
                        title="No activities assigned yet"
                        description="Your teacher hasn't assigned any remediation readings or activities for this support plan yet."
                      />
                    )}
                  </main>

                  {/* ── Aside (Right: Stat Cards) ── */}
                  <aside aria-label="Support Statistics" className="lg:col-span-6 flex flex-col gap-4 min-w-0">
                    {/* Target Lesson & Mastery Card */}
                    <Card className="@container/card bg-primary flex min-w-0 flex-col p-4 gap-3 border-2 border-border shadow-md">
                      <div className="flex justify-between items-center gap-2">
                        <Card.Description className="text-lg sm:text-xl font-bold text-foreground">
                          Target Lesson
                        </Card.Description>
                        <Badge variant={currentMastery.badgeVariant} size="sm">
                          {currentMastery.badgeLabel}
                        </Badge>
                      </div>

                      <Card className="flex flex-col gap-1 shadow-none">
                        <div className="flex flex-col">
                          <h3 className="font-bold text-base text-foreground">
                            {targetLessonTitle}
                          </h3>
                        </div>

                        <Card
                          className={cn(
                            "shadow-none items-center flex flex-col p-3.5 select-none transition-all duration-150 border-2 mt-0.5",
                            currentMastery.bgClass,
                          )}
                        >
                          <currentMastery.icon className={cn("size-8 transition-colors", currentMastery.colorClass)} />
                          <p className={cn("text-base font-bold text-center mt-1", currentMastery.colorClass)}>
                            {currentMastery.label} Mastery
                          </p>
                        </Card>

                        <p className="text-xs text-muted-foreground mt-1 px-1">
                          {currentMastery.description}
                        </p>
                      </Card>

                    </Card>

                    {/* Overall Progress Card */}
                    <Card className="flex flex-col p-4 gap-3 border-2 border-border shadow-md">
                      <div className="flex justify-between items-center">
                        <Card.Description className="text-lg sm:text-xl font-bold text-foreground">
                          Support Progress
                        </Card.Description>
                        <Badge variant="surface" size="sm">
                          {totalTasks > 0 ? `${overallPercentage}%` : "--"}
                        </Badge>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between items-center text-sm font-semibold">
                          <span>Overall Completion</span>
                          <span className="text-foreground text-xs sm:text-sm">
                            {completedTasks} of {totalTasks} done
                          </span>
                        </div>
                        <Progress value={overallPercentage} className="h-2.5" />
                      </div>

                      {totalReadings > 0 && (
                        <div className="flex flex-col gap-1.5 pt-1">
                          <div className="flex justify-between items-center text-sm font-semibold text-foreground">
                            <span>Supporting Readings</span>
                            <span>{reviewedReadings}/{totalReadings} reviewed</span>
                          </div>
                          <Progress value={readingPercentage} className="h-2" />
                        </div>
                      )}

                      {totalActivities > 0 && (
                        <div className="flex flex-col gap-1.5 pt-1">
                          <div className="flex justify-between items-center text-sm font-semibold text-foreground">
                            <span>Remediation Activities</span>
                            <span>{completedActivities}/{totalActivities} completed</span>
                          </div>
                          <Progress value={activityPercentage} className="h-2" />
                        </div>
                      )}

                      <div className="mt-auto flex flex-wrap gap-2">
                        <Badge variant={overallPercentage === 100 && totalTasks > 0 ? "success" : "surface"} size="sm">
                          {completedTasks} Finished
                        </Badge>
                        {totalTasks - completedTasks > 0 && (
                          <Badge variant="outline" size="sm">
                            {totalTasks - completedTasks} Remaining
                          </Badge>
                        )}
                        {maxPoints > 0 && (
                          <Badge variant="outline" size="sm">
                            Score: {earnedPoints}/{maxPoints}
                          </Badge>
                        )}
                      </div>
                    </Card>
                  </aside>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
