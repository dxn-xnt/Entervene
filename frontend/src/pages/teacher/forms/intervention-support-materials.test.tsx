// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  InterventionApiError,
  type RemediationQuizDraft,
  type RemediationClassworkDraft,
  type RemediationWorkspace,
  type TeacherInterventionDetail,
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
  projectGrade: vi.fn(),
  generateDraft: vi.fn(),
  preflightDraft: vi.fn(),
  createAssessment: vi.fn(),
}));

vi.mock("@/lib/teacher-interventions-api", async (original) => ({
  ...await original<typeof import("@/lib/teacher-interventions-api")>(),
  listSupportMaterials: api.materials,
  getRemediationWorkspace: api.workspace,
  saveRemediationPlan: api.savePlan,
  generateRemediationAdvisory: api.advisory,
  previewScoreAdjustment: api.previewScore,
  projectSubjectGrade: api.projectGrade,
  generateRemediationDraft: api.generateDraft,
  preflightRemediationDraft: api.preflightDraft,
  createRemediationAssessment: api.createAssessment,
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
          recommended_grade_treatment: "WRITTEN_WORK",
          reason: "Focused practice may support the measured component.",
          focus: [],
          evidence_used: {},
        },
      },
    });
    api.projectGrade.mockResolvedValue({
      status: "UNAVAILABLE",
      grade_representation: "TRANSMUTED_TERM_GRADE",
      current_subject_grade: null,
      passing_threshold: 75,
      target_projections: [],
      eligible_target_gains: [],
      additional_eligible_targets_have_positive_improvement: false,
      recommended_target_assignment_id: null,
      assumptions: [],
      unavailable_reasons: [{ code: "INCOMPLETE_EXAMINATION_EVIDENCE", message: "Incomplete examination evidence." }],
      ai_midterm_what_if: {
        status: "UNAVAILABLE",
        estimate_kind: "AI_MIDTERM_WHAT_IF_ESTIMATE",
        is_official_grade: false,
        is_guaranteed: false,
        baseline_predicted_term_grade: null,
        readiness: {},
        target_estimates: [],
        unavailable_reasons: [{ code: "INSUFFICIENT_EVIDENCE", message: "Insufficient activities." }],
        limitations: [],
      },
    });
  });

  afterEach(cleanup);

  it("automatically displays exactly one Recommended badge and keeps teacher selection independent", async () => {
    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detail} page="plan" />
      </MemoryRouter>
    );

    await waitFor(() => expect(api.advisory).toHaveBeenCalledWith(12));
    expect(screen.queryByRole("button", { name: /AI recommendation/i })).toBeNull();

    const methodGroup = screen.getByRole("radiogroup", { name: "Remediation activity method" });
    const quizCard = within(methodGroup).getByText("Quiz").closest(".cursor-pointer");
    expect(quizCard).not.toBeNull();
    expect(await within(quizCard as HTMLElement).findByText("Recommended")).toBeTruthy();
    expect(within(methodGroup).getAllByText("Recommended")).toHaveLength(1);
    expect(api.advisory).toHaveBeenCalledTimes(1);
    expect(within(quizCard as HTMLElement).queryByText("Selected")).toBeNull();

    const classworkCard = within(methodGroup).getByText("Classwork").closest(".cursor-pointer");
    fireEvent.click(classworkCard as HTMLElement);

    expect(classworkCard?.getAttribute("aria-checked")).toBe("true");
    expect(within(methodGroup).queryByText("Selected")).toBeNull();
    expect(within(quizCard as HTMLElement).getByText("Recommended")).toBeTruthy();

    fireEvent.click(quizCard as HTMLElement);
    expect(quizCard?.getAttribute("aria-checked")).toBe("true");
    expect(within(quizCard as HTMLElement).getByText("Recommended")).toBeTruthy();
    expect(within(methodGroup).queryByText("Selected")).toBeNull();
  });

  it("shows an inline fallback when AI advice is unavailable", async () => {
    api.advisory.mockRejectedValue(new Error("Recommendation service is temporarily unavailable."));
    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detail} page="plan" />
      </MemoryRouter>
    );

    expect((await screen.findByRole("status")).textContent).toContain(
      "Recommendation service is temporarily unavailable."
    );
    expect(screen.queryByText("Recommended")).toBeNull();
  });

  it("does not present a saved TOS suggestion as assignable AI remediation", async () => {
    api.workspace.mockResolvedValue({
      ...workspace,
      plan: {
        ...workspace.plan,
        ai_suggestion: {
          recommended_format: "TOS",
          recommended_grade_treatment: null,
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
    expect(within(tosCard as HTMLElement).queryByText("Recommended")).toBeNull();
    expect(within(tosCard as HTMLElement).getByText(/Teacher planning and export only/i)).toBeTruthy();
    await waitFor(() => expect(api.advisory).toHaveBeenCalledWith(12));
    const quizCard = screen.getByText("Quiz").closest(".cursor-pointer");
    expect(await within(quizCard as HTMLElement).findByText("Recommended")).toBeTruthy();
  });

  it("retries a failed recommendation when Adjust Support is reopened", async () => {
    api.advisory
      .mockRejectedValueOnce(new Error("Recommendation service is temporarily unavailable."))
      .mockResolvedValueOnce({
        ...workspace,
        plan: {
          ...workspace.plan,
          ai_suggestion: {
            recommended_format: "CLASSWORK",
            recommended_grade_treatment: "WRITTEN_WORK",
            reason: "Targeted classwork supports the verified evidence.",
            focus: [],
            evidence_used: {},
          },
        },
      });
    const view = render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detail} page="plan" />
      </MemoryRouter>
    );

    expect((await screen.findByRole("status")).textContent).toContain(
      "Recommendation service is temporarily unavailable."
    );
    view.rerender(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detail} page="overview" />
      </MemoryRouter>
    );
    view.rerender(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detail} page="plan" />
      </MemoryRouter>
    );

    await waitFor(() => expect(api.advisory).toHaveBeenCalledTimes(2));
    const classworkCard = screen.getByText("Classwork").closest(".cursor-pointer");
    expect(await within(classworkCard as HTMLElement).findByText("Recommended")).toBeTruthy();
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
          classwork_assignment_id: 101,
          title: "Worksheet 1",
          component: "WRITTEN_WORK",
          score: 10,
          possible_score: 20,
          percent: 50,
        },
        {
          classwork_id: 102,
          classwork_assignment_id: 102,
          title: "Worksheet 2",
          component: "WRITTEN_WORK",
          score: 8,
          possible_score: 20,
          percent: 40,
        },
        {
          classwork_id: 201,
          classwork_assignment_id: 201,
          title: "Performance Task 1",
          component: "PERFORMANCE_TASK",
          score: 12,
          possible_score: 20,
          percent: 60,
        },
      ],
    },
  };

  const mockItemBasedPreviews = () => {
    api.previewScore.mockImplementation(async (_id, req) => ({
      score_adjustment_cap: req.score_adjustment_cap,
      previews: (req.items ?? []).map((item: {
        assignment_id: number;
        original_score: number;
        max_points: number;
        title: string;
      }) => {
        const maximum = (item.max_points * req.score_adjustment_cap) / 100;
        const adjusted = Math.max(item.original_score, maximum);
        return {
          assignment_id: item.assignment_id,
          title: item.title,
          original_score: item.original_score,
          max_points: item.max_points,
          cap_percentage: req.score_adjustment_cap,
          max_adjusted_score: adjusted,
          possible_gain: adjusted - item.original_score,
          was_adjusted: adjusted > item.original_score,
          was_capped: adjusted === maximum,
        };
      }),
      disclaimer: "Hypothetical maximum only",
    }));
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
    api.advisory.mockResolvedValue({
      ...workspace,
      plan: {
        ...workspace.plan,
        ai_suggestion: {
          recommended_format: "QUIZ",
          recommended_grade_treatment: "WRITTEN_WORK",
          reason: "Focused practice may support the measured component.",
          focus: [],
          evidence_used: {},
        },
      },
    });
    api.projectGrade.mockResolvedValue({
      status: "UNAVAILABLE",
      grade_representation: "TRANSMUTED_TERM_GRADE",
      current_subject_grade: null,
      passing_threshold: 75,
      target_projections: [],
      eligible_target_gains: [],
      additional_eligible_targets_have_positive_improvement: false,
      recommended_target_assignment_id: null,
      assumptions: [],
      unavailable_reasons: [{ code: "INCOMPLETE_EXAMINATION_EVIDENCE", message: "Incomplete examination evidence." }],
      ai_midterm_what_if: {
        status: "UNAVAILABLE",
        estimate_kind: "AI_MIDTERM_WHAT_IF_ESTIMATE",
        is_official_grade: false,
        is_guaranteed: false,
        baseline_predicted_term_grade: null,
        readiness: {},
        target_estimates: [],
        unavailable_reasons: [{ code: "INSUFFICIENT_EVIDENCE", message: "Insufficient activities." }],
        limitations: [],
      },
    });
    api.previewScore.mockImplementation(async (_id, req) => {
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
    expect(within(dialog).getByText("Projected Grade")).toBeTruthy();
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

  it("shows only the verified Written Work treatment and targets", async () => {
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
    expect(screen.queryByText("Performance Task")).toBeNull();
    expect(within(dialog).queryByText("Performance Task 1")).toBeNull();
  });

  it("shows only the verified Performance Task treatment and targets", async () => {
    api.workspace.mockResolvedValue({
      ...workspace,
      focus: { ...workspace.focus, component: "PERFORMANCE_TASK" },
      plan: {
        teacher_choice: "CLASSWORK",
        grade_treatment: "PERFORMANCE_TASK",
        selected_resources: [],
        ai_suggestion: null,
      },
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findByText("How should this activity be treated?");
    expect(
      screen.getAllByText("Performance Task").some((item) =>
        Boolean(item.closest(".cursor-pointer"))
      )
    ).toBe(true);
    expect(screen.queryByText("Written Work")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Select Classwork" }));
    const dialog = await screen.findByRole("dialog", { name: "Select Targeted Classwork" });
    expect(within(dialog).getByText("Performance Task 1")).toBeTruthy();
    expect(within(dialog).queryByText("Worksheet 1")).toBeNull();
    expect(within(dialog).queryByText("Worksheet 2")).toBeNull();
  });

  it("reconciles a legacy graded selection locally when focus is ambiguous", async () => {
    api.workspace.mockResolvedValue({
      ...workspace,
      focus: { ...workspace.focus, component: null },
      plan: {
        teacher_choice: "CLASSWORK",
        grade_treatment: "WRITTEN_WORK",
        target_assignment_ids: [101],
        selected_resources: [],
        ai_suggestion: null,
      },
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    expect(await screen.findByText(/No single verified weakest grading component/)).toBeTruthy();
    expect(screen.getByText("Ungraded Activity")).toBeTruthy();
    expect(screen.queryByText("Written Work")).toBeNull();
    expect(screen.queryByText("Performance Task")).toBeNull();
    expect(screen.queryByText("Worksheet 1")).toBeNull();
    expect(api.savePlan).not.toHaveBeenCalled();
  });

  it("recommends the eligible focused target with the greatest positive gain without selecting it", async () => {
    mockItemBasedPreviews();
    const ptDetail: TeacherInterventionDetail = {
      ...detailWithClassworks,
      diagnosis_snapshot: {
        ...detailWithClassworks.diagnosis_snapshot,
        weakest_supported_components: ["PERFORMANCE_TASK"],
        supporting_activities: [
          { classwork_id: 301, classwork_assignment_id: 3001, title: "PT 1", component: "PERFORMANCE_TASK", score: 31, possible_score: 40, percent: 77.5 },
          { classwork_id: 302, classwork_assignment_id: 3002, title: "PT 2", component: "PERFORMANCE_TASK", score: 30, possible_score: 40, percent: 75 },
          { classwork_id: 303, classwork_assignment_id: 3003, title: "PT 3", component: "PERFORMANCE_TASK", score: 10, possible_score: 40, percent: 25 },
        ],
      },
    };
    api.workspace.mockResolvedValue({
      ...workspace,
      focus: { ...workspace.focus, component: "PERFORMANCE_TASK" },
      plan: { ...workspace.plan, teacher_choice: "CLASSWORK", grade_treatment: "PERFORMANCE_TASK" },
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={ptDetail} page="plan" />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Select Classwork" }));
    const dialog = await screen.findByRole("dialog", { name: "Select Targeted Classwork" });
    const pt1Row = within(dialog).getByText("PT 1").closest(".cursor-pointer") as HTMLElement;
    const pt3Row = within(dialog).getByText("PT 3").closest(".cursor-pointer") as HTMLElement;
    expect(await within(pt3Row).findByText("Recommended")).toBeTruthy();
    expect(api.previewScore).toHaveBeenCalledWith(12, expect.objectContaining({
      target_assignment_ids: [3001, 3002, 3003],
      score_adjustment_cap: 75,
    }));
    expect(within(pt1Row).queryByText("Recommended")).toBeNull();
    expect(within(pt3Row).getByRole("checkbox").getAttribute("data-state")).toBe("unchecked");

    fireEvent.click(pt1Row);
    expect(within(pt1Row).getByRole("checkbox").getAttribute("data-state")).toBe("checked");
    expect(within(pt3Row).getByText("Recommended")).toBeTruthy();
    expect(within(pt3Row).getByRole("checkbox").getAttribute("data-state")).toBe("unchecked");
  });

  it("recalculates the recommendation when the adjustment cap changes", async () => {
    mockItemBasedPreviews();
    const capDetail: TeacherInterventionDetail = {
      ...detailWithClassworks,
      diagnosis_snapshot: {
        ...detailWithClassworks.diagnosis_snapshot,
        supporting_activities: [
          { classwork_id: 401, classwork_assignment_id: 4001, title: "Large Written Work", component: "WRITTEN_WORK", score: 70, possible_score: 100, percent: 70 },
          { classwork_id: 402, classwork_assignment_id: 4002, title: "Short Written Work", component: "WRITTEN_WORK", score: 20, possible_score: 40, percent: 50 },
        ],
      },
    };

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={capDetail} page="plan" />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Select Classwork" }));
    const dialog = await screen.findByRole("dialog", { name: "Select Targeted Classwork" });
    const largeRow = within(dialog).getByText("Large Written Work").closest(".cursor-pointer") as HTMLElement;
    const shortRow = within(dialog).getByText("Short Written Work").closest(".cursor-pointer") as HTMLElement;
    expect(await within(shortRow).findByText("Recommended")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "85%" }));
    expect(await within(largeRow).findByText("Recommended")).toBeTruthy();
    expect(within(shortRow).queryByText("Recommended")).toBeNull();
    expect(api.previewScore).toHaveBeenLastCalledWith(12, expect.objectContaining({
      target_assignment_ids: [4001, 4002],
      score_adjustment_cap: 85,
    }));
  });

  it("does not recommend a target when every eligible preview has zero gain", async () => {
    mockItemBasedPreviews();
    const zeroGainDetail: TeacherInterventionDetail = {
      ...detailWithClassworks,
      diagnosis_snapshot: {
        ...detailWithClassworks.diagnosis_snapshot,
        supporting_activities: [
          { classwork_id: 501, classwork_assignment_id: 5001, title: "High Score 1", component: "WRITTEN_WORK", score: 19, possible_score: 20, percent: 95 },
          { classwork_id: 502, classwork_assignment_id: 5002, title: "High Score 2", component: "WRITTEN_WORK", score: 18, possible_score: 20, percent: 90 },
        ],
      },
    };

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={zeroGainDetail} page="plan" />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Select Classwork" }));
    const dialog = await screen.findByRole("dialog", { name: "Select Targeted Classwork" });
    await waitFor(() => expect(api.previewScore).toHaveBeenCalled());
    expect(within(dialog).queryByText("Recommended")).toBeNull();
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

  it("displays each recommended Reading once and tracks teacher selection independently", async () => {
    const recommendedReading = {
      id: 501,
      kind: "CLASSWORK" as const,
      classwork_type: "READING",
      title: "Algebra Foundation Drills",
      recommended: true,
      match_level: "SCORED_COMPETENCY" as const,
      lesson: "Algebra Basics",
      is_graded: false,
    };
    api.workspace.mockResolvedValue({
      ...workspace,
      plan: {
        teacher_choice: "CLASSWORK",
        grade_treatment: "WRITTEN_WORK",
        selected_resources: [],
        ai_suggestion: null,
      },
      resources: [recommendedReading, { ...recommendedReading }],
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    const mainReading = await screen.findByText("Algebra Foundation Drills");
    expect(mainReading).toBeTruthy();
    expect(screen.getAllByText("Algebra Foundation Drills")).toHaveLength(1);
    expect(screen.queryByText("Teacher selected")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Select resources" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Supporting Resources" });

    const drillMatches = within(dialog).getAllByText("Algebra Foundation Drills");
    expect(drillMatches).toHaveLength(1);
    expect(within(dialog).getAllByText("Recommended")).toHaveLength(1);

    fireEvent.click(drillMatches[0].closest(".cursor-pointer") as HTMLElement);
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    expect(screen.getAllByText("Algebra Foundation Drills")).toHaveLength(1);
    expect(screen.getByText("Teacher selected")).toBeTruthy();
  });

  it("reconciles duplicate canonical Reading references before save and reopen", async () => {
    const reading = {
      id: 511,
      kind: "CLASSWORK" as const,
      classwork_type: "READING",
      title: "Canonical Statistics Reading",
      recommended: true,
      match_level: "COMPETENCY" as const,
      lesson: "Statistics",
      is_graded: false,
    };
    const duplicateWorkspace = {
      ...workspace,
      plan: {
        ...workspace.plan,
        teacher_choice: "EXISTING_MATERIAL_ONLY" as const,
        selected_resources: [
          { kind: "CLASSWORK" as const, id: reading.id },
          { kind: "CLASSWORK" as const, id: reading.id },
        ],
      },
      resources: [reading, { ...reading }],
    };
    api.workspace.mockResolvedValue(duplicateWorkspace);
    api.savePlan.mockImplementation(async (_id, savedPlan) => ({
      ...duplicateWorkspace,
      plan: { ...duplicateWorkspace.plan, ...savedPlan },
    }));
    const ref = createRef<InterventionSupportMaterialsHandle>();

    render(
      <MemoryRouter>
        <InterventionSupportMaterials ref={ref} detail={detail} page="plan" />
      </MemoryRouter>
    );

    expect(await screen.findByText(reading.title)).toBeTruthy();
    expect(screen.getAllByText(reading.title)).toHaveLength(1);
    expect(screen.getByText("Teacher selected")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Select resources" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Supporting Resources" });
    expect(within(dialog).getAllByText(reading.title)).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    expect(await ref.current?.saveAdjustments()).toBe(true);
    expect(api.savePlan).toHaveBeenCalledWith(
      12,
      expect.objectContaining({
        selected_resources: [{ kind: "CLASSWORK", id: reading.id }],
      })
    );
  });

  it("excludes graded quizzes, assignments, and curriculum lessons from study-material recommendations and pool while including only non-graded readings", async () => {
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

    // Graded quiz, assignment, and curriculum lessons must NOT appear in the study-material selection dialog
    expect(within(dialog).queryByText("Chapter 3 Quiz")).toBeNull();
    expect(within(dialog).queryByText("Homework Assignment 2")).toBeNull();
    expect(within(dialog).queryByText("Linear Equations Lesson")).toBeNull();

    // Only eligible non-graded reading MUST appear
    expect(within(dialog).getAllByText("Study Guide Reading")).toHaveLength(1);
    expect(within(dialog).getAllByText("Reading").length).toBeGreaterThan(0);
    expect(within(dialog).queryByText("Lesson")).toBeNull();
  });

  it("automatically displays only recommended eligible readings and excludes lessons and graded activities", async () => {
    api.workspace.mockResolvedValue({
      ...workspace,
      plan: {
        teacher_choice: "EXISTING_MATERIAL_ONLY",
        grade_treatment: null,
        selected_resources: [{ kind: "LESSON", id: 704 }],
        ai_suggestion: null,
      },
      resources: [
        {
          id: 701,
          kind: "LESSON",
          title: "Recommended Fractions Lesson",
          recommended: true,
          match_level: "COMPETENCY",
          lesson: "Fractions",
          is_graded: false,
        },
        {
          id: 702,
          kind: "CLASSWORK",
          classwork_type: "READING",
          title: "Recommended Fractions Reading",
          recommended: true,
          match_level: "LESSON",
          lesson: "Fractions",
          is_graded: false,
        },
        {
          id: 703,
          kind: "CLASSWORK",
          classwork_type: "ACTIVITY",
          title: "Graded PT Diagnostic Source",
          recommended: false,
          match_level: "SOURCE_ACTIVITY",
          lesson: "Fractions",
          is_graded: true,
        },
        {
          id: 704,
          kind: "LESSON",
          title: "Teacher Selected Supplemental Lesson",
          recommended: false,
          match_level: null,
          lesson: "Supplemental Fractions",
          is_graded: false,
        },
        {
          id: 705,
          kind: "CLASSWORK",
          classwork_type: "QUIZ",
          title: "Incorrectly Flagged Graded Quiz",
          recommended: true,
          match_level: "COMPETENCY",
          lesson: "Fractions",
          is_graded: true,
        },
      ],
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detail} page="plan" />
      </MemoryRouter>
    );

    // Lessons must NOT be shown as supporting resources
    expect(screen.queryByText("Recommended Fractions Lesson")).toBeNull();
    // Non-graded readings MUST be shown
    const readingRow = (await screen.findByText("Recommended Fractions Reading")).closest(".group");
    expect(readingRow).not.toBeNull();
    expect(within(readingRow as HTMLElement).getByText("Recommended")).toBeTruthy();
    expect(screen.queryByText("Graded PT Diagnostic Source")).toBeNull();
    expect(screen.queryByText("Incorrectly Flagged Graded Quiz")).toBeNull();
    // Teacher selected lesson is not an eligible reading, so it does not appear
    expect(screen.queryByText("Teacher Selected Supplemental Lesson")).toBeNull();
    expect(screen.queryByText("Teacher selected")).toBeNull();
  });

  it("shows the supporting-readings empty state when no eligible instructional material exists", async () => {
    api.workspace.mockResolvedValue({
      ...workspace,
      resources: [
        {
          id: 801,
          kind: "CLASSWORK",
          classwork_type: "ACTIVITY",
          title: "PT Diagnostic Evidence Only",
          recommended: false,
          match_level: "SOURCE_ACTIVITY",
          lesson: "Statistics",
          is_graded: true,
        },
        {
          id: 802,
          kind: "LESSON",
          title: "Unmatched Optional Lesson",
          recommended: false,
          match_level: null,
          lesson: "Optional Review",
          is_graded: false,
        },
      ],
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detail} page="plan" />
      </MemoryRouter>
    );

    expect(await screen.findByText("No supporting readings")).toBeTruthy();
    expect(
      screen.getByText(
        "No eligible Reading is available in this teaching scope."
      )
    ).toBeTruthy();
    expect(screen.queryByText("PT Diagnostic Evidence Only")).toBeNull();
    expect(screen.queryByText("Unmatched Optional Lesson")).toBeNull();
  });

  it("drops intervention 7 legacy references, saves a reading, and restores it after reopening", async () => {
    const reading = {
      id: 3,
      kind: "CLASSWORK" as const,
      classwork_type: "READING",
      title: "DEMO - Budget Mathematics and Financial Modeling",
      description: "Budget review",
      lesson: "DEMO - Budget Mathematics and Financial Modeling",
      topic: "Budget Mathematics",
      attachments: [],
      access: "PLANNING_ONLY" as const,
      ai_read: "METADATA_ONLY" as const,
      recommended: true,
      match_reason: "Matched covered competency metadata",
      match_level: "COMPETENCY" as const,
      match_rank: 100,
      is_graded: false,
    };
    const evidenceSource = (id: number, title: string) => ({
      id,
      kind: "CLASSWORK" as const,
      title,
      description: "Diagnostic evidence",
      lesson: "Budget Mathematics",
      topic: title,
      attachments: [],
      classwork_type: "ACTIVITY",
      access: "ALREADY_ACCESSIBLE" as const,
      ai_read: "METADATA_ONLY" as const,
      recommended: false,
      match_reason: "Source activity metadata; file contents were not analyzed",
      match_level: "SOURCE_ACTIVITY" as const,
      match_rank: 60,
      is_graded: true,
    });
    const legacyWorkspace: RemediationWorkspace = {
      ...workspace,
      plan: {
        teacher_choice: "CLASSWORK",
        grade_treatment: "PRACTICE_ONLY",
        selected_resources: [
          { kind: "CLASSWORK", id: 5 },
          { kind: "CLASSWORK", id: 6 },
          { kind: "CLASSWORK", id: 4 },
          { kind: "CLASSWORK", id: 13 },
        ],
        ai_suggestion: null,
      },
      resources: [
        reading,
        evidenceSource(5, "DEMO - PT 1 - Budget Mathematics"),
        evidenceSource(6, "DEMO - PT 2 - Equation Modeling"),
      ],
    };
    const savedWorkspace: RemediationWorkspace = {
      ...legacyWorkspace,
      plan: {
        ...legacyWorkspace.plan,
        selected_resources: [{ kind: "CLASSWORK", id: reading.id }],
      },
    };
    api.workspace.mockResolvedValue(legacyWorkspace);
    api.savePlan.mockResolvedValue(savedWorkspace);
    const ref = createRef<InterventionSupportMaterialsHandle>();

    render(
      <MemoryRouter>
        <InterventionSupportMaterials ref={ref} detail={detail} page="plan" />
      </MemoryRouter>
    );

    expect(await screen.findByText(reading.title)).toBeTruthy();
    expect(screen.queryByText("Teacher selected")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Select resources" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Supporting Resources" });
    fireEvent.click(
      within(dialog)
        .getAllByText(reading.title)[0]
        .closest(".cursor-pointer") as HTMLElement
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    expect(await ref.current?.saveAdjustments()).toBe(true);
    expect(api.savePlan).toHaveBeenCalledWith(12, {
      teacher_choice: "CLASSWORK",
      grade_treatment: "PRACTICE_ONLY",
      selected_resources: [{ kind: "CLASSWORK", id: reading.id }],
    });

    cleanup();
    api.workspace.mockResolvedValue(savedWorkspace);
    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detail} page="overview" />
      </MemoryRouter>
    );

    expect(await screen.findByText(reading.title)).toBeTruthy();
    expect(screen.queryByText("No supporting resources")).toBeNull();
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
      expect(api.projectGrade).toHaveBeenCalledWith(12, {
        target_assignment_ids: [101],
        score_adjustment_cap: 80,
      });
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
    expect(within(reDialog).getByText("Projected Grade")).toBeTruthy();
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
    expect((await screen.findAllByText("Unavailable")).length).toBeGreaterThanOrEqual(1);
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

  it("recommends a target from projection API without auto-selecting it, preserving teacher control", async () => {
    api.projectGrade.mockResolvedValue({
      status: "AVAILABLE",
      grade_representation: "TRANSMUTED_TERM_GRADE",
      current_subject_grade: 74.0,
      passing_threshold: 75.0,
      target_projections: [],
      eligible_target_gains: [],
      additional_eligible_targets_have_positive_improvement: true,
      recommended_target_assignment_id: 102,
      assumptions: [],
      unavailable_reasons: [],
      ai_midterm_what_if: {
        status: "UNAVAILABLE",
        estimate_kind: "AI_MIDTERM_WHAT_IF_ESTIMATE",
        is_official_grade: false,
        is_guaranteed: false,
        baseline_predicted_term_grade: null,
        readiness: {},
        target_estimates: [],
        unavailable_reasons: [],
        limitations: [],
      },
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findByText("75% Cap");
    fireEvent.click(screen.getByRole("button", { name: "Select Classwork" }));
    const dialog = await screen.findByRole("dialog", { name: "Select Targeted Classwork" });

    // Worksheet 2 should display the Recommended badge
    await waitFor(() => {
      const ws2 = within(dialog).getByText("Worksheet 2").closest(".cursor-pointer");
      expect(ws2).not.toBeNull();
      expect(within(ws2 as HTMLElement).getByText("Recommended")).toBeTruthy();
    });

    // But Worksheet 2 must NOT be checked automatically!
    const ws2Row = within(dialog).getByText("Worksheet 2").closest(".cursor-pointer");
    const ws2Checkbox = within(ws2Row as HTMLElement).getByRole("checkbox");
    expect(ws2Checkbox.getAttribute("data-state")).not.toBe("checked");

    // Teacher can manually choose Worksheet 1 instead (teacher override)
    const ws1Row = within(dialog).getByText("Worksheet 1").closest(".cursor-pointer");
    fireEvent.click(ws1Row as HTMLElement);

    const ws1Checkbox = within(ws1Row as HTMLElement).getByRole("checkbox");
    expect(ws1Checkbox.getAttribute("data-state")).toBe("checked");
  });

  it("dynamically recalculates subject grade projection when teacher changes targets", async () => {
    const emptyProjection = {
        status: "AVAILABLE",
        grade_representation: "TRANSMUTED_TERM_GRADE",
        current_subject_grade: 74.0,
        passing_threshold: 75.0,
        target_projections: [],
        eligible_target_gains: [],
        additional_eligible_targets_have_positive_improvement: true,
        recommended_target_assignment_id: 101,
        assumptions: [],
        unavailable_reasons: [],
        ai_midterm_what_if: {
          status: "UNAVAILABLE",
          estimate_kind: "AI_MIDTERM_WHAT_IF_ESTIMATE",
          is_official_grade: false,
          is_guaranteed: false,
          baseline_predicted_term_grade: null,
          readiness: {},
          target_estimates: [],
          unavailable_reasons: [],
          limitations: [],
        },
      };
    const selectedProjection = {
        status: "AVAILABLE",
        grade_representation: "TRANSMUTED_TERM_GRADE",
        current_subject_grade: 74.0,
        passing_threshold: 75.0,
        target_projections: [
          {
            assignment_id: 101,
            title: "Worksheet 1",
            component: "WRITTEN_WORK",
            original_score: 10,
            current_effective_score: 10,
            max_points: 20,
            cap_percentage: 75,
            maximum_hypothetical_effective_score: 15,
            possible_score_gain: 5,
            applied: true,
            projected_initial_grade: 72.0,
            projected_subject_grade: 78.0,
            step_subject_grade_improvement: 4.0,
            possible_grade_improvement: 4.0,
            reaches_passing_threshold: true,
            unavailable_reasons: [],
          },
        ],
        eligible_target_gains: [],
        additional_eligible_targets_have_positive_improvement: true,
        recommended_target_assignment_id: 102,
        assumptions: [],
        unavailable_reasons: [],
        ai_midterm_what_if: {
          status: "UNAVAILABLE",
          estimate_kind: "AI_MIDTERM_WHAT_IF_ESTIMATE",
          is_official_grade: false,
          is_guaranteed: false,
          baseline_predicted_term_grade: null,
          readiness: {},
          target_estimates: [],
          unavailable_reasons: [],
          limitations: [],
        },
      };
    api.projectGrade.mockImplementation(async (_id, payload) =>
      payload.target_assignment_ids.length > 0 ? selectedProjection : emptyProjection
    );

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findByText("75% Cap");
    fireEvent.click(screen.getByRole("button", { name: "Select Classwork" }));
    const dialog = await screen.findByRole("dialog", { name: "Select Targeted Classwork" });

    // Initially target is not selected, select Worksheet 1
    const ws1Row = within(dialog).getByText("Worksheet 1").closest(".cursor-pointer");
    fireEvent.click(ws1Row as HTMLElement);

    await waitFor(() => {
      expect(api.projectGrade).toHaveBeenCalledWith(12, {
        target_assignment_ids: [101],
        score_adjustment_cap: 75,
      });
      expect(within(dialog).getByText("78.0%")).toBeTruthy();
      expect(within(dialog).getByText("+4.0%")).toBeTruthy();
      expect(within(dialog).getByText("Reaches Passing")).toBeTruthy();
    });
  });

  it("Task 4.8D.1 regression: AI midterm what-if renders Provisional AI Estimate without old placeholder and handles unsaved caps", async () => {
    const aiProjection = {
      status: "UNAVAILABLE",
      grade_representation: "TRANSMUTED_TERM_GRADE",
      current_subject_grade: null,
      passing_threshold: 87.0,
      target_projections: [
        {
          assignment_id: 101,
          title: "Worksheet 1",
          component: "WRITTEN_WORK",
          original_score: 10,
          current_effective_score: 10,
          max_points: 20,
          cap_percentage: 75,
          maximum_hypothetical_effective_score: 15,
          possible_score_gain: 5,
          applied: true,
          projected_initial_grade: null,
          projected_subject_grade: null,
          step_subject_grade_improvement: null,
          possible_grade_improvement: null,
          reaches_passing_threshold: null,
          unavailable_reasons: [],
        },
      ],
      eligible_target_gains: [
        {
          assignment_id: 101,
          title: "Worksheet 1",
          component: "WRITTEN_WORK",
          original_score: 10,
          current_effective_score: 10,
          max_points: 20,
          cap_percentage: 75,
          maximum_hypothetical_effective_score: 15,
          possible_score_gain: 5,
        },
      ],
      additional_eligible_targets_have_positive_improvement: false,
      recommended_target_assignment_id: 101,
      assumptions: [],
      unavailable_reasons: [
        {
          code: "INCOMPLETE_EXAMINATION_EVIDENCE",
          message: "Examination evidence is incomplete for official transmuted grade calculation.",
        },
      ],
      ai_midterm_what_if: {
        status: "AVAILABLE",
        estimate_kind: "AI_MIDTERM_WHAT_IF_ESTIMATE",
        is_official_grade: false,
        is_guaranteed: false,
        model_name: "midterm-grade-xgb-v1",
        prediction_purpose: "CURRENT_TERM_FINAL_GRADE_PROJECTION",
        evidence_basis: "LIVE_ACTUAL_EVIDENCE_WITH_EPHEMERAL_CAPPED_WW_PT_OVERRIDES",
        baseline_predicted_term_grade: 84.6,
        readiness: { ready: true },
        target_estimates: [
          {
            assignment_id: 101,
            maximum_hypothetical_effective_score: 15.0,
            hypothetical_predicted_term_grade: 86.6,
            step_estimated_difference: 2.0,
            estimated_difference_from_baseline: 2.0,
          },
        ],
        unavailable_reasons: [],
        limitations: [],
      },
    };

    api.projectGrade.mockResolvedValue(aiProjection);

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findByText("75% Cap");
    fireEvent.click(screen.getByRole("button", { name: "Select Classwork" }));
    const dialog = await screen.findByRole("dialog", { name: "Select Targeted Classwork" });

    // Select Worksheet 1
    const ws1Row = within(dialog).getByText("Worksheet 1").closest(".cursor-pointer");
    fireEvent.click(ws1Row as HTMLElement);

    await waitFor(() => {
      // 1. Shows Provisional AI Estimate badge
      expect(within(dialog).getByText("Provisional AI Estimate")).toBeTruthy();
      // 2. Shows baseline prediction
      expect(within(dialog).getAllByText("84.6%").length).toBeGreaterThanOrEqual(1);
      // 3. Shows hypothetical prediction after capped remediation
      expect(within(dialog).getByText("86.6%")).toBeTruthy();
      // 4. Shows estimated grade difference
      expect(within(dialog).getByText("+2.0%")).toBeTruthy();
      // 5. Explicitly disclaims that results are exploratory and not guaranteed
      expect(
        within(dialog).getByText(/not an official grade or guaranteed result/i)
      ).toBeTruthy();
      // 6. Proves old placeholder is NOT rendered
      expect(
        within(dialog).queryByText(/Preview is pending official backend grade calculation/i)
      ).toBeNull();
      expect(
        within(dialog).queryByText(/Subject grade projections are not calculated in-browser/i)
      ).toBeNull();
    });

    // 7. Verify displayed cap matches the API cap (75%), and unsaved cap edit warns teacher
    expect(within(dialog).getAllByText("75% Cap").length).toBeGreaterThanOrEqual(1);
    const capInput = within(dialog).getByLabelText("Score Adjustment Cap (%)");
    fireEvent.change(capInput, { target: { value: "85" } });
    expect(
      within(dialog).getByText(/Unsaved cap change \(85%\)\. The projection above reflects the saved 75% cap/i)
    ).toBeTruthy();
  });
});

const detailWithClassworks: TeacherInterventionDetail = {
    ...detail,
    diagnosis_snapshot: {
      weakest_supported_components: ["WRITTEN_WORK"],
      components: {
        WRITTEN_WORK: { evidence_state: "AVAILABLE", percent: 61 },
      },
      supporting_activities: [
        {
          classwork_id: 101,
          classwork_assignment_id: 101,
          title: "Worksheet 1",
          component: "WRITTEN_WORK",
          score: 10,
          possible_score: 20,
          percent: 50,
        },
      ],
    },
  };

  const sampleReading = {
    id: 501,
    kind: "CLASSWORK" as const,
    classwork_type: "READING",
    title: "Linear Functions Guide",
    recommended: true,
    match_level: "COMPETENCY" as const,
    lesson: "Linear Functions",
    is_graded: false,
  };

  const mockQuizDraft: RemediationQuizDraft = {
    draft_format: "QUIZ",
    target_component: "WRITTEN_WORK",
    grade_treatment: "WRITTEN_WORK",
    title: "Mathematics Linear Equations Practice",
    instructions: "Complete the following practice quiz to reinforce key concepts.",
    total_points: 20,
    duration_minutes: 25,
    questions: [
      {
        question_text: "What is the slope of the line passing through (2, 3) and (4, 7)?",
        question_type: "MULTIPLE_CHOICE",
        points: 10,
        display_order: 1,
        difficulty_level: "MEDIUM",
        targeted_competency_id: 101,
        targeted_lesson_id: 42,
        options: [
          { option_text: "2", option_order: 1 },
          { option_text: "1/2", option_order: 2 },
          { option_text: "4", option_order: 3 },
          { option_text: "-2", option_order: 4 },
        ],
        teacher_answer_key: {
          correct_answer: "2",
          explanation: "Slope formula m = (y2 - y1) / (x2 - x1) = (7 - 3) / (4 - 2) = 2.",
          scoring_guide: "Full credit for selecting 2.",
        },
      },
      {
        question_text: "The graph of a linear equation is a straight line.",
        question_type: "TRUE_FALSE",
        points: 10,
        display_order: 2,
        difficulty_level: "EASY",
        targeted_competency_id: 101,
        targeted_lesson_id: 42,
        options: [
          { option_text: "True", option_order: 1 },
          { option_text: "False", option_order: 2 },
        ],
        teacher_answer_key: {
          correct_answer: "True",
          explanation: "A first-degree polynomial always produces a straight line.",
        },
      },
    ],
  };

  const mockClassworkDraft: RemediationClassworkDraft = {
    draft_format: "CLASSWORK",
    target_component: "WRITTEN_WORK",
    grade_treatment: "WRITTEN_WORK",
    title: "Linear Equations Modeling Activity",
    description: "Hands-on application of slope and y-intercept modeling.",
    student_instructions: "Follow each task step carefully and submit your final work as a PDF document.",
    total_points: 20,
    activity_mode: "ONLINE",
    tasks: [
      {
        task_number: 1,
        title: "Rate of Change Construction",
        instructions: "Determine the unit rate from the given dataset.",
        targeted_competency_id: 101,
        targeted_lesson_id: 42,
      },
    ],
    deliverables: [
      {
        deliverable_name: "Analysis Report",
        deliverable_type: "DOCUMENT",
        description: "PDF analysis report containing calculations.",
      },
    ],
    supported_upload_formats: [".pdf", ".docx"],
    rubric_levels: [
      {
        level_name: "Exemplary",
        description: "Demonstrates thorough understanding with no errors.",
        points: 20,
        display_order: 0,
      },
      {
        level_name: "Developing",
        description: "Shows partial understanding with minor calculation errors.",
        points: 10,
        display_order: 1,
      },
    ],
    teacher_guide: {
      exemplar_or_expected_response: "Unit rate is 15 dollars/hr. Initial fee is 25 dollars.",
      evaluation_notes: "Award full credit if rate is derived from two distinct data points.",
      common_misconceptions: ["Inverting change in x and change in y."],
    },
  };

describe("PR 2D.1: Teacher AI Remediation Entry Point", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.materials.mockResolvedValue({ items: [], total: 0 });
    api.workspace.mockResolvedValue({
      ...workspace,
      plan: {
        teacher_choice: "QUIZ",
        grade_treatment: "WRITTEN_WORK",
        target_assignment_ids: [101],
        score_adjustment_cap: 75,
        selected_resources: [{ kind: "CLASSWORK", id: 501 }],
        ai_suggestion: null,
      },
      resources: [sampleReading],
      focus: {
        ...workspace.focus,
        lesson_ids: [42],
        competency_ids: [101],
        question_evidence: [{ quiz_question_id: 999, score: 0, possible_score: 5 }],
      },
    });
    api.savePlan.mockImplementation(async (_id, savedPlan) => ({
      ...workspace,
      plan: {
        ...workspace.plan,
        ...savedPlan,
        teacher_choice: savedPlan.teacher_choice ?? "QUIZ",
        grade_treatment: savedPlan.grade_treatment ?? "WRITTEN_WORK",
      },
      resources: [sampleReading],
    }));
    api.projectGrade.mockResolvedValue({
      status: "UNAVAILABLE",
      grade_representation: "TRANSMUTED_TERM_GRADE",
      current_subject_grade: null,
      passing_threshold: 75,
      target_projections: [],
      eligible_target_gains: [],
      additional_eligible_targets_have_positive_improvement: false,
      recommended_target_assignment_id: null,
      assumptions: [],
      unavailable_reasons: [],
      ai_midterm_what_if: {
        status: "UNAVAILABLE",
        estimate_kind: "AI_MIDTERM_WHAT_IF_ESTIMATE",
        is_official_grade: false,
        is_guaranteed: false,
        baseline_predicted_term_grade: null,
        readiness: {},
        target_estimates: [],
        unavailable_reasons: [],
        limitations: [],
      },
    });
    api.previewScore.mockImplementation(async (_id, req) => ({
      score_adjustment_cap: req.score_adjustment_cap ?? 75,
      previews: [
        {
          assignment_id: 101,
          title: "Worksheet 1",
          original_score: 10,
          max_points: 20,
          cap_percentage: 75,
          max_adjusted_score: 15,
          possible_gain: 5,
          was_adjusted: true,
          was_capped: true,
        },
      ],
      disclaimer: "Hypothetical maximum only",
    }));
  });

  afterEach(cleanup);

  it("renders 'Generate with AI' beside manual creation button for QUIZ and CLASSWORK, but not for EXISTING_MATERIAL_ONLY", async () => {
    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    // QUIZ: both Generate with AI and Continue to Quiz Builder appear
    await screen.findAllByText("75% Cap");
    expect(screen.getByRole("button", { name: /Generate with AI/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Continue to Quiz Builder/i })).toBeTruthy();

    // Select CLASSWORK
    fireEvent.click(screen.getByText("Classwork").closest(".cursor-pointer") as HTMLElement);
    expect(screen.getByRole("button", { name: /Generate with AI/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Continue to Classwork Creator/i })).toBeTruthy();

    // Select EXISTING_MATERIAL_ONLY
    fireEvent.click(screen.getByText("Materials Only").closest(".cursor-pointer") as HTMLElement);
    expect(screen.queryByRole("button", { name: /Generate with AI/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Continue to/i })).toBeNull();
  });

  it("submits the verified request payload to generateRemediationDraft and displays loading state", async () => {
    let resolveDraft: (val: RemediationQuizDraft) => void = () => {};
    const draftPromise = new Promise<RemediationQuizDraft>((resolve) => {
      resolveDraft = resolve;
    });
    api.generateDraft.mockReturnValue(draftPromise);

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findAllByText("75% Cap");
    const aiButton = screen.getByRole("button", { name: /Generate with AI/i });
    fireEvent.click(aiButton);

    // Verified API payload
    await waitFor(() => {
      expect(api.generateDraft).toHaveBeenCalledWith(
        12,
        expect.objectContaining({
          draft_format: "QUIZ",
          target_component: "WRITTEN_WORK",
          grade_treatment: "WRITTEN_WORK",
          item_count: 5,
          total_points: 20,
          selected_reading_ids: [501],
          selected_lesson_ids: [42],
          selected_competency_ids: [101],
          selected_quiz_question_ids: [999],
        })
      );
    });

    // Loading preview dialog appears with generating message
    const dialog = await screen.findByRole("dialog", { name: /AI Remediation Draft Preview/i });
    expect(within(dialog).getByText(/Generating Remediation Draft…/i)).toBeTruthy();

    // Resolve draft
    resolveDraft(mockQuizDraft);
    await waitFor(() => {
      expect(within(dialog).queryByText(/Generating Remediation Draft…/i)).toBeNull();
      expect(within(dialog).getByText("Mathematics Linear Equations Practice")).toBeTruthy();
    });
  });

  it("previews complete Quiz draft with question mode toggle, student questions, and separate teacher answer keys", async () => {
    api.generateDraft.mockResolvedValue(mockQuizDraft);

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findAllByText("75% Cap");
    fireEvent.click(screen.getByRole("button", { name: /Generate with AI/i }));

    const dialog = await screen.findByRole("dialog", { name: /AI Remediation Draft Preview/i });

    // Mode Toggle: Generate New Targeted Questions (Supported) vs Reuse Original Questions (Unsupported)
    expect(within(dialog).getByText("Generate New Targeted Questions")).toBeTruthy();
    expect(within(dialog).getByText("Supported")).toBeTruthy();
    expect(within(dialog).getByText("Reuse Original Questions")).toBeTruthy();
    expect(within(dialog).getByText("Unsupported")).toBeTruthy();
    expect(within(dialog).getByText(/Backend assessment service does not support verbatim question extraction/i)).toBeTruthy();

    // Student Instructions and Questions
    expect(within(dialog).getByText(/Complete the following practice quiz to reinforce key concepts/i)).toBeTruthy();
    expect(within(dialog).getByText("What is the slope of the line passing through (2, 3) and (4, 7)?")).toBeTruthy();
    expect(within(dialog).getByText("The graph of a linear equation is a straight line.")).toBeTruthy();

    // Separate Teacher Answer Key
    expect(within(dialog).getByText("Teacher-Only Answer Key & Explanations")).toBeTruthy();
    expect(within(dialog).getAllByText("Teacher Eyes Only").length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getByText("Item 1 Answer Key")).toBeTruthy();
    expect(within(dialog).getByText("Slope formula m = (y2 - y1) / (x2 - x1) = (7 - 3) / (4 - 2) = 2.")).toBeTruthy();

    // Disclaimer
    expect(within(dialog).getByText("Teacher Review Only")).toBeTruthy();
    expect(within(dialog).getByText("Unsaved Draft")).toBeTruthy();
  });

  it("previews complete Classwork/PT draft with tasks, instructions, deliverables, upload formats, rubric, and separate teacher guide", async () => {
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
      resources: [],
      focus: {
        ...workspace.focus,
        lesson_ids: [42],
        competency_ids: [101],
      },
    });

    api.generateDraft.mockResolvedValue(mockClassworkDraft);

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findAllByText("75% Cap");
    fireEvent.click(screen.getByRole("button", { name: /Generate with AI/i }));

    const dialog = await screen.findByRole("dialog", { name: /AI Remediation Draft Preview/i });

    // Overview & Instructions
    expect(within(dialog).getByText("Linear Equations Modeling Activity")).toBeTruthy();
    expect(within(dialog).getByText("Hands-on application of slope and y-intercept modeling.")).toBeTruthy();
    expect(within(dialog).getByText(/Follow each task step carefully and submit your final work as a PDF document/i)).toBeTruthy();

    // Step-by-step Tasks
    expect(within(dialog).getByText("Task 1")).toBeTruthy();
    expect(within(dialog).getByText("Rate of Change Construction")).toBeTruthy();
    expect(within(dialog).getByText(/Determine the unit rate from the given dataset/i)).toBeTruthy();

    // Deliverables & Upload Formats
    expect(within(dialog).getByText("Analysis Report")).toBeTruthy();
    expect(within(dialog).getByText("DOCUMENT")).toBeTruthy();
    expect(within(dialog).getByText(".pdf")).toBeTruthy();
    expect(within(dialog).getByText(".docx")).toBeTruthy();

    // Rubric
    expect(within(dialog).getByText("Exemplary")).toBeTruthy();
    expect(within(dialog).getByText("Developing")).toBeTruthy();
    expect(within(dialog).getByText("20 pts")).toBeTruthy();
    expect(within(dialog).getByText("10 pts")).toBeTruthy();

    // Teacher Guide Separately
    expect(within(dialog).getByText("Teacher Evaluation Guide")).toBeTruthy();
    expect(within(dialog).getByText(/Unit rate is 15 dollars\/hr/i)).toBeTruthy();
    expect(within(dialog).getByText(/Award full credit if rate is derived from two distinct data points/i)).toBeTruthy();
    expect(within(dialog).getByText(/Inverting change in x and change in y/i)).toBeTruthy();
  });

  it("gracefully handles Groq rate limit (429) errors, displaying clear error message while preserving teacher selections and manual authoring", async () => {
    api.generateDraft.mockRejectedValue(
      new InterventionApiError(429, "Rate limit reached. Please wait 60 seconds.")
    );

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findAllByText("75% Cap");
    fireEvent.click(screen.getByRole("button", { name: /Generate with AI/i }));

    const dialog = await screen.findByRole("dialog", { name: /AI Remediation Draft Preview/i });

    // Rate limit message shown
    expect(
      within(dialog).getByText(/AI generation rate limit reached \(Groq free tier\)/i)
    ).toBeTruthy();

    // Teacher selections and manual authoring preserved
    expect(within(dialog).getByText(/All your selected targets, readings, and manual authoring options remain preserved/i)).toBeTruthy();

    // Dismiss dialog
    fireEvent.click(within(dialog).getByRole("button", { name: "Dismiss" }));

    // Main page still has 75% Cap and Continue to Quiz Builder active
    expect(screen.getAllByText("75% Cap").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: /Continue to Quiz Builder/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Generate with AI/i })).toBeTruthy();
  });
});

describe("PR 2D.2A: Teacher AI Draft Editing & Cap Integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.materials.mockResolvedValue({ items: [], total: 0 });
    api.workspace.mockResolvedValue({
      ...workspace,
      plan: {
        teacher_choice: "QUIZ",
        grade_treatment: "WRITTEN_WORK",
        target_assignment_ids: [101],
        score_adjustment_cap: 75,
        selected_resources: [{ kind: "CLASSWORK", id: 501 }],
        ai_suggestion: null,
      },
      resources: [sampleReading],
      focus: {
        ...workspace.focus,
        lesson_ids: [42],
        competency_ids: [101],
        question_evidence: [{ quiz_question_id: 999, score: 0, possible_score: 5 }],
      },
    });
    api.savePlan.mockImplementation(async (_id, savedPlan) => ({
      ...workspace,
      plan: {
        ...workspace.plan,
        ...savedPlan,
        teacher_choice: savedPlan.teacher_choice ?? "QUIZ",
        grade_treatment: savedPlan.grade_treatment ?? "WRITTEN_WORK",
      },
      resources: [sampleReading],
    }));
    api.projectGrade.mockResolvedValue({
      status: "UNAVAILABLE",
      grade_representation: "TRANSMUTED_TERM_GRADE",
      current_subject_grade: null,
      passing_threshold: 75,
      target_projections: [],
      eligible_target_gains: [],
      additional_eligible_targets_have_positive_improvement: false,
      recommended_target_assignment_id: null,
      assumptions: [],
      unavailable_reasons: [],
      ai_midterm_what_if: {
        status: "UNAVAILABLE",
        estimate_kind: "AI_MIDTERM_WHAT_IF_ESTIMATE",
        is_official_grade: false,
        is_guaranteed: false,
        baseline_predicted_term_grade: null,
        readiness: {},
        target_estimates: [],
        unavailable_reasons: [],
        limitations: [],
      },
    });
    api.previewScore.mockImplementation(async (_id, req) => ({
      score_adjustment_cap: req.score_adjustment_cap ?? 75,
      previews: [
        {
          assignment_id: 101,
          title: "Worksheet 1",
          original_score: 10,
          max_points: 20,
          cap_percentage: req.score_adjustment_cap ?? 75,
          max_adjusted_score: 15,
          possible_gain: 5,
          was_adjusted: true,
          was_capped: true,
        },
      ],
      disclaimer: "Hypothetical maximum only",
    }));
  });

  afterEach(cleanup);

  it("displays original target assignment, current grade treatment, and saved adjustment cap in preview banner", async () => {
    api.generateDraft.mockResolvedValue(mockQuizDraft);

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findAllByText("75% Cap");
    fireEvent.click(screen.getByRole("button", { name: /Generate with AI/i }));

    const dialog = await screen.findByRole("dialog", { name: /AI Remediation Draft Preview/i });

    // Context banner checks
    expect(within(dialog).getByText("Academic Treatment & Score Adjustment Context")).toBeTruthy();
    expect(within(dialog).getByText("Worksheet 1 (20 pts)")).toBeTruthy();
    expect(within(dialog).getAllByText("Written Work").length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getByText(/Capped at 75% of original max points. The AI draft does not alter your cap./i)).toBeTruthy();
  });

  it("allows teacher to edit Quiz draft title, instructions, questions, points, options, and answer keys, recalculating total points", async () => {
    api.generateDraft.mockResolvedValue(mockQuizDraft);

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findAllByText("75% Cap");
    fireEvent.click(screen.getByRole("button", { name: /Generate with AI/i }));

    const dialog = await screen.findByRole("dialog", { name: /AI Remediation Draft Preview/i });

    // Initial total points
    expect(within(dialog).getByText("20 Total Points")).toBeTruthy();
    expect(within(dialog).getByText("Draft Complete")).toBeTruthy();

    // Enter Edit Mode
    fireEvent.click(within(dialog).getAllByRole("button", { name: /Edit Draft/i })[0]);

    // Edit title
    const titleInput = within(dialog).getByLabelText("Remediation Title");
    fireEvent.change(titleInput, { target: { value: "Linear Equations Mastery Practice" } });

    // Edit points for Item 1 from 10 to 14 (expect total to become 14 + 10 = 24)
    const pointsInputs = within(dialog).getAllByLabelText("Points:");
    fireEvent.change(pointsInputs[0], { target: { value: "14" } });
    expect(within(dialog).getByText("24 Total Points")).toBeTruthy();

    // Edit Question prompt
    const promptTextareas = within(dialog).getAllByLabelText("Question Prompt");
    fireEvent.change(promptTextareas[0], { target: { value: "Updated prompt: Calculate slope between points." } });

    // Edit correct answer and explanation in Teacher Eyes Only section
    const correctAnswerInputs = within(dialog).getAllByLabelText("Correct Answer");
    fireEvent.change(correctAnswerInputs[0], { target: { value: "m = 2" } });

    const explanationTextareas = within(dialog).getAllByLabelText("Explanation");
    fireEvent.change(explanationTextareas[0], { target: { value: "Updated explanation: m = (7-3)/(4-2) = 2." } });

    // Exit Edit Mode back to Preview
    fireEvent.click(within(dialog).getAllByRole("button", { name: /Done Editing/i })[0]);

    // Verify preview displays updated content
    expect(within(dialog).getByText("Linear Equations Mastery Practice")).toBeTruthy();
    expect(within(dialog).getByText("24 Total Points")).toBeTruthy();
    expect(within(dialog).getByText("14 points")).toBeTruthy();
    expect(within(dialog).getByText("Updated prompt: Calculate slope between points.")).toBeTruthy();
    expect(within(dialog).getByText("m = 2")).toBeTruthy();
    expect(within(dialog).getByText("Updated explanation: m = (7-3)/(4-2) = 2.")).toBeTruthy();
  });

  it("allows teacher to edit Classwork draft overview, tasks, deliverables, rubric points, and evaluation guide", async () => {
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
      resources: [],
      focus: {
        ...workspace.focus,
        lesson_ids: [42],
        competency_ids: [101],
      },
    });

    api.generateDraft.mockResolvedValue(mockClassworkDraft);

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findAllByText("75% Cap");
    fireEvent.click(screen.getByRole("button", { name: /Generate with AI/i }));

    const dialog = await screen.findByRole("dialog", { name: /AI Remediation Draft Preview/i });

    // Enter Edit Mode
    fireEvent.click(within(dialog).getAllByRole("button", { name: /Edit Draft/i })[0]);

    // Edit Activity Overview
    const overviewTextarea = within(dialog).getByDisplayValue("Hands-on application of slope and y-intercept modeling.");
    fireEvent.change(overviewTextarea, { target: { value: "Custom modeling lab overview for linear systems." } });

    // Edit Task 1 title
    const task1Input = within(dialog).getByDisplayValue("Rate of Change Construction");
    fireEvent.change(task1Input, { target: { value: "Task 1: Calculate Experimental Rates" } });

    // Edit Rubric level 1 points from 20 to 25
    const rubricPoints = within(dialog).getByDisplayValue("20");
    fireEvent.change(rubricPoints, { target: { value: "25" } });
    expect(within(dialog).getByText("25 Total Points")).toBeTruthy();

    // Edit Teacher Evaluation Guide exemplar
    const exemplarTextarea = within(dialog).getByDisplayValue("Unit rate is 15 dollars/hr. Initial fee is 25 dollars.");
    fireEvent.change(exemplarTextarea, { target: { value: "Verified rate is 15 dollars/hr." } });

    // Switch back to Preview
    fireEvent.click(within(dialog).getAllByRole("button", { name: /Done Editing/i })[0]);

    // Verify preview displays updated content
    expect(within(dialog).getByText("Custom modeling lab overview for linear systems.")).toBeTruthy();
    expect(within(dialog).getByText("Task 1: Calculate Experimental Rates")).toBeTruthy();
    expect(within(dialog).getByText("25 pts")).toBeTruthy();
    expect(within(dialog).getByText("Verified rate is 15 dollars/hr.")).toBeTruthy();
  });

  it("dynamically validates completeness when required fields are cleared and restored", async () => {
    api.generateDraft.mockResolvedValue(mockQuizDraft);

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findAllByText("75% Cap");
    fireEvent.click(screen.getByRole("button", { name: /Generate with AI/i }));

    const dialog = await screen.findByRole("dialog", { name: /AI Remediation Draft Preview/i });
    expect(within(dialog).getByText("Draft Complete")).toBeTruthy();

    // Enter Edit Mode
    fireEvent.click(within(dialog).getAllByRole("button", { name: /Edit Draft/i })[0]);

    // Clear Question 1 prompt
    const promptTextareas = within(dialog).getAllByLabelText("Question Prompt");
    fireEvent.change(promptTextareas[0], { target: { value: "   " } });

    // Validation changes to Incomplete and warning alert appears
    expect(within(dialog).getByText(/1 Incomplete Field/i)).toBeTruthy();
    expect(within(dialog).getByText(/Item 1: Question prompt is required/i)).toBeTruthy();

    // Restore Question 1 prompt
    fireEvent.change(promptTextareas[0], { target: { value: "What is the slope of the line?" } });

    // Validated badge returns
    expect(within(dialog).getByText("Draft Complete")).toBeTruthy();
    expect(within(dialog).queryByText(/1 Incomplete Field/i)).toBeNull();
  });

  it("maintains cap integrity and prevents invalid cap (100% full replacement) from generating", async () => {
    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findAllByText("75% Cap");

    // Open Select Targeted Classwork modal to edit cap
    fireEvent.click(screen.getByRole("button", { name: "Reselect Activities" }));
    const selectCwDialog = await screen.findByRole("dialog", { name: "Select Targeted Classwork" });

    // Set invalid 100% cap
    const capInput = within(selectCwDialog).getByLabelText(/Score Adjustment Cap/i);
    fireEvent.change(capInput, { target: { value: "100" } });
    fireEvent.click(within(selectCwDialog).getByRole("button", { name: "Done" }));

    // Click Generate with AI
    fireEvent.click(screen.getByRole("button", { name: /Generate with AI/i }));

    // Generation API should NOT be called due to invalid cap error
    expect(api.generateDraft).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: /AI Remediation Draft Preview/i })).toBeNull();
  });

  it("does not prematurely persist or save draft edits to the backend", async () => {
    api.generateDraft.mockResolvedValue(mockQuizDraft);

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findAllByText("75% Cap");
    fireEvent.click(screen.getByRole("button", { name: /Generate with AI/i }));

    const dialog = await screen.findByRole("dialog", { name: /AI Remediation Draft Preview/i });

    // Enter Edit Mode and make edits
    fireEvent.click(within(dialog).getAllByRole("button", { name: /Edit Draft/i })[0]);
    const titleInput = within(dialog).getByLabelText("Remediation Title");
    fireEvent.change(titleInput, { target: { value: "Modified Draft Name" } });

    // Close preview
    fireEvent.click(within(dialog).getByRole("button", { name: "Close Preview" }));

    // api.savePlan was called ONLY once (before draft generation to save teacher plan adjustments),
    // and never with the draft contents itself
    expect(api.savePlan).toHaveBeenCalledTimes(1);
    expect(api.savePlan).toHaveBeenCalledWith(
      12,
      expect.not.objectContaining({ questions: expect.anything() })
    );
  });
});

