// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  RemediationWorkspace,
  TeacherInterventionDetail,
} from "@/lib/teacher-interventions-api";
import InterventionSupportMaterials, {
  type InterventionSupportMaterialsHandle,
} from "./intervention-support-materials";

const api = vi.hoisted(() => ({
  materials: vi.fn(),
  workspace: vi.fn(),
  savePlan: vi.fn(),
  advisory: vi.fn(),
  previewScore: vi.fn(),
}));

vi.mock("@/lib/teacher-interventions-api", async (original) => ({
  ...await original<typeof import("@/lib/teacher-interventions-api")>(),
  listSupportMaterials: api.materials,
  getRemediationWorkspace: api.workspace,
  saveRemediationPlan: api.savePlan,
  generateRemediationAdvisory: api.advisory,
  previewScoreAdjustment: api.previewScore,
}));

const detail = {
  intervention_id: 12,
  student_id: "s1",
  student_name: "Alex Rivera",
  student_lrn: "123",
  class_id: 7,
  class_name: "Archimedes",
  subject_id: 5,
  subject_name: "Mathematics",
  academic_period_id: 3,
  academic_period_name: "Term 1",
  status: "ACTIVE",
  source_prediction_id: 41,
  source_prediction_revision: 2,
  triggering_predicted_grade: 74,
  triggering_intervention_level: "HIGH_RISK",
  created_at: "2026-09-25T00:00:00Z",
  activated_at: "2026-09-26T00:00:00Z",
  activated_by_staff_id: "T-001",
  resolved_at: null,
  resolution_reason: null,
  diagnosis_summary: { weakest_supported_components: ["WRITTEN_WORK"] },
  diagnosis_snapshot: {
    weakest_supported_components: ["WRITTEN_WORK"],
    components: { WRITTEN_WORK: { evidence_state: "AVAILABLE", percent: 61 } },
    supporting_activities: [],
  },
} as TeacherInterventionDetail;

const workspace: RemediationWorkspace = {
  plan: {
    teacher_choice: null,
    grade_treatment: null,
    selected_resources: [],
    ai_suggestion: null,
  },
  resources: [],
  focus: {
    basis: "FROZEN_TRIGGER_DIAGNOSIS",
    evidence_level: "SCORED_COMPETENCY",
    component: "WRITTEN_WORK",
    exam_subtype: null,
    exam_subtype_requires_confirmation: false,
    lesson_ids: [],
    lessons: [],
    competency_ids: [],
    competencies: [],
    topics: [],
    source_classwork_ids: [],
    question_evidence: [],
    coverage_is_context_only: false,
  },
  progress: {
    triggering_projection: 74,
    latest_projection: 74,
    latest_revision: 2,
    completed_remediation: [],
    assigned_remediation: [],
    status: "ACTIVE",
    status_reason: "Latest projected final grade remains below 85.",
  },
  original_exams: [],
};

