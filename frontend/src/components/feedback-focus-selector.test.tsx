// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FeedbackFocusSelector from "./feedback-focus-selector";

describe("FeedbackFocusSelector", () => {
  afterEach(cleanup);

  it("renders all strength and improvement options", () => {
    render(<FeedbackFocusSelector selectedCodes={[]} onChange={vi.fn()} />);

    expect(screen.getByText("Feedback Focus Points")).toBeTruthy();
    expect(screen.getByText("Strengths")).toBeTruthy();
    expect(screen.getByText("Areas for Improvement")).toBeTruthy();

    expect(screen.getByTestId("focus-chip-structure")).toBeTruthy();
    expect(screen.getByTestId("focus-chip-evidence")).toBeTruthy();
    expect(screen.getByTestId("focus-chip-analysis")).toBeTruthy();
    expect(screen.getByTestId("focus-chip-deepen_analysis")).toBeTruthy();
    expect(screen.getByTestId("focus-chip-citations")).toBeTruthy();
    expect(screen.getByTestId("focus-chip-clarity")).toBeTruthy();
  });

  it("selects a focus point when clicked", () => {
    const onChange = vi.fn();
    render(<FeedbackFocusSelector selectedCodes={[]} onChange={onChange} />);

    const chip = screen.getByTestId("focus-chip-structure");
    fireEvent.click(chip);

    expect(onChange).toHaveBeenCalledWith(["STRUCTURE"]);
  });

  it("deselects an already selected focus point", () => {
    const onChange = vi.fn();
    render(<FeedbackFocusSelector selectedCodes={["STRUCTURE", "CLARITY"]} onChange={onChange} />);

    const chip = screen.getByTestId("focus-chip-structure");
    fireEvent.click(chip);

    expect(onChange).toHaveBeenCalledWith(["CLARITY"]);
  });

  it("enforces a maximum of 2 strengths", () => {
    const onChange = vi.fn();
    render(
      <FeedbackFocusSelector
        selectedCodes={["STRUCTURE", "EVIDENCE"]}
        onChange={onChange}
      />
    );

    const thirdStrength = screen.getByTestId("focus-chip-analysis") as HTMLButtonElement;
    expect(thirdStrength.disabled).toBe(true);

    fireEvent.click(thirdStrength);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("enforces a maximum of 2 improvement areas", () => {
    const onChange = vi.fn();
    render(
      <FeedbackFocusSelector
        selectedCodes={["DEEPEN_ANALYSIS", "CITATIONS"]}
        onChange={onChange}
      />
    );

    const thirdImprovement = screen.getByTestId("focus-chip-clarity") as HTMLButtonElement;
    expect(thirdImprovement.disabled).toBe(true);

    fireEvent.click(thirdImprovement);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("allows selecting improvements when strengths are at max", () => {
    const onChange = vi.fn();
    render(
      <FeedbackFocusSelector
        selectedCodes={["STRUCTURE", "EVIDENCE"]}
        onChange={onChange}
      />
    );

    const improvementChip = screen.getByTestId("focus-chip-deepen_analysis") as HTMLButtonElement;
    expect(improvementChip.disabled).toBe(false);

    fireEvent.click(improvementChip);
    expect(onChange).toHaveBeenCalledWith(["STRUCTURE", "EVIDENCE", "DEEPEN_ANALYSIS"]);
  });

  it("clears all selected focus points when Clear is clicked", () => {
    const onChange = vi.fn();
    render(
      <FeedbackFocusSelector
        selectedCodes={["STRUCTURE", "DEEPEN_ANALYSIS"]}
        onChange={onChange}
      />
    );

    const clearButton = screen.getByTestId("clear-focus-points");
    fireEvent.click(clearButton);

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("disables all chips when disabled prop is true", () => {
    const onChange = vi.fn();
    render(
      <FeedbackFocusSelector
        selectedCodes={["STRUCTURE"]}
        onChange={onChange}
        disabled={true}
      />
    );

    const chip = screen.getByTestId("focus-chip-structure") as HTMLButtonElement;
    expect(chip.disabled).toBe(true);

    fireEvent.click(chip);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId("clear-focus-points")).toBeNull();
  });
});
