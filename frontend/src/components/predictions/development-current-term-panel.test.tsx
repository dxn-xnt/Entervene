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
  fetchPersisted: vi.fn(),
  fetchFilters: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  getClasses: api.getClasses,
  getSubjects: api.getSubjects,
  getClassStudents: api.getClassStudents,
}));
vi.mock("@/lib/prediction-api", () => ({
  generateDevelopmentCurrentTermPrediction: api.generate,
  fetchDevelopmentCurrentTermPredictions: api.fetchPersisted,
  fetchDashboardFilters: api.fetchFilters,
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
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
const persisted = {
  prediction_id: 44,
  revision: 3,
  student_id: "student-1",
  student_name: "Rivera, Alex",
  class_id: 7,
  class_name: "Archimedes",
  subject_id: 5,
  subject_name: "Science",
  subject_codename: "SCI",
  academic_period_id: 3,
  period_name: "Term 1",
  projected_final_term_grade: 89.69,
  intervention_level: "NEEDS_MONITORING",
  intervention_basis: "RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE",
  readiness_status: "READY",
  readiness_level: "STANDARD_READY",
  model_version_id: 62,
  model_name: "entervene_current_term_development_rf_v3",
  lifecycle_status: "DEVELOPMENT",
  generated_at: "2026-09-22T10:00:00Z",
  academic_evidence: {
    written_works: { graded_count: 2, performance_percent: 82 },
    performance_tasks: { graded_count: 1, performance_percent: 88 },
    examination: {
      graded_count: 0,
      performance_percent: null,
      presentation: {
        status: "PARTIAL",
        completed_count: 2,
        components: { SUMMATIVE_1: 80, SUMMATIVE_2: 70, TERM_EXAM: null },
      },
    },
    overall: { graded_activity_count: 3, performance_percent: 85, observed_component_weight_percent: 60 },
  },
};

beforeEach(() => {
  api.getClasses.mockResolvedValue({ classes: [scope] });
  api.getSubjects.mockResolvedValue({ subjects: [{ subject_id: 5, subject_name: "Science", academic_level: { academic_level_id: 9 } }] });
  api.getClassStudents.mockResolvedValue({ students: [{ student_id: "student-1", full_name: "Alex Rivera" }] });
  api.generate.mockResolvedValue(result);
  api.fetchPersisted.mockResolvedValue({ items: [], total: 0 });
  api.fetchFilters.mockResolvedValue({
    grades: [{ grade_level: 9, level_name: "Grade 9" }],
    classes: [{ class_id: 7, section_name: "Archimedes", grade_level: 9 }],
    subjects: [{ subject_id: 5, subject_name: "Science", subject_codename: "SCI" }],
    terms: [{ term_number: 1, term_label: "Term 1", academic_period_id: 3 }],
  });
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

async function selectReadScope() {
  render(<DevelopmentCurrentTermPanel periodId={3} termName="Term 1" role="admin" />);
  await waitFor(() => expect(screen.getByLabelText("Class").querySelectorAll("option")).toHaveLength(2));
  fireEvent.change(screen.getByLabelText("Class"), { target: { value: "7" } });
  await waitFor(() => expect(screen.getByLabelText("Subject").querySelectorAll("option")).toHaveLength(2));
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "5" } });
}

async function selectTeacherScope() {
  render(<DevelopmentCurrentTermPanel periodId={3} termName="Term 1" role="teacher" />);
  await waitFor(() => expect(screen.getByLabelText("Academic term").querySelectorAll("option")).toHaveLength(2));
  await waitFor(() => expect(screen.getByLabelText("Class").querySelectorAll("option")).toHaveLength(2));
  fireEvent.change(screen.getByLabelText("Class"), { target: { value: "7" } });
  await waitFor(() => expect(screen.getByLabelText("Subject").querySelectorAll("option")).toHaveLength(2));
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "5" } });
}

