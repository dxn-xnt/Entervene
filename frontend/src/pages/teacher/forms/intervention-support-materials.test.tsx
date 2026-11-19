// @vitest-environment jsdom

import { createRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RemediationQuizDraft,
  RemediationWorkspace,
  SubjectGradeProjectionResponse,
  TeacherInterventionDetail,
} from "@/lib/teacher-interventions-api";
import InterventionSupportMaterials, {
  type InterventionSupportMaterialsHandle,
} from "./intervention-support-materials";

const apiMocks = vi.hoisted(() => ({
  listSupportMaterials: vi.fn(),
  getRemediationWorkspace: vi.fn(),
  saveRemediationPlan: vi.fn(),
  generateRemediationAdvisory: vi.fn(),
  previewScoreAdjustment: vi.fn(),
  projectSubjectGrade: vi.fn(),
  generateRemediationDraft: vi.fn(),
  preflightRemediationDraft: vi.fn(),
  createRemediationAssessment: vi.fn(),
  getTeacherPracticeAssessment: vi.fn(),
  listTeacherPracticeAttempts: vi.fn(),
  getTeacherClasses: vi.fn(),
}));

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  getTeacherClasses: apiMocks.getTeacherClasses,
}));

vi.mock("@/lib/practice-assessment-api", () => ({
  getTeacherPracticeAssessment: apiMocks.getTeacherPracticeAssessment,
  listTeacherPracticeAttempts: apiMocks.listTeacherPracticeAttempts,
}));

vi.mock("@/lib/teacher-interventions-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/teacher-interventions-api")>();
  return {
    ...actual,
    listSupportMaterials: apiMocks.listSupportMaterials,
    getRemediationWorkspace: apiMocks.getRemediationWorkspace,
    saveRemediationPlan: apiMocks.saveRemediationPlan,
    generateRemediationAdvisory: apiMocks.generateRemediationAdvisory,
    previewScoreAdjustment: apiMocks.previewScoreAdjustment,
    projectSubjectGrade: apiMocks.projectSubjectGrade,
    generateRemediationDraft: apiMocks.generateRemediationDraft,
    preflightRemediationDraft: apiMocks.preflightRemediationDraft,
    createRemediationAssessment: apiMocks.createRemediationAssessment,
  };
});

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="current-location">{`${location.pathname}${location.search}`}</span>;
}

const baseDetail: TeacherInterventionDetail = {
  intervention_id: 7,
  student_id: "student-1",
  student_name: "Morgan Striving",
  student_lrn: "123456789012",
  class_id: 1,
  class_name: "Grade 9 - Newton",
  subject_id: 1,
  subject_name: "Mathematics",
  academic_period_id: 1,
  academic_period_name: "1st Quarter",
  status: "ACTIVE",
  source_prediction_id: 57,
  source_prediction_revision: 1,
  triggering_predicted_grade: 72.4,
  triggering_intervention_level: "MODERATE_RISK",
  current_prediction_revision: 2,
  current_predicted_grade: 73.1,
  current_intervention_level: "MODERATE_RISK",
  created_at: "2026-10-20T00:00:00Z",
  activated_at: "2026-10-20T01:00:00Z",
  activated_by_staff_id: "DEMO-T-001",
  resolved_at: null,
  resolution_reason: null,
  diagnosis_summary: {
    weakest_supported_components: ["WRITTEN_WORK"],
  },
  diagnosis_snapshot: {
    weakest_supported_components: ["WRITTEN_WORK"],
    supporting_activities: [
      {
        classwork_id: 1,
        classwork_assignment_id: 101,
        title: "WW 1 - Number Sense",
        component: "WRITTEN_WORK",
        score: 8,
        possible_score: 20,
        percent: 40,
      },
      {
        classwork_id: 2,
        classwork_assignment_id: 102,
        title: "WW 2 - Algebraic Expressions",
        component: "WRITTEN_WORK",
        score: 9,
        possible_score: 20,
        percent: 45,
      },
      {
        classwork_id: 3,
        classwork_assignment_id: 103,
        title: "WW 3 - Linear Equations",
        component: "WRITTEN_WORK",
        score: 12,
        possible_score: 30,
        percent: 40,
      },
    ],
  },
};

