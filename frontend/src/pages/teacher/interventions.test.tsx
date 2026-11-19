// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeacherInterventionSummary } from "@/lib/teacher-interventions-api";
import { describeActivationConflict } from "@/lib/intervention-activation-conflict";
import TeacherInterventions from "./interventions";

const apiMocks = vi.hoisted(() => ({
  listTeacherCandidates: vi.fn(),
  listTeacherActive: vi.fn(),
  listTeacherResolved: vi.fn(),
  getTeacherCandidate: vi.fn(),
  getTeacherActive: vi.fn(),
  getTeacherResolved: vi.fn(),
  activateTeacherCandidate: vi.fn(),
}));

describe("activation conflict messages", () => {
  it("keeps runtime model failures retryable", () => {
    const conflict = describeActivationConflict(
      "The V3 scorer artifact is missing from backend/data/models.",
    );

    expect(conflict.stale).toBe(false);
    expect(conflict.message).toContain("Prediction service unavailable");
    expect(conflict.message).not.toContain("Candidate state changed");
  });

  it("marks changed prediction evidence stale", () => {
    const conflict = describeActivationConflict("Current prediction evidence is not READY");

    expect(conflict.stale).toBe(true);
    expect(conflict.message).toContain("evidence is insufficient or unavailable");
  });
});

vi.mock("@/lib/teacher-interventions-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/teacher-interventions-api")>();
  return {
    ...actual,
    ...apiMocks,
  };
});

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button type="button">Menu</button>,
}));

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("./forms/intervention-modal", () => ({
  default: () => null,
}));

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

  const findPlaceholder = (node: ReactNode): string => {
    let found = "";
    React.Children.forEach(node, (child) => {
      if (found || !React.isValidElement(child)) return;
      const props = child.props as { placeholder?: string; children?: ReactNode };
      if (props.placeholder) {
        found = props.placeholder;
      } else if (props.children) {
        found = findPlaceholder(props.children);
      }
    });
    return found;
  };

  function MockSelect({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children?: ReactNode;
  }) {
    const options = collectOptions(children);
    const label = findPlaceholder(children) || "Select";
    return (
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onValueChange?.(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
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
  const SelectObject = Object.assign(MockSelect, {
    Trigger: Passthrough,
    Value: () => null,
    Content: Passthrough,
    Item: MockSelectItem,
  });

  return { Select: SelectObject };
});

const gabrielResolved: TeacherInterventionSummary = {
  intervention_id: 1,
  student_id: "gabriel-id",
  student_name: "Gabriel Aquino 12",
  student_lrn: "123456789012",
  class_id: 8,
  class_name: "Grade 9 - Einstein",
  grade_level: 9,
  level_name: "Grade 9",
  subject_id: 7,
  subject_name: "Enhanced Mathematics 9",
  academic_period_id: 1,
  academic_period_name: "Quarter 1",
  status: "RESOLVED",
  source_prediction_id: 1,
  source_prediction_revision: 1,
  triggering_predicted_grade: 82.55,
  triggering_intervention_level: "MODERATE_RISK",
  current_prediction_revision: 3,
  current_predicted_grade: 85.35548749398748,
  current_intervention_level: "NEEDS_MONITORING",
  created_at: "2026-11-19T01:00:00+08:00",
  activated_at: "2026-11-19T01:05:00+08:00",
  resolved_at: "2026-11-19T01:34:08+08:00",
  resolution_reason: "IMPROVED_PREDICTION",
  diagnosis_summary: {},
};

const otherResolvedModerate: TeacherInterventionSummary = {
  ...gabrielResolved,
  intervention_id: 2,
  student_id: "other-id",
  student_name: "Maria Santos",
  student_lrn: "223456789012",
  current_prediction_revision: 2,
  current_predicted_grade: 83.4,
  current_intervention_level: "MODERATE_RISK",
  resolved_at: "2026-11-18T10:00:00+08:00",
  resolution_reason: "MANUAL_RESOLUTION",
};

const gabrielActive: TeacherInterventionSummary = {
  ...gabrielResolved,
  intervention_id: 4,
  status: "ACTIVE",
  source_prediction_id: 7,
  source_prediction_revision: 4,
  triggering_predicted_grade: 82.89,
  triggering_intervention_level: "MODERATE_RISK",
  current_prediction_revision: 8,
  current_predicted_grade: 82.7495322270322,
  current_intervention_level: "MODERATE_RISK",
  activated_at: "2026-11-19T01:45:00+08:00",
  resolved_at: null,
  resolution_reason: null,
};

beforeEach(() => {
  apiMocks.listTeacherCandidates.mockResolvedValue({ items: [], total: 0 });
  apiMocks.listTeacherActive.mockResolvedValue({ items: [gabrielActive], total: 1 });
  apiMocks.listTeacherResolved.mockResolvedValue({
    items: [gabrielResolved, otherResolvedModerate],
    total: 2,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TeacherInterventions resolved prediction display and risk filter", () => {
  it("shows resolution grade and On Track risk on Resolved tab and filters by displayed risk", async () => {
    render(
      <MemoryRouter initialEntries={["/teacher/interventions?view=resolved"]}>
        <TeacherInterventions />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("Gabriel Aquino 12")).toBeDefined());

    expect(screen.getByText("Resolution prediction")).toBeDefined();

    const gabrielRow = screen.getByText("Gabriel Aquino 12").closest("tr");
    expect(gabrielRow).not.toBeNull();
    expect(within(gabrielRow!).getByText("85.36")).toBeDefined();
    expect(within(gabrielRow!).getByText("On Track")).toBeDefined();
    expect(within(gabrielRow!).queryByText("82.75")).toBeNull();
    expect(within(gabrielRow!).queryByText("Moderate Risk")).toBeNull();

    const riskSelect = screen.getByLabelText("All Risk Levels") as HTMLSelectElement;
    const optionTexts = Array.from(riskSelect.options).map((option) => option.text);
    const optionValues = Array.from(riskSelect.options).map((option) => option.value);
    expect(optionTexts).toEqual(["All Risk Levels", "Moderate Risk", "On Track"]);
    expect(optionValues).toEqual(["all", "MODERATE_RISK", "ON_TRACK"]);

    fireEvent.change(riskSelect, { target: { value: "ON_TRACK" } });
    expect(screen.getByText("Gabriel Aquino 12")).toBeDefined();
    expect(screen.queryByText("Maria Santos")).toBeNull();

    fireEvent.change(riskSelect, { target: { value: "MODERATE_RISK" } });
    expect(screen.queryByText("Gabriel Aquino 12")).toBeNull();
    expect(screen.getByText("Maria Santos")).toBeDefined();
  });

  it("resets risk filter when switching tabs and preserves the active 82.75 Moderate Risk prediction", async () => {
    render(
      <MemoryRouter initialEntries={["/teacher/interventions?view=resolved"]}>
        <TeacherInterventions />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("Gabriel Aquino 12")).toBeDefined());

    const riskSelect = screen.getByLabelText("All Risk Levels") as HTMLSelectElement;
    fireEvent.change(riskSelect, { target: { value: "ON_TRACK" } });
    expect(screen.queryByText("Maria Santos")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /Active/i }));

    await waitFor(() => expect(screen.getByText("Current prediction")).toBeDefined());
    const activeRow = screen.getByText("Gabriel Aquino 12").closest("tr");
    expect(activeRow).not.toBeNull();
    expect(within(activeRow!).getByText("82.75")).toBeDefined();
    expect(within(activeRow!).getByText("Moderate Risk")).toBeDefined();
    expect(within(activeRow!).queryByText("85.36")).toBeNull();
  });
});
