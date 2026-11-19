// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  TeacherInterventionDetail,
  TeacherInterventionSummary,
  TeacherResolvedInterventionDetail,
} from "@/lib/teacher-interventions-api";
import InterventionModal from "./intervention-modal";

const supportMocks = vi.hoisted(() => ({
  saveAdjustments: vi.fn(async () => true),
}));

vi.mock("./intervention-support-materials", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef(function MockSupport({
      onAddInterventionActivity,
      onChangesChange,
      wizardStep,
    }: {
      onAddInterventionActivity?: () => void;
      onChangesChange?: (changed: boolean) => void;
      wizardStep?: number;
    }, ref) {
      React.useImperativeHandle(ref, () => ({
        saveAdjustments: supportMocks.saveAdjustments,
        validateStep: () => true,
      }));
      React.useEffect(() => {
        onChangesChange?.(wizardStep === 1);
      }, [onChangesChange, wizardStep]);
      return (
        <div>
          <span data-testid="support-wizard-step">{wizardStep}</span>
          <button type="button" onClick={onAddInterventionActivity}>
            Add Intervention Activity
          </button>
        </div>
      );
    }),
  };
});

beforeAll(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  supportMocks.saveAdjustments.mockClear();
});

const detail = {
  intervention_id: 42,
  status: "ACTIVE",
  student_name: "Test Student",
  diagnosis_snapshot: {},
} as TeacherInterventionDetail;

describe("intervention support wizard navigation", () => {
  it("starts intervention activity setup at step 1 without skipping setup", () => {
    render(
      <InterventionModal
        isOpen
        startSetup
        selectedKind="active"
        detail={detail}
        detailLoading={false}
        detailError={null}
        actionError={null}
        activating={false}
        reviewStale={false}
        onActivate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Step 1 of 3")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Add Intervention Activity" }));

    expect(screen.getByText("Step 1 of 3")).toBeDefined();
    expect(screen.getByTestId("support-wizard-step").textContent).toBe("1");
  });

  it("saves changed reading selections before closing step 1", async () => {
    const onClose = vi.fn();
    render(
      <InterventionModal
        isOpen
        startSetup
        selectedKind="active"
        detail={detail}
        detailLoading={false}
        detailError={null}
        actionError={null}
        activating={false}
        reviewStale={false}
        onActivate={vi.fn()}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("Step 1 of 3")).toBeDefined();
    const closeButton = screen.getAllByRole("button", { name: "Close" }).at(-1);
    expect(closeButton).toBeDefined();
    fireEvent.click(closeButton!);

    await waitFor(() => expect(supportMocks.saveAdjustments).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("resolved intervention detail modal", () => {
  it("displays the historical resolution grade and On Track risk instead of a newer cycle's prediction", () => {
    const resolvedDetail: TeacherResolvedInterventionDetail = {
      intervention_id: 1,
      student_id: "student-1",
      student_name: "Gabriel Aquino 12",
      student_lrn: "123456789012",
      class_id: 8,
      class_name: "Grade 9 - Einstein",
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
      activated_by_staff_id: "T-001",
      diagnosis_summary: {},
      diagnosis_snapshot: {},
      resolution_projection: 85.35548749398748,
      targeted_activities: [],
      sent_reviewer: null,
    };

    const newerActive: TeacherInterventionSummary = {
      ...resolvedDetail,
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

    render(
      <InterventionModal
        isOpen
        selectedKind="resolved"
        detail={resolvedDetail}
        detailLoading={false}
        detailError={null}
        actionError={null}
        activating={false}
        reviewStale={false}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        newerActive={newerActive}
      />,
    );

    expect(screen.getAllByText("85.36")).toHaveLength(1);
    expect(screen.getByText("82.55")).toBeDefined();
    expect(screen.getByText("On Track")).toBeDefined();
    expect(screen.getByText("Improved Prediction")).toBeDefined();
    expect(screen.queryByText("82.75")).toBeNull();
    expect(screen.queryByText("Moderate Risk")).toBeNull();
    expect(screen.getByText("Newer Active Cycle Exists")).toBeDefined();
    expect(screen.getByText("82.89")).toBeDefined();
  });
});
