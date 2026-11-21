import { ArrowUpRight, ShieldAlert, ShieldCheck } from "lucide-react";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/teacher/button";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import type { TeacherDashboardInterventionAnalytics } from "@/lib/api";
import { formatPercent } from "./format";

interface InterventionAnalyticsCardProps {
  interventions: TeacherDashboardInterventionAnalytics;
  onNavigateView: (view: "candidates" | "active" | "resolved") => void;
}

export function InterventionAnalyticsCard({
  interventions,
  onNavigateView,
}: InterventionAnalyticsCardProps) {
  const {
    candidate_count,
    active_count,
    resolved_improved_count,
    resolved_other_count,
    resolved_total_count,
    total_count,
    activated_count,
    activation_rate_percent,
    improved_prediction_resolution_rate_percent,
    other_resolution_rate_percent,
    practice_assessments,
  } = interventions;

  const activePlusResolved = active_count + resolved_total_count;

  const segments = [
    {
      key: "candidates" as const,
      label: "Candidates",
      count: candidate_count,
      barClass: "bg-neutral-300",
    },
    {
      key: "active" as const,
      label: "Active",
      count: active_count,
      barClass: "bg-primary",
    },
    {
      key: "resolved" as const,
      label: "Resolved (Improved Prediction)",
      count: resolved_improved_count,
      barClass: "bg-emerald-500",
    },
    {
      key: "resolved" as const,
      label: "Resolved (Other)",
      count: resolved_other_count,
      barClass: "bg-black",
    },
  ];

  return (
    <Card className="flex w-full flex-col justify-between border-2 border-black bg-card p-4 shadow-md">
      <div>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-foreground">
              Intervention Analytics
            </h3>
            <p className="text-xs text-muted-foreground">
              Aggregate lifecycle status for the selected academic period
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onNavigateView("active")}
            className="h-8 gap-1 text-xs"
          >
            Open Interventions
            <ArrowUpRight className="size-3.5" />
          </Button>
        </div>

        {total_count === 0 ? (
          <TeacherEmptyState
            compact
            icon={<ShieldCheck className="size-5" />}
            title="No interventions recorded"
            description="No Intervention candidates, active plans, or resolved records exist for this scope and academic period."
          />
        ) : (
          <div className="space-y-3">
            {/* Stacked proportional lifecycle bar */}
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs font-semibold">
                <span>Lifecycle Breakdown ({total_count} total)</span>
                <span className="text-muted-foreground">
                  Activation: {formatPercent(activation_rate_percent)} ({activated_count}/{total_count})
                </span>
              </div>
              <div
                className="flex h-6 w-full overflow-hidden rounded border-2 border-black bg-white"
                role="img"
                aria-label={`Interventions: ${candidate_count} candidates, ${active_count} active, ${resolved_improved_count} resolved via improved prediction, ${resolved_other_count} resolved for other reasons`}
              >
                {segments
                  .filter((seg) => seg.count > 0)
                  .map((seg) => (
                    <button
                      key={seg.label}
                      type="button"
                      title={`${seg.label}: ${seg.count}`}
                      onClick={() => onNavigateView(seg.key)}
                      style={{ width: `${(seg.count / total_count) * 100}%` }}
                      className={`${seg.barClass} h-full border-r border-black last:border-r-0 transition-opacity hover:opacity-85`}
                    />
                  ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                {segments.map((seg) => (
                  <button
                    key={seg.label}
                    type="button"
                    onClick={() => onNavigateView(seg.key)}
                    className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline"
                  >
                    <span
                      className={`inline-block size-2.5 rounded-sm border border-black ${seg.barClass}`}
                    />
                    {seg.label}: <strong className="tabular-nums">{seg.count}</strong>
                  </button>
                ))}
              </div>
            </div>

            {/* Defensible rate breakdown */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded border-2 border-black bg-background p-2.5">
                <div className="text-[11px] font-semibold text-muted-foreground">
                  Improved-Prediction Resolution Rate
                </div>
                <div className="mt-1 text-xl font-extrabold tabular-nums">
                  {formatPercent(improved_prediction_resolution_rate_percent)}
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {resolved_improved_count} of {activePlusResolved} active + resolved crossed
                  subject threshold (excludes {candidate_count} unactivated{" "}
                  {candidate_count === 1 ? "candidate" : "candidates"}).
                </p>
              </div>

              <div className="rounded border-2 border-black bg-background p-2.5">
                <div className="text-[11px] font-semibold text-muted-foreground">
                  Other Resolution Reasons
                </div>
                <div className="mt-1 text-xl font-extrabold tabular-nums">
                  {formatPercent(other_resolution_rate_percent)}
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {resolved_other_count} of {activePlusResolved} active + resolved closed for
                  non-prediction reasons.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Clearly separated ungraded Practice Assessments subsection */}
      <div className="mt-4 rounded border-2 border-dashed border-black bg-muted/35 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <ShieldAlert className="size-4 shrink-0" />
            Intervention Practice Assessments
          </div>
          <Badge variant="outline" size="sm" className="bg-white text-[10px] font-bold">
            Ungraded · Excluded from Official Grades
          </Badge>
        </div>

        {practice_assessments.published_count === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No published Intervention Practice Assessments in the selected scope and period.
          </p>
        ) : (
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            <div className="rounded border border-black/60 bg-white p-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Published
              </div>
              <div className="mt-0.5 text-base font-extrabold tabular-nums">
                {practice_assessments.published_count}
              </div>
              <div className="text-[10px] text-muted-foreground">assessments</div>
            </div>

            <div className="rounded border border-black/60 bg-white p-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Attempt Rate
              </div>
              <div className="mt-0.5 text-base font-extrabold tabular-nums">
                {formatPercent(practice_assessments.attempt_participation_rate_percent)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {practice_assessments.attempted_count}/{practice_assessments.published_count} published
              </div>
            </div>

            <div className="rounded border border-black/60 bg-white p-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Attempted Passed
              </div>
              <div className="mt-0.5 text-base font-extrabold tabular-nums">
                {formatPercent(practice_assessments.attempted_pass_rate_percent)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {practice_assessments.passed_count}/{practice_assessments.attempted_count} attempted
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