const makeProjection = (
  overrides: Partial<SubjectGradeProjectionResponse> = {}
): SubjectGradeProjectionResponse => ({
  status: "AVAILABLE",
  grade_representation: "TRANSMUTED_TERM_GRADE",
  current_initial_grade: 71.0,
  current_subject_grade: 73.0,
  passing_threshold: 75.0,
  current_reaches_passing_threshold: false,
  target_projections: [],
  eligible_target_gains: [
    {
      assignment_id: 102,
      title: "WW 2 - Algebraic Expressions",
      component: "WRITTEN_WORK",
      original_score: 9,
      current_effective_score: 9,
      max_points: 20,
      cap_percentage: 75,
      maximum_hypothetical_effective_score: 15,
      possible_score_gain: 6,
    },
    {
      assignment_id: 103,
      title: "WW 3 - Linear Equations",
      component: "WRITTEN_WORK",
      original_score: 12,
      current_effective_score: 12,
      max_points: 30,
      cap_percentage: 75,
      maximum_hypothetical_effective_score: 22.5,
      possible_score_gain: 10.5,
    },
  ],
  additional_eligible_targets_have_positive_improvement: true,
  recommended_target_assignment_id: 102,
  assumptions: [],
  unavailable_reasons: [],
  ai_midterm_what_if: {
    status: "UNAVAILABLE",
    estimate_kind: "AI_MIDTERM_WHAT_IF_ESTIMATE",
    is_official_grade: false,
    is_guaranteed: false,
    prediction_purpose: "CURRENT_TERM_FINAL_GRADE_PROJECTION",
    evidence_basis: "LIVE_ACTUAL_EVIDENCE_WITH_EPHEMERAL_CAPPED_WW_PT_OVERRIDES",
    readiness: {},
    target_estimates: [],
    unavailable_reasons: [],
    limitations: [],
  },
  ...overrides,
});

const makeWorkspace = (targetAssignmentIds: number[] = [101]): RemediationWorkspace => ({
  plan: {
    teacher_choice: "QUIZ",
    grade_treatment: "WRITTEN_WORK",
    target_assignment_ids: targetAssignmentIds,
    score_adjustment_cap: 75,
    selected_resources: [],
    ai_suggestion: null,
  },
  resources: [],
  focus: {
    basis: "FROZEN_TRIGGER_DIAGNOSIS",
    evidence_level: "QUESTION_SCORE",
    component: "WRITTEN_WORK",
    exam_subtype: null,
    exam_subtype_requires_confirmation: false,
    lesson_ids: [1],
    lessons: [{ id: 1, title: "Linear Equations" }],
    competency_ids: [1],
    competencies: [{ id: 1, label: "Solve linear equations" }],
    topics: [],
    source_classwork_ids: [1],
    question_evidence: [],
    coverage_is_context_only: false,
  },
  progress: {
    triggering_projection: 72.4,
    latest_projection: 73.1,
    latest_revision: 2,
    completed_remediation: [
      {
        title: "Remedial Quiz 1",
        assignment_id: 501,
        grade: 18,
        total_points: 20,
      },
    ],
    assigned_remediation: [
      {
        title: "Remedial Quiz 1",
        assignment_id: 501,
        classwork_id: 401,
        classwork_type: "QUIZ",
        is_published: true,
        component: "WRITTEN_WORK",
        is_graded: true,
        submission_status: "graded",
        grade: 18,
        total_points: 20,
        original_assignment_id: 101,
        original_title: "WW 1 - Number Sense",
        original_grade: 8,
        effective_grade: 15,
      },
    ],
    status: "ACTIVE",
    status_reason: "Latest projected final grade remains below 75.",
  },
  original_exams: [],
  score_previews: [
    {
      assignment_id: 101,
      title: "WW 1 - Number Sense",
      original_score: 8,
      max_points: 20,
      max_adjusted_score: 15,
      possible_gain: 7,
      cap_percentage: 75,
      was_adjusted: true,
      was_capped: true,
    },
    {
      assignment_id: 102,
      title: "WW 2 - Algebraic Expressions",
      original_score: 9,
      max_points: 20,
      max_adjusted_score: 15,
      possible_gain: 6,
      cap_percentage: 75,
      was_adjusted: true,
      was_capped: true,
    },
    {
      assignment_id: 103,
      title: "WW 3 - Linear Equations",
      original_score: 12,
      max_points: 30,
      max_adjusted_score: 22.5,
      possible_gain: 10.5,
      cap_percentage: 75,
      was_adjusted: true,
      was_capped: true,
    },
  ],
  generation_eligibility: {
    original_evidence_cutoff_at: "2026-10-20T00:00:00Z",
    active_remediation_cutoff_at: "2026-10-20T00:00:00Z",
    refresh_available: false,
    eligible_taught_lessons: [{ lesson_id: 1, title: "Linear Equations" }],
    blocked_lessons: [],
    evidence_version: 1,
    evidence_provenance: "FROZEN",
  },
});

