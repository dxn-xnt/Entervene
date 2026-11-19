// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RubricsScoreBoard from "@/components/rubrics-score-board";
import AiRemediationDraftModal from "./ai-remediation-draft-modal";
import CreateClassworkModal from "./create-classwork";
import type {
  RemediationClassworkDraft,
  RemediationClassworkTarget,
  TeacherInterventionDetail,
} from "@/lib/teacher-interventions-api";
import type { ActivityRubricLevel } from "@/types/classwork";

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  apiFetch: apiFetchMock,
}));

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/components/retroui/Dialog", () => {
  const Root = ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open === false ? null : <div>{children}</div>;
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Object.assign(Root, {
      Content: Passthrough,
      Header: Passthrough,
      Footer: Passthrough,
      Title: Passthrough,
      Description: Passthrough,
    }),
  };
});

vi.mock("@/components/retroui/Select", async () => {
  const React = await import("react");

  const collectOptions = (node: ReactNode): Array<{ value: string; label: string }> => {
    const items: Array<{ value: string; label: string }> = [];
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as { value?: string; children?: ReactNode };
      if ((child.type as { displayName?: string })?.displayName === "MockSelectItem" && props.value != null) {
        items.push({
          value: String(props.value),
          label: typeof props.children === "string" ? props.children : String(props.children ?? ""),
        });
      } else if (props.children) {
        items.push(...collectOptions(props.children));
      }
    });
    return items;
  };

  function MockSelect({
    value,
    onValueChange,
    children,
    disabled,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children?: ReactNode;
    disabled?: boolean;
  }) {
    const options = collectOptions(children);
    return (
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onValueChange?.(event.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  function MockSelectItem({ children }: { value: string; children?: ReactNode }) {
    return <>{children}</>;
  }
  MockSelectItem.displayName = "MockSelectItem";

  const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Select: Object.assign(MockSelect, {
      Trigger: Passthrough,
      Value: () => null,
      Content: Passthrough,
      Group: Passthrough,
      Item: MockSelectItem,
    }),
  };
});

const rubricA: ActivityRubricLevel[] = [
  {
    level_name: "Mastery",
    description: "Complete geometric proof with zero errors",
    points: 50,
    display_order: 0,
  },
  {
    level_name: "Proficient",
    description: "Clear reasoning with minor slips",
    points: 38,
    display_order: 1,
  },
  {
    level_name: "Developing",
    description: "Partial theorem application",
    points: 25,
    display_order: 2,
  },
];

const rubricB: ActivityRubricLevel[] = [
  {
    level_name: "Outstanding",
    description: "Models ratios accurately with labeled diagrams",
    points: 30,
    display_order: 0,
  },
  {
    level_name: "Satisfactory",
    description: "Correct model with minor omissions",
    points: 20,
    display_order: 1,
  },
  {
    level_name: "Needs Support",
    description: "Incomplete ratio model",
    points: 10,
    display_order: 2,
  },
];

const targetA: RemediationClassworkTarget = {
  assignment_id: 101,
  classwork_id: 11,
  title: "PT 1 - Geometric Proofs",
  component: "PERFORMANCE_TASK",
  original_score: 20,
  max_points: 50,
  percent: 40,
  rubric_levels: rubricA,
};

const targetB: RemediationClassworkTarget = {
  assignment_id: 102,
  classwork_id: 12,
  title: "PT 2 - Ratio Models",
  component: "PERFORMANCE_TASK",
  original_score: 12,
  max_points: 30,
  percent: 40,
  rubric_levels: rubricB,
};

const interventionDetail = {
  intervention_id: 7,
  student_id: "student-1",
  student_name: "Gabriel Aquino 12",
  student_lrn: "123456789012",
  class_id: 8,
  class_name: "Grade 9 - Einstein",
  subject_id: 7,
  subject_name: "Enhanced Mathematics 9",
  academic_period_id: 1,
  academic_period_name: "Quarter 1",
  status: "ACTIVE",
  source_prediction_id: 1,
  source_prediction_revision: 1,
  triggering_predicted_grade: 82.55,
  triggering_intervention_level: "MODERATE_RISK",
  current_prediction_revision: 8,
  current_predicted_grade: 82.75,
  current_intervention_level: "MODERATE_RISK",
  created_at: "2026-11-19T00:00:00Z",
  activated_at: "2026-11-19T01:00:00Z",
  activated_by_staff_id: "T-001",
  resolved_at: null,
  resolution_reason: null,
  diagnosis_summary: {},
  diagnosis_snapshot: {},
} as TeacherInterventionDetail;

