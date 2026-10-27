import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
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
  type StudentRequiredReading,
  type StudentPreparationProgress,
} from "@/lib/student-persistent-interventions-api";
import InterventionCard from "@/components/intervention-card";
import {
  BookOpen,
  ClipboardList,
  History,
  LockKeyhole,
  Shield,
} from "lucide-react";
import { formatDate } from "@/lib/formatters";

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
    interventionId?: number,
    interventionReadings?: StudentRequiredReading[],
    interventionPreparation?: StudentPreparationProgress | null
  ) => {
    const allReadings =
      interventionReadings && interventionReadings.length > 0
        ? interventionReadings
        : Array.from(
          new Map(
            (activities ?? [])
              .flatMap((act) => act.readings ?? [])
              .map((r) => [r.assignment_id, r])
          ).values()
        );
    const orderedReadings = [...allReadings].sort(
      (left, right) => left.order - right.order
    );

    const preparation =
      interventionPreparation ??
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

    const hasActivities = activities && activities.length > 0;
    const hasReadings = orderedReadings.length > 0;

    if (!hasActivities && !hasReadings) {
      return emptyPlaceholder ?? null;
    }

    return (
      <div className="space-y-4">
        {/* Section: Review Activity */}
        {hasReadings && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-foreground text-base">
                Review Activity
              </p>
              {preparation && (
                <div className="flex items-center gap-2 text-sm font-semibold">
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
                    size="sm"
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
                            classworkLink(reading.assignment_id, interventionId)
                          )
                        : undefined
                    }
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
                          {isReviewed ? "Reviewed" : "Review Required"}
                        </Badge>
                      </div>
                    }
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Section: Curated Remediation Activities */}
        {hasActivities ? (
          <div className="space-y-2">
            <p className="font-semibold text-foreground text-base">
              Curated Remediation Activities
            </p>
            <div className="flex flex-col gap-3">
              {activities.map((activity) => {
                const preparationBlocked = activity.preparation?.state === "BLOCKED";
                const historical = activity.access_state === "HISTORICAL";
                const locked = activity.access_state === "PREPARATION_REQUIRED";
                const finished = ["submitted", "graded", "completed"].includes(
                  activity.submission_status?.toLowerCase() ?? ""
                );

                return (
                  <div key={activity.assignment_id} className="space-y-1">
                    <ClassworkItemLine
                      className="border-2! shadow-none!"
                      item={{
                        classwork_id: activity.assignment_id,
                        title: activity.title,
                        classwork_type: activity.classwork_type,
                      }}
                      onClick={
                        !historical && !locked && !preparationBlocked
                          ? () => navigate(classworkLink(activity.assignment_id, interventionId))
                          : undefined
                      }
                      showPublicationStatus={false}
                      showCategory={false}
                      showType={false}
                      rightContent={
                        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                          {activity.grade != null && activity.total_points != null && (
                            <Badge variant="outline" size="sm">
                              Score: {activity.grade}/{activity.total_points}
                            </Badge>
                          )}
                          {activity.submission_status && (
                            <Badge
                              variant={finished ? "solid" : "outline"}
                              size="sm"
                              className="capitalize"
                            >
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
                            {historical ? "Unavailable" : locked ? "Locked" : "Ready"}
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
                    ) : historical ? (
                      <p className="text-xs sm:text-sm text-muted-foreground px-1">
                        {activity.prerequisite_message || "This activity is no longer available."}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          emptyPlaceholder ?? null
        )}
      </div>
    );
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
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl md:text-4xl">
                Study Support
              </h1>
            </header>

            <div className="-mt-[1px] flex min-w-0 flex-col gap-6 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
              <div className="w-full flex flex-col gap-4">
                {loadError && <Alert status="error">{loadError}</Alert>}

                {/* Section 1: New from your teacher */}
                {reviewers.length > 0 && (
                  <Card aria-label="New from your teacher" className="flex flex-col gap-3 p-5 bg-primary">
                    <h3 className="text-lg sm:text-2xl font-bold text-foreground">
                      New Support for You
                    </h3>
                    <div className="flex flex-col gap-4">
                      {reviewers.map((rev) => {
                        const matchingIntervention =
                          activeInterventions.find((i) => i.reviewer_id === rev.material_id) ??
                          resolvedInterventions.find((i) => i.reviewer_id === rev.material_id);
                        const activities = matchingIntervention?.activities ?? [];

                        return (
                          <InterventionCard
                            key={rev.material_id}
                            category="new"
                            title={rev.title}
                            subtitle={rev.subject_name}
                            metaText={rev.sent_at ? `Shared ${formatDate(rev.sent_at)}` : ""}
                            actionLabel="Start Reading"
                            onAction={() =>
                              navigate(`${routes.student.interventionView}?reviewer=${rev.material_id}`)
                            }
                          >
                            {renderActivities(
                              activities,
                              undefined,
                              matchingIntervention?.intervention_id,
                              matchingIntervention?.required_readings,
                              matchingIntervention?.preparation
                            )}
                          </InterventionCard>
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
                    <div className="flex flex-col gap-4">
                      {activeInterventions.map((item) => (
                        <InterventionCard
                          key={item.intervention_id}
                          category="active"
                          title={`${item.subject_name} Support`}
                          subtitle={item.teacher_name ? ` ${item.teacher_name}` : undefined}
                          description={`Your teacher has set up extra help for ${item.subject_name}.`}
                          metaText={
                            item.activated_at
                              ? `Started ${formatDate(item.activated_at)}`
                              : "Teacher support active"
                          }
                          actionLabel="Read Review"
                          onAction={() =>
                            navigate(
                              item.reviewer_id
                                ? `${routes.student.interventionView}?intervention=${item.intervention_id}&reviewer=${item.reviewer_id}`
                                : `${routes.student.interventionView}?intervention=${item.intervention_id}`
                            )
                          }
                        >
                          {renderActivities(
                            item.activities,
                            emptyActivitiesPlaceholder,
                            item.intervention_id,
                            item.required_readings,
                            item.preparation
                          )}
                        </InterventionCard>
                      ))}
                    </div>
                  )}
                </section>

                {/* Section 3: Past support */}
                <section aria-label="Past support" className="space-y-3 pb-8">
                  <h3 className="text-2xl font-bold text-foreground">
                    Past Support
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
                    <div className="flex flex-col gap-4">
                      {resolvedInterventions.map((item) => (
                        <InterventionCard
                          key={item.intervention_id}
                          category="resolved"
                          title={`${item.subject_name} Support`}
                          subtitle={
                            item.teacher_name
                              ? `${item.subject_name} · ${item.teacher_name}`
                              : item.subject_name
                          }
                          description={item.resolution_message}
                          metaText={
                            item.resolved_at
                              ? `Resolved ${formatDate(item.resolved_at)}`
                              : "Resolved"
                          }
                          actionLabel={item.reviewer_id ? "Read Review" : undefined}
                          onAction={
                            item.reviewer_id
                              ? () =>
                                navigate(
                                  `${routes.student.interventionView}?intervention=${item.intervention_id}&reviewer=${item.reviewer_id}`
                                )
                              : undefined
                          }
                        >
                          {renderActivities(
                            item.activities,
                            undefined,
                            item.intervention_id,
                            item.required_readings,
                            item.preparation
                          )}
                        </InterventionCard>
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