describe("PR 2D.2B.3: Save AI remediation draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.materials.mockResolvedValue({ items: [], total: 0 });
    api.workspace.mockResolvedValue({
      ...workspace,
      plan: {
        teacher_choice: "QUIZ",
        grade_treatment: "WRITTEN_WORK",
        target_assignment_ids: [101],
        score_adjustment_cap: 75,
        selected_resources: [{ kind: "CLASSWORK", id: 501 }],
        ai_suggestion: null,
      },
      resources: [sampleReading],
      focus: {
        ...workspace.focus,
        lesson_ids: [42],
        competency_ids: [101],
        question_evidence: [{ quiz_question_id: 999, score: 0, possible_score: 5 }],
      },
    });
    api.savePlan.mockImplementation(async (_id, savedPlan) => ({
      ...workspace,
      plan: {
        ...workspace.plan,
        ...savedPlan,
        teacher_choice: "QUIZ",
        grade_treatment: "WRITTEN_WORK",
        target_assignment_ids: [101],
        score_adjustment_cap: 75,
      },
      resources: [sampleReading],
      focus: workspace.focus,
      progress: workspace.progress,
      original_exams: [],
    }));
    api.generateDraft.mockResolvedValue(mockQuizDraft);
    api.preflightDraft.mockResolvedValue({
      is_valid: true,
      draft_format: "QUIZ",
      target_component: "WRITTEN_WORK",
      grade_treatment: "WRITTEN_WORK",
      total_points: 20,
      authoritative_cap: 75,
      target_assignment_ids: [101],
      reading_prerequisites: [
        { reading_classwork_id: 501, reading_assignment_id: 5001, display_order: 1 },
      ],
    });
    api.createAssessment.mockResolvedValue({
      remediation_request_id: "00000000-0000-4000-8000-000000000001",
      intervention_id: 12,
      classwork_id: 900,
      classwork_assignment_id: 901,
      quiz_id: 902,
      draft_format: "QUIZ",
      grade_treatment: "WRITTEN_WORK",
      is_published: false,
    });
    api.previewScore.mockResolvedValue({
      score_adjustment_cap: 75,
      previews: [{
        assignment_id: 101,
        title: "Worksheet 1",
        original_score: 10,
        max_points: 20,
        max_adjusted_score: 15,
        possible_gain: 5,
        cap_percentage: 75,
        was_adjusted: true,
        was_capped: true,
      }],
      disclaimer: "Hypothetical maximum only",
    });
    api.projectGrade.mockResolvedValue({
      status: "UNAVAILABLE",
      grade_representation: "TRANSMUTED_TERM_GRADE",
      target_projections: [],
      eligible_target_gains: [],
      additional_eligible_targets_have_positive_improvement: false,
      assumptions: [],
      unavailable_reasons: [],
      ai_midterm_what_if: { status: "UNAVAILABLE", target_estimates: [], unavailable_reasons: [], limitations: [] },
    });
  });

  afterEach(cleanup);

  it("preflights and saves the reviewed draft once as unpublished", async () => {
    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findAllByText("75% Cap");
    fireEvent.click(screen.getByRole("button", { name: /Generate with AI/i }));
    const dialog = await screen.findByRole("dialog", { name: /AI Remediation Draft Preview/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Assessment Draft" }));

    await waitFor(() => expect(api.createAssessment).toHaveBeenCalledTimes(1));
    expect(api.preflightDraft).toHaveBeenCalledWith(12, mockQuizDraft);
    expect(api.preflightDraft.mock.invocationCallOrder[0]).toBeLessThan(
      api.createAssessment.mock.invocationCallOrder[0]
    );
    expect(api.createAssessment).toHaveBeenCalledWith(
      12,
      expect.stringMatching(/^[0-9a-f-]{36}$/i),
      mockQuizDraft
    );
    expect(await within(dialog).findByText("Assessment draft saved")).toBeTruthy();
    expect(within(dialog).getByText("Saved Unpublished")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Open Saved Assessment" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Save Assessment Draft" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close Preview" }));
    expect(await screen.findByText(mockQuizDraft.title)).toBeTruthy();
    expect(screen.getByText("20 points")).toBeTruthy();
    expect(screen.getByText("Unpublished")).toBeTruthy();
    expect(screen.getByRole("button", { name: "View Assessment" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Assessment" })).toBeTruthy();
    expect(screen.queryByText("No activity created yet")).toBeNull();
    expect(screen.queryByRole("button", { name: /Generate with AI/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Continue to Quiz Builder/i })).toBeNull();
  });

  it("reopens a persisted unpublished assessment from workspace progress", async () => {
    api.workspace.mockResolvedValue({
      ...workspace,
      plan: {
        teacher_choice: "QUIZ",
        grade_treatment: "WRITTEN_WORK",
        target_assignment_ids: [101],
        score_adjustment_cap: 75,
        selected_resources: [{ kind: "CLASSWORK", id: 501 }],
        ai_suggestion: null,
      },
      resources: [sampleReading],
      progress: {
        ...workspace.progress,
        assigned_remediation: [{
          title: mockQuizDraft.title,
          assignment_id: 901,
          classwork_id: 900,
          classwork_type: "QUIZ",
          is_published: false,
          component: "WRITTEN_WORK",
          is_graded: true,
          submission_status: "draft",
          grade: null,
          total_points: 20,
          original_assignment_id: 101,
          original_title: "Worksheet 1",
        }],
      },
    });
    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    expect(await screen.findByText(mockQuizDraft.title)).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText("Unpublished")).toBeTruthy();
    expect(screen.getByRole("button", { name: "View Assessment" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Assessment" })).toBeTruthy();
    expect(screen.queryByText("No activity created yet")).toBeNull();
    expect(screen.queryByRole("button", { name: /Generate with AI/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Continue to Quiz Builder/i })).toBeNull();
  });

  it("shows the backend point-matching failure and does not create an assessment", async () => {
    api.preflightDraft.mockRejectedValue(
      new InterventionApiError(
        422,
        "Remedial draft total points (24) must equal original classwork maximum points (20)"
      )
    );
    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findAllByText("75% Cap");
    fireEvent.click(screen.getByRole("button", { name: /Generate with AI/i }));
    const dialog = await screen.findByRole("dialog", { name: /AI Remediation Draft Preview/i });
    fireEvent.click(within(dialog).getAllByRole("button", { name: /Edit Draft/i })[0]);
    fireEvent.change(within(dialog).getAllByLabelText("Points:")[0], { target: { value: "14" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Assessment Draft" }));

    expect(await within(dialog).findByText(/24.*must equal.*20/i)).toBeTruthy();
    expect(api.createAssessment).not.toHaveBeenCalled();
    expect(within(dialog).getByText("24 Total Points")).toBeTruthy();
  });

  it("reuses the idempotency key when retrying an uncertain save", async () => {
    api.createAssessment
      .mockRejectedValueOnce(new Error("Connection interrupted while saving."))
      .mockResolvedValueOnce({
        remediation_request_id: "00000000-0000-4000-8000-000000000001",
        intervention_id: 12,
        classwork_id: 900,
        classwork_assignment_id: 901,
        quiz_id: 902,
        draft_format: "QUIZ",
        grade_treatment: "WRITTEN_WORK",
        is_published: false,
      });
    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findAllByText("75% Cap");
    fireEvent.click(screen.getByRole("button", { name: /Generate with AI/i }));
    const dialog = await screen.findByRole("dialog", { name: /AI Remediation Draft Preview/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Assessment Draft" }));
    expect(await within(dialog).findByText("Connection interrupted while saving.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Assessment Draft" }));

    await waitFor(() => expect(api.createAssessment).toHaveBeenCalledTimes(2));
    expect(api.createAssessment.mock.calls[0][1]).toBe(api.createAssessment.mock.calls[1][1]);
    expect(await within(dialog).findByText("Saved Unpublished")).toBeTruthy();
  });

  it("requests the original target maximum instead of silently generating a 20-point graded draft", async () => {
    const fortyPointDetail: TeacherInterventionDetail = {
      ...detailWithClassworks,
      diagnosis_snapshot: {
        ...detailWithClassworks.diagnosis_snapshot,
        supporting_activities: [{
          classwork_id: 101,
          classwork_assignment_id: 101,
          title: "Forty Point Worksheet",
          component: "WRITTEN_WORK",
          score: 20,
          possible_score: 40,
          percent: 50,
        }],
      },
    };
    api.previewScore.mockResolvedValue({
      score_adjustment_cap: 75,
      previews: [{ assignment_id: 101, title: "Forty Point Worksheet", original_score: 20, max_points: 40, max_adjusted_score: 30, possible_gain: 10, cap_percentage: 75, was_adjusted: true, was_capped: true }],
      disclaimer: "Hypothetical maximum only",
    });
    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={fortyPointDetail} page="plan" />
      </MemoryRouter>
    );

    await screen.findAllByText("75% Cap");
    await waitFor(() => expect(api.previewScore).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Generate with AI/i }));

    await waitFor(() => expect(api.generateDraft).toHaveBeenCalledWith(
      12,
      expect.objectContaining({ total_points: 40 })
    ));
  });
});

describe("PR 2D.2B.6: Lock Saved Remediation Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.materials.mockResolvedValue({ items: [], total: 0 });
    api.previewScore.mockResolvedValue({
      score_adjustment_cap: 75,
      previews: [{
        assignment_id: 101,
        title: "Worksheet 1",
        original_score: 10,
        max_points: 20,
        max_adjusted_score: 15,
        possible_gain: 5,
        cap_percentage: 75,
        was_adjusted: true,
        was_capped: true,
      }],
      disclaimer: "Hypothetical maximum only",
    });
    api.projectGrade.mockResolvedValue({
      status: "UNAVAILABLE",
      grade_representation: "TRANSMUTED_TERM_GRADE",
      target_projections: [],
      eligible_target_gains: [],
      additional_eligible_targets_have_positive_improvement: false,
      assumptions: [],
      unavailable_reasons: [],
      ai_midterm_what_if: { status: "UNAVAILABLE", target_estimates: [], unavailable_reasons: [], limitations: [] },
    });
  });

  afterEach(cleanup);

  it("scenario 1: before assessment exists, preserves selectable format, grade treatment, targets, and cap", async () => {
    api.workspace.mockResolvedValue({
      ...workspace,
      plan: {
        teacher_choice: "QUIZ",
        grade_treatment: "WRITTEN_WORK",
        target_assignment_ids: [101],
        score_adjustment_cap: 75,
        selected_resources: [],
        ai_suggestion: null,
      },
      resources: [sampleReading],
      progress: {
        ...workspace.progress,
        assigned_remediation: [],
        completed_remediation: [],
      },
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findAllByText("75% Cap");

    // Format delivery cards are interactive (not locked)
    const quizCard = screen.getByRole("radio", { name: /^Quiz/i });
    expect(quizCard.getAttribute("aria-disabled")).toBe("false");
    expect(within(quizCard).queryByText("Locked")).toBeNull();

    // Grade Treatment is interactive (selectable options, not read-only locked card)
    expect(screen.queryByText("Saved Grade Treatment")).toBeNull();
    expect(screen.getByText("How should this activity be treated?")).toBeTruthy();
    expect(screen.getAllByText("Written Work").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Ungraded Activity")).toBeTruthy();

    // Targeted classwork allows reselecting
    expect(screen.getByRole("button", { name: "Reselect Activities" })).toBeTruthy();
  });

  it("scenario 2: locks academic settings immediately after saving assessment draft in modal", async () => {
    api.workspace.mockResolvedValue({
      ...workspace,
      plan: {
        teacher_choice: "QUIZ",
        grade_treatment: "WRITTEN_WORK",
        target_assignment_ids: [101],
        score_adjustment_cap: 75,
        selected_resources: [{ kind: "CLASSWORK", id: 501 }],
        ai_suggestion: null,
      },
      resources: [sampleReading],
      focus: {
        ...workspace.focus,
        lesson_ids: [42],
        competency_ids: [101],
        question_evidence: [{ quiz_question_id: 999, score: 0, possible_score: 5 }],
      },
    });
    api.savePlan.mockImplementation(async (_id, savedPlan) => ({
      ...workspace,
      plan: {
        ...workspace.plan,
        ...savedPlan,
        teacher_choice: "QUIZ",
        grade_treatment: "WRITTEN_WORK",
        target_assignment_ids: [101],
        score_adjustment_cap: 75,
      },
      resources: [sampleReading],
      focus: workspace.focus,
      progress: workspace.progress,
      original_exams: [],
    }));
    api.generateDraft.mockResolvedValue(mockQuizDraft);
    api.preflightDraft.mockResolvedValue({
      is_valid: true,
      draft_format: "QUIZ",
      target_component: "WRITTEN_WORK",
      grade_treatment: "WRITTEN_WORK",
      total_points: 20,
      authoritative_cap: 75,
      target_assignment_ids: [101],
      reading_prerequisites: [],
    });
    api.createAssessment.mockResolvedValue({
      remediation_request_id: "00000000-0000-4000-8000-000000000001",
      intervention_id: 12,
      classwork_id: 900,
      classwork_assignment_id: 901,
      quiz_id: 902,
      draft_format: "QUIZ",
      grade_treatment: "WRITTEN_WORK",
      is_published: false,
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    await screen.findAllByText("75% Cap");
    fireEvent.click(screen.getByRole("button", { name: /Generate with AI/i }));
    const dialog = await screen.findByRole("dialog", { name: /AI Remediation Draft Preview/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Assessment Draft" }));

    await waitFor(() => expect(api.createAssessment).toHaveBeenCalledTimes(1));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close Preview" }));

    // Now assessment is saved in session:
    // 1. Grade treatment is read-only
    expect(await screen.findByText("Saved Grade Treatment")).toBeTruthy();
    expect(screen.getAllByText("Locked").length).toBeGreaterThanOrEqual(1);

    // 2. Format delivery cards are locked
    const quizCard = screen.getByRole("radio", { name: /^Quiz/i });
    expect(quizCard.getAttribute("aria-disabled")).toBe("true");

    // 3. Reselect Activities button is hidden
    expect(screen.queryByRole("button", { name: "Reselect Activities" })).toBeNull();

    // 4. Shows original target, max points, and saved cap
    expect(screen.getByText(/Original max: 20 pts · Capped at 75%/i)).toBeTruthy();
  });

  it("scenario 3: persisted unpublished draft after reload locks format, grade treatment, targets, and cap", async () => {
    api.workspace.mockResolvedValue({
      ...workspace,
      plan: {
        teacher_choice: "QUIZ",
        grade_treatment: "WRITTEN_WORK",
        target_assignment_ids: [101],
        score_adjustment_cap: 75,
        selected_resources: [{ kind: "CLASSWORK", id: 501 }],
        ai_suggestion: null,
      },
      resources: [sampleReading],
      progress: {
        ...workspace.progress,
        assigned_remediation: [{
          title: mockQuizDraft.title,
          assignment_id: 901,
          classwork_id: 900,
          classwork_type: "QUIZ",
          is_published: false,
          component: "WRITTEN_WORK",
          is_graded: true,
          submission_status: "draft",
          grade: null,
          total_points: 20,
          original_assignment_id: 101,
          original_title: "Worksheet 1",
        }],
      },
    });

    const onChangesChange = vi.fn();
    render(
      <MemoryRouter>
        <InterventionSupportMaterials
          detail={detailWithClassworks}
          page="plan"
          onChangesChange={onChangesChange}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText("Saved Grade Treatment")).toBeTruthy();
    expect(screen.getAllByText("Locked").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Worksheet 1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Original max: 20 pts · Capped at 75%/i)).toBeTruthy();

    // Format cards are locked
    const formatCards = screen.getAllByRole("radio");
    formatCards.forEach((card) => {
      expect(card.getAttribute("aria-disabled")).toBe("true");
    });

    // Clicking Classwork format card does NOT change selection or trigger dirty state
    const classworkCard = screen.getByRole("radio", { name: /^Classwork/i });
    fireEvent.click(classworkCard);
    expect(classworkCard.getAttribute("aria-checked")).toBe("false");
    expect(onChangesChange).not.toHaveBeenCalledWith(true);

    // Reselect button is absent
    expect(screen.queryByRole("button", { name: "Reselect Activities" })).toBeNull();
  });

  it("scenario 4: published assessment and student submissions preserve locks and assessment links", async () => {
    api.workspace.mockResolvedValue({
      ...workspace,
      plan: {
        teacher_choice: "QUIZ",
        grade_treatment: "WRITTEN_WORK",
        target_assignment_ids: [101],
        score_adjustment_cap: 75,
        selected_resources: [{ kind: "CLASSWORK", id: 501 }],
        ai_suggestion: null,
      },
      resources: [sampleReading],
      progress: {
        ...workspace.progress,
        assigned_remediation: [{
          title: "Final Remediation Quiz",
          assignment_id: 901,
          classwork_id: 900,
          classwork_type: "QUIZ",
          is_published: true,
          component: "WRITTEN_WORK",
          is_graded: true,
          submission_status: "graded",
          grade: 18,
          total_points: 20,
          original_assignment_id: 101,
          original_title: "Worksheet 1",
          original_grade: 10,
          effective_grade: 15,
        }],
      },
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={detailWithClassworks} page="plan" />
      </MemoryRouter>
    );

    expect(await screen.findByText("Saved Grade Treatment")).toBeTruthy();
    expect(screen.getByText("Final Remediation Quiz")).toBeTruthy();
    expect(screen.getAllByText("Published").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "View Assessment" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Assessment" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reselect Activities" })).toBeNull();
    expect(screen.getByText(/Original max: 20 pts · Capped at 75%/i)).toBeTruthy();
  });

  it("scenario 5: locked settings do not become dirty, while permitted Reading changes save correctly", async () => {
    const secondReading = {
      id: 502,
      kind: "CLASSWORK" as const,
      classwork_type: "READING" as const,
      title: "Algebraic Expressions Overview",
      recommended: false,
      match_level: "TOPIC" as const,
      lesson: "Algebra Basics",
      is_graded: false,
    };

    api.workspace.mockResolvedValue({
      ...workspace,
      plan: {
        teacher_choice: "QUIZ",
        grade_treatment: "WRITTEN_WORK",
        target_assignment_ids: [101],
        score_adjustment_cap: 75,
        selected_resources: [{ kind: "CLASSWORK", id: 501 }],
        ai_suggestion: null,
      },
      resources: [sampleReading, secondReading],
      progress: {
        ...workspace.progress,
        assigned_remediation: [{
          title: mockQuizDraft.title,
          assignment_id: 901,
          classwork_id: 900,
          classwork_type: "QUIZ",
          is_published: false,
          component: "WRITTEN_WORK",
          is_graded: true,
          submission_status: "draft",
          grade: null,
          total_points: 20,
          original_assignment_id: 101,
          original_title: "Worksheet 1",
        }],
      },
    });

    api.savePlan.mockImplementation(async (_id, savedPlan) => ({
      ...workspace,
      plan: {
        ...workspace.plan,
        ...savedPlan,
      },
      resources: [sampleReading, secondReading],
      progress: {
        ...workspace.progress,
        assigned_remediation: [{
          title: mockQuizDraft.title,
          assignment_id: 901,
          classwork_id: 900,
          classwork_type: "QUIZ",
          is_published: false,
          component: "WRITTEN_WORK",
          is_graded: true,
          submission_status: "draft",
          grade: null,
          total_points: 20,
          original_assignment_id: 101,
          original_title: "Worksheet 1",
        }],
      },
      focus: workspace.focus,
      original_exams: [],
    }));

    const onChangesChange = vi.fn();
    const ref = createRef<InterventionSupportMaterialsHandle>();

    render(
      <MemoryRouter>
        <InterventionSupportMaterials
          ref={ref}
          detail={detailWithClassworks}
          page="plan"
          onChangesChange={onChangesChange}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText("Saved Grade Treatment")).toBeTruthy();

    // Clicking locked format cards does not trigger changes
    const classworkCard = screen.getByRole("radio", { name: /^Classwork/i });
    fireEvent.click(classworkCard);
    expect(onChangesChange).not.toHaveBeenCalledWith(true);

    // Permitted: toggle reading resource via Select resources modal
    fireEvent.click(screen.getByRole("button", { name: "Select resources" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Supporting Resources" });
    const matches = within(dialog).getAllByText("Algebraic Expressions Overview");
    fireEvent.click(matches[0].closest(".cursor-pointer") as HTMLElement);
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(onChangesChange).toHaveBeenCalledWith(true);
    });

    // Save adjustments saves reading changes while preserving locked academic settings
    const saveSuccess = await ref.current?.saveAdjustments();
    expect(saveSuccess).toBe(true);

    expect(api.savePlan).toHaveBeenCalledTimes(1);
    expect(api.savePlan).toHaveBeenCalledWith(
      12,
      expect.objectContaining({
        teacher_choice: "QUIZ",
        grade_treatment: "WRITTEN_WORK",
        target_assignment_ids: [101],
        score_adjustment_cap: 75,
        selected_resources: expect.arrayContaining([
          expect.objectContaining({ id: 501 }),
          expect.objectContaining({ id: 502 }),
        ]),
      })
    );
  });
});

