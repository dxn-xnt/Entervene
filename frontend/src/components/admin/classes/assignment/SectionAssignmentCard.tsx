import { useDroppable } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useState } from "react";
import type {
  ClassAssignmentStudent,
  ManualSectionDraft,
} from "@/types/adminClasses";
import GenderStudentTable from "./GenderStudentTable";
import { assignmentGenderGroup } from "./studentSorting";
import { Button } from "@/components/retroui/Button";
import { Progress } from "@/components/retroui/Progress";

export default function SectionAssignmentCard({
  section,
  students,
  selectedIds,
  recommendedTarget,
  showEmptyError,
  onSelect,
  onRemove,
  onViewDetails,
}: {
  section: ManualSectionDraft;
  students: ClassAssignmentStudent[];
  selectedIds: Set<string>;
  recommendedTarget: number;
  showEmptyError: boolean;
  onSelect: (studentId: string, selected: boolean) => void;
  onRemove: (studentId: string) => void;
  onViewDetails: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop:${section.localId}`,
    data: { location: section.localId },
  });
  const [expanded, setExpanded] = useState(false);
  const counts = {
    male: students.filter(
      (student) => assignmentGenderGroup(student.gender) === "male",
    ).length,
    female: students.filter(
      (student) => assignmentGenderGroup(student.gender) === "female",
    ).length,
  };
  const progress = recommendedTarget
    ? Math.min((students.length / recommendedTarget) * 100, 100)
    : 0;

  return (
    <section
      ref={setNodeRef}
      className={`grid content-start gap-2 rounded! border-2 p-3 ${isOver ? "border-black bg-[#d8efca]" : showEmptyError ? "border-red-600 bg-red-50" : "border-black bg-white"}`}
    >
      <div>
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-lg font-bold leading-tight">{section.sectionName}</h3>
          <span className="text-sm font-bold">
            {students.length} / {recommendedTarget}
          </span>
        </div>
        <p className="text-sm text-foreground">
          Adviser: {section.adviserName || "Not available"}
        </p>
        <p className="text-xs text-muted-foreground">Recommended: {recommendedTarget}</p>
        <Progress
          value={progress}
          className="mt-1 h-2"
          indicatorClassName="bg-success"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <span>Male: {counts.male}</span>
        <span>Female: {counts.female}</span>
      </div>
      {!students.length && (
        <p className="py-3 text-center text-sm font-semibold">
          Drop students here
        </p>
      )}
      {!!students.length && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          autoIcon={false}
          className="h-auto w-full justify-start rounded-none border-t border-black/20 px-0 pt-2 pb-0 text-left text-xs font-semibold shadow-none hover:translate-y-0 hover:bg-transparent"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          {expanded ? "Hide Student Lists" : "Show Student Lists"}
        </Button>
      )}
      {expanded && (
        <div className="max-h-52 overflow-y-auto pr-1">
          <GenderStudentTable
            students={students}
            location={section.localId}
            selectedIds={selectedIds}
            compact
            columns
            onSelect={onSelect}
            onRemove={onRemove}
          />
        </div>
      )}
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          autoIcon={false}
          className="gap-2 bg-white text-sm font-semibold shadow-none hover:bg-white"
          onClick={onViewDetails}
        >
          <ExternalLink className="size-4" />
          View Details
        </Button>
      </div>
    </section>
  );
}
