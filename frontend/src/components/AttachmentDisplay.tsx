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
  const [downloadLoadingName, setDownloadLoadingName] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    return () => {
      if (selectedPdf?.startsWith("blob:")) {
        URL.revokeObjectURL(selectedPdf);
      }
      if (selectedImage?.url.startsWith("blob:")) {
        URL.revokeObjectURL(selectedImage.url);
      }
    };
  }, [selectedImage, selectedPdf]);

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

  const handleOpenPdf = async (attachment: Attachment) => {
    const url = getInlineUrl(attachment);
    if (!url) return;

    setImageLoadingName(attachment.file_name);
    setPreviewError("");
    try {
      const response = await apiFetch(url);
      if (!response.ok) throw new Error("The PDF could not be loaded.");
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      setSelectedPdf(blobUrl);
      setSelectedPdfName(attachment.file_name);
      setSelectedPdfDownload(blobUrl);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "The PDF could not be loaded.");
    } finally {
      setImageLoadingName(null);
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
      const response = await apiFetch(url);
      if (!response.ok) {
        throw new Error("The image could not be loaded.");
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

  const handleDownload = async (attachment: Attachment) => {
    const url = getAttachmentUrl(attachment);
    if (!url) return;

    setDownloadLoadingName(attachment.file_name);
    setPreviewError("");
    try {
      const response = await apiFetch(url);
      if (!response.ok) throw new Error("The file could not be downloaded.");
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = attachment.file_name;
      link.click();
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "The file could not be downloaded.");
    } finally {
      setDownloadLoadingName(null);
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
              if (selectedPdf.startsWith("blob:")) URL.revokeObjectURL(selectedPdf);
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
                  className="flex min-w-0 flex-col gap-3 rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {isPdfFile ? (
                      <FileText className="text-red-500 flex-shrink-0" size={20} />
                    ) : (
                      <File className="text-blue-500 flex-shrink-0" size={20} />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium" title={attachment.file_name}>
                        {attachment.file_name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatFileSize(attachment.file_size)}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2 sm:ml-2 sm:justify-end">
                    {(isPdfFile || isImageFile) && url && (
                      <button
                        onClick={() =>
                          isPdfFile
                            ? handleOpenPdf(attachment)
                            : handleOpenImage(attachment)
                        }
                        disabled={imageLoadingName === attachment.file_name}
                        className="px-4 py-2 text-sm border rounded-lg cursor-pointer"
                      >
                        {imageLoadingName === attachment.file_name ? "Loading..." : "View"}
                      </button>
                    )}
                    {url && (
                      <button
                        type="button"
                        onClick={() => handleDownload(attachment)}
                        disabled={downloadLoadingName === attachment.file_name}
                        className="flex items-center gap-1.5 rounded-lg border border-black bg-[#7ABA78] px-2 py-2 text-sm cursor-pointer"
                      >
                        <Download size={14} />
                        {downloadLoadingName === attachment.file_name ? "Downloading..." : "Download"}
                      </button>
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
