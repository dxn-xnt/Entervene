import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { StudentEmptyState } from "@/components/student/student-empty-state";
import { routes } from "@/../routes";
import {
  listMyReviewers,
  type StudentReviewerSummary,
} from "@/lib/student-intervention-reviewers-api";
import {
  listMyActiveInterventions,
  listMyResolvedInterventions,
  type StudentPersistentIntervention,
} from "@/lib/student-persistent-interventions-api";
import IconContainer from "@/components/icon-container";
import { ClipboardList, History, Shield } from "lucide-react";
import { formatDate } from "@/lib/formatters";

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

  // Primary featured reviewer (or default mockup reviewer matching design)
  const latestReviewer = reviewers[0];
  const featuredReviewer = {
    id: latestReviewer?.material_id || null,
    title: latestReviewer?.title || "Math Review: Strengthening Your Exam Skills",
    subject: latestReviewer?.subject_name || "Mathematics",
    date: latestReviewer?.sent_at
      ? `Shared ${formatDate(latestReviewer.sent_at, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })}`
      : "Shared Oct 24, 2026 ",
    intro:
      "Your written work is going well. This review shows where to focus to lift your exam score.",
    tags: ["Focus: Exam", "Practise: Algebraic Expressions"],
  };

  // Active interventions fallback to demo item if empty
  const activeItems =
    activeInterventions.length > 0
      ? activeInterventions
      : [
        {
          intervention_id: 1,
          status: "ACTIVE" as const,
          subject_id: 1,
          subject_name: "Mathematics",
          class_id: 1,
          class_name: "Grade 10 - Mathematics",
          teacher_name: null,
          activities: [],
          reviewer_id: latestReviewer?.material_id || null,
          resolved_at: null,
          resolution_message: null,
        },
      ];

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
                <Card aria-label="New from your teacher" className="flex flex-col gap-3 p-5">
                  <h3 className="text-lg sm:text-2xl font-bold text-foreground">
                    New Support for You
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card className="w-full bg-background border-2 border-border p-4 sm:p-5 shadow-none flex flex-col gap-2 transition-all hover:bg-retro hover:-translate-y-1">
                      {/* Main Card Title */}
                      <div className="w-full justify-between flex items-start mb-3 gap-2">
                        <div className="flex flex-row gap-3 items-start min-w-0">
                          <IconContainer className="bg-primary shrink-0" size="xl">
                            <Shield className="text-border" size="36" />
                          </IconContainer>
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <h4
                              className="text-xl sm:text-2xl font-black text-foreground tracking-tight truncate"
                              title={featuredReviewer.title}
                            >
                              {featuredReviewer.title}
                            </h4>
                            <p className="text-sm font-medium text-foreground truncate">{featuredReviewer.subject}</p>
                          </div>
                        </div>
                      </div>

                      {/* Subtext description */}
                      <p className="text-sm text-foreground font-medium">
                        {featuredReviewer.intro}
                      </p>

                      {/* Badges/Pills */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {featuredReviewer.tags.map((tag, idx) => (
                          <Badge
                            key={idx}
                            variant="surface"
                            size="sm"
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>

                      {/* Meta line */}
                      <div className="flex items-center flex-wrap gap-2">
                        <span className="text-xs sm:text-sm text-muted-foreground">
                          {featuredReviewer.date}
                        </span>
                      </div>

                      {/* Action button */}
                      <div className="pt-2">
                        <Button
                          onClick={() =>
                            navigate(
                              featuredReviewer.id
                                ? `${routes.student.interventionView}?reviewer=${featuredReviewer.id}`
                                : routes.student.interventionView
                            )
                          }
                          className="gap-2"
                        >
                          Start Reading
                        </Button>
                      </div>
                    </Card>
                  </div>
                </Card>

                {/* Section 2: Your active support */}
                <section aria-label="Your active support" className="space-y-3">
                  <h3 className="text-lg sm:text-2xl font-bold text-foreground">
                    Your Active Support
                  </h3>

                  <div className="space-y-4">
                    {activeItems.map((item) => (
                      <Card
                        key={item.intervention_id}
                        className="w-full bg-card border-2 border-border p-5 sm:p-6 shadow-md space-y-4"
                      >
                        {/* Header line */}
                        <div className="flex items-start justify-between gap-4">
                          <h4 className="text-lg sm:text-xl font-bold text-foreground">
                            {item.subject_name} Support
                          </h4>
                          <Badge
                            variant="surface"
                            size="sm"
                            className="rounded-full! px-3 py-1 text-xs font-semibold whitespace-nowrap"
                          >
                            Teacher support active
                          </Badge>
                        </div>

                        {/* Subtext */}
                        <p className="text-sm text-muted-foreground">
                          Your teacher has set up extra help for {item.subject_name}.
                        </p>

                        {/* Dashed practice notice container */}
                        {item.activities && item.activities.length > 0 ? (
                          <div className="rounded border-2 border-dashed border-border p-4 text-xs sm:text-sm text-muted-foreground font-normal">
                            <div className="space-y-2">
                              <p className="font-semibold text-foreground">
                                Available practice activities:
                              </p>
                              <ul className="list-disc pl-5 space-y-1">
                                {item.activities.map((act) => (
                                  <li key={act.assignment_id}>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        navigate(
                                          `/student/classworks/${act.assignment_id}?from=${encodeURIComponent(
                                            window.location.pathname
                                          )}`
                                        )
                                      }
                                      className="text-foreground font-medium underline hover:text-primary cursor-pointer"
                                    >
                                      {act.title}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        ) : (
                          <StudentEmptyState
                            embedded
                            icon={<ClipboardList />}
                            className="shadow-none"
                            title="No practice activities yet"
                            description="Practice activities are on their way. We'll let you know when the first one is ready."
                          />
                        )}

                        {/* Action button */}
                        <div className="pt-1">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                              navigate(
                                item.reviewer_id
                                  ? `${routes.student.interventionView}?reviewer=${item.reviewer_id}`
                                  : routes.student.interventionView
                              )
                            }
                            className="gap-2 font-bold"
                          >
                            Read the review
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                </section>

                {/* Section 3: Past support */}
                <section aria-label="Past support" className="space-y-3 pb-8">
                  <h3 className="text-base sm:text-lg font-bold text-foreground">
                    Past support
                  </h3>

                  {resolvedInterventions.length === 0 ? (
                    <StudentEmptyState
                      icon={<History />}
                      title="No past support yet"
                      description="Finished support will be saved here so you can look back on it."
                    />
                  ) : (
                    <div className="space-y-3">
                      {resolvedInterventions.map((item) => (
                        <Card
                          key={item.intervention_id}
                          className="w-full border-2 border-border bg-card p-4 space-y-2"
                        >
                          <div className="flex justify-between items-center text-sm">
                            <span className="font-bold text-foreground">
                              {item.subject_name} Support
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {item.resolved_at
                                ? new Date(item.resolved_at).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })
                                : "Resolved"}
                            </span>
                          </div>
                          {item.resolution_message && (
                            <p className="text-xs text-muted-foreground">
                              {item.resolution_message}
                            </p>
                          )}
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
