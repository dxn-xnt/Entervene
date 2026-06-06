import { useDraggable } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import type { ClassAssignmentStudent } from "@/types/adminClasses";
import { assignmentStudentName, compactAssignmentStudentName } from "./studentSorting";

export default function AssignmentStudentRow({ student, location, number, selected, compact = false, onSelect, onRemove }: {
  student: ClassAssignmentStudent;
  location: string;
  number: number;
  selected: boolean;
  compact?: boolean;
  onSelect: (studentId: string, selected: boolean) => void;
  onRemove?: (studentId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `student:${student.student_id}`,
    data: { studentId: student.student_id, location },
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
      className={`flex min-h-8 items-center gap-1.5 border-b border-black/15 px-1 py-1 text-[11px] last:border-b-0 ${selected ? "bg-[#fff8d7]" : ""} ${isDragging ? "z-20 opacity-60" : ""}`}
    >
      <input
        aria-label={`Select ${assignmentStudentName(student)}`}
        type="checkbox"
        checked={selected}
        onChange={(event) => onSelect(student.student_id, event.target.checked)}
        className="shrink-0"
      />
      <span className="w-5 shrink-0 text-right font-semibold">{number}.</span>
      <div className={`grid min-w-0 flex-1 gap-x-2 ${compact ? "" : "sm:grid-cols-[minmax(0,1fr)_auto]"}`}>
        <p className="break-words font-bold leading-snug">{compact ? compactAssignmentStudentName(student) : assignmentStudentName(student)}</p>
        {!compact && <p className="text-[10px] text-black/65">LRN: {student.student_lrn}</p>}
      </div>
      {onRemove && <button className="shrink-0 font-semibold underline" onClick={() => onRemove(student.student_id)}>Remove</button>}
      <button aria-label={`Drag ${assignmentStudentName(student)}`} className="cursor-grab p-1 active:cursor-grabbing" {...listeners} {...attributes}>
        <GripVertical className="size-4" />
      </button>
    </div>
  );
}
