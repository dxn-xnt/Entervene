// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GradingTemplateManager } from "./subjects/components/grading-template-manager";

const createTemplate = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const updateTemplate = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("@/lib/api", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("@/lib/api")>();
  return { ...original, createGradingTemplate: createTemplate, updateGradingTemplate: updateTemplate };
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

afterEach(() => { cleanup(); createTemplate.mockClear(); updateTemplate.mockClear(); });

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
});
