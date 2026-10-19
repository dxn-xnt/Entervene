import { Dialog } from "@/components/retroui/Dialog";
import { Skeleton } from "@/components/retroui/Skeleton";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { Alert } from "@/components/retroui/Alert";
import { Badge } from "@/components/retroui/Badge";
import { Accordion } from "@/components/retroui/Accordion";
import InterventionSupportMaterials from "../intervention-support-materials";
import type {
  DiagnosisSnapshot,
  TeacherInterventionDetail,
  TeacherInterventionSummary,
  TeacherResolvedInterventionDetail,
} from "@/lib/teacher-interventions-api";

const label = (value: string) =>
  value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const date = (value: string) =>
  new Date(value).toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });

const percent = (value: number | null | undefined) =>
  value == null ? "Unavailable" : `${value.toFixed(1)}%`;

const strongestEvidence = (diagnosis: DiagnosisSnapshot) => {
  const scored = diagnosis.lowest_supported_competencies ?? [];
  if (
    scored.some((item) =>
      item.supporting_scores.some(
        (score) =>
          score.source_type === "QUIZ_QUESTION" &&
          score.score != null &&
          score.possible_score != null &&
          score.score < score.possible_score
      )
    )
  ) {
    return "Scored question-level competency evidence";
  }
  if (scored.some((item) => item.percent < 100)) {
    return "Scored whole-activity competency evidence";
  }
  if (
    (diagnosis.manual_assessment_coverage ?? []).some(
      (item) => item.in_weakest_supported_component && item.percent < 100
    )
  ) {
    return "Assessment coverage only · competencies are unranked";
  }
  return "Component-level evidence only · no specific competency identified";
};

export interface InterventionModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedKind: "candidate" | "active" | "resolved";
  detail: TeacherInterventionDetail | TeacherResolvedInterventionDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  actionError: string | null;
  activating: boolean;
  reviewStale: boolean;
  onActivate: () => void | Promise<void>;
  previousResolved?: TeacherInterventionSummary;
  newerActive?: TeacherInterventionSummary;
}

