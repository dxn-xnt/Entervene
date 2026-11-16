import type { TeacherAdvisoryStudentSF9Data } from "@/lib/api";

export type SF9PrintableCardProps = {
  data: TeacherAdvisoryStudentSF9Data;
  comments?: { term1?: string; term2?: string; term3?: string };
  onCommentChange?: (term: 1 | 2 | 3, value: string) => void;
  isInteractive?: boolean;
  id?: string;
  className?: string;
};

export function SF9PrintableCard({
  data,
  comments,
  onCommentChange,
  isInteractive = false,
  id = "sf9-printable-card",
  className = "",
}: SF9PrintableCardProps) {
  const term1 = comments?.term1 || "";
  const term2 = comments?.term2 || "";
  const term3 = comments?.term3 || "";

  const schoolInfo = data?.school_info || {
    school_name: "Entervene Demonstration School",
    school_id: "303012",
    region: "Region IV-A",
    division: "Schools Division Office",
    district: "District I",
    municipality: "Municipality",
    principal_name: "Principal / School Head",
  };
  const student = data?.student || {
    student_id: "",
    full_name: "Student Name",
    student_lrn: "",
    gender: "Male",
    age: 14,
    dob: null,
    track: "",
  };
  const classInfo = data?.class_info || {
    class_id: 0,
    section_name: "",
    grade_level: "",
    academic_year: "2026-2027",
    adviser_name: "Adviser",
  };
  const periods = data?.periods || [];
  const learningAreas = data?.learning_areas || { core: [], electives: [] };
  const generalAverage = data?.general_average || {
    final_rating: null,
    descriptor: null,
    remarks: "",
  };
  const descriptors = data?.descriptors || [];
  const attendance = data?.attendance || {
    months: [],
    total: { class_days: 0, present: 0, absent: 0 },
  };

  return (
    <div
      id={id}
      data-student-id={student.student_id}
      className={`card-grid grid grid-cols-2 gap-6 bg-white text-black text-[11px] leading-tight ${className}`}
      style={{ boxSizing: "border-box" }}
    >
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
              <p className="text-[9.5px] text-black font-medium">{schoolInfo.region}</p>
              <p className="header-div font-bold text-[9.5px] uppercase text-black">
                SCHOOLS DIVISION OFFICE OF {schoolInfo.division}
              </p>
              <p className="text-[9.5px] text-black">District {schoolInfo.district}</p>
              <p className="text-[9px] text-black/80">{schoolInfo.municipality}</p>

              {/* School Name */}
              <p className="font-extrabold text-[10.5px] uppercase tracking-wide text-black mt-1">
                {schoolInfo.school_name}
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
            <p className="text-[10px] font-bold">School Year {classInfo.academic_year}</p>
          </div>

          {/* Student Metadata Table */}
          <table className="meta-table w-full text-[10px] my-2 border-collapse">
            <tbody>
              <tr>
                <td className="w-1/2">
                  <span className="font-bold">Name: </span>
                  <span className="underline font-semibold">{student.full_name}</span>
                </td>
                <td className="w-1/4">
                  <span className="font-bold">Age: </span>
                  <span className="underline font-medium">{student.age ?? "-"}</span>
                </td>
                <td className="w-1/4">
                  <span className="font-bold">Sex: </span>
                  <span className="underline font-medium">{student.gender || "-"}</span>
                </td>
              </tr>
              <tr>
                <td>
                  <span className="font-bold">LRN: </span>
                  <span className="underline font-semibold">{student.student_lrn || "-"}</span>
                </td>
                <td>
                  <span className="font-bold">Grade: </span>
                  <span className="underline font-medium">{classInfo.grade_level}</span>
                </td>
                <td>
                  <span className="font-bold">Section: </span>
                  <span className="underline font-medium">{classInfo.section_name}</span>
                </td>
              </tr>
              <tr>
                <td colSpan={3}>
                  <span className="font-bold">Track (SHS only): </span>
                  <span className="underline font-medium">{student.track || "—"}</span>
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
                  <th colSpan={periods.length || 3} className="border border-black p-1 text-center font-bold">
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
                  {periods.map((p, idx) => (
                    <th key={p.academic_period_id} className="border border-black p-0.5 text-center font-bold w-8">
                      {p.period_sequence || idx + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Core Subjects */}
                {learningAreas.core.length > 0 && (
                  <>
                    <tr className="section-header-row bg-[#F2F2F2]">
                      <td colSpan={periods.length + 3} className="border border-black px-1.5 py-0.5 font-bold">
                        Core Subjects
                      </td>
                    </tr>
                    {learningAreas.core.map((subj) => (
                      <tr key={subj.subject_id} className="hover:bg-black/5">
                        <td className="border border-black px-1.5 py-0.5 font-medium">
                          {subj.subject_name}
                        </td>
                        {periods.map((p, pIdx) => {
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
                {learningAreas.electives.length > 0 && (
                  <>
                    <tr className="section-header-row bg-[#F2F2F2]">
                      <td colSpan={periods.length + 3} className="border border-black px-1.5 py-0.5 font-bold">
                        Elective Subjects
                      </td>
                    </tr>
                    {learningAreas.electives.map((subj) => (
                      <tr key={subj.subject_id} className="hover:bg-black/5">
                        <td className="border border-black px-1.5 py-0.5 font-medium">
                          {subj.subject_name}
                        </td>
                        {periods.map((p, pIdx) => {
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
                  <td colSpan={periods.length + 1} className="border border-black px-1.5 py-1 text-right">
                    General Average
                  </td>
                  <td className="border border-black text-center p-1 font-mono text-[10px]">
                    {generalAverage.final_rating !== null ? generalAverage.final_rating.toFixed(1) : "—"}
                  </td>
                  <td className="border border-black text-center p-1 text-[9.5px]">
                    {generalAverage.remarks}
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
              {descriptors.map((d) => (
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
                  {attendance.months.map((m) => (
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
                  {attendance.months.map((m) => (
                    <td key={m.month} className="border border-black text-center p-0.5 font-mono">
                      {m.class_days || ""}
                    </td>
                  ))}
                  <td className="border border-black text-center p-0.5 font-bold font-mono">
                    {attendance.total.class_days || ""}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-1 py-0.5 font-medium">No. of Days Present</td>
                  {attendance.months.map((m) => (
                    <td key={m.month} className="border border-black text-center p-0.5 font-mono">
                      {m.present || ""}
                    </td>
                  ))}
                  <td className="border border-black text-center p-0.5 font-bold font-mono">
                    {attendance.total.present || ""}
                  </td>
                </tr>
                <tr>
                  <td className="border border-black px-1 py-0.5 font-medium">No. of Days Absent</td>
                  {attendance.months.map((m) => (
                    <td key={m.month} className="border border-black text-center p-0.5 font-mono">
                      {m.absent || ""}
                    </td>
                  ))}
                  <td className="border border-black text-center p-0.5 font-bold font-mono">
                    {attendance.total.absent || ""}
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

            <div className="comment-box border border-black p-1.5 mb-2 rounded-sm bg-white min-h-[36px]">
              <span className="font-bold text-[9.5px] block mb-1">Term 1</span>
              {isInteractive ? (
                <textarea
                  rows={2}
                  value={term1}
                  onChange={(e) => onCommentChange?.(1, e.target.value)}
                  placeholder="Type Term 1 comments or teacher remarks..."
                  className="w-full text-[9.5px] resize-none border-0 p-0 focus:outline-none focus:ring-0 bg-transparent placeholder:text-black/35 font-sans"
                />
              ) : (
                <p className="text-[9.5px] leading-snug whitespace-pre-wrap font-sans text-black">
                  {term1}
                </p>
              )}
            </div>

            <div className="comment-box border border-black p-1.5 mb-2 rounded-sm bg-white min-h-[36px]">
              <span className="font-bold text-[9.5px] block mb-1">Term 2</span>
              {isInteractive ? (
                <textarea
                  rows={2}
                  value={term2}
                  onChange={(e) => onCommentChange?.(2, e.target.value)}
                  placeholder="Type Term 2 comments or teacher remarks..."
                  className="w-full text-[9.5px] resize-none border-0 p-0 focus:outline-none focus:ring-0 bg-transparent placeholder:text-black/35 font-sans"
                />
              ) : (
                <p className="text-[9.5px] leading-snug whitespace-pre-wrap font-sans text-black">
                  {term2}
                </p>
              )}
            </div>

            <div className="comment-box border border-black p-1.5 mb-2 rounded-sm bg-white min-h-[36px]">
              <span className="font-bold text-[9.5px] block mb-1">Term 3</span>
              {isInteractive ? (
                <textarea
                  rows={2}
                  value={term3}
                  onChange={(e) => onCommentChange?.(3, e.target.value)}
                  placeholder="Type Term 3 comments or teacher remarks..."
                  className="w-full text-[9.5px] resize-none border-0 p-0 focus:outline-none focus:ring-0 bg-transparent placeholder:text-black/35 font-sans"
                />
              ) : (
                <p className="text-[9.5px] leading-snug whitespace-pre-wrap font-sans text-black">
                  {term3}
                </p>
              )}
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
                  <p className="font-bold text-[10px]">{schoolInfo.principal_name || "School Head"}</p>
                  <div className="border-t border-black mx-auto w-3/4 mt-0.5"></div>
                  <p className="text-[8.5px] text-black/75">School Head</p>
                </div>
                <div>
                  <p className="font-bold text-[10px]">{classInfo.adviser_name || "Adviser"}</p>
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
  );
}
