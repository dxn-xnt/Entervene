import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { Checkbox } from "@/components/retroui/Checkbox";
import { Input } from "@/components/retroui/Input";
import type { SubjectListItem } from "@/lib/api";

type SubjectPickerProps = {
  subjects: SubjectListItem[];
  selectedSubjectIds: string[];
  onChange: (subjectIds: string[]) => void;
  disabled?: boolean;
  singleSelect?: boolean;
  searchPlaceholder?: string;
};

function subjectCode(subject: SubjectListItem) {
  return subject.subject_codename || "No code";
}

export function SubjectPicker({
  subjects,
  selectedSubjectIds,
  onChange,
  disabled = false,
  singleSelect = false,
  searchPlaceholder = "Search subject or code",
}: SubjectPickerProps) {
  const [query, setQuery] = useState("");
  const selectedIds = useMemo(() => new Set(selectedSubjectIds), [selectedSubjectIds]);
  const selectedSubjects = useMemo(
    () => subjects.filter((subject) => selectedIds.has(String(subject.subject_id))),
    [selectedIds, subjects]
  );
  const filteredSubjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return subjects;
    return subjects.filter((subject) =>
      [
        subject.subject_name,
        subject.subject_codename,
        subject.subject_group,
      ].some((value) => value?.toLowerCase().includes(normalizedQuery))
    );
  }, [query, subjects]);

  const toggleSubject = (subjectId: string) => {
    if (disabled) return;
    if (singleSelect) {
      onChange(selectedIds.has(subjectId) ? [] : [subjectId]);
      return;
    }

    const nextIds = new Set(selectedIds);
    if (nextIds.has(subjectId)) {
      nextIds.delete(subjectId);
    } else {
      nextIds.add(subjectId);
    }
    onChange([...nextIds]);
  };

  const clearSubject = (subjectId: string) => {
    if (disabled) return;
    onChange(selectedSubjectIds.filter((id) => id !== subjectId));
  };

  const selectAllVisible = () => {
    if (disabled || singleSelect) return;
    onChange([...new Set([...selectedSubjectIds, ...filteredSubjects.map((subject) => String(subject.subject_id))])]);
  };

  const clearAll = () => {
    if (disabled) return;
    onChange([]);
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="relative min-w-0">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
        <Input
          className="h-10 w-full pl-9"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          disabled={disabled}
        />
      </label>

      {selectedSubjects.length ? (
        <div className="flex flex-wrap gap-2">
          {selectedSubjects.map((subject) => (
            <span
              key={subject.subject_id}
              className="inline-flex max-w-full items-center gap-2 rounded-md border-2 border-black bg-[#fff1b8] px-2 py-1 text-xs font-semibold shadow-[2px_2px_0_#000]"
            >
              <span className="truncate">{subject.subject_name}</span>
              <button
                type="button"
                className="grid size-5 shrink-0 place-items-center rounded-full border border-black bg-background"
                onClick={() => clearSubject(String(subject.subject_id))}
                disabled={disabled}
                title={`Remove ${subject.subject_name}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {!singleSelect && filteredSubjects.length ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={selectAllVisible} disabled={disabled}>
            Select visible
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={clearAll} disabled={disabled || !selectedSubjectIds.length}>
            Clear selected
          </Button>
        </div>
      ) : null}

      <div className="max-h-72 overflow-y-auto rounded-md border-2 border-black bg-background">
        {filteredSubjects.length === 0 ? (
          <p className="p-3 text-sm text-black/70">
            {subjects.length ? "No subjects match your search." : "No active catalog subjects found for this grade level."}
          </p>
        ) : (
          filteredSubjects.map((subject) => {
            const subjectId = String(subject.subject_id);
            return (
              <label
                key={subject.subject_id}
                className="flex cursor-pointer items-start gap-3 border-b border-black/20 p-3 last:border-b-0 hover:bg-[#fff7d6]"
              >
                <Checkbox
                  checked={selectedIds.has(subjectId)}
                  onCheckedChange={() => toggleSubject(subjectId)}
                  className="mt-1 shrink-0"
                  disabled={disabled}
                />
                <span className="grid min-w-0 flex-1 grid-cols-1 gap-1 text-sm md:grid-cols-[1.5fr_120px_140px_80px]">
                  <strong className="truncate">{subject.subject_name}</strong>
                  <span>{subjectCode(subject)}</span>
                  <span>{subject.subject_group || "Ungrouped"}</span>
                  <span>{subject.hours ?? "-"} hrs</span>
                </span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
