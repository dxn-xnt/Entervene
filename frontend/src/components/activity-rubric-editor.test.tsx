// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityRubricEditor } from "@/components/activity-rubric-editor";

afterEach(cleanup);

describe("ActivityRubricEditor", () => {
  it("scales the default rubric ranges proportionally when the maximum changes", () => {
    const onChange = vi.fn();
    render(
      <ActivityRubricEditor
        levels={[
          { level_name: "Excellent", description: "Excellent", points: 100, display_order: 0 },
          { level_name: "Good", description: "Good", points: 80, display_order: 1 },
          { level_name: "Developing", description: "Developing", points: 60, display_order: 2 },
        ]}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Maximum score"), { target: { value: "50" } });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ points: 50 }),
      expect.objectContaining({ points: 40 }),
      expect.objectContaining({ points: 30 }),
    ]);
  });
});
