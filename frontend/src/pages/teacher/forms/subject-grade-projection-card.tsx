import { Alert } from "@/components/retroui/Alert";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Progress } from "@/components/retroui/Progress";
import type { ClassworkScorePreview, SubjectGradeProjectionResponse } from "@/lib/teacher-interventions-api";

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
const scoreText = (value: number) => Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);

const formatProjectionDifference = (value: number | null) => {
  if (value == null) return "—";
  const rounded = Number(value.toFixed(1));
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  return `${normalized > 0 ? "+" : ""}${normalized.toFixed(1)}%`;
};

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
          <span className="text-lg font-black">Projected Grade</span>
          <Badge variant="outline" size="sm">Calculating…</Badge>
        </div>
        <p className="animate-pulse text-xs text-muted-foreground">
          Recalculating with the selected targets and {capPercentage}% target-score ceiling…
        </p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={shellClass} aria-label="Grade projection card">
        <div className="flex items-center justify-between gap-3">
          <span className="text-lg font-black">Projected Grade</span>
          <Badge variant="outline" size="sm">Unavailable</Badge>
        </div>
        <Alert status="warning" className="rounded! py-2 text-xs">
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
          <span className="text-lg font-black">Projected Grade</span>
          <Badge variant="outline" size="sm">Practice Only</Badge>
        </div>
        <Alert status="info" className="rounded! py-2 text-xs">
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
          <span className="text-lg font-black">Projected Grade</span>
          <Badge variant="outline" size="sm">Remedial Exam</Badge>
        </div>
        <Alert status="info" className="rounded! py-2 text-xs">
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
          <span className="text-lg font-black">Projected Grade</span>
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
          <span className="text-lg font-black">Projected Grade</span>
          <Badge variant="outline" size="sm">Unavailable</Badge>
        </div>
        <Alert status="warning" className="rounded! py-2 text-xs">
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
  const isUnavailable = projection.status === "UNAVAILABLE";
  const isAiWhatIfAvailable = projection.ai_midterm_what_if?.status === "AVAILABLE";
  const hasTargets = selectedTargetIds.length > 0;
  const appliedTargets = projection.target_projections.filter((target) => target.applied);
  const lastTarget = appliedTargets.at(-1) ?? null;
  const aiEstimates = projection.ai_midterm_what_if?.target_estimates ?? [];
  const lastAiEstimate = aiEstimates.at(-1) ?? null;

  const currentGrade = isAuthoritative ? projection.current_subject_grade ?? null : null;
  const projectedGrade = isAuthoritative
    ? hasTargets ? lastTarget?.projected_subject_grade ?? null : currentGrade
    : null;
  const estimatedDifference = isAuthoritative && hasTargets
    ? lastTarget?.possible_grade_improvement ?? null
    : null;
  const aiBaseline = isAiWhatIfAvailable
    ? projection.ai_midterm_what_if.baseline_predicted_term_grade ?? null
    : null;
  const aiProjected = hasTargets ? lastAiEstimate?.hypothetical_predicted_term_grade ?? null : null;
  const aiDifference = hasTargets ? lastAiEstimate?.estimated_difference_from_baseline ?? null : null;
  const passingThreshold = projection.passing_threshold ?? null;
  const reachesThreshold = projectedGrade != null && passingThreshold != null
    ? projectedGrade >= passingThreshold
    : null;

  const currentPosition = currentGrade == null ? 0 : clampGrade(currentGrade);
  const projectedPosition = projectedGrade == null ? currentPosition : clampGrade(projectedGrade);
  const changeStart = Math.min(currentPosition, projectedPosition);
  const changeWidth = Math.abs(projectedPosition - currentPosition);
  const isPositiveChange = projectedPosition >= currentPosition;
  const selectedTargetSet = new Set(selectedTargetIds);
  const projectedScoreBounds = appliedTargets.flatMap((target) => {
    if (
      !selectedTargetSet.has(target.assignment_id) ||
      target.original_score == null ||
      target.max_points == null ||
      target.maximum_hypothetical_effective_score == null ||
      target.possible_score_gain == null
    ) {
      return [];
    }
    return [{
      assignmentId: target.assignment_id,
      title: target.title ?? `Assignment #${target.assignment_id}`,
      originalScore: target.original_score,
      maximumScore: target.maximum_hypothetical_effective_score,
      maxPoints: target.max_points,
      possibleGain: target.possible_score_gain,
    }];
  });
  const rawScoreBounds = rawPreviews
    .filter((preview) => selectedTargetSet.has(preview.assignment_id))
    .map((preview) => ({
      assignmentId: preview.assignment_id,
      title: preview.title ?? `Assignment #${preview.assignment_id}`,
      originalScore: preview.original_score,
      maximumScore: preview.max_adjusted_score,
      maxPoints: preview.max_points,
      possibleGain: preview.possible_gain,
    }));
  const scoreBounds = projectedScoreBounds.length > 0 ? projectedScoreBounds : rawScoreBounds;
  const missingEvidence = Array.from(new Set(
    projection.unavailable_reasons.flatMap((reason) => reason.missing_evidence ?? []),
  ));

  return (
    <Card className={shellClass} aria-label="Grade projection card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-lg font-black">
            {isAuthoritative ? "Projected Subject Grade" : "Classwork Score Adjustment"}
          </span>
          {isAuthoritative && (
            <Badge variant="solid" size="sm">
              {isFinalized ? "Final Grade" : "Authoritative"}
            </Badge>
          )}
        </div>
        <Badge variant="outline" size="sm">{capPercentage}% Target-Score Ceiling</Badge>
      </div>

      {isAuthoritative && (
        <div className="rounded! border-2 border-border bg-background p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center justify-between w-full">
              <span className="text-xl text-foreground">{gradeText(currentGrade)}</span>
              <span className="text-xl text-foreground" aria-hidden="true">→</span>

              <div className="flex flex-row gap-2 items-center">
                <strong className="text-4xl font-black">
                  {hasTargets ? gradeText(projectedGrade) : gradeText(currentGrade)}
                </strong>
                {hasTargets && estimatedDifference != null && (
                  <Badge
                    variant={
                      estimatedDifference > 0
                        ? "success"
                        : estimatedDifference < 0
                          ? "destructive"
                          : "outline"
                    }
                    size="sm"
                  >
                    {formatProjectionDifference(estimatedDifference)}
                  </Badge>
                )}
              </div>
              {reachesThreshold != null && (
                <Badge variant={reachesThreshold ? "success" : "destructive"} size="md" className="self-start whitespace-nowrap sm:self-center">
                  {reachesThreshold
                    ? "Reaches Passing"
                    : "Below Passing"}
                </Badge>
              )}
            </div>
          </div>

          <div className="mt-4">
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
        </div>

      )}
      {isAuthoritative && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <p>
            {isFinalized
              ? "This period grade is finalized. Hypothetical remediation is unavailable."
              : "Authoritative calculation based on official DepEd grading weights and transmutation table using complete academic evidence."}
          </p>
        </div>
      )}
      {isUnavailable && (
        <div className="space-y-3">
          <Alert status="warning" className="rounded! py-2 text-xs">
            <div>
              <p className="font-bold">Overall Grade Preview Unavailable</p>
              <p className="mt-0.5">
                Some required grades have not been recorded yet. You can still create remediation activities, but the overall subject-grade preview is not available.
              </p>
              {missingEvidence.length > 0 && (
                <p className="mt-1"><strong>Missing:</strong> {missingEvidence.join(", ")}.</p>
              )}
            </div>
          </Alert>
          {hasTargets && scoreBounds.length > 0 && (
            <div className="space-y-2" aria-label="Selected classwork score adjustment preview">
              {scoreBounds.map((item) => (
                <div key={item.assignmentId} className="rounded! border-2 border-border bg-background p-3">
                  <p className="truncate text-sm font-bold">{item.title}</p>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                    <div>
                      <p className="text-muted-foreground">Original score</p>
                      <strong className="text-base">{scoreText(item.originalScore)}/{scoreText(item.maxPoints)}</strong>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Maximum target score</p>
                      <strong className="text-base text-success">{scoreText(item.maximumScore)}/{scoreText(item.maxPoints)}</strong>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Maximum possible gain</p>
                      <strong className="text-base">+{scoreText(Math.max(0, item.possibleGain))} pts</strong>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    This is a maximum classwork-score adjustment, not a guaranteed result. The actual graded remediation cannot lower the original score.
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isAiWhatIfAvailable && (
        <div className="space-y-2 border-t-2 border-border pt-3" aria-label="Provisional AI advisory">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold">Provisional AI-Assisted Remediation Estimate</p>
            <Badge variant="surface" size="sm">Not an Official Grade</Badge>
          </div>
          {hasTargets && aiBaseline != null && aiProjected != null && (
            <div className="grid grid-cols-2 gap-2 rounded! border border-border bg-muted/20 p-3 text-center text-xs">
              <div>
                <p className="text-muted-foreground">AI baseline estimate</p>
                <strong className="text-lg">{gradeText(aiBaseline)}</strong>
              </div>
              <div>
                <p className="text-muted-foreground">AI-assisted what-if estimate</p>
                <strong className="text-lg">{gradeText(aiProjected)}</strong>
                {aiDifference != null && (
                  <span className="ml-2 text-muted-foreground">Estimated gain {formatProjectionDifference(aiDifference)}</span>
                )}
              </div>
            </div>
          )}
          <Alert status="info" className="rounded! py-2 text-xs">
            Provisional AI-assisted remediation estimate combining the live AI baseline with the selected classwork&apos;s capped weighted component impact. This is not a raw model prediction or an official or guaranteed subject grade, and cannot reduce the student&apos;s actual grade.
          </Alert>
        </div>
      )}

      {!compact && isAuthoritative && hasTargets && selectedTargetIds.length > 1 && (
        <div className="border-t border-border pt-2">
          <p className="mb-2 text-xs font-bold text-muted-foreground">
            Cumulative Target Sequence ({selectedTargetIds.length} Classworks Selected):
          </p>
          <div className="flex flex-col gap-1.5">
            {appliedTargets.map((step, index) => {
              const grade = step.projected_subject_grade;
              const difference = step.possible_grade_improvement;
              const title = step.title || `Assignment #${step.assignment_id}`;
              return (
                <div key={step.assignment_id} className="flex items-center justify-between rounded! border border-border bg-background px-2 py-1 text-xs">
                  <span className="min-w-0 truncate font-semibold">#{index + 1} {title}</span>
                  <span className="ml-2 shrink-0 text-muted-foreground">
                    Grade <strong className="text-foreground">{gradeText(grade ?? null)}</strong>
                    {difference != null && ` (${formatProjectionDifference(difference)})`}
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
