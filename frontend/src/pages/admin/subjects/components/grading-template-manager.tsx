import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Lock, Pencil, Plus, Search } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import {
  type GradingTemplateListItem,
  type SubjectListItem,
  type SubjectStatus,
} from "@/lib/api";
import { EmptyStateCard } from "./empty-state-card";
import { EditGradingTemplateModal } from "@/pages/admin/forms/edit-grading-template-modal";

type Props = {
  templates: GradingTemplateListItem[];
  subjects: SubjectListItem[];
  academicYears?: Array<{
    academic_year_id: number;
    year_label: string;
    is_active: boolean;
  }>;
  onReload: () => Promise<void>;
  createRequest?: number;
  showCreateButton?: boolean;
};

const weight = (template: GradingTemplateListItem, name: string) =>
  template.components.find((item) => item.component_name === name)?.weight ?? 0;

export function GradingTemplateManager({
  templates,
  subjects,
  academicYears = [],
  onReload,
  createRequest = 0,
  showCreateButton = true,
}: Props) {
  const [editing, setEditing] = useState<
    GradingTemplateListItem | null | undefined
  >();
  const handledCreateRequest = useRef(createRequest);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateGradeFilter, setTemplateGradeFilter] = useState("all");
  const [templateStatusFilter, setTemplateStatusFilter] = useState<
    SubjectStatus | "all"
  >("all");

  const subjectCatalog = useMemo(() => {
    const seenIds = new Set<number>();
    const seenCodes = new Set<string>();
    const duplicateLabels = new Set<string>();
    const items: SubjectListItem[] = [];
    for (const subject of subjects) {
      const gradeLevel = subject.academic_level?.grade_level ?? 0;
      const normalizedCode =
        subject.subject_codename?.trim().toLocaleLowerCase() ?? "";
      const codeKey = normalizedCode ? `${gradeLevel}:${normalizedCode}` : "";
      if (seenIds.has(subject.subject_id)) {
        duplicateLabels.add(`subject ID ${subject.subject_id}`);
        continue;
      }
      if (codeKey && seenCodes.has(codeKey)) {
        duplicateLabels.add(
          `${subject.subject_codename} (Grade ${gradeLevel})`,
        );
        continue;
      }
      seenIds.add(subject.subject_id);
      if (codeKey) seenCodes.add(codeKey);
      items.push(subject);
    }
    return { items, duplicateLabels: [...duplicateLabels] };
  }, [subjects]);

  const grades = useMemo(() => {
    const list = [
      ...new Set(
        subjectCatalog.items
          .map((subject) => subject.academic_level?.grade_level)
          .filter((g): g is number => g != null),
      ),
    ].sort((a, b) => a - b);
    return list.length ? list : [7, 8, 9, 10, 11, 12];
  }, [subjectCatalog.items]);

  const subjectGradeMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const s of subjectCatalog.items) {
      if (s.academic_level?.grade_level != null) {
        map.set(s.subject_id, s.academic_level.grade_level);
      }
    }
    return map;
  }, [subjectCatalog.items]);

  const filteredTemplates = useMemo(() => {
    const q = templateSearch.trim().toLowerCase();
    return templates.filter((template) => {
      if (
        templateStatusFilter !== "all" &&
        template.status !== templateStatusFilter
      ) {
        return false;
      }
      if (templateGradeFilter !== "all") {
        const targetGrade = Number(templateGradeFilter);
        const hasGrade = template.assigned_subjects.some((sub) => {
          const gl = sub.grade_level ?? subjectGradeMap.get(sub.subject_id);
          return gl === targetGrade;
        });
        if (!hasGrade) return false;
      }
      if (q) {
        const matchName = template.template_name.toLowerCase().includes(q);
        const matchDesc = (template.description || "")
          .toLowerCase()
          .includes(q);
        const matchSubject = template.assigned_subjects.some(
          (sub) =>
            sub.subject_name.toLowerCase().includes(q) ||
            (sub.subject_codename || "").toLowerCase().includes(q),
        );
        if (!matchName && !matchDesc && !matchSubject) return false;
      }
      return true;
    });
  }, [
    templates,
    templateSearch,
    templateGradeFilter,
    templateStatusFilter,
    subjectGradeMap,
  ]);

  useEffect(() => {
    if (createRequest > handledCreateRequest.current) {
      setEditing(null);
    }
    handledCreateRequest.current = createRequest;
  }, [createRequest]);

  const openCreate = () => {
    setEditing(null);
  };
  const openEdit = (template: GradingTemplateListItem) => {
    setEditing(template);
  };

  return (
    <section className="flex flex-col gap-5">
      {showCreateButton ? (
        <div className="flex justify-end">
          <Button onClick={openCreate}>
            <Plus className="mr-2 size-4" />
            New Grading Template
          </Button>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px_160px] lg:grid-cols-[1fr_180px_160px_auto]">
        <label className="relative min-w-0">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
          <Input
            variant="search"
            value={templateSearch}
            onChange={(event) => setTemplateSearch(event.target.value)}
            placeholder="Search template name, description, or subject"
            className="w-full"
          />
        </label>
        <Select
          value={templateGradeFilter}
          onValueChange={setTemplateGradeFilter}
        >
          <Select.Trigger className="w-full">
            <Select.Value placeholder="Grade" />
          </Select.Trigger>
          <Select.Content>
            <Select.Group>
              <Select.Item value="all">All Grades</Select.Item>
              {grades.map((item) => (
                <Select.Item key={item} value={String(item)}>
                  Grade {item}
                </Select.Item>
              ))}
            </Select.Group>
          </Select.Content>
        </Select>
        <Select
          value={templateStatusFilter}
          onValueChange={(val) =>
            setTemplateStatusFilter(val as SubjectStatus | "all")
          }
        >
          <Select.Trigger className="w-full">
            <Select.Value placeholder="Status" />
          </Select.Trigger>
          <Select.Content>
            <Select.Group>
              <Select.Item value="all">All Statuses</Select.Item>
              <Select.Item value="active">Active</Select.Item>
              <Select.Item value="archived">Archived</Select.Item>
            </Select.Group>
          </Select.Content>
        </Select>
        {templateSearch.trim() ||
        templateGradeFilter !== "all" ||
        templateStatusFilter !== "all" ? (
          <Button
            type="button"
            variant="outline"
            className="h-10 border-black shadow-none"
            onClick={() => {
              setTemplateSearch("");
              setTemplateGradeFilter("all");
              setTemplateStatusFilter("all");
            }}
          >
            Reset
          </Button>
        ) : null}
      </div>

      {!templates.length ? (
        <Card className="border-2 border-black p-5 text-sm">
          No grading templates found.
        </Card>
      ) : !filteredTemplates.length ? (
        <Card className="flex flex-col items-center justify-center gap-2 border-2 border-black p-5 py-8 text-center text-sm">
          <p className="font-semibold">
            No grading templates match the selected filters.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-black shadow-none"
            onClick={() => {
              setTemplateSearch("");
              setTemplateGradeFilter("all");
              setTemplateStatusFilter("all");
            }}
          >
            Clear Filters
          </Button>
        </Card>
      ) : (
        <div className="grid items-stretch gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-3">
          {filteredTemplates.map((template) => (
            <TemplateCard
              key={template.grading_template_id}
              template={template}
              onEdit={openEdit}
            />
          ))}
        </div>
      )}

      <EditGradingTemplateModal
        open={editing !== undefined}
        editing={editing}
        templates={templates}
        subjects={subjects}
        academicYears={academicYears}
        onClose={() => setEditing(undefined)}
        onReload={onReload}
      />
    </section>
  );
}

