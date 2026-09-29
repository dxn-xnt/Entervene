import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/retroui/Button";
import { useToast } from "@/components/retroui/use-toast";
import { Card } from "@/components/retroui/Card";
import {
  createSupportMaterial, generateStudentReviewer, listSupportMaterials, saveSupportMaterial, sendStudentReviewer,
  getRemediationWorkspace, saveRemediationPlan, generateRemediationAdvisory,
  type RemediationFormat, type RemediationPlan, type RemediationResource, type RemediationFocus,
  type RemediationProgress, type RemedialDraft, type ReviewerDraft, type SupportMaterial,
  type TeacherInterventionDetail,
  type OriginalExamination,
} from "@/lib/teacher-interventions-api";

const methods: Array<{ value: RemediationFormat; label: string; detail: string }> = [
  { value: "QUIZ", label: "Quiz", detail: "Focused practice in the existing Quiz builder" },
  { value: "CLASSWORK", label: "Classwork", detail: "Targeted activity in the existing Classwork creator" },
  { value: "TOS", label: "TOS blueprint", detail: "Assessment blueprint and export only; no student grade" },
  { value: "EXISTING_MATERIAL_ONLY", label: "Materials only", detail: "Planning references; no new graded assessment" },
];

const componentLabel = (value: string | null | undefined) => value ? value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Teacher review required";
const isGraded = (choice: RemediationFormat | null) => choice === "QUIZ" || choice === "CLASSWORK";

