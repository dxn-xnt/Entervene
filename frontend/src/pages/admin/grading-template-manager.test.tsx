// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { GradingTemplateManager } from "./subjects/components/grading-template-manager";

const createTemplate = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const updateTemplate = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const editThreshold = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("@/lib/api", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("@/lib/api")>();
  return { ...original, createGradingTemplate: createTemplate, updateGradingTemplate: updateTemplate, editGradingTemplateThreshold: editThreshold };
});

const templates = [{
  grading_template_id: 1, template_name: "Core", description: null, passing_threshold: 87,
  assigned_subjects: [], assigned_subject_count: 0, is_locked: false, lock_reason: null,
  status: "active" as const, total_weight: 100, component_count: 3,
  components: [
    { component_id: 1, component_name: "Written Work", weight: 20, display_order: 1, created_at: null, updated_at: null },
    { component_id: 2, component_name: "Performance Tasks", weight: 50, display_order: 2, created_at: null, updated_at: null },
    { component_id: 3, component_name: "Exams", weight: 30, display_order: 3, created_at: null, updated_at: null },
  ], created_at: null, updated_at: "2026-10-18T00:00:00Z",
}];

const subject = (id: number, name: string, code: string, templateId: number, templateName: string, locked = false) => ({
  subject_id: id,
  subject_name: name,
  subject_codename: code,
  grading_template_id: templateId,
  grading_template: { grading_template_id: templateId, template_name: templateName, passing_threshold: 85, components: [] },
  grading_template_assignment_locked: locked,
  grading_template_assignment_lock_reason: locked ? "Recorded period grades prevent changing this subject's grading template." : null,
  description: null,
  status: "active" as const,
  academic_level: { academic_level_id: 1, level_name: "Grade 7", grade_level: 7 },
  created_at: null,
  updated_at: null,
});

afterEach(() => { cleanup(); createTemplate.mockClear(); updateTemplate.mockClear(); editThreshold.mockClear(); });

