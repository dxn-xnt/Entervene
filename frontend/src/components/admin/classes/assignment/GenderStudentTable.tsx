import type { ClassAssignmentStudent } from "@/types/adminClasses";
import AssignmentStudentRow from "./AssignmentStudentRow";
import { assignmentGenderGroup, sortAssignmentStudents } from "./studentSorting";

export default function GenderStudentTable({ students, location, selectedIds, compact = false, columns = false, onSelect, onRemove }: {
  students: ClassAssignmentStudent[];
  location: string;
  selectedIds: Set<string>;
  compact?: boolean;
  columns?: boolean;
  onSelect: (studentId: string, selected: boolean) => void;
  onRemove?: (studentId: string) => void;
}) {
  const sorted = sortAssignmentStudents(students);
  const male = sorted.filter((student) => assignmentGenderGroup(student.gender) === "male");
  const female = sorted.filter((student) => assignmentGenderGroup(student.gender) === "female");

  if (columns) {
    return (
      <div className="grid gap-2 md:grid-cols-2">
        <GenderColumn title="Male Students" students={male} location={location} selectedIds={selectedIds} compact={compact} onSelect={onSelect} onRemove={onRemove} />
        <GenderColumn title="Female Students" students={female} location={location} selectedIds={selectedIds} compact={compact} onSelect={onSelect} onRemove={onRemove} />
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="grid gap-2">
        <GenderColumn title="Male Students" students={male} location={location} selectedIds={selectedIds} compact={compact} onSelect={onSelect} onRemove={onRemove} />
        <GenderColumn title="Female Students" students={female} location={location} selectedIds={selectedIds} compact={compact} onSelect={onSelect} onRemove={onRemove} />
      </div>
    </div>
  );
}

function GenderColumn({ title, students, location, selectedIds, compact, onSelect, onRemove }: {
  title: string;
  students: ClassAssignmentStudent[];
  location: string;
  selectedIds: Set<string>;
  compact: boolean;
  onSelect: (studentId: string, selected: boolean) => void;
  onRemove?: (studentId: string) => void;
}) {
  return (
    <div className="min-w-0">
      <p className="sticky top-0 z-10 border-b border-black/30 bg-white py-1 text-xs font-bold">{title} ({students.length})</p>
      {students.map((student, index) => (
        <AssignmentStudentRow
          key={student.student_id}
          student={student}
          location={location}
          number={index + 1}
          selected={selectedIds.has(student.student_id)}
          compact={compact}
          onSelect={onSelect}
          onRemove={onRemove}
        />
      ))}
      {!students.length && <p className="py-2 text-[11px] text-black/50">No students</p>}
    </div>
  );
}
