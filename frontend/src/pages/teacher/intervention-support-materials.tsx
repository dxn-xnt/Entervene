import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import {
  createSupportMaterial, generateStudentReviewer, listSupportMaterials, saveSupportMaterial, sendStudentReviewer,
  getRemediationWorkspace, saveRemediationPlan, generateRemediationAdvisory,
  type RemediationFormat, type RemediationPlan, type RemediationResource, type RemedialDraft, type ReviewerDraft, type SupportMaterial,
} from "@/lib/teacher-interventions-api";

const formats: Array<{ value: RemediationFormat; label: string; detail: string }> = [
  { value: "QUIZ", label: "Quiz", detail: "Focused practice in the existing quiz builder" },
  { value: "TOS", label: "TOS", detail: "Assessment blueprint and export in the existing generator" },
  { value: "CLASSWORK", label: "Classwork", detail: "Task or activity in the existing Classwork creator" },
  { value: "EXISTING_MATERIAL_ONLY", label: "Existing materials only", detail: "Keep selected resources as a support plan" },
];

export default function InterventionSupportMaterials({ interventionId, subjectId, subjectName }: {
  interventionId: number; subjectId: number; subjectName: string;
}) {
  const navigate = useNavigate();
  const [materials, setMaterials] = useState<SupportMaterial[]>([]);
  const [resources, setResources] = useState<RemediationResource[]>([]);
  const [plan, setPlan] = useState<RemediationPlan>({ teacher_choice: null, selected_resources: [], ai_suggestion: null });
  const [reviewerDraft, setReviewerDraft] = useState<ReviewerDraft | null>(null);
  const [panel, setPanel] = useState<"" | "reviewer" | "materials" | "remediation">("");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("ALL");
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [support, workspace] = await Promise.all([listSupportMaterials(interventionId), getRemediationWorkspace(interventionId)]);
      setMaterials(support.items); setResources(workspace.resources); setPlan(workspace.plan);
      const reviewer = support.items.find((item) => item.kind === "STUDENT_REVIEWER");
      setReviewerDraft(reviewer ? reviewer.current_content as ReviewerDraft : null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load support workspace."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [interventionId]);
  const reviewer = materials.find((item) => item.kind === "STUDENT_REVIEWER");
  const oldAssessment = materials.find((item) => item.kind === "REMEDIAL_ASSESSMENT");
  const oldDraft = oldAssessment?.current_content as RemedialDraft | undefined;
  const hasOldDraftContent = Boolean(oldDraft && (oldDraft.title.trim() || oldDraft.instructions.trim() || oldDraft.questions.length));
  const selected = useMemo(() => new Set(plan.selected_resources.map((r) => `${r.kind}:${r.id}`)), [plan]);
  const visible = resources.filter((r) => (kindFilter === "ALL" || r.kind === kindFilter)
    && `${r.title} ${r.description} ${r.lesson} ${r.classwork_type || ""}`.toLowerCase().includes(search.toLowerCase()));

  const action = async (run: () => Promise<void>) => {
    setWorking(true); setError(""); setNotice("");
    try { await run(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save changes."); }
    finally { setWorking(false); }
  };
  const updatePlan = async (next: RemediationPlan, message: string) => action(async () => {
    const result = await saveRemediationPlan(interventionId, { teacher_choice: next.teacher_choice, selected_resources: next.selected_resources });
    setPlan(result.plan); setResources(result.resources); setNotice(message);
  });
  const openTool = () => {
    if (!plan.teacher_choice || plan.teacher_choice === "EXISTING_MATERIAL_ONLY") return;
    const params = new URLSearchParams({ remediation: plan.teacher_choice, subject_id: String(subjectId) });
    if (plan.teacher_choice !== "TOS") params.set("intervention_id", String(interventionId));
    params.set("title", plan.teacher_choice === "TOS" ? `${subjectName} remediation blueprint` : plan.teacher_choice === "QUIZ" ? `${subjectName} focused practice` : `${subjectName} remediation task`);
    if (plan.teacher_choice !== "TOS") {
      params.set("instructions", "Review the intervention evidence and selected support materials. Edit this draft before assigning it. Confirm the intended recipient and publication settings.");
    }
    navigate(`${plan.teacher_choice === "TOS" ? "/teacher/tos" : "/teacher/classworks"}?${params.toString()}`);
  };
  const prepareRemediation = () => {
    if (panel === "remediation") { setPanel(""); return; }
    setPanel("remediation");
    if (!plan.ai_suggestion && !working) {
      void action(async () => {
        const result = await generateRemediationAdvisory(interventionId);
        setPlan(result.plan);
        setNotice("Advisory suggestion ready. Choose your own format below.");
      });
    }
  };

  return <section className="space-y-3"><div><h3 className="text-lg font-bold">Prepare support</h3><p className="text-sm text-muted-foreground">Choose resources and a remediation path for this active intervention.</p></div>
    {error && <Alert status="error">{error} <Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button></Alert>}
    {notice && <Alert status="success">{notice}</Alert>}
    {loading ? <p>Loading support workspace...</p> : <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="space-y-2"><h4 className="font-bold">1. Student reviewer</h4><p className="text-sm">{reviewer ? (reviewer.status === "SENT" ? "Sent to student" : "Private draft") : "No reviewer yet"}</p><Button variant="outline" onClick={() => setPanel(panel === "reviewer" ? "" : "reviewer")}>Open reviewer</Button></Card>
        <Card className="space-y-2"><h4 className="font-bold">2. Existing materials</h4><p className="text-sm">{selected.size} selected for the support plan</p><Button variant="outline" onClick={() => setPanel(panel === "materials" ? "" : "materials")}>Select resources</Button></Card>
        <Card className="space-y-2"><h4 className="font-bold">3. Remediation</h4><p className="text-sm">{plan.teacher_choice ? formats.find((f) => f.value === plan.teacher_choice)?.label : "Choose a format"}</p><Button onClick={prepareRemediation}>Prepare Remediation</Button></Card>
      </div>
      {panel === "reviewer" && <Card className="space-y-3"><h4 className="font-bold">Student reviewer</h4>
        {!reviewer ? <Button disabled={working} onClick={() => void action(async () => { const made = await createSupportMaterial(interventionId, "STUDENT_REVIEWER"); setMaterials((items) => [...items, made]); setReviewerDraft(made.current_content as ReviewerDraft); })}>Create reviewer draft</Button>
          : reviewerDraft && <>{reviewer.status === "DRAFT" && !reviewer.generated_content && <Button disabled={working} variant="outline" onClick={() => void action(async () => { const made = await generateStudentReviewer(interventionId, reviewer.material_id); setMaterials((items) => items.map((item) => item.material_id === made.material_id ? made : item)); setReviewerDraft(made.current_content as ReviewerDraft); })}>Generate reviewer</Button>}
            {reviewer.status === "SENT" ? <div className="space-y-2"><strong>{reviewerDraft.title}</strong><p>{reviewerDraft.introduction}</p><p className="whitespace-pre-wrap">{reviewerDraft.body}</p></div> : <div className="space-y-2">
              <label className="block">Title<input className="w-full rounded border p-2" value={reviewerDraft.title} onChange={(e) => setReviewerDraft({ ...reviewerDraft, title: e.target.value })} /></label>
              <label className="block">Introduction<textarea className="w-full rounded border p-2" value={reviewerDraft.introduction} onChange={(e) => setReviewerDraft({ ...reviewerDraft, introduction: e.target.value })} /></label>
              <label className="block">Review content<textarea rows={7} className="w-full rounded border p-2" value={reviewerDraft.body} onChange={(e) => setReviewerDraft({ ...reviewerDraft, body: e.target.value })} /></label>
              <div className="flex flex-wrap gap-2"><Button disabled={working} onClick={() => void action(async () => { const saved = await saveSupportMaterial(interventionId, reviewer.material_id, reviewerDraft); setMaterials((items) => items.map((item) => item.material_id === saved.material_id ? saved : item)); setNotice("Reviewer draft saved."); })}>Save draft</Button>
                <Button variant="outline" disabled={working || JSON.stringify(reviewerDraft) !== JSON.stringify(reviewer.current_content) || !reviewerDraft.title.trim() || !reviewerDraft.introduction.trim() || !reviewerDraft.body.trim()} onClick={() => void action(async () => { const sent = await sendStudentReviewer(interventionId, reviewer.material_id); setMaterials((items) => items.map((item) => item.material_id === sent.material_id ? sent : item)); setNotice("Reviewer sent to this student."); })}>Approve &amp; Send</Button></div>
            </div>}</>}
      </Card>}
      {panel === "materials" && <Card className="space-y-3"><h4 className="font-bold">Existing teacher materials</h4><p className="text-sm text-muted-foreground">Selected materials are planning references. Student access follows each material's existing publication rules.</p>
        <div className="flex gap-2"><input aria-label="Search materials" placeholder="Search title, lesson, topic" className="min-w-0 flex-1 rounded border p-2" value={search} onChange={(e) => setSearch(e.target.value)} /><select aria-label="Material type" className="rounded border p-2" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}><option value="ALL">All</option><option value="LESSON">Lessons</option><option value="CLASSWORK">Classwork and files</option></select></div>
        {visible.length ? visible.map((r) => <label key={`${r.kind}:${r.id}`} className="flex gap-3 rounded border p-3"><input type="checkbox" checked={selected.has(`${r.kind}:${r.id}`)} disabled={working} onChange={() => { const next = selected.has(`${r.kind}:${r.id}`) ? plan.selected_resources.filter((item) => !(item.kind === r.kind && item.id === r.id)) : [...plan.selected_resources, { kind: r.kind, id: r.id }]; void updatePlan({ ...plan, selected_resources: next }, "Support materials saved."); }} /><span className="min-w-0"><strong>{r.title}</strong><span className="block text-xs">{r.kind === "LESSON" ? "Lesson" : r.classwork_type || "Classwork"} · {r.access === "ALREADY_ACCESSIBLE" ? "Already available to this class" : "Planning reference only"}</span>{r.description && <span className="block text-sm">{r.description}</span>}{r.lesson && <span className="block text-xs">Lesson: {r.lesson}</span>}{r.attachments.length > 0 && <span className="block text-xs">Files: {r.attachments.join(", ")}</span>}<span className="block text-xs text-muted-foreground">AI sees metadata only</span></span></label>) : <p>No eligible materials match this search.</p>}
      </Card>}
      {panel === "remediation" && <Card className="space-y-4"><div><h4 className="font-bold">Prepare Remediation</h4><p className="text-sm text-muted-foreground">AI advice is optional. Your choice controls the authoring path.</p></div>
        {selected.size > 0 && <p className="text-sm">Selected resources: {resources.filter((r) => selected.has(`${r.kind}:${r.id}`)).map((r) => r.title).join(", ")}</p>}
        <Button disabled={working} variant="outline" onClick={() => void action(async () => { const result = await generateRemediationAdvisory(interventionId); setPlan(result.plan); setNotice("Advisory suggestion ready. Choose your own format below."); })}>{working ? "Preparing..." : plan.ai_suggestion ? "Refresh AI advisory" : "Retry AI advisory"}</Button>
        {plan.ai_suggestion && <Alert status="info"><strong>AI suggestion · advisory:</strong> {formats.find((f) => f.value === plan.ai_suggestion?.recommended_format)?.label}. {plan.ai_suggestion.reason}<span className="block text-xs">Measured focus: {plan.ai_suggestion.focus.map((f) => f.competency).join(", ") || "Component-level evidence only"}. Selected files were not read.</span></Alert>}
        <fieldset className="space-y-2"><legend className="font-bold">Choose Remediation Type</legend>{formats.map((format) => <label key={format.value} className="flex gap-2 rounded border p-3"><input type="radio" name="remediation-format" checked={plan.teacher_choice === format.value} disabled={working} onChange={() => void updatePlan({ ...plan, teacher_choice: format.value }, "Teacher choice saved.")} /><span><strong>{format.label}</strong><span className="block text-sm text-muted-foreground">{format.detail}</span></span></label>)}</fieldset>
        {plan.teacher_choice === "EXISTING_MATERIAL_ONLY" ? <p className="text-sm">Your selected materials are saved as planning references. This does not grant student access.</p> : plan.teacher_choice && <><Alert status="info">The existing {formats.find((f) => f.value === plan.teacher_choice)?.label} tool may publish to a whole class. Keep the draft unpublished; targeted student assignment is not available here. Choose any Examination subtype yourself if applicable.</Alert><Button onClick={openTool}>Open existing {formats.find((f) => f.value === plan.teacher_choice)?.label} tool</Button></>}
      </Card>}
      {hasOldDraftContent && oldDraft && <details className="rounded border p-3 text-sm"><summary className="cursor-pointer font-semibold">Earlier remedial assessment draft</summary><div className="space-y-3 pt-3"><p className="text-muted-foreground">Preserved for reference. Use the existing Quiz builder for new questions.</p>
        {oldDraft.title.trim() && <h4 className="font-bold">{oldDraft.title}</h4>}
        {oldDraft.instructions.trim() && <p className="whitespace-pre-wrap">{oldDraft.instructions}</p>}
        <p>{oldDraft.questions.length} saved {oldDraft.questions.length === 1 ? "question" : "questions"}{oldDraft.duration_minutes ? ` · ${oldDraft.duration_minutes} minute limit` : ""}</p>
        {oldDraft.questions.map((question, index) => <div key={index} className="space-y-1 rounded border p-3"><p className="font-semibold">{index + 1}. {question.question_text || "Untitled question"}</p><p className="text-xs text-muted-foreground">{question.question_type === "MULTIPLE_CHOICE" ? "Multiple choice" : "Short answer"} · {question.points} {question.points === 1 ? "point" : "points"}</p>
          {question.options.length > 0 && <ul className="list-inside list-disc">{question.options.map((option, optionIndex) => <li key={optionIndex}>{option.option_text}{option.is_correct ? " (correct answer)" : ""}</li>)}</ul>}
          {question.explanation && <p className="whitespace-pre-wrap text-muted-foreground">Explanation: {question.explanation}</p>}
        </div>)}
      </div></details>}
    </>}
  </section>;
}