describe("development current-term predictions", () => {
  it.each(["admin", "teacher"] as const)("shows partial Examination evidence in the %s detail view", async (role) => {
    api.fetchPersisted.mockResolvedValue({ items: [persisted], total: 1 });
    if (role === "admin") await selectReadScope();
    else await selectTeacherScope();

    await waitFor(() => expect(screen.getByText("Rivera, Alex")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "View Details" }));
    const exam = screen.getByLabelText("Examination evidence");
    expect(exam.textContent).toContain("In progress");
    expect(exam.textContent).toContain("2 of 3 graded");
    expect(exam.textContent).toContain("Summative 1");
    expect(exam.textContent).toContain("80.0%");
    expect(exam.textContent).toContain("Summative 2");
    expect(exam.textContent).toContain("70.0%");
    expect(exam.textContent).toContain("Term Exam");
    expect(exam.textContent).toContain("Not yet graded");
    expect(exam.textContent).toContain("Final Examination component not yet available for prediction.");
    expect(exam.textContent).not.toContain("75.0%");
    expect(screen.queryByText("0.0%")).toBeNull();
  });

  it.each(["admin", "teacher"] as const)("shows an unsupported-grade message for SHS %s without loading predictions", async (role) => {
    api.getClasses.mockResolvedValue({ classes: [{ ...scope, academic_level: { academic_level_id: 11, level_name: "Grade 11", grade_level: 11 } }] });
    api.getSubjects.mockResolvedValue({ subjects: [{ subject_id: 5, subject_name: "General Mathematics", academic_level: { academic_level_id: 11 } }] });
    api.fetchFilters.mockImplementation(async (query?: { class_id?: number }) => ({
      grades: [{ grade_level: 11, level_name: "Grade 11" }],
      classes: [{ class_id: 7, section_name: "Archimedes", grade_level: 11 }],
      subjects: query?.class_id ? [{ subject_id: 5, subject_name: "General Mathematics" }] : [],
      terms: [{ term_number: 1, term_label: "Term 1", academic_period_id: 3 }],
    }));
    render(<DevelopmentCurrentTermPanel periodId={3} termName="Term 1" role={role} />);
    await waitFor(() => expect(screen.getByLabelText("Class").querySelectorAll("option")).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("Class"), { target: { value: "7" } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("AI grade projection is not yet available for this grade level."));
    expect(screen.queryByText("No current-term projections available")).toBeNull();
    expect(api.fetchPersisted).not.toHaveBeenCalled();
    if (role === "admin") expect(screen.getByRole("button", { name: "Generate Projection" }).hasAttribute("disabled")).toBe(true);
  });

  it("gives teachers an assigned-load read-only view", async () => {
    api.fetchPersisted.mockResolvedValue({ items: [persisted], total: 1 });
    await selectTeacherScope();

    await waitFor(() => expect(screen.getByText("Rivera, Alex")).toBeTruthy());
    expect(api.fetchFilters).toHaveBeenCalledWith({ class_id: 7, academic_period_id: 3 });
    expect(api.fetchPersisted).toHaveBeenCalledWith(
      { class_id: 7, subject_id: 5, academic_period_id: 3 },
      "teacher",
    );
    expect(screen.getByText("Archimedes")).toBeTruthy();
    expect(screen.getByText("Science")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Generate Projection" })).toBeNull();
    expect(screen.queryByLabelText("Student")).toBeNull();
    expect(screen.getByText("Projected Final Term Grade")).toBeTruthy();
    expect(screen.getByText("Intervention Level")).toBeTruthy();
    expect(screen.queryByText(/risk score|probability|confidence/i)).toBeNull();
    expect(api.getClasses).not.toHaveBeenCalled();
    expect(api.getSubjects).not.toHaveBeenCalled();
    expect(api.getClassStudents).not.toHaveBeenCalled();
    expect(api.generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "View Details" }));
    expect(screen.getByText("Current-Term Projection")).toBeTruthy();
    expect(screen.getByText("Revision").nextSibling?.textContent).toBe("3");
  });

  it("shows teacher authorization failures instead of an empty success", async () => {
    api.fetchPersisted.mockRejectedValue(new Error("Your account is not authorized to view development predictions."));
    await selectTeacherScope();

    await waitFor(() => expect(screen.getByText("Your account is not authorized to view development predictions.")).toBeTruthy());
    expect(screen.queryByText("No current-term projections available for this scope.")).toBeNull();
  });

  it("does not expose a scope when the teacher has no assigned loads", async () => {
    api.fetchFilters.mockResolvedValue({ grades: [], classes: [], subjects: [], terms: [] });
    render(<DevelopmentCurrentTermPanel periodId={3} termName="Term 1" role="teacher" />);

    await waitFor(() => expect(api.fetchFilters).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Class").querySelectorAll("option")).toHaveLength(1);
    expect(screen.getByLabelText("Subject").querySelectorAll("option")).toHaveLength(1);
    expect(api.fetchPersisted).not.toHaveBeenCalled();
  });

  it("shows teacher loading and neutral empty states", async () => {
    let resolveRead!: (value: { items: never[]; total: number }) => void;
    api.fetchPersisted.mockReturnValue(new Promise((resolve) => { resolveRead = resolve; }));
    await selectTeacherScope();

    expect(screen.getByLabelText("Loading current-term projections")).toBeTruthy();
    expect(screen.queryByText("No current-term projections available for this scope.")).toBeNull();
    await act(async () => resolveRead({ items: [], total: 0 }));
    await waitFor(() => expect(screen.getByText("No current-term projections available for this scope.")).toBeTruthy());
    expect(screen.queryByText(/on track/i)).toBeNull();
  });

  it("uses the grade and intervention contract, not a risk score", async () => {
    api.fetchPersisted.mockResolvedValue({ items: [persisted], total: 1 });
    await selectScope();
    expect(screen.getByText("Development model, not yet production validated.")).toBeTruthy();
    expect(screen.getByText("All Intervention Levels")).toBeTruthy();
    expect(screen.queryByText(/on track/i)).toBeNull();
    await waitFor(() => expect(screen.getByText("89.69")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Generate Projection" }));
    await waitFor(() => expect(api.fetchPersisted).toHaveBeenCalledTimes(2));
    expect(api.generate).toHaveBeenCalledWith({ student_id: "student-1", class_id: 7, subject_id: 5, source_period_id: 3 }, "admin");
    expect(screen.getByText("Projected Final Term Grade")).toBeTruthy();
    expect(screen.getByText("Intervention Level")).toBeTruthy();
    expect(screen.getAllByText("Needs Monitoring")).toHaveLength(2);
    expect(screen.queryByText("Risk Score")).toBeNull();
    expect(screen.queryByText(/probability|confidence/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View Details" }));
    expect(screen.getByText("Current-Term Projection")).toBeTruthy();
    expect(screen.getByText(/assigned separately using the school's grade-based intervention rules/)).toBeTruthy();
  });

  it("loads persisted latest-revision rows for the selected scope", async () => {
    api.fetchPersisted.mockResolvedValue({ items: [persisted], total: 1 });
    await selectReadScope();

    await waitFor(() => expect(screen.getByText("Rivera, Alex")).toBeTruthy());
    expect(api.fetchPersisted).toHaveBeenCalledWith({ class_id: 7, subject_id: 5, academic_period_id: 3 }, "admin");
    fireEvent.click(screen.getByRole("button", { name: "View Details" }));
    expect(screen.getByText("Revision").nextSibling?.textContent).toBe("3");
  });

  it("fetches persisted results again after the panel remounts", async () => {
    api.fetchPersisted.mockResolvedValue({ items: [persisted], total: 1 });
    await selectReadScope();
    await waitFor(() => expect(api.fetchPersisted).toHaveBeenCalledTimes(1));
    cleanup();

    await selectReadScope();
    await waitFor(() => expect(api.fetchPersisted).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Rivera, Alex")).toBeTruthy();
  });

  it("reloads an authorized teacher's persisted result after remount", async () => {
    api.fetchPersisted.mockResolvedValue({ items: [persisted], total: 1 });
    await selectTeacherScope();
    await waitFor(() => expect(api.fetchPersisted).toHaveBeenCalledTimes(1));
    cleanup();

    await selectTeacherScope();
    await waitFor(() => expect(api.fetchPersisted).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Rivera, Alex")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Generate Projection" })).toBeNull();
  });

  it("refetches when the selected academic period changes", async () => {
    const view = render(<DevelopmentCurrentTermPanel periodId={3} termName="Term 1" role="admin" />);
    await waitFor(() => expect(screen.getByLabelText("Class").querySelectorAll("option")).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("Class"), { target: { value: "7" } });
    await waitFor(() => expect(screen.getByLabelText("Subject").querySelectorAll("option")).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "5" } });
    await waitFor(() => expect(api.fetchPersisted).toHaveBeenCalledWith(
      { class_id: 7, subject_id: 5, academic_period_id: 3 },
      "admin",
    ));

    view.rerender(<DevelopmentCurrentTermPanel periodId={4} termName="Term 2" role="admin" />);

    await waitFor(() => expect(api.fetchPersisted).toHaveBeenCalledWith(
      { class_id: 7, subject_id: 5, academic_period_id: 4 },
      "admin",
    ));
  });

  it("refetches authoritative persisted rows after successful generation", async () => {
    api.fetchPersisted
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({ items: [{ ...persisted, revision: 4, projected_final_term_grade: 91.25 }], total: 1 });
    await selectScope();
    await waitFor(() => expect(api.fetchPersisted).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Generate Projection" }));

    await waitFor(() => expect(screen.getByText("91.25")).toBeTruthy());
    expect(api.fetchPersisted).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "View Details" }));
    expect(screen.getByText("Revision").nextSibling?.textContent).toBe("4");
  });

  it("shows loading, read error, and neutral empty states", async () => {
    let rejectRead!: (reason: Error) => void;
    api.fetchPersisted.mockReturnValue(new Promise((_resolve, reject) => { rejectRead = reject; }));
    await selectReadScope();
    expect(screen.getByLabelText("Loading current-term projections")).toBeTruthy();
    expect(screen.queryByText("No current-term projections available")).toBeNull();

    await act(async () => rejectRead(new Error("Persisted projections could not be loaded.")));
    await waitFor(() => expect(screen.getByText("Persisted projections could not be loaded.")).toBeTruthy());
    expect(screen.queryByText("No current-term projections available")).toBeNull();

    cleanup();
    api.fetchPersisted.mockResolvedValue({ items: [], total: 0 });
    await selectReadScope();
    await waitFor(() => expect(screen.getByText("No current-term projections available for this scope.")).toBeTruthy());
    expect(screen.queryByText(/on track/i)).toBeNull();
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
