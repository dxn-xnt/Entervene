import { useEffect, useRef, useState } from "react";
import { Eye, Play, Upload, Video, X } from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { Alert } from "@/components/retroui/Alert";
import { Badge } from "@/components/retroui/Badge";
import { Input } from "@/components/retroui/Input";
import { Dialog } from "@/components/retroui/Dialog";
import { Text } from "@/components/retroui/Text";
import { LOCAL_VIDEO_PREVIEW_UNAVAILABLE_MESSAGE } from "@/components/video-file-preview";
import { isUploadCancelledError } from "@/lib/api";
import { formatFileSize, isVideoFile, validateAttachmentSelection } from "@/lib/classwork-utils";

export type SubmissionLinkDraft = { url: string; title?: string | null };

const submissionFilePreviewKind = (file: File): "image" | "pdf" | "video" | null => {
  if (isVideoFile(file)) return "video";
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "pdf";
  return null;
};

interface SubmissionFormProps {
  assignmentId: number;
  onSubmit: (
    files: File[],
    links: SubmissionLinkDraft[],
    onProgress?: (percent: number) => void,
    signal?: AbortSignal,
  ) => Promise<void>;
  onReconcileAfterCancel?: () => Promise<boolean>;
  isLoading?: boolean;
  maxAttempts?: number;
  currentAttempt?: number;
}

