import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, useParams } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Button } from "@/components/student/button";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { useToast } from "@/components/retroui/Toast";
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
import { markInterventionViewed } from "@/lib/interventions-api";

export default function StudentInterventionView() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const routeParams = useParams();
  const toast = useToast();

  const interventionIdParam = params.get("intervention");
  const interventionId = interventionIdParam && /^\d+$/.test(interventionIdParam) ? Number(interventionIdParam) : null;
  const reviewerIdParam = params.get("reviewer") || routeParams.id;
  const reviewerId = reviewerIdParam && /^\d+$/.test(reviewerIdParam) ? Number(reviewerIdParam) : null;

  const [intervention, setIntervention] = useState<StudentPersistentIntervention | null>(null);
  const [reviewer, setReviewer] = useState<StudentReviewerDetail | null>(null);
  const [isRead, setIsRead] = useState(false);
  const [activities, setActivities] = useState<StudentSupportActivity[]>([]);

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
      }
    };

    void loadActivities();

    return () => {
      cancelled = true;
    };
  }, [reviewer?.material_id, activities.length]);

  const handleMarkAsRead = async () => {
    setIsRead(true);
    if (reviewer?.material_id) {
      try {
        await markInterventionViewed(reviewer.material_id);
      } catch {
        // non-blocking
      }
    }
    toast.success({
      title: "Marked as read",
      description: "Great work staying on top of your study support!",
    });
  };

  const subjectName = intervention?.subject_name || reviewer?.subject_name || "Study Support";
  const title = reviewer?.title || (intervention ? `${intervention.subject_name} Support` : "Study Support");
  const teacherName = intervention?.teacher_name;
  const introduction =
    reviewer?.introduction ||
    (intervention
      ? `Your teacher has set up extra help for ${intervention.subject_name}.`
      : "Your teacher has prepared additional study support for this subject.");
  const body = reviewer?.body?.trim() ?? "";

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
                      className="cursor-pointer tracking-normal hover:text-foreground"
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
                {/* Yellow Header Banner Card */}
                <div className="flex flex-col gap-2">
                  <Card className="w-full flex flex-col gap-1 bg-primary border-2 border-border p-3 sm:p-4 shadow-md">
                    <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
                      {title}
                    </h1>
                    <p className="text-sm font-medium text-foreground">
                      {subjectName}
                      {teacherName ? ` · ${teacherName}` : ""}
                    </p>
                  </Card>

                  {/* Introduction paragraph */}
                  {introduction && (
                    <p className="text-sm px-1 text-muted-foreground font-normal">
                      {introduction}
                    </p>
                  )}
                </div>

                {/* Supporting material from the teacher */}
                {body && (
                  <Card
                    aria-label="Supporting material"
                    className="w-full border-2 border-border bg-card p-4 sm:p-5 flex flex-col gap-3"
                  >
                    <h2 className="text-base sm:text-lg font-bold text-foreground">
                      Supporting Material
                    </h2>
                    <div className="whitespace-pre-wrap text-sm text-foreground leading-relaxed">
                      {body}
                    </div>
                  </Card>
                )}

                {/* Curated remediation activities */}
                {activities.length > 0 && (
                  <Card
                    aria-label="Curated activities"
                    className="w-full border-2 border-border bg-card p-4 sm:p-5 flex flex-col gap-3"
                  >
                    <h2 className="text-base sm:text-lg font-bold text-foreground">
                      Curated Activities
                    </h2>
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
                                window.location.pathname + window.location.search
                              )}`
                            )
                          }
                          rightContent={
                            act.submission_status ? (
                              <Badge
                                variant={
                                  act.submission_status === "graded" ||
                                    act.submission_status === "submitted"
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
                            ) : undefined
                          }
                        />
                      ))}
                    </div>
                  </Card>
                )}

                {/* Action buttons */}
                <div className="flex flex-wrap items-center gap-3 pt-2 pb-8">
                  <Button
                    type="button"
                    onClick={handleMarkAsRead}
                    className="font-bold"
                  >
                    {isRead ? "Marked as read ✓" : "Mark as read"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate(routes.student.interventions)}
                    className="font-bold"
                  >
                    Back to support
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
