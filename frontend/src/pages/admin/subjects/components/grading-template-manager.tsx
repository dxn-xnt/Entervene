import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, BookOpen, Lock, Pencil, Plus, Search, X } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Dialog } from "@/components/retroui/Dialog";
import { FormMessage, NoChangesMessage } from "@/components/retroui/FormMessage";
import { useEditFormChanges } from "@/hooks/use-edit-form-changes";
import { unorderedValues } from "@/lib/form-changes";
import { AdminValidationAlert } from "@/components/admin/AdminValidationAlert";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { useToast } from "@/components/retroui/Toast";
import {
  createGradingTemplate,
  editGradingTemplateThreshold,
  updateGradingTemplate,
  type GradingTemplateListItem,
  type SubjectListItem,
  type SubjectStatus,
} from "@/lib/api";
import { EmptyStateCard } from "./empty-state-card";
import { Alert } from "@/components/retroui/Alert";

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
type EditorState = {
  name: string;
  description: string;
  status: SubjectStatus;
  threshold: string;
  ww: string;
  pt: string;
  exams: string;
  subjectIds: Set<number>;
  replacementTemplateId: string;
};
const weight = (template: GradingTemplateListItem, name: string) =>
  template.components.find((item) => item.component_name === name)?.weight ?? 0;
const blank = (): EditorState => ({
  name: "",
  description: "",
  status: "active",
  threshold: "85",
  ww: "20",
  pt: "50",
  exams: "30",
  subjectIds: new Set(),
  replacementTemplateId: "",
});