describe("Subjects grading template manager", () => {
  it("renders stored values and opens the creation dialog", () => {
    render(<GradingTemplateManager templates={templates} subjects={[]} onReload={vi.fn()} />);
    expect(screen.getByText("87%")).toBeTruthy();
    expect(screen.getByText("Written Work")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /New Grading Template/ }));
    expect(screen.getByText("New Grading Template", { selector: "h3" })).toBeTruthy();
  });

  it("creates a valid additional template", async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    render(<GradingTemplateManager templates={templates} subjects={[]} onReload={reload} />);
    fireEvent.click(screen.getByRole("button", { name: /New Grading Template/ }));
    fireEvent.change(screen.getByLabelText("Template Name"), { target: { value: "Creative Studies" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Template" }));
    await waitFor(() => expect(createTemplate).toHaveBeenCalledWith(expect.objectContaining({
      template_name: "Creative Studies", passing_threshold: 85, subject_ids: [],
    })));
    expect(reload).toHaveBeenCalled();
  });

  it("keeps large subject assignments compact until expanded", () => {
    const assigned = Array.from({ length: 6 }, (_, index) => ({
      subject_id: index + 1,
      subject_name: `Subject ${index + 1}`,
      subject_codename: `S${index + 1}`,
      grade_level: index < 3 ? 7 : 8,
    }));
    render(
      <GradingTemplateManager
        templates={[{ ...templates[0], assigned_subjects: assigned, assigned_subject_count: assigned.length }]}
        subjects={[]}
        onReload={vi.fn()}
      />,
    );

    expect(screen.getByText("Subject 4")).toBeTruthy();
    expect(screen.queryByText("Subject 5")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View All Subjects (6)" }));
    expect(screen.getByText("Subject 5")).toBeTruthy();
    expect(screen.getByText("Grade 7")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("sends threshold edits through the audited year-specific action", async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    render(<GradingTemplateManager templates={templates} subjects={[]} onReload={reload}
      academicYears={[{ academic_year_id: 7, year_label: "2026-2027", is_active: true }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Core" }));
    fireEvent.change(screen.getByLabelText("Audited passing threshold"), { target: { value: "88.25" } });
    fireEvent.change(screen.getByLabelText("Reason for threshold edit"), { target: { value: "Approved school adjustment" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Threshold with Audit" }));
    await waitFor(() => expect(editThreshold).toHaveBeenCalledWith(1, {
      academic_year_id: 7, threshold: "88.25", expected_updated_at: "2026-10-18T00:00:00Z",
      reason: "Approved school adjustment",
    }));
    expect(updateTemplate).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
  });

  it("filters templates by search term and resets", () => {
    const multiTemplates = [
      { ...templates[0], grading_template_id: 1, template_name: "Languages" },
      { ...templates[0], grading_template_id: 2, template_name: "Science & Math" },
    ];
    render(<GradingTemplateManager templates={multiTemplates} subjects={[]} onReload={vi.fn()} />);

    expect(screen.getByText("Languages")).toBeTruthy();
    expect(screen.getByText("Science & Math")).toBeTruthy();

    const searchInput = screen.getByPlaceholderText("Search template name, description, or subject");
    fireEvent.change(searchInput, { target: { value: "Science" } });

    expect(screen.queryByText("Languages")).toBeNull();
    expect(screen.getByText("Science & Math")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText("Languages")).toBeTruthy();
    expect(screen.getByText("Science & Math")).toBeTruthy();
  });

  it("shows empty state when no templates match filters", () => {
    render(<GradingTemplateManager templates={templates} subjects={[]} onReload={vi.fn()} />);
    const searchInput = screen.getByPlaceholderText("Search template name, description, or subject");
    fireEvent.change(searchInput, { target: { value: "NonExistentTemplate" } });

    expect(screen.getByText("No grading templates match the selected filters.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));
    expect(screen.getByText("87%")).toBeTruthy();
  });

  it("keeps the subject picker compact and disables subjects assigned to another template", () => {
    const coreSubject = subject(1, "Mathematics 7", "MATH7", 1, "Core");
    const appliedSubject = subject(2, "Work Immersion", "WI7", 2, "Applied");
    const multiTemplates = [
      { ...templates[0], assigned_subjects: [{ subject_id: 1, subject_name: "Mathematics 7", subject_codename: "MATH7", grade_level: 7 }], assigned_subject_count: 1 },
      { ...templates[0], grading_template_id: 2, template_name: "Applied", assigned_subjects: [{ subject_id: 2, subject_name: "Work Immersion", subject_codename: "WI7", grade_level: 7 }], assigned_subject_count: 1 },
    ];
    render(<GradingTemplateManager templates={multiTemplates} subjects={[coreSubject, appliedSubject]} onReload={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Core" }));
    const appliedName = screen.getAllByText("Work Immersion").find((element) => element.tagName === "STRONG");
    const appliedRow = appliedName?.closest("label");
    expect(appliedRow).toBeTruthy();
    expect((within(appliedRow!).getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    expect(within(appliedRow!).getByText("Applied")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Move here" })).toBeNull();
  });

  it("disables moves for subjects with recorded grades and explains the lock", () => {
    const lockedSubject = subject(2, "Work Immersion", "WI7", 2, "Applied", true);
    const multiTemplates = [
      templates[0],
      { ...templates[0], grading_template_id: 2, template_name: "Applied", assigned_subjects: [{ subject_id: 2, subject_name: "Work Immersion", subject_codename: "WI7", grade_level: 7 }], assigned_subject_count: 1 },
    ];
    render(<GradingTemplateManager templates={multiTemplates} subjects={[lockedSubject]} onReload={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Core" }));
    const lockedName = screen.getAllByText("Work Immersion").find((element) => element.tagName === "STRONG");
    const lockedRow = lockedName?.closest("label");
    expect(lockedRow).toBeTruthy();
    expect((within(lockedRow!).getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    expect(lockedRow?.getAttribute("title")).toContain("Recorded period grades");
  });

  it("detects duplicate catalog rows by subject ID or grade-level code", () => {
    const first = subject(1, "English 7", "ENG7", 1, "Core");
    const duplicateCode = subject(2, "English Seven", "eng7", 1, "Core");
    render(<GradingTemplateManager templates={templates} subjects={[first, duplicateCode]} onReload={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Core" }));
    expect(screen.getByText("Duplicate catalog entries detected")).toBeTruthy();
    expect(screen.getByText(/ENG7 \(Grade 7\)/i)).toBeTruthy();
  });
});
