import { useEffect, useState } from "react";
import { Download, FileText, File, X } from "lucide-react";
import PDFViewer from "./PDFViewer";
import { apiFetch } from "@/lib/api";

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
  const [selectedPdfDownload, setSelectedPdfDownload] = useState<string>("");
  const [selectedImage, setSelectedImage] = useState<{ url: string; name: string } | null>(null);
  const [imageLoadingName, setImageLoadingName] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    return () => {
      if (selectedImage?.url.startsWith("blob:")) {
        URL.revokeObjectURL(selectedImage.url);
      }
    };
  }, [selectedImage]);

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

  const isImage = (attachment: Attachment): boolean => {
    return Boolean(
      attachment.file_type?.startsWith("image/") ||
      /\.(jpe?g|png)$/i.test(attachment.file_name)
    );
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

  const getInlineUrl = (attachment: Attachment): string => {
    const url = getAttachmentUrl(attachment);
    if (!url) return "";
    return `${url}${url.includes("?") ? "&" : "?"}inline=true`;
  };

  const handleOpenPdf = (attachment: Attachment) => {
    const url = getInlineUrl(attachment);
    if (url) {
      setSelectedPdf(url);
      setSelectedPdfName(attachment.file_name);
      setSelectedPdfDownload(getAttachmentUrl(attachment));
    }
  };

  const closeImagePreview = () => {
    if (selectedImage?.url.startsWith("blob:")) {
      URL.revokeObjectURL(selectedImage.url);
    }
    setSelectedImage(null);
  };

  const handleOpenImage = async (attachment: Attachment) => {
    const url = getInlineUrl(attachment);
    if (!url) return;

    setImageLoadingName(attachment.file_name);
    setPreviewError("");

    try {
      let response = await fetch(url, { credentials: "include" });
      if (response.status === 401) {
        const refreshResponse = await apiFetch("/api/v1/auth/refresh", { method: "POST" });
        if (refreshResponse.ok) {
          response = await fetch(url, { credentials: "include" });
        }
      }
      if (!response.ok) {
        throw new Error(
          response.status === 401
            ? "Your session was not accepted for this preview. Restart the backend, then sign in again."
            : "The image could not be loaded."
        );
      }

      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) {
        throw new Error("The uploaded file is not a valid image.");
      }

      setSelectedImage({
        url: URL.createObjectURL(blob),
        name: attachment.file_name,
      });
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "The image could not be loaded.");
    } finally {
      setImageLoadingName(null);
    }
  };

  return (
    <div className="space-y-3">
      {selectedPdf && (
        <div className="mb-4">
          <PDFViewer
            pdfUrl={selectedPdf}
            downloadUrl={selectedPdfDownload}
            fileName={selectedPdfName}
            onClose={() => {
              setSelectedPdf(null);
              setSelectedPdfDownload("");
            }}
          />
        </div>
      )}

      {selectedImage && (
        <div className="mb-4 overflow-hidden rounded-lg border border-gray-300 bg-gray-100">
          <div className="flex items-center justify-between bg-gray-800 px-4 py-3 text-white">
            <p className="truncate font-medium">{selectedImage.name}</p>
            <button
              type="button"
              onClick={closeImagePreview}
              className="rounded p-2 hover:bg-gray-700"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>
          <div className="flex max-h-[70vh] items-center justify-center overflow-auto p-4">
            <img src={selectedImage.url} alt={selectedImage.name} className="max-h-[65vh] max-w-full object-contain" />
          </div>
        </div>
      )}

      {!selectedPdf && !selectedImage && (
        <div className="space-y-2">
          {previewError && (
            <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {previewError}
            </div>
          )}
          <h3 className="font-semibold text-sm text-gray-700">
            Attachments ({attachments.length})
          </h3>
          <div className="grid gap-2">
            {attachments.map((attachment, idx) => {
              const isPdfFile = isPdf(attachment.file_name);
              const isImageFile = isImage(attachment);
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
                    {(isPdfFile || isImageFile) && url && (
                      <button
                        onClick={() =>
                          isPdfFile
                            ? handleOpenPdf(attachment)
                            : handleOpenImage(attachment)
                        }
                        disabled={imageLoadingName === attachment.file_name}
                        className="px-3 py-1 text-sm bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 transition-colors"
                      >
                        {imageLoadingName === attachment.file_name ? "Loading..." : "View"}
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