export default function InterventionModal({
  isOpen,
  onClose,
  selectedKind,
  detail,
  detailLoading,
  detailError,
  actionError,
  activating,
  reviewStale,
  onActivate,
  previousResolved,
  newerActive,
}: InterventionModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content
        size="xl"
        className="max-h-[90vh] flex flex-col p-0 overflow-hidden"
      >
        <Dialog.Header className="">
          <Dialog.Title className="text-xl font-bold">
            {selectedKind === "resolved"
              ? "Resolved Intervention"
              : selectedKind === "active"
                ? "Active Intervention"
                : "Candidate Review"}
          </Dialog.Title>
        </Dialog.Header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {detailLoading ? (
            <div
              aria-label={
                selectedKind === "resolved"
                  ? "Loading resolved detail"
                  : selectedKind === "active"
                    ? "Loading active detail"
                    : "Loading candidate detail"
              }
              className="space-y-3"
            >
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : detailError ? (
            <Alert status="error">{detailError}</Alert>
          ) : (
            detail && (
              <div className="space-y-5">
                {detail.status === "RESOLVED" ? (
                  (() => {
                    const resolved = detail as TeacherResolvedInterventionDetail;
                    return (
                      <>
                        <Card className="space-y-3 border-2 border-emerald-600 bg-emerald-50 dark:bg-emerald-950/20">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                            <div>
                              <h3 className="font-bold text-base">
                                {newerActive
                                  ? "Previous intervention cycle"
                                  : "Resolved intervention cycle"}
                              </h3>
                              <p className="text-sm text-muted-foreground">
                                {resolved.student_name} · {resolved.subject_name} ·{" "}
                                {resolved.class_name}
                              </p>
                            </div>
                            <Badge variant="success" size="sm">Resolved</Badge>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                            <p>
                              Resolved:{" "}
                              <strong>
                                {resolved.resolved_at
                                  ? date(resolved.resolved_at)
                                  : "Unavailable"}
                              </strong>
                            </p>
                            <p>
                              Reason:{" "}
                              <strong>
                                {label(resolved.resolution_reason || "Unavailable")}
                              </strong>
                            </p>
                            <p>
                              Trigger projection:{" "}
                              <strong>
                                {resolved.triggering_predicted_grade.toFixed(2)}
                              </strong>
                            </p>
                            <p>
                              Projection at resolution:{" "}
                              <strong>
                                {resolved.resolution_projection?.toFixed(2) ??
                                  "Unavailable"}
                              </strong>
                            </p>
                          </div>

                          <p className="text-xs text-muted-foreground">
                            This resolution describes this past cycle, not the
                            student's current prediction.
                          </p>
                          {newerActive && (
                            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                              A later below-threshold prediction opened a new
                              active support cycle (trigger{" "}
                              {newerActive.triggering_predicted_grade.toFixed(2)}).
                            </p>
                          )}
                        </Card>

                        <Card className="w-full space-y-3">
                          <h3 className="font-bold text-base">Targeted support history</h3>
                          {resolved.targeted_activities.length ? (
                            <div className="space-y-2">
                              {resolved.targeted_activities.map((activity) => (
                                <div
                                  key={activity.assignment_id}
                                  className="rounded border-2 border-border p-3 text-sm space-y-1.5 bg-card"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-semibold">{activity.title}</span>
                                    <Badge
                                      variant={activity.submission_status === "graded" ? "success" : "default"}
                                      size="sm"
                                    >
                                      {activity.submission_status === "graded"
                                        ? "Completed"
                                        : label(
                                          activity.submission_status ||
                                          "Not submitted"
                                        )}
                                    </Badge>
                                  </div>
                                  {activity.grade != null && activity.total_points != null && (
                                    <p className="text-xs text-muted-foreground">
                                      Score: <strong>{activity.grade}/{activity.total_points}</strong>
                                    </p>
                                  )}
                                  {activity.original_assignment_id && (
                                    <div className="text-xs text-muted-foreground pt-1 border-t border-border flex flex-wrap gap-x-3 gap-y-0.5">
                                      <span>
                                        Original: {activity.original_title} ·{" "}
                                        {label(activity.exam_subtype || "Examination")}
                                      </span>
                                      <span>
                                        Original: {activity.original_grade ?? "—"}/{activity.total_points ?? "—"}
                                      </span>
                                      <span>
                                        Remedial: {activity.grade ?? "Pending"}/{activity.total_points ?? "—"}
                                      </span>
                                      <span>
                                        Effective: <strong>{activity.effective_grade ?? "—"}/{activity.total_points ?? "—"}</strong>
                                      </span>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">No targeted activity was recorded.</p>
                          )}
                        </Card>

                        {resolved.sent_reviewer && (
                          <Card className="w-full space-y-2">
                            <div className="flex items-center justify-between border-b border-border pb-1.5">
                              <h3 className="font-bold text-base">Sent Reviewer</h3>
                              <Badge variant="outline" size="sm">Reviewer</Badge>
                            </div>
                            <p className="font-semibold text-sm">{resolved.sent_reviewer.title}</p>
                            <p className="text-sm text-muted-foreground">{resolved.sent_reviewer.introduction}</p>
                            <div className="rounded border-2 border-border bg-muted/50 p-3 text-xs font-mono whitespace-pre-wrap">
                              {resolved.sent_reviewer.body}
                            </div>
                          </Card>
                        )}
                      </>
                    );
                  })()
                ) : detail.status === "ACTIVE" ? (
                  <>
                    {previousResolved && (
                      <Card className="space-y-2 border-2 border-border bg-yellow-50 dark:bg-yellow-950/20">
                        <div className="flex items-center justify-between">
                          <h3 className="font-bold text-base">Current support cycle</h3>
                          <Badge variant="surface" size="sm">Active</Badge>
                        </div>
                        <p className="text-sm">
                          A new below-threshold prediction opened this cycle after
                          the previous Intervention resolved on{" "}
                          <strong>{date(previousResolved.resolved_at!)}</strong>. That resolution
                          is past history.
                        </p>
                      </Card>
                    )}
                    <InterventionSupportMaterials
                      key={detail.intervention_id}
                      detail={detail}
                    />
                  </>
                ) : (
                  <>
                    <Card className="w-full space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                        <div>
                          <h2 className="text-lg font-bold">
                            {detail.student_name}
                          </h2>
                          <p className="text-sm text-muted-foreground">
                            {detail.subject_name} · {detail.class_name} · {detail.academic_period_name}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="surface" size="sm">{label(detail.status)}</Badge>
                          <Badge
                            variant={detail.triggering_intervention_level === "HIGH_RISK" ? "destructive" : "secondary"}
                            size="sm"
                          >
                            {label(detail.triggering_intervention_level)}
                          </Badge>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                        <p>
                          Triggering projected grade:{" "}
                          <strong>{detail.triggering_predicted_grade.toFixed(2)}</strong>
                        </p>
                        <p>
                          Candidate created: <strong>{date(detail.created_at)}</strong>
                        </p>
                        <p className="text-xs text-muted-foreground col-span-full">
                          Original source prediction #{detail.source_prediction_id},
                          revision {detail.source_prediction_revision}
                        </p>
                      </div>
                    </Card>

                    <Card className="w-full space-y-3">
                      <h3 className="text-base font-bold">Why support was started</h3>
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="text-muted-foreground text-xs uppercase font-bold block mb-1">
                            Weakest supported components
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {(detail.diagnosis_snapshot.weakest_supported_components ?? []).length ? (
                              detail.diagnosis_snapshot.weakest_supported_components?.map((comp) => (
                                <Badge key={comp} variant="outline" size="sm">
                                  {label(comp)}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-muted-foreground text-xs">Unavailable</span>
                            )}
                          </div>
                        </div>
                        <p className="pt-1">
                          Strongest available evidence:{" "}
                          <strong>
                            {strongestEvidence(detail.diagnosis_snapshot)}
                          </strong>
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1 text-xs">
                          <Badge variant="surface" size="sm">
                            {(detail.diagnosis_snapshot.lowest_supported_competencies ?? []).length} scored competency targets
                          </Badge>
                          <Badge variant="outline" size="sm">
                            {(detail.diagnosis_snapshot.manual_assessment_coverage ?? []).length} assessment coverage items
                          </Badge>
                        </div>
                      </div>
                    </Card>
                  </>
                )}

                <Accordion className="w-full">
                  <Accordion.Item
                    value="frozen-evidence"
                    className="overflow-hidden rounded border-2 border-border bg-card shadow-sm"
                  >
                    <Accordion.Header className="items-center px-4 py-3 bg-card font-bold text-sm">
                      View full frozen evidence
                    </Accordion.Header>
                    <Accordion.Content className="space-y-4 p-4 border-t-2 border-border bg-background">
                      <section className="space-y-2">
                        <h3 className="text-base font-bold">
                          Frozen academic diagnosis
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-muted-foreground">
                          <p>
                            Source prediction #{detail.source_prediction_id}, revision {detail.source_prediction_revision}
                          </p>
                          {detail.activated_by_staff_id && (
                            <p>Activated by staff {detail.activated_by_staff_id}</p>
                          )}
                          <p className="col-span-full">
                            Evidence cutoff:{" "}
                            <strong>
                              {detail.diagnosis_snapshot.evidence_cutoff_at
                                ? date(detail.diagnosis_snapshot.evidence_cutoff_at)
                                : "Unavailable"}
                            </strong>
                          </p>
                        </div>

                        <div className="space-y-1 pt-2">
                          <span className="text-xs font-bold uppercase text-muted-foreground block mb-1">
                            Components evidence
                          </span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {Object.entries(
                              detail.diagnosis_snapshot.components ?? {}
                            ).map(([name, component]) => (
                              <Card key={name} className="flex items-center justify-between p-2.5">
                                <span className="font-semibold text-sm">{label(name)}</span>
                                <Badge
                                  variant={component.evidence_state === "AVAILABLE" ? "surface" : "default"}
                                  size="sm"
                                >
                                  {component.evidence_state === "AVAILABLE"
                                    ? percent(component.percent)
                                    : "Unavailable"}
                                </Badge>
                              </Card>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1.5 pt-2">
                          <h4 className="font-bold text-sm">Supporting activities</h4>
                          {(detail.diagnosis_snapshot.supporting_activities ?? []).length ? (
                            <div className="space-y-1.5">
                              {detail.diagnosis_snapshot.supporting_activities?.map((activity) => (
                                <Card key={activity.classwork_id} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
                                  <div>
                                    <span className="font-semibold text-sm">{activity.title}</span>
                                    <span className="ml-2">
                                      <Badge variant="outline" size="sm">
                                        {label(activity.component)}
                                      </Badge>
                                    </span>
                                  </div>
                                  <Badge variant="surface" size="sm">
                                    {activity.score}/{activity.possible_score} ({percent(activity.percent)})
                                  </Badge>
                                </Card>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">No scored activity detail in the saved diagnosis.</p>
                          )}
                        </div>
                      </section>

                      <section className="space-y-2 pt-2 border-t border-border">
                        <h3 className="text-base font-bold">
                          Scored competency evidence
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Ranked only when a competency has its own traceable scored evidence.
                        </p>
                        {(detail.diagnosis_snapshot.lowest_supported_competencies ?? []).length ? (
                          <div className="space-y-2">
                            {detail.diagnosis_snapshot.lowest_supported_competencies?.map((item) => (
                              <Card key={item.competency_id} className="space-y-2 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="secondary" size="sm">{item.competency_code}</Badge>
                                    <span className="font-semibold text-sm">{item.competency_statement}</span>
                                  </div>
                                  <Badge variant="surface" size="sm">
                                    {item.score}/{item.possible_score} ({percent(item.percent)})
                                  </Badge>
                                </div>
                                {item.supporting_scores.map((score, index) => (
                                  <div
                                    key={`${score.quiz_question_id ?? score.source_type}-${index}`}
                                    className="text-xs text-muted-foreground flex flex-wrap gap-1.5 pt-1.5 border-t border-border"
                                  >
                                    <Badge variant="outline" size="sm">
                                      {score.source_type === "QUIZ_QUESTION"
                                        ? `Question #${score.quiz_question_id ?? "unknown"}`
                                        : "Activity score"}
                                    </Badge>
                                    <span>
                                      {score.activity_title}
                                      {score.lesson_title ? ` · ${score.lesson_title}` : ""}
                                    </span>
                                    {score.score != null && score.possible_score != null && (
                                      <span className="font-semibold">
                                        {score.score}/{score.possible_score}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </Card>
                            ))}
                          </div>
                        ) : (
                          <Alert status="info">
                            No specific competency could be identified from scored evidence.
                          </Alert>
                        )}
                      </section>

                      <section className="space-y-2 pt-2 border-t border-border">
                        <h3 className="text-base font-bold">
                          Manual assessment coverage for teacher review
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          A total assessment score shows performance on the assessment. It does not score each covered competency separately or rank them against one another.
                        </p>
                        {(detail.diagnosis_snapshot.manual_assessment_coverage ?? []).length ? (
                          <div className="space-y-2">
                            {detail.diagnosis_snapshot.manual_assessment_coverage?.map((assessment) => (
                              <Card key={assessment.classwork_id} className="space-y-1.5 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-sm">{assessment.title}</span>
                                    <Badge variant="outline" size="sm">{label(assessment.component)}</Badge>
                                  </div>
                                  <Badge variant="surface" size="sm">
                                    {assessment.score}/{assessment.possible_score} ({percent(assessment.percent)})
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Covered lessons: {assessment.covered_lessons.map((lesson) => lesson.title).join(", ") || "None linked"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Covered competencies: {assessment.covered_competencies.map((item) => `${item.competency_code}: ${item.competency_statement}`).join("; ") || "None linked"}
                                </p>
                              </Card>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            No dated manual assessment coverage was available at the evidence cutoff.
                          </p>
                        )}
                        {(detail.diagnosis_snapshot.covered_competencies_for_teacher_review ?? []).length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            Covered competencies in weak components require teacher review; they are unranked because the assessment has one shared total score.
                          </p>
                        )}
                      </section>
                    </Accordion.Content>
                  </Accordion.Item>
                </Accordion>

                {actionError && <Alert status="error">{actionError}</Alert>}

                {selectedKind === "candidate" && detail.status === "CANDIDATE" && (
                  <Card className="w-full space-y-2 border-2 border-primary/40 bg-primary/10">
                    <div className="flex items-center gap-2">
                      <Badge variant="surface" size="sm">Action</Badge>
                      <span className="font-semibold text-sm">Confirmation Required</span>
                    </div>
                    <p className="text-sm">
                      Approve an Intervention for{" "}
                      <strong>{detail.student_name}</strong> in{" "}
                      <strong>{detail.subject_name}</strong>? Current prediction
                      evidence and teaching scope will be checked again.
                    </p>
                  </Card>
                )}
              </div>
            )
          )}
        </div>

        <Dialog.Footer className="mt-0">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={activating}
          >
            Close
          </Button>
          {selectedKind === "candidate" && detail?.status === "CANDIDATE" && (
            <Button
              disabled={activating || reviewStale}
              onClick={() => void onActivate()}
            >
              {activating
                ? "Checking and approving..."
                : "Approve Intervention"}
            </Button>
          )}
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}

export { InterventionModal };
