// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RubricLevelFields } from "./rubric-level-fields";
import { defaultActivityRubric } from "@/lib/classwork-utils";
import type { ActivityRubricLevel } from "@/types/classwork";

afterEach(cleanup);

function RubricForm() {
  const [levels, setLevels] = useState<ActivityRubricLevel[]>(defaultActivityRubric);
  return <RubricLevelFields levels={levels} onChange={setLevels} />;
}

describe("RubricLevelFields", () => {
  it("keeps upper boundaries derived while allowing lower boundaries to be edited", () => {
    render(<RubricForm />);

    expect(screen.getByLabelText("Excellent minimum score")).toHaveProperty("value", "81");
    expect(screen.getByLabelText("Good minimum score")).toHaveProperty("value", "61");
    expect(screen.getByLabelText("Poor minimum score").textContent).toBe("1");
    expect(screen.getByLabelText("Excellent maximum score").textContent).toBe("100");

    fireEvent.change(screen.getByLabelText("Excellent minimum score"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Excellent minimum score"), {
      target: { value: "86" },
    });

    expect(screen.getByLabelText("Excellent minimum score")).toHaveProperty("value", "86");
    expect(screen.getByLabelText("Good maximum score").textContent).toBe("85");

    fireEvent.change(screen.getByLabelText("Excellent minimum score"), {
      target: { value: "500" },
    });
    expect(screen.getByText("Use 62–100.")).toBeTruthy();
    expect(screen.getByLabelText("Good maximum score").textContent).toBe("85");

    fireEvent.blur(screen.getByLabelText("Excellent minimum score"));
    expect(screen.getByLabelText("Excellent minimum score")).toHaveProperty("value", "86");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("allows the rubric maximum score to be changed from 100", () => {
    render(<RubricForm />);

    fireEvent.change(screen.getByLabelText("Maximum score"), {
      target: { value: "" },
    });
    expect(screen.getByLabelText("Maximum score")).toHaveProperty("value", "");

    fireEvent.change(screen.getByLabelText("Maximum score"), {
      target: { value: "40" },
    });

    expect(screen.getByLabelText("Maximum score")).toHaveProperty("value", "40");
    expect(screen.getByLabelText("Excellent maximum score").textContent).toBe("40");
    expect(screen.getByLabelText("Good maximum score").textContent).toBe("32");
    expect(screen.getByLabelText("Good minimum score")).toHaveProperty("value", "25");
  });
});
