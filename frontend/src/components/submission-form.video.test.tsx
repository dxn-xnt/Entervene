// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SubmissionForm from "./submission-form";
import { LOCAL_VIDEO_PREVIEW_UNAVAILABLE_MESSAGE } from "./video-file-preview";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SubmissionForm video upload UX, cancellation, and retry", () => {
  it("retains selected files and links when submission rejects, then permits retry", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error("Upload interrupted"))
      .mockResolvedValueOnce(undefined);
    const { container } = render(<SubmissionForm assignmentId={12} onSubmit={onSubmit} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const upload = new File(["%PDF-1.7"], "retry.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [upload] } });

    fireEvent.click(screen.getByRole("button", { name: /submit link/i }));
    fireEvent.change(screen.getByPlaceholderText("https://example.com/my-work"), {
      target: { value: "https://example.com/retry" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit assignment/i }));

    expect(await screen.findByText("Upload interrupted")).toBeTruthy();
    expect(screen.getByText("retry.pdf")).toBeTruthy();
    expect(screen.getByDisplayValue("https://example.com/retry")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /submit assignment/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("retry.pdf")).toBeNull());
  });

  it("shows upload progress, switches to server processing state at 100%, and blocks duplicate submits", async () => {
    let reportProgress: ((percent: number) => void) | undefined;
    let resolveSubmit: (() => void) | undefined;
    const onSubmit = vi.fn(
      (_files: File[], _links: unknown[], onProgress?: (percent: number) => void) =>
        new Promise<void>((resolve) => {
          reportProgress = onProgress;
          resolveSubmit = resolve;
        }),
    );

    const { container } = render(<SubmissionForm assignmentId={15} onSubmit={onSubmit} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const video = new File(["\x00\x00\x00\x18ftypmp42"], "demo.mp4", { type: "video/mp4" });
    fireEvent.change(input, { target: { files: [video] } });

    const submitBtn = screen.getByRole("button", { name: /submit assignment/i });
    fireEvent.click(submitBtn);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    act(() => {
      reportProgress?.(45);
    });
    expect(screen.getByText("Uploading... 45%")).toBeTruthy();
    expect((screen.getByRole("button", { name: /uploading\.\.\./i }) as HTMLButtonElement).disabled).toBe(true);

    // Duplicate click while in flight must not invoke onSubmit again.
    fireEvent.click(screen.getByRole("button", { name: /uploading\.\.\./i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    act(() => {
      reportProgress?.(100);
    });
    expect(screen.getByText("Processing upload on server...")).toBeTruthy();
    expect((screen.getByRole("button", { name: /processing\.\.\./i }) as HTMLButtonElement).disabled).toBe(true);

    act(() => {
      resolveSubmit?.();
    });
    await waitFor(() => expect(screen.queryByText("demo.mp4")).toBeNull());
  });

  it("cancels an active upload via AbortSignal, retains files and links, and allows retry", async () => {
    const onSubmit = vi.fn(
      (_files: File[], _links: unknown[], _onProgress?: (percent: number) => void, signal?: AbortSignal) => {
        if (onSubmit.mock.calls.length === 1) {
          return new Promise<void>((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(new DOMException("Upload cancelled.", "AbortError"));
            });
          });
        }
        return Promise.resolve();
      },
    );

    const { container } = render(<SubmissionForm assignmentId={16} onSubmit={onSubmit} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const video = new File(["\x00\x00\x00\x18ftypmp42"], "cancel-test.mp4", { type: "video/mp4" });
    fireEvent.change(input, { target: { files: [video] } });

    fireEvent.click(screen.getByRole("button", { name: /submit assignment/i }));
    const cancelBtn = await screen.findByRole("button", { name: /cancel upload/i });
    fireEvent.click(cancelBtn);

    expect(await screen.findByText(/Upload cancelled\./i)).toBeTruthy();
    expect(screen.getByText("cancel-test.mp4")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /submit assignment/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("cancel-test.mp4")).toBeNull());
  });

  it("reconciles server state after cancellation when the server already persisted the submission", async () => {
    const onReconcileAfterCancel = vi.fn().mockResolvedValue(true);
    const onSubmit = vi.fn(
      (_files: File[], _links: unknown[], _onProgress?: (percent: number) => void, signal?: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Upload cancelled.", "AbortError"));
          });
        }),
    );

    const { container } = render(
      <SubmissionForm
        assignmentId={17}
        onSubmit={onSubmit}
        onReconcileAfterCancel={onReconcileAfterCancel}
      />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const video = new File(["\x00\x00\x00\x18ftypmp42"], "race.mp4", { type: "video/mp4" });
    fireEvent.change(input, { target: { files: [video] } });

    fireEvent.click(screen.getByRole("button", { name: /submit assignment/i }));
    fireEvent.click(await screen.findByRole("button", { name: /cancel upload/i }));

    await waitFor(() => expect(onReconcileAfterCancel).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText("Your submission had already finished saving on the server."),
    ).toBeTruthy();
    expect(screen.queryByText("race.mp4")).toBeNull();
  });

  it("handles local video preview errors without rejecting the file and revokes object URLs on close", async () => {
    const createUrlSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:student-video-1");
    const revokeUrlSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const { container } = render(<SubmissionForm assignmentId={18} onSubmit={vi.fn()} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const video = new File(["\x00\x00\x00\x18ftypqt  "], "codec-unsupported.mov", {
      type: "video/quicktime",
    });
    fireEvent.change(input, { target: { files: [video] } });

    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    const videoEl = await waitFor(() => {
      const el = document.querySelector("video");
      expect(el).toBeTruthy();
      return el as HTMLVideoElement;
    });
    expect(createUrlSpy).toHaveBeenCalledWith(video);
    expect(videoEl.hasAttribute("autoplay")).toBe(false);
    expect(videoEl.getAttribute("preload")).toBe("metadata");

    fireEvent.error(videoEl);
    expect(await screen.findByText(LOCAL_VIDEO_PREVIEW_UNAVAILABLE_MESSAGE)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /close preview/i }));
    await waitFor(() => expect(revokeUrlSpy).toHaveBeenCalledWith("blob:student-video-1"));
    // File remains selected and ready for upload.
    expect(screen.getByText("codec-unsupported.mov")).toBeTruthy();
  });
});
