import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/retroui/Card";
import { Table } from "@/components/retroui/Table";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Alert } from "@/components/retroui/Alert";
import { EmptyStateCard } from "@/components/empty-state-card";
import InterventionSupportMaterials from "./intervention-support-materials";
import {
  activateTeacherCandidate, getTeacherActive, getTeacherCandidate, getTeacherResolved, InterventionApiError,
  listTeacherActive, listTeacherCandidates, listTeacherResolved,
  type DiagnosisSnapshot, type TeacherInterventionDetail, type TeacherInterventionSummary, type TeacherResolvedInterventionDetail,
} from "@/lib/teacher-interventions-api";

const label = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
const date = (value: string) => new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
const percent = (value: number | null | undefined) => value == null ? "Unavailable" : `${value.toFixed(1)}%`;
const sameScope = (left: TeacherInterventionSummary, right: TeacherInterventionSummary) =>
  left.student_id === right.student_id && left.class_id === right.class_id
  && left.subject_id === right.subject_id && left.academic_period_id === right.academic_period_id;
const reason = (candidate: TeacherInterventionSummary) => {
  const weakest = candidate.diagnosis_summary.weakest_supported_components ?? [];
  return weakest.length ? `Weakest supported: ${weakest.map(label).join(", ")}` : "Component detail unavailable in saved diagnosis";
};
const strongestEvidence = (diagnosis: DiagnosisSnapshot) => {
  const scored = diagnosis.lowest_supported_competencies ?? [];
  if (scored.some((item) => item.supporting_scores.some((score) => score.source_type === "QUIZ_QUESTION" && score.score != null && score.possible_score != null && score.score < score.possible_score))) return "Scored question-level competency evidence";
  if (scored.some((item) => item.percent < 100)) return "Scored whole-activity competency evidence";
  if ((diagnosis.manual_assessment_coverage ?? []).some((item) => item.in_weakest_supported_component && item.percent < 100)) return "Assessment coverage only · competencies are unranked";
  return "Component-level evidence only · no specific competency identified";
};

