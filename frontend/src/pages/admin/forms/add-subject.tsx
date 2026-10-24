"use client";

import * as React from "react";
import { Button } from "@/components/retroui/Button";
import { Checkbox } from "@/components/retroui/Checkbox";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Text } from "@/components/retroui/Text";
import { FormMessage } from "@/components/retroui/FormMessage";
import { AdminValidationAlert } from "@/components/admin/AdminValidationAlert";
import { useToast } from "@/components/retroui/Toast";
import {
  ApiRequestError,
  createSubjectOffering,
  createSubject,
  updateSubject,
  getGradingTemplates,
  getSubjectOfferingFormOptions,
  getSubjectFormOptions,
  type GradingTemplateListItem,
  type SubjectListItem,
  type SubjectOfferingFormOptions,
  type SubjectOfferingPathway,
  type SubjectFormOptions,
  type SubjectStatus,
} from "@/lib/api";

import { isSeniorHighGrade } from "../subjects/components/subject-utils";

type AddSubjectModalProps = {
  open?: boolean;
  subjectToEdit?: SubjectListItem | null;
  onCreated?: () => void | Promise<void>;
  lockedGradeLevel?: string;
};

type SubjectFormState = {
  academic_level_id: string;
  subject_name: string;
  subject_codename: string;
  grading_template_id: string;
  description: string;
  status: SubjectStatus;
  is_math_or_science: boolean;
};

type OfferingFormState = {
  academic_year_id: string;
  academic_period_ids: string[];
  pathway: SubjectOfferingPathway;
};

const emptyForm: SubjectFormState = {
  academic_level_id: "",
  subject_name: "",
  subject_codename: "",
  grading_template_id: "",
  description: "",
  status: "active",
  is_math_or_science: false,
};

const emptyOfferingForm: OfferingFormState = {
  academic_year_id: "",
  academic_period_ids: [],
  pathway: "general",
};

function pathwayLabel(pathway: SubjectOfferingPathway) {
  if (pathway === "general") return "General";
  if (pathway === "both") return "Shared / Both";
  if (pathway === "stem_medical") return "STEM Medical";
  return "STEM Engineering";
}



function formWithDefaults(
  options: SubjectFormOptions | null,
): SubjectFormState {
  return {
    ...emptyForm,
    academic_level_id: String(
      options?.academic_levels[0]?.academic_level_id ?? "",
    ),
    grading_template_id: String(options?.grading_template_details.find((t) => t.template_name === "Core")?.grading_template_id ?? ""),
    status: options?.default_status ?? "active",
  };
}

