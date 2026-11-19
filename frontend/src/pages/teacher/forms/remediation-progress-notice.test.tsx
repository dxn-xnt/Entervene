// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemediationProgressNotice } from "./remediation-progress-notice";

afterEach(cleanup);

describe("RemediationProgressNotice", () => {
  it("shows the add-another action only in the eligible state", () => {
    const onAdd = vi.fn();
    const { rerender } = render(
      <RemediationProgressNotice state="CAN_ADD_ANOTHER" onAddAnother={onAdd} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add Another Remediation Activity" }));
    expect(onAdd).toHaveBeenCalledOnce();

    rerender(<RemediationProgressNotice state="NEEDS_GRADING" onAddAnother={onAdd} />);
    expect(screen.getByText("Grade the activity to evaluate the result.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Add Another Remediation Activity" })).toBeNull();
  });

  it("explains when no positive unused target remains", () => {
    render(<RemediationProgressNotice state="NO_ELIGIBLE_TARGET" onAddAnother={vi.fn()} />);
    expect(screen.getByText("No unused eligible classwork has a positive possible improvement.")).toBeDefined();
  });
});
