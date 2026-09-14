import { useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toPng } from "html-to-image";
import { Dialog } from "@/components/retroui/Dialog";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import { Download, ShieldCheck } from "lucide-react";

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

      let dataUrl: string;
      try {
        dataUrl = await toPng(cardRef.current, {
          pixelRatio: 3,
          cacheBust: true,
          style: { margin: "0" },
        });
      } catch (fontErr) {
        console.warn("Retrying badge export with skipFonts:", fontErr);
        dataUrl = await toPng(cardRef.current, {
          pixelRatio: 3,
          cacheBust: true,
          skipFonts: true,
          style: { margin: "0" },
        });
      }

      const identifier = (
        student.student_lrn ||
        student.student_name ||
        student.student_id
      )
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, "_");

      const link = document.createElement("a");
      link.download = `QR-Badge-${identifier}.png`;
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
      <Dialog.Content className="max-w-md rounded-none border-2 border-black bg-white p-0 text-black shadow-md">
        <Dialog.Header className="border-black bg-primary text-black">
          <div className="flex min-w-0 flex-col items-start">
            <Dialog.Title className="text-lg font-bold">
              Student Attendance QR Card
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-xs font-medium text-black/70">
              Permanent, secure QR badge encoding the student identifier for class attendance.
            </Dialog.Description>
          </div>
        </Dialog.Header>

        <div ref={cardRef} className="m-5">
          <Card className="relative flex w-full flex-col items-center overflow-hidden shadow-none p-5 text-center print:border-black print:shadow-none">
            <div className="mb-4 flex w-full items-center justify-between border-b border-black pb-3">
              <div className="flex items-center gap-2 text-left">
                <div className="flex size-8 items-center justify-center border border-black bg-primary text-xs font-bold text-black">
                  EV
                </div>
                <div>
                  <div className="text-xs font-bold tracking-tight">ENTERVENE ACADEMY</div>
                  <div className="text-[10px] text-gray-600">Student Pass & Attendance</div>
                </div>
              </div>
              <Badge variant="secondary" size="sm" className="rounded-none border border-black bg-primary text-[10px] font-bold uppercase text-black">
                Permanent
              </Badge>
            </div>

            <div className="mb-3">
              <Card.Title className="text-base font-bold tracking-tight text-black">
                {student.student_name}
              </Card.Title>
              <div className="mt-1 flex items-center justify-center gap-2 text-xs font-medium text-gray-600">
                {gradeLevelText && <span>{gradeLevelText}</span>}
                {gradeLevelText && student.section_name && <span>•</span>}
                {student.section_name && <span>{student.section_name}</span>}
              </div>
            </div>

            <Card className="my-2 flex items-center justify-center border-black bg-white p-3 !shadow-none hover:!shadow-none">
              <QRCodeSVG
                value={student.student_id}
                size={180}
                level="H"
                includeMargin={false}
                className="h-auto w-full"
              />
            </Card>

            <div className="mt-3 flex items-center gap-1.5 font-mono text-[11px] text-gray-600">
              <ShieldCheck className="size-3.5 text-success" />
              <span className="truncate max-w-[240px]">ID: {student.student_id}</span>
            </div>
          </Card>
        </div>

        <Dialog.Footer className="border-black bg-white">
          <Button
            size="sm"
            onClick={handleDownload}
            disabled={downloading}
            className="gap-1.5 rounded-none border-black bg-success hover:bg-success text-black"
          >
            <Download className="size-4" />
            {downloading ? "Downloading..." : "Download Badge"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
