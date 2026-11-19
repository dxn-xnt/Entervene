// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityRubricEditor } from "@/components/activity-rubric-editor";
import { defaultActivityRubric } from "@/lib/classwork-utils";

afterEach(cleanup);

describe("ActivityRubricEditor", () => {
  it("renders the clean rubric cards and yellow 100 pts badge without duplicate level editors", () => {
    const onChange = vi.fn();
    render(
      <ActivityRubricEditor
        levels={defaultActivityRubric}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("Scoring Rubric")).toBeDefined();
    const badge = screen.getByRole("button", { name: "Maximum score" });
    expect(badge.textContent).toContain("100 pts");
    expect(screen.getByText("Choose Template")).toBeDefined();

    // Cards and descriptions
    expect(screen.getByText("Excellent")).toBeDefined();
    expect(screen.getByText("100–81 pts")).toBeDefined();
    expect(screen.getByText("Displays all required components clearly and accurately.")).toBeDefined();

    expect(screen.getByText("Good")).toBeDefined();
    expect(screen.getByText("80–61 pts")).toBeDefined();

    expect(screen.getByText("Fair")).toBeDefined();
    expect(screen.getByText("60–41 pts")).toBeDefined();

    expect(screen.getByText("Needs Improvement")).toBeDefined();
    expect(screen.getByText("40–21 pts")).toBeDefined();

    expect(screen.getByText("Poor")).toBeDefined();
    expect(screen.getByText("20–0 pts")).toBeDefined();

    // Confirm duplicate expanded editor is NOT rendered
    expect(screen.queryByText("Add performance level")).toBeNull();
    expect(screen.queryByLabelText("Excellent minimum score")).toBeNull();
    expect(screen.queryByLabelText("Remove Excellent")).toBeNull();
  });

  it("activates accessible numeric input on clicking badge and scales to 50 points proportionally", () => {
    const onChange = vi.fn();
    render(
      <ActivityRubricEditor
        levels={defaultActivityRubric}
        onChange={onChange}
      />,
    );

    const badge = screen.getByRole("button", { name: "Maximum score" });
    fireEvent.click(badge);

    const input = screen.getByLabelText("Maximum score") as HTMLInputElement;
    expect(input).toBeDefined();
    expect(input.value).toBe("100");

    fireEvent.change(input, { target: { value: "50" } });

    expect(onChange).toHaveBeenCalledWith([
      { level_name: "Excellent", points: 50, description: "Displays all required components clearly and accurately.", display_order: 0 },
      { level_name: "Good", points: 40, description: "Most components are present with minor errors.", display_order: 1 },
      { level_name: "Fair", points: 30, description: "Some required parts are missing or unclear.", display_order: 2 },
      { level_name: "Needs Improvement", points: 20, description: "Many required elements are missing.", display_order: 3 },
      { level_name: "Poor", points: 10, description: "Work is incomplete or not submitted.", display_order: 4 },
    ]);
  });

  it("scales to 20 points and updates ranges with contiguous zero coverage", () => {
    const onChange = vi.fn();
    render(
      <ActivityRubricEditor
        levels={defaultActivityRubric}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Maximum score" }));
    fireEvent.change(screen.getByLabelText("Maximum score"), { target: { value: "20" } });

    expect(onChange).toHaveBeenCalledWith([
      { level_name: "Excellent", points: 20, description: "Displays all required components clearly and accurately.", display_order: 0 },
      { level_name: "Good", points: 16, description: "Most components are present with minor errors.", display_order: 1 },
      { level_name: "Fair", points: 12, description: "Some required parts are missing or unclear.", display_order: 2 },
      { level_name: "Needs Improvement", points: 8, description: "Many required elements are missing.", display_order: 3 },
      { level_name: "Poor", points: 4, description: "Work is incomplete or not submitted.", display_order: 4 },
    ]);
  });

  it("scales to 75 points preserving level names and descriptions", () => {
    const onChange = vi.fn();
    render(
      <ActivityRubricEditor
        levels={defaultActivityRubric}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Maximum score" }));
    fireEvent.change(screen.getByLabelText("Maximum score"), { target: { value: "75" } });

    expect(onChange).toHaveBeenCalledWith([
      { level_name: "Excellent", points: 75, description: "Displays all required components clearly and accurately.", display_order: 0 },
      { level_name: "Good", points: 60, description: "Most components are present with minor errors.", display_order: 1 },
      { level_name: "Fair", points: 45, description: "Some required parts are missing or unclear.", display_order: 2 },
      { level_name: "Needs Improvement", points: 30, description: "Many required elements are missing.", display_order: 3 },
      { level_name: "Poor", points: 15, description: "Work is incomplete or not submitted.", display_order: 4 },
    ]);
  });

  it("displays updated score bands immediately when levels prop updates to 50, 20, and 75", () => {
    const { rerender } = render(
      <ActivityRubricEditor
        levels={[
          { level_name: "Excellent", points: 50, description: "Desc 1", display_order: 0 },
          { level_name: "Good", points: 40, description: "Desc 2", display_order: 1 },
          { level_name: "Fair", points: 30, description: "Desc 3", display_order: 2 },
          { level_name: "Needs Improvement", points: 20, description: "Desc 4", display_order: 3 },
          { level_name: "Poor", points: 10, description: "Desc 5", display_order: 4 },
        ]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("50 pts")).toBeDefined();
    expect(screen.getByText("50–41 pts")).toBeDefined();
    expect(screen.getByText("40–31 pts")).toBeDefined();
    expect(screen.getByText("30–21 pts")).toBeDefined();
    expect(screen.getByText("20–11 pts")).toBeDefined();
    expect(screen.getByText("10–0 pts")).toBeDefined();

    // Rerender with 20 points
    rerender(
      <ActivityRubricEditor
        levels={[
          { level_name: "Excellent", points: 20, description: "Desc 1", display_order: 0 },
          { level_name: "Good", points: 16, description: "Desc 2", display_order: 1 },
          { level_name: "Fair", points: 12, description: "Desc 3", display_order: 2 },
          { level_name: "Needs Improvement", points: 8, description: "Desc 4", display_order: 3 },
          { level_name: "Poor", points: 4, description: "Desc 5", display_order: 4 },
        ]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("20 pts")).toBeDefined();
    expect(screen.getByText("20–17 pts")).toBeDefined();
    expect(screen.getByText("16–13 pts")).toBeDefined();
    expect(screen.getByText("12–9 pts")).toBeDefined();
    expect(screen.getByText("8–5 pts")).toBeDefined();
    expect(screen.getByText("4–0 pts")).toBeDefined();

    // Rerender with 75 points
    rerender(
      <ActivityRubricEditor
        levels={[
          { level_name: "Excellent", points: 75, description: "Desc 1", display_order: 0 },
          { level_name: "Good", points: 60, description: "Desc 2", display_order: 1 },
          { level_name: "Fair", points: 45, description: "Desc 3", display_order: 2 },
          { level_name: "Needs Improvement", points: 30, description: "Desc 4", display_order: 3 },
          { level_name: "Poor", points: 15, description: "Desc 5", display_order: 4 },
        ]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("75 pts")).toBeDefined();
    expect(screen.getByText("75–61 pts")).toBeDefined();
    expect(screen.getByText("60–46 pts")).toBeDefined();
    expect(screen.getByText("45–31 pts")).toBeDefined();
    expect(screen.getByText("30–16 pts")).toBeDefined();
    expect(screen.getByText("15–0 pts")).toBeDefined();
  });

  it("does not allow editing when disabled (e.g. graded submissions locked)", () => {
    const onChange = vi.fn();
    render(
      <ActivityRubricEditor
        levels={defaultActivityRubric}
        onChange={onChange}
        disabled={true}
      />,
    );

    // Badge is static and non-interactive
    expect(screen.queryByRole("button", { name: "Maximum score" })).toBeNull();
    expect(screen.getByText("100 pts")).toBeDefined();
    expect(screen.queryByLabelText("Maximum score")).toBeNull();
  });
});
