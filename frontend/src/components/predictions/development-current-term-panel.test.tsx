// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import DevelopmentCurrentTermPanel from "./development-current-term-panel";
import { BLOCKED_MESSAGES, INTERVENTION_LABELS } from "./development-current-term-contract";

const api = vi.hoisted(() => ({
  getClasses: vi.fn(),
  getSubjects: vi.fn(),
  getClassStudents: vi.fn(),
  generate: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  getClasses: api.getClasses,
  getSubjects: api.getSubjects,
  getClassStudents: api.getClassStudents,
}));
vi.mock("@/lib/prediction-api", () => ({ generateDevelopmentCurrentTermPrediction: api.generate }));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
}));
vi.mock("@/components/retroui/Select", () => {
  function find(element: React.ReactNode, name: string): React.ReactElement[] {
    return React.Children.toArray(element).flatMap((child) => {
      if (!React.isValidElement(child)) return [];
      const own = child.type === name ? [child] : [];
      return [...own, ...find((child.props as { children?: React.ReactNode }).children, name)];
    });
  }
  function Select({ children, value, onValueChange, disabled }: { children: React.ReactNode; value: string; onValueChange: (value: string) => void; disabled?: boolean }) {
    const trigger = find(children, "trigger")[0];
    const items = find(children, "item");
    return <select id={(trigger?.props as { id?: string })?.id} value={value} disabled={disabled} onChange={(event) => onValueChange(event.target.value)}>
      {items.map((item) => <option key={(item.props as { value: string }).value} value={(item.props as { value: string }).value}>{(item.props as { children: React.ReactNode }).children}</option>)}
    </select>;
  }
  Select.Trigger = "trigger";
  Select.Value = "value";
  Select.Content = "content";
  Select.Item = "item";
  return { Select };
});

const scope = {
  class_id: 7,
  section_name: "Archimedes",
  academic_level: { academic_level_id: 9, level_name: "Grade 9" },
};
const result = {
  persisted: true,
  prediction_id: 44,
  revision: 1,
  prediction_status: "DEVELOPMENT_PREDICTION_AVAILABLE",
  projected_final_term_grade: 89.69,
  intervention_level: "NEEDS_MONITORING",
  intervention_basis: "RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE",
  readiness_status: "READY",
  readiness_level: "STANDARD_READY",
  readiness_reason_codes: [],
  source_period_id: 3,
  target_period_id: 3,
  prediction_purpose: "CURRENT_TERM_FINAL_GRADE_PROJECTION",
  model_name: "entervene_current_term_development_rf_v3",
  model_version_id: 62,
  lifecycle_status: "DEVELOPMENT",
  development_status: "DEVELOPMENT_ONLY",
  generated_at: "2026-09-22T10:00:00Z",
};

beforeEach(() => {
  api.getClasses.mockResolvedValue({ classes: [scope] });
  api.getSubjects.mockResolvedValue({ subjects: [{ subject_id: 5, subject_name: "Science", academic_level: { academic_level_id: 9 } }] });
  api.getClassStudents.mockResolvedValue({ students: [{ student_id: "student-1", full_name: "Alex Rivera" }] });
  api.generate.mockResolvedValue(result);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function selectScope() {
  render(<DevelopmentCurrentTermPanel periodId={3} termName="Term 1" role="admin" />);
  await waitFor(() => expect(screen.getByLabelText("Class").querySelectorAll("option")).toHaveLength(2));
  fireEvent.change(screen.getByLabelText("Class"), { target: { value: "7" } });
  await waitFor(() => expect(screen.getByLabelText("Subject").querySelectorAll("option")).toHaveLength(2));
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "5" } });
  await waitFor(() => expect(screen.getByLabelText("Student").querySelectorAll("option")).toHaveLength(2));
  fireEvent.change(screen.getByLabelText("Student"), { target: { value: "student-1" } });
}

describe("development current-term predictions", () => {
  it("uses the grade and intervention contract, not a risk score", async () => {
    await selectScope();
    expect(screen.getByText("Development model, not yet production validated.")).toBeTruthy();
    expect(screen.getByText("All Intervention Levels")).toBeTruthy();
    expect(screen.getByText("No current-term projections available")).toBeTruthy();
    expect(screen.queryByText(/on track/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Generate Projection" }));
    await waitFor(() => expect(screen.getByText("89.69")).toBeTruthy());
    expect(api.generate).toHaveBeenCalledWith({ student_id: "student-1", class_id: 7, subject_id: 5, source_period_id: 3 }, "admin");
    expect(screen.getByText("Projected Final Term Grade")).toBeTruthy();
    expect(screen.getByText("Intervention Level")).toBeTruthy();
    expect(screen.getAllByText("Needs Monitoring")).toHaveLength(2);
    expect(screen.queryByText("Risk Score")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View Details" }));
    expect(screen.getByText("Current-Term Projection")).toBeTruthy();
    expect(screen.getByText(/assigned separately using the school's grade-based intervention rules/)).toBeTruthy();
  });

  it("prevents duplicate generation while pending", async () => {
    let resolve!: (value: typeof result) => void;
    api.generate.mockReturnValue(new Promise((done) => { resolve = done; }));
    await selectScope();
    const button = screen.getByRole("button", { name: "Generate Projection" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.generate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Generating..." }).hasAttribute("disabled")).toBe(true);
    await act(async () => resolve(result));
  });

  it.each(["INSUFFICIENT_EVIDENCE", "UNSUPPORTED_DEVELOPMENT_DOMAIN", "INVALID_PERIOD_SCOPE", "FINALIZED_GRADE_EXISTS"])(
    "shows the %s blocked explanation without a result row", async (status) => {
      api.generate.mockResolvedValue({ ...result, persisted: false, prediction_status: status, intervention_level: "INTERVENTION_NOT_ASSESSED", reason_codes: [status] });
      await selectScope();
      fireEvent.click(screen.getByRole("button", { name: "Generate Projection" }));
      await waitFor(() => expect(screen.getByText(new RegExp(BLOCKED_MESSAGES[status].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeTruthy());
      expect(screen.queryByText("89.69")).toBeNull();
    },
  );

  it("keeps insufficient evidence out of the intervention levels", () => {
    expect(Object.keys(INTERVENTION_LABELS)).toEqual(["HIGH_RISK", "MODERATE_RISK", "NEEDS_MONITORING", "LOW_RISK"]);
  });
});
