import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Eye, FileText, File, X, Image as ImageIcon } from "lucide-react";
import PDFViewer from "./pdf-viewer";
import { API_URL, apiFetch } from "@/lib/api";
import { Button } from "@/components/retroui/Button";
import { Card } from "./retroui/Card";

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

function isModifiedClick(e: React.MouseEvent): boolean {
  return e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.button !== 0;
}

export default function AttachmentDisplay({
  attachments,
  downloadUrl,
  type = "classwork",
}: AttachmentDisplayProps) {
  const [selectedPdf, setSelectedPdf] = useState<string | null>(null);
  const [selectedPdfName, setSelectedPdfName] = useState<string>("");
  const [selectedPdfDownload, setSelectedPdfDownload] = useState<string>("");
  const [selectedImage, setSelectedImage] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const [imageLoadingName, setImageLoadingName] = useState<string | null>(null);
  const [downloadLoadingName, setDownloadLoadingName] = useState<string | null>(
    null,
  );
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

  useEffect(() => {
    if (!selectedImage) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeImagePreview();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
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
      /\.(jpe?g|png)$/i.test(attachment.file_name),
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

  const resolveAbsoluteUrl = (url: string): string => {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    return `${API_URL}${url.startsWith("/") ? "" : "/"}${url}`;
  };

  const getInlineUrl = (attachment: Attachment): string => {
    const rawUrl = getAttachmentUrl(attachment);
    if (!rawUrl) return "";
    const url = resolveAbsoluteUrl(rawUrl);
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
      setPreviewError(
        error instanceof Error ? error.message : "The PDF could not be loaded.",
      );
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
      setPreviewError(
        error instanceof Error
          ? error.message
          : "The image could not be loaded.",
      );
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
      setPreviewError(
        error instanceof Error
          ? error.message
          : "The file could not be downloaded.",
      );
    } finally {
      setDownloadLoadingName(null);
    }
  };

  return (
    <div className="space-y-3">
      {selectedPdf && (
        <PDFViewer
          pdfUrl={selectedPdf}
          downloadUrl={selectedPdfDownload}
          fileName={selectedPdfName}
          onClose={() => {
            if (selectedPdf.startsWith("blob:"))
              URL.revokeObjectURL(selectedPdf);
            setSelectedPdf(null);
            setSelectedPdfDownload("");
          }}
        />
      )}

      {selectedImage &&
        createPortal(
          <div className="fixed inset-0 z-[10000] flex h-full w-full flex-col bg-neutral-950 text-white m-0 p-0 border-0 overflow-hidden">
            {/* Top Bar Header */}
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-900 px-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <ImageIcon className="size-5 shrink-0 text-blue-400" />
                <p
                  className="truncate text-sm font-medium text-neutral-200"
                  title={selectedImage.name}
                >
                  {selectedImage.name}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={selectedImage.url}
                  download={selectedImage.name}
                  className="rounded p-2 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white"
                  title="Download Image"
                >
                  <Download size={18} />
                </a>
                <button
                  type="button"
                  onClick={closeImagePreview}
                  className="rounded p-2 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white"
                  title="Close viewer (Esc)"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Image Viewport */}
            <div className="relative flex-1 w-full min-h-0 flex items-center justify-center p-4 overflow-hidden bg-neutral-950">
              <img
                src={selectedImage.url}
                alt={selectedImage.name}
                className="max-h-full max-w-full object-contain select-none shadow-2xl"
              />
            </div>
          </div>,
          document.body
        )}

      <div className="space-y-2">
        {previewError && (
          <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {previewError}
          </div>
        )}
        <div className="grid gap-2">
          {attachments.map((attachment, idx) => {
            const isPdfFile = isPdf(attachment.file_name);
            const isImageFile = isImage(attachment);
            const url = getAttachmentUrl(attachment);

            return (
              <Card
                key={idx}
                className="flex min-w-0 flex-col shadow-none transition-colors hover:bg-accent sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {isPdfFile ? (
                    <FileText
                      className="flex-shrink-0"
                      size={24}
                    />
                  ) : (
                    <File className="text-blue-500 flex-shrink-0" size={20} />
                  )}
                  <div className="flex-1 min-w-0">
                    <p
                      className="truncate text-sm font-medium"
                      title={attachment.file_name}
                    >
                      {attachment.file_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatFileSize(attachment.file_size)}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2 sm:ml-2 sm:justify-end">
                  {(isPdfFile || isImageFile) && url && (
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className={`shadow-none ${imageLoadingName === attachment.file_name ? "pointer-events-none opacity-50" : ""}`}
                    >
                      <a
                        href={getInlineUrl(attachment)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-disabled={imageLoadingName === attachment.file_name}
                        onClick={(e) => {
                          if (imageLoadingName === attachment.file_name) {
                            e.preventDefault();
                            return;
                          }
                          if (!isModifiedClick(e)) {
                            e.preventDefault();
                            if (isPdfFile) {
                              handleOpenPdf(attachment);
                            } else {
                              handleOpenImage(attachment);
                            }
                          }
                        }}
                      >
                        <Eye className="mr-2 size-4 shrink-0" aria-hidden="true" />
                        View
                      </a>
                    </Button>
                  )}
                  {url && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleDownload(attachment)}
                      disabled={downloadLoadingName === attachment.file_name}
                      className="gap-1.5 shadow-none"
                    >
                      <Download size={14} />
                      Download
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
