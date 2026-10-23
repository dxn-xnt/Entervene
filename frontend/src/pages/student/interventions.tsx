import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { useToast } from "@/components/retroui/Toast";
import { Select } from "@/components/retroui/Select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import {
  Sparkles,
  CheckCircle2,
  BookOpen,
  Loader2,
  Clock,
  ArrowRight,
  PartyPopper,
} from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { Empty } from "@/components/retroui/Empty";
import { useNavigate } from "react-router-dom";
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
import { Shield } from "lucide-react";
import { formatDate } from "@/lib/formatters";

export default function StudentInterventions() {
  const navigate = useNavigate();

  const [reviewers, setReviewers] = useState<StudentReviewerSummary[]>([]);
  const [activeInterventions, setActiveInterventions] = useState<StudentPersistentIntervention[]>([]);
  const [resolvedInterventions, setResolvedInterventions] = useState<StudentPersistentIntervention[]>([]);

  useEffect(() => {
    loadData();
  }, [statusFilter]);

  const handleComplete = async (id: number) => {
    setCompletingId(id);
    try {
      await completeMyIntervention(id);
      toast.success({ title: "Study recommendation completed" });
      void loadData();
    } catch (err) {
      toast.error({ title: "Unable to complete recommendation", description: err instanceof Error ? err.message : "Please try again." });
    } finally {
      setCompletingId(null);
    }
  };

  const handleViewMaterial = async (item: StudentSuggestionItem) => {
    // Mark as viewed in background
    if (!item.is_viewed) {
      markInterventionViewed(item.suggestion_id).catch(console.error);
    }
    // Navigate to subjects page
    navigate(routes.student.subjects);
  };

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

            <div className="-mt-[1px] flex min-w-0 flex-col gap-4 border-t-2 border-border px-3 py-3 sm:gap-6 sm:px-4 sm:py-4 md:px-6">
              {import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEVELOPMENT_PREDICTIONS === "true" &&
                <>
                  <StudentActiveInterventions />
                  <StudentResolvedInterventions />
                  <StudentReviewerSection />
                </>
              }

              {/* Main Content Area */}
              {loading ? (
                <LoadingPanel label="Loading your study recommendations..." />
              ) : error ? (
                <div className="p-6 border-2 border-black bg-rose-50 text-rose-700 font-bold text-sm shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                  {error}
                </div>
              ) : items.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {items.map((item) => (
                    <Card
                      key={item.suggestion_id}
                      className="p-5 border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-between gap-4 rounded hover:translate-y-[-2px] transition-transform"
                    >
                      <div className="flex flex-col gap-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {item.prediction_id && (
                              <Badge className="bg-yellow-300 border-2 border-black text-[9px] font-black uppercase px-1.5 py-0.5">
                                <Sparkles className="size-3 mr-1 fill-black inline" />
                                AI Recommended
                              </Badge>
                            )}
                            <Badge
                              className={`border-2 border-black text-[9px] font-black uppercase px-2 py-0.5 ${item.resource_type === "LESSON"
                                ? "bg-sky-300 text-black"
                                : "bg-purple-300 text-black"
                                }`}
                            >
                              {item.resource_type}
                            </Badge>
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
                        <div className="rounded border-2 border-dashed border-border p-4 text-xs sm:text-sm text-muted-foreground font-normal">
                          {item.activities && item.activities.length > 0 ? (
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
                          ) : (
                            "Practice activities are on their way. We'll let you know when the first one is ready."
                          )}
                        </div>

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
                            className="font-bold"
                          >
                            Read the review
                          </Button>
                        ) : (
                          <Badge className="bg-emerald-100 text-emerald-800 border-2 border-black font-extrabold text-xs px-2.5 py-1">
                            <CheckCircle2 className="size-3.5 mr-1 inline" />
                            Completed
                          </Badge>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                /* Clean RetroUI Empty State */
                <Empty>
                  <Empty.Content>
                    <Empty.Icon><PartyPopper size={24} /></Empty.Icon>
                    <Empty.Title>No Study Recommendations</Empty.Title>
                    <Empty.Description>You currently have no study recommendations for this view.</Empty.Description>
                    <Button
                      size="sm"
                      onClick={() => navigate(routes.student.subjects)}
                      className="bg-yellow-300 hover:bg-yellow-400 text-black border-2 border-black font-extrabold text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] mt-2"
                    >
                      <BookOpen className="size-4 mr-1.5" />
                      Browse Subjects & Lessons
                    </Button>
                  </Empty.Content>
                </Empty>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
