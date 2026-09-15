import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { Download, FileText, Loader2, Presentation } from "lucide-react";
import { Dialog } from "@/components/retroui/Dialog";
import { Button } from "@/components/retroui/Button";
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

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content size="4xl" className="h-[calc(100dvh-2rem)] p-0">
        <Dialog.Header>
          <div className="flex min-w-0 items-center gap-3">
            {isPresentation ? <Presentation className="size-5 shrink-0" /> : <FileText className="size-5 shrink-0" />}
            <div className="min-w-0">
              <p className="truncate text-sm font-bold" title={fileName}>{fileName}</p>
              <Badge className="mt-1 rounded-none text-[10px]">{TYPE_LABELS[kind]}</Badge>
            </div>
          </div>
        </Dialog.Header>

        <div className="relative min-h-0 flex-1 overflow-y-auto bg-muted/30">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background text-sm font-medium">
              <Loader2 className="size-5 animate-spin" /> Loading preview…
            </div>
          )}

          {kind === "pdf" && (
            <iframe
              src={`${objectUrl}#toolbar=1&navpanes=0&scrollbar=1`}
              className="block h-full min-h-[28rem] w-full border-0"
              title={`Preview of ${fileName}`}
              onLoad={() => setLoading(false)}
            />
          )}

          {kind === "docx" && !error && (
            <div className="mx-auto min-h-full max-w-4xl bg-background p-5 text-foreground sm:p-10">
              {notice && <p className="mb-4 border border-border bg-muted p-3 text-sm text-muted-foreground">{notice}</p>}
              <article
                className="prose prose-zinc max-w-none dark:prose-invert prose-table:border-collapse prose-th:border prose-th:border-border prose-th:p-2 prose-td:border prose-td:border-border prose-td:p-2"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          )}

          {kind === "pptx" && !error && (
            <iframe
              ref={iframeRef}
              src="/pptxjs/iframe-viewer.html"
              sandbox="allow-scripts"
              className="block h-full min-h-[28rem] w-full border-0"
              title={`Presentation preview of ${fileName}`}
              onLoad={() => {
                sendBufferRef.current();
              }}
            />
          )}

          {(kind === "ppt" || error) && (
            <div className="flex min-h-full items-center justify-center p-6">
              <div className="max-w-lg border border-border bg-background p-6 text-center">
                <Presentation className="mx-auto mb-3 size-10 text-muted-foreground" />
                <h3 className="font-bold">Preview unavailable</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {error || (kind === "ppt"
                    ? "Legacy .ppt files require secure server-side conversion before slides can be displayed. Download this presentation to view it without exposing it to a public viewer."
                    : "In-app presentation preview is temporarily disabled. Download this presentation to view it without exposing it to a public viewer.")}
                </p>
              </div>
            </div>
          )}
        </div>

        <Dialog.Footer>
          <Dialog.Close render={<Button type="button" variant="outline" />}>Close</Dialog.Close>
          <Button asChild className="gap-2">
            <a href={objectUrl} download={fileName}>
              <Download className="size-4" /> Download
            </a>
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