export function GradingTemplateManager({
  templates,
  subjects,
  academicYears = [],
  onReload,
  createRequest = 0,
  showCreateButton = true,
}: Props) {
  const toast = useToast();
  const [editing, setEditing] = useState<
    GradingTemplateListItem | null | undefined
  >();
  const [form, setForm] = useState<EditorState>(blank);
  const [search, setSearch] = useState("");
  const [grade, setGrade] = useState("all");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [thresholdReason, setThresholdReason] = useState("");
  const [thresholdYearId, setThresholdYearId] = useState("");
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const handledCreateRequest = useRef(createRequest);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateGradeFilter, setTemplateGradeFilter] = useState("all");
  const [templateStatusFilter, setTemplateStatusFilter] = useState<SubjectStatus | "all">("all");

  const subjectCatalog = useMemo(() => {
    const seenIds = new Set<number>();
    const seenCodes = new Set<string>();
    const duplicateLabels = new Set<string>();
    const items: SubjectListItem[] = [];
    for (const subject of subjects) {
      const gradeLevel = subject.academic_level?.grade_level ?? 0;
      const normalizedCode = subject.subject_codename?.trim().toLocaleLowerCase() ?? "";
      const codeKey = normalizedCode ? `${gradeLevel}:${normalizedCode}` : "";
      if (seenIds.has(subject.subject_id)) {
        duplicateLabels.add(`subject ID ${subject.subject_id}`);
        continue;
      }
      if (codeKey && seenCodes.has(codeKey)) {
        duplicateLabels.add(`${subject.subject_codename} (Grade ${gradeLevel})`);
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
      if (templateStatusFilter !== "all" && template.status !== templateStatusFilter) {
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
        const matchDesc = (template.description || "").toLowerCase().includes(q);
        const matchSubject = template.assigned_subjects.some(
          (sub) =>
            sub.subject_name.toLowerCase().includes(q) ||
            (sub.subject_codename || "").toLowerCase().includes(q),
        );
        if (!matchName && !matchDesc && !matchSubject) return false;
      }
      return true;
    });
  }, [templates, templateSearch, templateGradeFilter, templateStatusFilter, subjectGradeMap]);
  const visibleSubjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return subjectCatalog.items.filter(
      (subject) =>
        (grade === "all" ||
          String(subject.academic_level.grade_level) === grade) &&
        (!query ||
          [subject.subject_name, subject.subject_codename ?? ""].some((value) =>
            value.toLowerCase().includes(query),
          )),
    );
  }, [grade, search, subjectCatalog.items]);
  const selectedSubjects = useMemo(
    () => subjectCatalog.items.filter((subject) => form.subjectIds.has(subject.subject_id)),
    [form.subjectIds, subjectCatalog.items],
  );
  const removedIds = editing
    ? editing.assigned_subjects
      .map((subject) => subject.subject_id)
      .filter((id) => !form.subjectIds.has(id))
    : [];

  useEffect(() => {
    if (createRequest > handledCreateRequest.current) {
      setEditing(null);
      setForm(blank());
      setSearch("");
      setGrade("all");
      setError(null);
    }
    handledCreateRequest.current = createRequest;
  }, [createRequest]);

  const openCreate = () => {
    setEditing(null);
    setForm(blank());
    setSearch("");
    setGrade("all");
    setError(null);
  };
  const openEdit = (template: GradingTemplateListItem) => {
    setEditing(template);
    setForm({
      name: template.template_name,
      description: template.description ?? "",
      status: template.status,
      threshold: String(template.passing_threshold),
      ww: String(weight(template, "Written Work")),
      pt: String(weight(template, "Performance Tasks")),
      exams: String(weight(template, "Exams")),
      subjectIds: new Set(
        template.assigned_subjects.map((subject) => subject.subject_id),
      ),
      replacementTemplateId: "",
    });
    setSearch("");
    setGrade("all");
    setError(null);
    setThresholdReason("");
    setThresholdYearId(
      String(
        (academicYears.find((year) => year.is_active) ?? academicYears[0])
          ?.academic_year_id ?? "",
      ),
    );
  };
  const toggleSubject = (subject: SubjectListItem) => {
    if (subject.grading_template_assignment_locked) {
      setError(subject.grading_template_assignment_lock_reason || "Recorded grades prevent changing this subject's grading template.");
      setValidationAttempt((attempt) => attempt + 1);
      return;
    }
    setForm((current) => {
      const subjectIds = new Set(current.subjectIds);
      if (subjectIds.has(subject.subject_id)) {
        subjectIds.delete(subject.subject_id);
      } else subjectIds.add(subject.subject_id);
      return { ...current, subjectIds };
    });
  };

  const clearRemovableSubjects = () => {
    const lockedIds = new Set(
      selectedSubjects
        .filter((subject) => subject.grading_template_assignment_locked)
        .map((subject) => subject.subject_id),
    );
    setForm((current) => ({
      ...current,
      subjectIds: lockedIds,
    }));
    if (lockedIds.size) {
      setError(`${lockedIds.size} subject${lockedIds.size === 1 ? " is" : "s are"} kept because recorded grades lock the grading template assignment.`);
      setValidationAttempt((attempt) => attempt + 1);
    }
  };
  const templateValues = (value: EditorState) => ({
    subjects: unorderedValues([...value.subjectIds]),
    ...(!editing?.is_locked ? {
      name: value.name.trim(), description: value.description.trim(),
      status: value.status,
      weights: [Number(value.ww), Number(value.pt), Number(value.exams)],
    } : {}),
  });
  const changes = useEditFormChanges({
    enabled: !!editing,
    resetKey: editing?.grading_template_id,
    initialValues: editing ? templateValues({
      ...form, name: editing.template_name, description: editing.description ?? "",
      status: editing.status,
      ww: String(weight(editing, "Written Work")),
      pt: String(weight(editing, "Performance Tasks")),
      exams: String(weight(editing, "Exams")),
      subjectIds: new Set(editing.assigned_subjects.map(subject => subject.subject_id)),
    }) : null,
    values: templateValues(form),
  });
  const thresholdChanges = useEditFormChanges({
    enabled: !!editing, resetKey: editing?.grading_template_id,
    initialValues: Number(editing?.passing_threshold), values: Number(form.threshold),
  });
  const save = async () => {
    if (!changes.guardChanges()) return;
    const threshold = Number(form.threshold),
      ww = Number(form.ww),
      pt = Number(form.pt),
      exams = Number(form.exams);
    if (!form.name.trim()) {
      setError("Template name is required.");
      setValidationAttempt((attempt) => attempt + 1);
      return;
    }
    if (![threshold, ww, pt, exams].every(Number.isFinite)) {
      setError("Enter valid numeric grading values.");
      setValidationAttempt((attempt) => attempt + 1);
      return;
    }
    if (ww + pt + exams !== 100) {
      setError(
        "Written Work, Performance Tasks, and Exams must total exactly 100%.",
      );
      setValidationAttempt((attempt) => attempt + 1);
      return;
    }
    if (removedIds.length && !form.replacementTemplateId) {
      setError("Choose a replacement template for removed subjects.");
      setValidationAttempt((attempt) => attempt + 1);
      return;
    }
    const components = [
      { component_name: "Written Work", weight: ww, display_order: 1 },
      { component_name: "Performance Tasks", weight: pt, display_order: 2 },
      { component_name: "Exams", weight: exams, display_order: 3 },
    ];
    setSaving(true);
    setError(null);
    try {
      if (editing)
        await updateGradingTemplate(editing.grading_template_id, {
          updated_at: editing.updated_at ?? "",
          subject_ids: [...form.subjectIds],
          ...(removedIds.length
            ? { replacement_template_id: Number(form.replacementTemplateId) }
            : {}),
          ...(!editing.is_locked
            ? {
              template_name: form.name.trim(),
              description: form.description.trim() || null,
              status: form.status,
              components,
            }
            : {}),
        });
      else
        await createGradingTemplate({
          template_name: form.name.trim(),
          description: form.description.trim() || null,
          status: form.status,
          passing_threshold: threshold,
          subject_ids: [...form.subjectIds],
          components,
        });
      await onReload();
      setEditing(undefined);
      toast.success({
        title: editing
          ? "Grading template updated"
          : "Grading template created",
      });
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Unable to save grading template.";
      setError(message);
      setValidationAttempt((attempt) => attempt + 1);
    } finally {
      setSaving(false);
    }
  };
  const saveThreshold = async () => {
    if (!thresholdChanges.guardChanges()) return;
    if (!editing || !thresholdYearId || !thresholdReason.trim()) {
      setError("Select a year and enter an audit reason.");
      setValidationAttempt((attempt) => attempt + 1);
      return;
    }
    setThresholdSaving(true);
    setError(null);
    try {
      await editGradingTemplateThreshold(editing.grading_template_id, {
        academic_year_id: Number(thresholdYearId),
        threshold: form.threshold,
        expected_updated_at: editing.updated_at ?? "",
        reason: thresholdReason.trim(),
      });
      await onReload();
      setEditing(undefined);
      toast.success({ title: "Passing threshold updated" });
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Unable to update passing threshold.";
      toast.error({
        title: "Unable to update passing threshold",
        description: message,
      });
    } finally {
      setThresholdSaving(false);
    }
  };
  const total =
    Number(form.ww || 0) + Number(form.pt || 0) + Number(form.exams || 0);
  const weightError =
    error === "Enter valid numeric grading values." ||
    error ===
    "Written Work, Performance Tasks, and Exams must total exactly 100%.";
  const updateWeight = (key: "ww" | "pt" | "exams", value: string) => {
    const next = { ...form, [key]: value };
    setForm(next);
    if (
      weightError &&
      [next.ww, next.pt, next.exams].every((weight) =>
        Number.isFinite(Number(weight)),
      ) &&
      Number(next.ww) + Number(next.pt) + Number(next.exams) === 100
    )
      setError(null);
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
        <Select value={templateGradeFilter} onValueChange={setTemplateGradeFilter}>
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
          onValueChange={(val) => setTemplateStatusFilter(val as SubjectStatus | "all")}
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
        {templateSearch.trim() || templateGradeFilter !== "all" || templateStatusFilter !== "all" ? (
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
          <p className="font-semibold">No grading templates match the selected filters.</p>
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

      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(undefined);
          }
        }}
      >
        <Dialog.Content size="4xl" className="max-h-[calc(100dvh-1rem)]">
          <Dialog.Header className="flex-row items-center gap-3 border-b-2 border-black bg-primary px-5 py-4">
            <h3 className="text-xl font-bold">
              {editing ? "Edit Grading Template" : "New Grading Template"}
            </h3>
          </Dialog.Header>
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
            {editing?.is_locked ? (
              <div className="flex justify-end">
                <Badge size="sm" className="bg-black text-white" variant="solid">
                  <Lock className="mr-1 size-3" />
                  Locked
                </Badge>
              </div>
            ) : null}
            <AdminValidationAlert
              message={
                error &&
                  ![
                    "Template name is required.",
                    "Enter valid numeric grading values.",
                    "Written Work, Performance Tasks, and Exams must total exactly 100%.",
                    "Choose a replacement template for removed subjects.",
                    "Select a year and enter an audit reason.",
                  ].includes(error)
                  ? error
                  : null
              }
              attempt={validationAttempt}
            />
            <section className="grid gap-3 lg:grid-cols-3">
              <Field label="Template Name">
                <Input
                  id="grading-template-name"
                  value={form.name}
                  disabled={Boolean(editing?.is_locked)}
                  aria-invalid={error === "Template name is required."}
                  aria-describedby={
                    error === "Template name is required."
                      ? "grading-template-name-error"
                      : undefined
                  }
                  onChange={(e) => {
                    setForm({ ...form, name: e.target.value });
                    if (
                      e.target.value.trim() &&
                      error === "Template name is required."
                    )
                      setError(null);
                  }}
                />
                {error === "Template name is required." && (
                  <FormMessage id="grading-template-name-error">
                    {error}
                  </FormMessage>
                )}
              </Field>
              <Field label="Status">
                <Select
                  value={form.status}
                  disabled={Boolean(editing?.is_locked)}
                  onValueChange={(value) =>
                    setForm({ ...form, status: value as SubjectStatus })
                  }
                >
                  <Select.Trigger className="w-full">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Group>
                      <Select.Item value="active">Active</Select.Item>
                      <Select.Item value="archived">Archived</Select.Item>
                    </Select.Group>
                  </Select.Content>
                </Select>
              </Field>
              <Field label="Passing Threshold">
                <PercentInput
                  value={form.threshold}
                  disabled={Boolean(editing)}
                  onChange={(value) => setForm({ ...form, threshold: value })}
                />
              </Field>
            </section>

            {editing ? (
              <Card className="block w-full space-y-3 border-border bg-background p-3 shadow-none hover:shadow-none">
                <h4 className="font-bold">Audited passing-threshold edit</h4>
                <p className="text-xs">
                  This changes the shared template for every assigned subject.
                  Finalized grades anywhere on this template block the edit.
                  Weights and subject assignments remain separate.
                </p>
                <Field label="Academic year context">
                  <Select
                    value={thresholdYearId}
                    onValueChange={(value) => {
                      setThresholdYearId(value);
                      if (
                        value &&
                        thresholdReason.trim() &&
                        error === "Select a year and enter an audit reason."
                      )
                        setError(null);
                    }}
                  >
                    <Select.Trigger
                      aria-invalid={
                        error === "Select a year and enter an audit reason." &&
                        !thresholdYearId
                      }
                      className="w-full aria-[invalid=true]:border-destructive"
                    >
                      <Select.Value placeholder="Select year" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Group>
                        {academicYears.map((year) => (
                          <Select.Item
                            key={year.academic_year_id}
                            value={String(year.academic_year_id)}
                          >
                            {year.year_label}
                          </Select.Item>
                        ))}
                      </Select.Group>
                    </Select.Content>
                  </Select>
                  {error === "Select a year and enter an audit reason." &&
                    !thresholdYearId && (
                      <FormMessage>Select an academic year.</FormMessage>
                    )}
                </Field>
                <Field label="New passing threshold">
                  <Input
                    aria-label="Audited passing threshold"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={form.threshold}
                    onChange={(event) =>
                      setForm({ ...form, threshold: event.target.value })
                    }
                  />
                </Field>
                <Field label="Reason for threshold edit">
                  <Input
                    value={thresholdReason}
                    aria-invalid={
                      error === "Select a year and enter an audit reason." &&
                      !thresholdReason.trim()
                    }
                    onChange={(event) => {
                      setThresholdReason(event.target.value);
                      if (
                        event.target.value.trim() &&
                        thresholdYearId &&
                        error === "Select a year and enter an audit reason."
                      )
                        setError(null);
                    }}
                  />
                  {error === "Select a year and enter an audit reason." &&
                    !thresholdReason.trim() && (
                      <FormMessage>Enter an audit reason.</FormMessage>
                    )}
                </Field>
                <Button
                  onClick={() => void saveThreshold()}
                  disabled={thresholdSaving || !thresholdYearId || !thresholdChanges.hasChanges}
                >
                  {thresholdSaving ? "Saving..." : "Save Threshold with Audit"}
                </Button>
                <NoChangesMessage message={thresholdChanges.noChangesMessage} />
              </Card>
            ) : null}

            <section>
              <h4 className="mb-2 font-bold">
                Subject Scope / Assigned Subjects
              </h4>
              <div className="rounded! border-2 border-black p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <strong>Assigned Subjects ({selectedSubjects.length})</strong>
                  {selectedSubjects.length ? (
                    <Button
                      size="sm"
                      onClick={clearRemovableSubjects}
                    >
                      Clear All
                    </Button>
                  ) : null}
                </div>
                <div className="flex min-h-10 flex-wrap gap-2">
                  {selectedSubjects.map((subject) => (
                    <Button
                      type="button"
                      size="sm"
                      autoIcon={false}
                      key={subject.subject_id}
                      disabled={subject.grading_template_assignment_locked}
                      title={subject.grading_template_assignment_lock_reason ?? undefined}
                      onClick={() => toggleSubject(subject)}
                      className="border-black bg-primary font-bold"
                    >
                      {subject.subject_name}
                      {subject.grading_template_assignment_locked ? <Lock className="size-3.5" /> : <X className="size-3.5" />}
                    </Button>
                  ))}
                  {!selectedSubjects.length ? (
                    <span className="text-sm text-black/55">
                      No subjects assigned.
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_190px]">
                <label className="relative">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2" />
                  <Input
                    variant="search"
                    className="w-full"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search subject name or code to assign"
                  />
                </label>
                <Select value={grade} onValueChange={setGrade}>
                  <Select.Trigger className="w-full">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Group>
                      <Select.Item value="all">Any grade</Select.Item>
                      {grades.map((value) => (
                        <Select.Item key={value} value={String(value)}>
                          Grade {value}
                        </Select.Item>
                      ))}
                    </Select.Group>
                  </Select.Content>
                </Select>
              </div>
              {subjectCatalog.duplicateLabels.length ? (
                <Alert status="warning" className="mt-3 py-3">
                  <Alert.Title className="flex items-center gap-2 font-bold">
                    <AlertTriangle className="size-4" />Duplicate catalog entries detected
                  </Alert.Title>
                  <Alert.Description className="text-sm text-black/75">
                    Duplicate IDs or grade-level subject codes were shown once: {subjectCatalog.duplicateLabels.join(", ")}.
                  </Alert.Description>
                </Alert>
              ) : null}
              <div className="mt-3 max-h-72 overflow-y-auto rounded! border-2 border-black bg-white">
                {!visibleSubjects.length ? (
                  <EmptyStateCard
                    compact
                    icon={<Search />}
                    title="No matching subjects"
                    description="Try another subject name, code, or grade filter."
                  />
                ) : (
                  visibleSubjects.map((subject) => {
                    const selected = form.subjectIds.has(subject.subject_id);
                    const assignedElsewhere = Boolean(
                      subject.grading_template_id
                      && subject.grading_template_id !== editing?.grading_template_id,
                    );
                    const locked = Boolean(subject.grading_template_assignment_locked);
                    const disabled = assignedElsewhere || locked;
                    const lockTitle = locked
                      ? subject.grading_template_assignment_lock_reason ?? "Recorded grades lock this assignment."
                      : assignedElsewhere
                        ? `Assigned to ${subject.grading_template.template_name}`
                        : undefined;
                    return (
                      <label
                        key={subject.subject_id}
                        title={lockTitle}
                        className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-black/30 px-3 py-2.5 last:border-b-0 ${selected ? "bg-primary" : "bg-white"} ${disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-primary/15"}`}
                      >
                        <input
                          type="checkbox"
                          className="size-5 accent-black"
                          checked={selected}
                          disabled={disabled}
                          onChange={() => toggleSubject(subject)}
                        />
                        <strong className="truncate text-sm">{subject.subject_name}</strong>
                        <span className="flex flex-wrap items-center justify-end gap-3 text-xs text-black/65">
                          <span>{subject.subject_codename ?? "No code"}</span>
                          <span>Grade {subject.academic_level.grade_level}</span>
                          {assignedElsewhere ? <Badge variant="outline" size="sm">{subject.grading_template.template_name}</Badge> : null}
                          {locked ? <Lock className="size-3.5" aria-label="Assignment locked" /> : null}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
              <p className="mt-2 text-xs text-black/60">
                Subjects assigned to another template or containing recorded grades are locked here.
              </p>
            </section>

            {removedIds.length ? (
              <Field
                label={`Replacement template for ${removedIds.length} removed subject${removedIds.length === 1 ? "" : "s"}`}
              >
                <Select
                  value={form.replacementTemplateId}
                  onValueChange={(value) => {
                    setForm({ ...form, replacementTemplateId: value });
                    if (
                      value &&
                      error ===
                      "Choose a replacement template for removed subjects."
                    )
                      setError(null);
                  }}
                >
                  <Select.Trigger
                    aria-invalid={
                      error ===
                      "Choose a replacement template for removed subjects."
                    }
                    className="w-full aria-[invalid=true]:border-destructive"
                  >
                    <Select.Value placeholder="Choose replacement" />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Group>
                      {templates
                        .filter(
                          (item) =>
                            item.status === "active" &&
                            item.grading_template_id !==
                            editing?.grading_template_id,
                        )
                        .map((item) => (
                          <Select.Item
                            key={item.grading_template_id}
                            value={String(item.grading_template_id)}
                          >
                            {item.template_name}
                          </Select.Item>
                        ))}
                    </Select.Group>
                  </Select.Content>
                </Select>
              </Field>
            ) : null}
            {error ===
              "Choose a replacement template for removed subjects." && (
                <FormMessage>{error}</FormMessage>
              )}
            <Field label="Description">
              <textarea
                className="min-h-14 w-full rounded! border-2 border-border bg-background p-2 disabled:bg-background disabled:opacity-100"
                value={form.description}
                disabled={Boolean(editing?.is_locked)}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </Field>

            <section className="rounded! border-2 border-border bg-primary p-3">
              <div className="mb-3 grid grid-cols-[minmax(0,1fr)_150px] items-start gap-2">
                <div className="min-w-0">
                  <h4 className="font-bold">
                    Components{" "}
                    {editing?.is_locked ? (
                      <Lock className="ml-1 inline size-4" />
                    ) : null}
                  </h4>
                  {editing?.is_locked ? (
                    <p className="text-xs text-black/55">
                      Weights cannot be edited after use to protect historical
                      grade records.
                    </p>
                  ) : null}
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex h-10 min-w-0 flex-1 items-center gap-1 whitespace-nowrap rounded! border-2 border-border bg-background px-4 font-sans text-base font-normal">
                    <span>Total:</span>
                    <strong>{total}</strong>
                  </div>
                  <span className="shrink-0">%</span>
                </div>
              </div>
              <div className="space-y-2">
                {[
                  ["Written Work", "ww"],
                  ["Performance Tasks", "pt"],
                  ["Exams", "exams"],
                ].map(([label, key]) => (
                  <div
                    key={key}
                    className="grid grid-cols-[minmax(0,1fr)_150px] gap-2"
                  >
                    <div className="flex items-center rounded! border-2 border-border bg-background px-3 text-sm">
                      {label}
                    </div>
                    <PercentInput
                      value={form[key as "ww" | "pt" | "exams"]}
                      disabled={Boolean(editing?.is_locked)}
                      invalid={weightError}
                      onChange={(value) =>
                        updateWeight(key as "ww" | "pt" | "exams", value)
                      }
                    />
                  </div>
                ))}
              </div>
              {(error === "Enter valid numeric grading values." ||
                error ===
                "Written Work, Performance Tasks, and Exams must total exactly 100%.") && (
                  <FormMessage>{error}</FormMessage>
                )}
            </section>
          </div>
          <Dialog.Footer className="mt-0 border-t-2 border-black bg-white">
            <NoChangesMessage message={changes.noChangesMessage} />
            <Button variant="outline" onClick={() => setEditing(undefined)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving || (!!editing && !changes.hasChanges)}>
              {saving ? "Saving..." : "Save Template"}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
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
          <Badge size="sm" className="capitalize" variant="outline">
            {template.status}
          </Badge>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">

          {template.is_locked ? (
            <Badge size="sm" className="bg-black text-white py-0.75! rounded-md!" variant="solid">
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
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-semibold">
      {label}
      {children}
    </label>
  );
}
function PercentInput({
  value,
  disabled,
  invalid,
  onChange,
}: {
  value: string;
  disabled: boolean;
  invalid?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Input
        className="min-w-0 flex-1 disabled:bg-background disabled:text-foreground disabled:opacity-100"
        type="number"
        min="0"
        max="100"
        value={value}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="shrink-0">%</span>
    </div>
  );
}