function TemplateCard({
  template,
  onEdit,
}: {
  template: GradingTemplateListItem;
  onEdit: (template: GradingTemplateListItem) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const grouped = useMemo(() => {
    const groups = new Map<
      number | null,
      GradingTemplateListItem["assigned_subjects"]
    >();
    for (const subject of template.assigned_subjects) {
      const key = subject.grade_level ?? null;
      groups.set(key, [...(groups.get(key) ?? []), subject]);
    }
    return [...groups.entries()].sort(([a], [b]) => (a ?? 999) - (b ?? 999));
  }, [template.assigned_subjects]);
  const preview = template.assigned_subjects.slice(0, 4);
  return (
    <Card className="flex h-full min-w-0 flex-col overflow-hidden border-2 border-black bg-primary p-3 ">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex flex-row items-center gap-2">
          <h3 className="min-w-0 break-words text-2xl font-bold leading-tight">
            {template.template_name}
          </h3>
          <Badge size="sm" variant="outline">
            Rev {template.revision ?? 1}
          </Badge>
          <Badge size="sm" className="capitalize" variant="outline">
            {template.status}
          </Badge>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {template.is_locked ? (
            <Badge
              size="sm"
              className="bg-black text-white py-0.75! rounded-md!"
              variant="solid"
            >
              <Lock className="mr-1 size-3" />
              Locked
            </Badge>
          ) : null}
          <Button
            aria-label={`Edit ${template.template_name}`}
            size="sm"
            className="size-6 bg-black p-1 text-white shadow-none"
            onClick={() => onEdit(template)}
          >
            <Pencil className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-sm px-1">
        <span>
          Passing: <strong>{template.passing_threshold}%</strong>
        </span>
        <span className="text-right">
          <strong>{template.assigned_subject_count}</strong> assigned
        </span>
      </div>
      {template.assigned_subjects.length === 0 ? (
        <div className="mb-2">
          <EmptyStateCard
            inline
            icon={<BookOpen />}
            title="No assigned subjects"
            description="Assign subjects to use this template."
          />
        </div>
      ) : (
        <div className="mb-2 flex-1 rounded">
          <div className="flex flex-wrap gap-1.5">
            {preview.map((subject) => (
              <Badge
                key={subject.subject_id}
                size="md"
                className="max-w-full"
                variant="outline"
              >
                {subject.subject_name}
              </Badge>
            ))}
          </div>
          {template.assigned_subjects.length > 4 ? (
            <Button
              size="sm"
              variant="outline"
              className="mt-2 w-full shadow-none"
              onClick={() => setShowAll(true)}
            >{`View All Subjects (${template.assigned_subject_count})`}</Button>
          ) : null}
        </div>
      )}
      <div className="mt-auto grid grid-cols-3 gap-1.5">
        <Metric label="Written Work" value={weight(template, "Written Work")} />
        <Metric
          label="Performance Tasks"
          value={weight(template, "Performance Tasks")}
        />
        <Metric label="Exams" value={weight(template, "Exams")} />
      </div>
      <Dialog open={showAll} onOpenChange={setShowAll}>
        <Dialog.Content size="lg">
          <Dialog.Header className="border-b-2 border-black bg-primary px-5 py-4">
            <h3 className="break-words text-xl font-bold">
              {template.template_name} Subjects (
              {template.assigned_subject_count})
            </h3>
          </Dialog.Header>
          <div className="max-h-[65dvh] space-y-3 overflow-y-auto p-4">
            {grouped.map(([gradeLevel, assigned]) => (
              <section key={gradeLevel ?? "none"}>
                <h4 className="mb-1.5 font-bold">
                  {gradeLevel ? `Grade ${gradeLevel}` : "Any grade"}
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {assigned.map((subject) => (
                    <Badge
                      key={subject.subject_id}
                      className="max-w-full"
                      variant="outline"
                    >
                      {subject.subject_name}
                    </Badge>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <Dialog.Footer className="mt-0">
            <Button variant="outline" onClick={() => setShowAll(false)}>
              Close
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded border-2 border-black bg-white px-1 py-2 text-center">
      <span className="block break-words text-xs leading-tight">{label}</span>
      <strong className="text-lg">{value}%</strong>
    </div>
  );
}
