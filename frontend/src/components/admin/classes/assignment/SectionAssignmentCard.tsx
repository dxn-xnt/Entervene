import { useDroppable } from "@dnd-kit/core";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { ClassAssignmentStudent, ManualSectionDraft } from "@/types/adminClasses";
import GenderStudentTable from "./GenderStudentTable";
import { assignmentGenderGroup } from "./studentSorting";
import { retroButton } from "../utils";

export default function SectionAssignmentCard({ section, students, selectedIds, recommendedTarget, showEmptyError, onSelect, onRemove, onViewDetails }: {
  section: ManualSectionDraft;
  students: ClassAssignmentStudent[];
  selectedIds: Set<string>;
  recommendedTarget: number;
  showEmptyError: boolean;
  onSelect: (studentId: string, selected: boolean) => void;
  onRemove: (studentId: string) => void;
  onViewDetails: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop:${section.localId}`, data: { location: section.localId } });
  const [expanded, setExpanded] = useState(false);
  const counts = {
    male: students.filter((student) => assignmentGenderGroup(student.gender) === "male").length,
    female: students.filter((student) => assignmentGenderGroup(student.gender) === "female").length,
  };
  const progress = recommendedTarget ? Math.min((students.length / recommendedTarget) * 100, 100) : 0;

  return (
    <section ref={setNodeRef} className={`grid content-start gap-2 rounded-md border-2 p-3 ${isOver ? "border-black bg-[#d8efca]" : showEmptyError ? "border-red-600 bg-red-50" : "border-black bg-white"}`}>
      <div>
        <div className="flex items-start justify-between gap-2"><h3 className="font-bold">{section.sectionName}</h3><span className="text-xs font-bold">{students.length} / {recommendedTarget}</span></div>
        <p className="text-xs">Adviser: {section.adviserName || "Not available"}</p>
        <p className="text-[11px]">Recommended: {recommendedTarget}</p>
        <div className="mt-1 h-2 overflow-hidden rounded-full border border-black bg-white"><div className="h-full bg-[#79bd80]" style={{ width: `${progress}%` }} /></div>
      </div>
      <div className="grid grid-cols-2 gap-1 text-[10px]"><span>Male: {counts.male}</span><span>Female: {counts.female}</span></div>
      {!students.length && <p className="py-2 text-center text-xs font-semibold">Drop students here</p>}
      {!!students.length && (
        <button className="flex items-center gap-1 border-t border-black/20 pt-2 text-left text-xs font-semibold" onClick={() => setExpanded((value) => !value)}>
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />} {expanded ? "Hide Student Lists" : "Show Student Lists"}
        </button>
      )}
      {expanded && <div className="max-h-52 overflow-y-auto pr-1"><GenderStudentTable students={students} location={section.localId} selectedIds={selectedIds} compact columns onSelect={onSelect} onRemove={onRemove} /></div>}
      <div className="flex justify-end">
        <button className={retroButton("px-2 py-1 text-xs")} onClick={onViewDetails}>View Details</button>
      </div>
    </section>
  );
}