describe("teacher remediation recommendation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.materials.mockResolvedValue({ items: [], total: 0 });
    api.workspace.mockResolvedValue(workspace);
    api.savePlan.mockImplementation(async (_id, plan) => ({
      ...workspace,
      plan: { ...workspace.plan, ...plan, ai_suggestion: null },
    }));
    api.advisory.mockResolvedValue({
      ...workspace,
      plan: {
        ...workspace.plan,
        ai_suggestion: {
          recommended_format: "QUIZ",
          reason: "Focused practice may support the measured component.",
          focus: [],
          evidence_used: {},
        },
      },
    });
  });

  afterEach(cleanup);

  it("marks and auto-selects a valid recommendation without replacing a manual choice", async () => {
    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detail} page="plan" />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Get AI recommendation" }));
    await waitFor(() => expect(api.advisory).toHaveBeenCalledWith(12));
    expect(api.savePlan).toHaveBeenCalledWith(12, {
      teacher_choice: null,
      grade_treatment: null,
      selected_resources: [],
    });
    expect(api.savePlan.mock.invocationCallOrder[0]).toBeLessThan(
      api.advisory.mock.invocationCallOrder[0]
    );

    const quizCard = screen.getByText("Quiz").closest(".cursor-pointer");
    expect(quizCard).not.toBeNull();
    expect(within(quizCard as HTMLElement).getByText("Recommended")).toBeTruthy();
    expect(within(quizCard as HTMLElement).getByText("Selected")).toBeTruthy();
    expect(screen.queryByText("AI Advisory")).toBeNull();

    const classworkCard = screen.getByText("Classwork").closest(".cursor-pointer");
    fireEvent.click(classworkCard as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Refresh AI recommendation" }));
    await waitFor(() => expect(api.advisory).toHaveBeenCalledTimes(2));
    expect(api.savePlan).toHaveBeenLastCalledWith(12, {
      teacher_choice: "CLASSWORK",
      grade_treatment: "PRACTICE_ONLY",
      selected_resources: [],
    });

    expect(within(classworkCard as HTMLElement).getByText("Selected")).toBeTruthy();
    expect(within(quizCard as HTMLElement).queryByText("Selected")).toBeNull();
    expect(within(quizCard as HTMLElement).getByText("Recommended")).toBeTruthy();
  });

  it("shows an inline fallback when AI advice is unavailable", async () => {
    api.advisory.mockRejectedValue(new Error("Recommendation service is temporarily unavailable."));
    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detail} page="plan" />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Get AI recommendation" }));

    expect((await screen.findByRole("status")).textContent).toContain(
      "Recommendation service is temporarily unavailable."
    );
    expect(screen.queryByText("Recommended")).toBeNull();
  });

  it("restores a valid saved recommendation as an AI-selected choice", async () => {
    api.workspace.mockResolvedValue({
      ...workspace,
      plan: {
        ...workspace.plan,
        ai_suggestion: {
          recommended_format: "TOS",
          reason: "A blueprint may support focused planning.",
          focus: [],
          evidence_used: {},
        },
      },
    });
    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detail} page="plan" />
      </MemoryRouter>
    );

    const tosCard = (await screen.findByText("TOS Blueprint")).closest(".cursor-pointer");
    expect(within(tosCard as HTMLElement).getByText("Recommended")).toBeTruthy();
    expect(within(tosCard as HTMLElement).getByText("Selected")).toBeTruthy();
    expect(api.advisory).not.toHaveBeenCalled();
  });
});

