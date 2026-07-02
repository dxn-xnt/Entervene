import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import type { GradingTemplateSubjectOption, SubjectAcademicLevel } from "@/lib/api";

const ANY_GRADE = "any";

type TemplateSubjectPickerProps = {
  subjects: GradingTemplateSubjectOption[];
  academicLevels: SubjectAcademicLevel[];
  selectedSubjectId: string;
  onChange: (subjectId: string) => void;
  allowClear?: boolean;
  disabled?: boolean;
  placeholder?: string;
};

function subjectCode(subject: GradingTemplateSubjectOption) {
  return subject.subject_codename || "No code";
}

export function TemplateSubjectPicker({
  subjects,
  academicLevels,
  selectedSubjectId,
  onChange,
  allowClear = true,
  disabled = false,
  placeholder = "Search subject or code",
}: TemplateSubjectPickerProps) {
  const [query, setQuery] = useState("");
  const [gradeFilter, setGradeFilter] = useState(ANY_GRADE);
  const levelById = useMemo(
    () => new Map(academicLevels.map((level) => [level.academic_level_id, level])),
    [academicLevels]
  );
  const selectedSubject = useMemo(
    () => subjects.find((subject) => String(subject.subject_id) === selectedSubjectId) ?? null,
    [selectedSubjectId, subjects]
  );
  const gradeOptions = useMemo(() => {
    const levelIds = new Set(subjects.map((subject) => subject.academic_level_id));
    return academicLevels
      .filter((level) => levelIds.has(level.academic_level_id))
      .sort((a, b) => a.grade_level - b.grade_level);
  }, [academicLevels, subjects]);
  const filteredSubjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return subjects.filter((subject) => {
      const matchesGrade = gradeFilter === ANY_GRADE || String(subject.academic_level_id) === gradeFilter;
      const matchesSearch = !normalizedQuery || [
        subject.subject_name,
        subject.subject_codename,
        levelById.get(subject.academic_level_id)?.level_name,
      ].some((value) => value?.toLowerCase().includes(normalizedQuery));
      return matchesGrade && matchesSearch;
    });
  }, [gradeFilter, levelById, query, subjects]);

  const handleSelect = (subjectId: string) => {
    if (disabled) return;
    onChange(subjectId === selectedSubjectId && allowClear ? "none" : subjectId);
  };

  const handleClear = () => {
    if (disabled) return;
    onChange("none");
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border-2 border-black bg-[#fff7d6] p-3 text-sm shadow-[2px_2px_0_#000]">
        Current backend supports assigning one subject per grading template. Multi-subject template assignment requires a backend relationship update.
      </div>

      {selectedSubject ? (
        <div className="flex flex-col gap-2 rounded-md border-2 border-black bg-[#fff1b8] p-3 shadow-[2px_2px_0_#000] sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-bold">{selectedSubject.subject_name}</p>
            <p className="text-xs text-black/70">
              {subjectCode(selectedSubject)} • {levelById.get(selectedSubject.academic_level_id)?.level_name ?? "Grade scope"}
            </p>
          </div>
          {allowClear ? (
            <Button type="button" size="sm" variant="outline" onClick={handleClear} disabled={disabled}>
              <X className="mr-1 size-4" /> Clear
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="rounded-md border-2 border-black bg-background p-3 text-sm font-semibold shadow-[2px_2px_0_#000]">
          No subject selected. This template can be used as a general/default template.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px]">
        <label className="relative min-w-0">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
          <Input
            className="h-10 w-full pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            disabled={disabled}
          />
        </label>
        <Select value={gradeFilter} onValueChange={setGradeFilter} disabled={disabled}>
          <Select.Trigger className="h-10 w-full">
            <Select.Value placeholder="Grade" />
          </Select.Trigger>
          <Select.Content>
            <Select.Group>
              <Select.Item value={ANY_GRADE}>Any grade</Select.Item>
              {gradeOptions.map((level) => (
                <Select.Item key={level.academic_level_id} value={String(level.academic_level_id)}>
                  {level.level_name}
                </Select.Item>
              ))}
            </Select.Group>
          </Select.Content>
        </Select>
      </div>

      <div className="max-h-72 overflow-y-auto rounded-md border-2 border-black bg-background">
        {filteredSubjects.length === 0 ? (
          <p className="p-3 text-sm text-black/70">
            {subjects.length ? "No subjects match your search." : "No subjects are available for this scope."}
          </p>
        ) : (
          filteredSubjects.map((subject) => {
            const subjectId = String(subject.subject_id);
            const isSelected = subjectId === selectedSubjectId;
            return (
              <button
                key={subject.subject_id}
                type="button"
                className={`grid w-full grid-cols-1 gap-1 border-b border-black/20 p-3 text-left text-sm last:border-b-0 hover:bg-[#fff7d6] md:grid-cols-[1.5fr_120px_140px] ${
                  isSelected ? "bg-[#bbf7d0]" : "bg-background"
                }`}
                onClick={() => handleSelect(subjectId)}
                disabled={disabled}
              >
                <strong className="truncate">{subject.subject_name}</strong>
                <span>{subjectCode(subject)}</span>
                <span>{levelById.get(subject.academic_level_id)?.level_name ?? "Grade scope"}</span>
              </button>
            );
          })
        )}
      </div>

      <p className="text-xs text-black/70">
        Pathway-specific use is defined in Subject Offerings. Subject group is not included in the current grading-template options response.
      </p>
    </div>
  );
}
