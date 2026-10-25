import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/student/button";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Empty } from "@/components/retroui/Empty";
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
import { BookOpen, ClipboardList, History, Shield } from "lucide-react";
import { formatDateTime } from "@/lib/formatters";

export default function StudentInterventions() {
  const navigate = useNavigate();

  const [reviewers, setReviewers] = useState<StudentReviewerSummary[]>([]);
  const [activeInterventions, setActiveInterventions] = useState<StudentPersistentIntervention[]>([]);
  const [resolvedInterventions, setResolvedInterventions] = useState<StudentPersistentIntervention[]>([]);

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
      } catch (err) {
        console.warn("Unable to load live interventions", err);
      }
    };

    void loadAll();

    return () => {
      cancelled = true;
    };
  }, []);



  const renderActivities = (
    activities: StudentSupportActivity[],
    emptyPlaceholder?: React.ReactNode
  ) => {
    if (activities && activities.length > 0) {
      return (
        <div className="space-y-2">
          <p className="font-semibold text-foreground text-sm">
            Curated remediation activities:
          </p>
          <div className="flex flex-col gap-2">
            {activities.map((act) => (
              <ClassworkItemLine
                key={act.assignment_id}
                className="border-2! shadow-none!"
                item={{
                  classwork_id: act.assignment_id,
                  title: act.title,
                  classwork_type: act.classwork_type,
                }}
                showPublicationStatus={false}
                showCategory={false}
                showType={false}
                onClick={() =>
                  navigate(
                    `/student/classworks/${act.assignment_id}?from=${encodeURIComponent(
                      window.location.pathname
                    )}`
                  )
                }
                rightContent={
                  <div className="flex items-center gap-2">
                    {act.grade != null && act.total_points != null && (
                      <span className="text-xs font-bold">
                        {act.grade}
                        <span className="font-medium text-muted-foreground text-xs">
                          {" "}
                          / {act.total_points}
                        </span>
                      </span>
                    )}
                    {act.classwork_type && (
                      <Badge variant="surface" size="sm">
                        {act.classwork_type === "QUIZ"
                          ? "Quiz"
                          : act.classwork_type === "ASSIGNMENT"
                            ? "Assignment"
                            : act.classwork_type}
                      </Badge>
                    )}
                    {act.submission_status && (
                      <Badge
                        variant={
                          act.submission_status === "graded" || act.submission_status === "submitted"
                            ? "solid"
                            : "outline"
                        }
                        size="sm"
                      >
                        {act.submission_status === "graded"
                          ? "Completed"
                          : act.submission_status === "submitted"
                            ? "Submitted"
                            : act.submission_status}
                      </Badge>
                    )}
                  </div>
                }
              />
            ))}
          </div>
        </div>
      );
    }
    return emptyPlaceholder ?? null;
  };

  const emptyActivitiesPlaceholder = (
    <Empty className="w-full border-2 rounded! border-border bg-background p-4 shadow-none hover:shadow-none">
      <Empty.Content>
        <Empty.Icon className="size-8 text-muted-foreground flex items-center justify-center">
          <IconContainer className="bg-primary" size="sm">
            <ClipboardList className="size-8" />
          </IconContainer>
        </Empty.Icon>
        <Empty.Title className="text-base! font-bold">
          No practice activities yet
        </Empty.Title>
        <Empty.Description className="text-sm text-muted-foreground">
          Practice activities are on their way. We'll let you know when the first one is ready.
        </Empty.Description>
      </Empty.Content>
    </Empty>
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
                            {renderActivities(activities)}

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

                  {activeInterventions.length === 0 ? (
                    <Empty className="w-full border-2 rounded! border-border bg-card p-6 shadow-md hover:shadow-none">
                      <Empty.Content>
                        <Empty.Icon className="size-8 text-muted-foreground flex items-center justify-center">
                          <IconContainer className="bg-primary" size="sm">
                            <Shield className="size-8" />
                          </IconContainer>
                        </Empty.Icon>
                        <Empty.Title className="text-base! font-bold">
                          No active support
                        </Empty.Title>
                        <Empty.Description className="text-sm text-muted-foreground">
                          You don't have any active intervention support right now.
                        </Empty.Description>
                      </Empty.Content>
                    </Empty>
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
                          {renderActivities(item.activities, emptyActivitiesPlaceholder)}

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

                  {resolvedInterventions.length === 0 ? (
                    <Empty className="w-full border-2 rounded! border-border bg-card p-6 shadow-md hover:shadow-none">
                      <Empty.Content>
                        <Empty.Icon className="size-8 text-muted-foreground flex items-center justify-center">
                          <IconContainer className="bg-primary" size="sm">
                            <History className="size-8" />
                          </IconContainer>
                        </Empty.Icon>
                        <Empty.Title className="text-base! font-bold">
                          No past support yet
                        </Empty.Title>
                        <Empty.Description className="text-sm text-muted-foreground">
                          Finished support will be saved here so you can look back on it.
                        </Empty.Description>
                      </Empty.Content>
                    </Empty>
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
                          {renderActivities(item.activities)}

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
