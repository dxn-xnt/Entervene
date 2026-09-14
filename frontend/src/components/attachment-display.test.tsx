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
});
