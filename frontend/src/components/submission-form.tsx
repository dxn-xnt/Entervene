import { useEffect, useState } from "react";
import { Eye, Upload, X } from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { Alert } from "@/components/retroui/Alert";
import { Input } from "@/components/retroui/Input";
import { Dialog } from "@/components/retroui/Dialog";
import { Text } from "@/components/retroui/Text";
import { maxClassworkMaterialSize } from "@/lib/classwork-utils";

export type SubmissionLinkDraft = { url: string; title?: string | null };

const submissionFilePreviewKind = (file: File): "image" | "pdf" | null => {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "pdf";
  return null;
};

interface SubmissionFormProps {
  assignmentId: number;
  onSubmit: (files: File[], links: SubmissionLinkDraft[]) => Promise<void>;
  isLoading?: boolean;
  maxAttempts?: number;
  currentAttempt?: number;
}

export default function SubmissionForm({
  onSubmit,
  isLoading = false,
  maxAttempts = 1,
  currentAttempt = 0,
}: SubmissionFormProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [links, setLinks] = useState<SubmissionLinkDraft[]>([]);
  const [error, setError] = useState<string>("");
  const [dragActive, setDragActive] = useState(false);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
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
    const oversized = incomingFiles.find(
      (file) => file.size > maxClassworkMaterialSize,
    );
    if (oversized) {
      const msg = `"${oversized.name}" exceeds the 10MB limit.`;
      setError(msg);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

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

    const oversized = files.find(
      (file) => file.size > maxClassworkMaterialSize,
    );
    if (oversized) {
      const msg = `"${oversized.name}" exceeds the 10MB limit.`;
      setError(msg);
      return;
    }

    try {
      await onSubmit(files, links.map((link) => ({ url: link.url.trim(), title: link.title?.trim() || null })));
      setFiles([]);
      setLinks([]);
      setPreviewFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {error && (
        <Alert status="error"><Alert.Description>{error}</Alert.Description></Alert>
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
          You can upload multiple files (up to 10MB each)
        </p>
        <input
          type="file"
          multiple
          onChange={handleFileChange}
          className="hidden"
          id="file-input"
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
          <div className="space-y-1">
            {files.map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-2 bg-gray-50 rounded border border-gray-200"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-gray-500">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <div className="ml-2 flex items-center gap-2">
                  {submissionFilePreviewKind(file) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      disabled={isLoading}
                      onClick={() => setPreviewFile(file)}
                    >
                      <Eye size={15} /> View
                    </Button>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => removeFile(index)}
                    className="p-1 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                    disabled={isLoading}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            ))}
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
      <Button
        type="submit"
        variant="default"
        size="md"
        className="w-full gap-2"
        disabled={isLoading || !canSubmitMore || (files.length === 0 && links.length === 0)}
      >
        {isLoading ? "Submitting..." : "Submit Assignment"}
      </Button>

      <Dialog open={previewFile !== null} onOpenChange={(open) => { if (!open) setPreviewFile(null); }}>
        {previewFile && previewUrl && (
          <Dialog.Content size="4xl">
            <Dialog.Header position="static">
              <Text as="h5" className="truncate font-sans text-xl font-bold">
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
