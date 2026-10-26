import { Info } from "lucide-react";
import { Alert } from "@/components/retroui/Alert";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Progress } from "@/components/retroui/Progress";
import type { AIMidtermTargetEstimate, ClassworkScorePreview, SubjectGradeProjectionResponse, TargetProjection } from "@/lib/teacher-interventions-api";

export interface SubjectGradeProjectionCardProps {
  projection: SubjectGradeProjectionResponse | null;
  loading?: boolean;
  error?: string | null;
  selectedTargetIds?: number[];
  capPercentage?: number | string;
  onRetry?: () => void;
  rawPreviews?: ClassworkScorePreview[];
  className?: string;
  compact?: boolean;
  gradeTreatment?: "PRACTICE_ONLY" | "WRITTEN_WORK" | "PERFORMANCE_TASK" | "EXAMINATION" | null;
}

const clampGrade = (value: number) => Math.min(100, Math.max(0, value));
const gradeText = (value: number | null) => (value == null ? "—" : `${value.toFixed(1)}%`);
const differenceText = (value: number | null) =>
  value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;

export function SubjectGradeProjectionCard({
  projection,
  loading = false,
  error = null,
  selectedTargetIds = [],
  capPercentage = 75,
  onRetry,
  rawPreviews = [],
  className = "",
  compact = false,
  gradeTreatment,
}: SubjectGradeProjectionCardProps) {
  const shellClass = `flex w-full flex-col gap-3 border-2! bg-card p-4 shadow-none ${className}`;

  if (loading) {
    return (
      <Card className={shellClass} aria-label="Grade projection card">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-black uppercase tracking-wide">Projected Grade</span>
          <Badge variant="outline" size="sm">Calculating…</Badge>
        </div>
        <p className="animate-pulse text-xs text-muted-foreground">
          Recalculating the estimate with the selected targets and {capPercentage}% cap…
        </p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={shellClass} aria-label="Grade projection card">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-black uppercase tracking-wide">Projected Grade</span>
          <Badge variant="outline" size="sm">Unavailable</Badge>
        </div>
        <Alert status="warning" className="py-2 text-xs">
          {error}
        </Alert>
        {onRetry && (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={onRetry}>Retry Projection</Button>
          </div>
        )}
      </Card>
    );
  }

  if (gradeTreatment === "PRACTICE_ONLY") {
    return (
      <Card className={shellClass} aria-label="Grade projection card">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-black uppercase tracking-wide">Projected Grade</span>
          <Badge variant="outline" size="sm">Practice Only</Badge>
        </div>
        <Alert status="info" className="py-2 text-xs">
          <div>
            <p className="font-bold">Ungraded Support Treatment</p>
            <p className="mt-0.5">
              This intervention is configured for Ungraded Practice. Student completion is tracked for support and monitoring, but does not alter classwork grades or academic projections.
            </p>
            <p className="mt-1 text-muted-foreground">
              Grade projections apply only when remediating a graded component (Written Work or Performance Task).
            </p>
          </div>
        </Alert>
      </Card>
    );
  }

  if (gradeTreatment === "EXAMINATION") {
    return (
      <Card className={shellClass} aria-label="Grade projection card">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-black uppercase tracking-wide">Projected Grade</span>
          <Badge variant="outline" size="sm">Remedial Exam</Badge>
        </div>
        <Alert status="info" className="py-2 text-xs">
          <div>
            <p className="font-bold">Examination Remediation</p>
            <p className="mt-0.5">
              Subject grade projections apply to Written Work and Performance Task classwork targets. Remedial examination scores directly replace the recorded examination score when higher.
            </p>
          </div>
        </Alert>
      </Card>
    );
  }

  if (!gradeTreatment && !projection) {
    return (
      <Card className={shellClass} aria-label="Grade projection card">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-black uppercase tracking-wide">Projected Grade</span>
          <Badge variant="outline" size="sm">No Treatment</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Select a graded remediation treatment (Written Work or Performance Task) to calculate subject grade projections.
        </p>
      </Card>
    );
  }

  if (!projection) {
    return (
      <Card className={shellClass} aria-label="Grade projection card">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-black uppercase tracking-wide">Projected Grade</span>
          <Badge variant="outline" size="sm">Unavailable</Badge>
        </div>
        <Alert status="warning" className="py-2 text-xs">
          <div>
            <p className="font-bold">Subject grade projection is unavailable for this student.</p>
            <p className="mt-0.5">
              Official grade calculation requires complete examination evidence and valid baseline performance records.
            </p>
          </div>
        </Alert>
        {onRetry && (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={onRetry}>Retry Projection</Button>
          </div>
        )}
      </Card>
    );
  }

  const isFinalized = projection.status === "FINALIZED";
  const isAuthoritative = projection.status === "AVAILABLE" || isFinalized;
  const isAiWhatIf = !isAuthoritative && projection.ai_midterm_what_if?.status === "AVAILABLE";
  const isUnavailable = !isAuthoritative && !isAiWhatIf;
  const hasTargets = selectedTargetIds.length > 0;
  const appliedTargets = projection.target_projections.filter((target) => target.applied);
  const lastTarget = appliedTargets.at(-1) ?? null;
  const aiEstimates = projection.ai_midterm_what_if?.target_estimates ?? [];
  const lastAiEstimate = aiEstimates.at(-1) ?? null;

  const currentGrade = isAuthoritative
    ? projection.current_subject_grade ?? null
    : isAiWhatIf ? projection.ai_midterm_what_if.baseline_predicted_term_grade ?? null : null;
  const projectedGrade = isAuthoritative
    ? hasTargets ? lastTarget?.projected_subject_grade ?? null : currentGrade
    : isAiWhatIf ? hasTargets ? lastAiEstimate?.hypothetical_predicted_term_grade ?? null : currentGrade : null;
  const estimatedDifference = isAuthoritative
    ? hasTargets ? lastTarget?.possible_grade_improvement ?? null : null
    : isAiWhatIf ? hasTargets ? lastAiEstimate?.estimated_difference_from_baseline ?? null : null : null;
  const passingThreshold = projection.passing_threshold ?? null;
  const reachesThreshold = projectedGrade != null && passingThreshold != null
    ? projectedGrade >= passingThreshold
    : null;

  const currentPosition = currentGrade == null ? 0 : clampGrade(currentGrade);
  const projectedPosition = projectedGrade == null ? currentPosition : clampGrade(projectedGrade);
  const changeStart = Math.min(currentPosition, projectedPosition);
  const changeWidth = Math.abs(projectedPosition - currentPosition);
  const isPositiveChange = projectedPosition >= currentPosition;

  return (
    <Card className={shellClass} aria-label="Grade projection card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-black uppercase tracking-wide">Projected Grade</span>
          <Badge variant={isAiWhatIf ? "surface" : isAuthoritative ? "solid" : "outline"} size="sm">
            {isFinalized ? "Final Grade" : isAiWhatIf ? "Provisional AI Estimate" : isAuthoritative ? "Authoritative" : "Unavailable"}
          </Badge>
        </div>
        <Badge variant="outline" size="sm">{capPercentage}% Cap</Badge>
      </div>

      {!isUnavailable && (
        <div className="border-2 border-border bg-background p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-xl text-muted-foreground">{gradeText(currentGrade)}</span>
              <span className="text-xl text-muted-foreground" aria-hidden="true">→</span>
              <strong className="text-4xl font-black leading-none sm:text-5xl">
                {hasTargets ? gradeText(projectedGrade) : "—"}
              </strong>
              {hasTargets && estimatedDifference != null && (
                <span className={`text-lg font-black ${estimatedDifference > 0 ? "text-success" : estimatedDifference < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                  {differenceText(estimatedDifference)}
                </span>
              )}
            </div>
            {reachesThreshold != null && (
              <Badge variant={reachesThreshold ? "success" : "destructive"} size="md" className="self-start whitespace-nowrap sm:self-center">
                {reachesThreshold
                  ? isAiWhatIf ? "Est. Reaches Passing" : "Reaches Passing"
                  : isAiWhatIf ? "Est. Below Passing" : "Below Passing"}
              </Badge>
            )}
          </div>

          <div className="mt-6">
            <div className="relative">
              <Progress
                value={currentPosition}
                aria-label={`Current ${currentPosition.toFixed(1)}%, projected ${projectedPosition.toFixed(1)}%`}
                className="h-5"
                indicatorClassName="border-r-0 bg-muted-foreground/40"
              />
              {hasTargets && changeWidth > 0 && (
                <span
                  aria-hidden="true"
                  className={`absolute bottom-0.5 top-0.5 border-r-2 border-border ${isPositiveChange ? "bg-success" : "bg-destructive"}`}
                  style={{ left: `${changeStart}%`, width: `${changeWidth}%` }}
                />
              )}
              {passingThreshold != null && (
                <span
                  aria-hidden="true"
                  className="absolute -top-2 h-9 w-1 -translate-x-1/2 bg-foreground"
                  style={{ left: `${clampGrade(passingThreshold)}%` }}
                />
              )}
            </div>
            <div className="mt-2 flex items-start justify-between gap-3 text-xs text-muted-foreground">
              <span>Current <strong className="text-foreground">{gradeText(currentGrade)}</strong></span>
              {passingThreshold != null && (
                <span className="text-right">Passing <strong className="text-foreground">{gradeText(passingThreshold)}</strong></span>
              )}
            </div>
          </div>

          <div className="mt-5 flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              {isAiWhatIf
                ? "Provisional AI Estimate: Based on current midterm performance evidence. This is an exploratory prediction and not an official grade or guaranteed result."
                : isFinalized
                  ? "This period grade is finalized. Hypothetical remediation is unavailable."
                  : "Authoritative calculation based on official DepEd grading weights and transmutation table. Based on complete academic evidence."}
            </p>
          </div>
        </div>
      )}

      {isUnavailable && (
        <div className="space-y-2">
          <Alert status="warning" className="py-2 text-xs">
            <div>
              <p className="font-bold">Subject grade projection is unavailable for this student.</p>
              <p className="mt-0.5">
                {projection.unavailable_reasons.length > 0
                  ? projection.unavailable_reasons.map((reason) => reason.message).join(" ")
                  : "Official evidence is incomplete and AI prediction readiness criteria are not met."}
              </p>
            </div>
          </Alert>
          {!compact && rawPreviews.length === 0 && projection.eligible_target_gains.length > 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {projection.eligible_target_gains.map((item) => (
                <div key={item.assignment_id} className="flex items-center justify-between border bg-background p-2 text-xs">
                  <span className="mr-2 truncate font-semibold">{item.title}</span>
                  <span className="shrink-0 font-bold text-success">
                    +{item.possible_score_gain.toFixed(1)} pts ({item.maximum_hypothetical_effective_score.toFixed(1)}/{item.max_points})
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!compact && hasTargets && selectedTargetIds.length > 1 && (
        <div className="border-t border-border pt-2">
          <p className="mb-2 text-xs font-bold text-muted-foreground">
            Cumulative Target Sequence ({selectedTargetIds.length} Classworks Selected):
          </p>
          <div className="flex flex-col gap-1.5">
            {(appliedTargets.length > 0 ? appliedTargets : aiEstimates).map((step, index) => {
              const authoritativeStep = "projected_subject_grade" in step;
              const grade = authoritativeStep ? (step as TargetProjection).projected_subject_grade : (step as AIMidtermTargetEstimate).hypothetical_predicted_term_grade;
              const difference = authoritativeStep ? (step as TargetProjection).possible_grade_improvement : (step as AIMidtermTargetEstimate).estimated_difference_from_baseline;
              const title = authoritativeStep ? (step as TargetProjection).title || `Assignment #${step.assignment_id}` : `Target #${step.assignment_id}`;
              return (
                <div key={step.assignment_id} className="flex items-center justify-between border bg-background px-2 py-1 text-xs">
                  <span className="min-w-0 truncate font-semibold">#{index + 1} {title}</span>
                  <span className="ml-2 shrink-0 text-muted-foreground">
                    {isAiWhatIf ? "Est." : "Grade"} <strong className="text-foreground">{gradeText(grade ?? null)}</strong>
                    {difference != null && ` (${differenceText(difference)})`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

export default SubjectGradeProjectionCard;