export default function TeacherInterventions() {
  const [params, setParams] = useSearchParams();
  const candidateParam = params.get("candidate");
  const activeParam = params.get("active");
  const resolvedParam = params.get("resolved");
  const selectedKind = resolvedParam ? "resolved" : activeParam ? "active" : "candidate";
  const selectedParam = resolvedParam || activeParam || candidateParam;
  const selectedId = selectedParam && /^\d+$/.test(selectedParam) ? Number(selectedParam) : null;
  const view = selectedKind !== "candidate" ? selectedKind : params.get("view") === "resolved" ? "resolved" : params.get("view") === "active" ? "active" : "candidate";
  const activeView = view === "active";
  const resolvedView = view === "resolved";
  const [items, setItems] = useState<TeacherInterventionSummary[]>([]);
  const [activeItems, setActiveItems] = useState<TeacherInterventionSummary[]>([]);
  const [resolvedItems, setResolvedItems] = useState<TeacherInterventionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLoading, setActiveLoading] = useState(true);
  const [resolvedLoading, setResolvedLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [resolvedError, setResolvedError] = useState<string | null>(null);
  const [detail, setDetail] = useState<TeacherInterventionDetail | TeacherResolvedInterventionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [reviewStale, setReviewStale] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setListError(null);
    try { setItems((await listTeacherCandidates()).items); }
    catch (error) { setListError(error instanceof Error ? error.message : "Unable to load candidates."); }
    finally { setLoading(false); }
  };

  const refreshActive = async () => {
    setActiveLoading(true);
    setActiveError(null);
    try { setActiveItems((await listTeacherActive()).items); }
    catch (error) { setActiveError(error instanceof Error ? error.message : "Unable to load active interventions."); }
    finally { setActiveLoading(false); }
  };

  const refreshResolved = async () => {
    setResolvedLoading(true);
    setResolvedError(null);
    try { setResolvedItems((await listTeacherResolved()).items); }
    catch (error) { setResolvedError(error instanceof Error ? error.message : "Unable to load resolved interventions."); }
    finally { setResolvedLoading(false); }
  };

  useEffect(() => { void refresh(); void refreshActive(); void refreshResolved(); }, []);
  useEffect(() => {
    if (selectedId === null) { setDetail(null); return; }
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) { setDetail(null); setDetailLoading(true); setDetailError(null); setActionError(null); setReviewStale(false); } });
    (selectedKind === "resolved" ? getTeacherResolved(selectedId) : selectedKind === "active" ? getTeacherActive(selectedId) : getTeacherCandidate(selectedId))
      .then((result) => { if (!cancelled) setDetail(result); })
      .catch((error: unknown) => { if (!cancelled) setDetailError(error instanceof Error ? error.message : "Unable to load intervention."); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, selectedKind]);

  const close = () => { const next = new URLSearchParams(params); next.delete("candidate"); next.delete("active"); next.delete("resolved"); setParams(next); };
  const open = (id: number) => { const next = new URLSearchParams(params); next.set(view, String(id)); setParams(next); };
  const selectView = (nextView: "candidate" | "active" | "resolved") => {
    const next = new URLSearchParams(params);
    next.delete("candidate"); next.delete("active"); next.delete("resolved");
    if (nextView === "candidate") next.delete("view"); else next.set("view", nextView);
    setParams(next);
    if (nextView === "resolved") void refreshResolved();
  };
  const activate = async () => {
    if (!detail || activating || reviewStale) return;
    setActivating(true);
    setActionError(null);
    try {
      const active = await activateTeacherCandidate(detail.intervention_id);
      setNotice(`Intervention approved for ${active.student_name} in ${active.subject_name}.`);
      close();
      await refresh();
      await refreshActive();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to approve intervention. Please try again.";
      if (error instanceof InterventionApiError && error.status === 409) {
        setReviewStale(true);
        setActionError(/improved|at least 85/i.test(message) ? "The current prediction improved. This candidate can no longer be approved. Refresh the list to see its current state."
          : /evidence|ready|unavailable|invalid/i.test(message) ? "Current prediction evidence is insufficient or unavailable. Approval was not completed."
          : `Candidate state changed: ${message}`);
        void refresh(); void refreshActive();
      } else if (error instanceof InterventionApiError && (error.status === 401 || error.status === 403)) {
        setActionError("You no longer have teaching access to this candidate.");
      } else { setActionError(message); }
    } finally { setActivating(false); }
  };
  const sorted = [...(resolvedView ? resolvedItems : activeView ? activeItems : items)].sort((a, b) => resolvedView
    ? (b.resolved_at || "").localeCompare(a.resolved_at || "")
    : activeView ? (b.activated_at || "").localeCompare(a.activated_at || "")
    : (a.triggering_intervention_level === "HIGH_RISK" ? 0 : 1) - (b.triggering_intervention_level === "HIGH_RISK" ? 0 : 1) || b.created_at.localeCompare(a.created_at));
  const showingLoading = resolvedView ? resolvedLoading : activeView ? activeLoading : loading;
  const showingError = resolvedView ? resolvedError : activeView ? activeError : listError;
  const previousResolved = detail?.status === "ACTIVE" ? resolvedItems.find((row) =>
    sameScope(row, detail) && row.resolved_at && Date.parse(row.resolved_at) < Date.parse(detail.activated_at || detail.created_at)) : undefined;
  const newerActive = detail?.status === "RESOLVED" && detail.resolved_at ? activeItems.find((row) =>
    sameScope(row, detail) && row.activated_at && Date.parse(row.activated_at) > Date.parse(detail.resolved_at!)) : undefined;

  return <AppLayout><div className="flex min-w-0 flex-1 flex-col">
    <header className="flex items-center gap-2 bg-background px-3 py-3 sm:px-4 sm:py-4 md:px-6"><SidebarTrigger className="shrink-0 md:hidden" /><h1 className="text-xl font-bold sm:text-2xl md:text-4xl">Interventions</h1></header>
    <main className="min-w-0 space-y-4 border-t-2 border-border px-3 py-4 sm:px-4 md:px-6">
      <div role="tablist" aria-label="Intervention status" className="flex gap-2">
        <Button role="tab" aria-selected={view === "candidate"} variant={view === "candidate" ? "default" : "outline"} onClick={() => selectView("candidate")}>Candidates</Button>
        <Button role="tab" aria-selected={activeView} variant={activeView ? "default" : "outline"} onClick={() => selectView("active")}>Active</Button>
        <Button role="tab" aria-selected={resolvedView} variant={resolvedView ? "default" : "outline"} onClick={() => selectView("resolved")}>Resolved</Button>
      </div>
      <p className="text-sm text-muted-foreground">{resolvedView ? "Review completed support and saved resolution details. This history is read-only." : activeView ? "Review active interventions and their original saved evidence." : "Review the saved evidence before approving a student intervention."}</p>
      {notice && <Alert status="success">{notice}</Alert>}
      {showingError && <Alert status="error">{showingError} <Button variant="outline" size="sm" onClick={() => void (resolvedView ? refreshResolved() : activeView ? refreshActive() : refresh())}>Retry</Button></Alert>}
      {showingLoading ? <div aria-label={resolvedView ? "Loading resolved interventions" : activeView ? "Loading active interventions" : "Loading candidates"} className="space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
        : !showingError && sorted.length === 0 ? <EmptyStateCard title={resolvedView ? "No resolved interventions" : activeView ? "No active interventions" : "No candidates to review"} description={resolvedView ? "Resolved support will appear here." : activeView ? "Approved interventions will appear here." : "New candidates will appear when a current corrected prediction qualifies."} />
        : !showingError && <Table wrapperClassName="h-auto"><Table.Header><Table.Row><Table.Head>Student</Table.Head><Table.Head>Subject / Class</Table.Head><Table.Head>Triggering grade</Table.Head><Table.Head>Level / Status</Table.Head><Table.Head>Saved reason</Table.Head><Table.Head>{resolvedView ? "Resolved" : activeView ? "Activated" : "Created"}</Table.Head><Table.Head>Review</Table.Head></Table.Row></Table.Header><Table.Body>
          {sorted.map((candidate) => <Table.Row key={candidate.intervention_id}>
            <Table.Cell className="font-semibold">{candidate.student_name}<span className="block text-xs text-muted-foreground">{candidate.student_lrn}</span></Table.Cell>
            <Table.Cell>{candidate.subject_name}<span className="block text-xs text-muted-foreground">{candidate.class_name} · {candidate.academic_period_name}</span></Table.Cell>
            <Table.Cell>{candidate.triggering_predicted_grade.toFixed(2)}</Table.Cell>
            <Table.Cell><Badge variant="surface" size="sm">{label(candidate.triggering_intervention_level)}</Badge><span className="block text-xs">{label(candidate.status)}{resolvedView && activeItems.some((row) => sameScope(row, candidate) && row.activated_at && candidate.resolved_at && Date.parse(row.activated_at) > Date.parse(candidate.resolved_at)) ? " · Previous cycle; new active cycle" : ""}</span></Table.Cell>
            <Table.Cell>{resolvedView ? label(candidate.resolution_reason || "Unavailable") : reason(candidate)}</Table.Cell><Table.Cell>{date(resolvedView && candidate.resolved_at ? candidate.resolved_at : activeView && candidate.activated_at ? candidate.activated_at : candidate.created_at)}</Table.Cell>
            <Table.Cell><Button size="sm" variant="outline" onClick={() => open(candidate.intervention_id)}>Review</Button></Table.Cell>
          </Table.Row>)}
        </Table.Body></Table>}
    </main>
    <Sheet open={selectedId !== null} onOpenChange={(isOpen) => { if (!isOpen) close(); }}><SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
      <SheetHeader><SheetTitle>{selectedKind === "resolved" ? "Resolved Intervention · Read-only" : selectedKind === "active" ? "Active Intervention" : "Candidate Review"}</SheetTitle><SheetDescription>Frozen evidence from the triggering corrected prediction.</SheetDescription></SheetHeader>
      {detailLoading ? <div aria-label={selectedKind === "resolved" ? "Loading resolved detail" : selectedKind === "active" ? "Loading active detail" : "Loading candidate detail"} className="space-y-3 p-4"><Skeleton className="h-28 w-full" /><Skeleton className="h-40 w-full" /></div>
        : detailError ? <Alert status="error">{detailError}</Alert>
        : detail && <div className="space-y-5 p-4 pb-10">
          {detail.status === "RESOLVED" ? (() => { const resolved = detail as TeacherResolvedInterventionDetail; return <>
            <Card className="space-y-2 border-2 border-green-700 bg-green-50"><h3 className="font-bold">Resolved · Read-only history</h3><p className="font-semibold">{newerActive ? "Previous intervention cycle" : "Resolved intervention cycle"}</p><p>{resolved.student_name} · {resolved.subject_name} · {resolved.class_name}</p><p>Resolved: <strong>{resolved.resolved_at ? date(resolved.resolved_at) : "Unavailable"}</strong></p><p>Reason: <strong>{label(resolved.resolution_reason || "Unavailable")}</strong></p><p>Trigger projection: <strong>{resolved.triggering_predicted_grade.toFixed(2)}</strong></p><p>Projection at resolution: <strong>{resolved.resolution_projection?.toFixed(2) ?? "Unavailable"}</strong></p><p className="text-sm">This resolution describes this past cycle, not the student's current prediction.</p>{newerActive && <p className="text-sm font-semibold">A later below-threshold prediction opened a new active support cycle (trigger {newerActive.triggering_predicted_grade.toFixed(2)}).</p>}</Card>
            <Card className="space-y-2"><h3 className="font-bold">Targeted support history</h3>{resolved.targeted_activities.length ? resolved.targeted_activities.map((activity) => <p key={activity.assignment_id}>{activity.title} · {activity.submission_status === "graded" ? "Completed" : label(activity.submission_status || "Not submitted")}{activity.grade != null && activity.total_points != null ? ` · ${activity.grade}/${activity.total_points}` : ""}{activity.original_assignment_id && <span className="block text-sm">{activity.original_title} · {label(activity.exam_subtype || "Examination")} · Original: {activity.original_grade ?? "—"}/{activity.total_points ?? "—"} · Remedial: {activity.grade ?? "Pending"}/{activity.total_points ?? "—"} · Effective: {activity.effective_grade ?? "—"}/{activity.total_points ?? "—"}</span>}</p>) : <p>No targeted activity was recorded.</p>}</Card>
            {resolved.sent_reviewer && <Card className="space-y-2"><h3 className="font-bold">Sent Reviewer</h3><strong>{resolved.sent_reviewer.title}</strong><p>{resolved.sent_reviewer.introduction}</p><p className="whitespace-pre-wrap">{resolved.sent_reviewer.body}</p></Card>}
          </>; })() : detail.status === "ACTIVE" ? <>{previousResolved && <Card className="space-y-1 border-2 border-black bg-yellow-50"><h3 className="font-bold">Current support cycle</h3><p>A new below-threshold prediction opened this cycle after the previous Intervention resolved on {date(previousResolved.resolved_at!)}. That resolution is past history.</p></Card>}<InterventionSupportMaterials key={detail.intervention_id} detail={detail} /></> : <>
            <h3 className="text-lg font-bold">Original trigger and activation</h3>
            <Card className="w-full space-y-2"><h2 className="text-lg font-bold">{detail.student_name} · {detail.subject_name}</h2><p>{detail.class_name} · {detail.academic_period_name}</p><p>Status: <strong>{label(detail.status)}</strong></p><p>Triggering projected grade: <strong>{detail.triggering_predicted_grade.toFixed(2)}</strong> · {label(detail.triggering_intervention_level)}</p><p>Original source prediction #{detail.source_prediction_id}, revision {detail.source_prediction_revision} · Candidate created {date(detail.created_at)}</p></Card>
            <Card className="w-full space-y-2"><h3 className="text-lg font-bold">Why support was started</h3><p>Weakest supported components: {(detail.diagnosis_snapshot.weakest_supported_components ?? []).map(label).join(", ") || "Unavailable"}</p><p>Strongest available evidence: <strong>{strongestEvidence(detail.diagnosis_snapshot)}</strong></p><p className="text-sm">{(detail.diagnosis_snapshot.lowest_supported_competencies ?? []).length} scored competency targets · {(detail.diagnosis_snapshot.manual_assessment_coverage ?? []).length} assessments with coverage for teacher review</p></Card>
          </>}
          <details className="rounded border p-3"><summary className="cursor-pointer font-bold">View full frozen evidence</summary><div className="space-y-4 pt-4"><section className="space-y-2"><h3 className="text-lg font-bold">Frozen academic diagnosis</h3><p>Original source prediction #{detail.source_prediction_id}, revision {detail.source_prediction_revision}</p>{detail.activated_by_staff_id && <p>Activated by staff {detail.activated_by_staff_id}</p>}<p>Evidence cutoff: {detail.diagnosis_snapshot.evidence_cutoff_at ? date(detail.diagnosis_snapshot.evidence_cutoff_at) : "Unavailable"}</p><p>Weakest supported components: {(detail.diagnosis_snapshot.weakest_supported_components ?? []).map(label).join(", ") || "Unavailable"}</p>
            {Object.entries(detail.diagnosis_snapshot.components ?? {}).map(([name, component]) => <Card key={name} className="w-full"><strong>{label(name)}</strong>: {component.evidence_state === "AVAILABLE" ? percent(component.percent) : "Evidence unavailable"}</Card>)}
            <h4 className="font-bold">Supporting activities</h4>{(detail.diagnosis_snapshot.supporting_activities ?? []).length ? detail.diagnosis_snapshot.supporting_activities?.map((activity) => <Card key={activity.classwork_id} className="w-full"><strong>{activity.title}</strong> · {label(activity.component)} · {activity.score}/{activity.possible_score} ({percent(activity.percent)})</Card>) : <p>No scored activity detail in the saved diagnosis.</p>}
          </section>
          <section className="space-y-2"><h3 className="text-lg font-bold">Scored competency evidence</h3><p className="text-sm text-muted-foreground">Ranked only when a competency has its own traceable scored evidence.</p>
            {(detail.diagnosis_snapshot.lowest_supported_competencies ?? []).length ? detail.diagnosis_snapshot.lowest_supported_competencies?.map((item) => <Card key={item.competency_id} className="w-full"><strong>{item.competency_code}: {item.competency_statement}</strong><p>Scored evidence: {item.score}/{item.possible_score} ({percent(item.percent)})</p>{item.supporting_scores.map((score, index) => <p key={`${score.quiz_question_id ?? score.source_type}-${index}`} className="text-xs">{score.source_type === "QUIZ_QUESTION" ? `Scored question #${score.quiz_question_id ?? "unknown"}` : "Whole-activity score"} · {score.activity_title}{score.lesson_title ? ` · ${score.lesson_title}` : ""}{score.score != null && score.possible_score != null ? ` · ${score.score}/${score.possible_score}` : ""}</p>)}</Card>) : <Alert status="info">No specific competency could be identified from scored evidence.</Alert>}
          </section>
          <section className="space-y-2"><h3 className="text-lg font-bold">Manual assessment coverage for teacher review</h3><p className="text-sm text-muted-foreground">A total assessment score shows performance on the assessment. It does not score each covered competency separately or rank them against one another.</p>
            {(detail.diagnosis_snapshot.manual_assessment_coverage ?? []).length ? detail.diagnosis_snapshot.manual_assessment_coverage?.map((assessment) => <Card key={assessment.classwork_id} className="w-full space-y-1"><strong>{assessment.title}</strong><p>{label(assessment.component)} · Assessment total {assessment.score}/{assessment.possible_score} ({percent(assessment.percent)})</p><p>Covered lessons: {assessment.covered_lessons.map((lesson) => lesson.title).join(", ") || "None linked"}</p><p>Covered competencies: {assessment.covered_competencies.map((item) => `${item.competency_code}: ${item.competency_statement}`).join("; ") || "None linked"}</p><p className="text-xs text-muted-foreground">Teacher asserted assessment-level coverage; shared total score only.</p></Card>) : <p>No dated manual assessment coverage was available at the evidence cutoff.</p>}
            {(detail.diagnosis_snapshot.covered_competencies_for_teacher_review ?? []).length > 0 && <p className="text-sm">Covered competencies in weak components require teacher review; they are unranked because the assessment has one shared total score.</p>}
          </section>
          </div></details>
          {actionError && <Alert status="error">{actionError}</Alert>}
          {selectedKind === "candidate" && detail.status === "CANDIDATE" && <Card className="w-full space-y-3"><p>Approve an Intervention for <strong>{detail.student_name}</strong> in <strong>{detail.subject_name}</strong>? Current prediction evidence and teaching scope will be checked again.</p><Button disabled={activating || reviewStale} onClick={() => void activate()}>{activating ? "Checking and approving..." : "Approve Intervention"}</Button></Card>}
        </div>}
    </SheetContent></Sheet>
  </div></AppLayout>;
}
