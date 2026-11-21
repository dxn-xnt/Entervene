import { Alert } from "@/components/retroui/Alert";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
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

const gradeText = (value: number | null) => (value == null ? "—" : `${value.toFixed(1)}%`);
const scoreText = (value: number) => Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);

export function SubjectGradeProjectionCard({
  projection,
  loading = false,
  error = null,
  selectedTargetIds = [],
  capPercentage = 75,
  onRetry,
  rawPreviews = [],
  className = "",
  gradeTreatment,
}: SubjectGradeProjectionCardProps) {
  const shellClass = `flex w-full flex-col gap-3 border-2! bg-card p-4 shadow-none ${className}`;

  if (loading) {
    return (
      <Card className={shellClass} aria-label="Remediation preview">
        <div className="flex items-center justify-between gap-3">
          <span className="text-base font-black">Remediation preview</span>
          <Badge variant="outline" size="sm">Calculating…</Badge>
        </div>
        <p className="animate-pulse text-xs text-muted-foreground">
          Updating the preview for the {capPercentage}% cap…
        </p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={shellClass} aria-label="Remediation preview">
        <Alert status="warning" className="rounded! py-2 text-xs">{error}</Alert>
        {onRetry && (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={onRetry}>Retry Preview</Button>
          </div>
        )}
      </Card>
    );
  }

  if (gradeTreatment === "PRACTICE_ONLY") {
    return (
      <Card className={shellClass} aria-label="Remediation preview">
        <p className="text-sm font-bold">Practice only</p>
        <p className="text-xs text-muted-foreground">This activity does not change the student's classwork score.</p>
      </Card>
    );
  }

  if (gradeTreatment === "EXAMINATION") {
    return (
      <Card className={shellClass} aria-label="Remediation preview">
        <p className="text-sm font-bold">Remedial exam</p>
        <p className="text-xs text-muted-foreground">A higher remedial exam score replaces the recorded exam score.</p>
      </Card>
    );
  }

  if (!projection) {
    return (
      <Card className={shellClass} aria-label="Remediation preview">
        <p className="text-sm text-muted-foreground">
          {gradeTreatment
            ? "Preview unavailable for this student."
            : "Select a graded remediation treatment to see a preview."}
        </p>
        {gradeTreatment && onRetry && (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={onRetry}>Retry Preview</Button>
          </div>
        )}
      </Card>
    );
  }

  const hasTargets = selectedTargetIds.length > 0;
  const selectedTargetSet = new Set(selectedTargetIds);
  const appliedTargets = projection.target_projections.filter((target) => target.applied);
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
  const lastAiEstimate = projection.ai_midterm_what_if?.target_estimates.at(-1) ?? null;
  const aiBaseline = projection.ai_midterm_what_if?.status === "AVAILABLE"
    ? projection.ai_midterm_what_if.baseline_predicted_term_grade ?? null
    : null;
  const aiProjected = hasTargets ? lastAiEstimate?.hypothetical_predicted_term_grade ?? null : null;
  const showScoreAdjustment = hasTargets && scoreBounds.length > 0;
  const showPrediction = hasTargets && aiBaseline != null && aiProjected != null;

  return (
    <Card className={shellClass} aria-label="Remediation preview">
      {!hasTargets && (
        <p className="text-sm text-muted-foreground">Select a classwork to see its score and AI prediction preview.</p>
      )}

      {showScoreAdjustment && (
        <section className="space-y-2" aria-label="Classwork score adjustment">
          <h3 className="text-base font-black">Classwork score adjustment</h3>
          {scoreBounds.map((item) => (
            <div key={item.assignmentId} className="rounded! border-2 border-border bg-primary p-3">
              <p className="truncate text-sm font-bold">{item.title}</p>
              <div className="mt-2 grid grid-cols-3 gap-2 rounded! border-2 border-border bg-background p-2 text-center text-xs">
                <div>
                  <p className="text-muted-foreground">Original score</p>
                  <strong className="text-base">{scoreText(item.originalScore)}/{scoreText(item.maxPoints)}</strong>
                </div>
                <div>
                  <p className="text-muted-foreground">Max score after remediation</p>
                  <strong className="text-base">{scoreText(item.maximumScore)}/{scoreText(item.maxPoints)}</strong>
                </div>
                <div>
                  <p className="text-muted-foreground">Possible gain</p>
                  <strong className="text-base">+{scoreText(Math.max(0, item.possibleGain))} pts</strong>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {showPrediction && (
        <section
          className={`${showScoreAdjustment ? "border-t-2 border-border pt-3" : ""} space-y-2`}
          aria-label="AI prediction comparison"
        >
          <h3 className="text-base font-black">AI prediction</h3>
          <div className="grid grid-cols-2 gap-2 rounded! border-2 border-border bg-background p-3 text-center text-xs">
            <div>
              <p className="text-muted-foreground">Current AI prediction</p>
              <strong className="text-lg">{gradeText(aiBaseline)}</strong>
            </div>
            <div>
              <p className="text-muted-foreground">Predicted AI result at max score</p>
              <strong className="text-lg">{gradeText(aiProjected)}</strong>
            </div>
          </div>
        </section>
      )}

      {(showScoreAdjustment || showPrediction) && (
        <p className="border-t border-border pt-2 text-xs text-muted-foreground">
          Preview only. Final result still depends on the student's actual remediation score.
        </p>
      )}
    </Card>
  );
}

export default SubjectGradeProjectionCard;
