// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SubmissionForm from "@/components/submission-form";

describe("SubmissionForm local previews", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:local-preview"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([
    ["sample.png", "image/png", "img"],
    ["sample.pdf", "application/pdf", "iframe"],
  ])("previews %s locally without submitting", async (name, type, element) => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<SubmissionForm assignmentId={1} onSubmit={onSubmit} />);
    const input = container.querySelector("#file-input") as HTMLInputElement;
    const file = new File(["preview"], name, { type });

    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /view/i }));

    expect(await screen.findByText(`Preview: ${name}`)).toBeTruthy();
    expect(document.querySelector(element)?.getAttribute("src")).toBe("blob:local-preview");
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /close preview/i }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-preview"));
  });

  it("does not offer a preview for unsupported local file types", () => {
    const { container } = render(<SubmissionForm assignmentId={1} onSubmit={vi.fn()} />);
    const input = container.querySelector("#file-input") as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["notes"], "notes.txt", { type: "text/plain" })] },
    });

    expect(screen.queryByRole("button", { name: /view/i })).toBeNull();
  });
});
