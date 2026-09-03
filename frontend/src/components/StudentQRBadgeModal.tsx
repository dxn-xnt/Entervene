import { useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toPng } from "html-to-image";
import { Dialog } from "@/components/retroui/Dialog";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Download, QrCode, ShieldCheck } from "lucide-react";

interface StudentQRBadgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  student: {
    student_id: string;
    student_name: string;
    student_lrn?: string | null;
    grade_level?: string | number | null;
    section_name?: string | null;
  } | null;
}

export default function StudentQRBadgeModal({
  isOpen,
  onClose,
  student,
}: StudentQRBadgeModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  if (!student) return null;

  const handleDownload = async () => {
    if (!cardRef.current || downloading) return;
    try {
      setDownloading(true);

      // Target specifically the inner badge card element only with 3x print resolution
      let dataUrl: string;
      try {
        dataUrl = await toPng(cardRef.current, {
          pixelRatio: 3,
          cacheBust: true,
          style: {
            margin: "0",
          },
        });
      } catch (fontErr) {
        console.warn("Retrying badge export with skipFonts:", fontErr);
        dataUrl = await toPng(cardRef.current, {
          pixelRatio: 3,
          cacheBust: true,
          skipFonts: true,
          style: {
            margin: "0",
          },
        });
      }

      const identifier = (
        student.student_lrn ||
        student.student_name ||
        student.student_id
      )
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, "_");

      const filename = `QR-Badge-${identifier}.png`;

      const link = document.createElement("a");
      link.download = filename;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Failed to export badge card:", err);
    } finally {
      setDownloading(false);
    }
  };

  const gradeLevelText = student.grade_level
    ? String(student.grade_level).toLowerCase().startsWith("grade")
      ? String(student.grade_level)
      : `Grade ${student.grade_level}`
    : null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content className="max-w-md p-6 bg-card text-card-foreground border-2 border-border shadow-retro">
        <Dialog.Header>
          <Dialog.Title className="flex items-center gap-2 text-lg font-bold">
            <QrCode className="w-5 h-5 text-primary" />
            Student Attendance QR Card
          </Dialog.Title>
          <Dialog.Description className="text-xs text-muted-foreground">
            Permanent, secure QR badge encoding the student identifier for class attendance.
          </Dialog.Description>
        </Dialog.Header>

        {/* Printable Badge Card Wrapper (keeps margin in modal, but keeps cardRef margin-free for clean PNG export) */}
        <div className="my-4">
          <div
            ref={cardRef}
            className="p-5 rounded-lg border-2 border-border bg-card shadow-sm flex flex-col items-center text-center relative overflow-hidden print:m-0 print:border-black"
          >
            {/* Top Banner */}
            <div className="w-full flex items-center justify-between border-b border-border/60 pb-3 mb-4">
              <div className="flex items-center gap-2 text-left">
                <div className="w-7 h-7 rounded bg-primary/10 border border-primary/30 flex items-center justify-center text-primary font-bold text-xs">
                  EV
                </div>
                <div>
                  <div className="text-xs font-bold tracking-tight">ENTERVENE ACADEMY</div>
                  <div className="text-[10px] text-muted-foreground">Student Pass & Attendance</div>
                </div>
              </div>
              <Badge variant="surface" className="text-[10px] uppercase font-semibold">
                Permanent
              </Badge>
            </div>

            {/* Student Details */}
            <div className="mb-3">
              <h3 className="text-base font-bold text-foreground tracking-tight">
                {student.student_name}
              </h3>
              <div className="flex items-center justify-center gap-2 mt-1 text-xs text-muted-foreground font-medium">
                {gradeLevelText && <span>{gradeLevelText}</span>}
                {gradeLevelText && student.section_name && <span>•</span>}
                {student.section_name && <span>{student.section_name}</span>}
              </div>
            </div>

            {/* QR Code Container */}
            <div className="p-3 bg-white rounded-md border-2 border-border shadow-inner my-2 flex items-center justify-center">
              <QRCodeSVG
                value={student.student_id}
                size={180}
                level="H"
                includeMargin={false}
                className="w-full h-auto"
              />
            </div>

            {/* Privacy & ID Note */}
            <div className="mt-3 text-[11px] text-muted-foreground flex items-center gap-1.5 font-mono">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span className="truncate max-w-[240px]">ID: {student.student_id}</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end mt-4 pt-3 border-t border-border">
          <Button
            variant="default"
            size="sm"
            onClick={handleDownload}
            disabled={downloading}
            className="gap-1.5"
          >
            <Download className="w-4 h-4" />
            {downloading ? "Downloading..." : "Download Badge"}
          </Button>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
