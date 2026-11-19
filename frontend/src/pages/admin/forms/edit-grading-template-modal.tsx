import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Lock, Search, X } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Dialog } from "@/components/retroui/Dialog";
import {
  FormMessage,
  NoChangesMessage,
} from "@/components/retroui/FormMessage";
import { useEditFormChanges } from "@/hooks/use-edit-form-changes";
import { unorderedValues } from "@/lib/form-changes";
import { AdminValidationAlert } from "@/components/admin/AdminValidationAlert";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { useToast } from "@/components/retroui/Toast";
import { Alert } from "@/components/retroui/Alert";
import Field from "@/components/admin/classes/fields/Field";
import {
  createGradingTemplate,
  createGradingTemplateRevision,
  editGradingTemplateThreshold,
  updateGradingTemplate,
  type GradingTemplateListItem,
  type SubjectListItem,
  type SubjectStatus,
} from "@/lib/api";
import { EmptyStateCard } from "../subjects/components/empty-state-card";

export type EditGradingTemplateModalProps = {
  open: boolean;
  editing?: GradingTemplateListItem | null;
  templates: GradingTemplateListItem[];
  subjects: SubjectListItem[];
  academicYears?: Array<{
    academic_year_id: number;
    year_label: string;
    is_active: boolean;
  }>;
  onClose: () => void;
  onReload: () => Promise<void>;
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
const normalizeWeight = (value: number) => Math.round(value * 100) / 100;
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


function PercentInput({
  value,
  disabled,
  invalid,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  invalid?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative w-full">
      <Input
        type="number"
        min="0"
        max="100"
        step="0.01"
        disabled={disabled}
        aria-invalid={invalid}
        value={value}
        className="w-full pr-8 aria-[invalid=true]:border-destructive"
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-black/50">
        %
      </span>
    </div>
  );
}

export function EditGradingTemplateModal({
  open,
  editing,
  templates,
  subjects,
  academicYears = [],
  onClose,
  onReload,
}: EditGradingTemplateModalProps) {
  const toast = useToast();
  const [form, setForm] = useState<EditorState>(blank);
  const [search, setSearch] = useState("");
  const [grade, setGrade] = useState("all");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [thresholdReason, setThresholdReason] = useState("");
  const [thresholdPolicyReference, setThresholdPolicyReference] = useState("");
  const [thresholdYearId, setThresholdYearId] = useState("");
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const creatingRevision = Boolean(editing?.is_locked);

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

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        name: editing.template_name,
        description: editing.description ?? "",
        status: editing.status,
        threshold: String(editing.passing_threshold),
        ww: String(weight(editing, "Written Work")),
        pt: String(weight(editing, "Performance Tasks")),
        exams: String(weight(editing, "Exams")),
        subjectIds: new Set(
          editing.assigned_subjects.map((subject) => subject.subject_id),
        ),
        replacementTemplateId: "",
      });
    } else {
      setForm(blank());
    }
    setSearch("");
    setGrade("all");
    setError(null);
    setThresholdReason("");
    setThresholdPolicyReference("");
    setThresholdYearId(
      String(
        (academicYears.find((year) => year.is_active) ?? academicYears[0])
          ?.academic_year_id ?? "",
      ),
    );
  }, [open, editing, academicYears]);

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
    () =>
      subjectCatalog.items.filter((subject) =>
        form.subjectIds.has(subject.subject_id),
      ),
    [form.subjectIds, subjectCatalog.items],
  );

  const removedIds = editing
    ? editing.assigned_subjects
      .map((subject) => subject.subject_id)
      .filter((id) => !form.subjectIds.has(id))
    : [];

  const toggleSubject = (subject: SubjectListItem) => {
    if (subject.grading_template_assignment_locked) {
      setError(
        subject.grading_template_assignment_lock_reason ||
        "Recorded grades prevent changing this subject's grading template.",
      );
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
      setError(
        `${lockedIds.size} subject${lockedIds.size === 1 ? " is" : "s are"} kept because recorded grades lock the grading template assignment.`,
      );
      setValidationAttempt((attempt) => attempt + 1);
    }
  };

  const templateValues = (value: EditorState) => ({
    subjects: unorderedValues([...value.subjectIds]),
    ...(!editing?.is_locked
      ? {
        name: value.name.trim(),
        description: value.description.trim(),
        status: value.status,
        weights: [Number(value.ww), Number(value.pt), Number(value.exams)],
      }
      : {}),
  });

  const changes = useEditFormChanges({
    enabled: !!editing,
    resetKey: editing?.grading_template_id,
    initialValues: editing
      ? templateValues({
        ...form,
        name: editing.template_name,
        description: editing.description ?? "",
        status: editing.status,
        ww: String(weight(editing, "Written Work")),
        pt: String(weight(editing, "Performance Tasks")),
        exams: String(weight(editing, "Exams")),
        subjectIds: new Set(
          editing.assigned_subjects.map((subject) => subject.subject_id),
        ),
      })
      : null,
    values: templateValues(form),
  });

  const thresholdChanges = useEditFormChanges({
    enabled: !!editing,
    resetKey: editing?.grading_template_id,
    initialValues: Number(editing?.passing_threshold),
    values: Number(form.threshold),
  });

  const revisionChanges = useEditFormChanges({
    enabled: !!editing && creatingRevision,
    resetKey: editing?.grading_template_id,
    initialValues: editing
      ? {
        weights: [
          weight(editing, "Written Work"),
          weight(editing, "Performance Tasks"),
          weight(editing, "Exams"),
        ],
        policyReference: "",
        reason: "",
      }
      : null,
    values: {
      weights: [Number(form.ww), Number(form.pt), Number(form.exams)],
      policyReference: thresholdPolicyReference.trim(),
      reason: thresholdReason.trim(),
    },
  });

  const revisionAuditValid =
    thresholdPolicyReference.trim().length >= 3 &&
    thresholdReason.trim().length >= 5;

  const save = async () => {
    const savingRevision = creatingRevision && revisionChanges.hasChanges;
    if (!(savingRevision ? revisionChanges : changes).guardChanges()) return;
    const threshold = Number(form.threshold);
    const rawWeights = [Number(form.ww), Number(form.pt), Number(form.exams)];
    if (!form.name.trim()) {
      setError("Template name is required.");
      setValidationAttempt((attempt) => attempt + 1);
      return;
    }
    if (!Number.isFinite(threshold) || !rawWeights.every(Number.isFinite)) {
      setError("Enter valid numeric grading values.");
      setValidationAttempt((attempt) => attempt + 1);
      return;
    }
    const [ww, pt, exams] = rawWeights.map(normalizeWeight);
    if ([ww, pt, exams].some((value) => value <= 0 || value > 100)) {
      setError(
        "Each component weight must be greater than 0% and no more than 100%.",
      );
      setValidationAttempt((attempt) => attempt + 1);
      return;
    }
    if (normalizeWeight(ww + pt + exams) !== 100) {
      setError(
        "Written Work, Performance Tasks, and Exams must total exactly 100%.",
      );
      setValidationAttempt((attempt) => attempt + 1);
      return;
    }
    if (savingRevision && !revisionAuditValid) {
      setError(
        "Enter the official policy reference and a change reason of at least 5 characters.",
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
      if (editing && savingRevision) {
        await createGradingTemplateRevision(editing.grading_template_id, {
          components,
          policy_reference: thresholdPolicyReference.trim(),
          change_reason: thresholdReason.trim(),
          status: "active",
        });
      } else if (editing)
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
      onClose();
      toast.success({
        title: savingRevision
          ? "New grading revision created"
          : editing
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
      const auditReason = [
        thresholdPolicyReference.trim(),
        thresholdReason.trim(),
      ]
        .filter(Boolean)
        .join(" - ");
      await editGradingTemplateThreshold(editing.grading_template_id, {
        academic_year_id: Number(thresholdYearId),
        threshold: form.threshold,
        expected_updated_at: editing.updated_at ?? "",
        reason: auditReason || thresholdReason.trim(),
      });
      await onReload();
      onClose();
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

  const parsedWeights = [form.ww, form.pt, form.exams].map((value) =>
    value.trim() === "" ? Number.NaN : normalizeWeight(Number(value)),
  );
  const weightsAreFinite = parsedWeights.every(Number.isFinite);
  const weightsInRange =
    weightsAreFinite &&
    parsedWeights.every((value) => value > 0 && value <= 100);
  const total = weightsAreFinite
    ? normalizeWeight(parsedWeights.reduce((sum, value) => sum + value, 0))
    : 0;
  const weightsValid = weightsAreFinite && weightsInRange && total === 100;
  const weightError =
    !weightsValid ||
    error === "Enter valid numeric grading values." ||
    error ===
    "Each component weight must be greater than 0% and no more than 100%." ||
    error ===
    "Written Work, Performance Tasks, and Exams must total exactly 100%.";

  const updateWeight = (key: "ww" | "pt" | "exams", value: string) => {
    const next = { ...form, [key]: value };
    setForm(next);
    if (
      error &&
      [next.ww, next.pt, next.exams].every((w) => {
        const parsed = normalizeWeight(Number(w));
        return (
          w.trim() !== "" &&
          Number.isFinite(parsed) &&
          parsed > 0 &&
          parsed <= 100
        );
      }) &&
      normalizeWeight(
        Number(next.ww) + Number(next.pt) + Number(next.exams),
      ) === 100
    )
      setError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
    >
      <Dialog.Content size="lg" className="max-h-[calc(100dvh-1rem)]">
        <Dialog.Header className="flex-row items-center gap-3 border-b-2 border-black bg-primary px-5 py-4">
          <h3 className="text-xl font-bold">
            {editing ? "Edit Grading Template" : "New Grading Template"}
          </h3>
        </Dialog.Header>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
          <AdminValidationAlert
            message={
              error &&
                ![
                  "Template name is required.",
                  "Enter valid numeric grading values.",
                  "Each component weight must be greater than 0% and no more than 100%.",
                  "Written Work, Performance Tasks, and Exams must total exactly 100%.",
                  "Choose a replacement template for removed subjects.",
                  "Select a year and enter an audit reason.",
                ].includes(error)
                ? error
                : null
            }
            attempt={validationAttempt}
          />
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Template Name" isRequired>
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
                className="w-full"
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
                <Select.Trigger className="w-full disabled:opacity-100">
                  <Select.Value />
                  {editing?.is_locked ? (
                    <div className="ml-auto mr-1 flex shrink-0 items-center">
                      <Badge
                        size="sm"
                        className="inline-flex! flex-row! flex-nowrap! items-center! whitespace-nowrap! bg-black text-white"
                        variant="solid"
                      >
                        <Lock className="mr-1 size-3 shrink-0" />
                        <span className="whitespace-nowrap">Locked</span>
                      </Badge>
                    </div>
                  ) : null}
                </Select.Trigger>
                <Select.Content>
                  <Select.Group>
                    <Select.Item value="active">Active</Select.Item>
                    <Select.Item value="archived">Archived</Select.Item>
                  </Select.Group>
                </Select.Content>
              </Select>
            </Field>
            <Field label="Passing Threshold" isRequired>
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
              <Field label="Academic year context" isRequired>
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
                  <Select.Trigger className="w-full">
                    <Select.Value />
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
              <Field label="New passing threshold" isRequired>
                <Input
                  aria-label="Audited passing threshold"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.threshold}
                  className="w-full"
                  onChange={(event) =>
                    setForm({ ...form, threshold: event.target.value })
                  }
                />
              </Field>
              <Field label="Official policy reference">
                <Input
                  value={thresholdPolicyReference}
                  className="w-full"
                  onChange={(event) =>
                    setThresholdPolicyReference(event.target.value)
                  }
                  placeholder="e.g. DepEd Order No. 015, s. 2026"
                />
              </Field>
              <Field label="Change reason" isRequired>
                <Input
                  value={thresholdReason}
                  className="w-full"
                  aria-invalid={
                    error === "Select a year and enter an audit reason." &&
                    !thresholdReason.trim()
                  }
                  placeholder="Explain why this threshold edit is needed"
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
              <div className="flex w-full justify-end">
                <Button
                  className="gap-2"
                  size="sm"
                  onClick={() => void saveThreshold()}
                  disabled={
                    thresholdSaving ||
                    !thresholdYearId ||
                    !thresholdChanges.hasChanges
                  }
                >
                  {thresholdSaving ? "Saving..." : "Save Threshold"}
                </Button>
              </div>
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
                    className="gap-2"
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
                    title={
                      subject.grading_template_assignment_lock_reason ??
                      undefined
                    }
                    onClick={() => toggleSubject(subject)}
                    className="gap-2 border-black bg-primary font-bold"
                  >
                    {subject.subject_name}
                    {subject.grading_template_assignment_locked ? (
                      <Lock className="size-3.5" />
                    ) : (
                      <X className="size-3.5" />
                    )}
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
                  <AlertTriangle className="size-4" />
                  Duplicate catalog entries detected
                </Alert.Title>
                <Alert.Description className="text-sm text-black/75">
                  Duplicate IDs or grade-level subject codes were shown once:{" "}
                  {subjectCatalog.duplicateLabels.join(", ")}.
                </Alert.Description>
              </Alert>
            ) : null}
            <div
              className={`mt-3 max-h-72 overflow-y-auto rounded! bg-white ${visibleSubjects.length ? "border-2 border-border" : ""}`}
            >
              {!visibleSubjects.length ? (
                <EmptyStateCard
                  compact
                  className="shadow-none hover:shadow-none"
                  icon={<Search />}
                  title={
                    search.trim() || grade !== "all"
                      ? "No matching subjects"
                      : "No subjects available"
                  }
                  description={
                    search.trim() || grade !== "all"
                      ? "Try another subject name, code, or grade filter."
                      : "Subjects will appear here when they are added to the catalog."
                  }
                />
              ) : (
                visibleSubjects.map((subject) => {
                  const selected = form.subjectIds.has(subject.subject_id);
                  const assignedElsewhere = Boolean(
                    subject.grading_template_id &&
                    subject.grading_template_id !==
                    editing?.grading_template_id,
                  );
                  const locked = Boolean(
                    subject.grading_template_assignment_locked,
                  );
                  const disabled = assignedElsewhere || locked;
                  const lockTitle = locked
                    ? (subject.grading_template_assignment_lock_reason ??
                      "Recorded grades lock this assignment.")
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
                      <strong className="truncate text-sm">
                        {subject.subject_name}
                      </strong>
                      <span className="flex flex-wrap items-center justify-end gap-3 text-xs text-black/65">
                        <span>{subject.subject_codename ?? "No code"}</span>
                        <span>
                          Grade {subject.academic_level.grade_level}
                        </span>
                        {assignedElsewhere ? (
                          <Badge variant="outline" size="sm">
                            {subject.grading_template.template_name}
                          </Badge>
                        ) : null}
                        {locked ? (
                          <Lock
                            className="size-3.5"
                            aria-label="Assignment locked"
                          />
                        ) : null}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
            <p className="mt-2 text-xs text-black/60">
              Subjects assigned to another template or containing recorded
              grades are locked here.
            </p>
          </section>

          {removedIds.length ? (
            <Field
              label={`Replacement template for ${removedIds.length} removed subject${removedIds.length === 1 ? "" : "s"}`}
              isRequired
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
              disabled={Boolean(editing?.is_locked) || creatingRevision}
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
                  <p className="text-sm text-muted-foreground">
                    Saving changed weights creates a new revision and
                    preserves historical grade records.
                  </p>
                ) : null}
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-10 min-w-0 flex-1 items-center gap-1 whitespace-nowrap rounded! border-2 border-border bg-background px-4 font-sans text-base font-normal">
                  <span className="truncate text-sm text-muted-foreground">
                    Total:
                  </span>
                  <strong className="truncate text-base font-bold">
                    {weightsAreFinite ? `${total}%` : "—"}
                  </strong>
                </div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: "Written Work", key: "ww" },
                { label: "Performance Tasks", key: "pt" },
                { label: "Exams", key: "exams" },
              ].map(({ label, key }) => (
                <div key={key} className="space-y-1">
                  <span className="block font-sans text-sm font-bold">
                    {label}
                  </span>
                  <PercentInput
                    value={form[key as "ww" | "pt" | "exams"]}
                    disabled={Boolean(
                      editing?.is_locked && !creatingRevision,
                    )}
                    invalid={weightError}
                    onChange={(value) =>
                      updateWeight(key as "ww" | "pt" | "exams", value)
                    }
                  />
                </div>
              ))}
            </div>
            {!weightsValid ? (
              <FormMessage>
                {weightsAreFinite
                  ? weightsInRange
                    ? `Component weights must total exactly 100%. Current total: ${total}%.`
                    : "Each component weight must be greater than 0% and no more than 100%."
                  : "Enter a numeric weight for every component."}
              </FormMessage>
            ) : null}
          </section>
        </div>
        <Dialog.Footer className="mt-0 border-t-2 border-black bg-white">
          <NoChangesMessage message={changes.noChangesMessage} />
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="gap-2"
            onClick={() => void save()}
            disabled={
              saving ||
              !weightsValid ||
              (Boolean(removedIds.length) && !form.replacementTemplateId) ||
              !(creatingRevision && revisionChanges.hasChanges
                ? revisionChanges.hasChanges
                : changes.hasChanges)
            }
          >
            {saving
              ? "Saving..."
              : creatingRevision && revisionChanges.hasChanges
                ? "Save as Revision"
                : editing
                  ? "Save Changes"
                  : "Create Template"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}

export default EditGradingTemplateModal;
