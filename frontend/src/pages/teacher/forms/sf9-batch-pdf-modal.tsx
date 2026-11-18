import { useEffect, useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/retroui/Dialog";
import { Button } from "@/components/teacher/button";
import { Progress } from "@/components/retroui/Progress";
import {
  getTeacherAdvisoryClassSF9BatchData,
  type TeacherAdvisoryStudentSF9Data,
} from "@/lib/api";
import { SF9PrintableCard } from "./sf9-printable-card";

export type SF9BatchPdfModalProps = {
  isOpen: boolean;
  onClose: () => void;
  classId: number;
  studentIds?: string[];
  mode: "selected" | "all";
  academicYear?: string;
};

export function SF9BatchPdfModal({
  isOpen,
  onClose,
  classId,
  studentIds,
  mode,
  academicYear,
}: SF9BatchPdfModalProps) {
  const [status, setStatus] = useState<"fetching" | "rendering" | "done" | "error">("fetching");
  const [progress, setProgress] = useState<{ current: number; total: number; currentStudentName: string }>({
    current: 0,
    total: 0,
    currentStudentName: "",
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentRecord, setCurrentRecord] = useState<TeacherAdvisoryStudentSF9Data | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isOpen) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setStatus("fetching");
      setProgress({ current: 0, total: 0, currentStudentName: "" });
      setErrorMessage(null);
      setCurrentRecord(null);
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    let isCancelled = false;

    async function runBatchExport() {
      try {
        setStatus("fetching");
        setErrorMessage(null);

        const records = await getTeacherAdvisoryClassSF9BatchData(
          classId,
          mode === "selected" ? studentIds : undefined,
        );

        if (abortController.signal.aborted || isCancelled) return;

        if (!records || records.length === 0) {
          toast.error("No student records available for SF9 generation.");
          onClose();
          return;
        }

        setStatus("rendering");
        setProgress({
          current: 0,
          total: records.length,
          currentStudentName: records[0].student.full_name,
        });

        const { toPng } = await import("html-to-image");
        const { jsPDF } = await import("jspdf");

        // Standard Letter landscape: 279.4 x 215.9 mm
        const pdf = new jsPDF({
          orientation: "landscape",
          unit: "mm",
          format: "letter",
        });

        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 8;
        const maxW = pageWidth - margin * 2;
        const maxH = pageHeight - margin * 2;

        for (let i = 0; i < records.length; i++) {
          if (abortController.signal.aborted || isCancelled) {
            return;
          }

          const record = records[i];
          setCurrentRecord(record);
          setProgress({
            current: i + 1,
            total: records.length,
            currentStudentName: record.student.full_name,
          });

          // Wait until React commits this exact student record to the DOM
          const targetId = String(record.student.student_id);
          const waitStart = Date.now();
          let cardElement: HTMLElement | null = null;
          while (true) {
            if (abortController.signal.aborted || isCancelled) {
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
            const el = document.getElementById("sf9-batch-render-card");
            if (el && el.getAttribute("data-student-id") === targetId) {
              cardElement = el;
              break;
            }
            if (Date.now() - waitStart > 3000) {
              cardElement = el;
              break;
            }
          }

          if (abortController.signal.aborted || isCancelled) {
            return;
          }

          if (!cardElement) {
            throw new Error(`Failed to find render container for student ${record.student.full_name}`);
          }

          // Render high-res PNG (matching preview modal quality)
          const imgDataUrl = await toPng(cardElement, {
            quality: 0.98,
            pixelRatio: 2.5,
            backgroundColor: "#ffffff",
          });

          if (abortController.signal.aborted || isCancelled) {
            return;
          }

          const imgProps = pdf.getImageProperties(imgDataUrl);
          const imgRatio = imgProps.width / imgProps.height;

          let renderW = maxW;
          let renderH = maxW / imgRatio;

          if (renderH > maxH) {
            renderH = maxH;
            renderW = maxH * imgRatio;
          }

          const x = margin + (maxW - renderW) / 2;
          const y = margin + (maxH - renderH) / 2;

          // If not the first student, add a new landscape letter page
          if (i > 0) {
            pdf.addPage("letter", "landscape");
          }

          pdf.addImage(imgDataUrl, "PNG", x, y, renderW, renderH, undefined, "FAST");

          // Yield to browser event loop so UI stays completely responsive
          await new Promise((resolve) => setTimeout(resolve, 25));
        }

        if (abortController.signal.aborted || isCancelled) {
          return;
        }

        // Determine safe filename
        const cleanYear = (academicYear || records[0]?.class_info?.academic_year || "2026-2027").replace(
          /[^a-zA-Z0-9_-]/g,
          "_",
        );

        let filename = `SF9_Printable_All_${cleanYear}.pdf`;
        if (mode === "selected") {
          if (records.length === 1) {
            const cleanName = (records[0].student.student_lrn || records[0].student.full_name).replace(
              /[^a-zA-Z0-9_-]/g,
              "_",
            );
            filename = `SF9_${cleanName}_${cleanYear}.pdf`;
          } else {
            filename = `SF9_Printable_Selected_${cleanYear}.pdf`;
          }
        }

        pdf.save(filename);
        toast.success(`Generated official combined PDF for ${records.length} student${records.length > 1 ? "s" : ""}.`);
        onClose();
      } catch (err) {
        if (abortController.signal.aborted || isCancelled) {
          return;
        }
        console.error("Batch SF9 PDF generation failed:", err);
        const msg = err instanceof Error ? err.message : "Failed to generate combined PDF.";
        setErrorMessage(msg);
        setStatus("error");
        toast.error(msg);
      }
    }

    void runBatchExport();

    return () => {
      isCancelled = true;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [isOpen, classId, studentIds, mode, academicYear, onClose]);

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    toast.info("PDF generation cancelled.");
    onClose();
  };

  if (!isOpen) return null;

  const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <>
      {/* Off-screen dedicated rendering container */}
      <div
        className="fixed pointer-events-none"
        style={{ left: "-9999px", top: "0px", width: "1000px", zIndex: -100 }}
        aria-hidden="true"
      >
        {currentRecord && (
          <div className="bg-white p-6 border-2 border-black text-[11px] leading-tight">
            <SF9PrintableCard
              key={currentRecord.student.student_id}
              data={currentRecord}
              id="sf9-batch-render-card"
              isInteractive={false}
            />
          </div>
        )}
      </div>

      {/* Visible Progress Modal */}
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) handleCancel();
        }}
      >
        <Dialog.Content size="md" className="border-2 border-black bg-card shadow-lg p-0 overflow-hidden">
          <Dialog.Header className="flex flex-row items-center justify-between border-b-2 border-black bg-muted/40 px-5 py-3">
            <div className="flex items-center gap-2.5">
              <span className="flex size-7 items-center justify-center rounded border-2 border-black bg-primary text-primary-foreground shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <FileText className="size-4" />
              </span>
              <Dialog.Title className="text-sm font-bold font-head">
                {mode === "all" ? "Export All Students — Printable PDF" : "Export Selected Students — Printable PDF"}
              </Dialog.Title>
            </div>
          </Dialog.Header>

          <div className="p-6 space-y-4">
            {status === "fetching" && (
              <div className="flex flex-col items-center justify-center py-6 text-center space-y-3">
                <Loader2 className="size-8 animate-spin text-primary" />
                <p className="text-sm font-bold">Fetching official student SF9 records...</p>
                <p className="text-xs text-muted-foreground">Compiling attendance, grades, and DepEd metadata</p>
              </div>
            )}

            {status === "rendering" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-muted-foreground">
                    Rendering student {progress.current} of {progress.total}:
                  </span>
                  <span className="font-mono font-bold text-sm">{percent}%</span>
                </div>

                <div className="rounded border-2 border-border bg-background p-3">
                  <p className="text-xs font-bold text-foreground truncate">
                    {progress.currentStudentName || "Preparing page..."}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Official DepEd Form 138 · Page {progress.current} of {progress.total}
                  </p>
                </div>

                <Progress value={percent} className="h-3.5" />

                <p className="text-[11px] text-muted-foreground text-center">
                  Each student's complete SF9 report card begins on a fresh page in the combined PDF.
                </p>
              </div>
            )}

            {status === "error" && (
              <div className="py-4 text-center space-y-2">
                <p className="text-sm font-bold text-destructive">PDF Generation Failed</p>
                <p className="text-xs text-muted-foreground">{errorMessage || "An unexpected error occurred."}</p>
              </div>
            )}
          </div>

          <Dialog.Footer className="border-t-2 border-black bg-muted/20 px-5 py-3 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              className="text-xs font-bold"
            >
              {status === "error" ? "Close" : "Cancel"}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </>
  );
}
