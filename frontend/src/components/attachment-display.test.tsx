import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AttachmentDisplay from "./attachment-display";

describe("AttachmentDisplay View Trigger", () => {
  it("renders a native <a> anchor for classwork PDF attachments with inline=true", () => {
    const html = renderToStaticMarkup(
      <AttachmentDisplay
        type="classwork"
        attachments={[
          {
            classwork_attachment_id: 101,
            file_name: "lecture1.pdf",
            file_type: "application/pdf",
            file_size: 1024,
          },
        ]}
        downloadUrl={(id) => `http://localhost:8000/api/v1/classwork-assignments/classwork/1/attachments/${id}/download`}
      />,
    );

    expect(html).toContain('href="http://localhost:8000/api/v1/classwork-assignments/classwork/1/attachments/101/download?inline=true"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("View");
  });

  it("renders a native <a> anchor for submission image attachments with inline=true", () => {
    const html = renderToStaticMarkup(
      <AttachmentDisplay
        type="submission"
        attachments={[
          {
            submission_attachment_id: 202,
            file_name: "diagram.png",
            file_type: "image/png",
            file_size: 2048,
          },
        ]}
        downloadUrl={(id) => `http://localhost:8000/api/v1/submissions/5/attachments/${id}/download`}
      />,
    );

    expect(html).toContain('href="http://localhost:8000/api/v1/submissions/5/attachments/202/download?inline=true"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("View");
  });

  it("resolves relative URLs to absolute using API_URL for direct browser navigation", () => {
    const html = renderToStaticMarkup(
      <AttachmentDisplay
        type="classwork"
        attachments={[
          {
            classwork_attachment_id: 303,
            file_name: "document.pdf",
            file_type: "application/pdf",
            file_size: 4096,
          },
        ]}
        downloadUrl={(id) => `/api/v1/classwork-assignments/classwork/2/attachments/${id}/download`}
      />,
    );

    expect(html).toMatch(/href="https?:\/\/[^/]+\/api\/v1\/classwork-assignments\/classwork\/2\/attachments\/303\/download\?inline=true"/);
  });

  it("offers the shared viewer for Word and PPTX, while restricting legacy .ppt to download-only", () => {
    const html = renderToStaticMarkup(
      <AttachmentDisplay
        attachments={[
          { classwork_attachment_id: 401, file_name: "notes.docx", file_size: 1024 },
          { classwork_attachment_id: 402, file_name: "slides.ppt", file_size: 2048 },
          { classwork_attachment_id: 403, file_name: "slides.pptx", file_size: 4096 },
        ]}
        downloadUrl={(id) => `/api/v1/classwork-assignments/classwork/4/attachments/${id}/download`}
      />,
    );

    expect(html.match(/>View</g)).toHaveLength(2);
    expect(html).toContain("notes.docx");
    expect(html).toContain("slides.pptx");
  });

  it("uses the bare download URL (not ?inline=true) as the new-tab href for PPTX attachments", () => {
    // PPTX has no standalone renderable URL — the viewer works via ArrayBuffer postMessage.
    // Modified-clicks (Ctrl+click) should download the file, not navigate to a broken inline URL.
    const html = renderToStaticMarkup(
      <AttachmentDisplay
        type="classwork"
        attachments={[
          {
            classwork_attachment_id: 501,
            file_name: "slides.pptx",
            file_size: 8192,
          },
        ]}
        downloadUrl={(id) => `http://localhost:8000/api/v1/classwork-assignments/classwork/5/attachments/${id}/download`}
      />,
    );

    // Must contain the plain download URL as the href — no ?inline=true suffix
    expect(html).toContain(
      'href="http://localhost:8000/api/v1/classwork-assignments/classwork/5/attachments/501/download"'
    );
    // Must NOT contain the inline variant for PPTX
    expect(html).not.toContain(
      'href="http://localhost:8000/api/v1/classwork-assignments/classwork/5/attachments/501/download?inline=true"'
    );
    // View button is still present
    expect(html).toContain("View");
  });

  it("uses ?inline=true as the new-tab href for PDF attachments (not affected by PPTX change)", () => {
    // Confirms the PPTX href fix is narrowly scoped and does not bleed into PDF behavior.
    const html = renderToStaticMarkup(
      <AttachmentDisplay
        type="classwork"
        attachments={[
          {
            classwork_attachment_id: 601,
            file_name: "report.pdf",
            file_type: "application/pdf",
            file_size: 4096,
          },
        ]}
        downloadUrl={(id) => `http://localhost:8000/api/v1/classwork-assignments/classwork/6/attachments/${id}/download`}
      />,
    );

    expect(html).toContain(
      'href="http://localhost:8000/api/v1/classwork-assignments/classwork/6/attachments/601/download?inline=true"'
    );
  });
});
