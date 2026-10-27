import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/student/button";
import { StudentEmptyState } from "@/components/student/student-empty-state";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Alert } from "@/components/retroui/Alert";
import ClassworkItemLine from "@/components/item-line/classwork";
import { routes } from "@/../routes";
import {
  listMyReviewers,
  type StudentReviewerSummary,
} from "@/lib/student-intervention-reviewers-api";
import {
  listMyActiveInterventions,
  listMyResolvedInterventions,
  type StudentPersistentIntervention,
  type StudentSupportActivity,
} from "@/lib/student-persistent-interventions-api";
import IconContainer from "@/components/icon-container";
import {
  BookOpen,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  History,
  LockKeyhole,
  Shield,
  Timer,
} from "lucide-react";
import { formatDateTime } from "@/lib/formatters";

export default function StudentInterventions() {
  const navigate = useNavigate();

  const [reviewers, setReviewers] = useState<StudentReviewerSummary[]>([]);
  const [activeInterventions, setActiveInterventions] = useState<StudentPersistentIntervention[]>([]);
  const [resolvedInterventions, setResolvedInterventions] = useState<StudentPersistentIntervention[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadAll = async () => {
      try {
        const [revRes, activeRes, resolvedRes] = await Promise.allSettled([
          listMyReviewers(),
          listMyActiveInterventions(),
          listMyResolvedInterventions(),
        ]);

        if (cancelled) return;

        if (revRes.status === "fulfilled") {
          setReviewers(revRes.value.items || []);
        }
        if (activeRes.status === "fulfilled") {
          setActiveInterventions(activeRes.value.items || []);
        }
        if (resolvedRes.status === "fulfilled") {
          setResolvedInterventions(resolvedRes.value.items || []);
        }

        if (
          revRes.status === "rejected" ||
          activeRes.status === "rejected" ||
          resolvedRes.status === "rejected"
        ) {
          setLoadError("Some study support could not be loaded. Please try again later.");
        }
      } catch (err) {
        console.warn("Unable to load live interventions", err);
        if (!cancelled) {
          setLoadError("Study support could not be loaded. Please try again later.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadAll();

    return () => {
      cancelled = true;
    };
  }, []);



  const classworkLink = (assignmentId: number, interventionId?: number) =>
    `/student/classworks/${assignmentId}?from=${encodeURIComponent(
      window.location.pathname
    )}${interventionId ? `&intervention_id=${interventionId}` : ""}`;

  const renderActivities = (
    activities: StudentSupportActivity[],
    emptyPlaceholder?: React.ReactNode,
    interventionId?: number
  ) => {
    if (activities && activities.length > 0) {
      return (
        <div className="space-y-2">
          <p className="font-semibold text-foreground text-sm">
            Curated remediation activities:
          </p>
          <div className="flex flex-col gap-3">
            {activities.map((activity) => {
              const preparationBlocked = activity.preparation?.state === "BLOCKED";
              const historical = activity.access_state === "HISTORICAL";
              const locked = activity.access_state === "PREPARATION_REQUIRED";
              const finished = ["submitted", "graded", "completed"].includes(
                activity.submission_status?.toLowerCase() ?? ""
              );
              const orderedReadings = [...activity.readings].sort(
                (left, right) => left.order - right.order
              );

              return (
                <Card
                  key={activity.assignment_id}
                  className="w-full space-y-4 border-2 border-border bg-card p-3 shadow-none sm:p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="break-words text-base font-bold sm:text-lg">
                        {activity.title}
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        {activity.classwork_type === "QUIZ"
                          ? "Quiz"
                          : activity.classwork_type === "ASSIGNMENT"
                            ? "Assignment"
                            : activity.classwork_type}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {activity.grade != null && activity.total_points != null && (
                        <Badge variant="outline" size="sm">
                          Score: {activity.grade}/{activity.total_points}
                        </Badge>
                      )}
                      {activity.submission_status && (
                        <Badge variant={finished ? "solid" : "outline"} size="sm" className="capitalize">
                          {activity.submission_status === "graded"
                            ? "Completed"
                            : activity.submission_status === "submitted"
                              ? "Submitted"
                              : activity.submission_status}
                        </Badge>
                      )}
                      <Badge
                        variant={historical ? "default" : locked ? "outline" : "success"}
                        size="sm"
                        className="gap-1"
                      >
                        {historical ? (
                          <History className="size-3.5" />
                        ) : locked ? (
                          <LockKeyhole className="size-3.5" />
                        ) : (
                          <CheckCircle2 className="size-3.5" />
                        )}
                        {historical ? "Unavailable" : locked ? "Locked" : "Ready"}
                      </Badge>
                    </div>
                  </div>

                  {activity.preparation && (
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <BookOpen className="size-4 shrink-0" />
                      {activity.preparation.completed_count} of {activity.preparation.required_count}{" "}
                      reviewed
                    </div>
                  )}

                  {orderedReadings.length > 0 && (
                    <div className="space-y-2" aria-label={`Required readings for ${activity.title}`}>
                      <p className="text-sm font-bold">Required Supporting Readings</p>
                      {orderedReadings.map((reading) => {
                        const isReviewed = reading.review_status === "REVIEWED";
                        return (
                          <ClassworkItemLine
                            key={reading.assignment_id}
                            size="sm"
                            className="border-2! shadow-none!"
                            item={{
                              classwork_id: reading.classwork_id,
                              title: reading.title,
                              classwork_type: "READING",
                            }}
                            showPublicationStatus={false}
                            showCategory={false}
                            showType={false}
                            rightContent={
                              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                                <Badge
                                  variant={isReviewed ? "success" : "outline"}
                                  size="sm"
                                  className="gap-1"
                                >
                                  {isReviewed ? (
                                    <CheckCircle2 className="size-3.5" />
                                  ) : (
                                    <Timer className="size-3.5" />
                                  )}
                                  {isReviewed ? "Reviewed" : "Review Required"}
                                </Badge>
                                {!historical && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    autoIcon={false}
                                    className="gap-2"
                                    aria-label={`Open reading: ${reading.title}`}
                                    onClick={() => navigate(classworkLink(reading.assignment_id, interventionId))}
                                  >
                                    <ExternalLink className="size-4" />
                                    Open Reading
                                  </Button>
                                )}
                              </div>
                            }
                          />
                        );
                      })}
                    </div>
                  )}

                  {preparationBlocked ? (
                    <Alert status="warning">
                      Some required readings are unavailable. Your teacher needs to update this activity before you can continue.
                    </Alert>
                  ) : locked ? (
                    <p className="flex items-start gap-2 text-sm text-muted-foreground">
                      <LockKeyhole className="mt-0.5 size-4 shrink-0" />
                      Complete all Supporting Readings before opening this activity.
                    </p>
                  ) : historical ? (
                    <p className="text-sm text-muted-foreground">
                      {activity.prerequisite_message || "This activity is no longer available."}
                    </p>
                  ) : (
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        autoIcon={false}
                        className="gap-2"
                        onClick={() => navigate(classworkLink(activity.assignment_id, interventionId))}
                      >
                        <ExternalLink className="size-4" />
                        {finished ? "View Activity" : "Start Activity"}
                      </Button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      );
    }
    return emptyPlaceholder ?? null;
  };

  const emptyActivitiesPlaceholder = (
    <StudentEmptyState
      embedded
      className="bg-background shadow-none"
      icon={<ClipboardList />}
      title="No practice activities yet"
      description="Practice activities are on their way. We'll let you know when the first one is ready."
    />
  );

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-clip">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <SidebarTrigger className="shrink-0 md:hidden" />
              <h1 className="text-xl font-bold sm:text-2xl md:text-4xl">
                Study Support
              </h1>
            </header>

            <div className="-mt-[1px] flex min-w-0 flex-col gap-6 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
              <div className="w-full flex flex-col gap-4">
                {loadError && <Alert status="error">{loadError}</Alert>}

                {/* Section 1: New from your teacher */}
                {reviewers.length > 0 && (
                  <Card aria-label="New from your teacher" className="flex flex-col gap-3 p-5">
                    <h3 className="text-lg sm:text-2xl font-bold text-foreground">
                      New Support for You
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {reviewers.map((rev) => {
                        const matchingIntervention =
                          activeInterventions.find((i) => i.reviewer_id === rev.material_id) ??
                          resolvedInterventions.find((i) => i.reviewer_id === rev.material_id);
                        const activities = matchingIntervention?.activities ?? [];

                        return (
                          <Card
                            key={rev.material_id}
                            className="w-full bg-background border-2 border-border p-4 sm:p-5 shadow-none flex flex-col gap-2 transition-all hover:bg-retro hover:-translate-y-1"
                          >
                            {/* Main Card Title */}
                            <div className="w-full justify-between flex items-start mb-1 gap-2">
                              <div className="flex flex-row gap-3 items-start min-w-0">
                                <IconContainer className="bg-primary shrink-0" size="xl">
                                  <Shield className="text-border" size="36" />
                                </IconContainer>
                                <div className="flex flex-col gap-0.5 min-w-0">
                                  <h4
                                    className="text-xl sm:text-2xl font-black text-foreground tracking-tight truncate"
                                    title={rev.title}
                                  >
                                    {rev.title}
                                  </h4>
                                  <p className="text-sm font-medium text-foreground truncate">{rev.subject_name}</p>
                                </div>
                              </div>
                            </div>

                            {/* Curated remediation activities if any */}
                            {renderActivities(activities, undefined, matchingIntervention?.intervention_id)}

                            {/* Meta line */}
                            <div className="flex items-end flex-wrap justify-between gap-2 mt-auto pt-2">
                              <span className="text-xs sm:text-sm text-muted-foreground">
                                {rev.sent_at ? `Shared ${formatDateTime(rev.sent_at)}` : ""}
                              </span>

                              {/* Action button */}
                              <Button
                                size="sm"
                                autoIcon={false}
                                onClick={() =>
                                  navigate(`${routes.student.interventionView}?reviewer=${rev.material_id}`)
                                }
                                className="gap-2"
                              >
                                <BookOpen className="size-4" />
                                Start Reading
                              </Button>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  </Card>
                )}

                {/* Section 2: Your active support */}
                <section aria-label="Your active support" className="space-y-3">
                  <h3 className="text-lg sm:text-2xl font-bold text-foreground">
                    Your Active Support
                  </h3>

                  {loading ? (
                    <p className="text-sm text-muted-foreground">Loading your active support...</p>
                  ) : activeInterventions.length === 0 ? (
                    <StudentEmptyState
                      icon={<Shield />}
                      title="No active support"
                      description="You don't have any active intervention support right now."
                    />
                  ) : (
                    <div className="space-y-4">
                      {activeInterventions.map((item) => (
                        <Card
                          key={item.intervention_id}
                          className="w-full bg-background border-2 border-border p-4 sm:p-5 shadow-none flex flex-col gap-2 transition-all hover:bg-retro hover:-translate-y-1"
                        >
                          {/* Main Card Title */}
                          <div className="w-full justify-between flex items-start mb-1 gap-2">
                            <div className="flex flex-row gap-3 items-start min-w-0">
                              <IconContainer className="bg-primary shrink-0" size="xl">
                                <Shield className="text-border" size="36" />
                              </IconContainer>
                              <div className="flex flex-col gap-0.5 min-w-0">
                                <h4
                                  className="text-xl sm:text-2xl font-black text-foreground tracking-tight truncate"
                                  title={`${item.subject_name} Support`}
                                >
                                  {item.subject_name} Support
                                </h4>
                                <p className="text-sm font-medium text-foreground truncate">
                                  {item.class_name}
                                  {item.teacher_name ? ` · ${item.teacher_name}` : ""}
                                </p>
                              </div>
                            </div>
                            <Badge variant="surface" size="sm">
                              Active
                            </Badge>
                          </div>

                          {/* Subtext */}
                          <p className="text-sm text-muted-foreground">
                            Your teacher has set up extra help for {item.subject_name}.
                          </p>

                          {/* Curated remediation classwork activities */}
                          {renderActivities(item.activities, emptyActivitiesPlaceholder, item.intervention_id)}

                          {/* Meta line */}
                          <div className="flex items-end flex-wrap justify-between gap-2 mt-auto pt-2">
                            <span className="text-xs sm:text-sm text-muted-foreground">
                              Teacher support active
                            </span>

                            {/* Action button */}
                            <Button
                              size="sm"
                              variant="outline"
                              autoIcon={false}
                              onClick={() =>
                                navigate(
                                  item.reviewer_id
                                    ? `${routes.student.interventionView}?reviewer=${item.reviewer_id}`
                                    : routes.student.interventionView
                                )
                              }
                              className="gap-2"
                            >
                              <BookOpen className="size-4" />
                              Read Review
                            </Button>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </section>

                {/* Section 3: Past support */}
                <section aria-label="Past support" className="space-y-3 pb-8">
                  <h3 className="text-base sm:text-lg font-bold text-foreground">
                    Past support
                  </h3>

                  {loading ? (
                    <p className="text-sm text-muted-foreground">Loading past support...</p>
                  ) : resolvedInterventions.length === 0 ? (
                    <StudentEmptyState
                      icon={<History />}
                      title="No past support yet"
                      description="Finished support will be saved here so you can look back on it."
                    />
                  ) : (
                    <div className="space-y-4">
                      {resolvedInterventions.map((item) => (
                        <Card
                          key={item.intervention_id}
                          className="w-full bg-background border-2 border-border p-4 sm:p-5 shadow-none flex flex-col gap-2 transition-all hover:bg-retro hover:-translate-y-1"
                        >
                          {/* Main Card Title */}
                          <div className="w-full justify-between flex items-start mb-1 gap-2">
                            <div className="flex flex-row gap-3 items-start min-w-0">
                              <IconContainer className="bg-primary shrink-0" size="xl">
                                <History className="text-border" size="36" />
                              </IconContainer>
                              <div className="flex flex-col gap-0.5 min-w-0">
                                <h4
                                  className="text-xl sm:text-2xl font-black text-foreground tracking-tight truncate"
                                  title={`${item.subject_name} Support`}
                                >
                                  {item.subject_name} Support
                                </h4>
                                <p className="text-sm font-medium text-foreground truncate">
                                  {item.class_name}
                                  {item.teacher_name ? ` · ${item.teacher_name}` : ""}
                                </p>
                              </div>
                            </div>
                            <Badge variant="surface" size="sm">
                              Resolved
                            </Badge>
                          </div>

                          {/* Subtext */}
                          {item.resolution_message && (
                            <p className="text-sm text-muted-foreground">
                              {item.resolution_message}
                            </p>
                          )}

                          {/* Curated remediation classwork activities */}
                          {renderActivities(item.activities, undefined, item.intervention_id)}

                          {/* Meta line */}
                          <div className="flex items-end flex-wrap justify-between gap-2 mt-auto pt-2">
                            <span className="text-xs sm:text-sm text-muted-foreground">
                              {item.resolved_at
                                ? `Resolved ${formatDateTime(item.resolved_at)}`
                                : "Resolved"}
                            </span>

                            {/* Action button */}
                            {item.reviewer_id ? (
                              <Button
                                size="sm"
                                variant="outline"
                                autoIcon={false}
                                onClick={() =>
                                  navigate(
                                    `${routes.student.interventionView}?reviewer=${item.reviewer_id}`
                                  )
                                }
                                className="gap-2"
                              >
                                <BookOpen className="size-4" />
                                Read Review
                              </Button>
                            ) : null}
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