beforeEach(() => {
  apiFetchMock.mockResolvedValue({
    ok: true,
    json: async () => [{ lesson_id: 1, title: "Geometry Basics" }],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Remediation rubric alignment", () => {
  it("inherits the selected original rubric in manual creation, locks template changes, and updates when switching targets", async () => {
    render(
      <MemoryRouter>
        <CreateClassworkModal
          selectedType="ASSIGNMENT"
          subjects={[{ id: 7, name: "Enhanced Mathematics 9" }]}
          loads={[
            {
              subject_load_id: 1,
              subject_id: 7,
              subject_name: "Enhanced Mathematics 9",
              class_id: 8,
              section_name: "Grade 9 - Einstein",
              academic_period_id: 1,
            },
          ]}
          initialSubjectId="7"
          initialClassId={8}
          remediationDraft
          remediationTarget={interventionDetail}
          remediationGradeTreatment="PERFORMANCE_TASK"
          remediationOriginalTargets={[targetA, targetB]}
          initialTargetAssignmentId={101}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          onBack={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Inherited Scoring Rubric")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Choose Template/i })).toBeNull();
    expect(screen.getByText("Mastery")).toBeDefined();
    expect(screen.getByText("50–39 pts")).toBeDefined();
    expect(screen.getByText("Complete geometric proof with zero errors")).toBeDefined();
    expect(screen.queryByText("Outstanding")).toBeNull();

    // Switch target to Target B via the target selector inside RemediationTeacherGuidanceBanner
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    const targetSelect = selects.find((select) =>
      Array.from(select.options).some((opt) => opt.value === "102"),
    );
    expect(targetSelect).toBeDefined();
    fireEvent.change(targetSelect!, { target: { value: "102" } });

    await waitFor(() => expect(screen.getByText("Outstanding")).toBeDefined());
    expect(screen.getByText("30–21 pts")).toBeDefined();
    expect(screen.getByText("Models ratios accurately with labeled diagrams")).toBeDefined();
    expect(screen.queryByText("Mastery")).toBeNull();
    expect(screen.queryByRole("button", { name: /Choose Template/i })).toBeNull();
  });

  it("keeps inherited rubric read-only in AI draft preview while instructions and tasks remain editable", () => {
    const classworkDraft: RemediationClassworkDraft = {
      draft_format: "CLASSWORK",
      target_component: "PERFORMANCE_TASK",
      grade_treatment: "PERFORMANCE_TASK",
      title: "Remediation Proof Practice",
      description: "Focused remediation task",
      student_instructions: "Complete the scaffolded proof steps.",
      total_points: 50,
      activity_mode: "ONLINE",
      tasks: [
        {
          task_number: 1,
          title: "Step 1 Proof",
          instructions: "Identify congruent triangles.",
          targeted_competency_id: 1,
          targeted_lesson_id: 1,
        },
      ],
      deliverables: [
        {
          deliverable_name: "Proof Sheet",
          deliverable_type: "PDF",
          description: "Upload completed proof sheet.",
        },
      ],
      supported_upload_formats: [".pdf"],
      rubric_levels: rubricA,
      teacher_guide: {
        exemplar_or_expected_response: "Complete SAS congruence proof.",
        evaluation_notes: "Apply original scoring rubric.",
        common_misconceptions: ["Skipping angle justification"],
      },
    };

    render(
      <MemoryRouter>
        <AiRemediationDraftModal
          open
          onOpenChange={vi.fn()}
          generatingDraft={false}
          generationError={null}
          generatedDraft={classworkDraft}
          setGeneratedDraft={vi.fn()}
          draftSaveState="idle"
          draftSaveError={null}
          savedAssessment={null}
          isEditingDraft
          setIsEditingDraft={vi.fn()}
          draftValidation={{ isValid: true, issues: [] }}
          capInput="75"
          plan={{
            teacher_choice: "CLASSWORK",
            grade_treatment: "PERFORMANCE_TASK",
            selected_resources: [],
            ai_suggestion: null,
          }}
          targetAssignmentSummary="PT 1 - Geometric Proofs (50 pts)"
          rubricLocked
          onGenerateWithAI={vi.fn()}
          onSaveAssessmentDraft={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Inherited from original classwork")).toBeDefined();
    expect(screen.getByText("Mastery")).toBeDefined();
    expect(screen.getByText("50–39 pts")).toBeDefined();
    // Instructions remain editable while rubric levels have no text/point input fields
    expect(screen.getByDisplayValue("Complete the scaffolded proof steps.")).toBeDefined();
    expect(screen.queryByDisplayValue("Mastery")).toBeNull();
    expect(screen.queryByDisplayValue("Complete geometric proof with zero errors")).toBeNull();
  });

  it("highlights the matching rubric level when teacher awards a score within its range and allows clicking levels", () => {
    const onSelectScore = vi.fn();
    render(
      <RubricsScoreBoard
        title="Scoring Rubric"
        totalPoints={50}
        rubricLevels={rubricA}
        selectedScore={45}
        onSelectScore={onSelectScore}
      />,
    );

    // 45 falls inside Mastery's 50–39 pts range
    const masteryCard = screen.getByText("Mastery").closest("div[title]");
    const proficientCard = screen.getByText("Proficient").closest("div[title]");
    expect(masteryCard?.className).toContain("bg-primary");
    expect(proficientCard?.className).not.toContain("bg-primary");

    fireEvent.click(proficientCard!);
    expect(onSelectScore).toHaveBeenCalledWith(38);
  });
});
