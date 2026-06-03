import { useState } from "react";
import { Download, FileText, File } from "lucide-react";
import PDFViewer from "./PDFViewer";

interface Attachment {
  classwork_attachment_id?: number;
  lesson_attachment_id?: number;
  submission_attachment_id?: number;
  file_name: string;
  file_type?: string;
  file_size: number;
  file_path?: string;
}

interface AttachmentDisplayProps {
  attachments: Attachment[];
  downloadUrl?: (attachmentId: number) => string;
  type?: "classwork" | "lesson" | "submission";
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

export default function AttachmentDisplay({
  attachments,
  downloadUrl,
  type = "classwork",
}: AttachmentDisplayProps) {
  const [selectedPdf, setSelectedPdf] = useState<string | null>(null);
  const [selectedPdfName, setSelectedPdfName] = useState<string>("");

  if (!attachments || attachments.length === 0) {
    return (
      <div className="text-center py-4 text-gray-500">
        No attachments available
      </div>
    );
  }

  const isPdf = (fileName: string): boolean => {
    return fileName.toLowerCase().endsWith(".pdf");
  };

  const getAttachmentUrl = (attachment: Attachment): string => {
    if (attachment.file_path) {
      return attachment.file_path;
    }
    if (downloadUrl && attachment[`${type}_attachment_id`]) {
      return downloadUrl(attachment[`${type}_attachment_id`] as number);
    }
    return "";
  };

  const handleOpenPdf = (attachment: Attachment) => {
    const url = getAttachmentUrl(attachment);
    if (url) {
      setSelectedPdf(url);
      setSelectedPdfName(attachment.file_name);
    }
  };

  return (
    <div className="space-y-3">
      {selectedPdf && (
        <div className="mb-4">
          <PDFViewer
            pdfUrl={selectedPdf}
            fileName={selectedPdfName}
            onClose={() => setSelectedPdf(null)}
          />
        </div>
      )}

      {!selectedPdf && (
        <div className="space-y-2">
          <h3 className="font-semibold text-sm text-gray-700">
            Attachments ({attachments.length})
          </h3>
          <div className="grid gap-2">
            {attachments.map((attachment, idx) => {
              const isPdfFile = isPdf(attachment.file_name);
              const url = getAttachmentUrl(attachment);

              return (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {isPdfFile ? (
                      <FileText className="text-red-500 flex-shrink-0" size={20} />
                    ) : (
                      <File className="text-blue-500 flex-shrink-0" size={20} />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        {attachment.file_name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatFileSize(attachment.file_size)}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2 ml-2">
                    {isPdfFile && url && (
                      <button
                        onClick={() => handleOpenPdf(attachment)}
                        className="px-3 py-1 text-sm bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 transition-colors"
                      >
                        View
                      </button>
                    )}
                    {url && (
                      <a
                        href={url}
                        download={attachment.file_name}
                        className="px-3 py-1 text-sm bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 transition-colors flex items-center gap-1"
                      >
                        <Download size={14} />
                        Download
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
