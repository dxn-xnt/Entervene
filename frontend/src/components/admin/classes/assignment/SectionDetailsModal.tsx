import { X } from "lucide-react";
import type { ClassAssignmentStudent, ManualSectionDraft } from "@/types/adminClasses";
import { assignmentGenderGroup, assignmentStudentName, sortAssignmentStudents, type AssignmentGenderGroup } from "./studentSorting";

export default function SectionDetailsModal({ section, students, recommendedTarget, onClose }: {
  section: ManualSectionDraft;
  students: ClassAssignmentStudent[];
  recommendedTarget: number;
  onClose: () => void;
}) {
  const sorted = sortAssignmentStudents(students);
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/30 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-md border-2 border-black bg-[#fffdf5] shadow-[4px_4px_0_#000]">
        <div className="flex items-start justify-between border-b border-black bg-[#79bd80] p-4">
          <div>
            <h3 className="text-lg font-bold">{section.sectionName}</h3>
            <p className="text-sm">Adviser: {section.adviserName || "Not available"}</p>
          </div>
          <button aria-label="Close section details" onClick={onClose}><X className="size-5" /></button>
        </div>
        <div className="grid gap-4 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Stat label="Total" value={students.length} />
            <Stat label="Recommended" value={recommendedTarget} />
            <Stat label="Male" value={groupStudents(sorted, "male").length} />
            <Stat label="Female" value={groupStudents(sorted, "female").length} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {(["male", "female"] as AssignmentGenderGroup[]).map((group) => (
              <DetailsGroup key={group} group={group} students={groupStudents(sorted, group)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function groupStudents(students: ClassAssignmentStudent[], group: AssignmentGenderGroup) {
  return students.filter((student) => assignmentGenderGroup(student.gender) === group);
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded border border-black bg-white p-2"><p className="text-xs font-semibold">{label}</p><p className="text-lg font-bold">{value}</p></div>;
}

function DetailsGroup({ group, students }: { group: AssignmentGenderGroup; students: ClassAssignmentStudent[] }) {
  const labels = { male: "Male Students", female: "Female Students" };
  return (
    <section>
      <h4 className="border-b border-black pb-1 text-sm font-bold">{labels[group]} ({students.length})</h4>
      {!students.length && <p className="py-2 text-xs text-black/50">No students</p>}
      {students.map((student, index) => (
        <div key={student.student_id} className="grid grid-cols-[28px_1fr] border-b border-black/15 py-2 text-xs last:border-0">
          <span className="font-semibold">{index + 1}.</span>
          <div><p className="break-words font-bold">{assignmentStudentName(student)}</p><p className="text-[10px] text-black/65">LRN: {student.student_lrn}</p></div>
        </div>
      ))}
    </section>
  );
}
