// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AttachmentDisplay from "./attachment-display";
import {
  LOCAL_VIDEO_PREVIEW_UNAVAILABLE_MESSAGE,
  STORED_VIDEO_PLAYBACK_ERROR_MESSAGE,
  VideoFilePreview,
} from "./video-file-preview";
import * as api from "@/lib/api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Phase 3 video preview, codec fallback, and memory-efficient download", () => {
  it("opens local VideoFilePreview, handles codec errors, and revokes object URLs on close and unmount", async () => {
    const createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:teacher-video-1");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const videoFile = new File(["\x00\x00\x00\x18ftypmp42"], "lecture-demo.mp4", {
      type: "video/mp4",
    });

    const { unmount } = render(<VideoFilePreview file={videoFile} />);
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));

    const videoEl = await waitFor(() => {
      const el = document.querySelector("video");
      expect(el).toBeTruthy();
      return el as HTMLVideoElement;
    });
    expect(createSpy).toHaveBeenCalledWith(videoFile);
    expect(videoEl.hasAttribute("autoplay")).toBe(false);
    expect(videoEl.getAttribute("preload")).toBe("metadata");

    fireEvent.error(videoEl);
    expect(await screen.findByText(LOCAL_VIDEO_PREVIEW_UNAVAILABLE_MESSAGE)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /close preview/i }));
    await waitFor(() => expect(revokeSpy).toHaveBeenCalledWith("blob:teacher-video-1"));

    // Reopen and unmount directly to ensure unmount revokes the URL too.
    createSpy.mockReturnValue("blob:teacher-video-2");
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    await waitFor(() => expect(document.querySelector("video")).toBeTruthy());
    unmount();
    expect(revokeSpy).toHaveBeenCalledWith("blob:teacher-video-2");
  });

  it("renders video and document attachments cleanly, shows stored playback fallback with download, and avoids blob buffering for videos", async () => {
    const blobSpy = vi.fn();
    const fetchSpy = vi.spyOn(api, "apiFetch").mockResolvedValue({
      ok: true,
      status: 206,
      blob: blobSpy,
    } as unknown as Response);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(
      <AttachmentDisplay
        type="classwork"
        attachments={[
          {
            classwork_attachment_id: 101,
            file_name: "very-long-science-experiment-demonstration-recording-2026.mp4",
            file_type: "video/mp4",
            file_size: 52_161_176,
          },
          {
            classwork_attachment_id: 102,
            file_name: "worksheet.pdf",
            file_type: "application/pdf",
            file_size: 120_000,
          },
        ]}
        downloadUrl={(id) => `/api/v1/classwork-assignments/classwork/5/attachments/${id}/download`}
      />,
    );

    // Video badge + full filename accessible via title attribute + document View preserved.
    expect(screen.getByText("Video")).toBeTruthy();
    const videoTitle = screen.getByTitle(
      "very-long-science-experiment-demonstration-recording-2026.mp4",
    );
    expect(videoTitle).toBeTruthy();
    expect(screen.getByText("Preview")).toBeTruthy();
    expect(screen.getByText("View")).toBeTruthy();

    // Open stored video preview and trigger media playback error -> exact fallback + download button.
    fireEvent.click(screen.getByText("Preview"));
    const videoEl = await waitFor(() => {
      const el = document.querySelector("video");
      expect(el).toBeTruthy();
      return el as HTMLVideoElement;
    });
    expect(videoEl.hasAttribute("autoplay")).toBe(false);
    expect(videoEl.getAttribute("preload")).toBe("metadata");

    fireEvent.error(videoEl);
    expect(await screen.findByText(STORED_VIDEO_PLAYBACK_ERROR_MESSAGE)).toBeTruthy();

    // Click direct download button inside fallback state -> 1-byte Range probe, no response.blob().
    fireEvent.click(screen.getByRole("button", { name: /download video/i }));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/v1/classwork-assignments/classwork/5/attachments/101/download",
        { headers: { Range: "bytes=0-0" } },
      );
    });
    expect(blobSpy).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("formats HTTP 429 Retry-After, HTTP 413, and AbortError helpers consistently", async () => {
    const rateLimited = new Response(JSON.stringify({ detail: "Busy" }), {
      status: 429,
      headers: { "Retry-After": "30" },
    });
    expect(await api.formatUploadErrorResponse(rateLimited, "Fallback")).toBe(
      "Too many uploads are in progress. Please wait 30 seconds and try again.",
    );

    const tooLarge = new Response(null, { status: 413 });
    expect(await api.formatUploadErrorResponse(tooLarge, "Fallback")).toBe(
      "The upload exceeds the maximum allowed request size.",
    );

    expect(api.isUploadCancelledError(new DOMException("Upload cancelled.", "AbortError"))).toBe(true);
    expect(api.isUploadCancelledError(new Error("Network error"))).toBe(false);
  });
});
