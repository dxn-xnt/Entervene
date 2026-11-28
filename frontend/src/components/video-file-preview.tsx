import { useEffect, useRef, useState } from "react";
import { Download, Play } from "lucide-react";
import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import { Text } from "@/components/retroui/Text";
import { API_URL, apiFetch } from "@/lib/api";

export const LOCAL_VIDEO_PREVIEW_UNAVAILABLE_MESSAGE =
  "Browser preview is unavailable for this video codec, but you can still upload the file. Once uploaded, it can be downloaded and played in a compatible video player.";

export const STORED_VIDEO_PLAYBACK_ERROR_MESSAGE =
  "This video cannot be played in your browser. Download the file to open it using a compatible video player.";

export function VideoFilePreview({
  file,
  disabled = false,
}: {
  file: File;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  const urlRef = useRef("");

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const openPreview = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const objectUrl = URL.createObjectURL(file);
    urlRef.current = objectUrl;
    setUrl(objectUrl);
    setPreviewUnavailable(false);
    setOpen(true);
  };

  const closePreview = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = "";
    setUrl("");
    setPreviewUnavailable(false);
    setOpen(false);
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        className="h-7 w-full justify-center gap-1 px-2 text-xs shadow-none"
        onClick={openPreview}
      >
        <Play size={13} aria-hidden="true" /> Preview
      </Button>
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) closePreview(); }}>
        {open && url && (
          <Dialog.Content size="4xl">
            <Dialog.Header position="static">
              <Text as="h5" className="truncate font-sans text-xl font-bold" title={file.name}>
                Preview: {file.name}
              </Text>
            </Dialog.Header>
            <div className="min-h-0 flex-1 overflow-auto bg-neutral-950 p-4 sm:p-6">
              {previewUnavailable ? (
                <div className="mx-auto max-w-lg rounded border-2 border-border bg-card p-5 text-foreground">
                  <Alert status="warning">
                    <Alert.Description>{LOCAL_VIDEO_PREVIEW_UNAVAILABLE_MESSAGE}</Alert.Description>
                  </Alert>
                </div>
              ) : (
                <video
                  src={url}
                  controls
                  playsInline
                  preload="metadata"
                  onError={() => setPreviewUnavailable(true)}
                  className="mx-auto max-h-[65dvh] max-w-full bg-black"
                >
                  Your browser does not support video playback.
                </video>
              )}
            </div>
            <Dialog.Footer position="static">
              <Button type="button" variant="outline" size="sm" onClick={closePreview}>
                Close preview
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        )}
      </Dialog>
    </>
  );
}

export function StoredVideoPreviewButton({
  fileName,
  downloadPath,
  disabled = false,
}: {
  fileName: string;
  downloadPath: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  const resolvedDownloadUrl = /^https?:\/\//i.test(downloadPath)
    ? downloadPath
    : `${API_URL}${downloadPath.startsWith("/") ? "" : "/"}${downloadPath}`;
  const inlineUrl = `${resolvedDownloadUrl}${resolvedDownloadUrl.includes("?") ? "&" : "?"}inline=true`;

  const openPreview = () => {
    setLoading(true);
    setPlaybackError(false);
    setDownloadError("");
    setOpen(true);
  };

  const closePreview = () => {
    setOpen(false);
    setLoading(false);
    setPlaybackError(false);
    setDownloadError("");
  };

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError("");
    try {
      const probe = await apiFetch(downloadPath, { headers: { Range: "bytes=0-0" } });
      if (!probe.ok && probe.status !== 206) {
        throw new Error("The video could not be downloaded.");
      }
      const link = document.createElement("a");
      link.href = resolvedDownloadUrl;
      link.download = fileName;
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "The video could not be downloaded.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        className="h-7 w-full justify-center gap-1 px-2 text-xs shadow-none"
        onClick={openPreview}
      >
        <Play size={13} aria-hidden="true" /> Preview
      </Button>
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) closePreview(); }}>
        {open && (
          <Dialog.Content size="4xl">
            <Dialog.Header position="static">
              <Text as="h5" className="truncate font-sans text-xl font-bold" title={fileName}>
                Preview: {fileName}
              </Text>
            </Dialog.Header>
            <div className="min-h-0 flex-1 overflow-auto bg-neutral-950 p-4 sm:p-6">
              {downloadError && (
                <div className="mx-auto mb-3 max-w-lg">
                  <Alert status="error">
                    <Alert.Description>{downloadError}</Alert.Description>
                  </Alert>
                </div>
              )}
              {playbackError ? (
                <div className="mx-auto flex max-w-lg flex-col items-center justify-center gap-4 rounded border-2 border-border bg-card p-6 text-center text-foreground">
                  <Alert status="error" className="w-full text-left">
                    <Alert.Description>{STORED_VIDEO_PLAYBACK_ERROR_MESSAGE}</Alert.Description>
                  </Alert>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleDownload}
                    disabled={downloading}
                    className="gap-2"
                  >
                    <Download size={15} />
                    {downloading ? "Preparing download..." : "Download video"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {loading && (
                    <p className="text-center text-xs text-neutral-300" role="status" aria-live="polite">
                      Loading video metadata...
                    </p>
                  )}
                  <video
                    src={inlineUrl}
                    controls
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={() => setLoading(false)}
                    onCanPlay={() => setLoading(false)}
                    onError={() => {
                      setLoading(false);
                      setPlaybackError(true);
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
                <Button type="button" size="sm" onClick={handleDownload} disabled={downloading} className="gap-1.5">
                  <Download size={14} />
                  {downloading ? "Downloading..." : "Download"}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={closePreview}>
                  Close preview
                </Button>
              </div>
            </Dialog.Footer>
          </Dialog.Content>
        )}
      </Dialog>
    </>
  );
}
