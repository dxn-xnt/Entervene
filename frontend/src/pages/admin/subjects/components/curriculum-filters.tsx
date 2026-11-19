import { useEffect, useMemo } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import type { SubjectAcademicLevel, SubjectOfferingPathway, SubjectStatus } from "@/lib/api";

export type CurriculumGradeValue = "all" | string;
export type CurriculumPathwayValue = SubjectOfferingPathway | "all";
export type CurriculumStatusValue = SubjectStatus | "all";

type CurriculumFiltersProps = {
  search: string;
  grade: CurriculumGradeValue;
  pathway: CurriculumPathwayValue;
  status: CurriculumStatusValue;
  academicLevels?: SubjectAcademicLevel[];
  onSearchChange: (value: string) => void;
  onGradeChange: (value: CurriculumGradeValue) => void;
  onPathwayChange: (value: CurriculumPathwayValue) => void;
  onStatusChange: (value: CurriculumStatusValue) => void;
  onReset: () => void;
};

const DEFAULT_GRADE_OPTIONS: Array<{ value: CurriculumGradeValue; label: string; gradeLevel: number }> = [
  { value: "7", label: "Grade 7", gradeLevel: 7 },
  { value: "8", label: "Grade 8", gradeLevel: 8 },
  { value: "9", label: "Grade 9", gradeLevel: 9 },
  { value: "10", label: "Grade 10", gradeLevel: 10 },
  { value: "11", label: "Grade 11", gradeLevel: 11 },
  { value: "12", label: "Grade 12", gradeLevel: 12 },
];
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
  academicLevels,
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
      ? ["all", ...shsPathways]
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

  const gradeList = useMemo(() => {
    if (academicLevels && academicLevels.length > 0) {
      const byLevel = new Map<number, { value: CurriculumGradeValue; label: string; gradeLevel: number }>();
      academicLevels.forEach((lvl) => {
        if (lvl.grade_level >= 7 && lvl.grade_level <= 12) {
          byLevel.set(lvl.academic_level_id, {
            value: String(lvl.grade_level),
            label: lvl.level_name,
            gradeLevel: lvl.grade_level,
          });
        }
      });
      const sorted = Array.from(byLevel.values()).sort((a, b) => a.gradeLevel - b.gradeLevel);
      if (sorted.length > 0) {
        return [{ value: "all" as CurriculumGradeValue, label: "All" }, ...sorted];
      }
    }
    return [{ value: "all" as CurriculumGradeValue, label: "All" }, ...DEFAULT_GRADE_OPTIONS];
  }, [academicLevels]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_220px_180px_auto]">
        <label className="relative min-w-0 sm:col-span-2 lg:col-span-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
          <Input
            variant="search"
            className="w-full"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search subject or code"
          />
        </label>
        <Select
          value={effectivePathway}
          onValueChange={(value) => onPathwayChange(value as CurriculumPathwayValue)}
          disabled={isJhs}
        >
          <Select.Trigger className="w-full">
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
          <Select.Trigger className="w-full">
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
        <Button type="button" className="h-10 gap-2" variant="outline" onClick={onReset}>
          Reset
        </Button>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <span className="shrink-0 text-sm font-regular text-muted-foreground">
          Grade:
        </span>
        {gradeList.map((item) => (
          <Button
            key={item.value}
            autoIcon={false}
            variant={grade === item.value ? "default" : "outline"}
            size="sm"
            onClick={() => handleGradeChange(item.value)}
            className="shrink-0 border-black shadow-none"
          >
            {item.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
