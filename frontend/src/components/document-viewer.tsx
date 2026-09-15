import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DOMPurify from "dompurify";
import { Download, FileText, Loader2, Presentation, X } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";

export type PreviewDocumentKind = "pdf" | "docx" | "ppt" | "pptx";

interface DocumentViewerProps {
  blob: Blob;
  objectUrl: string;
  fileName: string;
  kind: PreviewDocumentKind;
  onClose: () => void;
}

const TYPE_LABELS: Record<PreviewDocumentKind, string> = {
  pdf: "PDF",
  docx: "Word document",
  ppt: "PowerPoint presentation",
  pptx: "PowerPoint presentation",
};

export default function DocumentViewer({
  blob,
  objectUrl,
  fileName,
  kind,
  onClose,
}: DocumentViewerProps) {
  const [html, setHtml] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(kind === "docx" || kind === "pdf" || kind === "pptx");
  const [, setSlideCount] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  // Scroll lock
  useEffect(() => {
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
    };
  }, []);

  // Initial focus + focus restore on close
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Focus the container so screen readers announce the dialog
    containerRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  // Escape key → close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // DOCX rendering
  useEffect(() => {
    let active = true;
    if (kind !== "docx") return;

    const renderDocument = async () => {
      setLoading(true);
      setError("");
      try {
        const mammoth = await import("mammoth");
        const result = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
        if (!active) return;
        setHtml(DOMPurify.sanitize(result.value));
        if (result.messages.length > 0) {
          setNotice("Some advanced Word formatting may differ from the downloaded document.");
        }
      } catch {
        if (active) setError("This Word document could not be previewed. You can still download it.");
      } finally {
        if (active) setLoading(false);
      }
    };

    void renderDocument();
    return () => {
      active = false;
    };
  }, [blob, kind]);

  // PPTX iframe bridge
  const sendBufferRef = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true;
    let sent = false;
    if (kind !== "pptx") return;

    setLoading(true);
    setError("");

    const sendBuffer = async () => {
      if (sent || !active || !iframeRef.current?.contentWindow) return;
      sent = true;
      try {
        const buffer = await blob.arrayBuffer();
        if (!active || !iframeRef.current?.contentWindow) return;
        iframeRef.current.contentWindow.postMessage(
          { type: "RENDER_PPTX", buffer },
          "*",
          [buffer]
        );
      } catch {
        if (active) {
          setError("This presentation could not be loaded. You can still download it.");
          setLoading(false);
        }
      }
    };
    sendBufferRef.current = sendBuffer;

    const handleMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== "object") return;

      if (event.data.type === "PPTX_READY") {
        void sendBuffer();
      } else if (event.data.type === "PPTX_STATUS") {
        if (!active) return;
        if (event.data.status === "loaded") {
          setSlideCount(event.data.slideCount || 0);
          setLoading(false);
        } else if (event.data.status === "error" || event.data.status === "empty") {
          setError(
            event.data.status === "empty"
              ? "This presentation contains no slides. You can still download it."
              : "This presentation could not be rendered. You can still download it."
          );
          setLoading(false);
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      active = false;
      window.removeEventListener("message", handleMessage);
    };
  }, [blob, kind]);

  const isPresentation = kind === "ppt" || kind === "pptx";

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="fixed inset-0 z-[10000] flex h-full w-full flex-col bg-neutral-950 text-white m-0 p-0 border-0 overflow-hidden outline-none"
    >
      {/* Top bar */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-900 px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {isPresentation
            ? <Presentation className="size-5 shrink-0 text-orange-400" />
            : <FileText className="size-5 shrink-0 text-red-400" />
          }
          <div className="min-w-0">
            <p
              id={titleId}
              className="truncate text-sm font-medium text-neutral-200"
              title={fileName}
            >
              {fileName}
            </p>
            <Badge className="mt-0.5 rounded-none text-[10px]">{TYPE_LABELS[kind]}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <a
            href={objectUrl}
            download={fileName}
            className="rounded p-2 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white"
            title="Download file"
          >
            <Download size={18} />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-2 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white"
            title="Close viewer (Esc)"
            aria-label="Close document viewer"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Content viewport */}
      <div className="relative flex-1 min-h-0 overflow-hidden bg-neutral-950">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-neutral-950 text-sm font-medium text-neutral-300">
            <Loader2 className="size-5 animate-spin" /> Loading preview…
          </div>
        )}

        {kind === "pdf" && (
          <iframe
            src={`${objectUrl}#toolbar=1&navpanes=0&scrollbar=1`}
            className="block h-full w-full border-0"
            title={`Preview of ${fileName}`}
            onLoad={() => setLoading(false)}
          />
        )}

        {kind === "docx" && !error && (
          <div className="h-full overflow-y-auto bg-white">
            <div className="mx-auto min-h-full max-w-4xl bg-white p-5 text-neutral-900 sm:p-10">
              {notice && (
                <p className="mb-4 border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600">
                  {notice}
                </p>
              )}
              <article
                className="prose prose-zinc max-w-none prose-table:border-collapse prose-th:border prose-th:border-neutral-300 prose-th:p-2 prose-td:border prose-td:border-neutral-300 prose-td:p-2"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          </div>
        )}

        {kind === "pptx" && !error && (
          <iframe
            ref={iframeRef}
            src="/pptxjs/iframe-viewer.html"
            sandbox="allow-scripts"
            className="block h-full w-full border-0"
            title={`Presentation preview of ${fileName}`}
            onLoad={() => {
              sendBufferRef.current();
            }}
          />
        )}

        {(kind === "ppt" || error) && (
          <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-lg border border-neutral-700 bg-neutral-900 p-6 text-center">
              <Presentation className="mx-auto mb-3 size-10 text-neutral-500" />
              <h3 className="font-bold text-neutral-200">Preview unavailable</h3>
              <p className="mt-2 text-sm text-neutral-400">
                {error || (kind === "ppt"
                  ? "Legacy .ppt files require secure server-side conversion before slides can be displayed. Download this presentation to view it without exposing it to a public viewer."
                  : "In-app presentation preview is temporarily disabled. Download this presentation to view it without exposing it to a public viewer.")}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
