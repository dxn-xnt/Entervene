// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TeacherInterventionDetail } from "@/lib/teacher-interventions-api";
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
        onChangesChange?.(wizardStep === 2);
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
  it("moves an already-open support plan from step 1 to remediation activity step 4", () => {
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

    expect(screen.getByText("Step 1 of 5")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Add Intervention Activity" }));

    expect(screen.getByText("Step 4 of 5")).toBeDefined();
    expect(screen.getByTestId("support-wizard-step").textContent).toBe("4");
  });

  it("saves changed reading selections before closing step 2", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 2 of 5")).toBeDefined();
    const closeButton = screen.getAllByRole("button", { name: "Close" }).at(-1);
    expect(closeButton).toBeDefined();
    fireEvent.click(closeButton!);

    await waitFor(() => expect(supportMocks.saveAdjustments).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
  });
});
