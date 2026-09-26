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
import {
  activateTeacherCandidate, getTeacherCandidate, InterventionApiError, listTeacherCandidates,
  type TeacherInterventionDetail, type TeacherInterventionSummary,
} from "@/lib/teacher-interventions-api";

const label = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
const date = (value: string) => new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
const percent = (value: number | null | undefined) => value == null ? "Unavailable" : `${value.toFixed(1)}%`;
const reason = (candidate: TeacherInterventionSummary) => {
  const weakest = candidate.diagnosis_summary.weakest_supported_components ?? [];
  return weakest.length ? `Weakest supported: ${weakest.map(label).join(", ")}` : "Component detail unavailable in saved diagnosis";
};

export default function TeacherInterventions() {
  const [params, setParams] = useSearchParams();
  const candidateParam = params.get("candidate");
  const selectedId = candidateParam && /^\d+$/.test(candidateParam) ? Number(candidateParam) : null;
  const [items, setItems] = useState<TeacherInterventionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [detail, setDetail] = useState<TeacherInterventionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setListError(null);
    try { setItems((await listTeacherCandidates()).items); }
    catch (error) { setListError(error instanceof Error ? error.message : "Unable to load candidates."); }
    finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (selectedId === null) { setDetail(null); return; }
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) { setDetail(null); setDetailLoading(true); setDetailError(null); setActionError(null); } });
    getTeacherCandidate(selectedId).then((result) => { if (!cancelled) setDetail(result); })
      .catch((error: unknown) => { if (!cancelled) setDetailError(error instanceof Error ? error.message : "Unable to load candidate."); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const close = () => { const next = new URLSearchParams(params); next.delete("candidate"); setParams(next); };
  const open = (id: number) => { const next = new URLSearchParams(params); next.set("candidate", String(id)); setParams(next); };
  const activate = async () => {
    if (!detail || activating) return;
    setActivating(true);
    setActionError(null);
    try {
      const active = await activateTeacherCandidate(detail.intervention_id);
      setNotice(`Intervention approved for ${active.student_name} in ${active.subject_name}.`);
      close();
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to approve intervention. Please try again.";
      if (error instanceof InterventionApiError && error.status === 409) {
        setActionError(/improved|at least 85/i.test(message) ? "The current prediction improved. This candidate can no longer be approved. Refresh the list to see its current state."
          : /evidence|ready|unavailable|invalid/i.test(message) ? "Current prediction evidence is insufficient or unavailable. Approval was not completed."
          : `Candidate state changed: ${message}`);
        void refresh();
      } else if (error instanceof InterventionApiError && (error.status === 401 || error.status === 403)) {
        setActionError("You no longer have teaching access to this candidate.");
      } else { setActionError(message); }
    } finally { setActivating(false); }
  };
  const sorted = [...items].sort((a, b) => (a.triggering_intervention_level === "HIGH_RISK" ? 0 : 1) - (b.triggering_intervention_level === "HIGH_RISK" ? 0 : 1) || b.created_at.localeCompare(a.created_at));

  return <AppLayout><div className="flex min-w-0 flex-1 flex-col">
    <header className="flex items-center gap-2 bg-background px-3 py-3 sm:px-4 sm:py-4 md:px-6"><SidebarTrigger className="shrink-0 md:hidden" /><h1 className="text-xl font-bold sm:text-2xl md:text-4xl">Intervention Candidates</h1></header>
    <main className="min-w-0 space-y-4 border-t-2 border-border px-3 py-4 sm:px-4 md:px-6">
      <p className="text-sm text-muted-foreground">Review the saved evidence before approving a student intervention.</p>
      {notice && <Alert status="success">{notice}</Alert>}
      {listError && <Alert status="error">{listError} <Button variant="outline" size="sm" onClick={() => void refresh()}>Retry</Button></Alert>}
      {loading ? <div aria-label="Loading candidates" className="space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
        : !listError && sorted.length === 0 ? <EmptyStateCard title="No candidates to review" description="New candidates will appear when a current corrected prediction qualifies." />
        : !listError && <Table wrapperClassName="h-auto"><Table.Header><Table.Row><Table.Head>Student</Table.Head><Table.Head>Subject / Class</Table.Head><Table.Head>Projected grade</Table.Head><Table.Head>Level / Status</Table.Head><Table.Head>Saved reason</Table.Head><Table.Head>Created</Table.Head><Table.Head>Review</Table.Head></Table.Row></Table.Header><Table.Body>
          {sorted.map((candidate) => <Table.Row key={candidate.intervention_id}>
            <Table.Cell className="font-semibold">{candidate.student_name}<span className="block text-xs text-muted-foreground">{candidate.student_lrn}</span></Table.Cell>
            <Table.Cell>{candidate.subject_name}<span className="block text-xs text-muted-foreground">{candidate.class_name} · {candidate.academic_period_name}</span></Table.Cell>
            <Table.Cell>{candidate.triggering_predicted_grade.toFixed(2)}</Table.Cell>
            <Table.Cell><Badge variant="surface" size="sm">{label(candidate.triggering_intervention_level)}</Badge><span className="block text-xs">{label(candidate.status)}</span></Table.Cell>
            <Table.Cell>{reason(candidate)}</Table.Cell><Table.Cell>{date(candidate.created_at)}</Table.Cell>
            <Table.Cell><Button size="sm" variant="outline" onClick={() => open(candidate.intervention_id)}>Review</Button></Table.Cell>
          </Table.Row>)}
        </Table.Body></Table>}
    </main>
    <Sheet open={selectedId !== null} onOpenChange={(isOpen) => { if (!isOpen) close(); }}><SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
      <SheetHeader><SheetTitle>Candidate Review</SheetTitle><SheetDescription>Frozen evidence from the triggering corrected prediction.</SheetDescription></SheetHeader>
      {detailLoading ? <div aria-label="Loading candidate detail" className="space-y-3 p-4"><Skeleton className="h-28" /><Skeleton className="h-40" /></div>
        : detailError ? <Alert status="error">{detailError}</Alert>
        : detail && <div className="space-y-5 p-4 pb-10">
          <Card className="w-full space-y-2"><h2 className="text-lg font-bold">{detail.student_name} · {detail.subject_name}</h2><p>{detail.class_name} · {detail.academic_period_name}</p><p>Triggering projected grade: <strong>{detail.triggering_predicted_grade.toFixed(2)}</strong> · {label(detail.triggering_intervention_level)}</p><p>Source prediction revision {detail.source_prediction_revision} · Candidate created {date(detail.created_at)}</p><p>Evidence cutoff: {detail.diagnosis_snapshot.evidence_cutoff_at ? date(detail.diagnosis_snapshot.evidence_cutoff_at) : "Unavailable"}</p></Card>
          <section className="space-y-2"><h3 className="text-lg font-bold">Academic evidence</h3><p>Weakest supported components: {(detail.diagnosis_snapshot.weakest_supported_components ?? []).map(label).join(", ") || "Unavailable"}</p>
            {Object.entries(detail.diagnosis_snapshot.components ?? {}).map(([name, component]) => <Card key={name} className="w-full"><strong>{label(name)}</strong>: {component.evidence_state === "AVAILABLE" ? percent(component.percent) : "Evidence unavailable"}</Card>)}
            <h4 className="font-bold">Supporting activities</h4>{(detail.diagnosis_snapshot.supporting_activities ?? []).length ? detail.diagnosis_snapshot.supporting_activities?.map((activity) => <Card key={activity.classwork_id} className="w-full"><strong>{activity.title}</strong> · {label(activity.component)} · {activity.score}/{activity.possible_score} ({percent(activity.percent)})</Card>) : <p>No scored activity detail in the saved diagnosis.</p>}
          </section>
          <section className="space-y-2"><h3 className="text-lg font-bold">Scored competency evidence</h3><p className="text-sm text-muted-foreground">Ranked only when a competency has its own traceable scored evidence.</p>
            {(detail.diagnosis_snapshot.lowest_supported_competencies ?? []).length ? detail.diagnosis_snapshot.lowest_supported_competencies?.map((item) => <Card key={item.competency_id} className="w-full"><strong>{item.competency_code}: {item.competency_statement}</strong><p>Scored evidence: {item.score}/{item.possible_score} ({percent(item.percent)})</p><p className="text-xs">{item.supporting_scores.map((score) => `${label(score.source_type)} · ${score.activity_title}`).join(", ")}</p></Card>) : <Alert status="info">Individual competency scores are unavailable in this saved diagnosis.</Alert>}
          </section>
          <section className="space-y-2"><h3 className="text-lg font-bold">Manual assessment coverage for teacher review</h3><p className="text-sm text-muted-foreground">A total assessment score shows performance on the assessment. It does not score each covered competency separately or rank them against one another.</p>
            {(detail.diagnosis_snapshot.manual_assessment_coverage ?? []).length ? detail.diagnosis_snapshot.manual_assessment_coverage?.map((assessment) => <Card key={assessment.classwork_id} className="w-full space-y-1"><strong>{assessment.title}</strong><p>{label(assessment.component)} · Assessment total {assessment.score}/{assessment.possible_score} ({percent(assessment.percent)})</p><p>Covered lessons: {assessment.covered_lessons.map((lesson) => lesson.title).join(", ") || "None linked"}</p><p>Covered competencies: {assessment.covered_competencies.map((item) => `${item.competency_code}: ${item.competency_statement}`).join("; ") || "None linked"}</p><p className="text-xs text-muted-foreground">Teacher asserted assessment-level coverage; shared total score only.</p></Card>) : <p>No dated manual assessment coverage was available at the evidence cutoff.</p>}
            {(detail.diagnosis_snapshot.covered_competencies_for_teacher_review ?? []).length > 0 && <p className="text-sm">Covered competencies in weak components require teacher review; they are unranked because the assessment has one shared total score.</p>}
          </section>
          {actionError && <Alert status="error">{actionError}</Alert>}
          {detail.status === "CANDIDATE" && <Card className="w-full space-y-3"><p>Approve an Intervention for <strong>{detail.student_name}</strong> in <strong>{detail.subject_name}</strong>? Current prediction evidence and teaching scope will be checked again.</p><Button disabled={activating} onClick={() => void activate()}>{activating ? "Checking and approving..." : "Approve Intervention"}</Button></Card>}
        </div>}
    </SheetContent></Sheet>
  </div></AppLayout>;
}
