import { useEffect, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import {
  getTeacherAdvisoryStudentSF9Data,
  type TeacherAdvisoryStudentSF9Data,
} from "@/lib/api";

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
    if (!isOpen || !classId || !studentId) return;

    let isMounted = true;
    setIsLoading(true);

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

      pdf.addImage(imgDataUrl, "PNG", x, y, renderW, renderH);

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

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Content size="5xl" className="max-w-[1150px] max-h-[92vh] flex flex-col p-0 overflow-hidden border-2 border-black bg-muted/20">
        {/* Modal Top Action Toolbar */}
        <Dialog.Header className="flex flex-row items-center justify-between border-b-2 border-black bg-card px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded border-2 border-black bg-primary text-primary-foreground shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <FileText className="size-4" />
            </span>
            <div>
              <Dialog.Title className="text-base font-bold font-head">
                Learner's Performance Report (SF9 / Form 138)
              </Dialog.Title>
              <Dialog.Description className="text-xs font-semibold text-muted-foreground">
                {studentName} {data ? `· ${data.class_info.grade_level} - ${data.class_info.section_name} (SY ${data.class_info.academic_year})` : ""}
              </Dialog.Description>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              disabled={isExportingPdf || !data}
              onClick={handleDownloadPdf}
              className="font-bold text-xs flex items-center gap-1.5 border-2 border-black bg-primary text-primary-foreground shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none"
              title="Download official PDF directly to your device"
            >
              {isExportingPdf ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              <span>{isExportingPdf ? "Saving PDF..." : "Download PDF"}</span>
            </Button>
          </div>
        </Dialog.Header>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-auto p-4 md:p-6 bg-muted/40 [scrollbar-width:thin]">
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
              {/* Printable Card Area */}
              <div id="sf9-printable-card" className="card-grid grid grid-cols-2 gap-6 bg-white text-black">

                {/* ═════════════════════════════════════════════════════════ */}
                {/* LEFT COLUMN: Learner's Performance Report */}
                {/* ═════════════════════════════════════════════════════════ */}
                <div className="left-col pr-6 border-r-2 border-black flex flex-col justify-between">
                  <div>
                    {/* Official Institutional Header with DepEd & School Logos */}
                    <div className="header-logo-row flex items-start justify-between gap-2 mb-2">
                      <div className="shrink-0 w-12 h-12 flex items-center justify-center pt-1.5">
                        <img
                          src="/assets/deped-logo.png"
                          alt="Department of Education Logo"
                          className="header-logo w-12 h-12 object-contain"
                          crossOrigin="anonymous"
                        />
                      </div>

                      <div className="header-text text-center flex-1 leading-tight">
                        <p className="header-gov italic text-[9.5px] text-black/75">Republic of the Philippines</p>
                        <p className="header-deped font-bold text-xs text-black">Department of Education</p>
                        <p className="text-[9.5px] text-black font-medium">{data.school_info.region}</p>
                        <p className="header-div font-bold text-[9.5px] uppercase text-black">
                          SCHOOLS DIVISION OFFICE OF {data.school_info.division}
                        </p>
                        <p className="text-[9.5px] text-black">District {data.school_info.district}</p>
                        <p className="text-[9px] text-black/80">{data.school_info.municipality}</p>

                        {/* Automatic School Name without "School:" label */}
                        <p className="font-extrabold text-[10.5px] uppercase tracking-wide text-black mt-1">
                          {data.school_info.school_name}
                        </p>
                      </div>

                      <div className="shrink-0 w-12 h-12 flex items-center justify-center pt-1.5">
                        <img
                          src="/assets/school-logo.png"
                          alt="School Official Logo"
                          className="header-logo w-12 h-12 object-contain"
                          crossOrigin="anonymous"
                        />
                      </div>
                    </div>

                    <div className="text-center mt-1 mb-2">
                      <h2 className="report-title font-bold text-[12.5px] uppercase">
                        LEARNER'S PERFORMANCE REPORT
                      </h2>
                      <p className="text-[10px] font-bold">School Year {data.class_info.academic_year}</p>
                    </div>

                    {/* Student Metadata Table */}
                    <table className="meta-table w-full text-[10px] my-2 border-collapse">
                      <tbody>
                        <tr>
                          <td className="w-1/2">
                            <span className="font-bold">Name: </span>
                            <span className="underline font-semibold">{data.student.full_name}</span>
                          </td>
                          <td className="w-1/4">
                            <span className="font-bold">Age: </span>
                            <span className="underline font-medium">{data.student.age ?? "-"}</span>
                          </td>
                          <td className="w-1/4">
                            <span className="font-bold">Sex: </span>
                            <span className="underline font-medium">{data.student.gender || "-"}</span>
                          </td>
                        </tr>
                        <tr>
                          <td>
                            <span className="font-bold">LRN: </span>
                            <span className="underline font-semibold">{data.student.student_lrn || "-"}</span>
                          </td>
                          <td>
                            <span className="font-bold">Grade: </span>
                            <span className="underline font-medium">{data.class_info.grade_level}</span>
                          </td>
                          <td>
                            <span className="font-bold">Section: </span>
                            <span className="underline font-medium">{data.class_info.section_name}</span>
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={3}>
                            <span className="font-bold">Track (SHS only): </span>
                            <span className="underline font-medium">{data.student.track || "—"}</span>
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    {/* Dear Parents Note */}
                    <div className="text-[9.5px] my-2 text-black/90 leading-tight">
                      <p className="font-bold mb-0.5">Dear Parents,</p>
                      <p className="indent-4 mb-0.5">
                        This Performance Report shows the ability and progress your child has made in the different learning areas as well as his/her core values.
                      </p>
                      <p className="indent-4">
                        The school welcomes you should you desire to know more about your child's progress.
                      </p>
                    </div>

                    {/* LEARNING PROGRESS AND ACHIEVEMENT Table */}
                    <div className="mt-2">
                      <h3 className="font-bold text-[11px] text-center uppercase tracking-wide mb-1">
                        LEARNING PROGRESS AND ACHIEVEMENT
                      </h3>
                      <table className="bordered-table w-full border-collapse border border-black text-[9.5px]">
                        <thead>
                          <tr className="bg-[#E8EEF5]">
                            <th rowSpan={2} className="border border-black p-1 text-left font-bold min-w-[150px]">
                              Learning Areas
                            </th>
                            <th colSpan={data.periods.length || 3} className="border border-black p-1 text-center font-bold">
                              TERM
                            </th>
                            <th rowSpan={2} className="border border-black p-1 text-center font-bold w-12">
                              Final Grade
                            </th>
                            <th rowSpan={2} className="border border-black p-1 text-center font-bold w-14">
                              Remarks
                            </th>
                          </tr>
                          <tr className="bg-[#E8EEF5]">
                            {data.periods.map((p, idx) => (
                              <th key={p.academic_period_id} className="border border-black p-0.5 text-center font-bold w-8">
                                {p.period_sequence || idx + 1}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {/* Core Subjects */}
                          {data.learning_areas.core.length > 0 && (
                            <>
                              <tr className="section-header-row bg-[#F2F2F2]">
                                <td colSpan={data.periods.length + 3} className="border border-black px-1.5 py-0.5 font-bold">
                                  Core Subjects
                                </td>
                              </tr>
                              {data.learning_areas.core.map((subj) => (
                                <tr key={subj.subject_id} className="hover:bg-black/5">
                                  <td className="border border-black px-1.5 py-0.5 font-medium">
                                    {subj.subject_name}
                                  </td>
                                  {data.periods.map((p, pIdx) => {
                                    const val = subj.grades[String(p.period_sequence || pIdx + 1)];
                                    return (
                                      <td key={p.academic_period_id} className="border border-black text-center p-0.5 font-mono">
                                        {val !== null && val !== undefined ? val.toFixed(1) : ""}
                                      </td>
                                    );
                                  })}
                                  <td className="border border-black text-center p-0.5 font-bold font-mono">
                                    {subj.final_grade !== null ? subj.final_grade.toFixed(1) : ""}
                                  </td>
                                  <td className="border border-black text-center p-0.5 text-[9px] font-semibold">
                                    {subj.remarks}
                                  </td>
                                </tr>
                              ))}
                            </>
                          )}

                          {/* Elective Subjects */}
                          {data.learning_areas.electives.length > 0 && (
                            <>
                              <tr className="section-header-row bg-[#F2F2F2]">
                                <td colSpan={data.periods.length + 3} className="border border-black px-1.5 py-0.5 font-bold">
                                  Elective Subjects
                                </td>
                              </tr>
                              {data.learning_areas.electives.map((subj) => (
                                <tr key={subj.subject_id} className="hover:bg-black/5">
                                  <td className="border border-black px-1.5 py-0.5 font-medium">
                                    {subj.subject_name}
                                  </td>
                                  {data.periods.map((p, pIdx) => {
                                    const val = subj.grades[String(p.period_sequence || pIdx + 1)];
                                    return (
                                      <td key={p.academic_period_id} className="border border-black text-center p-0.5 font-mono">
                                        {val !== null && val !== undefined ? val.toFixed(1) : ""}
                                      </td>
                                    );
                                  })}
                                  <td className="border border-black text-center p-0.5 font-bold font-mono">
                                    {subj.final_grade !== null ? subj.final_grade.toFixed(1) : ""}
                                  </td>
                                  <td className="border border-black text-center p-0.5 text-[9px] font-semibold">
                                    {subj.remarks}
                                  </td>
                                </tr>
                              ))}
                            </>
                          )}

                          {/* General Average Row */}
                          <tr className="bg-[#FFF8DC] font-bold border-t-2 border-black">
                            <td colSpan={data.periods.length + 1} className="border border-black px-1.5 py-1 text-right">
                              General Average
                            </td>
                            <td className="border border-black text-center p-1 font-mono text-[10px]">
                              {data.general_average.final_rating !== null ? data.general_average.final_rating.toFixed(1) : "—"}
                            </td>
                            <td className="border border-black text-center p-1 text-[9.5px]">
                              {data.general_average.remarks}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* PERFORMANCE DESCRIPTORS */}
                  <div className="mt-4 pt-2">
                    <h4 className="font-bold text-[10px] text-center uppercase tracking-wide mb-1">
                      PERFORMANCE DESCRIPTORS
                    </h4>
                    <table className="w-full text-[9px] border-collapse border-y border-black">
                      <thead>
                        <tr className="border-b border-black font-bold">
                          <th className="py-0.5 text-center w-1/3">Grading Scale</th>
                          <th className="py-0.5 text-center w-1/3">Description</th>
                          <th className="py-0.5 text-center w-1/3">Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.descriptors.map((d) => (
                          <tr key={d.scale} className="text-center">
                            <td className="py-0.5 font-mono">{d.scale}</td>
                            <td className="py-0.5 font-medium">{d.description}</td>
                            <td className="py-0.5">{d.remarks}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ═════════════════════════════════════════════════════════ */}
                {/* RIGHT COLUMN: Attendance, Remarks, Signatures, Transfer */}
                {/* ═════════════════════════════════════════════════════════ */}
                <div className="right-col md:pl-2 flex flex-col justify-between">
                  <div>
                    {/* 1. ATTENDANCE RECORD */}
                    <div>
                      <h3 className="font-bold text-[11px] text-center uppercase tracking-wide mb-1">
                        ATTENDANCE RECORD
                      </h3>
                      <table className="bordered-table w-full border-collapse border border-black text-[8.5px]">
                        <thead>
                          <tr className="bg-[#E8EEF5]">
                            <th className="border border-black p-1 text-left font-bold min-w-[70px]">Month</th>
                            {data.attendance.months.map((m) => (
                              <th key={m.month} className="border border-black p-0.5 text-center font-bold">
                                {m.month}
                              </th>
                            ))}
                            <th className="border border-black p-0.5 text-center font-bold">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td className="border border-black px-1 py-0.5 font-medium">No. of Class Days</td>
                            {data.attendance.months.map((m) => (
                              <td key={m.month} className="border border-black text-center p-0.5 font-mono">
                                {m.class_days || ""}
                              </td>
                            ))}
                            <td className="border border-black text-center p-0.5 font-bold font-mono">
                              {data.attendance.total.class_days || ""}
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-black px-1 py-0.5 font-medium">No. of Days Present</td>
                            {data.attendance.months.map((m) => (
                              <td key={m.month} className="border border-black text-center p-0.5 font-mono">
                                {m.present || ""}
                              </td>
                            ))}
                            <td className="border border-black text-center p-0.5 font-bold font-mono">
                              {data.attendance.total.present || ""}
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-black px-1 py-0.5 font-medium">No. of Days Absent</td>
                            {data.attendance.months.map((m) => (
                              <td key={m.month} className="border border-black text-center p-0.5 font-mono">
                                {m.absent || ""}
                              </td>
                            ))}
                            <td className="border border-black text-center p-0.5 font-bold font-mono">
                              {data.attendance.total.absent || ""}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* 2. TEACHER'S COMMENTS/REMARKS */}
                    <div className="mt-3">
                      <h4 className="font-bold text-[10.5px] text-center uppercase tracking-wide mb-1">
                        TEACHER'S COMMENTS/REMARKS
                      </h4>

                      <div className="comment-box border border-black p-1.5 mb-2 rounded-sm bg-white">
                        <span className="font-bold text-[9.5px] block mb-1">Term 1</span>
                        <textarea
                          rows={2}
                          value={term1Comment}
                          onChange={(e) => setTerm1Comment(e.target.value)}
                          placeholder="Type Term 1 comments or teacher remarks..."
                          className="w-full text-[9.5px] resize-none border-0 p-0 focus:outline-none focus:ring-0 bg-transparent placeholder:text-black/35 font-sans"
                        />
                      </div>

                      <div className="comment-box border border-black p-1.5 mb-2 rounded-sm bg-white">
                        <span className="font-bold text-[9.5px] block mb-1">Term 2</span>
                        <textarea
                          rows={2}
                          value={term2Comment}
                          onChange={(e) => setTerm2Comment(e.target.value)}
                          placeholder="Type Term 2 comments or teacher remarks..."
                          className="w-full text-[9.5px] resize-none border-0 p-0 focus:outline-none focus:ring-0 bg-transparent placeholder:text-black/35 font-sans"
                        />
                      </div>

                      <div className="comment-box border border-black p-1.5 mb-2 rounded-sm bg-white">
                        <span className="font-bold text-[9.5px] block mb-1">Term 3</span>
                        <textarea
                          rows={2}
                          value={term3Comment}
                          onChange={(e) => setTerm3Comment(e.target.value)}
                          placeholder="Type Term 3 comments or teacher remarks..."
                          className="w-full text-[9.5px] resize-none border-0 p-0 focus:outline-none focus:ring-0 bg-transparent placeholder:text-black/35 font-sans"
                        />
                      </div>
                    </div>

                    {/* 3. PARENTS/GUARDIAN'S SIGNATURE */}
                    <div className="mt-3 text-[10px]">
                      <h4 className="font-bold text-[10.5px] text-center uppercase tracking-wide mb-1.5">
                        PARENTS/GUARDIAN'S SIGNATURE
                      </h4>
                      <p className="mb-1 flex items-center gap-2">
                        <span className="font-semibold w-14">Term 1</span>
                        <span className="flex-1 border-b border-black"></span>
                      </p>
                      <p className="mb-1 flex items-center gap-2">
                        <span className="font-semibold w-14">Term 2</span>
                        <span className="flex-1 border-b border-black"></span>
                      </p>
                      <p className="mb-2 flex items-center gap-2">
                        <span className="font-semibold w-14">Term 3</span>
                        <span className="flex-1 border-b border-black"></span>
                      </p>
                    </div>
                  </div>

                  <div>
                    {/* 4. CERTIFICATE OF TRANSFER */}
                    <div className="mt-2 pt-2 border-t border-black/30 text-[9.5px]">
                      <h4 className="font-bold text-[10.5px] text-center uppercase tracking-wide mb-1">
                        CERTIFICATE OF TRANSFER
                      </h4>
                      <p className="text-[9px] leading-tight mb-1.5">
                        This is to certify that the above-named learner has satisfactorily completed the requirements for the grade level indicated.
                      </p>
                      <p className="mb-1 flex items-center gap-2">
                        <span className="font-semibold">Admitted to Grade:</span>
                        <span className="flex-1 border-b border-black"></span>
                      </p>
                      <p className="mb-2 flex items-center gap-2">
                        <span className="font-semibold">Eligible for Admission to Grade:</span>
                        <span className="flex-1 border-b border-black"></span>
                      </p>

                      <div className="mt-3">
                        <span className="font-bold text-[9.5px]">Approved:</span>
                        <div className="grid grid-cols-2 gap-4 text-center mt-2">
                          <div>
                            <p className="font-bold text-[10px]">{data.school_info.principal_name || "School Head"}</p>
                            <div className="border-t border-black mx-auto w-3/4 mt-0.5"></div>
                            <p className="text-[8.5px] text-black/75">School Head</p>
                          </div>
                          <div>
                            <p className="font-bold text-[10px]">{data.class_info.adviser_name || "Adviser"}</p>
                            <div className="border-t border-black mx-auto w-3/4 mt-0.5"></div>
                            <p className="text-[8.5px] text-black/75">Adviser</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 5. CANCELLATION OF ELIGIBILITY TO TRANSFER */}
                    <div className="mt-3 pt-1 text-[9px]">
                      <h5 className="font-bold text-[9.5px] text-center uppercase tracking-wide mb-1">
                        CANCELLATION OF ELIGIBILITY TO TRANSFER
                      </h5>
                      <div className="flex items-center justify-between gap-4 mb-2">
                        <p className="flex-1 flex items-center gap-1">
                          <span className="font-semibold">Admitted in:</span>
                          <span className="flex-1 border-b border-black"></span>
                        </p>
                        <p className="w-1/3 flex items-center gap-1">
                          <span className="font-semibold">Date:</span>
                          <span className="flex-1 border-b border-black"></span>
                        </p>
                      </div>
                      <div className="text-center w-1/2 mx-auto">
                        <div className="border-t border-black mt-2"></div>
                        <p className="text-[8.5px] text-black/75">School Head</p>
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            </div>
          )}
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
