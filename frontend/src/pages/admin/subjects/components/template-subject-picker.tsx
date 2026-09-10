import { useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import type { GradingTemplateSubjectOption, SubjectAcademicLevel } from "@/lib/api";

const ANY_GRADE = "any";

type TemplateSubjectPickerProps = {
  subjects: GradingTemplateSubjectOption[];
  academicLevels: SubjectAcademicLevel[];
  selectedSubjectIds: string[];
  onChange: (subjectIds: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
};

function subjectCode(subject: GradingTemplateSubjectOption) {
  return subject.subject_codename || "No code";
}

export function TemplateSubjectPicker({
  subjects,
  academicLevels,
  selectedSubjectIds,
  onChange,
  disabled = false,
  placeholder = "Search subject name or code",
}: TemplateSubjectPickerProps) {
  const [query, setQuery] = useState("");
  const [gradeFilter, setGradeFilter] = useState(ANY_GRADE);

  const levelById = useMemo(
    () => new Map(academicLevels.map((level) => [level.academic_level_id, level])),
    [academicLevels]
  );

  const selectedSet = useMemo(() => new Set(selectedSubjectIds), [selectedSubjectIds]);

  const assignedSubjects = useMemo(
    () => subjects.filter((subject) => selectedSet.has(String(subject.subject_id))),
    [selectedSet, subjects]
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

  const toggleSubject = (subjectId: string) => {
    if (disabled) return;
    if (selectedSet.has(subjectId)) {
      onChange(selectedSubjectIds.filter((id) => id !== subjectId));
    } else {
      onChange([...selectedSubjectIds, subjectId]);
    }
  };

  const removeSubject = (subjectId: string) => {
    if (disabled) return;
    onChange(selectedSubjectIds.filter((id) => id !== subjectId));
  };

  const clearAll = () => {
    if (disabled) return;
    onChange([]);
  };

  return (
    <div className="flex flex-col gap-3">
      {assignedSubjects.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-md border-2 border-black bg-[#fff1b8] p-3 shadow-[2px_2px_0_#000]">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-black/70">
              Assigned Subjects ({assignedSubjects.length})
            </p>
            <Button type="button" size="sm" variant="outline" onClick={clearAll} disabled={disabled} className="h-7 text-xs">
              Clear All
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {assignedSubjects.map((subject) => (
              <span
                key={subject.subject_id}
                className="inline-flex items-center gap-1.5 rounded-md border-2 border-black bg-white px-2.5 py-1 text-xs font-bold shadow-[2px_2px_0_#000]"
              >
                <span>{subject.subject_name}</span>
                <span className="text-black/50">({subjectCode(subject)})</span>
                <button
                  type="button"
                  onClick={() => removeSubject(String(subject.subject_id))}
                  disabled={disabled}
                  className="ml-1 rounded p-0.5 hover:bg-red-100 disabled:opacity-50"
                  title="Remove subject"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-md border-2 border-black bg-background p-3 text-sm font-medium shadow-[2px_2px_0_#000]">
          No subjects selected. This template will serve as a general template.
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

      <div className="max-h-60 overflow-y-auto rounded-md border-2 border-black bg-background shadow-[2px_2px_0_#000]">
        {filteredSubjects.length === 0 ? (
          <p className="p-3 text-sm text-black/70">
            {subjects.length ? "No subjects match your search." : "No subjects are available for this scope."}
          </p>
        ) : (
          filteredSubjects.map((subject) => {
            const subjectId = String(subject.subject_id);
            const isSelected = selectedSet.has(subjectId);
            return (
              <button
                key={subject.subject_id}
                type="button"
                className={`grid w-full grid-cols-1 items-center gap-2 border-b border-black/20 p-3 text-left text-sm last:border-b-0 hover:bg-[#fff7d6] md:grid-cols-[24px_1.5fr_120px_140px] ${
                  isSelected ? "bg-[#bbf7d0]" : "bg-background"
                }`}
                onClick={() => toggleSubject(subjectId)}
                disabled={disabled}
              >
                <div
                  className={`flex size-5 items-center justify-center rounded border border-black ${
                    isSelected ? "bg-black text-white" : "bg-white"
                  }`}
                >
                  {isSelected ? <Check className="size-3.5" /> : null}
                </div>
                <strong className="truncate">{subject.subject_name}</strong>
                <span>{subjectCode(subject)}</span>
                <span className="text-xs text-black/70">
                  {levelById.get(subject.academic_level_id)?.level_name ?? "Grade scope"}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
