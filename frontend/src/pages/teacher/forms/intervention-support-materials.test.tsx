// @vitest-environment jsdom

import { createRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RemediationQuizDraft,
  RemediationResource,
  RemediationWorkspace,
  SubjectGradeProjectionResponse,
  TeacherInterventionDetail,
} from "@/lib/teacher-interventions-api";
import InterventionSupportMaterials, {
  type InterventionSupportMaterialsHandle,
} from "./intervention-support-materials";
import {
  PracticeAssessmentApiError,
  type PracticeAssessmentDetail,
} from "@/lib/practice-assessment-api";

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
const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({
    success: toastMocks.success,
    error: toastMocks.error,
  }),
}));

vi.mock("@/lib/api", () => ({
  getTeacherClasses: apiMocks.getTeacherClasses,
}));

vi.mock("./create-classwork", () => ({
  default: ({
    onSuccess,
    interventionResourceContext,
    initialLessonId,
  }: {
    onSuccess: (created: unknown) => void;
    interventionResourceContext?: Record<string, unknown> | null;
    initialLessonId?: number;
  }) => (
    <div>
      <span data-testid="nested-initial-lesson">
        {initialLessonId == null ? "unset" : String(initialLessonId)}
      </span>
      {interventionResourceContext && (
        <span data-testid="nested-intervention-context">
          {JSON.stringify({
            interventionId: interventionResourceContext.interventionId,
            studentId: interventionResourceContext.studentId,
            classId: interventionResourceContext.classId,
            subjectId: interventionResourceContext.subjectId,
            academicPeriodId: interventionResourceContext.academicPeriodId,
          })}
        </span>
      )}
      <button onClick={() => onSuccess({ classwork_id: 303, title: "Newly Created Reading" })}>
        Finish creating reading
      </button>
    </div>
  ),
}));

vi.mock("@/lib/practice-assessment-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/practice-assessment-api")>();
  return {
    ...actual,
    getTeacherPracticeAssessment: apiMocks.getTeacherPracticeAssessment,
    listTeacherPracticeAttempts: apiMocks.listTeacherPracticeAttempts,
  };
});

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

