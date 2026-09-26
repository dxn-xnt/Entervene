// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeacherInterventions from "./interventions";
import { InterventionApiError } from "@/lib/teacher-interventions-api";

const api = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), activate: vi.fn() }));
vi.mock("@/lib/teacher-interventions-api", async (original) => ({
  ...await original<typeof import("@/lib/teacher-interventions-api")>(),
  listTeacherCandidates: api.list, getTeacherCandidate: api.detail, activateTeacherCandidate: api.activate,
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

function mount(path = "/teacher/interventions") {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/teacher/interventions" element={<TeacherInterventions />} /></Routes></MemoryRouter>);
}
beforeEach(() => { api.list.mockResolvedValue({ items: [candidate], total: 1 }); api.detail.mockResolvedValue(detail); api.activate.mockResolvedValue({ ...detail, status: "ACTIVE" }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

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
    expect(await screen.findByText("Individual competency scores are unavailable in this saved diagnosis.")).toBeTruthy();
  });
  it("activates through the teacher API and refreshes the list", async () => {
    api.list.mockResolvedValueOnce({ items: [candidate], total: 1 }).mockResolvedValueOnce({ items: [], total: 0 });
    mount("/teacher/interventions?candidate=12");
    fireEvent.click(await screen.findByRole("button", { name: "Approve Intervention" }));
    await waitFor(() => expect(api.activate).toHaveBeenCalledWith(12));
    expect(await screen.findByText(/Intervention approved for Alex Rivera/)).toBeTruthy();
    expect(await screen.findByText("No candidates to review")).toBeTruthy();
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
  });
  it("explains lost teacher scope", async () => {
    api.activate.mockRejectedValue(new InterventionApiError(403, "Forbidden"));
    mount("/teacher/interventions?candidate=12");
    fireEvent.click(await screen.findByRole("button", { name: "Approve Intervention" }));
    expect(await screen.findByText(/no longer have teaching access/i)).toBeTruthy();
  });
});
