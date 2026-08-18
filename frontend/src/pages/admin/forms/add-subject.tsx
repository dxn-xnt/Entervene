"use client";

import * as React from "react";
import { Button } from "@/components/retroui/Button";
import { Checkbox } from "@/components/retroui/Checkbox";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Text } from "@/components/retroui/Text";
import {
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

const NO_TEMPLATE_VALUE = "no-template";

type AddSubjectModalProps = {
  open?: boolean;
  subjectToEdit?: SubjectListItem | null;
  onCreated?: () => void | Promise<void>;
};

type SubjectFormState = {
  academic_level_id: string;
  subject_name: string;
  subject_codename: string;
  subject_group: string;
  hours: string;
  default_grading_template: string;
  description: string;
  status: SubjectStatus;
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
  subject_group: "",
  hours: "",
  default_grading_template: NO_TEMPLATE_VALUE,
  description: "",
  status: "active",
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

function getSuggestedHoursPlaceholder(
  gradeLevel: number | null | undefined,
  _groupName: string | null | undefined
): string {
  if (gradeLevel != null) {
    if (gradeLevel >= 7 && gradeLevel <= 10) {
      return "40";
    }
    if (gradeLevel >= 11 && gradeLevel <= 12) {
      return "80";
    }
  }
  return "e.g. 40 or 80";
}

function formWithDefaults(options: SubjectFormOptions | null): SubjectFormState {
  return {
    ...emptyForm,
    academic_level_id: String(options?.academic_levels[0]?.academic_level_id ?? ""),
    subject_group: options?.subject_groups[0] ? String(options.subject_groups[0].subject_group_id) : "",
    status: options?.default_status ?? "active",
  };
}

export default function AddSubjectModal({ open, subjectToEdit, onCreated }: AddSubjectModalProps) {
  const [options, setOptions] = React.useState<SubjectFormOptions | null>(null);
  const [offeringOptions, setOfferingOptions] = React.useState<SubjectOfferingFormOptions | null>(null);
  const [gradingTemplates, setGradingTemplates] = React.useState<GradingTemplateListItem[]>([]);
  const [form, setForm] = React.useState<SubjectFormState>(emptyForm);
  const [offerNow, setOfferNow] = React.useState(false);
  const [offeringForm, setOfferingForm] = React.useState<OfferingFormState>(emptyOfferingForm);
  const [isLoadingOptions, setIsLoadingOptions] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Clear transient UI state unconditionally whenever the modal opens or the
    // subject being edited changes. This prevents a stale success/error screen
    // from appearing when the modal is re-opened for a different subject or for
    // a brand-new "Add Subject" flow (where subjectToEdit stays null).
    setSuccessMessage(null);
    setError(null);
    if (subjectToEdit) {
      setForm({
        academic_level_id: String(subjectToEdit.academic_level.academic_level_id),
        subject_name: subjectToEdit.subject_name,
        subject_codename: subjectToEdit.subject_codename || "",
        subject_group: subjectToEdit.subject_group ? String(subjectToEdit.subject_group.subject_group_id) : "",
        hours: subjectToEdit.hours ? String(subjectToEdit.hours) : "",
        default_grading_template: subjectToEdit.default_grading_template || NO_TEMPLATE_VALUE,
        description: subjectToEdit.description || "",
        status: subjectToEdit.status,
      });
      setOfferNow(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subjectToEdit]);

  React.useEffect(() => {
    let isMounted = true;

    async function loadOptions() {
      setIsLoadingOptions(true);
      setError(null);
      try {
        const [subjectOptions, templateData, subjectOfferingOptions] = await Promise.all([
          getSubjectFormOptions(),
          getGradingTemplates({ status: "active" }),
          getSubjectOfferingFormOptions(),
        ]);
        if (!isMounted) return;

        const targetLevels = subjectOptions.academic_levels.filter((level) =>
          [7, 8, 9, 10, 11, 12].includes(level.grade_level)
        );
        const nextOptions = {
          ...subjectOptions,
          academic_levels: targetLevels.length ? targetLevels : subjectOptions.academic_levels,
        };

        setOptions(nextOptions);
        setOfferingOptions(subjectOfferingOptions);
        setGradingTemplates(templateData.grading_templates);
        const activeYear = subjectOfferingOptions.academic_years.find((year) => year.is_active)
          ?? subjectOfferingOptions.academic_years[0];
        setForm((current) => ({
          ...current,
          academic_level_id:
            current.academic_level_id || String(nextOptions.academic_levels[0]?.academic_level_id ?? ""),
          subject_group:
            current.subject_group || (nextOptions.subject_groups[0] ? String(nextOptions.subject_groups[0].subject_group_id) : ""),
          status: nextOptions.default_status,
          default_grading_template: current.default_grading_template || NO_TEMPLATE_VALUE,
        }));
        setOfferingForm((current) => ({
          ...current,
          academic_year_id: current.academic_year_id || String(activeYear?.academic_year_id ?? ""),
        }));
      } catch (err) {
        if (isMounted) setError(err instanceof Error ? err.message : "Unable to load subject options.");
      } finally {
        if (isMounted) setIsLoadingOptions(false);
      }
    }

    void loadOptions();
    return () => {
      isMounted = false;
    };
  }, []);

  const setField = <TKey extends keyof SubjectFormState>(key: TKey, value: SubjectFormState[TKey]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const selectedLevel = options?.academic_levels.find(
    (level) => String(level.academic_level_id) === form.academic_level_id
  );
  const selectedGroup = options?.subject_groups.find(
    (group) => String(group.subject_group_id) === form.subject_group
  );
  const hoursPlaceholder = getSuggestedHoursPlaceholder(
    selectedLevel?.grade_level,
    selectedGroup?.name
  );
  const selectedYearId = Number(offeringForm.academic_year_id);
  const availablePeriods = React.useMemo(
    () => (offeringOptions?.academic_periods ?? []).filter((period) => period.academic_year_id === selectedYearId),
    [offeringOptions, selectedYearId]
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
    setOfferingForm((current) => {
      const nextPathway = availablePathways.includes(current.pathway)
        ? current.pathway
        : availablePathways[0] ?? "general";
      return { ...current, pathway: nextPathway };
    });
  }, [availablePathways]);

  const setOfferingField = <TKey extends keyof OfferingFormState>(
    key: TKey,
    value: OfferingFormState[TKey]
  ) => {
    setOfferingForm((current) => ({ ...current, [key]: value }));
  };

  const handleYearChange = (value: string) => {
    setOfferingForm((current) => ({
      ...current,
      academic_year_id: value,
      academic_period_ids: [],
    }));
  };

  const togglePeriod = (periodId: string, checked: boolean) => {
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
      setError("Select a grade level.");
      return;
    }
    if (!form.subject_name.trim()) {
      setError("Subject name is required.");
      return;
    }
    if (form.hours.trim()) {
      const parsedHours = Number(form.hours);
      if (isNaN(parsedHours) || parsedHours < 0) {
        setError("Hours must be 0 or a positive whole number.");
        return;
      }
    }
    if (offerNow) {
      if (!offeringForm.academic_year_id) {
        setError("Select an academic year for the offering.");
        return;
      }
      if (!offeringForm.academic_period_ids.length) {
        setError("Select at least one term for the offering.");
        return;
      }
      if (!offeringForm.pathway) {
        setError("Select a pathway for the offering.");
        return;
      }
    }

    setIsSaving(true);
    try {
      const selectedTemplate =
        form.default_grading_template === NO_TEMPLATE_VALUE ? null : form.default_grading_template;

      if (subjectToEdit) {
        await updateSubject(subjectToEdit.subject_id, {
          subject_name: form.subject_name.trim(),
          subject_codename: form.subject_codename.trim() || null,
          subject_group_id: Number(form.subject_group),
          hours: form.hours.trim() ? Number(form.hours) : null,
          default_grading_template: selectedTemplate,
          description: form.description.trim() || null,
          status: form.status,
        });
        setSuccessMessage(`${form.subject_name.trim()} updated successfully.`);
        await onCreated?.();
        return;
      }

      const created = await createSubject({
        subject_name: form.subject_name.trim(),
        subject_codename: form.subject_codename.trim() || null,
        subject_group_id: Number(form.subject_group),
        academic_level_id: Number(form.academic_level_id),
        hours: form.hours.trim() ? Number(form.hours) : null,
        default_grading_template: selectedTemplate,
        description: form.description.trim() || null,
        status: form.status,
      });
      if (!offerNow) {
        setSuccessMessage(`${created.subject_name} has been added to the subject catalog.`);
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
            })
          )
        );
        setSuccessMessage(
          `Subject created and ${offeringForm.academic_period_ids.length} offering(s) added.`
        );
        setForm(formWithDefaults(options));
        setOfferNow(false);
        setOfferingForm((current) => ({ ...current, academic_period_ids: [] }));
        await onCreated?.();
      } catch (offeringErr) {
        setError(
          offeringErr instanceof Error
            ? `Subject was created, but offering setup failed. You can finish it in Subject Offerings. ${offeringErr.message}`
            : "Subject was created, but offering setup failed. You can finish it in Subject Offerings."
        );
        setSuccessMessage(`${created.subject_name} has been added to the subject catalog.`);
        setForm(formWithDefaults(options));
        await onCreated?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save subject.");
    } finally {
      setIsSaving(false);
    }
  };

  if (successMessage) {
    return (
      <Dialog.Content size="lg">
        <Dialog.Header asChild>
          <div className="flex w-full items-center justify-between">
            <Text as="h5" className="font-sans text-xl font-bold">{subjectToEdit ? "Subject Updated" : "Subject Added"}</Text>
          </div>
        </Dialog.Header>
        <section className="flex flex-col gap-4 p-4">
          <Text as="p" className="text-sm">
            {successMessage}
          </Text>
          {error ? <p className="text-sm font-semibold text-red-700">{error}</p> : null}
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
    <Dialog.Content size="2xl">
      <Dialog.Header asChild>
        <div className="flex w-full items-center justify-between">
          <Text as="h5" className="font-sans text-xl font-bold">{subjectToEdit ? "Edit Subject" : "Add Subject"}</Text>
        </div>
      </Dialog.Header>
      <section className="flex max-h-[72vh] flex-col gap-4 overflow-y-auto p-4">
        <div>
          <Text as="h6" className="font-sans text-lg font-bold">Subject Details</Text>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="subject-level" className="text-sm">Grade Level</label>
            <Select
              value={form.academic_level_id}
              onValueChange={(value) => setField("academic_level_id", value)}
              disabled={!!subjectToEdit}
            >
              <Select.Trigger id="subject-level" className="w-full min-w-0">
                <Select.Value placeholder={isLoadingOptions ? "Loading levels..." : "Select grade level"} />
              </Select.Trigger>
              <Select.Content position="item-aligned" className="max-h-72 overflow-y-auto">
                <Select.Group>
                  {options?.academic_levels.map((level) => (
                    <Select.Item key={level.academic_level_id} value={String(level.academic_level_id)}>
                      {level.level_name}
                    </Select.Item>
                  ))}
                </Select.Group>
              </Select.Content>
            </Select>
            {subjectToEdit ? (
              <Text as="p" className="text-xs text-black/70 mt-1">
                Grade level can&apos;t be changed after a subject is created.
              </Text>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="subject-name" className="text-sm">Subject Name</label>
            <Input
              id="subject-name"
              value={form.subject_name}
              onChange={(event) => setField("subject_name", event.target.value)}
              type="text"
              placeholder="Enter name"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="subject-code" className="text-sm">Subject Code</label>
            <Input
              id="subject-code"
              value={form.subject_codename}
              onChange={(event) => setField("subject_codename", event.target.value)}
              type="text"
              placeholder="Enter code"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="subject-group" className="text-sm">Subject Group</label>
            <Select value={form.subject_group} onValueChange={(value) => setField("subject_group", value)}>
              <Select.Trigger id="subject-group" className="w-full min-w-0">
                <Select.Value placeholder="Select group" />
              </Select.Trigger>
              <Select.Content position="item-aligned" className="max-h-72 overflow-y-auto">
                <Select.Group>
                  {options?.subject_groups.map((group) => (
                    <Select.Item key={group.subject_group_id} value={String(group.subject_group_id)}>
                      {group.name} (Passing: {group.passing_threshold})
                    </Select.Item>
                  ))}
                </Select.Group>
              </Select.Content>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="subject-hours" className="text-sm">Hours</label>
            <Input
              id="subject-hours"
              value={form.hours}
              onChange={(event) => setField("hours", event.target.value)}
              type="number"
              min={0}
              placeholder={hoursPlaceholder}
            />
            <Text as="p" className="text-xs text-black/70">
              Total instructional hours for the term. Leave blank if unknown — you can update this later.
            </Text>
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Text as="h6" className="font-sans text-base font-bold">Grading Template optional</Text>
            <label htmlFor="grading-template" className="text-sm">Grading Template</label>
            <Select
              value={form.default_grading_template}
              onValueChange={(value) => setField("default_grading_template", value)}
            >
              <Select.Trigger id="grading-template" className="w-full min-w-0">
                <Select.Value placeholder="No template yet" />
              </Select.Trigger>
              <Select.Content position="item-aligned" className="max-h-72 overflow-y-auto">
                <Select.Group>
                  <Select.Item value={NO_TEMPLATE_VALUE}>No template yet</Select.Item>
                  {gradingTemplates.map((template) => (
                    <Select.Item key={template.grading_template_id} value={template.template_name}>
                      {template.template_name}
                    </Select.Item>
                  ))}
                </Select.Group>
              </Select.Content>
            </Select>
            <Text as="p" className="text-xs text-black/70">
              Optional. Select a reusable grading setup if this subject already has known grading weights.
            </Text>
            <Text as="p" className="text-xs text-black/70">
              Create or edit templates in the Grading Setup tab.
            </Text>
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <label htmlFor="subject-description" className="text-sm">Description</label>
            <Input
              id="subject-description"
              value={form.description}
              onChange={(event) => setField("description", event.target.value)}
              type="text"
              placeholder="Optional description"
            />
          </div>
        </div>
        <section className="rounded-lg border-2 border-black bg-[#fff7d6] p-3 shadow-[3px_3px_0_#000]">
          <div className="flex items-start gap-3">
            <Checkbox
              id="offer-now"
              checked={offerNow}
              onCheckedChange={(checked) => setOfferNow(checked === true)}
              className="mt-1 shrink-0"
            />
            <div className="flex flex-col gap-1">
              <label htmlFor="offer-now" className="font-bold">Offer This Subject Now optional</label>
              <p className="text-sm text-black/70">
                Offering means this subject will be available for a school year, term, grade, and pathway.
                Teacher and schedule setup is still done later in Classes.
              </p>
            </div>
          </div>

          {offerNow ? (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="offering-year" className="text-sm">Academic Year</label>
                <Select value={offeringForm.academic_year_id} onValueChange={handleYearChange}>
                  <Select.Trigger id="offering-year" className="w-full min-w-0">
                    <Select.Value placeholder="Select academic year" />
                  </Select.Trigger>
                  <Select.Content position="item-aligned" className="max-h-72 overflow-y-auto">
                    <Select.Group>
                      {offeringOptions?.academic_years.map((year) => (
                        <Select.Item key={year.academic_year_id} value={String(year.academic_year_id)}>
                          {year.year_label}
                        </Select.Item>
                      ))}
                    </Select.Group>
                  </Select.Content>
                </Select>
              </div>
              {requiresPathway ? (
                <div className="flex flex-col gap-1">
                  <label htmlFor="offering-pathway" className="text-sm font-semibold">Pathway</label>
                  <Select
                    value={offeringForm.pathway}
                    onValueChange={(value) => setOfferingField("pathway", value as SubjectOfferingPathway)}
                  >
                    <Select.Trigger id="offering-pathway" className="w-full min-w-0">
                      <Select.Value placeholder="Select pathway" />
                    </Select.Trigger>
                    <Select.Content position="item-aligned" className="max-h-72 overflow-y-auto">
                      <Select.Group>
                        {availablePathways.map((pathway) => {
                          const pathwayObj = offeringOptions?.pathways.find((p) => p.code === pathway);
                          const label = pathwayObj?.name || pathwayLabel(pathway);
                          return (
                            <Select.Item key={pathway} value={pathway}>
                              {label}
                            </Select.Item>
                          );
                        })}
                      </Select.Group>
                    </Select.Content>
                  </Select>
                </div>
              ) : null}
              <div className="flex flex-col gap-2 md:col-span-2">
                <div>
                  <p className="text-sm font-semibold">Term(s)</p>
                  <p className="text-xs text-black/70">
                    Grade level is inherited from {selectedLevel?.level_name || "the selected subject grade"}.
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
                            checked={offeringForm.academic_period_ids.includes(value)}
                            onCheckedChange={(checked) => togglePeriod(value, checked === true)}
                          />
                          <span>{period.period_name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>
        <div className="flex flex-col gap-1">
          <Text as="p" className="text-sm">
            Grade Level: <span className="font-bold">{selectedLevel?.level_name || "Select grade level"}</span>
          </Text>
          {error ? <p className="text-sm font-semibold text-red-700">{error}</p> : null}
        </div>
      </section>
      <Dialog.Footer>
        <Dialog.Close>
          <Button variant="outline" disabled={isSaving}>Cancel</Button>
        </Dialog.Close>
        <Button onClick={handleSubmit} disabled={isSaving || isLoadingOptions}>
          {subjectToEdit ? "Save Changes" : "Add Subject"}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  );
}
