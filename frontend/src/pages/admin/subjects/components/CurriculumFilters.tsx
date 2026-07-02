import { useEffect } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import type { SubjectOfferingPathway, SubjectStatus } from "@/lib/api";

export type CurriculumGradeValue = "all" | "7" | "8" | "9" | "10" | "11" | "12";
export type CurriculumPathwayValue = SubjectOfferingPathway | "all";
export type CurriculumStatusValue = SubjectStatus | "all";

type CurriculumFiltersProps = {
  search: string;
  grade: CurriculumGradeValue;
  pathway: CurriculumPathwayValue;
  status: CurriculumStatusValue;
  onSearchChange: (value: string) => void;
  onGradeChange: (value: CurriculumGradeValue) => void;
  onPathwayChange: (value: CurriculumPathwayValue) => void;
  onStatusChange: (value: CurriculumStatusValue) => void;
  onReset: () => void;
};

const gradeOptions: CurriculumGradeValue[] = ["all", "7", "8", "9", "10", "11", "12"];
const shsPathways: SubjectOfferingPathway[] = ["both", "stem_medical", "stem_engineering"];

function isJuniorHighGrade(grade: CurriculumGradeValue) {
  return grade === "7" || grade === "8" || grade === "9" || grade === "10";
}

function isSeniorHighGrade(grade: CurriculumGradeValue) {
  return grade === "11" || grade === "12";
}

function pathwayLabel(pathway: CurriculumPathwayValue) {
  if (pathway === "all") return "All pathways";
  if (pathway === "general") return "General";
  if (pathway === "both") return "Shared / Both";
  if (pathway === "stem_medical") return "STEM Medical";
  return "STEM Engineering";
}

export function CurriculumFilters({
  search,
  grade,
  pathway,
  status,
  onSearchChange,
  onGradeChange,
  onPathwayChange,
  onStatusChange,
  onReset,
}: CurriculumFiltersProps) {
  const isJhs = isJuniorHighGrade(grade);
  const isShs = isSeniorHighGrade(grade);
  const effectivePathway = isJhs ? "general" : pathway;
  const pathwayOptions: CurriculumPathwayValue[] = isJhs
    ? ["general"]
    : isShs
      ? shsPathways
      : ["all", "general", ...shsPathways];

  useEffect(() => {
    if (isJhs && pathway !== "general") {
      onPathwayChange("general");
    }
  }, [isJhs, onPathwayChange, pathway]);

  const handleGradeChange = (value: string) => {
    const nextGrade = value as CurriculumGradeValue;
    onGradeChange(nextGrade);
    if (isJuniorHighGrade(nextGrade)) {
      onPathwayChange("general");
    }
  };

  return (
    <div className="rounded-lg border-2 border-black bg-background p-3 shadow-[3px_3px_0_#000]">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_160px_220px_180px_auto]">
        <label className="relative min-w-0">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
          <Input
            className="h-10 w-full pl-9"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search subject or code"
          />
        </label>
        <Select value={grade} onValueChange={handleGradeChange}>
          <Select.Trigger className="h-10 w-full">
            <Select.Value placeholder="Grade" />
          </Select.Trigger>
          <Select.Content>
            <Select.Group>
              {gradeOptions.map((item) => (
                <Select.Item key={item} value={item}>
                  {item === "all" ? "All grades" : `Grade ${item}`}
                </Select.Item>
              ))}
            </Select.Group>
          </Select.Content>
        </Select>
        <Select
          value={effectivePathway}
          onValueChange={(value) => onPathwayChange(value as CurriculumPathwayValue)}
          disabled={isJhs}
        >
          <Select.Trigger className="h-10 w-full">
            <Select.Value placeholder="Pathway" />
          </Select.Trigger>
          <Select.Content>
            <Select.Group>
              {pathwayOptions.map((item) => (
                <Select.Item key={item} value={item}>
                  {pathwayLabel(item)}
                </Select.Item>
              ))}
            </Select.Group>
          </Select.Content>
        </Select>
        <Select value={status} onValueChange={(value) => onStatusChange(value as CurriculumStatusValue)}>
          <Select.Trigger className="h-10 w-full">
            <Select.Value placeholder="Status" />
          </Select.Trigger>
          <Select.Content>
            <Select.Group>
              <Select.Item value="active">Active</Select.Item>
              <Select.Item value="archived">Archived</Select.Item>
              <Select.Item value="all">All statuses</Select.Item>
            </Select.Group>
          </Select.Content>
        </Select>
        <Button type="button" className="h-10" variant="outline" onClick={onReset}>
          Reset
        </Button>
      </div>
      {isJhs ? (
        <p className="mt-2 text-xs font-semibold text-black/70">Grades 7 to 10 use the General pathway.</p>
      ) : null}
    </div>
  );
}