export default function SubmissionForm({
  onSubmit,
  onReconcileAfterCancel,
  isLoading = false,
  maxAttempts = 1,
  currentAttempt = 0,
}: SubmissionFormProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [links, setLinks] = useState<SubmissionLinkDraft[]>([]);
  const [error, setError] = useState<string>("");
  const [notice, setNotice] = useState<string>("");
  const [dragActive, setDragActive] = useState(false);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [localVideoPreviewError, setLocalVideoPreviewError] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    setLocalVideoPreviewError(false);
    if (!previewFile) {
      setPreviewUrl("");
      return;
    }
    const objectUrl = URL.createObjectURL(previewFile);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [previewFile]);

  const canSubmitMore = !maxAttempts || currentAttempt < maxAttempts;

  const validateAndSetFiles = (incomingFiles: File[]) => {
    const invalid = validateAttachmentSelection(incomingFiles);
    if (invalid) {
      setError(invalid);
      return;
    }
    setFiles(incomingFiles);
    setError("");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      validateAndSetFiles(Array.from(e.target.files));
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files) {
      validateAndSetFiles(Array.from(e.dataTransfer.files));
    }
  };

  const removeFile = (index: number) => {
    if (previewFile === files[index]) setPreviewFile(null);
    setFiles(files.filter((_, i) => i !== index));
  };

  const isUploading = uploadProgress !== null;
  const isProcessingUpload = uploadProgress !== null && uploadProgress >= 100;
  const isBusy = isLoading || isUploading;

  const cancelUpload = () => {
    abortControllerRef.current?.abort();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setError("");
    setNotice("");

    if (!canSubmitMore) {
      setError(`Maximum attempts (${maxAttempts}) reached`);
      return;
    }

    if (files.length === 0 && links.length === 0) {
      setError("Add at least one file or link to submit.");
      return;
    }
    const urls = new Set<string>();
    for (const [index, link] of links.entries()) {
      const value = link.url.trim();
      try {
        const parsed = new URL(value);
        if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || value.length > 2048 || /\s|\\/.test(value)) {
          throw new Error("invalid");
        }
      } catch {
        setError(`Link ${index + 1} needs a valid HTTP or HTTPS URL.`);
        return;
      }
      if ((link.title ?? "").trim().length > 255) {
        setError(`Link ${index + 1} title must be at most 255 characters.`);
        return;
      }
      if (urls.has(value)) {
        setError(`Link ${index + 1} duplicates another link.`);
        return;
      }
      urls.add(value);
    }

    const invalid = validateAttachmentSelection(files);
    if (invalid) {
      setError(invalid);
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      setUploadProgress(0);
      await onSubmit(
        files,
        links.map((link) => ({ url: link.url.trim(), title: link.title?.trim() || null })),
        (percent) => {
          if (mountedRef.current) setUploadProgress(percent);
        },
        controller.signal,
      );
      if (!mountedRef.current) return;
      setFiles([]);
      setLinks([]);
      setPreviewFile(null);
      setNotice("");
    } catch (err) {
      if (!mountedRef.current) return;
      if (isUploadCancelledError(err)) {
        const alreadySaved = onReconcileAfterCancel
          ? await onReconcileAfterCancel().catch(() => false)
          : false;
        if (!mountedRef.current) return;
        if (alreadySaved) {
          setFiles([]);
          setLinks([]);
          setPreviewFile(null);
          setNotice("Your submission had already finished saving on the server.");
        } else {
          setNotice(
            "Upload cancelled. Your selected files and links were kept so you can retry. If the upload had already reached the server, check your submission status before retrying.",
          );
        }
      } else {
        setError(err instanceof Error ? err.message : "Failed to submit");
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      if (mountedRef.current) {
        setUploadProgress(null);
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {error && (
        <Alert status="error"><Alert.Description>{error}</Alert.Description></Alert>
      )}
      {notice && (
        <Alert status="warning"><Alert.Description>{notice}</Alert.Description></Alert>
      )}

      {!canSubmitMore && (
        <div className="p-3 bg-yellow-100 border border-yellow-400 text-yellow-800 rounded">
          Maximum submission attempts ({maxAttempts}) reached
        </div>
      )}

      {/* File Upload Area */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded! p-6 text-center transition-colors ${
          dragActive
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 hover:border-gray-400"
        }`}
      >
        <Upload className="mx-auto mb-2 text-gray-400" size={32} />
        <p className="text-sm font-medium text-gray-700 mb-1">
          Drag and drop files here, or click to select
        </p>
        <p className="text-xs text-gray-500 mb-3">
          Up to 10 files and 200 MB combined. Documents: 10 MB each; MP4, WebM, or MOV videos: 100 MB each.
        </p>
        <input
          type="file"
          multiple
          onChange={handleFileChange}
          className="hidden"
          id="file-input"
          accept=".pdf,.docx,.ppt,.pptx,.jpg,.jpeg,.png,.mp4,.webm,.mov,video/mp4,video/webm,video/quicktime"
          disabled={isLoading || !canSubmitMore}
        />
        <label htmlFor="file-input">
          <Button asChild variant="default" size="md">
            <span>Select Files</span>
          </Button>
        </label>
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-sm text-gray-700">
            Selected Files ({files.length})
          </h4>
          <div className="space-y-1.5">
            {files.map((file, index) => {
              const video = isVideoFile(file);
              return (
                <div
                  key={`${file.name}-${file.size}-${index}`}
                  className="flex flex-col gap-2 rounded border border-border bg-muted/40 p-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className="flex items-center gap-1.5 truncate text-sm font-medium"
                      title={file.name}
                    >
                      {video && <Video aria-hidden="true" size={15} className="shrink-0" />}
                      <span className="truncate">{file.name}</span>
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {video && (
                        <Badge variant="outline" size="sm" className="px-1.5 py-0 text-[10px] uppercase tracking-wide">
                          Video
                        </Badge>
                      )}
                      <span>{formatFileSize(file.size)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {submissionFilePreviewKind(file) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1 shadow-none"
                        disabled={isBusy}
                        onClick={() => setPreviewFile(file)}
                      >
                        {video ? <Play size={14} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                        {video ? "Preview" : "View"}
                      </Button>
                    )}
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => removeFile(index)}
                      className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isBusy}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-3 rounded border-2 border-black p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-semibold">Submission links</h4>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isLoading || !canSubmitMore || links.length >= 20}
            onClick={() => { setLinks((current) => [...current, { url: "", title: "" }]); setError(""); }}
          >Submit link</Button>
        </div>
        {links.map((link, index) => (
          <div key={index} className="grid gap-2 rounded border border-gray-300 p-3 sm:grid-cols-[1fr_auto]">
            <div className="grid min-w-0 gap-2">
              <label className="text-sm font-medium" htmlFor={`submission-link-url-${index}`}>Link {index + 1} URL</label>
              <Input
                id={`submission-link-url-${index}`}
                type="url"
                placeholder="https://example.com/my-work"
                className="w-full"
                value={link.url}
                disabled={isLoading}
                onChange={(event) => setLinks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item))}
              />
              <label className="text-sm font-medium" htmlFor={`submission-link-title-${index}`}>Title (optional)</label>
              <Input
                id={`submission-link-title-${index}`}
                className="w-full"
                value={link.title ?? ""}
                disabled={isLoading}
                onChange={(event) => setLinks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))}
              />
            </div>
            <Button type="button" variant="outline" size="sm" className="self-start gap-2" disabled={isLoading} onClick={() => setLinks((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
              <X size={14} />Remove
            </Button>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Make sure your teacher can open each link, including Google Drive or Docs sharing permissions.</p>
      </div>

      {/* Submission Info */}
      {maxAttempts && (
        <div className="text-xs">
          Submission {currentAttempt + 1} of {maxAttempts}
        </div>
      )}

      {/* Submit Button */}
      {uploadProgress !== null && (
        <div className="space-y-2 rounded border-2 border-border bg-card p-3" role="status" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium">
            <span>
              {isProcessingUpload
                ? "Processing upload on server..."
                : `Uploading... ${uploadProgress}%`}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs shadow-none"
              onClick={cancelUpload}
            >
              Cancel upload
            </Button>
          </div>
          <div className="h-2 overflow-hidden rounded-full border border-black bg-white">
            <div
              className={`h-full transition-[width] ${isProcessingUpload ? "animate-pulse bg-[#7ABA78]" : "bg-[#7ABA78]"}`}
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}
      <Button
        type="submit"
        variant="default"
        size="md"
        className="w-full gap-2"
        disabled={isBusy || !canSubmitMore || (files.length === 0 && links.length === 0)}
      >
        {isProcessingUpload
          ? "Processing..."
          : isBusy
            ? "Uploading..."
            : "Submit Assignment"}
      </Button>

      <Dialog open={previewFile !== null} onOpenChange={(open) => { if (!open) setPreviewFile(null); }}>
        {previewFile && previewUrl && (
          <Dialog.Content size="4xl">
            <Dialog.Header position="static">
              <Text as="h5" className="truncate font-sans text-xl font-bold" title={previewFile.name}>
                Preview: {previewFile.name}
              </Text>
            </Dialog.Header>
            <div className="min-h-0 flex-1 overflow-auto bg-neutral-100 p-4 sm:p-6">
              {submissionFilePreviewKind(previewFile) === "image" ? (
                <img
                  src={previewUrl}
                  alt={`Preview of ${previewFile.name}`}
                  className="mx-auto max-h-[65dvh] max-w-full border-2 border-black bg-white object-contain shadow-[4px_4px_0_#000]"
                />
              ) : submissionFilePreviewKind(previewFile) === "video" ? (
                localVideoPreviewError ? (
                  <div className="mx-auto max-w-lg rounded border-2 border-border bg-card p-5 text-foreground">
                    <Alert status="warning">
                      <Alert.Description>{LOCAL_VIDEO_PREVIEW_UNAVAILABLE_MESSAGE}</Alert.Description>
                    </Alert>
                  </div>
                ) : (
                  <video
                    src={previewUrl}
                    controls
                    playsInline
                    preload="metadata"
                    onError={() => setLocalVideoPreviewError(true)}
                    className="mx-auto max-h-[65dvh] max-w-full border-2 border-black bg-black shadow-[4px_4px_0_#000]"
                  >
                    Your browser does not support video playback.
                  </video>
                )
              ) : (
                <iframe
                  src={previewUrl}
                  title={`Preview of ${previewFile.name}`}
                  className="h-[65dvh] w-full border-2 border-black bg-white shadow-[4px_4px_0_#000]"
                />
              )}
            </div>
            <Dialog.Footer position="static">
              <Button type="button" variant="outline" onClick={() => setPreviewFile(null)}>
                Close preview
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        )}
      </Dialog>
    </form>
  );
}
