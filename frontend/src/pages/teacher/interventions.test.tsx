// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeacherInterventions from "./interventions";
import { InterventionApiError } from "@/lib/teacher-interventions-api";

const api = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), activate: vi.fn(), activeList: vi.fn(), activeDetail: vi.fn(), resolvedList: vi.fn(), resolvedDetail: vi.fn(), materials: vi.fn(), createMaterial: vi.fn(), saveMaterial: vi.fn(), generateReviewer: vi.fn(), sendReviewer: vi.fn(), workspace: vi.fn(), savePlan: vi.fn(), advisory: vi.fn() }));
vi.mock("@/lib/teacher-interventions-api", async (original) => ({
  ...await original<typeof import("@/lib/teacher-interventions-api")>(),
  listTeacherCandidates: api.list, getTeacherCandidate: api.detail, activateTeacherCandidate: api.activate,
  listTeacherActive: api.activeList, getTeacherActive: api.activeDetail,
  listTeacherResolved: api.resolvedList, getTeacherResolved: api.resolvedDetail,
  listSupportMaterials: api.materials, createSupportMaterial: api.createMaterial, saveSupportMaterial: api.saveMaterial, generateStudentReviewer: api.generateReviewer, sendStudentReviewer: api.sendReviewer,
  getRemediationWorkspace: api.workspace, saveRemediationPlan: api.savePlan, generateRemediationAdvisory: api.advisory,
}));
vi.mock("@/layouts/app-layout", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <aside>{children}</aside> : null,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

const candidate = {
  intervention_id: 12, student_id: "s1", student_name: "Alex Rivera", student_lrn: "123", class_id: 7,
  class_name: "Archimedes", subject_id: 5, subject_name: "Mathematics", academic_period_id: 3,
  academic_period_name: "Term 1", status: "CANDIDATE", source_prediction_id: 41,
  source_prediction_revision: 2, triggering_predicted_grade: 74, triggering_intervention_level: "HIGH_RISK",
  created_at: "2026-09-25T00:00:00Z", diagnosis_summary: { weakest_supported_components: ["WRITTEN_WORK"] },
};
const detail = { ...candidate, activated_at: null, resolved_at: null, resolution_reason: null, diagnosis_snapshot: {
  evidence_cutoff_at: "2026-09-24T00:00:00Z", weakest_supported_components: ["WRITTEN_WORK"],
  components: { WRITTEN_WORK: { evidence_state: "AVAILABLE", percent: 61, model_observation_count: 2 } },
  supporting_activities: [{ classwork_id: 11, title: "Fractions test", component: "WRITTEN_WORK", score: 12, possible_score: 20, percent: 60 }],
  lowest_supported_competencies: [{ competency_id: 2, competency_code: "M2", competency_statement: "Add fractions", percent: 50, score: 1, possible_score: 2, supporting_scores: [{ source_type: "QUIZ_QUESTION", activity_title: "Quiz" }] }],
  manual_assessment_coverage: [{ classwork_id: 11, title: "Fractions test", component: "WRITTEN_WORK", score: 12, possible_score: 20, percent: 60, covered_lessons: [{ lesson_id: 1, title: "Fractions" }], covered_competencies: [{ competency_id: 2, competency_code: "M2", competency_statement: "Add fractions" }, { competency_id: 3, competency_code: "M3", competency_statement: "Compare fractions" }], score_scope: "ASSESSMENT_TOTAL_ONLY", coverage_provenance: "TEACHER_ASSERTED_ASSESSMENT_COVERAGE" }],
  covered_competencies_for_teacher_review: [{ competency_id: 3, competency_code: "M3", competency_statement: "Compare fractions", ranking_status: "UNRANKED_SHARED_ASSESSMENT_SCORE", assessment_classwork_ids: [11] }],
} };
const active = { ...candidate, status: "ACTIVE", activated_at: "2026-09-26T00:00:00Z" };
const activeDetail = { ...detail, ...active, activated_by_staff_id: "T-001" };

function mount(path = "/teacher/interventions") {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/teacher/interventions" element={<TeacherInterventions />} /><Route path="/teacher/classworks" element={<div>Existing Classwork page</div>} /><Route path="/teacher/tos" element={<div>Existing TOS page</div>} /></Routes></MemoryRouter>);
}
beforeEach(() => { api.list.mockResolvedValue({ items: [candidate], total: 1 }); api.detail.mockResolvedValue(detail); api.activate.mockResolvedValue(activeDetail); api.activeList.mockResolvedValue({ items: [], total: 0 }); api.activeDetail.mockResolvedValue(activeDetail); api.resolvedList.mockResolvedValue({ items: [], total: 0 }); api.materials.mockResolvedValue({ items: [], total: 0 }); api.workspace.mockResolvedValue({ plan: { teacher_choice: null, grade_treatment: null, selected_resources: [], ai_suggestion: null }, resources: [], focus: { basis: "FROZEN_TRIGGER_DIAGNOSIS", evidence_level: "SCORED_COMPETENCY", component: "WRITTEN_WORK", exam_subtype: null, competency_ids: [2], competencies: [{ id: 2, label: "Add fractions" }], lesson_ids: [], lessons: [], source_classwork_ids: [], topics: [], question_evidence: [], coverage_is_context_only: false }, progress: { triggering_projection: 74, latest_projection: 74, latest_revision: 2, completed_remediation: [], assigned_remediation: [], status: "ACTIVE", status_reason: "Latest projected final grade remains below 85." } }); api.advisory.mockResolvedValue({ plan: { teacher_choice: null, grade_treatment: null, selected_resources: [], ai_suggestion: { recommended_format: "QUIZ", reason: "Focused practice may help.", focus: [], evidence_used: {} } }, resources: [] }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("shows resolved history and a read-only detail with saved support", async () => {
  const resolved = { ...active, status: "RESOLVED", resolved_at: "2026-09-27T00:00:00Z", resolution_reason: "IMPROVED_PREDICTION" };
  api.resolvedList.mockResolvedValue({ items: [resolved], total: 1 });
  api.resolvedDetail.mockResolvedValue({ ...activeDetail, ...resolved, resolution_projection: 88,
    targeted_activities: [{ assignment_id: 14, title: "Focused practice", classwork_type: "QUIZ", submission_status: "graded", grade: 8, total_points: 10 }],
    sent_reviewer: { title: "Ratio review", introduction: "Read first", body: "Practice ratios" } });
  mount("/teacher/interventions?view=resolved");
  expect(await screen.findByText("Alex Rivera")).toBeTruthy();
  expect(screen.getByText("Improved Prediction")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  const sheet = await screen.findByRole("complementary");
  expect(await within(sheet).findByText("Resolved · Read-only history")).toBeTruthy();
  expect(within(sheet).getByText(/Projection at resolution:/).textContent).toContain("88.00");
  expect(within(sheet).getByText(/Focused practice.*8\/10/)).toBeTruthy();
  expect(within(sheet).getByText("Ratio review")).toBeTruthy();
  expect(within(sheet).queryByRole("button", { name: "Approve Intervention" })).toBeNull();
  expect(within(sheet).queryByRole("button", { name: "Open reviewer" })).toBeNull();
  expect(within(sheet).queryByRole("button", { name: "Prepare Remediation" })).toBeNull();
  expect(api.resolvedDetail).toHaveBeenCalledWith(12);
});

describe("teacher candidate review", () => {
  it("lists teacher candidates and prioritizes the backend high-risk label", async () => {
    api.list.mockResolvedValue({ items: [{ ...candidate, intervention_id: 13, student_name: "Morgan", triggering_intervention_level: "MODERATE_RISK" }, candidate], total: 2 });
    mount();
    await screen.findByText("Alex Rivera");
    expect(screen.getAllByText("Weakest supported: Written Work")).toHaveLength(2);
    expect(screen.getAllByRole("row")[1].textContent).toContain("Alex Rivera");
  });
  it("shows an empty state", async () => {
    api.list.mockResolvedValue({ items: [], total: 0 }); mount();
    expect(await screen.findByText("No candidates to review")).toBeTruthy();
  });
  it("offers a retry when candidate listing fails", async () => {
    api.list.mockRejectedValue(new Error("Network unavailable")); mount();
    expect(await screen.findByText(/Network unavailable/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
  it("shows frozen scored evidence separately from unranked assessment coverage", async () => {
    mount("/teacher/interventions?candidate=12");
    const sheet = await screen.findByRole("complementary");
    await within(sheet).findByText(/Scored evidence: 1\/2/);
    expect(within(sheet).getByText(/Assessment total 12\/20/)).toBeTruthy();
    expect(within(sheet).getByText(/does not score each covered competency separately/i)).toBeTruthy();
    expect(within(sheet).getByText(/unranked because the assessment has one shared total score/i)).toBeTruthy();
    expect(within(sheet).getByText(/Evidence cutoff:/)).toBeTruthy();
  });
  it("explains unavailable individual competency scores", async () => {
    api.detail.mockResolvedValue({ ...detail, diagnosis_snapshot: { ...detail.diagnosis_snapshot, lowest_supported_competencies: [] } });
    mount("/teacher/interventions?candidate=12");
    expect(await screen.findByText("No specific competency could be identified from scored evidence.")).toBeTruthy();
  });
  it("labels question scores as stronger than assessment coverage", async () => {
    api.detail.mockResolvedValue({ ...detail, diagnosis_snapshot: { ...detail.diagnosis_snapshot,
      lowest_supported_competencies: [{ ...detail.diagnosis_snapshot.lowest_supported_competencies[0], supporting_scores: [{ source_type: "QUIZ_QUESTION", activity_title: "Summative 1", quiz_question_id: 8, lesson_title: "Fractions", score: 1, possible_score: 2 }] }],
      manual_assessment_coverage: [{ ...detail.diagnosis_snapshot.manual_assessment_coverage[0], in_weakest_supported_component: true }],
    } });
    mount("/teacher/interventions?candidate=12");
    expect(await screen.findByText("Scored question-level competency evidence")).toBeTruthy();
    expect(screen.getByText(/Scored question #8.*1\/2/)).toBeTruthy();
  });
  it("activates through the teacher API and refreshes the list", async () => {
    api.list.mockResolvedValueOnce({ items: [candidate], total: 1 }).mockResolvedValueOnce({ items: [], total: 0 });
    api.activeList.mockResolvedValueOnce({ items: [], total: 0 }).mockResolvedValueOnce({ items: [active], total: 1 });
    mount("/teacher/interventions?candidate=12");
    fireEvent.click(await screen.findByRole("button", { name: "Approve Intervention" }));
    await waitFor(() => expect(api.activate).toHaveBeenCalledWith(12));
    expect(await screen.findByText(/Intervention approved for Alex Rivera/)).toBeTruthy();
    expect(await screen.findByText("No candidates to review")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Active" }));
    expect(await screen.findByText("Alex Rivera")).toBeTruthy();
  });
  it.each([
    ["Current prediction improved to at least 85", /current prediction improved/i],
    ["Current prediction evidence is not READY", /evidence is insufficient/i],
    ["Intervention is no longer a candidate", /candidate state changed/i],
  ])("handles activation conflict: %s", async (message, expected) => {
    api.activate.mockRejectedValue(new InterventionApiError(409, message));
    mount("/teacher/interventions?candidate=12");
    fireEvent.click(await screen.findByRole("button", { name: "Approve Intervention" }));
    expect(await screen.findByText(expected)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Approve Intervention" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Approve Intervention" }));
    expect(api.activate).toHaveBeenCalledTimes(1);
  });
  it("explains lost teacher scope", async () => {
    api.activate.mockRejectedValue(new InterventionApiError(403, "Forbidden"));
    mount("/teacher/interventions?candidate=12");
    fireEvent.click(await screen.findByRole("button", { name: "Approve Intervention" }));
    expect(await screen.findByText(/no longer have teaching access/i)).toBeTruthy();
  });
});

describe("teacher active intervention review", () => {
  it.each([
    ["QUESTION_SCORE", "Scored question-level competency evidence"],
    ["ACTIVITY_COVERAGE", "Assessment coverage only · competencies are unranked"],
    ["COMPONENT_ONLY", "Component-level evidence only"],
  ])("shows the supported %s evidence level", async (level, expected) => {
    const workspace = await api.workspace();
    api.workspace.mockResolvedValue({ ...workspace, focus: { ...workspace.focus, evidence_level: level,
      question_evidence: level === "QUESTION_SCORE" ? [{ quiz_question_id: 4, score: 1, possible_score: 2 }] : [],
    } });
    mount("/teacher/interventions?active=12");
    const sheet = await screen.findByRole("complementary");
    expect(await within(sheet).findByText(expected)).toBeTruthy();
    if (level === "QUESTION_SCORE") expect(within(sheet).getByText("Question #4: 1/2")).toBeTruthy();
    if (level === "ACTIVITY_COVERAGE") expect(within(sheet).getByText(/does not identify which one was difficult/i)).toBeTruthy();
  });
  it("shows the active list and original frozen detail without approval controls", async () => {
    api.activeList.mockResolvedValue({ items: [active], total: 1 });
    mount("/teacher/interventions?view=active");
    expect(await screen.findByText("Alex Rivera")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    const sheet = await screen.findByRole("complementary");
    expect(await within(sheet).findByText(/Original source prediction #41, revision 2/)).toBeTruthy();
    expect(within(sheet).getByText(/Activated by staff T-001/)).toBeTruthy();
    expect(within(sheet).getByText(/Scored evidence: 1\/2/)).toBeTruthy();
    expect(within(sheet).getByText(/Assessment total 12\/20/)).toBeTruthy();
    expect(within(sheet).getByText(/does not score each covered competency separately/i)).toBeTruthy();
    expect(await within(sheet).findByText("Step 3 · Support materials")).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Prepare Remediation" })).toBeTruthy();
    expect(within(sheet).getByText(/Support focus:/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Open reviewer" }));
    expect(within(sheet).getByRole("button", { name: "Create reviewer draft" })).toBeTruthy();
    expect(within(sheet).queryByRole("button", { name: "Approve Intervention" })).toBeNull();
    expect(api.activeDetail).toHaveBeenCalledWith(12);
  });
  it("creates and edits a private reviewer draft", async () => {
    api.activeList.mockResolvedValue({ items: [active], total: 1 });
    const material = { material_id: 8, intervention_id: 12, kind: "STUDENT_REVIEWER", status: "DRAFT", current_content: { title: "", introduction: "", body: "" }, generated_content: null, evidence_basis: { source_prediction_id: 41 }, created_by_staff_id: "T-001", updated_by_staff_id: "T-001", created_at: "2026-09-26T00:00:00Z", updated_at: "2026-09-26T00:00:00Z" };
    api.createMaterial.mockResolvedValue(material);
    api.saveMaterial.mockImplementation(async (_id, _materialId, content) => ({ ...material, current_content: content }));
    mount("/teacher/interventions?active=12");
    const sheet = await screen.findByRole("complementary");
    fireEvent.click(await within(sheet).findByRole("button", { name: "Open reviewer" }));
    fireEvent.click(await within(sheet).findByRole("button", { name: "Create reviewer draft" }));
    const title = await within(sheet).findByRole("textbox", { name: "Title" });
    fireEvent.change(title, { target: { value: "Fraction review" } });
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Review content" }), { target: { value: "Worked examples" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.saveMaterial).toHaveBeenCalledWith(12, 8, { title: "Fraction review", introduction: "", body: "Worked examples" }));
  });
  it("generates once and fills the editable reviewer fields", async () => {
    const material = { material_id: 8, intervention_id: 12, kind: "STUDENT_REVIEWER", status: "DRAFT", current_content: { title: "", introduction: "", body: "" }, generated_content: null, evidence_basis: { source_prediction_id: 41 }, created_by_staff_id: "T-001", updated_by_staff_id: "T-001", created_at: "2026-09-26T00:00:00Z", updated_at: "2026-09-26T00:00:00Z" };
    const content = { title: "Math review", introduction: "Let's practice", body: "Read and try worked examples." };
    api.materials.mockResolvedValue({ items: [material], total: 1 });
    api.generateReviewer.mockResolvedValue({ ...material, generated_content: content, current_content: content });
    mount("/teacher/interventions?active=12");
    const sheet = await screen.findByRole("complementary");
    fireEvent.click(await within(sheet).findByRole("button", { name: "Open reviewer" }));
    fireEvent.click(await within(sheet).findByRole("button", { name: "Generate reviewer" }));
    expect(await within(sheet).findByDisplayValue("Math review")).toBeTruthy();
    expect(within(sheet).getByDisplayValue("Read and try worked examples.")).toBeTruthy();
    expect(within(sheet).queryByRole("button", { name: "Generate reviewer" })).toBeNull();
    expect(api.generateReviewer).toHaveBeenCalledWith(12, 8);
  });
  it("requires saved edits, then sends and freezes the reviewer", async () => {
    const content = { title: "Math review", introduction: "Let's practice", body: "Read and try worked examples." };
    const material = { material_id: 8, intervention_id: 12, kind: "STUDENT_REVIEWER", status: "DRAFT", current_content: content, generated_content: content, evidence_basis: { source_prediction_id: 41 }, created_by_staff_id: "T-001", updated_by_staff_id: "T-001", created_at: "2026-09-26T00:00:00Z", updated_at: "2026-09-26T00:00:00Z", sent_at: null, sent_by_staff_id: null };
    api.materials.mockResolvedValue({ items: [material], total: 1 });
    let savedContent = content;
    api.saveMaterial.mockImplementation(async (_id, _materialId, changed) => { savedContent = changed; return { ...material, current_content: changed }; });
    api.sendReviewer.mockImplementation(async () => ({ ...material, status: "SENT", current_content: savedContent, sent_at: "2026-09-26T01:00:00Z" }));
    mount("/teacher/interventions?active=12");
    const sheet = await screen.findByRole("complementary");
    fireEvent.click(await within(sheet).findByRole("button", { name: "Open reviewer" }));
    const send = await within(sheet).findByRole("button", { name: "Approve & Send" });
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Review content" }), { target: { value: "Teacher edited version" } });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(sheet).getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(send);
    await waitFor(() => expect(api.sendReviewer).toHaveBeenCalledWith(12, 8));
    expect(await within(sheet).findByText(/Sent to student/)).toBeTruthy();
    expect(within(sheet).getByText("Teacher edited version")).toBeTruthy();
    expect(within(sheet).queryByRole("textbox", { name: "Review content" })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: "Approve & Send" })).toBeNull();
  });
  it("hides an empty legacy remedial draft", async () => {
    const material = { material_id: 9, intervention_id: 12, kind: "REMEDIAL_ASSESSMENT", status: "DRAFT", current_content: { title: "", instructions: "", duration_minutes: null, settings: {}, questions: [] }, generated_content: null, evidence_basis: { source_prediction_id: 41 }, created_by_staff_id: "T-001", updated_by_staff_id: "T-001", created_at: "2026-09-26T00:00:00Z", updated_at: "2026-09-26T00:00:00Z" };
    api.materials.mockResolvedValue({ items: [material], total: 1 });
    mount("/teacher/interventions?active=12");
    const sheet = await screen.findByRole("complementary");
    await within(sheet).findByRole("button", { name: "Prepare Remediation" });
    expect(within(sheet).queryByText(/Previous\/legacy support draft/)).toBeNull();
    expect(within(sheet).queryByRole("button", { name: "Add Question" })).toBeNull();
    expect(api.saveMaterial).not.toHaveBeenCalled();
  });
  it("shows meaningful legacy questions as a readable reference", async () => {
    const material = { material_id: 9, intervention_id: 12, kind: "REMEDIAL_ASSESSMENT", status: "DRAFT", current_content: {
      title: "Fractions practice", instructions: "Work through each item.", duration_minutes: 15, settings: {}, questions: [{ question_text: "What is one half plus one half?", question_type: "MULTIPLE_CHOICE", points: 1, options: [{ option_text: "One", is_correct: true }], explanation: "Add the halves." }],
    }, generated_content: null, evidence_basis: { source_prediction_id: 41 }, created_by_staff_id: "T-001", updated_by_staff_id: "T-001", created_at: "2026-09-26T00:00:00Z", updated_at: "2026-09-26T00:00:00Z" };
    api.materials.mockResolvedValue({ items: [material], total: 1 });
    mount("/teacher/interventions?active=12");
    const sheet = await screen.findByRole("complementary");
    fireEvent.click(await within(sheet).findByText(/Previous\/legacy support draft/));
    expect(within(sheet).getByText("Fractions practice")).toBeTruthy();
    expect(within(sheet).getByText(/What is one half plus one half/)).toBeTruthy();
    expect(within(sheet).getByText(/One \(correct answer\)/)).toBeTruthy();
    expect(within(sheet).queryByText(/"is_shuffle_questions"/)).toBeNull();
    expect(api.saveMaterial).not.toHaveBeenCalled();
  });
  it("selects scoped materials and lets the teacher override AI advice", async () => {
    const resource = { kind: "LESSON", id: 4, title: "Fractions guide", description: "Practice guide", lesson: "Fractions",
      topic: "Fractions", attachments: [], access: "PLANNING_ONLY", ai_read: "METADATA_ONLY", recommended: true,
      match_reason: "Matched lesson: Fractions", match_level: "LESSON", match_rank: 80 };
    const initial = { teacher_choice: null, selected_resources: [], ai_suggestion: null };
    api.workspace.mockResolvedValue({ plan: initial, resources: [resource] });
    api.savePlan.mockImplementation(async (_id, plan) => ({ plan: { ...plan, ai_suggestion: api.advisory.mock.calls.length ? { recommended_format: "QUIZ", reason: "Focused practice may help.", focus: [], evidence_used: {} } : null }, resources: [resource] }));
    api.advisory.mockResolvedValue({ plan: { teacher_choice: null, selected_resources: [{ kind: "LESSON", id: 4 }], ai_suggestion: { recommended_format: "QUIZ", reason: "Focused practice may help.", focus: [], evidence_used: {} } }, resources: [resource] });
    mount("/teacher/interventions?active=12");
    const sheet = await screen.findByRole("complementary");
    fireEvent.click(await within(sheet).findByRole("button", { name: "Select resources" }));
    fireEvent.click(within(sheet).getByRole("checkbox"));
    await waitFor(() => expect(api.savePlan).toHaveBeenCalledWith(12, { teacher_choice: null, grade_treatment: null, selected_resources: [{ kind: "LESSON", id: 4 }] }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Prepare Remediation" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Get AI advisory" }));
    await waitFor(() => expect(api.advisory).toHaveBeenCalledWith(12));
    expect(await within(sheet).findByText(/Focused practice may help/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("radio", { name: /Classwork/ }));
    await waitFor(() => expect(api.savePlan).toHaveBeenLastCalledWith(12, { teacher_choice: "CLASSWORK", grade_treatment: "PRACTICE_ONLY", selected_resources: [{ kind: "LESSON", id: 4 }] }));
    expect(within(sheet).getByRole("radio", { name: /Practice only/ })).toHaveProperty("checked", true);
  });
  it("shows current progress separately from frozen evidence and recommends only matched materials", async () => {
    const base = { kind: "LESSON", description: "", lesson: "", topic: "", attachments: [], access: "PLANNING_ONLY", ai_read: "METADATA_ONLY" };
    api.workspace.mockResolvedValue({
      plan: { teacher_choice: "QUIZ", grade_treatment: null, selected_resources: [], ai_suggestion: null },
      focus: { basis: "FROZEN_TRIGGER_DIAGNOSIS", evidence_level: "COMPONENT_ONLY", component: "EXAMINATION", exam_subtype: "TERM_EXAM", exam_subtype_requires_confirmation: false,
        lesson_ids: [], lessons: [], competency_ids: [], competencies: [], topics: [], source_classwork_ids: [10], question_evidence: [], coverage_is_context_only: false },
      progress: { triggering_projection: 84.0167, latest_projection: 83.9926, latest_revision: 6, status: "ACTIVE",
        status_reason: "Latest projected final grade remains below 85.", completed_remediation: [{ title: "Practice Quiz", assignment_id: 12, grade: 10, total_points: 10 }],
        assigned_remediation: [{ title: "Practice Quiz", assignment_id: 12, grade: 10, total_points: 10, component: "WRITTEN_WORK", is_graded: true, submission_status: "graded" }] },
      resources: [{ ...base, id: 10, title: "Term Exam", recommended: false, match_rank: 60, match_level: "SOURCE_ACTIVITY", match_reason: "Source activity metadata; file contents were not analyzed" },
        { ...base, id: 11, title: "Unrelated Geometry", recommended: false, match_rank: 0, match_level: null, match_reason: null }],
    });
    mount("/teacher/interventions?active=12");
    const sheet = await screen.findByRole("complementary");
    expect(await within(sheet).findByText(/Latest projected final grade:/)).toBeTruthy();
    expect(within(sheet).getAllByText("83.99")).toHaveLength(2);
    expect(sheet.textContent).toContain("Practice Quiz");
    expect(sheet.textContent).toContain("10/10");
    expect(sheet.textContent).toContain("Recorded grade treatment: Written Work");
    expect(within(sheet).getAllByText(/Active · Monitoring/)).toHaveLength(2);
    fireEvent.click(within(sheet).getByText("Plan or adjust support"));
    fireEvent.click(within(sheet).getByRole("button", { name: "Select resources" }));
    expect(within(sheet).queryByText("Term Exam")).toBeNull();
    expect(within(sheet).queryByText("Unrelated Geometry")).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "Browse all eligible materials" }));
    expect(within(sheet).getByText("Term Exam")).toBeTruthy();
    expect(within(sheet).getByText("Unrelated Geometry")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Prepare Remediation" }));
    expect(within(sheet).getByText(/cannot currently be used as a new remedial grade slot/)).toBeTruthy();
    expect(api.advisory).not.toHaveBeenCalled();
  });
  it.each([
    ["QUIZ", "Existing Classwork page"],
    ["CLASSWORK", "Existing Classwork page"],
    ["TOS", "Existing TOS page"],
  ])("opens the existing %s authoring path", async (choice, destination) => {
    api.workspace.mockResolvedValue({ plan: { teacher_choice: choice, grade_treatment: choice === "TOS" ? null : "WRITTEN_WORK", selected_resources: [], ai_suggestion: null }, resources: [], focus: { component: "WRITTEN_WORK", evidence_level: "COMPONENT_ONLY", competency_ids: [], lessons: [], competencies: [], exam_subtype: null }, progress: { triggering_projection: 74, latest_projection: 74, completed_remediation: [], assigned_remediation: [], status_reason: "Latest projected final grade remains below 85." } });
    mount("/teacher/interventions?active=12");
    const sheet = await screen.findByRole("complementary");
    fireEvent.click(await within(sheet).findByRole("button", { name: "Prepare Remediation" }));
    if (choice === "TOS") {
      expect(within(sheet).getByText(/creates no graded student activity/)).toBeTruthy();
    } else {
      expect(within(sheet).getByText(/This student only/)).toBeTruthy();
    }
    fireEvent.click(within(sheet).getByRole("button", { name: /Continue to/ }));
    expect(await screen.findByText(destination)).toBeTruthy();
  });
  it("shows active empty, loading, and retry states independently", async () => {
    let release!: (value: { items: Array<typeof active>; total: number }) => void;
    api.activeList.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    mount("/teacher/interventions?view=active");
    expect(screen.getByLabelText("Loading active interventions")).toBeTruthy();
    release({ items: [], total: 0 });
    expect(await screen.findByText("No active interventions")).toBeTruthy();
  });
  it("offers retry when active listing fails", async () => {
    api.activeList.mockRejectedValueOnce(new Error("Active list unavailable"));
    mount("/teacher/interventions?view=active");
    expect(await screen.findByText(/Active list unavailable/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No active interventions")).toBeTruthy();
  });
});
