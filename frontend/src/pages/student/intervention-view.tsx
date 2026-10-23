import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, useParams } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Checkbox } from "@/components/retroui/Checkbox";
import { Progress } from "@/components/retroui/Progress";
import { useToast } from "@/components/retroui/Toast";
import { routes } from "@/../routes";
import {
  getMyReviewer,
  listMyReviewers,
  type StudentReviewerDetail,
} from "@/lib/student-intervention-reviewers-api";
import { markInterventionViewed } from "@/lib/interventions-api";

interface TopicPerformance {
  title: string;
  scoreText: string;
  percent: number;
  comment: string;
  isNeedsAttention?: boolean;
}

export default function StudentInterventionView() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const routeParams = useParams();
  const toast = useToast();

  const reviewerIdParam = params.get("reviewer") || routeParams.id;
  const reviewerId = reviewerIdParam && /^\d+$/.test(reviewerIdParam) ? Number(reviewerIdParam) : null;

  const [reviewer, setReviewer] = useState<StudentReviewerDetail | null>(null);
  const [isRead, setIsRead] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Record<number, boolean>>({});

  useEffect(() => {
    let cancelled = false;

    const loadReviewer = async () => {
      try {
        if (reviewerId) {
          const data = await getMyReviewer(reviewerId);
          if (!cancelled) setReviewer(data);
        } else {
          // Fetch latest reviewer if available
          const list = await listMyReviewers();
          if (!cancelled && list.items.length > 0) {
            const first = await getMyReviewer(list.items[0].material_id);
            if (!cancelled) setReviewer(first);
          }
        }
      } catch (err) {
        // Fall back gracefully to preset review content
        console.warn("Using preset review content", err);
      }
    };

    void loadReviewer();

    return () => {
      cancelled = true;
    };
  }, [reviewerId]);

  const toggleCheck = (index: number) => {
    setCheckedItems((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

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

  // Content values with dynamic fallback to design mockup
  const subjectName = reviewer?.subject_name || "Mathematics";
  const title = reviewer?.title || "Strengthening Your Exam Skills";
  const introduction =
    reviewer?.introduction ||
    "You’ve shown solid progress in written work and performance tasks. The exam is where you can grow the most. This review covers exam strategies, practice ideas and a quick checklist.";

  const checklistItems = [
    "Practise simplifying algebraic expressions",
    "Review the negative-number rules",
    "Try a few more word problems",
    "Practise simplifying fractions in equations",
  ];

  const topics: TopicPerformance[] = [
    {
      title: "Number Sense",
      scoreText: "16/20",
      percent: 80,
      comment: "Good foundation. Practise more word problems.",
    },
    {
      title: "Integer Operations",
      scoreText: "16.4/20",
      percent: 82,
      comment: "Strong. Review negative-number rules.",
    },
    {
      title: "Rational Numbers",
      scoreText: "16.8/20",
      percent: 84,
      comment: "Solid. Work on simplifying fractions in equations.",
    },
    {
      title: "Algebraic Expressions",
      scoreText: "9/20",
      percent: 45,
      comment: "Focus on simplifying.",
      isNeedsAttention: true,
    },
  ];

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
              <div className="mx-auto w-full space-y-6">
                {/* Yellow Header Banner Card */}
                <Card className="w-full flex flex-col gap-1 bg-primary border-2 border-border p-3 sm:p-4 shadow-md">

                  <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
                    {title}
                  </h1>

                  <p className="text-xs sm:text-sm font-medium text-foreground">
                    {subjectName}
                  </p>
                </Card>

                {/* Introduction paragraph */}
                <p className="text-sm sm:text-base leading-relaxed text-foreground/90 font-normal">
                  {introduction}
                </p>

                {/* Custom Reviewer Body (if teacher provided extra body notes) */}
                {reviewer?.body && reviewer.body.trim().length > 0 && !reviewer.body.includes("Try one yourself") && (
                  <Card className="w-full border-2 border-border bg-card p-5 sm:p-6 shadow-md space-y-2">
                    <h3 className="font-bold text-foreground text-sm uppercase tracking-wide">
                      Teacher Notes
                    </h3>
                    <div className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed font-mono bg-muted/40 p-3 rounded border border-border">
                      {reviewer.body}
                    </div>
                  </Card>
                )}


                {/* Lesson Mastery */}
                <Card
                  aria-label="Topics from your written work"
                  className="w-full border-2 border-border bg-card p-4 sm:p-5 flex flex-col gap-3"
                >
                  <h2 className="text-base sm:text-lg font-bold text-foreground">
                    Lesson Mastery
                  </h2>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {topics.map((t, idx) => (
                      <div
                        key={idx}
                        className={`rounded border-2 p-4 space-y-2.5 ${t.isNeedsAttention
                          ? "border-amber-500 bg-amber-500/10"
                          : "border-border bg-card"
                          }`}
                      >
                        <div className="flex justify-between items-center text-sm">
                          <span className="font-bold text-foreground">{t.title}</span>
                          <span className="font-semibold text-muted-foreground">{t.scoreText}</span>
                        </div>
                        <Progress
                          value={t.percent}
                          indicatorClassName={t.isNeedsAttention ? "bg-amber-600 dark:bg-amber-500" : "bg-foreground"}
                        />
                        <p
                          className={`text-xs ${t.isNeedsAttention
                            ? "text-amber-800 dark:text-amber-300"
                            : "text-muted-foreground"
                            }`}
                        >
                          {t.isNeedsAttention && (
                            <span className="font-bold">Needs attention. </span>
                          )}
                          {t.comment}
                        </p>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* Card 3: 3. Quick checklist */}
                <Card
                  aria-label="Quick checklist"
                  className="w-full border-2 border-border bg-card p-5 sm:p-6 shadow-md space-y-4"
                >
                  <h2 className="text-base sm:text-lg font-bold text-foreground">
                    3. Quick checklist
                  </h2>

                  <div className="space-y-3">
                    {checklistItems.map((item, idx) => {
                      const checked = Boolean(checkedItems[idx]);
                      return (
                        <label
                          key={idx}
                          className="flex items-center gap-3 cursor-pointer select-none group"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleCheck(idx)}
                          />
                          <span
                            className={`text-sm transition-colors ${checked
                              ? "line-through text-muted-foreground font-normal"
                              : "text-foreground font-medium"
                              }`}
                          >
                            {item}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </Card>

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