export default function InterventionSupportMaterials({ detail }: { detail: TeacherInterventionDetail }) {
  const toast = useToast();
  const { intervention_id: interventionId, subject_id: subjectId, subject_name: subjectName } = detail;
  const navigate = useNavigate();
  const [materials, setMaterials] = useState<SupportMaterial[]>([]);
  const [resources, setResources] = useState<RemediationResource[]>([]);
  const [focus, setFocus] = useState<RemediationFocus | null>(null);
  const [progress, setProgress] = useState<RemediationProgress | null>(null);
  const [originalExams, setOriginalExams] = useState<OriginalExamination[]>([]);
  const [plan, setPlan] = useState<RemediationPlan>({ teacher_choice: null, grade_treatment: null, selected_resources: [], ai_suggestion: null });
  const [reviewerDraft, setReviewerDraft] = useState<ReviewerDraft | null>(null);
  const [browseAll, setBrowseAll] = useState(false);
  const [panel, setPanel] = useState<"" | "reviewer" | "materials">("");
  const [showPreparation, setShowPreparation] = useState(false);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("ALL");
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNoticeState] = useState("");
  const setNotice = (message: string) => {
    setNoticeState(message);
    if (message) toast.success({ title: message });
  };

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [support, workspace] = await Promise.all([listSupportMaterials(interventionId), getRemediationWorkspace(interventionId)]);
      setMaterials(support.items); setResources(workspace.resources); setPlan(workspace.plan);
      setFocus(workspace.focus); setProgress(workspace.progress); setOriginalExams(workspace.original_exams ?? []);
      const reviewer = support.items.find((item) => item.kind === "STUDENT_REVIEWER");
      setReviewerDraft(reviewer ? reviewer.current_content as ReviewerDraft : null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load support workspace."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [interventionId]);

  const reviewer = materials.find((item) => item.kind === "STUDENT_REVIEWER");
  const oldAssessment = materials.find((item) => item.kind === "REMEDIAL_ASSESSMENT");
  const oldDraft = oldAssessment?.current_content as RemedialDraft | undefined;
  const hasOldDraft = Boolean(oldDraft && (oldDraft.title.trim() || oldDraft.instructions.trim() || oldDraft.questions.length));
  const selected = useMemo(() => new Set(plan.selected_resources.map((item) => `${item.kind}:${item.id}`)), [plan]);
  const precise = resources.filter((item) => item.recommended);
  const evidenceSources = resources.filter((item) => item.match_level === "SOURCE_ACTIVITY");
  const manuallySelected = resources.filter((item) => selected.has(`${item.kind}:${item.id}`) && !item.recommended);
  const visible = resources.filter((item) => (browseAll || item.recommended) && (kindFilter === "ALL" || item.kind === kindFilter)
    && `${item.title} ${item.description} ${item.lesson}`.toLowerCase().includes(search.toLowerCase()));
  const assigned: NonNullable<RemediationProgress["assigned_remediation"]> = progress?.assigned_remediation ?? progress?.completed_remediation.map((item) => ({ ...item, component: null, is_graded: true, submission_status: "graded" })) ?? [];
  const phase = progress?.completed_remediation.length ? "Active · Monitoring" : assigned.length ? "Active · Assigned" : plan.teacher_choice ? "Active · Preparing Support" : "Active · Needs Support";
  const focusName = focus?.component ? componentLabel(focus.component) : "Component unavailable";
  const sourceName = focus?.component === "EXAMINATION" ? (focus.exam_subtype ? componentLabel(focus.exam_subtype) : "Subtype requires teacher confirmation") : null;
  const focusPercent = focus?.component ? detail.diagnosis_snapshot.components?.[focus.component]?.percent : null;

  const action = async (run: () => Promise<void>) => {
    setWorking(true); setError(""); setNotice("");
    try { await run(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save changes."); toast.error({ title: "Unable to save changes", description: cause instanceof Error ? cause.message : undefined }); }
    finally { setWorking(false); }
  };
  const updatePlan = async (next: RemediationPlan, message: string) => action(async () => {
    const result = await saveRemediationPlan(interventionId, {
      teacher_choice: next.teacher_choice, grade_treatment: next.grade_treatment ?? null,
      ...(next.grade_treatment === "EXAMINATION" ? { original_exam_assignment_id: next.original_exam_assignment_id ?? null } : {}),
      selected_resources: next.selected_resources,
    });
    setPlan(result.plan); setResources(result.resources); setNotice(message);
  });
  const openTool = () => {
    if (!plan.teacher_choice || plan.teacher_choice === "EXISTING_MATERIAL_ONLY") return;
    if (isGraded(plan.teacher_choice) && (!plan.grade_treatment || (plan.grade_treatment === "EXAMINATION" && !plan.original_exam_assignment_id))) { setError("Choose a grade treatment and original Examination before continuing."); return; }
    const params = new URLSearchParams({ remediation: plan.teacher_choice, subject_id: String(subjectId), intervention_id: String(interventionId) });
    if (plan.grade_treatment === "EXAMINATION" && plan.original_exam_assignment_id) params.set("original_exam_assignment_id", String(plan.original_exam_assignment_id));
    params.set("title", plan.teacher_choice === "TOS" ? `${subjectName} remediation blueprint` : plan.teacher_choice === "QUIZ" ? `${subjectName} focused practice` : `${subjectName} remediation task`);
    if (isGraded(plan.teacher_choice)) {
      params.set("instructions", "Review the Intervention evidence and selected planning references. Assign this activity only to the named student.");
    }
    navigate(`${plan.teacher_choice === "TOS" ? "/teacher/tos" : "/teacher/classworks"}?${params.toString()}`);
  };

  return <section className="space-y-3" aria-label="Intervention workflow">
    <Card className="space-y-2 border-2 border-black bg-yellow-50">
      <h2 className="text-lg font-black">{detail.student_name}</h2>
      <p>{subjectName} · {detail.class_name}</p>
      <div className="grid grid-cols-2 gap-2 text-sm"><p>Trigger: <strong>{detail.triggering_predicted_grade.toFixed(2)}</strong></p><p>Latest: <strong>{progress?.latest_projection?.toFixed(2) ?? "Unavailable"}</strong></p></div>
      <p className="font-bold">{phase}</p>
      <p className="text-sm">{progress?.status_reason ?? "Loading current progress."}</p>
    </Card>
    {error && <Alert status="error">{error} <Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button></Alert>}
    {notice && <Alert status="success">{notice}</Alert>}
    {loading ? <p>Loading Intervention workflow...</p> : <>
      <Card className="space-y-2 border border-gray-300 bg-gray-50">
        <h3 className="font-black">Step 1 · Diagnosis</h3>
        <p>Support focus: <strong>{focusName}{sourceName ? ` · ${sourceName}` : ""}</strong></p>
        <p>Strongest available evidence: <strong>{focus?.evidence_level === "QUESTION_SCORE" ? "Scored question-level competency evidence" : focus?.evidence_level === "SCORED_COMPETENCY" ? "Scored whole-activity competency evidence" : focus?.evidence_level === "ACTIVITY_COVERAGE" ? "Assessment coverage only · competencies are unranked" : "Component-level evidence only"}</strong></p>
        {focus?.evidence_level === "QUESTION_SCORE" && <><p>Scored competency focus: {focus.competencies.map((item) => item.label).join("; ")}</p>{focus.question_evidence.map((item, index) => <p key={`${item.quiz_question_id ?? "unknown"}-${index}`} className="text-sm">Question #{item.quiz_question_id ?? "unknown"}: {item.score}/{item.possible_score}</p>)}</>}
        {focus?.evidence_level === "SCORED_COMPETENCY" && <p>Scored competency focus: {focus.competencies.map((item) => item.label).join("; ")}</p>}
        {focus?.evidence_level === "ACTIVITY_COVERAGE" && <p className="text-sm text-gray-600">Covered competencies are study context. The assessment total does not identify which one was difficult.</p>}
        {focusPercent != null && <p>Weakest component: {focusName} <strong>{focusPercent.toFixed(0)}%</strong></p>}
        {focus?.evidence_level === "COMPONENT_ONLY" && <p className="text-sm text-gray-600">No specific lesson or competency weakness can be identified from the available scored evidence.</p>}
        <p className="text-xs text-gray-600">Frozen at the original trigger. View full frozen evidence below for the dated scores.</p>
      </Card>

      {assigned.length > 0 && <Card className="space-y-2 border-2 border-green-700 bg-green-50">
        <h3 className="font-black">Intervention progress</h3>
        <p>Trigger projection: <strong>{progress?.triggering_projection.toFixed(2)}</strong></p>
        <p className="font-semibold">Support activity</p>
        {assigned.map((item) => <p key={item.assignment_id}><strong>{item.title}</strong> · {item.submission_status === "graded" ? "Completed" : item.submission_status ?? "Awaiting submission"}{item.grade !== null && item.total_points !== null ? ` · ${item.grade}/${item.total_points}` : ""} · {item.is_graded ? `${plan.teacher_choice === "EXISTING_MATERIAL_ONLY" ? "Historical grade treatment" : "Recorded grade treatment"}: ${componentLabel(item.component)}` : "Practice only · No official grade impact"}{item.original_assignment_id && <span className="block">{item.original_title} · {componentLabel(item.exam_subtype)} · Original: {item.original_grade ?? "—"}/{item.total_points ?? "—"} · Remedial: {item.grade ?? "Pending"}/{item.total_points ?? "—"} · Effective: {item.effective_grade ?? "—"}/{item.total_points ?? "—"}</span>}</p>)}
        <p className="font-semibold">Official academic outcome</p>
        <p>Latest projected final grade: <strong>{progress?.latest_projection?.toFixed(2) ?? "Unavailable"}</strong></p>
        <p>Status: <strong>{phase}</strong></p>
        <p>{progress?.completed_remediation.length ? "The student completed the support activity. " : ""}{progress?.status_reason} Completion alone does not resolve the Intervention.</p>
      </Card>}

      <details open={assigned.length === 0} className="rounded border-2 border-black bg-white p-3">
        <summary className="cursor-pointer font-black">Plan or adjust support</summary>
        <div className="space-y-3 pt-3">
          <Card className="space-y-2">
            <h3 className="font-black">Step 2 · Recommended support</h3>
            <p className="text-sm">Evidence-based focus: {focusName}{sourceName ? ` · ${sourceName}` : ""}. {focus?.evidence_level === "COMPONENT_ONLY" ? "General practice and teacher review are appropriate; no specific topic is established." : "Use only the traceable scored or coverage context shown above."}</p>
            <Button size="sm" variant="outline" disabled={working} onClick={() => void action(async () => { const result = await generateRemediationAdvisory(interventionId); setPlan(result.plan); setNotice("AI advisory ready. Teacher choice remains final."); })}>{plan.ai_suggestion ? "Refresh AI advisory" : "Get AI advisory"}</Button>
            {plan.ai_suggestion && <div className="rounded border border-blue-400 bg-blue-50 p-3 text-sm"><strong>AI ADVISORY · {methods.find((item) => item.value === plan.ai_suggestion?.recommended_format)?.label}</strong><p>{plan.ai_suggestion.reason}</p><p className="text-xs">Format advice only. Diagnosis and grade treatment come from saved evidence and teacher choice.</p></div>}
          </Card>
          <Card className="space-y-2">
            <h3 className="font-black">Step 3 · Support materials</h3>
            <p><strong>Student Reviewer</strong> · Optional study support · {reviewer?.status === "SENT" ? "Sent to student" : reviewer ? "Private draft" : "Not prepared"}</p>
            <p className="text-xs text-gray-600">Grounded from: {focusName} component evidence. Specific competency evidence: {focus?.competency_ids.length ? "Available" : "Unavailable"}. The reviewer is not a grade or proof of improvement.</p>
            <Button size="sm" variant="outline" onClick={() => setPanel(panel === "reviewer" ? "" : "reviewer")}>Open reviewer</Button>
            <p className="font-semibold">Recommended Materials</p>
            {precise.length ? <p className="text-sm">{precise.length} evidence-matched learning {precise.length === 1 ? "resource" : "resources"} available.</p> : <p className="text-sm text-gray-600">No precise lesson/material recommendation can be made from the current component-level evidence.</p>}
            {evidenceSources.length > 0 && <p className="text-sm text-gray-600">Related evidence source: {evidenceSources.map((item) => item.title).join("; ")}. This assessment is not a recommended learning material.</p>}
            {manuallySelected.length > 0 && <p className="text-sm">Teacher selected manually: {manuallySelected.map((item) => item.title).join("; ")}</p>}
            <Button size="sm" variant="outline" onClick={() => setPanel(panel === "materials" ? "" : "materials")}>Select resources</Button>
          </Card>
          {panel === "reviewer" && <Card className="space-y-3"><h4 className="font-bold">Student Reviewer · Optional study support</h4>
            {!reviewer ? <Button disabled={working} onClick={() => void action(async () => { const made = await createSupportMaterial(interventionId, "STUDENT_REVIEWER"); setMaterials((items) => [...items, made]); setReviewerDraft(made.current_content as ReviewerDraft); setNotice("Reviewer draft created."); })}>Create reviewer draft</Button>
              : reviewerDraft && <>{reviewer.status === "DRAFT" && !reviewer.generated_content && <Button disabled={working} variant="outline" onClick={() => void action(async () => { const made = await generateStudentReviewer(interventionId, reviewer.material_id); setMaterials((items) => items.map((item) => item.material_id === made.material_id ? made : item)); setReviewerDraft(made.current_content as ReviewerDraft); setNotice("Reviewer generated."); })}>Generate reviewer</Button>}
                {reviewer.status === "SENT" ? <div className="space-y-2"><strong>{reviewerDraft.title}</strong><p>{reviewerDraft.introduction}</p><p className="whitespace-pre-wrap">{reviewerDraft.body}</p></div> : <div className="space-y-2">
                  <label className="block">Title<input className="w-full rounded border p-2" value={reviewerDraft.title} onChange={(event) => setReviewerDraft({ ...reviewerDraft, title: event.target.value })} /></label>
                  <label className="block">Introduction<textarea className="w-full rounded border p-2" value={reviewerDraft.introduction} onChange={(event) => setReviewerDraft({ ...reviewerDraft, introduction: event.target.value })} /></label>
                  <label className="block">Review content<textarea rows={7} className="w-full rounded border p-2" value={reviewerDraft.body} onChange={(event) => setReviewerDraft({ ...reviewerDraft, body: event.target.value })} /></label>
                  <div className="flex flex-wrap gap-2"><Button disabled={working} onClick={() => void action(async () => { const saved = await saveSupportMaterial(interventionId, reviewer.material_id, reviewerDraft); setMaterials((items) => items.map((item) => item.material_id === saved.material_id ? saved : item)); setNotice("Reviewer draft saved."); })}>Save draft</Button>
                    <Button variant="outline" disabled={working || JSON.stringify(reviewerDraft) !== JSON.stringify(reviewer.current_content) || !reviewerDraft.title.trim() || !reviewerDraft.introduction.trim() || !reviewerDraft.body.trim()} onClick={() => void action(async () => { const sent = await sendStudentReviewer(interventionId, reviewer.material_id); setMaterials((items) => items.map((item) => item.material_id === sent.material_id ? sent : item)); setNotice("Reviewer sent to this student."); })}>Approve &amp; Send</Button></div>
                </div>}</>}
          </Card>}
          {panel === "materials" && <Card className="space-y-3"><h4 className="font-bold">{browseAll ? "All eligible materials" : "Recommended Materials"}</h4><p className="text-sm text-gray-600">Selected items are planning references. Access follows existing publication rules. File contents were not analyzed.</p>
            <Button size="sm" variant="outline" onClick={() => setBrowseAll((current) => !current)}>{browseAll ? "Show recommended materials" : "Browse all eligible materials"}</Button>
            <div className="flex gap-2"><input aria-label="Search materials" placeholder="Search materials" className="min-w-0 flex-1 rounded border p-2" value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="Material type" className="rounded border p-2" value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}><option value="ALL">All</option><option value="LESSON">Lessons</option><option value="CLASSWORK">Classwork and files</option></select></div>
            {visible.length ? visible.map((item) => <label key={`${item.kind}:${item.id}`} className="flex gap-3 rounded border p-3"><input type="checkbox" checked={selected.has(`${item.kind}:${item.id}`)} disabled={working} onChange={() => { const next = selected.has(`${item.kind}:${item.id}`) ? plan.selected_resources.filter((ref) => !(ref.kind === item.kind && ref.id === item.id)) : [...plan.selected_resources, { kind: item.kind, id: item.id }]; void updatePlan({ ...plan, selected_resources: next }, "Support materials saved."); }} /><span><strong>{item.title}</strong><span className="block text-xs">{item.recommended ? "Recommended by evidence" : item.match_level === "SOURCE_ACTIVITY" ? "Related evidence source" : "Teacher selection"} · {item.access === "ALREADY_ACCESSIBLE" ? "Accessible to class" : "Planning reference only"}</span>{item.match_reason && <span className="block text-xs">{item.match_reason}</span>}</span></label>) : <p className="text-sm">{browseAll ? "No eligible materials match this search." : "No precise learning resources match this evidence. Browse all eligible materials for a teacher-selected reference."}</p>}
          </Card>}
          <Card className="space-y-3">
            <h3 className="font-black">Step 4 · Remediation activity</h3>
            <Button size="sm" variant="outline" onClick={() => setShowPreparation((current) => !current)}>Prepare Remediation</Button>
            {showPreparation && <fieldset className="space-y-2"><legend className="font-semibold">Support method</legend>{methods.map((method) => <label key={method.value} className="flex gap-2 rounded border p-2"><input type="radio" name="remediation-method" checked={plan.teacher_choice === method.value} disabled={working} onChange={() => void updatePlan({ ...plan, teacher_choice: method.value, grade_treatment: isGraded(method.value) ? (plan.grade_treatment ?? "PRACTICE_ONLY") : null }, "Support method saved.")} /><span><strong>{method.label}</strong><span className="block text-xs">{method.detail}</span></span></label>)}</fieldset>}
          </Card>
          {isGraded(plan.teacher_choice) && <Card className="space-y-3 border-2 border-amber-500 bg-amber-50">
            <h3 className="font-black">Step 5 · Grade treatment</h3>
            <p>Support focus: <strong>{focusName}{sourceName ? ` · ${sourceName}` : ""}</strong></p>
            {focus?.component === "EXAMINATION" && <p className="text-sm">Select the student's scored original Examination. Its subtype and maximum points will be fixed for the remedial assessment.</p>}
            <p className="text-sm">Practice only stores completion without changing grades. Written Work and Performance Task add a new activity in that component. Remedial Examination replaces the original assessment's effective score only when higher.</p>
            <fieldset className="space-y-1"><legend className="font-semibold">How should this activity be treated?</legend>{(["PRACTICE_ONLY", "WRITTEN_WORK", "PERFORMANCE_TASK"] as const).map((choice) => <label key={choice} className="flex gap-2"><input type="radio" name="grade-treatment" checked={plan.grade_treatment === choice} disabled={working} onChange={() => void updatePlan({ ...plan, grade_treatment: choice, original_exam_assignment_id: null }, "Grade treatment saved.")} />{choice === "PRACTICE_ONLY" ? "Practice only · No official grade impact" : `Count as ${componentLabel(choice)}`}</label>)}{focus?.component === "EXAMINATION" && <label className="flex gap-2"><input type="radio" name="grade-treatment" checked={plan.grade_treatment === "EXAMINATION"} disabled={working || originalExams.length === 0} onChange={() => void updatePlan({ ...plan, grade_treatment: "EXAMINATION", original_exam_assignment_id: (originalExams.find((exam) => exam.subtype === focus.exam_subtype) ?? originalExams[0])?.assignment_id ?? null }, "Original Examination selected.")} />Remedial Examination · Higher score counts</label>}</fieldset>
            {focus?.component === "EXAMINATION" && originalExams.length === 0 && <p className="text-sm">No scored original Examination is available for this student and period.</p>}
            {plan.grade_treatment === "EXAMINATION" && <label className="block text-sm font-semibold">Original Examination
              <select className="mt-1 w-full rounded border p-2" value={plan.original_exam_assignment_id ?? ""} disabled={working} onChange={(event) => void updatePlan({ ...plan, original_exam_assignment_id: Number(event.target.value) }, "Original Examination selected.")}>
                {originalExams.map((exam) => <option key={exam.assignment_id} value={exam.assignment_id}>{exam.title} · {componentLabel(exam.subtype)} · {exam.score}/{exam.total_points}</option>)}
              </select>
            </label>}
            {!plan.grade_treatment && <p className="text-sm font-semibold">Choose practice only or an official grade component before continuing.</p>}
          </Card>}
          {plan.teacher_choice && <Card className="space-y-2 border-2 border-black bg-yellow-50">
            <h3 className="font-black">Prepared support</h3>
            <p>Target: <strong>{detail.student_name}</strong></p><p>Support focus: <strong>{focusName}{sourceName ? ` · ${sourceName}` : ""}</strong></p>
            <p>Method: <strong>{methods.find((item) => item.value === plan.teacher_choice)?.label}</strong></p>
            {isGraded(plan.teacher_choice) && <><p>Grade treatment: <strong>{plan.grade_treatment === "PRACTICE_ONLY" ? "Practice only · No official grade impact" : plan.grade_treatment ? componentLabel(plan.grade_treatment) : "Selection required"}</strong></p>{plan.grade_treatment === "EXAMINATION" && <p>Original: <strong>{originalExams.find((exam) => exam.assignment_id === plan.original_exam_assignment_id)?.title ?? "Selection required"}</strong></p>}<p>Recipient: <strong>This student only</strong></p></>}
            {plan.teacher_choice === "TOS" && <p>TOS is a blueprint/export. It creates no graded student activity.</p>}
            {plan.teacher_choice === "EXISTING_MATERIAL_ONLY" && <p>Selected materials remain planning references; they are not privately delivered.</p>}
            {plan.teacher_choice !== "EXISTING_MATERIAL_ONLY" && <Button disabled={working || (isGraded(plan.teacher_choice) && (!plan.grade_treatment || (plan.grade_treatment === "EXAMINATION" && !plan.original_exam_assignment_id)))} onClick={openTool}>Continue to {plan.teacher_choice === "QUIZ" ? "Quiz Builder" : plan.teacher_choice === "CLASSWORK" ? "Classwork Creator" : "TOS Generator"}</Button>}
          </Card>}
          {hasOldDraft && oldDraft && <details className="rounded border p-3 text-sm"><summary className="cursor-pointer font-semibold">Previous/legacy support draft</summary><div className="space-y-2 pt-2"><p>Preserved for reference. Use the existing authoring tool for new support.</p>{oldDraft.title.trim() && <strong>{oldDraft.title}</strong>}{oldDraft.instructions.trim() && <p>{oldDraft.instructions}</p>}<p>{oldDraft.questions.length} saved questions</p>{oldDraft.questions.map((question, index) => <div key={index} className="rounded border p-2"><strong>{question.question_text || `Question ${index + 1}`}</strong>{question.options.map((option, optionIndex) => <p key={optionIndex}>{option.option_text}{option.is_correct ? " (correct answer)" : ""}</p>)}{question.explanation && <p>Explanation: {question.explanation}</p>}</div>)}</div></details>}
        </div>
      </details>
    </>}
  </section>;
}
