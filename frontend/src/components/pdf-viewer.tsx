import { useEffect, useRef } from "react";
import { Download, FileText, X } from "lucide-react";

interface PDFViewerProps {
  pdfUrl: string;
  downloadUrl?: string;
  fileName: string;
  onClose?: () => void;
}

export default function PDFViewer({
  pdfUrl,
  downloadUrl,
  fileName,
  onClose,
}: PDFViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    let iframeDoc: Document | null = null;
    const iframe = iframeRef.current;
    const handleIframeLoad = () => {
      try {
        iframeDoc = iframe?.contentDocument || iframe?.contentWindow?.document || null;
        iframeDoc?.addEventListener("keydown", handleKeyDown);
      } catch {
        // Sandboxed / browser plugin restriction
      }
    };

    if (iframe) {
      iframe.addEventListener("load", handleIframeLoad);
    }

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      try {
        iframeDoc?.removeEventListener("keydown", handleKeyDown);
        iframe?.removeEventListener("load", handleIframeLoad);
      } catch {
        // Ignore cleanup errors
      }
    };
  }, [onClose]);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950 text-white">
      {/* Top Bar Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-900 px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <FileText className="size-5 shrink-0 text-red-400" />
          <p className="truncate text-sm font-medium text-neutral-200" title={fileName}>
            {fileName}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(downloadUrl || pdfUrl) && (
            <a
              href={downloadUrl || pdfUrl}
              download={fileName}
              className="rounded p-2 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white"
              title="Download PDF"
            >
              <Download size={18} />
            </a>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-2 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white"
              title="Close viewer (Esc)"
            >
              <X size={20} />
            </button>
          )}
        </div>
      </div>

      {/* PDF Viewport */}
      <div className="relative flex-1 w-full h-full min-h-0 bg-neutral-950">
        <iframe
          ref={iframeRef}
          src={`${pdfUrl}#toolbar=1&navpanes=0&scrollbar=1`}
          className="w-full h-full border-0"
          title={fileName}
        />
      </div>
    </div>
  );
}