describe("teacher intervention persistence integration", () => {
  const detailWithClassworks: TeacherInterventionDetail = {
    ...detail,
    diagnosis_snapshot: {
      weakest_supported_components: ["WRITTEN_WORK"],
      components: {
        WRITTEN_WORK: { evidence_state: "AVAILABLE", percent: 61 },
        PERFORMANCE_TASK: { evidence_state: "AVAILABLE", percent: 65 },
      },
      supporting_activities: [
        {
          classwork_id: 101,
          title: "Worksheet 1",
          component: "WRITTEN_WORK",
          score: 10,
          possible_score: 20,
          percent: 50,
        },
        {
          classwork_id: 102,
          title: "Worksheet 2",
          component: "WRITTEN_WORK",
          score: 8,
          possible_score: 20,
          percent: 40,
        },
        {
          classwork_id: 201,
          title: "Performance Task 1",
          component: "PERFORMANCE_TASK",
          score: 12,
          possible_score: 20,
          percent: 60,
        },
      ],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    api.materials.mockResolvedValue({ items: [], total: 0 });
    api.workspace.mockResolvedValue({
      ...workspace,
      plan: {
        teacher_choice: "CLASSWORK",
        grade_treatment: "WRITTEN_WORK",
        selected_resources: [],
        ai_suggestion: null,
      },
    });
    api.savePlan.mockImplementation(async (_id, plan) => ({
      ...workspace,
      plan: { ...workspace.plan, ...plan, ai_suggestion: null },
    }));
    api.previewScore.mockImplementation(async (id, req) => {
      const cap = req.score_adjustment_cap ?? 75;
      return {
        score_adjustment_cap: cap,
        previews: (req.target_assignment_ids ?? []).map((tid: number) => {
          const orig = tid === 101 ? 10 : tid === 102 ? 8 : 12;
          const maxPts = 20;
          const maxAdj = Math.min(maxPts, (maxPts * cap) / 100);
          const eff = Math.max(orig, maxAdj);
          return {
            assignment_id: tid,
            title: tid === 101 ? "Worksheet 1" : tid === 102 ? "Worksheet 2" : "Performance Task 1",
            original_score: orig,
            max_points: maxPts,
            cap_percentage: cap,
            max_adjusted_score: eff,
            possible_gain: eff - orig,
            was_adjusted: eff > orig,
            was_capped: eff === maxAdj,
          };
        }),
        disclaimer: "Hypothetical maximum achievable adjusted scores based on selected cap. Not actual awarded grades.",
      };
    });
  });

  afterEach(cleanup);

  it("loads and restores saved target_assignment_ids and score_adjustment_cap", async () => {
    api.workspace.mockResolvedValue({
      ...workspace,
      plan: {
        teacher_choice: "CLASSWORK",
        grade_treatment: "WRITTEN_WORK",
        target_assignment_ids: [101, 102],
        score_adjustment_cap: 80,
        selected_resources: [],
        ai_suggestion: null,
      },
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    expect(await screen.findByText("80% Cap")).toBeTruthy();
    expect(screen.getByText("Worksheet 1")).toBeTruthy();
    expect(screen.getByText("Worksheet 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reselect Activities" }));
    const dialog = await screen.findByRole("dialog", { name: "Select Targeted Classwork" });

    expect(within(dialog).queryByText("93%")).toBeNull();
    expect(within(dialog).getByText("Projected Grade Preview")).toBeTruthy();
    expect(within(dialog).getByText("Unavailable")).toBeTruthy();

    const capInput = within(dialog).getByLabelText(/Score Adjustment Cap/i) as HTMLInputElement;
    expect(capInput.value).toBe("80");
  });

  it("selects multiple targets, updates adjustment cap, and saves via saveAdjustments", async () => {
    const ref = createRef<InterventionSupportMaterialsHandle>();
    render(
      <MemoryRouter>
        <InterventionSupportMaterials ref={ref} detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    expect(await screen.findByText("75% Cap")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Select Classwork" }));
    const dialog = await screen.findByRole("dialog", { name: "Select Targeted Classwork" });

    const capInput = within(dialog).getByLabelText(/Score Adjustment Cap/i) as HTMLInputElement;
    fireEvent.change(capInput, { target: { value: "85" } });
    expect(capInput.value).toBe("85");

    fireEvent.click(within(dialog).getByText("Worksheet 1").closest(".cursor-pointer") as HTMLElement);
    fireEvent.click(within(dialog).getByText("Worksheet 2").closest(".cursor-pointer") as HTMLElement);

    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    expect(screen.getByText("85% Cap")).toBeTruthy();

    const success = await ref.current?.saveAdjustments();
    expect(success).toBe(true);

    expect(api.savePlan).toHaveBeenCalledWith(12, {
      teacher_choice: "CLASSWORK",
      grade_treatment: "WRITTEN_WORK",
      target_assignment_ids: [101, 102],
      score_adjustment_cap: 85,
      selected_resources: [],
    });
  });

  it("rejects 100% Full Replacement and invalid caps, preventing save", async () => {
    const ref = createRef<InterventionSupportMaterialsHandle>();
    render(
      <MemoryRouter>
        <InterventionSupportMaterials ref={ref} detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findByText("75% Cap");
    fireEvent.click(screen.getByRole("button", { name: "Select Classwork" }));
    const dialog = await screen.findByRole("dialog", { name: "Select Targeted Classwork" });

    const capInput = within(dialog).getByLabelText(/Score Adjustment Cap/i) as HTMLInputElement;

    fireEvent.change(capInput, { target: { value: "100" } });
    expect(
      within(dialog).getByText(
        "Full Replacement (100%) is not permitted under remediation policy. Cap must be less than 100%."
      )
    ).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    expect(screen.getByText("Invalid Cap")).toBeTruthy();

    const saveResult100 = await ref.current?.saveAdjustments();
    expect(saveResult100).toBe(false);
    expect(api.savePlan).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Select Classwork" }));
    const reOpenedDialog = await screen.findByRole("dialog", { name: "Select Targeted Classwork" });
    const capInputReopened = within(reOpenedDialog).getByLabelText(/Score Adjustment Cap/i) as HTMLInputElement;
    fireEvent.change(capInputReopened, { target: { value: "-10" } });
    expect(within(reOpenedDialog).getByText("Cap cannot be negative.")).toBeTruthy();

    fireEvent.click(within(reOpenedDialog).getByRole("button", { name: "Done" }));
    const saveResultNegative = await ref.current?.saveAdjustments();
    expect(saveResultNegative).toBe(false);
    expect(api.savePlan).not.toHaveBeenCalled();
  });

  it("preserves category restrictions when switching grade treatment", async () => {
    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findByText("75% Cap");

    fireEvent.click(screen.getByRole("button", { name: "Select Classwork" }));
    const dialog = await screen.findByRole("dialog", { name: "Select Targeted Classwork" });
    fireEvent.click(within(dialog).getByText("Worksheet 1").closest(".cursor-pointer") as HTMLElement);
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    expect(screen.getByText("Worksheet 1")).toBeTruthy();

    const ptCard = screen.getByText("Performance Task").closest(".cursor-pointer");
    fireEvent.click(ptCard as HTMLElement);

    expect(screen.queryByText("Worksheet 1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Select Classwork" }));
    const ptDialog = await screen.findByRole("dialog", { name: "Select Targeted Classwork" });

    expect(within(ptDialog).getByText("Performance Task 1")).toBeTruthy();
    expect(within(ptDialog).queryByText("Worksheet 1")).toBeNull();
    expect(within(ptDialog).queryByText("Worksheet 2")).toBeNull();
  });

  it("handles save errors gracefully without losing selections", async () => {
    api.savePlan.mockRejectedValueOnce(new Error("Database connection conflict"));
    const ref = createRef<InterventionSupportMaterialsHandle>();

    render(
      <MemoryRouter>
        <InterventionSupportMaterials ref={ref} detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findByText("75% Cap");

    fireEvent.click(screen.getByRole("button", { name: "Select Classwork" }));
    const dialog = await screen.findByRole("dialog", { name: "Select Targeted Classwork" });
    const capInput = within(dialog).getByLabelText(/Score Adjustment Cap/i) as HTMLInputElement;
    fireEvent.change(capInput, { target: { value: "80" } });
    fireEvent.click(within(dialog).getByText("Worksheet 1").closest(".cursor-pointer") as HTMLElement);
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    const success = await ref.current?.saveAdjustments();
    expect(success).toBe(false);

    expect(screen.getByText("80% Cap")).toBeTruthy();
    expect(screen.getByText("Worksheet 1")).toBeTruthy();
  });

  it("displays checked recommended supporting resources under Teacher Selected Materials instead of No materials selected", async () => {
    api.workspace.mockResolvedValue({
      ...workspace,
      plan: {
        teacher_choice: "CLASSWORK",
        grade_treatment: "WRITTEN_WORK",
        selected_resources: [],
        ai_suggestion: null,
      },
      resources: [
        {
          id: 501,
          kind: "LESSON",
          title: "Algebra Foundation Drills",
          recommended: true,
          match_level: "SCORED_COMPETENCY",
          lesson: "Algebra Basics",
          is_graded: false,
        },
      ],
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    expect(await screen.findByText("No materials selected")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Select resources" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Supporting Resources" });

    const drillMatches = within(dialog).getAllByText("Algebra Foundation Drills");
    expect(drillMatches.length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("Recommended").length).toBeGreaterThan(0);

    fireEvent.click(drillMatches[0].closest(".cursor-pointer") as HTMLElement);
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    expect(screen.queryByText("No materials selected")).toBeNull();
    expect(screen.getByText("Algebra Foundation Drills")).toBeTruthy();
    expect(
      screen.getByText((content) => content.includes("Materials are linked to") && content.includes("Algebra Basics"))
    ).toBeTruthy();
  });

  it("excludes graded quizzes and assignments from study-material recommendations and pool while including lessons and readings", async () => {
    api.workspace.mockResolvedValue({
      ...workspace,
      plan: {
        teacher_choice: "CLASSWORK",
        grade_treatment: "WRITTEN_WORK",
        selected_resources: [],
        ai_suggestion: null,
      },
      resources: [
        {
          id: 601,
          kind: "CLASSWORK",
          classwork_type: "QUIZ",
          is_graded: true,
          title: "Chapter 3 Quiz",
          recommended: false,
          match_level: null,
          lesson: "Algebra Basics",
        },
        {
          id: 602,
          kind: "CLASSWORK",
          classwork_type: "ASSIGNMENT",
          is_graded: true,
          title: "Homework Assignment 2",
          recommended: false,
          match_level: null,
          lesson: "Algebra Basics",
        },
        {
          id: 603,
          kind: "LESSON",
          title: "Linear Equations Lesson",
          recommended: true,
          match_level: "SCORED_COMPETENCY",
          lesson: "Linear Equations",
          is_graded: false,
        },
        {
          id: 604,
          kind: "CLASSWORK",
          classwork_type: "READING",
          is_graded: false,
          title: "Study Guide Reading",
          recommended: true,
          match_level: "SCORED_COMPETENCY",
          lesson: "Linear Equations",
        },
      ],
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Select resources" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Supporting Resources" });

    // Graded quiz and assignment must NOT appear in the study-material selection dialog
    expect(within(dialog).queryByText("Chapter 3 Quiz")).toBeNull();
    expect(within(dialog).queryByText("Homework Assignment 2")).toBeNull();

    // Instructional lesson and non-graded reading MUST appear
    expect(within(dialog).getAllByText("Linear Equations Lesson").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("Study Guide Reading").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("Lesson").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("Reading").length).toBeGreaterThan(0);
  });

  it("displays original score, max achievable adjusted score, and possible score gain based on cap, updating dynamically", async () => {
    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findByText("75% Cap");

    fireEvent.click(screen.getByRole("button", { name: "Select Classwork" }));
    const dialog = await screen.findByRole("dialog", { name: "Select Targeted Classwork" });

    fireEvent.click(within(dialog).getByText("Worksheet 1").closest(".cursor-pointer") as HTMLElement);

    await waitFor(() => {
      expect(within(dialog).getByText("Score Adjustment Preview")).toBeTruthy();
      expect(within(dialog).getByText("Selected: Worksheet 1")).toBeTruthy();
      expect(within(dialog).getByText("15/20")).toBeTruthy();
      expect(within(dialog).getByText("+5")).toBeTruthy();
      expect(
        within(dialog).getByText("Hypothetical maximum only · Not an actual awarded grade.")
      ).toBeTruthy();
    });

    const preset80 = within(dialog).getByRole("button", { name: "80%" });
    fireEvent.click(preset80);

    await waitFor(() => {
      expect(within(dialog).getByText("16/20")).toBeTruthy();
      expect(within(dialog).getByText("+6")).toBeTruthy();
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(screen.getByText("80% Cap")).toBeTruthy();
      expect(screen.getByText("Worksheet 1")).toBeTruthy();
      expect(screen.getByText("16/20")).toBeTruthy();
      expect(screen.getByText("+6")).toBeTruthy();
      expect(
        screen.getByText("Hypothetical maximum only · Not an actual awarded grade")
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reselect Activities" }));
    const reDialog = await screen.findByRole("dialog", { name: "Select Targeted Classwork" });
    expect(within(reDialog).getByText("Projected Grade Preview")).toBeTruthy();
    expect(within(reDialog).getByText("Unavailable")).toBeTruthy();
  });

  it("persists classwork_assignment_id targets and restores score preview upon reopening", async () => {
    api.workspace.mockResolvedValue({
      ...workspace,
      plan: {
        teacher_choice: "CLASSWORK",
        grade_treatment: "WRITTEN_WORK",
        target_assignment_ids: [101],
        score_adjustment_cap: 85,
        selected_resources: [],
        ai_suggestion: null,
      },
      score_previews: [
        {
          assignment_id: 101,
          title: "Worksheet 1",
          original_score: 10,
          max_points: 20,
          cap_percentage: 85,
          max_adjusted_score: 17,
          possible_gain: 7,
          was_adjusted: true,
          was_capped: true,
        },
      ],
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    expect(await screen.findByText("85% Cap")).toBeTruthy();
    expect(screen.getByText("Worksheet 1")).toBeTruthy();
    expect(screen.getByText("17/20")).toBeTruthy();
    expect(screen.getByText("+7")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reselect Activities" }));
    const dialog = await screen.findByRole("dialog", { name: "Select Targeted Classwork" });

    const capInput = within(dialog).getByLabelText(/Score Adjustment Cap/i) as HTMLInputElement;
    expect(capInput.value).toBe("85");

    const cwRow = within(dialog).getByText("Worksheet 1").closest(".cursor-pointer") as HTMLElement;
    const checkbox = within(cwRow).getByRole("checkbox");
    expect(checkbox.getAttribute("data-state")).toBe("checked");
    expect(checkbox.getAttribute("aria-checked")).toBe("true");

    expect(within(dialog).getByText("17/20")).toBeTruthy();
    expect(within(dialog).getByText("+7")).toBeTruthy();
  });

  it("calculates 10/20 at 85% cap as 17/20 with +7 gain and displays unavailable state when preview data is absent", async () => {
    // 1. Initial state with default 75% cap and no previews returned by backend
    api.previewScore.mockResolvedValueOnce({
      score_adjustment_cap: 75,
      previews: [],
      disclaimer: "Hypothetical maximum only",
    });

    api.workspace.mockResolvedValue({
      ...workspace,
      plan: {
        teacher_choice: "CLASSWORK",
        grade_treatment: "WRITTEN_WORK",
        target_assignment_ids: [101],
        score_adjustment_cap: 75,
        selected_resources: [],
        ai_suggestion: null,
      },
      score_previews: [],
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    // When preview is unavailable, must NOT show original score (10/20) as calculated adjusted max or +0
    await screen.findByText("Worksheet 1");
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText("+0")).toBeNull();

    // 2. Open dialog and trigger preview calculation with 85% cap
    fireEvent.click(screen.getByRole("button", { name: "Reselect Activities" }));
    const dialog = await screen.findByRole("dialog", { name: "Select Targeted Classwork" });

    api.previewScore.mockResolvedValueOnce({
      score_adjustment_cap: 85,
      previews: [
        {
          assignment_id: 101,
          title: "Worksheet 1",
          original_score: 10,
          max_points: 20,
          cap_percentage: 85,
          max_adjusted_score: 17,
          possible_gain: 7,
          was_adjusted: true,
          was_capped: true,
        },
      ],
      disclaimer: "Hypothetical maximum achievable adjusted scores based on selected cap. Not actual awarded grades.",
    });

    const preset85 = within(dialog).getByRole("button", { name: "85%" });
    fireEvent.click(preset85);

    await waitFor(() => {
      expect(within(dialog).getByText("17/20")).toBeTruthy();
      expect(within(dialog).getByText("+7")).toBeTruthy();
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(screen.getByText("17/20")).toBeTruthy();
      expect(screen.getByText("+7")).toBeTruthy();
    });
  });
});

