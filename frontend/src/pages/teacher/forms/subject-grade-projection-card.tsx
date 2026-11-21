import { Alert } from "@/components/retroui/Alert";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import {
  formatPassingStatusMessage,
  type ClassworkScorePreview,
  type SubjectGradeProjectionResponse,
} from "@/lib/teacher-interventions-api";

export interface SubjectGradeProjectionCardProps {
  projection: SubjectGradeProjectionResponse | null;
  loading?: boolean;
  error?: string | null;
  selectedTargetIds?: number[];
  capPercentage?: number | string;
  passingThreshold?: number | null;
  onRetry?: () => void;
  rawPreviews?: ClassworkScorePreview[];
  className?: string;
  compact?: boolean;
  gradeTreatment?: "PRACTICE_ONLY" | "WRITTEN_WORK" | "PERFORMANCE_TASK" | "EXAMINATION" | null;
}

const gradeText = (value: number | null) => (value == null ? "—" : value.toFixed(1));
const scoreText = (value: number) => Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);

export function SubjectGradeProjectionCard({
  projection,
  loading = false,
  error = null,
  selectedTargetIds = [],
  capPercentage = 75,
  passingThreshold = null,
  onRetry,
  rawPreviews = [],
  className = "",
  gradeTreatment,
}: SubjectGradeProjectionCardProps) {
  const shellClass = `flex w-full flex-col gap-3 border-2! bg-card p-4 shadow-none ${className}`;
  const isExam = gradeTreatment === "EXAMINATION";

  if (loading) {
    return (
      <Card className={shellClass} aria-label="Remediation preview">
        <div className="flex items-center justify-between gap-3">
          <span className="text-base font-black">Remediation preview</span>
          <Badge variant="outline" size="sm">Calculating…</Badge>
        </div>
        <p className="animate-pulse text-xs text-muted-foreground">
          {isExam
            ? "Updating the remediation preview…"
            : `Updating the preview for the ${capPercentage}% cap…`}
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

  if (!projection) {
    if (isExam) {
      return (
        <Card className={shellClass} aria-label="Remediation preview">
          <p className="text-sm font-bold">Remedial exam</p>
          <p className="text-xs text-muted-foreground">A higher remedial exam score replaces the recorded exam score.</p>
        </Card>
      );
    }
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
  const whatIf = projection.ai_midterm_what_if;
  const whatIfAvailable = whatIf?.status === "AVAILABLE";
  const whatIfUnavailable = whatIf?.status === "UNAVAILABLE";
  const lastAiEstimate = whatIf?.target_estimates.at(-1) ?? null;
  const aiBaseline = whatIfAvailable
    ? (whatIf.baseline_remediation_adjusted_predicted_term_grade ?? whatIf.baseline_predicted_term_grade ?? null)
    : null;
  const aiProjected = hasTargets && whatIfAvailable
    ? (lastAiEstimate?.remediation_adjusted_predicted_term_grade ?? lastAiEstimate?.hypothetical_predicted_term_grade ?? null)
    : null;
  const resolvedPassingThreshold = projection.passing_threshold ?? passingThreshold ?? null;
  const passingStatus = formatPassingStatusMessage(aiProjected, resolvedPassingThreshold);
  const showScoreAdjustment = !isExam && hasTargets && scoreBounds.length > 0;
  const showPrediction = hasTargets && aiBaseline != null && aiProjected != null;
  const showUnavailablePrediction = hasTargets && whatIfUnavailable;

  return (
    <Card className={shellClass} aria-label="Remediation preview">
      {isExam && (
        <div className="space-y-1">
          <p className="text-sm font-bold">Remedial exam</p>
          <p className="text-xs text-muted-foreground">
            A higher remedial exam score replaces the recorded exam score.
          </p>
        </div>
      )}

      {!hasTargets && (
        <p className="text-sm text-muted-foreground">
          {isExam
            ? "Select an examination to see its remediation prediction preview."
            : "Select a classwork to see its score and prediction preview."}
        </p>
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
          className={`${showScoreAdjustment || isExam ? "border-t-2 border-border pt-3" : ""} space-y-2`}
          aria-label="Predicted grade preview"
        >
          <div className="grid grid-cols-2 gap-2 rounded! border-2 border-border bg-background p-3 text-center text-xs">
            <div>
              <p className="text-muted-foreground">Before</p>
              <strong className="text-lg">{gradeText(aiBaseline)}</strong>
            </div>
            <div>
              <p className="text-muted-foreground">After Remediation</p>
              <strong className="text-lg">{gradeText(aiProjected)}</strong>
            </div>
          </div>
          {passingStatus && (
            <p className="text-xs font-semibold text-muted-foreground">
              {passingStatus}
            </p>
          )}
        </section>
      )}

      {showUnavailablePrediction && (
        <section
          className={`${showScoreAdjustment || isExam ? "border-t-2 border-border pt-3" : ""}`}
          aria-label="Predicted grade unavailable"
        >
          <Alert status="warning" className="rounded! py-2 text-xs">
            Prediction preview is currently unavailable for this student.
          </Alert>
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
