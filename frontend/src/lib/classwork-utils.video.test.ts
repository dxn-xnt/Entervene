import { describe, expect, it } from "vitest";
import {
  attachmentAggregateSizeError,
  attachmentCountError,
  attachmentFileSizeLimit,
  hasSubmissionAdvanced,
  isVideoFile,
  validateAttachmentFile,
  validateAttachmentSelection,
  videoUploadLimit,
  videoUploadSizeError,
} from "./classwork-utils";

const file = (name: string, size: number, type: string) =>
  ({ name, size, type } as File);

describe("video attachment validation", () => {
  it("recognizes all supported video formats", () => {
    expect(isVideoFile(file("lesson.mp4", 1, "video/mp4"))).toBe(true);
    expect(isVideoFile(file("lesson.webm", 1, "video/webm"))).toBe(true);
    expect(isVideoFile(file("lesson.mov", 1, "video/quicktime"))).toBe(true);
  });

  it("uses a 100 MiB limit only for videos", () => {
    expect(attachmentFileSizeLimit(file("lesson.mp4", 1, "video/mp4"))).toBe(videoUploadLimit);
    expect(attachmentFileSizeLimit(file("notes.pdf", 1, "application/pdf"))).toBe(10 * 1024 * 1024);
  });

  it("uses the supported extension for size classification and validates MIME separately", () => {
    expect(isVideoFile(file("notes.pdf", 1, "video/mp4"))).toBe(false);
    expect(attachmentFileSizeLimit(file("notes.pdf", 1, "video/mp4"))).toBe(10 * 1024 * 1024);
    expect(validateAttachmentFile(file("notes.pdf", 1, "video/mp4"))).toContain("does not match");
    expect(validateAttachmentFile(file("lesson.mp4", 1, "application/pdf"))).toContain("does not match");
    expect(validateAttachmentFile(file("lesson.mp4", 1, ""))).toContain("does not match");
  });

  it("accepts exactly 100 MiB and rejects one byte more", () => {
    expect(validateAttachmentFile(file("lesson.mp4", videoUploadLimit, "video/mp4"))).toBeNull();
    expect(validateAttachmentFile(file("lesson.mp4", videoUploadLimit + 1, "video/mp4"))).toBe(videoUploadSizeError);
  });

  it("rejects empty and unsupported files", () => {
    expect(validateAttachmentFile(file("empty.webm", 0, "video/webm"))).toContain("empty");
    expect(validateAttachmentFile(file("program.exe", 1, "application/octet-stream"))).toContain("not supported");
  });

  it("enforces ten files and a 200 MiB aggregate", () => {
    const tenFiles = Array.from({ length: 10 }, (_, index) => file(`clip-${index}.mp4`, 1, "video/mp4"));
    expect(validateAttachmentSelection(tenFiles)).toBeNull();
    expect(validateAttachmentSelection([...tenFiles, file("extra.pdf", 1, "application/pdf")])).toBe(attachmentCountError);
    expect(validateAttachmentSelection([file("clip.mp4", videoUploadLimit, "video/mp4")], 1, videoUploadLimit)).toBeNull();
    expect(validateAttachmentSelection([file("clip.mp4", videoUploadLimit, "video/mp4")], 1, videoUploadLimit + 1)).toBe(attachmentAggregateSizeError);
  });

  it("does not mistake a pre-existing graded or submitted submission for a newly persisted cancelled upload", () => {
    const attempt1 = {
      submission_id: 10,
      status: "graded",
      attempt_count: 1,
      submitted_at: "2026-11-28T10:00:00Z",
      attachments: [{ submission_attachment_id: 101 }],
      links: [],
    };
    // Same pre-existing attempt returned after cancelling attempt 2 -> NOT advanced.
    expect(hasSubmissionAdvanced(attempt1, { ...attempt1 })).toBe(false);
    // Pending draft returned -> NOT advanced.
    expect(hasSubmissionAdvanced(null, { submission_id: 10, status: "pending", attempt_count: 0 })).toBe(false);
    // First submission actually persisted -> advanced.
    expect(hasSubmissionAdvanced(null, { submission_id: 10, status: "submitted", attempt_count: 1 })).toBe(true);
    // New remediation attempt row persisted -> advanced.
    expect(
      hasSubmissionAdvanced(attempt1, {
        submission_id: 11,
        status: "submitted",
        attempt_count: 2,
        submitted_at: "2026-11-28T10:05:00Z",
        attachments: [{ submission_attachment_id: 102 }],
        links: [],
      }),
    ).toBe(true);
    // New attachment added to existing submission -> advanced.
    expect(
      hasSubmissionAdvanced(attempt1, {
        ...attempt1,
        attachments: [{ submission_attachment_id: 101 }, { submission_attachment_id: 103 }],
      }),
    ).toBe(true);
  });
});
