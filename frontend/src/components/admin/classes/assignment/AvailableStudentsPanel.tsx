import { useDroppable } from "@dnd-kit/core";
import { useMemo, useState } from "react";
import type { ClassAssignmentStudent } from "@/types/adminClasses";
import { matchesStudentSearch, sortAssignmentStudents } from "./studentSorting";
import { retroButton } from "../utils";
import GenderStudentTable from "./GenderStudentTable";

export default function AvailableStudentsPanel({ students, assignedCount, totalStudentCount, selectedIds, onSelect, onSelectVisible }: {
  students: ClassAssignmentStudent[];
  assignedCount: number;
  totalStudentCount: number;
  selectedIds: Set<string>;
  onSelect: (studentId: string, selected: boolean) => void;
  onSelectVisible: (studentIds: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const { setNodeRef, isOver } = useDroppable({ id: "drop:unassigned", data: { location: "unassigned" } });
  const visible = useMemo(() => sortAssignmentStudents(students).filter((student) => matchesStudentSearch(student, search)), [students, search]);

  return (
    <section ref={setNodeRef} className={`grid min-h-0 grid-rows-[auto_auto_auto_minmax(0,1fr)] gap-2 rounded-md border-2 border-black p-3 ${isOver ? "bg-[#d8efca]" : "bg-white"}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-bold">Unassigned Students</h3>
        <p className="shrink-0 text-xs font-semibold">{students.length} remaining</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search student..." className="h-9 min-w-52 flex-1 rounded-md border border-black bg-[#fffdf5] px-3 text-sm" />
        <button disabled={!visible.length} className={retroButton("text-xs disabled:cursor-not-allowed disabled:opacity-50")} onClick={() => onSelectVisible(visible.map((student) => student.student_id))}>Select All Visible</button>
      </div>
      <div>
        <div className="flex justify-between text-[11px] font-semibold"><span>Assigned: {assignedCount} / {totalStudentCount}</span><span>{totalStudentCount ? Math.round((assignedCount / totalStudentCount) * 100) : 0}%</span></div>
        <div className="mt-1 h-2 overflow-hidden rounded-full border border-black bg-white"><div className="h-full bg-[#79bd80]" style={{ width: `${totalStudentCount ? (assignedCount / totalStudentCount) * 100 : 0}%` }} /></div>
      </div>
      <div className="min-h-0 overflow-y-auto pr-1">
        {!students.length && <p className="py-3 text-xs">No unassigned students are available for this academic level.</p>}
        {!!students.length && !visible.length && <p className="py-3 text-xs">No students match your search.</p>}
        {!!visible.length && <GenderStudentTable students={visible} location="unassigned" selectedIds={selectedIds} onSelect={onSelect} />}
      </div>
    </section>
  );
}