describe("InterventionSupportMaterials supporting resources", () => {
  const recommendedReading = {
    kind: "CLASSWORK" as const,
    id: 301,
    title: "Linear Equations Review",
    description: "Review reading",
    lesson: "Linear Equations",
    topic: "Linear Equations",
    attachments: [],
    classwork_type: "READING",
    access: "ALREADY_ACCESSIBLE" as const,
    ai_read: "METADATA_ONLY" as const,
    recommended: true,
    match_reason: "Matched competency metadata: Solve linear equations",
    match_level: "COMPETENCY" as const,
    match_rank: 100,
    is_graded: false,
  };
  const otherReading = {
    ...recommendedReading,
    id: 302,
    title: "Number Sense Review",
    lesson: "Number Sense",
    topic: "Number Sense",
    recommended: false,
    match_reason: null,
    match_level: null,
    match_rank: 0,
  };

  it("shows recommendations unselected, then saves, removes, and reloads explicit selections", async () => {
    const baseWorkspace = makeWorkspace([]);
    let persistedWorkspace: RemediationWorkspace = {
      ...baseWorkspace,
      resources: [recommendedReading, otherReading],
      plan: {
        ...baseWorkspace.plan,
        teacher_choice: "EXISTING_MATERIAL_ONLY",
        grade_treatment: null,
        target_assignment_ids: [],
        selected_resources: [],
      },
      progress: {
        ...baseWorkspace.progress,
        assigned_remediation: [],
        completed_remediation: [],
      },
    };
    apiMocks.getRemediationWorkspace.mockImplementation(async () => persistedWorkspace);
    apiMocks.saveRemediationPlan.mockImplementation(async (_id: number, payload) => {
      persistedWorkspace = {
        ...persistedWorkspace,
        plan: {
          ...persistedWorkspace.plan,
          ...payload,
          selected_resources: payload.selected_resources,
        },
      };
      return persistedWorkspace;
    });
    const ref = createRef<InterventionSupportMaterialsHandle>();
    const onChangesChange = vi.fn();

    const first = render(
      <MemoryRouter>
        <InterventionSupportMaterials
          ref={ref}
          detail={baseDetail}
          page="plan"
          wizardStep={1}
          onChangesChange={onChangesChange}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Recommended Materials")).toBeDefined();
    const recommendedCheckbox = screen.getByRole("checkbox", {
      name: "Select Linear Equations Review",
    });
    expect(recommendedCheckbox.getAttribute("aria-checked")).toBe("false");
    expect(apiMocks.saveRemediationPlan).not.toHaveBeenCalled();

    fireEvent.click(recommendedCheckbox);
    expect(recommendedCheckbox.getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(onChangesChange).toHaveBeenLastCalledWith(true));
    const firstSave = await ref.current?.saveAdjustments();
    expect(toastMocks.error).not.toHaveBeenCalled();
    expect(firstSave).toBe(true);
    expect(apiMocks.saveRemediationPlan).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({
        selected_resources: [{ kind: "CLASSWORK", id: 301 }],
      }),
    );

    first.unmount();
    const reopenedRef = createRef<InterventionSupportMaterialsHandle>();
    const reopenedChanges = vi.fn();
    render(
      <MemoryRouter>
        <InterventionSupportMaterials
          ref={reopenedRef}
          detail={baseDetail}
          page="plan"
          wizardStep={1}
          onChangesChange={reopenedChanges}
        />
      </MemoryRouter>,
    );

    const reopenedCheckbox = await screen.findByRole("checkbox", {
      name: "Select Linear Equations Review",
    });
    expect(reopenedCheckbox.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(reopenedCheckbox);
    await waitFor(() => expect(reopenedChanges).toHaveBeenLastCalledWith(true));
    await expect(reopenedRef.current?.saveAdjustments()).resolves.toBe(true);
    expect(apiMocks.saveRemediationPlan).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({ selected_resources: [] }),
    );
    expect(persistedWorkspace.plan.selected_resources).toEqual([]);
    expect(persistedWorkspace.plan.target_assignment_ids).toEqual([]);
    expect(persistedWorkspace.plan.teacher_choice).toBe("EXISTING_MATERIAL_ONLY");
    expect(persistedWorkspace.plan.grade_treatment).toBeNull();
  });

  it("saves a newly created reading as a strict resource reference", async () => {
    const baseWorkspace = makeWorkspace([]);
    const createdReading = {
      ...recommendedReading,
      id: 303,
      title: "Newly Created Reading",
      recommended: false,
      match_reason: null,
      match_level: null,
      match_rank: 0,
    };
    let workspace: RemediationWorkspace = {
      ...baseWorkspace,
      resources: [recommendedReading],
      plan: {
        ...baseWorkspace.plan,
        teacher_choice: "EXISTING_MATERIAL_ONLY",
        grade_treatment: null,
        target_assignment_ids: [],
        selected_resources: [],
      },
      progress: {
        ...baseWorkspace.progress,
        assigned_remediation: [],
        completed_remediation: [],
      },
    };
    apiMocks.getRemediationWorkspace.mockImplementation(async () => workspace);
    apiMocks.saveRemediationPlan.mockImplementation(async (_id: number, payload) => ({
      ...workspace,
      plan: { ...workspace.plan, ...payload },
    }));
    const ref = createRef<InterventionSupportMaterialsHandle>();
    const onChangesChange = vi.fn();

    render(
      <MemoryRouter>
        <InterventionSupportMaterials
          ref={ref}
          detail={baseDetail}
          page="plan"
          wizardStep={1}
          onChangesChange={onChangesChange}
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Add Additional Resources" }));
    workspace = { ...workspace, resources: [recommendedReading, createdReading] };
    fireEvent.click(await screen.findByRole("button", { name: "Finish creating reading" }));
    await waitFor(() => expect(onChangesChange).toHaveBeenLastCalledWith(true));

    await expect(ref.current?.saveAdjustments()).resolves.toBe(true);
    expect(apiMocks.saveRemediationPlan).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({
        selected_resources: [{ kind: "CLASSWORK", id: 303 }],
        resource_recipient_scope: "THIS_STUDENT",
      }),
    );
  });

  it("passes full intervention context into nested Create Reading modal and submits explicit Entire Class scope for existing resources", async () => {
    const existingReading: RemediationResource = {
      kind: "CLASSWORK",
      id: 305,
      title: "Factoring Cheat Sheet",
      description: "Quick review",
      lesson: "Quadratics",
      topic: "Factoring Cheat Sheet",
      attachments: [],
      classwork_type: "READING",
      access: "ALREADY_ACCESSIBLE",
      ai_read: "METADATA_ONLY",
      recommended: true,
      match_reason: "Matched lesson: Quadratics",
      match_level: "LESSON",
      match_rank: 80,
      is_graded: false,
      current_recipient_scope: "THIS_STUDENT",
    };
    const workspaceWithScopes: RemediationWorkspace = {
      ...makeWorkspace([]),
      plan: {
        ...makeWorkspace([]).plan,
        teacher_choice: null,
        grade_treatment: null,
        selected_resources: [],
      },
      resources: [existingReading],
      recipient_scopes: {
        default_scope: "THIS_STUDENT",
        this_student: {
          scope: "THIS_STUDENT",
          student_id: "student-1",
          student_name: "Morgan Striving",
          class_id: 1,
          class_name: "Grade 9 - Newton",
          student_count: 1,
        },
        entire_class: {
          scope: "ENTIRE_CLASS",
          class_id: 1,
          class_name: "Grade 9 - Newton",
          student_count: 17,
        },
        all_subject_students: {
          scope: "ALL_SUBJECT_STUDENTS",
          subject_id: 1,
          subject_name: "Mathematics",
          class_ids: [1, 2],
          class_names: ["Grade 9 - Newton", "Grade 9 - Einstein"],
          section_count: 2,
          student_count: 35,
        },
      },
      progress: {
        ...makeWorkspace([]).progress,
        assigned_remediation: [],
        completed_remediation: [],
      },
    };
    apiMocks.getRemediationWorkspace.mockResolvedValue(workspaceWithScopes);
    apiMocks.saveRemediationPlan.mockImplementation(async (_id, payload) => ({
      ...workspaceWithScopes,
      plan: { ...workspaceWithScopes.plan, selected_resources: payload.selected_resources },
    }));

    const ref = createRef<InterventionSupportMaterialsHandle>();
    render(
      <MemoryRouter>
        <InterventionSupportMaterials
          ref={ref}
          detail={baseDetail}
          page="plan"
          wizardStep={1}
        />
      </MemoryRouter>,
    );

    // Defaults to THIS_STUDENT
    const thisStudentRadio = await screen.findByRole("radio", {
      name: /This student — Morgan Striving \(Default\)/i,
    });
    expect(thisStudentRadio.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Assigned to: 1 student (Morgan Striving in Grade 9 - Newton)")).toBeDefined();

    // Open nested Create Reading modal and verify full intervention context is passed
    fireEvent.click(screen.getByRole("button", { name: "Add Additional Resources" }));
    const contextProbe = await screen.findByTestId("nested-intervention-context");
    expect(JSON.parse(contextProbe.textContent || "{}")).toEqual({
      interventionId: 7,
      studentId: "student-1",
      classId: 1,
      subjectId: 1,
      academicPeriodId: 1,
    });
    expect(screen.getByTestId("nested-initial-lesson").textContent).toBe(
      "unset",
    );
    fireEvent.click(screen.getByRole("button", { name: "Finish creating reading" }));

    // Select existing reading and explicitly switch scope to Entire Class
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Factoring Cheat Sheet" }));
    fireEvent.click(screen.getByRole("radio", { name: /Entire class — Grade 9 - Newton/i }));
    expect(screen.getByText("Assigned to: 17 students in Grade 9 - Newton")).toBeDefined();

    await expect(ref.current?.saveAdjustments({ readingsOnly: true })).resolves.toBe(true);
    expect(apiMocks.saveRemediationPlan).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({
        selected_resources: [{ kind: "CLASSWORK", id: 305 }],
        resource_recipient_scope: "ENTIRE_CLASS",
      }),
    );
  });

  it("shows recommended badges unselected and expands Browse Other Resources by default on open", async () => {
    const baseWorkspace = makeWorkspace([]);
    apiMocks.getRemediationWorkspace.mockResolvedValue({
      ...baseWorkspace,
      resources: [recommendedReading, otherReading],
      plan: {
        ...baseWorkspace.plan,
        teacher_choice: null,
        grade_treatment: null,
        target_assignment_ids: [],
        selected_resources: [],
      },
      progress: {
        ...baseWorkspace.progress,
        assigned_remediation: [],
        completed_remediation: [],
      },
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials
          detail={baseDetail}
          page="plan"
          wizardStep={1}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Recommended Materials")).toBeDefined();
    const recRow = screen.getByRole("button", { name: "Open classwork: Linear Equations Review" });
    expect(within(recRow).getByText("Recommended")).toBeDefined();
    expect(
      within(recRow)
        .getByRole("checkbox", { name: "Select Linear Equations Review" })
        .getAttribute("aria-checked"),
    ).toBe("false");

    const browseTrigger = screen.getByRole("button", { name: "Browse Other Resources" });
    expect(browseTrigger.getAttribute("aria-expanded")).toBe("true");

    const otherRow = screen.getByRole("button", { name: "Open classwork: Number Sense Review" });
    expect(within(otherRow).queryByText("Recommended")).toBeNull();
    expect(
      within(otherRow)
        .getByRole("checkbox", { name: "Select Number Sense Review" })
        .getAttribute("aria-checked"),
    ).toBe("false");

    const searchInput = screen.getByLabelText("Search other resources");
    fireEvent.change(searchInput, { target: { value: "Nonexistent" } });
    expect(screen.queryByRole("button", { name: "Open classwork: Number Sense Review" })).toBeNull();
    expect(screen.getByText("No matching readings")).toBeDefined();

    fireEvent.change(searchInput, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Open classwork: Number Sense Review" })).toBeDefined();
  });

  it("labels an intervention-created diagnostic match as teacher-added without losing recommendation metadata", async () => {
    const baseWorkspace = makeWorkspace([]);
    apiMocks.getRemediationWorkspace.mockResolvedValue({
      ...baseWorkspace,
      resources: [
        {
          ...recommendedReading,
          id: 333,
          title: "Teacher-created Algebra Guide",
          added_by_teacher: true,
          recommended: true,
          match_reason: "Matched lesson: Linear Equations",
          match_level: "LESSON",
          match_rank: 80,
        },
      ],
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials
          detail={baseDetail}
          page="plan"
          wizardStep={1}
        />
      </MemoryRouter>,
    );

    const row = await screen.findByRole("button", {
      name: "Open classwork: Teacher-created Algebra Guide",
    });
    expect(within(row).getByText("Added by teacher")).toBeDefined();
    expect(within(row).queryByText("Recommended")).toBeNull();
  });

  it("keeps Browse Other Resources expanded without fabricating Recommended badges when backend returns no recommended matches", async () => {
    const baseWorkspace = makeWorkspace([]);
    const nonRecommendedA = {
      ...otherReading,
      id: 311,
      title: "Points and Lines Reading",
    };
    const nonRecommendedB = {
      ...otherReading,
      id: 312,
      title: "Parallel Lines Reading",
    };
    apiMocks.getRemediationWorkspace.mockResolvedValue({
      ...baseWorkspace,
      focus: {
        ...baseWorkspace.focus,
        evidence_level: "COMPONENT_ONLY",
        lesson_ids: [],
        lessons: [],
        competency_ids: [],
        competencies: [],
      },
      resources: [nonRecommendedA, nonRecommendedB],
      plan: {
        ...baseWorkspace.plan,
        teacher_choice: null,
        grade_treatment: null,
        target_assignment_ids: [],
        selected_resources: [],
      },
      progress: {
        ...baseWorkspace.progress,
        assigned_remediation: [],
        completed_remediation: [],
      },
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials
          detail={baseDetail}
          page="plan"
          wizardStep={1}
        />
      </MemoryRouter>,
    );

    const browseTrigger = await screen.findByRole("button", { name: "Browse Other Resources" });
    expect(browseTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByText("Recommended Materials")).toBeNull();
    expect(screen.queryByText("Recommended")).toBeNull();
    expect(screen.getByRole("button", { name: "Open classwork: Points and Lines Reading" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Open classwork: Parallel Lines Reading" })).toBeDefined();
    expect(
      screen.getByRole("checkbox", { name: "Select Points and Lines Reading" }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("shows the empty supporting readings state when no readings exist", async () => {
    const baseWorkspace = makeWorkspace([]);
    apiMocks.getRemediationWorkspace.mockResolvedValue({
      ...baseWorkspace,
      resources: [],
      plan: {
        ...baseWorkspace.plan,
        teacher_choice: null,
        grade_treatment: null,
        target_assignment_ids: [],
        selected_resources: [],
      },
      progress: {
        ...baseWorkspace.progress,
        assigned_remediation: [],
        completed_remediation: [],
      },
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials
          detail={baseDetail}
          page="plan"
          wizardStep={1}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText("No supporting readings available")).toBeDefined();
    expect(screen.queryByText("Recommended Materials")).toBeNull();
    expect(screen.queryByText("Recommended")).toBeNull();
  });

  it("displays scored competency diagnosis when available and insufficient-evidence copy only for COMPONENT_ONLY", async () => {
    const scoredWorkspace: RemediationWorkspace = {
      ...makeWorkspace([]),
      focus: {
        ...makeWorkspace([]).focus,
        evidence_level: "SCORED_COMPETENCY",
        competency_ids: [7],
        competencies: [{ id: 7, label: "Measurement and Geometry" }],
      },
      progress: {
        ...makeWorkspace([]).progress,
        assigned_remediation: [],
        completed_remediation: [],
      },
    };
    apiMocks.getRemediationWorkspace.mockResolvedValueOnce(scoredWorkspace);

    const first = render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={baseDetail} page="overview" />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Scored whole-activity competency evidence")).toBeDefined();
    expect(screen.getByText(/Measurement and Geometry/)).toBeDefined();
    expect(screen.queryByText(/No specific lesson or competency weakness can be identified/i)).toBeNull();
    first.unmount();

    apiMocks.getRemediationWorkspace.mockResolvedValueOnce({
      ...scoredWorkspace,
      focus: {
        ...scoredWorkspace.focus,
        evidence_level: "COMPONENT_ONLY",
        lesson_ids: [],
        lessons: [],
        competency_ids: [],
        competencies: [],
      },
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={baseDetail} page="overview" />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Component-level evidence only")).toBeDefined();
    expect(
      screen.getByText(/No specific lesson or competency weakness can be identified from the available scored evidence\./i),
    ).toBeDefined();
  });

  it("omits individual question ID/score entries under Academic Diagnosis while preserving summary focus for QUESTION_SCORE evidence", async () => {
    const questionEvidenceWorkspace: RemediationWorkspace = {
      ...makeWorkspace([]),
      focus: {
        ...makeWorkspace([]).focus,
        evidence_level: "QUESTION_SCORE",
        component: "EXAMINATION",
        exam_subtype: "TERM_EXAM",
        competency_ids: [11, 12],
        competencies: [
          { id: 11, label: "Illustrate quadratic equations" },
          { id: 12, label: "Solve quadratic equations by factoring" },
        ],
        question_evidence: [
          { quiz_question_id: 21, score: 0, possible_score: 1 },
          { quiz_question_id: 23, score: 0, possible_score: 1 },
          { quiz_question_id: 24, score: 0, possible_score: 1 },
        ],
      },
      progress: {
        ...makeWorkspace([]).progress,
        assigned_remediation: [],
        completed_remediation: [],
      },
    };
    apiMocks.getRemediationWorkspace.mockResolvedValueOnce(questionEvidenceWorkspace);

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={baseDetail} page="overview" />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Academic Diagnosis")).toBeDefined();
    expect(screen.getByText("Scored question-level competency evidence")).toBeDefined();
    expect(screen.getByText(/Support focus:/)).toBeDefined();
    expect(screen.getByText("Examination")).toBeDefined();
    expect(screen.getByText("(Quarterly examination)")).toBeDefined();
    expect(
      screen.getByText(
        "Scored competency focus: Illustrate quadratic equations; Solve quadratic equations by factoring",
      ),
    ).toBeDefined();
    expect(screen.queryByText(/Question #21/i)).toBeNull();
    expect(screen.queryByText(/Question #23/i)).toBeNull();
    expect(screen.queryByText(/Question #24/i)).toBeNull();
    expect(screen.queryByText(/Question #/i)).toBeNull();
  });
});

describe("InterventionSupportMaterials Practice Assessment loading", () => {
  const savedPracticeAssessment: PracticeAssessmentDetail = {
    practice_assessment_id: 21,
    intervention_id: 7,
    title: "Saved Practice Check",
    status: "DRAFT",
    gatekeeper_policy: "REQUIRE_PASS",
    passing_percentage: 75,
    version: 1,
    questions: [],
  };

  const renderPracticeStep = () => render(
    <MemoryRouter>
      <InterventionSupportMaterials
        detail={baseDetail}
        page="plan"
        wizardStep={2}
      />
    </MemoryRouter>,
  );

  it("displays a successfully loaded assessment", async () => {
    apiMocks.getTeacherPracticeAssessment.mockResolvedValue(savedPracticeAssessment);

    renderPracticeStep();

    expect(await screen.findByText("Saved Practice Check")).toBeDefined();
    expect(screen.getByRole("button", { name: "Edit Practice Assessment" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Add Practice Assessment" })).toBeNull();
  });

  it("shows the empty creation state only for a genuine missing assessment", async () => {
    apiMocks.getTeacherPracticeAssessment.mockResolvedValue(null);

    renderPracticeStep();

    expect(await screen.findByRole("button", { name: "Add Practice Assessment" })).toBeDefined();
    expect(screen.queryByText("Unable to load Practice Assessment")).toBeNull();
  });

  it.each([
    [new PracticeAssessmentApiError(500, "Database unavailable"), "service is unavailable"],
    [new TypeError("Failed to fetch"), "Check your connection"],
  ])("blocks assessment actions for a load failure", async (failure, expectedMessage) => {
    apiMocks.getTeacherPracticeAssessment.mockRejectedValue(failure);

    renderPracticeStep();

    expect(await screen.findByText("Unable to load Practice Assessment")).toBeDefined();
    expect(screen.getByText(new RegExp(expectedMessage, "i"))).toBeDefined();
    expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Add Practice Assessment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit Practice Assessment" })).toBeNull();
  });

  it("recovers after retrying a failed load", async () => {
    apiMocks.getTeacherPracticeAssessment
      .mockRejectedValueOnce(new PracticeAssessmentApiError(500, "Database unavailable"))
      .mockResolvedValueOnce(savedPracticeAssessment);

    renderPracticeStep();

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Saved Practice Check")).toBeDefined();
    expect(apiMocks.getTeacherPracticeAssessment).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Unable to load Practice Assessment")).toBeNull();
  });
});

describe("InterventionSupportMaterials remediation activity integration regressions", () => {
  const readingItem = {
    kind: "CLASSWORK" as const,
    id: 301,
    title: "Linear Equations Review",
    description: "Review reading",
    lesson: "Linear Equations",
    topic: "Linear Equations",
    attachments: [],
    classwork_type: "READING",
    access: "ALREADY_ACCESSIBLE" as const,
    ai_read: "METADATA_ONLY" as const,
    recommended: true,
    match_reason: "Matched competency metadata",
    match_level: "COMPETENCY" as const,
    match_rank: 100,
    is_graded: false,
  };

  it("shows an inline error with Retry on workspace load failure instead of empty state and recovers on retry", async () => {
    apiMocks.getRemediationWorkspace
      .mockRejectedValueOnce(new Error("Workspace service unavailable"))
      .mockResolvedValueOnce(makeWorkspace([101]));

    render(
      <MemoryRouter>
        <InterventionSupportMaterials
          detail={baseDetail}
          page="plan"
          wizardStep={3}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText("Unable to load support workspace")).toBeDefined();
    expect(screen.getByText("Workspace service unavailable")).toBeDefined();
    expect(screen.queryByText("No activity created yet")).toBeNull();
    expect(apiMocks.generateRemediationAdvisory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Remedial Quiz 1")).toBeDefined();
    expect(screen.queryByText("Unable to load support workspace")).toBeNull();
  });

  it("triggers AI recommendation on Step 3 only without overwriting teacher choice or generating activities, and accepts EXISTING_MATERIAL_ONLY", async () => {
    const emptyPlanWorkspace: RemediationWorkspace = {
      ...makeWorkspace([]),
      resources: [readingItem],
      plan: {
        teacher_choice: null,
        grade_treatment: null,
        target_assignment_ids: [],
        score_adjustment_cap: 75,
        selected_resources: [],
        ai_suggestion: null,
      },
      progress: {
        ...makeWorkspace([]).progress,
        assigned_remediation: [],
        completed_remediation: [],
      },
    };
    apiMocks.getRemediationWorkspace.mockResolvedValue(emptyPlanWorkspace);
    apiMocks.generateRemediationAdvisory.mockResolvedValue({
      ...emptyPlanWorkspace,
      plan: {
        ...emptyPlanWorkspace.plan,
        ai_suggestion: {
          recommended_format: "QUIZ",
          recommended_grade_treatment: "WRITTEN_WORK",
          reason: "A short quiz supports the verified Written Work focus.",
          focus: [],
          evidence_used: {},
        },
      },
    });

    const { rerender } = render(
      <MemoryRouter>
        <InterventionSupportMaterials
          detail={baseDetail}
          page="plan"
          wizardStep={1}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText("Recommended Materials")).toBeDefined();
    expect(apiMocks.generateRemediationAdvisory).not.toHaveBeenCalled();

    rerender(
      <MemoryRouter>
        <InterventionSupportMaterials
          detail={baseDetail}
          page="plan"
          wizardStep={3}
        />
      </MemoryRouter>
    );

    expect(
      await screen.findByText("A short quiz supports the verified Written Work focus.")
    ).toBeDefined();
    expect(apiMocks.generateRemediationAdvisory).toHaveBeenCalledTimes(1);
    expect(apiMocks.generateRemediationDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: /Quiz/i }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("radio", { name: /Classwork/i }).getAttribute("aria-checked")).toBe("false");

    cleanup();
    vi.clearAllMocks();
    apiMocks.listSupportMaterials.mockResolvedValue({ items: [], total: 0 });
    apiMocks.getTeacherPracticeAssessment.mockResolvedValue(null);
    apiMocks.listTeacherPracticeAttempts.mockResolvedValue([]);
    apiMocks.getTeacherClasses.mockResolvedValue([]);
    apiMocks.getRemediationWorkspace.mockResolvedValue({
      ...emptyPlanWorkspace,
      plan: {
        ...emptyPlanWorkspace.plan,
        ai_suggestion: {
          recommended_format: "EXISTING_MATERIAL_ONLY",
          recommended_grade_treatment: null,
          reason: "Existing reading materials support the verified Written Work focus.",
          focus: [],
          evidence_used: {},
        },
      },
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials
          detail={baseDetail}
          page="plan"
          wizardStep={3}
        />
      </MemoryRouter>
    );

    expect(
      await screen.findByText("Existing reading materials support the verified Written Work focus.")
    ).toBeDefined();
    expect(screen.queryByText(/No supported remediation recommendation/i)).toBeNull();
    expect(apiMocks.generateRemediationAdvisory).not.toHaveBeenCalled();
  });

  it("saves Step 1 reading selections via readingsOnly even when Activity 1 is graded and canAddAnother is true", async () => {
    const workspaceWithReading: RemediationWorkspace = {
      ...makeWorkspace([101]),
      resources: [readingItem],
    };
    apiMocks.getRemediationWorkspace.mockResolvedValue(workspaceWithReading);
    apiMocks.saveRemediationPlan.mockImplementation(async (_id, payload) => ({
      ...workspaceWithReading,
      plan: {
        ...workspaceWithReading.plan,
        ...payload,
      },
    }));

    const ref = createRef<InterventionSupportMaterialsHandle>();
    render(
      <MemoryRouter>
        <InterventionSupportMaterials
          ref={ref}
          detail={baseDetail}
          page="plan"
          wizardStep={1}
        />
      </MemoryRouter>
    );

    const checkbox = await screen.findByRole("checkbox", {
      name: "Select Linear Equations Review",
    });
    fireEvent.click(checkbox);

    const saved = await ref.current?.saveAdjustments({ readingsOnly: true });
    expect(saved).toBe(true);
    expect(toastMocks.error).not.toHaveBeenCalled();
    expect(apiMocks.saveRemediationPlan).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        teacher_choice: "QUIZ",
        grade_treatment: "WRITTEN_WORK",
        target_assignment_ids: [101],
        selected_resources: [{ kind: "CLASSWORK", id: 301 }],
      }),
    );
  });

  it("preserves saved PRACTICE_ONLY grade treatment on reopen without marking changes dirty", async () => {
    const practiceWorkspace: RemediationWorkspace = {
      ...makeWorkspace([]),
      plan: {
        teacher_choice: "QUIZ",
        grade_treatment: "PRACTICE_ONLY",
        target_assignment_ids: [],
        score_adjustment_cap: 75,
        selected_resources: [],
        ai_suggestion: null,
      },
      progress: {
        ...makeWorkspace([]).progress,
        assigned_remediation: [],
        completed_remediation: [],
      },
    };
    apiMocks.getRemediationWorkspace.mockResolvedValue(practiceWorkspace);
    const onChangesChange = vi.fn();

    render(
      <MemoryRouter>
        <InterventionSupportMaterials
          detail={baseDetail}
          page="plan"
          wizardStep={3}
          onChangesChange={onChangesChange}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText("Ungraded Activity")).toBeDefined();
    expect(onChangesChange).toHaveBeenLastCalledWith(false);
  });

  it("uses the selected original exam subtype, omits unfiltered focus competency/question IDs, clears stale draft on failure, and retries save with the same request ID", async () => {
    const examDetail: TeacherInterventionDetail = {
      ...baseDetail,
      diagnosis_summary: { weakest_supported_components: ["EXAMINATION"] },
      diagnosis_snapshot: {
        weakest_supported_components: ["EXAMINATION"],
        supporting_activities: [
          {
            classwork_id: 50,
            classwork_assignment_id: 201,
            title: "Summative 1",
            component: "EXAMINATION",
            score: 20,
            possible_score: 50,
            percent: 40,
          },
          {
            classwork_id: 51,
            classwork_assignment_id: 202,
            title: "Summative 2",
            component: "EXAMINATION",
            score: 20,
            possible_score: 50,
            percent: 40,
          },
        ],
      },
    };
    const examWorkspace: RemediationWorkspace = {
      ...makeWorkspace([202]),
      plan: {
        teacher_choice: "QUIZ",
        grade_treatment: "EXAMINATION",
        original_exam_assignment_id: 202,
        target_assignment_ids: [202],
        score_adjustment_cap: 75,
        selected_resources: [],
        ai_suggestion: null,
      },
      focus: {
        ...makeWorkspace().focus,
        component: "EXAMINATION",
        exam_subtype: null,
        exam_subtype_requires_confirmation: true,
        competency_ids: [999],
        question_evidence: [{ quiz_question_id: 888, score: 0, possible_score: 5 }],
      },
      original_exams: [
        { assignment_id: 201, title: "Summative 1", subtype: "SUMMATIVE_1", score: 20, total_points: 50 },
        { assignment_id: 202, title: "Summative 2", subtype: "SUMMATIVE_2", score: 20, total_points: 50 },
      ],
      progress: {
        ...makeWorkspace().progress,
        assigned_remediation: [],
        completed_remediation: [],
      },
      score_previews: [],
    };
    const examDraft: RemediationQuizDraft = {
      ...mockDraft,
      target_component: "EXAMINATION",
      grade_treatment: "EXAMINATION",
      exam_subtype: "SUMMATIVE_2",
      total_points: 50,
      questions: [{ ...mockDraft.questions[0], points: 50 }],
    };

    apiMocks.getRemediationWorkspace.mockResolvedValue(examWorkspace);
    apiMocks.generateRemediationDraft
      .mockResolvedValueOnce(examDraft)
      .mockRejectedValueOnce(new Error("Temporary AI error"))
      .mockResolvedValueOnce(examDraft);
    apiMocks.createRemediationAssessment
      .mockRejectedValueOnce(new Error("Network timeout"))
      .mockResolvedValueOnce({
        remediation_request_id: "req-exam",
        intervention_id: 7,
        classwork_id: 701,
        classwork_assignment_id: 801,
        quiz_id: 901,
        draft_format: "QUIZ",
        grade_treatment: "EXAMINATION",
        is_published: false,
      });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials
          detail={examDetail}
          page="plan"
          wizardStep={3}
        />
      </MemoryRouter>
    );

    const generateBtn = await screen.findByRole("button", { name: /Generate with AI/i });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(apiMocks.generateRemediationDraft).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          draft_format: "QUIZ",
          target_component: "EXAMINATION",
          grade_treatment: "EXAMINATION",
          exam_subtype: "SUMMATIVE_2",
          target_assignment_id: 202,
          total_points: 50,
        }),
      );
    });
    const genPayload = apiMocks.generateRemediationDraft.mock.calls[0][1];
    expect(genPayload.selected_competency_ids).toBeUndefined();
    expect(genPayload.selected_quiz_question_ids).toBeUndefined();

    // Closing preview before saving and failing a regeneration clears the stale draft
    await screen.findByRole("button", { name: /Save Assessment Draft/i });
    fireEvent.click(screen.getByRole("button", { name: /Close Preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /Generate with AI/i }));
    expect(await screen.findByText("Temporary AI error")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Edit Draft/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Save Assessment Draft/i }).hasAttribute("disabled")).toBe(true);

    // Retry generation succeeds; then first save fails transiently and retry reuses same remediation_request_id
    fireEvent.click(screen.getByRole("button", { name: /Retry Generation/i }));
    const saveDraftBtn = await screen.findByRole("button", { name: /Save Assessment Draft/i });
    await waitFor(() => expect(saveDraftBtn.hasAttribute("disabled")).toBe(false));
    fireEvent.click(saveDraftBtn);
    expect(await screen.findByText("Network timeout")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Save Assessment Draft/i }));
    await waitFor(() => expect(apiMocks.createRemediationAssessment).toHaveBeenCalledTimes(2));
    expect(apiMocks.createRemediationAssessment.mock.calls[0][1]).toBe(
      apiMocks.createRemediationAssessment.mock.calls[1][1]
    );
    expect(await screen.findByText("Assessment draft saved")).toBeDefined();
  });

  it("shows accurate awaiting-submission status and real AI prediction impact in Active Summary and locked Step 3, and refreshes on grade updates", async () => {
    const publishedUnsubmittedWorkspace: RemediationWorkspace = {
      ...makeWorkspace([101]),
      plan: {
        teacher_choice: "QUIZ",
        grade_treatment: "WRITTEN_WORK",
        target_assignment_ids: [101],
        score_adjustment_cap: 85,
        selected_resources: [],
        ai_suggestion: null,
      },
      progress: {
        triggering_projection: 81.2,
        latest_projection: 81.2,
        latest_revision: 1,
        passing_threshold: 85,
        remediation_status: "ASSIGNED",
        completed_remediation: [],
        assigned_remediation: [
          {
            title: "Remedial Quiz 1",
            assignment_id: 501,
            classwork_id: 401,
            classwork_type: "QUIZ",
            is_published: true,
            component: "WRITTEN_WORK",
            is_graded: true,
            submission_status: null,
            grade: null,
            total_points: 20,
            original_assignment_id: 101,
            original_title: "WW 1 - Number Sense",
            original_grade: 8,
            effective_grade: 8,
          },
        ],
        status: "ACTIVE",
        status_reason:
          "Remediation activity is published and awaiting student submission. The AI prediction will update after grading.",
      },
      prediction_impact: {
        status: "AVAILABLE",
        is_official_grade: false,
        is_guaranteed: false,
        is_practice_only: false,
        current_predicted_grade: 81.2,
        max_remediation_predicted_grade: 84.65,
        predicted_gain: 3.45,
        passing_threshold: 85,
        score_adjustment_cap: 85,
        targets: [
          {
            assignment_id: 101,
            title: "WW 1 - Number Sense",
            component: "WRITTEN_WORK",
            original_score: 8,
            current_effective_score: 8,
            max_points: 20,
            cap_percentage: 85,
            effective_max_score: 17,
            possible_score_gain: 9,
            hypothetical_predicted_grade: 84.65,
            predicted_gain: 3.45,
          },
        ],
        unavailable_reasons: [],
      },
    };

    const refreshedAfterGradeWorkspace: RemediationWorkspace = {
      ...publishedUnsubmittedWorkspace,
      progress: {
        ...publishedUnsubmittedWorkspace.progress,
        latest_projection: 83.1,
        latest_revision: 2,
        remediation_status: "GRADED",
        completed_remediation: [
          { title: "Remedial Quiz 1", assignment_id: 501, grade: 14, total_points: 20 },
        ],
        assigned_remediation: [
          {
            ...publishedUnsubmittedWorkspace.progress.assigned_remediation![0],
            submission_status: "graded",
            grade: 14,
            effective_grade: 14,
          },
        ],
        status_reason:
          "Graded remediation has been applied, and the latest AI-predicted grade remains below 85.",
      },
      prediction_impact: {
        ...publishedUnsubmittedWorkspace.prediction_impact!,
        current_predicted_grade: 83.1,
        max_remediation_predicted_grade: 84.65,
        predicted_gain: 1.55,
      },
    };

    apiMocks.getRemediationWorkspace
      .mockResolvedValueOnce(publishedUnsubmittedWorkspace)
      .mockResolvedValueOnce(publishedUnsubmittedWorkspace)
      .mockResolvedValueOnce(refreshedAfterGradeWorkspace);

    // 1. Active Intervention Summary (overview mode)
    const { rerender } = render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={baseDetail} />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Awaiting submission/i)).toBeTruthy();
    expect(screen.queryByText(/Pending \/ 20/i)).toBeNull();
    expect(screen.queryByText(/remains below 85/i)).toBeNull();
    expect(
      screen.getByText(/Remediation activity is published and awaiting student submission/i)
    ).toBeTruthy();
    expect(screen.getByText("81.20")).toBeTruthy();
    expect(screen.getByText(/84\.65/)).toBeTruthy();
    expect(screen.getByText(/\+3\.45/)).toBeTruthy();
    expect(screen.getByText(/85% \(17\/20 max\)/)).toBeTruthy();

    // 2. Reopened locked Step 3 Saved Grade Treatment
    cleanup();
    const step3Render = render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={baseDetail} wizardStep={3} />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Saved Grade Treatment")).toBeTruthy();
    expect(screen.getByText("85%")).toBeTruthy();
    expect(screen.getByText("17/20")).toBeTruthy();
    expect(screen.getByText("81.20")).toBeTruthy();
    expect(screen.getByText(/84\.65/)).toBeTruthy();

    // 3. Updating detail revision triggers workspace refresh & updated AI prediction
    step3Render.rerender(
      <MemoryRouter>
        <InterventionSupportMaterials
          detail={{
            ...baseDetail,
            current_prediction_revision: 3,
            current_predicted_grade: 83.1,
          }}
          wizardStep={3}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("83.10").length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText(/\+1\.55/)).toBeTruthy();
    });
    expect(rerender).toBeDefined();
  });

  it("keeps Target-Score Ceiling adjustable (presets and custom), recalculates backend AI projection live with separate 85 predicted-grade ceiling, and shows passing status even when below passing", async () => {
    const newPlanWorkspace: RemediationWorkspace = {
      ...makeWorkspace([]),
      plan: {
        teacher_choice: null,
        grade_treatment: null,
        target_assignment_ids: [],
        score_adjustment_cap: 75,
        predicted_grade_ceiling: null,
        selected_resources: [],
        ai_suggestion: null,
      },
      progress: {
        ...makeWorkspace([]).progress,
        triggering_projection: 83.0,
        latest_projection: 83.0,
        passing_threshold: 85,
        assigned_remediation: [],
        completed_remediation: [],
      },
    };
    apiMocks.getRemediationWorkspace.mockResolvedValue(newPlanWorkspace);
    apiMocks.projectSubjectGrade.mockImplementation(async (_id, payload) => {
      const cap = payload.score_adjustment_cap ?? 75;
      const isCappedAt85 = cap >= 85;
      const rawAfter = cap === 75 ? 84.2 : cap === 85 ? 86.7 : 88.9;
      const adjustedAfter = isCappedAt85 ? 85.0 : rawAfter;
      return makeProjection({
        passing_threshold: 85,
        target_projections: payload.target_assignment_ids.map((assignmentId: number) => ({
          assignment_id: assignmentId,
          title: "WW 1 - Number Sense",
          component: "WRITTEN_WORK" as const,
          original_score: 8,
          current_effective_score: 8,
          max_points: 20,
          cap_percentage: cap,
          maximum_hypothetical_effective_score: (20 * cap) / 100,
          possible_score_gain: (20 * cap) / 100 - 8,
          applied: true,
          projected_initial_grade: null,
          projected_subject_grade: null,
          step_subject_grade_improvement: null,
          possible_grade_improvement: null,
          reaches_passing_threshold: null,
          unavailable_reasons: [],
        })),
        ai_midterm_what_if: {
          status: "AVAILABLE" as const,
          estimate_kind: "AI_MIDTERM_WHAT_IF_ESTIMATE" as const,
          is_official_grade: false as const,
          is_guaranteed: false as const,
          prediction_purpose: "CURRENT_TERM_FINAL_GRADE_PROJECTION" as const,
          evidence_basis: "LIVE_ACTUAL_EVIDENCE_WITH_EPHEMERAL_CAPPED_WW_PT_OVERRIDES" as const,
          baseline_predicted_term_grade: 83.0,
          unremediated_baseline_predicted_term_grade: 83.0,
          selected_grade_ceiling: 85,
          effective_grade_ceiling: 85,
          baseline_remediation_adjusted_predicted_term_grade: 83.0,
          baseline_was_ceiling_applied: false,
          readiness: {},
          target_estimates: payload.target_assignment_ids.map((assignmentId: number) => ({
            assignment_id: assignmentId,
            maximum_hypothetical_effective_score: (20 * cap) / 100,
            hypothetical_predicted_term_grade: rawAfter,
            raw_hypothetical_predicted_term_grade: rawAfter,
            remediation_adjusted_predicted_term_grade: adjustedAfter,
            applied_grade_ceiling: 85,
            was_ceiling_applied: isCappedAt85,
            step_estimated_difference: rawAfter - 83.0,
            estimated_difference_from_baseline: rawAfter - 83.0,
            capped_step_estimated_difference: adjustedAfter - 83.0,
            capped_estimated_difference_from_baseline: adjustedAfter - 83.0,
          })),
          unavailable_reasons: [],
          limitations: [],
        },
      });
    });

    render(
      <MemoryRouter>
        <InterventionSupportMaterials
          detail={{ ...baseDetail, passing_threshold: 85, current_predicted_grade: 83.0 }}
          page="plan"
          wizardStep={3}
        />
      </MemoryRouter>,
    );

    // Choose Quiz, then open Target Selection modal
    fireEvent.click(await screen.findByRole("radio", { name: /Quiz/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Select Classwork/i }));

    // Select WW 1 - Number Sense (id 101)
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: "Select WW 1 - Number Sense as the remediation target",
      }),
    );

    // At 75% classwork cap: backend returns 83.0 -> 84.2, still below passing (85)
    await waitFor(() => {
      expect(apiMocks.projectSubjectGrade).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          target_assignment_ids: [101],
          score_adjustment_cap: 75,
          predicted_grade_ceiling: 85,
        }),
      );
    });
    expect(await screen.findByText("84.2")).toBeTruthy();
    expect(screen.getAllByText("Still below passing (85)").length).toBeGreaterThanOrEqual(1);

    // Switch to 85% preset -> recalculates with score_adjustment_cap=85 and predicted_grade_ceiling=85
    fireEvent.click(screen.getByRole("button", { name: "85%" }));
    await waitFor(() => {
      expect(apiMocks.projectSubjectGrade).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          target_assignment_ids: [101],
          score_adjustment_cap: 85,
          predicted_grade_ceiling: 85,
        }),
      );
    });
    expect(await screen.findByText("85.0")).toBeTruthy();
    expect(screen.getAllByText("Reaches passing (85)").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/86\.7/)).toBeNull();

    // Custom valid cap (90%) remains adjustable and keeps predicted grade capped at 85.0
    const capInput = screen.getByLabelText("Target-Score Ceiling") as HTMLInputElement;
    fireEvent.change(capInput, { target: { value: "90" } });
    await waitFor(() => {
      expect(apiMocks.projectSubjectGrade).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          target_assignment_ids: [101],
          score_adjustment_cap: 90,
          predicted_grade_ceiling: 85,
        }),
      );
    });
    expect(screen.queryByText(/88\.9/)).toBeNull();
    expect(screen.getByText("85.0")).toBeTruthy();
  });

  it("preserves legacy saved plans without predicted_grade_ceiling when projecting or saving", async () => {
    const legacyWorkspace: RemediationWorkspace = {
      ...makeWorkspace([101]),
      plan: {
        teacher_choice: "QUIZ",
        grade_treatment: "WRITTEN_WORK",
        target_assignment_ids: [101],
        score_adjustment_cap: 80,
        selected_resources: [],
        ai_suggestion: null,
      },
      progress: {
        ...makeWorkspace([101]).progress,
        assigned_remediation: [],
        completed_remediation: [],
      },
    };
    apiMocks.getRemediationWorkspace.mockResolvedValue(legacyWorkspace);
    apiMocks.projectSubjectGrade.mockResolvedValue(makeProjection());

    render(
      <MemoryRouter>
        <InterventionSupportMaterials detail={baseDetail} page="plan" wizardStep={3} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(apiMocks.projectSubjectGrade).toHaveBeenCalled();
    });
    const lastPayload = apiMocks.projectSubjectGrade.mock.calls.at(-1)?.[1];
    expect(lastPayload?.score_adjustment_cap).toBe(80);
    expect(lastPayload?.predicted_grade_ceiling).toBeUndefined();
  });
});
