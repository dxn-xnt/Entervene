import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, File, Play, X, Image as ImageIcon, Video } from "lucide-react";
import DocumentViewer, { type PreviewDocumentKind } from "./document-viewer";
import { API_URL, apiFetch } from "@/lib/api";
import { Alert } from "@/components/retroui/Alert";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "./retroui/Card";
import { IconContainer } from "@/components/icon-container";
import { Dialog } from "@/components/retroui/Dialog";
import { Text } from "@/components/retroui/Text";

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
  action?: React.ReactNode | ((attachment: Attachment, index: number) => React.ReactNode);
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
  action,
}: AttachmentDisplayProps) {
  const [selectedDocument, setSelectedDocument] = useState<{
    blob: Blob;
    url: string;
    name: string;
    kind: PreviewDocumentKind;
  } | null>(null);
  const [selectedImage, setSelectedImage] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<{
    url: string;
    name: string;
    attachment: Attachment;
  } | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoPlaybackError, setVideoPlaybackError] = useState(false);
  const [imageLoadingName, setImageLoadingName] = useState<string | null>(null);
  const [downloadLoadingName, setDownloadLoadingName] = useState<string | null>(
    null,
  );
  const [previewError, setPreviewError] = useState("");

  const closeImagePreview = useCallback(() => {
    setSelectedImage((current) => {
      if (current?.url.startsWith("blob:")) URL.revokeObjectURL(current.url);
      return null;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (selectedDocument?.url.startsWith("blob:")) {
        URL.revokeObjectURL(selectedDocument.url);
      }
    };
  }, [selectedDocument]);

  useEffect(() => {
    return () => {
      if (selectedImage?.url.startsWith("blob:")) {
        URL.revokeObjectURL(selectedImage.url);
      }
    };
  }, [selectedImage]);

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
  }, [selectedImage, closeImagePreview]);

  if (!attachments || attachments.length === 0) {
    return (
      <div className="text-center py-4 text-gray-500">
        No attachments available
      </div>
    );
  }

  const getDocumentKind = (fileName: string): PreviewDocumentKind | null => {
    const match = fileName.toLowerCase().match(/\.(pdf|docx|pptx)$/);
    return (match?.[1] as PreviewDocumentKind | undefined) ?? null;
  };

  const isImage = (attachment: Attachment): boolean => {
    return Boolean(
      attachment.file_type?.startsWith("image/") ||
      /\.(jpe?g|png)$/i.test(attachment.file_name),
    );
  };

  const isVideo = (attachment: Attachment): boolean =>
    Boolean(attachment.file_type?.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(attachment.file_name));

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

  const handleOpenDocument = async (attachment: Attachment, kind: PreviewDocumentKind) => {
    const url = getInlineUrl(attachment);
    if (!url) return;

    setImageLoadingName(attachment.file_name);
    setPreviewError("");
    try {
      const response = await apiFetch(url);
      if (!response.ok) throw new Error("The document could not be loaded.");
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      setSelectedDocument({ blob, url: blobUrl, name: attachment.file_name, kind });
    } catch (error) {
      setPreviewError(
        error instanceof Error ? error.message : "The document could not be loaded.",
      );
    } finally {
      setImageLoadingName(null);
    }
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
      if (isVideo(attachment)) {
        // Verify authorization and refresh the HttpOnly access cookie with a 1-byte range request,
        // then let the browser stream the full video directly to disk without JS memory buffering.
        const probe = await apiFetch(url, { headers: { Range: "bytes=0-0" } });
        if (!probe.ok && probe.status !== 206) {
          throw new Error("The video could not be downloaded.");
        }
        const link = document.createElement("a");
        link.href = resolveAbsoluteUrl(url);
        link.download = attachment.file_name;
        link.rel = "noopener noreferrer";
        document.body.appendChild(link);
        link.click();
        link.remove();
        return;
      }

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

  const openVideoPreview = (attachment: Attachment) => {
    const url = getInlineUrl(attachment);
    if (!url) return;
    setPreviewError("");
    setVideoLoading(true);
    setVideoPlaybackError(false);
    setSelectedVideo({ url, name: attachment.file_name, attachment });
  };

  const closeVideoPreview = () => {
    setSelectedVideo(null);
    setVideoLoading(false);
    setVideoPlaybackError(false);
  };

  return (
    <div className="space-y-3">
      {selectedDocument && (
        <DocumentViewer
          blob={selectedDocument.blob}
          objectUrl={selectedDocument.url}
          fileName={selectedDocument.name}
          kind={selectedDocument.kind}
          onClose={() => {
            URL.revokeObjectURL(selectedDocument.url);
            setSelectedDocument(null);
          }}
        />
      )}

      <Dialog open={selectedVideo !== null} onOpenChange={(open) => { if (!open) closeVideoPreview(); }}>
        {selectedVideo && (
          <Dialog.Content size="4xl">
            <Dialog.Header position="static">
              <Text as="h5" className="truncate font-sans text-xl font-bold" title={selectedVideo.name}>
                Preview: {selectedVideo.name}
              </Text>
            </Dialog.Header>
            <div className="min-h-0 flex-1 overflow-auto bg-neutral-950 p-4 sm:p-6">
              {videoPlaybackError ? (
                <div className="mx-auto flex max-w-lg flex-col items-center justify-center gap-4 rounded border-2 border-border bg-card p-6 text-center text-foreground">
                  <Alert status="error" className="w-full text-left">
                    <Alert.Description>
                      This video cannot be played in your browser. Download the file to open it using a compatible video player.
                    </Alert.Description>
                  </Alert>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleDownload(selectedVideo.attachment)}
                    disabled={downloadLoadingName === selectedVideo.name}
                    className="gap-2"
                  >
                    <Download size={15} />
                    {downloadLoadingName === selectedVideo.name ? "Preparing download..." : "Download video"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {videoLoading && (
                    <p className="text-center text-xs text-neutral-300" role="status" aria-live="polite">
                      Loading video metadata...
                    </p>
                  )}
                  <video
                    src={selectedVideo.url}
                    controls
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={() => setVideoLoading(false)}
                    onCanPlay={() => setVideoLoading(false)}
                    onError={() => {
                      setVideoLoading(false);
                      setVideoPlaybackError(true);
                    }}
                    className="mx-auto max-h-[65dvh] max-w-full bg-black"
                  >
                    Your browser does not support video playback.
                  </video>
                </div>
              )}
            </div>
            <Dialog.Footer position="static">
              <div className="flex w-full flex-wrap items-center justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleDownload(selectedVideo.attachment)}
                  disabled={downloadLoadingName === selectedVideo.name}
                  className="gap-1.5"
                >
                  <Download size={14} />
                  {downloadLoadingName === selectedVideo.name ? "Downloading..." : "Download"}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={closeVideoPreview}>
                  Close preview
                </Button>
              </div>
            </Dialog.Footer>
          </Dialog.Content>
        )}
      </Dialog>

      {selectedImage &&
        createPortal(
          <div className="fixed inset-0 z-[10000] flex h-full w-full flex-col bg-neutral-950 text-white m-0 p-0 border-0 overflow-hidden">
            {/* Top Bar Header */}
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-900 px-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <IconContainer variant="primary" size="sm">
                  <ImageIcon />
                </IconContainer>
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
          <Alert status="error">
            <Alert.Description>{previewError}</Alert.Description>
          </Alert>
        )}
        <div className="grid gap-2 min-w-0 w-full">
          {attachments.map((attachment, idx) => {
            const documentKind = getDocumentKind(attachment.file_name);
            const isPdfFile = documentKind === "pdf";
            const isImageFile = isImage(attachment);
            const isVideoFile = isVideo(attachment);
            const url = getAttachmentUrl(attachment);

            return (
              <Card
                key={idx}
                className="flex w-full min-w-0 flex-col gap-3 p-3 shadow-none transition-colors hover:bg-retro overflow-hidden sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <IconContainer variant="primary">
                    {isVideoFile ? (
                      <Video />
                    ) : isImageFile ? (
                      <ImageIcon />
                    ) : isPdfFile ? (
                      <FileText />
                    ) : (
                      <File />
                    )}
                  </IconContainer>
                  <div className="flex-1 min-w-0">
                    <p
                      className="truncate text-sm font-medium"
                      title={attachment.file_name}
                    >
                      {attachment.file_name}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {isVideoFile && (
                        <Badge variant="outline" size="sm" className="px-1.5 py-0 text-[10px] uppercase tracking-wide">
                          Video
                        </Badge>
                      )}
                      <span>{formatFileSize(attachment.file_size)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2 sm:ml-2 sm:justify-end">
                  {(documentKind || isImageFile || isVideoFile) && url && (
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className={`gap-1.5 shadow-none h-fit ${imageLoadingName === attachment.file_name ? "pointer-events-none opacity-50" : ""}`}
                    >
                      <a
                        href={documentKind === "pptx"
                          ? resolveAbsoluteUrl(getAttachmentUrl(attachment))
                          : getInlineUrl(attachment)}
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
                            if (isVideoFile) {
                              openVideoPreview(attachment);
                            } else if (documentKind) {
                              handleOpenDocument(attachment, documentKind);
                            } else {
                              handleOpenImage(attachment);
                            }
                          }
                        }}
                      >
                        {isVideoFile ? (
                          <>
                            <Play size={13} aria-hidden="true" />
                            Preview
                          </>
                        ) : (
                          "View"
                        )}
                      </a>
                    </Button>
                  )}
                  {url && (
                    <Button
                      size="sm"
                      autoIcon={false}
                      onClick={() => handleDownload(attachment)}
                      disabled={downloadLoadingName === attachment.file_name}
                      className="gap-1.5 h-fit shadow-none"
                    >
                      {downloadLoadingName === attachment.file_name ? "Downloading..." : "Download"}
                    </Button>
                  )}
                  {action && (
                    typeof action === "function" ? action(attachment, idx) : action
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
