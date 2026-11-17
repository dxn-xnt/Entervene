// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClassworkSettingRow } from "./classwork-setting-row";

describe("ClassworkSettingRow", () => {
  afterEach(cleanup);

  it("renders label, switch, and handles toggle", () => {
    const onCheckedChange = vi.fn();
    render(
      <ClassworkSettingRow
        label="Show scores to students"
        tooltip="Scores will be visible once graded."
        checked={false}
        onCheckedChange={onCheckedChange}
      />
    );

    expect(screen.getByText("Show scores to students")).toBeTruthy();
    const toggle = screen.getByRole("switch", { name: "Show scores to students" });
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("clicking the label toggles the associated switch via id", () => {
    const onCheckedChange = vi.fn();
    render(
      <ClassworkSettingRow
        id="test-score-setting"
        label="Show scores to students"
        checked={true}
        onCheckedChange={onCheckedChange}
      />
    );

    const label = screen.getByText("Show scores to students");
    fireEvent.click(label);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it("renders info button with accessible aria-label and reveals tooltip on click", () => {
    render(
      <ClassworkSettingRow
        label="Automatic AI Feedback"
        tooltip="Prepares contextual AI feedback draft for teacher review."
        checked={true}
        onCheckedChange={vi.fn()}
      />
    );

    const infoButton = screen.getByRole("button", { name: "Automatic AI Feedback information" });
    expect(infoButton).toBeTruthy();

    fireEvent.click(infoButton);
    expect(screen.getByText("Prepares contextual AI feedback draft for teacher review.")).toBeTruthy();
  });

  it("does not render info button when tooltip is not provided", () => {
    render(
      <ClassworkSettingRow
        label="Allow late submissions"
        checked={false}
        onCheckedChange={vi.fn()}
      />
    );

    expect(screen.getByText("Allow late submissions")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Allow late submissions information" })).toBeNull();
  });

  it("respects disabled state on switch", () => {
    const onCheckedChange = vi.fn();
    render(
      <ClassworkSettingRow
        label="Show scores to students"
        checked={false}
        onCheckedChange={onCheckedChange}
        disabled={true}
      />
    );

    const toggle = screen.getByRole("switch", { name: "Show scores to students" });
    expect(toggle.getAttribute("disabled")).not.toBeNull();
  });
});
