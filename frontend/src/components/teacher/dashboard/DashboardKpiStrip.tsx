import type { ReactNode } from "react";
import {
  ArrowUpRight,
  Award,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  ShieldCheck,
} from "lucide-react";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import type { TeacherDashboardAnalyticsPayload } from "@/lib/api";
import { buildPathWithQuery, formatPercent, formatScore } from "./format";
import { routes } from "@/../routes";

interface DashboardKpiStripProps {
  analytics: TeacherDashboardAnalyticsPayload;
  selectedClassId: string;
  selectedSubjectId: string;
  onNavigate: (path: string) => void;
}

interface KpiCardSpec {
  id: string;
  title: string;
  value: string;
  primaryLine: string;
  secondaryLine: string;
  highlightBadge?: { label: string; tone: "neutral" | "amber" | "emerald" };
  icon: ReactNode;
  onClick: () => void;
}

export function DashboardKpiStrip({
  analytics,
  selectedClassId,
  selectedSubjectId,
  onNavigate,
}: DashboardKpiStripProps) {
  const {
    submission_rate,
    grading_completion,
    graded_performance,
    term_grades,
    threshold_summary,
    period_attendance,
    interventions,
  } = analytics;

  const classIdNum = selectedClassId !== "all" ? Number(selectedClassId) : undefined;
  const subjectIdNum = selectedSubjectId !== "all" ? Number(selectedSubjectId) : undefined;

  const gradesDestination =
    classIdNum && subjectIdNum
      ? `/teacher/grades/${encodeURIComponent(String(classIdNum))}/${encodeURIComponent(String(subjectIdNum))}`
      : buildPathWithQuery(routes.teacher.grades, {
          class_id: classIdNum,
          subject_id: subjectIdNum,
        });

  const activePlusResolved = interventions.active_count + interventions.resolved_total_count;

  const kpiCards: KpiCardSpec[] = [
    {
      id: "submission-rate",
      title: "Classwork Submission Rate",
      value: formatPercent(submission_rate.submission_rate_percent),
      primaryLine:
        submission_rate.submitted_count != null
          ? `${submission_rate.submitted_count} of ${submission_rate.expected_count} expected`
          : `${submission_rate.resolved_submitted_count} resolved of ${submission_rate.expected_count} expected`,
      secondaryLine:
        submission_rate.late_rate_percent != null
          ? `Online participation · ${formatPercent(submission_rate.late_rate_percent)} late`
          : "Online submission-requiring classwork",
      icon: <FileCheck2 className="size-4" />,
      onClick: () =>
        onNavigate(
          buildPathWithQuery(routes.teacher.classworks, {
            class_id: classIdNum,
            subject_id: subjectIdNum,
          }),
        ),
    },
    {
      id: "grading-completion",
      title: "Grading Completion Rate",
      value: formatPercent(grading_completion.grading_completion_rate_percent),
      primaryLine:
        grading_completion.finalized_count != null && grading_completion.submitted_gradable_count != null
          ? `${grading_completion.finalized_count} of ${grading_completion.submitted_gradable_count} finalized (${grading_completion.auto_graded_count ?? 0} auto · ${grading_completion.teacher_graded_count ?? 0} teacher)`
          : "Includes auto-graded and teacher-graded work",
      secondaryLine: "Finalized official online submissions",
      highlightBadge:
        grading_completion.awaiting_grading_count != null
          ? {
              label: `${grading_completion.awaiting_grading_count} awaiting teacher grading`,
              tone: grading_completion.awaiting_grading_count > 0 ? "amber" : "emerald",
            }
          : undefined,
      icon: <ClipboardCheck className="size-4" />,
      onClick: () =>
        onNavigate(
          buildPathWithQuery(routes.teacher.classworks, {
            class_id: classIdNum,
            subject_id: subjectIdNum,
            grading_status: "needs_grading",
          }),
        ),
    },
    {
      id: "avg-graded-score",
      title: "Avg. Graded Assessment Score",
      value: formatPercent(graded_performance.avg_graded_score_percent),
      primaryLine:
        graded_performance.scored_submission_count > 0
          ? `Across ${graded_performance.scored_submission_count} finalized official ${graded_performance.scored_submission_count === 1 ? "submission" : "submissions"}`
          : "No finalized official scores yet",
      secondaryLine: "Official graded work only · excludes Practice",
      icon: <Award className="size-4" />,
      onClick: () =>
        onNavigate(
          buildPathWithQuery(routes.teacher.classworks, {
            class_id: classIdNum,
            subject_id: subjectIdNum,
            graded: "true",
          }),
        ),
    },
    {
      id: "term-passing-rate",
      title: "Term Passing Rate",
      value: formatPercent(term_grades.passing_rate_percent),
      primaryLine:
        term_grades.passing_count != null
          ? `${term_grades.passing_count} of ${term_grades.available_grade_count} graded · Mean ${formatScore(term_grades.current_grade)}`
          : `${term_grades.available_grade_count} of ${term_grades.total_grade_count} grades available`,
      secondaryLine:
        threshold_summary.uniform_passing_threshold != null
          ? `Threshold ${threshold_summary.uniform_passing_threshold} · Grade coverage ${formatPercent(threshold_summary.grade_coverage_percent)} (${threshold_summary.available_grade_count}/${threshold_summary.total_grade_count})`
          : `Per-subject threshold · Grade coverage ${formatPercent(threshold_summary.grade_coverage_percent)} (${threshold_summary.available_grade_count}/${threshold_summary.total_grade_count})`,
      icon: <CheckCircle2 className="size-4" />,
      onClick: () => onNavigate(gradesDestination),
    },
    {
      id: "intervention-resolution",
      title: "Improved-Prediction Resolution Rate",
      value: formatPercent(interventions.improved_prediction_resolution_rate_percent),
      primaryLine: `${interventions.resolved_improved_count} of ${activePlusResolved} active/resolved · ${interventions.candidate_count} ${interventions.candidate_count === 1 ? "candidate" : "candidates"}`,
      secondaryLine:
        interventions.resolved_other_count > 0
          ? `Crossed passing prediction · ${interventions.resolved_other_count} other resolved`
          : "Share of active/resolved crossing passing prediction",
      icon: <ShieldCheck className="size-4" />,
      onClick: () => onNavigate(buildPathWithQuery(routes.teacher.interventions, { view: "resolved" })),
    },
    {
      id: "period-attendance",
      title: "Period Attendance Rate",
      value: formatPercent(period_attendance.rate),
      primaryLine: `${period_attendance.present_count + period_attendance.late_count} of ${period_attendance.record_count} recorded entries`,
      secondaryLine: `${period_attendance.late_count} late · ${period_attendance.absent_count} absent · ${period_attendance.excused_count} excused`,
      icon: <CalendarCheck className="size-4" />,
      onClick: () =>
        onNavigate(
          buildPathWithQuery(routes.teacher.attendance, {
            class_id: classIdNum,
          }),
        ),
    },
  ];

  return (
    <section aria-label="Key performance indicators">
      {/* Persistent-sidebar-aware layout: compact 2x3 on mobile, spacious 3x2 on desktop */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 lg:gap-4">
        {kpiCards.map((card) => (
          <Card
            key={card.id}
            role="button"
            tabIndex={0}
            onClick={card.onClick}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                card.onClick();
              }
            }}
            className="group flex w-full cursor-pointer flex-col justify-between border-2 border-black bg-card p-3 shadow-md transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black sm:p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded border-2 border-black bg-primary text-black sm:size-8">
                  {card.icon}
                </span>
                <h2 className="line-clamp-2 text-xs font-bold leading-snug text-foreground sm:text-sm">
                  {card.title}
                </h2>
              </div>
              <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
            </div>

            <div className="mt-2.5 sm:mt-3">
              <div className="text-2xl font-extrabold tabular-nums tracking-tight text-foreground sm:text-3xl">
                {card.value}
              </div>

              {card.highlightBadge && (
                <div className="mt-1.5">
                  <Badge
                    size="sm"
                    variant={
                      card.highlightBadge.tone === "amber"
                        ? "surface"
                        : card.highlightBadge.tone === "emerald"
                          ? "success"
                          : "outline"
                    }
                    className="text-[11px] font-semibold"
                  >
                    {card.highlightBadge.label}
                  </Badge>
                </div>
              )}

              <p className="mt-1.5 text-[11px] font-medium leading-snug text-foreground/90 sm:text-xs">
                {card.primaryLine}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground sm:text-[11px]">
                {card.secondaryLine}
              </p>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
