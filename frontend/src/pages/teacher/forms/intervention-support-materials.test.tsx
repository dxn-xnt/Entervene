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

  it("displays a saved recommendation without making another advisory request", async () => {
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
    expect(within(tosCard as HTMLElement).queryByText("Selected")).toBeNull();
    expect(api.advisory).not.toHaveBeenCalled();
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