const mockDraft: RemediationQuizDraft = {
  draft_format: "QUIZ",
  target_component: "WRITTEN_WORK",
  grade_treatment: "WRITTEN_WORK",
  title: "Remedial Quiz 2 - Linear Equations",
  instructions: "Complete all items carefully.",
  total_points: 30,
  duration_minutes: 20,
  questions: [
    {
      question_text: "Solve 2x + 4 = 10.",
      question_type: "MULTIPLE_CHOICE",
      points: 30,
      display_order: 1,
      difficulty_level: "MEDIUM",
      targeted_competency_id: 1,
      targeted_lesson_id: 1,
      options: [
        { option_text: "x = 3", option_order: 1 },
        { option_text: "x = 2", option_order: 2 },
      ],
      teacher_answer_key: {
        correct_answer: "x = 3",
        explanation: "Subtract 4 and divide by 2.",
      },
    },
  ],
};

beforeEach(() => {
  apiMocks.listSupportMaterials.mockResolvedValue({ items: [], total: 0 });
  apiMocks.getRemediationWorkspace.mockResolvedValue(makeWorkspace([101]));
  apiMocks.projectSubjectGrade.mockResolvedValue(makeProjection());
  apiMocks.previewScoreAdjustment.mockResolvedValue({
    score_adjustment_cap: 75,
    previews: makeWorkspace().score_previews,
    disclaimer: "Preview",
  });
  apiMocks.generateRemediationDraft.mockResolvedValue(mockDraft);
  apiMocks.preflightRemediationDraft.mockResolvedValue({
    is_valid: true,
    draft_format: "QUIZ",
    target_component: "WRITTEN_WORK",
    grade_treatment: "WRITTEN_WORK",
    total_points: 30,
    authoritative_cap: 75,
    target_assignment_ids: [103],
    reading_prerequisites: [],
  });
  apiMocks.createRemediationAssessment.mockResolvedValue({
    remediation_request_id: "req-2",
    intervention_id: 7,
    classwork_id: 402,
    classwork_assignment_id: 502,
    quiz_id: 902,
    draft_format: "QUIZ",
    grade_treatment: "WRITTEN_WORK",
    is_published: false,
  });
  apiMocks.getTeacherPracticeAssessment.mockResolvedValue(null);
  apiMocks.listTeacherPracticeAttempts.mockResolvedValue([]);
  apiMocks.getTeacherClasses.mockResolvedValue([]);
  apiMocks.saveRemediationPlan.mockImplementation(async (_id: number, payload: { target_assignment_ids?: number[] }) =>
    makeWorkspace(payload.target_assignment_ids ?? [101])
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InterventionSupportMaterials progressive target selection and creation", () => {
  it("replaces unlinked targets instead of accumulating, confirms on Done, and reveals the New Remediation Activity section while preserving Activity 1", async () => {
    const ref = createRef<InterventionSupportMaterialsHandle>();

    render(
      <MemoryRouter>
        <InterventionSupportMaterials
          ref={ref}
          detail={baseDetail}
          page="plan"
          wizardStep={3}
        />
      </MemoryRouter>
    );

    const addAnotherBtn = await screen.findByRole("button", {
      name: "Add Another Remediation Activity",
    });

    // Before confirming a second target, New Remediation Activity is hidden while Activity 1 is shown
    expect(screen.getByText("Remedial Quiz 1")).toBeDefined();
    expect(screen.queryByLabelText("New Remediation Activity")).toBeNull();

    fireEvent.click(addAnotherBtn);

    // Linked target 101 is excluded; unlinked targets 102 and 103 are shown
    expect(
      screen.queryByRole("checkbox", {
        name: "Select WW 1 - Number Sense as the remediation target",
      })
    ).toBeNull();
    const target102Checkbox = screen.getByRole("checkbox", {
      name: "Select WW 2 - Algebraic Expressions as the remediation target",
    });
    const target103Checkbox = screen.getByRole("checkbox", {
      name: "Select WW 3 - Linear Equations as the remediation target",
    });

    // Recommended target 102 was pre-selected on open; switch to 103 and click Done
    expect(target102Checkbox.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(target103Checkbox);
    expect(target103Checkbox.getAttribute("aria-checked")).toBe("true");
    expect(target102Checkbox.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    // Activity 1 history remains preserved and New Remediation Activity section appears for target 103
    const newSection = await screen.findByLabelText("New Remediation Activity");
    expect(screen.getByText("Remedial Quiz 1")).toBeDefined();
    expect(screen.getByText("WW 1 - Number Sense")).toBeDefined();
    expect(within(newSection).getByText("WW 3 - Linear Equations")).toBeDefined();
    expect(within(newSection).getByRole("button", { name: /Generate with AI/i })).toBeDefined();
    expect(within(newSection).getByRole("button", { name: /Continue to Quiz Builder/i })).toBeDefined();

    const saved = await ref.current?.saveAdjustments();
    expect(saved).toBe(true);
    expect(apiMocks.saveRemediationPlan).toHaveBeenCalledOnce();
    const [, savePayload] = apiMocks.saveRemediationPlan.mock.calls[0];
    expect(savePayload.target_assignment_ids).toEqual([101, 103]);
    expect(savePayload.original_exam_assignment_id).toBeUndefined();
  });

  it("propagates the newly selected target ID (103) to AI draft generation and assessment creation", async () => {
    render(
      <MemoryRouter>
        <InterventionSupportMaterials
          detail={baseDetail}
          page="plan"
          wizardStep={3}
        />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Add Another Remediation Activity" }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select WW 3 - Linear Equations as the remediation target",
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    const newSection = await screen.findByLabelText("New Remediation Activity");
    fireEvent.click(within(newSection).getByRole("button", { name: /Generate with AI/i }));

    await waitFor(() => {
      expect(apiMocks.generateRemediationDraft).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          draft_format: "QUIZ",
          grade_treatment: "WRITTEN_WORK",
          target_assignment_id: 103,
          total_points: 30,
        })
      );
    });

    const saveDraftBtn = await screen.findByRole("button", { name: /Save Assessment Draft/i });
    fireEvent.click(saveDraftBtn);

    await waitFor(() => {
      expect(apiMocks.preflightRemediationDraft).toHaveBeenCalledWith(7, 103, expect.any(Object));
      expect(apiMocks.createRemediationAssessment).toHaveBeenCalledWith(
        7,
        expect.any(String),
        103,
        expect.any(Object)
      );
    });
  });

  it("propagates the newly selected target ID (103) to manual Quiz Builder navigation", async () => {
    render(
      <MemoryRouter initialEntries={["/teacher/interventions"]}>
        <LocationProbe />
        <InterventionSupportMaterials
          detail={baseDetail}
          page="plan"
          wizardStep={3}
        />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Add Another Remediation Activity" }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select WW 3 - Linear Equations as the remediation target",
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    const newSection = await screen.findByLabelText("New Remediation Activity");
    fireEvent.click(within(newSection).getByRole("button", { name: /Continue to Quiz Builder/i }));

    await waitFor(() => {
      const loc = screen.getByTestId("current-location").textContent ?? "";
      expect(loc).toContain("/teacher/classworks?");
      expect(loc).toContain("original_classwork_assignment_id=103");
      expect(loc).not.toContain("original_classwork_assignment_id=101");
    });
  });

  it("blocks additional activity creation when progression conditions are not satisfied", async () => {
    apiMocks.projectSubjectGrade.mockResolvedValue(
      makeProjection({
        current_reaches_passing_threshold: true,
        additional_eligible_targets_have_positive_improvement: false,
      })
    );

    render(
      <MemoryRouter>
        <InterventionSupportMaterials
          detail={baseDetail}
          page="plan"
          wizardStep={3}
        />
      </MemoryRouter>
    );

    await screen.findByText(/meets the passing threshold/i);
    expect(screen.queryByRole("button", { name: "Add Another Remediation Activity" })).toBeNull();
    expect(screen.queryByLabelText("New Remediation Activity")).toBeNull();
    expect(screen.queryByRole("button", { name: /Generate with AI/i })).toBeNull();
  });

  it("retains the saved second target and New Remediation Activity section after reopening or refreshing", async () => {
    apiMocks.getRemediationWorkspace.mockResolvedValue(makeWorkspace([101, 103]));

    render(
      <MemoryRouter>
        <InterventionSupportMaterials
          detail={baseDetail}
          page="plan"
          wizardStep={3}
        />
      </MemoryRouter>
    );

    const newSection = await screen.findByLabelText("New Remediation Activity");
    expect(within(newSection).getByText("WW 3 - Linear Equations")).toBeDefined();
    expect(screen.getByRole("button", { name: "Change Target" })).toBeDefined();
  });

  it("displays both graded remediation activities with independent capped outcomes and stops progression when no eligible targets remain", async () => {
    const workspaceWithTwoGraded = makeWorkspace([101, 103]);
    workspaceWithTwoGraded.progress = {
      ...workspaceWithTwoGraded.progress,
      completed_remediation: [
        ...workspaceWithTwoGraded.progress.completed_remediation,
        {
          title: "Remedial Quiz 2",
          assignment_id: 502,
          grade: 27,
          total_points: 30,
        },
      ],
      assigned_remediation: [
        ...(workspaceWithTwoGraded.progress.assigned_remediation ?? []),
        {
          title: "Remedial Quiz 2",
          assignment_id: 502,
          classwork_id: 602,
          classwork_type: "QUIZ",
          is_published: true,
          component: "WRITTEN_WORK",
          is_graded: true,
          submission_status: "graded",
          grade: 27,
          total_points: 30,
          original_assignment_id: 103,
          original_title: "WW 3 - Linear Equations",
          original_grade: 9,
          effective_grade: 22.5,
        },
      ],
    };
    apiMocks.getRemediationWorkspace.mockResolvedValue(workspaceWithTwoGraded);
    apiMocks.projectSubjectGrade.mockResolvedValue(
      makeProjection({
        current_subject_grade: 74,
        current_reaches_passing_threshold: false,
        eligible_target_gains: [],
        additional_eligible_targets_have_positive_improvement: false,
        recommended_target_assignment_id: null,
      })
    );

    render(
      <MemoryRouter>
        <InterventionSupportMaterials
          detail={baseDetail}
          page="plan"
          wizardStep={3}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText("Remedial Quiz 1")).toBeDefined();
    expect(screen.getByText("Remedial Quiz 2")).toBeDefined();
    expect(screen.getAllByText("WW 1 - Number Sense").length).toBeGreaterThan(0);
    expect(screen.getAllByText("WW 3 - Linear Equations").length).toBeGreaterThan(0);
    expect(screen.getByText("15/20")).toBeDefined();
    expect(screen.getByText("22.5/30")).toBeDefined();
    expect(await screen.findByText(/No unused eligible classwork has a positive possible improvement/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Add Another Remediation Activity" })).toBeNull();
    expect(screen.queryByLabelText("New Remediation Activity")).toBeNull();
  });
});
