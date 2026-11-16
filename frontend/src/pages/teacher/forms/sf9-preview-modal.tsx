import { useEffect, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/teacher/button";
import { Dialog } from "@/components/retroui/Dialog";
import {
  getTeacherAdvisoryStudentSF9Data,
  type TeacherAdvisoryStudentSF9Data,
} from "@/lib/api";
import { SF9PrintableCard } from "./sf9-printable-card";

type SF9PreviewModalProps = {
  isOpen: boolean;
  onClose: () => void;
  classId: number;
  studentId: string;
  studentName?: string;
};

export function SF9PreviewModal({
  isOpen,
  onClose,
  classId,
  studentId,
  studentName,
}: SF9PreviewModalProps) {
  const [data, setData] = useState<TeacherAdvisoryStudentSF9Data | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  // Teacher's comments state
  const [term1Comment, setTerm1Comment] = useState("");
  const [term2Comment, setTerm2Comment] = useState("");
  const [term3Comment, setTerm3Comment] = useState("");

  useEffect(() => {
    if (!isOpen || !classId || !studentId) {
      setData(null);
      setTerm1Comment("");
      setTerm2Comment("");
      setTerm3Comment("");
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setData(null);
    setTerm1Comment("");
    setTerm2Comment("");
    setTerm3Comment("");

    async function loadData() {
      try {
        const result = await getTeacherAdvisoryStudentSF9Data(classId, studentId);
        if (isMounted) {
          setData(result);
        }
      } catch (err) {
        console.error("Failed to load SF9 data:", err);
        toast.error(err instanceof Error ? err.message : "Unable to load student SF9 data.");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadData();

    return () => {
      isMounted = false;
    };
  }, [isOpen, classId, studentId]);

  const handleDownloadPdf = async () => {
    if (!data) return;
    const cardElement = document.getElementById("sf9-printable-card");
    if (!cardElement) return;

    try {
      setIsExportingPdf(true);
      toast.info(`Generating official PDF report card for ${studentName || "student"}...`);

      const { toPng } = await import("html-to-image");
      const { jsPDF } = await import("jspdf");

      // Render high-res image of the printable card
      const imgDataUrl = await toPng(cardElement, {
        quality: 0.98,
        pixelRatio: 2.5,
        backgroundColor: "#ffffff",
      });

      // Standard Letter landscape (279.4 x 215.9 mm)
      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "letter",
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const margin = 8; // mm margin
      const maxW = pageWidth - margin * 2;
      const maxH = pageHeight - margin * 2;

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

      pdf.addImage(imgDataUrl, "PNG", x, y, renderW, renderH, undefined, "FAST");

      const cleanName = (data.student.student_lrn || data.student.full_name).replace(/[^a-zA-Z0-9_-]/g, "_");
      const filename = `SF9_${cleanName}.pdf`;
      pdf.save(filename);

      toast.success("SF9 PDF report card downloaded successfully.");
    } catch (err) {
      console.error("PDF generation failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to generate PDF download.");
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleCommentChange = (term: 1 | 2 | 3, value: string) => {
    if (term === 1) setTerm1Comment(value);
    else if (term === 2) setTerm2Comment(value);
    else if (term === 3) setTerm3Comment(value);
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Content size="4xl" className="max-w-[1150px] max-h-[92vh] flex flex-col p-0 overflow-hidden border-2 border-black bg-muted/20">
        <Dialog.Header className="flex flex-row items-center justify-between border-b-2 border-black bg-card px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded border-2 border-black bg-primary text-primary-foreground shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <FileText className="size-4" />
            </span>
            <div>
              <Dialog.Title className="text-base font-bold font-head">
                Learner's Performance Report (SF9 / Form 138)
              </Dialog.Title>
            </div>
          </div>
        </Dialog.Header>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-auto p-4 md:p-6 bg-muted/40 [scrollbar-width:thin]">
          <Dialog.Description className="mb-4 text-sm text-muted-foreground">
            {studentName}{data ? ` · ${data.class_info.grade_level} ${data.class_info.section_name} · SY ${data.class_info.academic_year}` : ""}
          </Dialog.Description>
          {isLoading && !data ? (
            <div className="flex flex-col items-center justify-center p-16 text-center text-muted-foreground">
              <Loader2 className="size-8 animate-spin text-primary mb-3" />
              <p className="font-bold text-sm">Generating Official SF9 Report Card Preview...</p>
            </div>
          ) : !data ? (
            <div className="p-12 text-center text-sm font-semibold text-muted-foreground">
              Unable to load report card details.
            </div>
          ) : (
            <div className="mx-auto min-w-[960px] max-w-[1020px] bg-white text-black p-6 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-[11px] leading-tight">
              <SF9PrintableCard
                data={data}
                comments={{ term1: term1Comment, term2: term2Comment, term3: term3Comment }}
                onCommentChange={handleCommentChange}
                isInteractive={true}
                id="sf9-printable-card"
              />
            </div>
          )}
        </div>
        <Dialog.Footer className="mt-0">
          <Button
            variant="default"
            size="header"
            disabled={isExportingPdf || !data}
            onClick={handleDownloadPdf}
          >
            {isExportingPdf ? <Loader2 className="animate-spin" /> : <Download />}
            {isExportingPdf ? "Saving PDF..." : "Download PDF"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