export default function AddSubjectModal({
  open,
  subjectToEdit,
  onCreated,
  lockedGradeLevel,
}: AddSubjectModalProps) {
  const toast = useToast();
  const [options, setOptions] = React.useState<SubjectFormOptions | null>(null);
  const [offeringOptions, setOfferingOptions] =
    React.useState<SubjectOfferingFormOptions | null>(null);
  const [gradingTemplates, setGradingTemplates] = React.useState<
    GradingTemplateListItem[]
  >([]);
  const [form, setForm] = React.useState<SubjectFormState>(emptyForm);
  const [offerNow, setOfferNow] = React.useState(false);
  const [offeringForm, setOfferingForm] =
    React.useState<OfferingFormState>(emptyOfferingForm);
  const [isLoadingOptions, setIsLoadingOptions] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [validationAttempt, setValidationAttempt] = React.useState(0);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );

  React.useEffect(() => {
    // Clear transient UI state unconditionally whenever the modal opens or the
    // subject being edited changes. This prevents a stale success/error screen
    // from appearing when the modal is re-opened for a different subject or for
    // a brand-new "Add Subject" flow (where subjectToEdit stays null).
    setSuccessMessage(null);
    setError(null);
    if (subjectToEdit) {
      setForm({
        academic_level_id: String(
          subjectToEdit.academic_level.academic_level_id,
        ),
        subject_name: subjectToEdit.subject_name,
        subject_codename: subjectToEdit.subject_codename || "",
        grading_template_id: String(subjectToEdit.grading_template_id ?? ""),
        description: subjectToEdit.description || "",
        status: subjectToEdit.status,
        is_math_or_science: subjectToEdit.is_math_or_science || false,
      });
      setOfferNow(false);
    }
  }, [open, subjectToEdit]);

  React.useEffect(() => {
    let isMounted = true;

    async function loadOptions() {
      setIsLoadingOptions(true);
      setError(null);
      try {
        const [subjectOptions, templateData, subjectOfferingOptions] =
          await Promise.all([
            getSubjectFormOptions(),
            getGradingTemplates({ status: "active" }),
            getSubjectOfferingFormOptions(),
          ]);
        if (!isMounted) return;

        const targetLevels = subjectOptions.academic_levels.filter((level) =>
          [7, 8, 9, 10, 11, 12].includes(level.grade_level),
        );
        const nextOptions = {
          ...subjectOptions,
          academic_levels: targetLevels.length
            ? targetLevels
            : subjectOptions.academic_levels,
        };

        setOptions(nextOptions);
        setOfferingOptions(subjectOfferingOptions);
        setGradingTemplates(templateData.grading_templates);
        const activeYear =
          subjectOfferingOptions.academic_years.find(
            (year) => year.is_active,
          ) ?? subjectOfferingOptions.academic_years[0];
        setForm((current) => ({
          ...current,
          academic_level_id:
            current.academic_level_id ||
            String(nextOptions.academic_levels[0]?.academic_level_id ?? ""),
          grading_template_id: current.grading_template_id ||
            String(nextOptions.grading_template_details.find((t) => t.template_name === "Core")?.grading_template_id ?? ""),
          status: nextOptions.default_status,
        }));
        setOfferingForm((current) => ({
          ...current,
          academic_year_id:
            current.academic_year_id ||
            String(activeYear?.academic_year_id ?? ""),
        }));
      } catch (err) {
        if (isMounted)
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load subject options.",
          );
      } finally {
        if (isMounted) setIsLoadingOptions(false);
      }
    }

    void loadOptions();
    return () => {
      isMounted = false;
    };
  }, []);

  const lockedLevel = React.useMemo(() => {
    if (!lockedGradeLevel || !options) return null;
    const normalized = lockedGradeLevel.trim().toLowerCase();
    return (
      options.academic_levels.find(
        (level) => level.level_name.toLowerCase() === normalized,
      ) ?? null
    );
  }, [lockedGradeLevel, options]);

  const isLevelLocked = !!subjectToEdit || !!lockedLevel;

  const setField = <TKey extends keyof SubjectFormState>(
    key: TKey,
    value: SubjectFormState[TKey],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    if ((key === "academic_level_id" && error === "Select a grade level." && value)
      || (key === "subject_name" && error === "Subject name is required." && String(value).trim())
      || (key === "grading_template_id" && error === "Select an active grading template." && value)) setError(null);
  };

  const failValidation = (message: string) => {
    setError(message);
    setValidationAttempt((attempt) => attempt + 1);
  };

  const selectedTemplateObj = gradingTemplates.find(
    (t) => String(t.grading_template_id) === form.grading_template_id,
  ) ?? null;

  const selectedLevel = options?.academic_levels.find(
    (level) => String(level.academic_level_id) === form.academic_level_id,
  );
  const selectedYearId = Number(offeringForm.academic_year_id);
  const availablePeriods = React.useMemo(
    () =>
      (offeringOptions?.academic_periods ?? []).filter(
        (period) => period.academic_year_id === selectedYearId,
      ),
    [offeringOptions, selectedYearId],
  );
  const isShsSelection = isSeniorHighGrade(selectedLevel?.grade_level);
  const availablePathways = React.useMemo<SubjectOfferingPathway[]>(() => {
    if (!isShsSelection) return [];
    const activePathways = offeringOptions?.pathways ?? [];
    const list: SubjectOfferingPathway[] = [];

    if (activePathways.length > 1) {
      list.push("both");
    }
    for (const p of activePathways) {
      if (!list.includes(p.code as SubjectOfferingPathway)) {
        list.push(p.code as SubjectOfferingPathway);
      }
    }
    return list;
  }, [isShsSelection, offeringOptions?.pathways]);

  const requiresPathway = availablePathways.length > 0;

  React.useEffect(() => {
    if (subjectToEdit || !lockedLevel) return;
    setForm((current) => ({
      ...current,
      academic_level_id: String(lockedLevel.academic_level_id),
    }));
  }, [lockedLevel, subjectToEdit]);

  React.useEffect(() => {
    setOfferingForm((current) => {
      const nextPathway = availablePathways.includes(current.pathway)
        ? current.pathway
        : (availablePathways[0] ?? "general");
      return { ...current, pathway: nextPathway };
    });
  }, [availablePathways]);

  const setOfferingField = <TKey extends keyof OfferingFormState>(
    key: TKey,
    value: OfferingFormState[TKey],
  ) => {
    setOfferingForm((current) => ({ ...current, [key]: value }));
    if (key === "pathway" && error === "Select a pathway for the offering." && value) setError(null);
  };

  const handleYearChange = (value: string) => {
    if (value && error === "Select an academic year for the offering.") setError(null);
    setOfferingForm((current) => ({
      ...current,
      academic_year_id: value,
      academic_period_ids: [],
    }));
  };

  const togglePeriod = (periodId: string, checked: boolean) => {
    if (checked && error === "Select at least one term for the offering.") setError(null);
    setOfferingForm((current) => ({
      ...current,
      academic_period_ids: checked
        ? [...current.academic_period_ids, periodId]
        : current.academic_period_ids.filter((id) => id !== periodId),
    }));
  };

  const handleSubmit = async () => {
    setError(null);
    if (!form.academic_level_id) {
      failValidation("Select a grade level.");
      return;
    }
    if (!form.subject_name.trim()) {
      failValidation("Subject name is required.");
      return;
    }
    if (offerNow) {
      if (!offeringForm.academic_year_id) {
        failValidation("Select an academic year for the offering.");
        return;
      }
      if (!offeringForm.academic_period_ids.length) {
        failValidation("Select at least one term for the offering.");
        return;
      }
      if (!offeringForm.pathway) {
        failValidation("Select a pathway for the offering.");
        return;
      }
    }

    if (!selectedTemplateObj) {
      failValidation("Select an active grading template.");
      return;
    }
    setIsSaving(true);
    try {
      const gradingTemplateId = selectedTemplateObj.grading_template_id;

      if (subjectToEdit) {
        await updateSubject(subjectToEdit.subject_id, {
          subject_name: form.subject_name.trim(),
          subject_codename: form.subject_codename.trim() || null,
          grading_template_id: gradingTemplateId,
          description: form.description.trim() || null,
          status: form.status,
          is_math_or_science: form.is_math_or_science,
        });
        setSuccessMessage(`${form.subject_name.trim()} updated successfully.`);
        toast.success({ title: "Subject updated" });
        await onCreated?.();
        return;
      }

      const created = await createSubject({
        subject_name: form.subject_name.trim(),
        subject_codename: form.subject_codename.trim() || null,
        grading_template_id: gradingTemplateId,
        academic_level_id: Number(form.academic_level_id),
        description: form.description.trim() || null,
        status: form.status,
        is_math_or_science: form.is_math_or_science,
      });
      if (!offerNow) {
        setSuccessMessage(
          `${created.subject_name} has been added to the subject catalog.`,
        );
        toast.success({ title: "Subject created" });
        setForm(formWithDefaults(options));
        await onCreated?.();
        return;
      }

      try {
        await Promise.all(
          offeringForm.academic_period_ids.map((periodId) =>
            createSubjectOffering({
              subject_id: created.subject_id,
              academic_year_id: Number(offeringForm.academic_year_id),
              academic_level_id: Number(form.academic_level_id),
              academic_period_id: Number(periodId),
              pathway: requiresPathway ? offeringForm.pathway : "general",
              status: "active",
            }),
          ),
        );
        setSuccessMessage(
          `Subject created and ${offeringForm.academic_period_ids.length} offering(s) added.`,
        );
        toast.success({ title: "Subject and offerings created" });
        setForm(formWithDefaults(options));
        setOfferNow(false);
        setOfferingForm((current) => ({ ...current, academic_period_ids: [] }));
        await onCreated?.();
      } catch (offeringErr) {
        setError(
          offeringErr instanceof Error
            ? `Subject was created, but offering setup failed. You can finish it in Subject Offerings. ${offeringErr.message}`
            : "Subject was created, but offering setup failed. You can finish it in Subject Offerings.",
        );
        setSuccessMessage(
          `${created.subject_name} has been added to the subject catalog.`,
        );
        setForm(formWithDefaults(options));
        await onCreated?.();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to save subject.";
      if (err instanceof ApiRequestError && (err.status === 400 || err.status === 422)) {
        setError(message);
        setValidationAttempt((attempt) => attempt + 1);
      } else toast.error({ title: "Unable to save subject", description: message });
    } finally {
      setIsSaving(false);
    }
  };

  if (successMessage) {
    return (
      <Dialog.Content size="lg">
        <Dialog.Header asChild>
          <div className="flex w-full items-center justify-between">
            <Text as="h5" className="font-sans text-xl font-bold">
              {subjectToEdit ? "Subject Updated" : "Subject Added"}
            </Text>
          </div>
        </Dialog.Header>
        <section className="flex flex-col gap-4 p-4">
          <Text as="p" className="text-sm">
            {successMessage}
          </Text>
          {error ? (
            <FormMessage>{error}</FormMessage>
          ) : null}
        </section>
        <Dialog.Footer>
          {!subjectToEdit ? (
            <Button
              variant="outline"
              onClick={() => {
                setSuccessMessage(null);
                setError(null);
              }}
            >
              Add Another
            </Button>
          ) : null}
          <Dialog.Close>
            <Button>Done</Button>
          </Dialog.Close>
        </Dialog.Footer>
      </Dialog.Content>
    );
  }

  return (
    <Dialog.Content size="lg">
      <Dialog.Header asChild>
        <div className="flex w-full items-center justify-between">
          <Text as="h5" className="font-sans text-xl font-bold">
            {subjectToEdit ? "Edit Subject" : "Add Subject"}
          </Text>
        </div>
      </Dialog.Header>
      <section className="flex flex-col gap-4 p-4">
        <AdminValidationAlert
          message={error && !["Select a grade level.", "Subject name is required.", "Select an academic year for the offering.", "Select at least one term for the offering.", "Select a pathway for the offering.", "Select an active grading template."].includes(error) ? error : null}
          attempt={validationAttempt}
          firstInvalidFieldId={error === "Select a grade level." ? "subject-level" : error === "Subject name is required." ? "subject-name" : error === "Select an active grading template." ? "grading-template" : error === "Select an academic year for the offering." ? "offering-year" : undefined}
        />
        <div className="grid grid-cols-1 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="subject-level" className="text-sm font-medium">
              Grade Level <span className="text-red-500">*</span>
            </label>
            <Select
              value={form.academic_level_id}
              onValueChange={(value) => setField("academic_level_id", value)}
              disabled={isLevelLocked}
            >
              <Select.Trigger id="subject-level" aria-invalid={error === "Select a grade level."} aria-describedby={error === "Select a grade level." ? "subject-level-error" : undefined} className="w-full min-w-0 aria-[invalid=true]:border-destructive">
                <Select.Value
                  placeholder={
                    isLoadingOptions
                      ? "Loading levels..."
                      : "Select grade level"
                  }
                />
              </Select.Trigger>
              <Select.Content
                position="item-aligned"
                className="max-h-72 overflow-y-auto"
              >
                <Select.Group>
                  {options?.academic_levels.map((level) => (
                    <Select.Item
                      key={level.academic_level_id}
                      value={String(level.academic_level_id)}
                    >
                      {level.level_name}
                    </Select.Item>
                  ))}
                </Select.Group>
              </Select.Content>
            </Select>
            {error === "Select a grade level." && <FormMessage id="subject-level-error">{error}</FormMessage>}

            {subjectToEdit ? (
              <Text as="p" className="text-xs text-muted-foreground mt-1">
                Grade level can&apos;t be changed after a subject is created.
              </Text>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="subject-name" className="text-sm font-medium">
              Subject Name <span className="text-red-500">*</span>
            </label>
            <Input
              id="subject-name"
              aria-invalid={error === "Subject name is required."}
              aria-describedby={error === "Subject name is required." ? "subject-name-error" : undefined}
              value={form.subject_name}
              onChange={(event) => setField("subject_name", event.target.value)}
              type="text"
              placeholder="Enter name"
            />
            {error === "Subject name is required." && <FormMessage id="subject-name-error">{error}</FormMessage>}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="subject-code" className="text-sm font-medium">
              Subject Code
            </label>
            <Input
              id="subject-code"
              value={form.subject_codename}
              onChange={(event) =>
                setField("subject_codename", event.target.value)
              }
              type="text"
              placeholder="Enter code"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="grading-template" className="text-sm font-medium">Grading Template <span className="text-red-500">*</span></label>
            <Select value={form.grading_template_id} onValueChange={(value) => setField("grading_template_id", value)}>
              <Select.Trigger id="grading-template" aria-invalid={error === "Select an active grading template."} aria-describedby={error === "Select an active grading template." ? "grading-template-error" : undefined} className="w-full min-w-0 aria-[invalid=true]:border-destructive">
                <Select.Value placeholder="Select grading template" />
              </Select.Trigger>
              <Select.Content position="popper" className="max-h-72 overflow-y-auto">
                <Select.Group>
                  {gradingTemplates.map((template) => (
                    <Select.Item key={template.grading_template_id} value={String(template.grading_template_id)}>
                      {template.template_name}
                    </Select.Item>
                  ))}
                </Select.Group>
              </Select.Content>
            </Select>
            {error === "Select an active grading template." && <FormMessage id="grading-template-error">{error}</FormMessage>}
            {selectedTemplateObj && (
              <div className="rounded border border-black/20 bg-muted/20 p-3 text-sm">
                <strong>{selectedTemplateObj.template_name}</strong>
                <p>Passing Threshold: {selectedTemplateObj.passing_threshold}%</p>
                <p>Written Work: {selectedTemplateObj.components.find((c) => c.component_name === "Written Work")?.weight ?? 0}% | Performance Tasks: {selectedTemplateObj.components.find((c) => c.component_name === "Performance Tasks")?.weight ?? 0}% | Exams: {selectedTemplateObj.components.find((c) => c.component_name === "Exams")?.weight ?? 0}%</p>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="subject-description" className="text-sm font-medium">
              Description
            </label>
            <Input
              id="subject-description"
              value={form.description}
              onChange={(event) => setField("description", event.target.value)}
              type="text"
              placeholder="Optional description"
            />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-start gap-3 mt-2 rounded border-2 border-black p-3 shadow-[2px_2px_0_#000]">
              <Checkbox
                id="is-math-science"
                checked={form.is_math_or_science}
                onCheckedChange={(checked) =>
                  setField("is_math_or_science", checked === true)
                }
                className="mt-1 shrink-0"
              />
              <div className="flex flex-col gap-1">
                <label htmlFor="is-math-science" className="text-sm font-medium">
                  Is Core Math or Science? (60-min requirement)
                </label>
                <p className="text-sm text-muted-foreground">
                  Checking this flag enforces a 60-minute duration requirement
                  for this subject during automatic and manual scheduling to
                  comply with core curriculum standards.
                </p>
              </div>
            </div>
          </div>
        </div>
        <section className="rounded border-2 border-black bg-[#fff7d6] p-3 shadow-[3px_3px_0_#000]">
          <div className="flex items-start gap-3">
            <Checkbox
              id="offer-now"
              checked={offerNow}
              onCheckedChange={(checked) => setOfferNow(checked === true)}
              className="mt-1 shrink-0"
            />
            <div className="flex flex-col gap-1">
              <label htmlFor="offer-now" className="text-sm font-medium">
                Offer This Subject Now optional
              </label>
              <p className="text-sm text-muted-foreground">
                Offering means this subject will be available for a school year,
                term, grade, and pathway. Teacher and schedule setup is still
                done later in Classes.
              </p>
            </div>
          </div>

          {offerNow ? (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="offering-year" className="text-sm font-medium">
                  Academic Year <span className="text-red-500">*</span>
                </label>
                <Select
                  value={offeringForm.academic_year_id}
                  onValueChange={handleYearChange}
                >
                  <Select.Trigger id="offering-year" aria-invalid={error === "Select an academic year for the offering."} aria-describedby={error === "Select an academic year for the offering." ? "offering-year-error" : undefined} className="w-full min-w-0 aria-[invalid=true]:border-destructive">
                    <Select.Value placeholder="Select academic year" />
                  </Select.Trigger>
                  <Select.Content
                    position="item-aligned"
                    className="max-h-72 overflow-y-auto"
                  >
                    <Select.Group>
                      {offeringOptions?.academic_years.map((year) => (
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
                {error === "Select an academic year for the offering." && <FormMessage id="offering-year-error">{error}</FormMessage>}
              </div>
              {requiresPathway ? (
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="offering-pathway"
                    className="text-sm font-medium"
                  >
                    Pathway <span className="text-red-500">*</span>
                  </label>
                  <Select
                    value={offeringForm.pathway}
                    onValueChange={(value) =>
                      setOfferingField(
                        "pathway",
                        value as SubjectOfferingPathway,
                      )
                    }
                  >
                    <Select.Trigger
                      id="offering-pathway"
                      aria-invalid={error === "Select a pathway for the offering."}
                      aria-describedby={error === "Select a pathway for the offering." ? "offering-pathway-error" : undefined}
                      className="w-full min-w-0 aria-[invalid=true]:border-destructive"
                    >
                      <Select.Value placeholder="Select pathway" />
                    </Select.Trigger>
                    <Select.Content
                      position="item-aligned"
                      className="max-h-72 overflow-y-auto"
                    >
                      <Select.Group>
                        {availablePathways.map((pathway) => {
                          const pathwayObj = offeringOptions?.pathways.find(
                            (p) => p.code === pathway,
                          );
                          const label =
                            pathwayObj?.name || pathwayLabel(pathway);
                          return (
                            <Select.Item key={pathway} value={pathway}>
                              {label}
                            </Select.Item>
                          );
                        })}
                      </Select.Group>
                    </Select.Content>
                  </Select>
                  {error === "Select a pathway for the offering." && <FormMessage id="offering-pathway-error">{error}</FormMessage>}
                </div>
              ) : null}
              <div className="flex flex-col gap-2 md:col-span-2">
                <div>
                  <p className="text-sm font-medium">Term(s) <span className="text-red-500">*</span></p>
                  <p className="text-xs text-muted-foreground">
                    Grade level is inherited from{" "}
                    {selectedLevel?.level_name || "the selected subject grade"}.
                  </p>
                </div>
                {availablePeriods.length === 0 ? (
                  <p className="text-sm font-semibold text-amber-700">
                    No terms found for the selected academic year.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    {availablePeriods.map((period) => {
                      const value = String(period.academic_period_id);
                      return (
                        <label
                          key={period.academic_period_id}
                          className="flex items-center gap-2 rounded border-2 border-black bg-background p-2 text-sm"
                        >
                          <Checkbox
                            checked={offeringForm.academic_period_ids.includes(
                              value,
                            )}
                            onCheckedChange={(checked) =>
                              togglePeriod(value, checked === true)
                            }
                          />
                          <span>{period.period_name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {error === "Select at least one term for the offering." && <FormMessage>{error}</FormMessage>}
              </div>
            </div>
          ) : null}
        </section>
        <div className="flex flex-col gap-1">
          <Text as="p" className="text-sm">
            Grade Level:{" "}
            <span className="font-bold">
              {selectedLevel?.level_name || "Select grade level"}
            </span>
          </Text>
        </div>
      </section>
      <Dialog.Footer>
        <Dialog.Close>
          <Button variant="outline" disabled={isSaving}>
            Cancel
          </Button>
        </Dialog.Close>
        <Button onClick={handleSubmit} disabled={isSaving || isLoadingOptions}>
          {subjectToEdit ? "Save Changes" : "Add Subject"}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  );
}
