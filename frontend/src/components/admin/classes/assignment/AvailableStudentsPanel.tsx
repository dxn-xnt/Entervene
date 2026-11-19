import { useDroppable } from "@dnd-kit/core";
import { useMemo, useState } from "react";
import type { ClassAssignmentStudent } from "@/types/adminClasses";
import { matchesStudentSearch, sortAssignmentStudents } from "./studentSorting";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Progress } from "@/components/retroui/Progress";
import { CheckCheck } from "lucide-react";
import GenderStudentTable from "./GenderStudentTable";

export default function AvailableStudentsPanel({
  students,
  assignedCount,
  totalStudentCount,
  selectedIds,
  onSelect,
  onSelectVisible,
}: {
  students: ClassAssignmentStudent[];
  assignedCount: number;
  totalStudentCount: number;
  selectedIds: Set<string>;
  onSelect: (studentId: string, selected: boolean) => void;
  onSelectVisible: (studentIds: string[], selected: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const { setNodeRef, isOver } = useDroppable({
    id: "drop:unassigned",
    data: { location: "unassigned" },
  });
  const visible = useMemo(
    () =>
      sortAssignmentStudents(students).filter((student) =>
        matchesStudentSearch(student, search),
      ),
    [students, search],
  );

  return (
    <section
      ref={setNodeRef}
      className={`grid min-h-0 grid-rows-[auto_auto_auto_minmax(0,1fr)] gap-2 rounded! border-2 border-black p-3 ${isOver ? "bg-[#d8efca]" : "bg-white"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-bold">Unassigned Students</h3>
        <p className="shrink-0 text-xs font-semibold">
          {students.length} remaining
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search student..."
          className="min-w-52 flex-1 shadow-none"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          autoIcon={false}
          disabled={!visible.length}
          onClick={() =>
            onSelectVisible(
              visible.map((student) => student.student_id),
              true,
            )
          }
          className=" shadow-none gap-2 bg-white hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CheckCheck className="size-4" />
          Select All Visible
        </Button>
      </div>
      <div>
        <div className="flex justify-between text-[11px] font-semibold">
          <span>
            Assigned: {assignedCount} / {totalStudentCount}
          </span>
          <span>
            {totalStudentCount
              ? Math.round((assignedCount / totalStudentCount) * 100)
              : 0}
            %
          </span>
        </div>
        <Progress
          value={totalStudentCount ? (assignedCount / totalStudentCount) * 100 : 0}
          className="mt-1 h-2"
          indicatorClassName="bg-success"
        />
      </div>
      <div className="min-h-0 overflow-y-auto pr-1">
        {!students.length && (
          <p className="py-3 text-xs">
            No unassigned students are available for this academic level.
          </p>
        )}
        {!!students.length && !visible.length && (
          <p className="py-3 text-xs">No students match your search.</p>
        )}
        {!!visible.length && (
          <GenderStudentTable
            students={visible}
            location="unassigned"
            selectedIds={selectedIds}
            onSelect={onSelect}
          />
        )}
      </div>
    </section>
  );
}
